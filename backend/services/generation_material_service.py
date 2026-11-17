"""One prepared writer request for both author preview and actual generation."""
from __future__ import annotations

WRITER_SYSTEM = '你是中文小说写作助手。只输出小说正文，不输出写作说明或摄影脚本。根据章节计划与作者共识写作；承接前文，保持人物与事实一致，必须遵守文风约束。只使用给定材料；缺少依据时不要自创关键事实。作者设定不代表人物已知信息，不要把未来秘密写成人物已知。每次写作都要从全局故事线、当前章节目标落实到场景：作者意图优先，先按作者确定的段落作用（推进、人物、伏笔、回收、转折或蓄势）选择细节，再把感知、动作或反应、随后变化连成因果。从选定角色的注意与处境出发，选择真正有作用的视觉、听觉或触觉素材，不罗列五感、不并列堆放景物、不随意跳视角；不能擅自把素材升格为新伏笔或新事实。保持空间和时间连续，让人物动机驱动动作、表情、沉默与对话。描写焦点可由远及近，再落到推动情绪或冲突的具体细节；用人物不说话时的细小动作与环境变化烘托情绪，细节有主次，不堆满感官。参考镜头、画面和布景需要转换成自然小说叙述，不照搬机位或剪辑术语；适量运用贴合文风的描写、结构和抒情技法，修辞服务情节而非堆砌。已确认的场景推演是作者采用的创作安排，不是既成事实。依照它把重要人物各自的打算写成互相牵动的行动与回应：一个人的行为应改变另一个人能够或愿意作出的选择，再由反应改变局势。沉默、退让和注意转移同样可以形成变化；空间、物件与环境要实际影响行动，而非均匀堆砌景物。保留每个角色的底线，情绪、神态随处境变化，不把人物参考图的定格表情写成恒定状态。让本场后果形成后场问题；所选技法按作者指定的作用位置服务铺势与转折，不擅自增加秘密、人物或规则。引用的写作工具仅作为约束，不额外生成一轮规划或自动检查。'

import copy
import hashlib
import json
import re

from services.context_pack_service import ContextPackService, MaterialBudgetError
from services.world_scope_service import WorldScopeService
from services.knowledge_graph_service import KnowledgeGraphService
from services.shared_material_service import SharedMaterialService, CHARACTER_PORTRAYAL_GUIDANCE
from services.writing_reference_service import WritingReferenceService
from services.story_planning_service import StoryPlanningService
from services.scene_rehearsal_service import SceneRehearsalService
from services.prose_strategy_service import prose_guidance, BASE_RULES
from services.character_detail_service import strip_author_only

ADDRESS_GUIDANCE = '遵守人物已保存的性别、代词、称呼说明和世界称谓通则；人物关系address_as表示当前人物如何称呼target，不能反用。不从外貌、ABO分类或性别推断亲属与称呼，未知时用姓名或保留未知。'
RUNTIME_META = {'chapter_status', 'technique_brief', 'technique_checklist', 'writing_scene', 'context_manifest', 'updated_at', 'chapter_id', 'canon_extraction_coverage'}


def source_version(store, project, source):
    path = store._safe_path(project, source)
    if source == 'cards/':
        rows = [(file.name, hashlib.sha256(file.read_bytes()).hexdigest()) for file in sorted(path.glob('*')) if file.suffix in {'.yaml', '.json'}]
        return 'inventory:' + hashlib.sha256(json.dumps(rows).encode()).hexdigest()
    if source.endswith('.meta.json'):
        value = store.read_json(project, source)
        value = {key: child for key, child in value.items() if key not in RUNTIME_META}
        return 'author-meta:' + hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return hashlib.sha256(path.read_bytes() if path.is_file() else b'').hexdigest()


class GenerationMaterialService:
    """No model calls: the saved request is exactly the one the writer receives."""
    def __init__(self, manager):
        self.manager, self.store = manager, manager.store

    @staticmethod
    def _hash(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

    def _path(self, fingerprint):
        if not re.fullmatch(r'[a-f0-9]{64}', str(fingerprint)):
            raise FileExistsError('材料核对编号无效，请重新核对。')
        return f'meta/generation_materials/{fingerprint}.json'

    def _effective(self, project, body):
        from services.writing_run_service import WritingRunService, chapter_controls
        unit = copy.deepcopy(body.get('writing_run') or WritingRunService(self.manager)._units(project, body)[0])
        chapter = unit['chapter_id']
        control = chapter_controls(self.store, project, body, chapter)
        focus = control.get('character_detail_focus') or {}
        if not isinstance(focus, dict) or any(not isinstance(ids, list) or any(not isinstance(sid, str) for sid in ids) for ids in focus.values()):
            raise ValueError('人物重点须按人物编号选择补充段编号列表。')
        expansions = control.get('material_expansions') or []
        if not isinstance(expansions, list) or len(expansions) > 100 or any(not isinstance(item, (dict, str)) for item in expansions):
            raise ValueError('每次请展开至多100个明确来源引用。')
        control.pop('material_preview_fingerprint', None)
        alignment = control.get('writing_alignment') or self.store.read_json(project, f'drafts/{chapter}.meta.json').get('writing_alignment') or {}
        alignment = {key: value for key, value in alignment.items() if key != 'updated_at'}
        control['writing_alignment'] = alignment
        if not control.get('scene_direction') and alignment.get('scene_direction'):
            control['scene_direction'] = alignment['scene_direction']
        plan = ((body.get('constraints') or {}).get('chapter_plan') if chapter == body['chapter_id'] else None) or unit.get('plan') or {}
        if not plan:
            for file in sorted(self.store._safe_path(project, 'cards').glob('*.yaml')):
                card = self.store.read_yaml(project, f'cards/{file.name}')
                if card.get('type') == 'story' and (not control.get('story_card_id') or control['story_card_id'] == card.get('id')):
                    plan = next((row for row in card.get('payload', {}).get('chapter_plan', []) if isinstance(row, dict) and (row.get('chapter_id') or row.get('chapter')) == chapter), {})
                    if plan:
                        break
        unit.setdefault('append', False)
        if unit.get('append'):
            unit.setdefault('append_base', self.store.read_md(project, f'drafts/{chapter}.md'))
        constraints = {**body.get('constraints', {}), 'chapter_plan': plan}
        effective = {**body, 'chapter_id': chapter, 'scene_index': unit['scene_index'], 'generation_control': control, 'constraints': constraints, 'writing_run': unit}
        _, blueprint, _ = self.manager._validate_write_payload(project, effective)
        if blueprint.get('derived_from_saved_scenes') and blueprint.get('story_card_id'):
            control.setdefault('story_card_id', blueprint['story_card_id'])
        return effective

    def _request_key(self, payload):
        return self._hash({key: payload.get(key) for key in ['chapter_id', 'blueprint_id', 'scene_index', 'llm_profile_id', 'constraints', 'generation_control']} | {
            'unit': {key: payload['writing_run'].get(key) for key in ['chapter_id', 'scene_index', 'beat_index', 'append', 'append_base', 'label']}})

    def _profile(self, project, payload):
        requested, profile, _ = self.manager._resolve_profile(project, payload, 'chapter_writer')
        window = next((profile.get(key) for key in ['context_window', 'context_window_tokens', 'max_context_tokens'] if isinstance(profile.get(key), int) and not isinstance(profile.get(key), bool) and profile[key] > 0), None)
        # Persist model identity only; credentials never enter a material snapshot.
        identity = {'profile_id': requested, **{key: profile.get(key) for key in ['provider', 'model', 'base_url']}, 'context_window': window}
        return identity, window

    def input_char_limit(self, project, payload, output_tokens, *, fallback=14000):
        constraints = payload.get('constraints') or {}
        if 'context_max_chars' in constraints:
            limit = constraints['context_max_chars']
            if isinstance(limit, bool) or not isinstance(limit, int) or not 4000 <= limit <= 100000:
                raise ValueError('本次取材范围必须在4000至100000字符之间。')
            return limit
        _, window = self._profile(project, payload)
        # Every character consumes at least one UTF-8 byte; exact message bytes are checked below.
        return max(0, min(100000, window - output_tokens - 128)) if window is not None else fallback

    def finish(self, project, payload, messages, report, *, max_chars, output_tokens):
        identity, window = self._profile(project, payload)
        control = payload.get('generation_control') or {}
        world = WorldScopeService(self.store)
        scope = report.get('author_scope', {}).get('scope', {})
        included = {item['id'] for item in report['items']}
        for cid, ids in (control.get('character_detail_focus') or {}).items():
            for sid in ids:
                if f'{cid}:detail:{sid}' not in included:
                    source = f'cards/{cid}.yaml#payload.detail_sections.@{sid}.content'
                    saved = self.store.read_yaml(project, f'cards/{cid}.yaml')
                    row = next((row for row in saved.get('payload', {}).get('detail_sections', []) if isinstance(row, dict) and row.get('id') == sid), None)
                    if row and row.get('usage') == 'author_only':
                        why = '该段仅作者查看，不可带入模型。'
                    elif not saved or not world.card_visible(project, saved, scope):
                        why = '该人物不适用当前世界、分支或故事时间。'
                    elif not row or row.get('removed'):
                        why = '该段已删除或不在当前阶段。'
                    elif not world.applies(project, row.get('scope'), scope)[0]:
                        why = '该段不适用当前世界、时期、地区或分支。'
                    else:
                        why = '该段不适用当前对象、关系或视角，或已被阶段记录移除。'
                    focus_label = f"{saved.get('title') or saved.get('payload', {}).get('name') or '人物'} · {row.get('title') or '已选重点'}" if saved and row else '一项已选人物重点'
                    missing = {'id': f'{cid}:detail:{sid}', 'label': focus_label, 'source': source, 'required': True, 'chars': 0,
                        'reason': why + '请核对或取消该重点后再生成。'}
                    report['overflow'].append(missing)
        used = sum(len(message['content']) for message in messages)
        estimate = sum(len(message['content'].encode('utf-8')) + 32 for message in messages) + 64
        warnings = ['输入单位为UTF-8字节保守上界估算，包含系统指令；不是供应商实测token。']
        if window is None:
            warnings.append(f'此模型未声明上下文上限，无法核验模型容量；当前只核对本次{max_chars}字符的取材范围。请在“模型与设置”填写模型上下文容量。')
        overflow = list(report.get('overflow') or [])
        reason = '估算输入加输出预留超过所配置的模型上下文上限。' if window is not None and estimate + output_tokens > window else '完整输入（含系统指令）超过本次字符范围。' if used > max_chars else ''
        if reason:
            overflow.extend({key: item[key] for key in ['id', 'label', 'source', 'required']} | {'chars': len(item['text']), 'reason': reason} for item in report.get('items', []) if item['required'])
            if not overflow:
                overflow.append({'id': 'request', 'label': '本次目标与系统指令', 'source': '', 'required': True, 'chars': used, 'reason': reason})
        merged = {}
        for item in overflow:
            key = (item['id'], item['source'])
            if key not in merged:
                merged[key] = dict(item)
            elif item['reason'] not in merged[key]['reason']:
                merged[key]['reason'] += ' ' + item['reason']
        overflow = list(merged.values())
        report.update(ready=not overflow, overflow=overflow, budget={'used_chars': used, 'max_chars': max_chars,
            'required_chars': report.get('required_chars', used) + (len(messages[0]['content']) if messages else 0), 'estimated_input_tokens': estimate, 'output_reserved_tokens': output_tokens,
            'model_context_tokens': window, 'context_limit_known': window is not None, 'estimated': True, 'warnings': warnings,
            'provider': identity['provider'], 'model': identity['model']})
        return report, identity

    def prepare(self, project, body):
        from services.change_suggestion_service import ChangeSuggestionService
        with ChangeSuggestionService(self.store).lock(project):
            return self._prepare(project, body)

    def _prepare(self, project, body):
        payload = self._effective(project, body)
        chapter, blueprint, index = self.manager._validate_write_payload(project, payload)
        control, constraints, unit = payload['generation_control'], payload['constraints'], payload['writing_run']
        tokens = constraints.get('max_tokens', 2400)
        if isinstance(tokens, bool) or not isinstance(tokens, int) or not 128 <= tokens <= 16000:
            raise ValueError('输出预留必须在128至16000之间。')
        limit = self.input_char_limit(project, payload, tokens)
        scene = copy.deepcopy(blueprint['scene_plan'][index])
        if unit.get('beat_index') is not None:
            scene['beats'] = [scene['beats'][unit['beat_index']]]
        else:
            scene['chapter_scenes'] = blueprint['scene_plan']
        world = WorldScopeService(self.store)
        resolved = world.resolve(project, chapter_id=chapter, story_card_id=control.get('story_card_id'), event_ref=control.get('scene_ref'),
            world_context=control.get('world_context'), branch_id=control.get('branch_id'), pov_character_id=control.get('pov_character_id'), pov=control.get('pov'))
        scope = resolved['scope']
        outline = self.store.read_yaml(project, 'cards/outline_001.yaml')
        selected = self.manager.technique_director.resolve_selected_bundle(project, chapter, outline, scene)
        no_techniques = control.get('include_techniques') is False
        technique = self.manager.technique_director.build(project, chapter, {'scene': scene, 'beats': outline.get('payload', {}).get('beats', [])},
            self.store.read_yaml(project, 'cards/style_001.yaml').get('payload', {}).get('style_guide', {}),
            [row for row in self.store.read_jsonl(project, 'canon/facts.jsonl') if world.fact_visible(project, row, scope)][-8:],
            [] if no_techniques else selected.get('selected_techniques', []), [] if no_techniques else selected.get('selected_categories', []))
        manifest = self.manager.context_engine.build_manifest(project, chapter, scene, constraints, technique, prepare_memory=False)
        manifest['author_scope'], manifest['generation_control'] = resolved, control
        manifest['linked_materials'] = KnowledgeGraphService(self.store).materials(project, chapter, scene, max_chars=min(12000, max(2000, tokens * 3)),
            include_references=not no_techniques, world_context=scope, story_card_id=control.get('story_card_id'), scene_ref=control.get('scene_ref'), branch_id=scope.get('branch_id'), pov_character_id=scope.get('pov_character_id'))
        cards = [*manifest.get('included_cards', []), *manifest['linked_materials'].get('cards', [])]
        worlds = [card.get('id') for card in cards if card.get('type') in {'world', 'world_rule', 'lore', 'worldview'}]
        shared = SharedMaterialService(self.store)
        manifest['address_rules'] = shared.address_rules(project, chapter, world_ids=worlds, world_context=scope) if control.get('include_cards') is not False else []
        manifest['world_baselines'] = shared.world_baselines(project, chapter, world_ids=worlds, world_context=scope) if control.get('include_cards') is not False else []
        manifest['event_context'] = KnowledgeGraphService(self.store).event_context(project, chapter, control.get('scene_ref'), control.get('story_card_id'), world_context=scope, branch_id=scope.get('branch_id'), pov_character_id=scope.get('pov_character_id')) if control.get('include_lines') is not False else {}
        manifest['writing_references'] = WritingReferenceService(self.store).collect(project, cards=cards, chapter_id=chapter, cast=scene.get('cast', []), story_card_id=control.get('story_card_id')) if not no_techniques else {'references': [], 'omitted': []}
        manifest['story_planning'] = StoryPlanningService(self.store).chapter_materials(project, chapter, story_card_id=control.get('story_card_id'), world_context=scope, scene_ref=control.get('scene_ref'))
        manifest['scene_rehearsals'] = SceneRehearsalService(self.store).writer_materials(project, chapter, story_card_id=control.get('story_card_id'), scene_ref=control.get('scene_ref'))
        if manifest['scene_rehearsals'].get('stale'):
            raise ValueError('本章场景推演依据已变化，请先重新确认。')
        direction = control.get('scene_direction') or {}
        requirements = {'本次范围': unit.get('label'), '写作方式': '只续写当前桥段，不重复已经写过的内容' if unit.get('append') else '完成当前章节的场景与目标',
            '章节计划': constraints.get('chapter_plan', {}), '作者共识': control.get('writing_alignment', {}), '叙述视角': resolved.get('narrative_pov') or '沿用作者已有叙述，人物知识不得超出本次材料。',
            '场景表达参考（可选，转成小说语言）': direction, '小说观察顺序': prose_guidance(direction), '场景': scene}
        if control.get('include_lines') is not False:
            requirements['故事要求'] = self.manager._story_targets_for_chapter(project, chapter, scope.get('story_card_id'))
        pack = manifest
        if control.get('include_cards') is False:
            pack = {**manifest, 'included_cards': [], 'linked_materials': {**manifest['linked_materials'], 'cards': []}, 'fixed_blocks': {**manifest['fixed_blocks'], 'style_guide': {}, 'style_locks': {}}}
        system = WRITER_SYSTEM + ADDRESS_GUIDANCE + CHARACTER_PORTRAYAL_GUIDANCE + BASE_RULES
        _, model_window = self._profile(project, payload)
        input_bytes = max(0, model_window - tokens - len(system.encode('utf-8')) - 128) if model_window is not None else None
        order = self.store.read_md(project, 'drafts/.chapter_order').splitlines()
        prior = order[order.index(chapter) - 1] if chapter in order and order.index(chapter) > 0 else None
        prompt, report = ContextPackService(self.store).build(project, chapter, pack, requirements,
            previous_end=self.store.read_md(project, f'drafts/{prior}.md') if prior else '', current_end=unit.get('append_base', '') if unit.get('append') else '',
            max_chars=max(2000, limit - len(system)), allow_overflow=True, max_input_bytes=input_bytes)
        messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}]
        # Base requirements/system are visible list entries too, rather than unreported hidden input.
        parsed = json.loads(prompt)
        base = {key: value for key, value in parsed.items() if key != '材料'}
        report['items'] = [{'id': 'writer_system', 'label': '小说写作与边界规则', 'reason': '实际系统指令', 'mode': 'full', 'required': True, 'text': system, 'source': '', 'material_id': '', 'type': '系统指令'},
            {'id': 'current_request', 'label': '当前目标、场景与作者要求', 'reason': '实际生成要求', 'mode': 'full', 'required': True, 'text': json.dumps(base, ensure_ascii=False, separators=(',', ':')), 'source': '', 'material_id': '', 'type': '本次要求'}, *report['items']]
        versions = report['source_versions']
        dependencies = {'project.yaml', 'cards/', f'cards/{payload["blueprint_id"]}.json', f'drafts/{chapter}.md', f'drafts/{chapter}.meta.json', 'drafts/.chapter_order',
            'canon/author_stages.jsonl', 'canon/facts.jsonl', 'canon/revisions.jsonl'}
        dependencies.update(blueprint.get('sources', []))
        if prior:
            dependencies.update({f'drafts/{prior}.md', f'drafts/{prior}.meta.json'})
        for source in dependencies | set(versions):
            versions[source] = source_version(self.store, project, source)
        report, identity = self.finish(project, payload, messages, report, max_chars=limit, output_tokens=tokens)
        public = {key: report[key] for key in ['ready', 'items', 'overflow', 'budget', 'source_versions']}
        public['scope'] = scope
        public['request_status'], public['sent'] = 'prepared', False
        public['unit'] = {key: unit.get(key) for key in ['chapter_id', 'scene_index', 'beat_index', 'label']}
        fingerprint = self._hash({'request': self._request_key(payload), 'profile': identity, 'messages': messages, 'sources': versions})
        public['fingerprint'] = fingerprint
        manifest['context_pack'] = report
        manifest['generation_materials'] = public
        record = {'public': public, 'messages': messages, 'manifest': strip_author_only(manifest), 'request_key': self._request_key(payload), 'profile': identity,
            'max_tokens': tokens, 'scene': strip_author_only(scene), 'unit': unit}
        self.store.write_json(project, self._path(fingerprint), record)
        return public

    def load(self, project, body, fingerprint=None):
        payload = self._effective(project, body)
        fingerprint = fingerprint or (body.get('generation_control') or {}).get('material_preview_fingerprint')
        if not fingerprint:
            fingerprint = self.prepare(project, body)['fingerprint']
        record = self.store.read_json(project, self._path(fingerprint))
        if not record or record.get('request_key') != self._request_key(payload) or record.get('profile') != self._profile(project, payload)[0]:
            raise FileExistsError('生成要求或模型配置已改变，请重新核对材料。')
        if not ContextPackService(self.store).sources_unchanged(project, record['public']['source_versions']):
            raise FileExistsError('材料来源已改变，请重新核对，原稿已保留。')
        if not record['public']['ready']:
            raise MaterialBudgetError(record['public'])
        return record
