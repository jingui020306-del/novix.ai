"""Character formation proposals. Persist only through the existing character-card editor."""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from threading import Lock
from typing import Literal

from httpx import HTTPError
from pydantic import BaseModel, Field

from services.author_control_service import AuthorControlService
from services.author_data_service import AuthorDataService
from services.character_detail_service import strip_author_only
from services.world_scope_service import WorldScopeService, entity_id
from services.token_usage import summarize_usage


FieldName = Literal['experience', 'expectation', 'core_motivation', 'response', 'feedback', 'personality_traits']
LABELS = dict(experience='成长经历或反复出现的处境', expectation='人物当时预期什么',
              core_motivation='动机', response='这种处境下可观察到的行动', feedback='结果怎样强化或改变这种做法',
              personality_traits='形成的性格倾向及例外')
CARD_FIELDS = {'experience': 'family_background', 'core_motivation': 'core_motivation', 'personality_traits': 'personality_traits'}
SPECIALISTS = {'comet': 'NOVIX_COMET_DIR', 'glucose': 'NOVIX_GLUCOSE_DIR'}
_inference_lock = Lock()


class FormationRequest(BaseModel):
    card: dict
    fields: list[FieldName] = Field(min_length=1, max_length=6)
    observation: str = Field(default='', max_length=2000)
    story_card_id: str | None = Field(default=None, pattern=r'^[\w-]+$')
    compare_glucose: bool = False
    llm_profile_id: str = Field(default='novix_local', min_length=1)


def parse_object(text):
    if text.startswith('```') and text.endswith('```'):
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0]
    try:
        value = json.loads(text)
    except ValueError as exc:
        raise ValueError('模型没有返回可读取的候选，请重试。') from exc
    if not isinstance(value, dict):
        raise ValueError('候选格式不正确，请重试。')
    return value


def infer_specialist(name, query):
    directory = os.environ[SPECIALISTS[name]]
    if not Path(directory).is_dir():
        raise ValueError('本地权重目录不存在')
    # A specialist is used only on request. Release its weights before resuming Chinese generation.
    with _inference_lock:
        process = subprocess.run([sys.executable, '-m', 'services.character_formation', name],
                                 cwd=Path(__file__).resolve().parents[1], input=query, capture_output=True,
                                 encoding='utf-8', timeout=120)
    if process.returncode:
        raise ValueError('请核对专用模型权重和可选依赖')
    return json.loads(process.stdout)


def _generate_specialist(name, query):
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    directory = os.environ[SPECIALISTS[name]]
    tokenizer = AutoTokenizer.from_pretrained(directory, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(directory, local_files_only=True).eval()
    if model.config.model_type != {'comet': 'bart', 'glucose': 't5'}[name]:
        raise ValueError('专用模型架构不匹配')
    torch.set_num_threads(min(4, torch.get_num_threads()))
    with torch.inference_mode():
        batch = tokenizer(query, return_tensors='pt', return_token_type_ids=False, truncation=True, max_length=512)
        ids = model.generate(**batch, num_beams=3, num_return_sequences=2, max_new_tokens=72)
        outputs = (text.strip() for text in tokenizer.batch_decode(ids, skip_special_tokens=True))
        return list(dict.fromkeys(text for text in outputs if text and text.lower() != 'none'))


def _inputs(service, project, request):
    card = request.card
    cid = entity_id(card.get('id'), '人物')
    p = card.get('payload')
    if card.get('type') != 'character' or not isinstance(p, dict):
        raise ValueError('请选择人物卡。')
    world = WorldScopeService(service.store)
    scope = world.resolve(project, story_card_id=request.story_card_id, world_context=p.get('world_context') or {})['scope']
    if not world.card_visible(project, card, scope):
        raise ValueError('此人物不属于当前范围。')
    controls = AuthorControlService(service.store).get(project, f'cards/{cid}.yaml')
    locks = {path for lock in controls['locks'] for path in lock['paths']}
    sections = {s['id']: s for s in p.get('detail_sections', []) if isinstance(s, dict) and s.get('id')}
    preferences = p.get('profile_generation') or {}
    protected = set(preferences.get('locked', [])) | set(preferences.get('blank', []))
    if 'trait' in [*p.get('family_locked', []), *p.get('family_blank', [])]:
        protected.add('personality_traits')
    for field in request.fields:
        sid = 'formation_' + field
        card_field = CARD_FIELDS.get(field)
        value = p.get(card_field) if card_field else sections.get(sid)
        pointer = f'/payload/{card_field}' if card_field else f'/payload/detail_sections/@{sid}'
        if value or card_field in protected or any(path == '/' or pointer == path or pointer.startswith(path + '/') or path.startswith(pointer + '/') for path in locks):
            raise ValueError(f'「{LABELS[field]}」已填写、锁定或保留为空，请另选空项。')
    safe = strip_author_only(p)
    anchors = {}
    for key in ('identity', 'family_background', 'personality_traits', 'core_motivation', 'vulnerability', 'voice', 'boundaries'):
        value = safe.get(key)
        if isinstance(value, list):
            value = '、'.join(str(part) for part in value)
        if isinstance(value, str) and value.strip():
            anchors[key] = value[:1000]
    details = [s for s in safe.get('detail_sections', []) if world.applies(project, s.get('scope'), scope)[0]]
    if details:
        anchors['人物细节'] = [{'标题': s.get('title'), '内容': str(s.get('content', ''))[:800]} for s in details[:5]]
    if request.observation.strip():
        anchors['作者本次提供'] = request.observation.strip()
    if not anchors:
        raise ValueError('请先写一项性格、经历或行为。')
    # Only reference this character's relationships as they stand in this scope.
    authors = AuthorDataService(service.store)
    relations = []
    for row in authors.relationships_at(project, scope):
        rel = strip_author_only(row['state'])
        ids = [person['entity_id'] for person in rel.get('participants', [])]
        if cid not in ids:
            continue
        people = [service.store.read_yaml(project, f'cards/{entity_id(i)}.yaml') for i in ids]
        if all(person and world.card_visible(project, person, scope) for person in people):
            relations.append({'关系': rel['label'], '人物': [person.get('title') for person in people]})
        if len(relations) == 8:
            break
    if relations:
        anchors['已有关联'] = relations
    return anchors


async def propose(service, project, request):
    anchors = _inputs(service, project, request)
    model_choice = {'llm_profile_id': request.llm_profile_id, 'require_configured_profile': True}
    fields = list(dict.fromkeys(request.fields))
    notices, specialist, calls = [], {}, []
    engines = (['comet'] if 'core_motivation' in fields else []) + (['glucose'] if request.compare_glucose else [])
    ready = [name for name in engines if os.environ.get(SPECIALISTS[name])]
    for name in (name for name in engines if name not in ready):
        notices.append(f'{name.upper()} 未配置本地权重。')

    def text_fields(keys):
        return {'type': 'object', 'properties': {key: {'type': 'string'} for key in keys},
                'required': list(keys), 'additionalProperties': False}

    async def generate(system, data, tokens, schema=None):
        return await service.complete(project, model_choice, 'setup_character', system,
                                      json.dumps(data, ensure_ascii=False), max_tokens=tokens, prepare_memory=False, usage_callback=calls.append, response_schema=schema)

    if ready:
        try:
            english = parse_object(await generate(
                'Translate only supplied material into English. Return JSON {"event":"PersonX ...","context":"..."}. '
                'Keep who acted, who was helped, and who received the action distinct. event is one supplied behavior using PersonX for the actor; context is its background. Use an empty event if none is supplied.',
                anchors, 200, text_fields(['event', 'context'])))
            event = english.get('event')
            context = english.get('context', '')
            if not isinstance(event, str) or not event.strip() or not isinstance(context, str):
                raise ValueError('缺少可交给专用模型的具体行为')
            event = event.strip().strip('*')[:500]
            dimension = 6 if 'feedback' in fields and 'experience' not in fields else 1
            for name in ready:
                query = f'{event} xIntent [GEN]' if name == 'comet' else f'#{dimension}: {context[:900]} *{event}*'
                try:
                    alternatives = await asyncio.to_thread(infer_specialist, name, query)
                    if alternatives:
                        specialist[name] = alternatives
                    else:
                        notices.append(f'{name.upper()} 未产生可用解释。')
                except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
                    notices.append(f'{name.upper()} 未运行成功：{str(exc)[:180]}')
        except (ValueError, RuntimeError, HTTPError) as exc:
            notices.append(f'专用模型输入未就绪：{str(exc)[:180]}')

    task = {'作者已有资料': anchors, '只补这些字段': {k: LABELS[k] for k in fields},
            '输出示例结构': {'candidates': [{k: '一句具体中文' for k in fields}]}}
    if 'response' in fields:
        task['输出示例结构']['candidates'][0]['situation'] = '应对方式适用的具体处境，用简短关键词组表示'
    template = task['输出示例结构']['candidates'][0]
    item_schema = text_fields(template)
    if 'personality_traits' in fields:
        template['personality_traits'] = {'when': '下次遇到哪种具体处境', 'tendency': '往往怎样应对'}
        item_schema['properties']['personality_traits'] = text_fields(['when', 'tendency'])
    if 'comet' in specialist:
        task['COMET 提出的可能动机（可舍弃）'] = specialist['comet']
    output = {'type': 'object', 'properties': {'candidates': {
        'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': item_schema}},
        'required': ['candidates'], 'additionalProperties': False}
    text = await generate(
        '为小说人物补写两种不同的性格来由候选。只返回指定JSON。每个值限一句具体的中文短句，约十五至三十字。'
        '按处境→预期→行动→反馈思考，正向经验、挫折、主动选择都可以。两案应在人物理解或得到的反馈上有实质差别。'
        '把作者给出的行为、责任归属和实际反馈当作固定前提。没有写明谁造成的事，就不要补写归责。'
        '性格字段仅描述此后遇到同类处境会怎样做，不重述成因；预期字段写他估计别人会怎么反应，不写他希望别人怎么做。'
        '例如，同一人主动提出建议：若被采纳，日后可能习惯先开口；若接连遭嘲弄，可能仍提建议、却习惯先私下试探。'
        '按本人物的具体材料推理，不照抄示例。'
        '只补指定空项，保持作者原话和已知事实，新增经历是假设。不要断言诊断、捏造人物编号或把家庭创伤当默认原因。'
        'response只写当时一个具体可见行动。不要复述指令。', task, 850, output)
    rows = parse_object(text).get('candidates')
    candidates = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        trait = row.get('personality_traits')
        if 'personality_traits' in fields and isinstance(trait, dict):
            if not all(isinstance(trait.get(k), str) and trait[k].strip() for k in ('when', 'tendency')):
                continue
            when, tendency = (trait[k].strip().rstrip('，。') for k in ('when', 'tendency'))
            row['personality_traits'] = f'{when}，{tendency}。'
        if not all(isinstance(row.get(k), str) and 0 < len(row[k].strip()) <= 1000 for k in fields):
            continue
        candidate = {k: row[k].strip() for k in fields}
        if 'response' in fields and isinstance(row.get('situation'), str):
            candidate['situation'] = row['situation'].strip()[:120]
        if candidate not in candidates:
            candidates.append(candidate)
        if len(candidates) == 2:
            break
    if not candidates:
        raise ValueError('模型没有填写所选空项，请重试。')
    if 'glucose' in specialist:
        try:
            comparison = await generate('Translate the supplied alternative event explanations into concise Chinese. '
                                 'Keep each alternative separate and do not add facts.', specialist['glucose'], 240)
            specialist['glucose'] = [comparison, *specialist['glucose']]
        except (ValueError, RuntimeError, HTTPError):
            notices.append('GLUCOSE 译文未完成，保留英文对照。')
    return {'candidates': candidates, 'specialists': specialist, 'notices': notices, 'usage': summarize_usage(calls)}


if __name__ == '__main__':
    print(json.dumps(_generate_specialist(sys.argv[1], sys.stdin.read()), ensure_ascii=False))
