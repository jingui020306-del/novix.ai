"""Project source passages into editable character-card sections, without saving proposals."""
import asyncio
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from time import perf_counter
from typing import Literal

from pydantic import BaseModel, Field

from services.author_control_service import AuthorControlService
from services.author_data_service import AuthorDataService
from services.character_detail_service import strip_author_only
from services.character_formation import parse_object
from services.token_usage import summarize_usage
from services.world_scope_service import entity_id

Layer = Literal['personal', 'social', 'core', 'extended', 'protected', 'fading', 'hidden']
LAYERS = {
    'personal': '个人自我：自身气质、习惯和选择，留意相反表现',
    'social': '社会自我：出身、社会位置、与具体人物长期相处时形成的角色和期待',
    'core': '核心自我：多次选择中显出的价值、欲望或底线',
    'extended': '核心／衍生自我：人物把哪些人、事业或事物视作自身的一部分',
    'protected': '核心／保护自我：人物珍视并试图保护的那一部分自己',
    'fading': '核心／消失自我：曾经表现出来、如今逐渐淡去的那一面',
    'hidden': '隐藏自我：人物难以承认、尚未表达或只对特定对象显露的一面',
}
ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / 'backend/rehearsal_engines/chiron/end_to_end_chiron_from_dataset.py'
CHIRON_LOCK = Lock()


class PortraitRequest(BaseModel):
    card: dict
    fields: list[Layer] = Field(min_length=1, max_length=7)
    material: str = Field(default='', max_length=12000)
    mode: Literal['direct', 'chiron', 'qwen'] = 'direct'
    llm_profile_id: str = Field(default='novix_local', min_length=1)
    story_card_id: str | None = Field(default=None, pattern=r'^[\w-]+$')


def source_passages(service, project, request):
    card = request.card
    cid = entity_id(card.get('id'), '人物')
    if card.get('type') != 'character' or not isinstance(card.get('payload'), dict):
        raise ValueError('请选择人物卡。')
    authors = AuthorDataService(service.store)
    scope = authors.world.resolve(project, story_card_id=request.story_card_id,
                                  world_context=card['payload'].get('world_context') or {})['scope']
    if not authors.world.card_visible(project, card, scope):
        raise ValueError('此人物不属于当前世界或分支。')
    active, _ = authors._active_stages(project, 'character', cid, scope)
    p, _ = authors._apply_changes(project, card['payload'], active)
    p = strip_author_only(p)
    rows = []

    def add(source, label, value):
        if isinstance(value, list):
            for item in value:
                add(source, label, item)
        if isinstance(value, str):
            for line in value.splitlines():
                for start in range(0, len(line), 480):
                    passage = line[start:start + 480].strip()
                    if passage:
                        rows.append({'source_id': source, 'label': label, 'quote': passage})

    for key, label in [('identity', '身份'), ('family_background', '成长经历'), ('core_motivation', '动机'),
                       ('personality_traits', '性格'), ('beliefs', '信念'), ('goal', '当前目标'), ('vulnerability', '软肋'), ('voice', '口吻'), ('boundaries', '底线')]:
        value = p.get(key)
        changed_at = next((stage for stage in reversed(active) if key in stage['changes'] and stage['changes'][key] == value), None)
        source = f'canon/author_stages.jsonl#{changed_at["id"]}/{key}' if changed_at else f'cards/{cid}#{key}'
        add(source, label, value)
    for row in p.get('detail_sections', []):
        if not row.get('id') or row['id'].startswith('self_') or not authors.world.applies(project, row.get('scope'), scope)[0]:
            continue
        stage = next((stage for stage in reversed(active) if any(item.get('id') == row['id'] and
                      item.get('content') == row.get('content') for item in stage['changes'].get('detail_sections', []))), None)
        origin = f'canon/author_stages.jsonl#{stage["id"]}/{row["id"]}' if stage else f'cards/{cid}#{row["id"]}'
        add(origin, row.get('title', '经历'), row.get('content'))
    for rel in authors.relationships_at(project, scope):
        state = strip_author_only(rel['state'])
        people = state.get('participants', [])
        if not any(person['entity_id'] == cid for person in people):
            continue
        members = [service.store.read_yaml(project, f'cards/{entity_id(person["entity_id"])}.yaml') for person in people]
        if members and all(member and authors.world.card_visible(project, member, scope) for member in members):
            label = '、'.join(member['title'] for member in members) + ' · ' + state['label']
            add('relationship/' + rel['id'], label, state.get('notes') or state['label'])
    add('author_input', '本次原文', request.material)
    if not rows:
        raise ValueError('请贴入人物原文，或先填写人物经历。')
    if sum(len(row['quote']) + len(row['label']) + 20 for row in rows) > 12500 or len(rows) > 160:
        raise ValueError('材料超出单次人物分析范围，请分段分析或缩短材料。')
    applied_scope = {k: scope[k] for k in ('world_id', 'story_card_id', 'period_id', 'region_ids', 'time', 'event_ref')
                     if scope.get(k)}
    if scope.get('world_id'):
        applied_scope['branch_id'] = scope.get('branch_id') or 'main'
    sections = {row['id']: row for row in card['payload'].get('detail_sections', []) if row.get('id')}
    scope_key = hashlib.sha256(json.dumps(applied_scope, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    targets = {}
    for layer in request.fields:
        base = 'self_' + layer
        scoped = base + '_' + scope_key
        if scoped in sections or base in sections and (sections[base].get('scope') or {}) != applied_scope:
            targets[layer] = scoped
        else:
            targets[layer] = base
    controls = AuthorControlService(service.store).get(project, f'cards/{cid}.yaml')
    for key in request.fields:
        pointer = '/payload/detail_sections/@' + targets[key]
        if any(path == '/' or path == pointer or pointer.startswith(path + '/') or path.startswith(pointer + '/')
               for lock in controls['locks'] for path in lock['paths']):
            raise ValueError(f'「{LAYERS[key].split("：")[0]}」已锁定。')
    return rows, applied_scope, targets


def official_claims(name, passages):
    home = Path(os.environ.get('NOVIX_CHIRON_HOME', ROOT / 'models/chiron')).resolve()
    python = Path(os.environ.get('NOVIX_CHIRON_PYTHON', home / 'env/bin/python'))
    if not python.is_file():
        raise ValueError('尚未安装 CHIRON。请运行 bash scripts/setup_chiron.sh，或取消原文核验。')
    with CHIRON_LOCK, TemporaryDirectory(prefix='novix-chiron-') as tmp:
        work = Path(tmp)
        snippets = [[row['quote'], row['quote']] for row in passages]
        (work / 'input.jsonl').write_text(json.dumps({'story_id': 'novix', 'character': name, 'snippets': snippets},
                                                    ensure_ascii=False) + '\n', encoding='utf-8')
        env = {**os.environ, 'HF_HUB_CACHE': str(home), 'HUGGINGFACE_HUB_CACHE': str(home),
               'TRANSFORMERS_CACHE': str(home), 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
               'PYTHONNOUSERSITE': '1'}
        env.pop('PYTHONPATH', None)
        try:
            with (work / 'run.log').open('w') as log:
                result = subprocess.run([str(python), str(RUNNER), '--stories-fname', 'input.jsonl',
                                         '--generation-checkpoint-name', 'mistralai/Mistral-7B-Instruct-v0.2',
                                         '--dataset-name', 'novix', '--output-dir', 'sheets', '--dont-get-statistics',
                                         '--max-snippets-per-story', str(len(snippets))], cwd=work, env=env,
                                        stdout=log, stderr=subprocess.STDOUT, timeout=14400)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('CHIRON 超时，请缩小材料范围后重试。') from exc
        sheet = next((work / 'sheets').glob('*_postfilteringdedup.txt'), None)
        if result.returncode or not sheet:
            raise ValueError('CHIRON 未完成核验，请检查 CUDA、可用显存和两份权重。')
        claims = {}
        index = None
        for line in sheet.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            marker = re.fullmatch(r'<snippet (\d+)>', line)
            if marker:
                index = int(marker[1])
            elif not line or line.startswith('Question:') or not line.strip('-'):
                index = None
            elif index is not None and 0 <= index < len(passages):
                claims.setdefault(index, []).append(line)
        return claims


async def propose_portrait(service, project, request):
    rows, scope, targets = source_passages(service, project, request)
    name = str(request.card['payload'].get('name') or request.card.get('title') or '').strip()
    if not name:
        raise ValueError('请填写用于辨认原文的姓名或称谓。')
    fields = list(dict.fromkeys(request.fields))
    started = perf_counter()
    claims = await asyncio.to_thread(official_claims, name, rows) if request.mode == 'chiron' else None
    verification_ms = round((perf_counter() - started) * 1000) if claims is not None else 0
    material = {f'S{i+1}': row for i, row in enumerate(rows) if claims is None or claims.get(i)}
    calls = []
    result = {'mode': request.mode, 'llm_profile_id': request.llm_profile_id, 'scope': scope,
              'candidates': [], 'empty': [], 'failed': [], 'usage': summarize_usage(calls),
              'verification_ms': verification_ms, 'generation_ms': 0, 'generation_calls': 0}
    if not material:
        return {**result, 'empty': fields}
    text = {'type': 'string'}
    item = {'type': 'object', 'properties': {
        'content': {'type': 'string', 'minLength': 1, 'maxLength': 100}, 'situation': text, 'response': text,
        'references': {'type': 'array', 'items': {'type': 'string', 'enum': list(material)}, 'minItems': 1, 'maxItems': 4}},
        'required': ['content', 'situation', 'response', 'references'], 'additionalProperties': False}
    layer_value = {'anyOf': [item, {'type': 'null'}]}
    schema = {'type': 'object', 'properties': dict.fromkeys(fields, layer_value),
              'required': fields, 'additionalProperties': False}
    evidence = {}
    for ref, row in material.items():
        evidence[ref] = [row['label'], row['quote']]
        if claims is not None:
            evidence[ref].extend(claims[int(ref[1:]) - 1])
    if sum(len(s) for values in evidence.values() for s in values) > 12500:
        raise ValueError('核验材料超出单次分析范围，请分段分析。')
    prompt = {'人物': name, '分析角度': {key: LAYERS[key] for key in fields}, '原文材料': evidence,
              '输出格式示例（每个所选角度一项）': {
                  fields[0]: {'content': '有依据的一句人物解读', 'situation': '', 'response': '',
                              'references': [next(iter(material))]}}}
    started = perf_counter()
    answer = await service.complete(project, {'llm_profile_id': request.llm_profile_id, 'require_configured_profile': True},
        'setup_character',
        '仅输出 JSON 对象。以分析角度给出的英文键为顶层键，每个键的值含 content、situation、response 字符串和 references 数组。'
        '针对每个角度各写一句中文人物理解，六十字内。以“可能”表达推测。区分谁说、谁做、谁知道，考虑成长环境、持续关系、重复及反例。'
        '单凭关系称谓不能推断性格；不得断言未写明的想法、归属或他人态度，不从单次经历断定性格，不续写。'
        'references 只填原文材料已有的 S 编号。每条判断至少列出一个编号。没有依据的角度直接填 null。'
        'situation 和 response 可留空，只有原文描述过的具体处境和可见行动才填。',
        json.dumps(prompt, ensure_ascii=False), max_tokens=300 * len(fields) + 32, prepare_memory=False,
        usage_callback=calls.append, response_schema=schema)
    result.update(usage=summarize_usage(calls), generation_calls=len(calls),
                  generation_ms=round((perf_counter() - started) * 1000))
    values = parse_object(answer)
    for layer in fields:
        value = values.get(layer)
        if layer in values and value is None:
            result['empty'].append(layer)
            continue
        if not isinstance(value, dict) or not all(isinstance(value.get(k), str) for k in ('content', 'situation', 'response')):
            result['failed'].append(layer)
            continue
        references = value.get('references')
        content = value['content'].strip()
        if (not isinstance(references, list) or len(references) > 4 or len(content) > 100
                or not all(isinstance(ref, str) and ref in material for ref in references)
                or bool(content) != bool(references)
                or (not content and (value['situation'].strip() or value['response'].strip()))):
            result['failed'].append(layer)
            continue
        if not content:
            result['empty'].append(layer)
            continue
        sources = []
        for ref in dict.fromkeys(references):
            source = dict(material[ref], kind='portrait_evidence')
            if claims is not None:
                source['chiron_claims'] = claims[int(ref[1:]) - 1]
            sources.append(source)
        result['candidates'].append({'layer': layer, 'section_id': targets[layer], 'content': content,
            'situation': value['situation'].strip()[:120], 'response': value['response'].strip()[:120],
            'sources': sources})
    return result
