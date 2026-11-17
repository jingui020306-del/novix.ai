from __future__ import annotations

import json
import hashlib

from services.writing_reference_service import WritingReferenceService
from services.world_scope_service import WorldScopeService
from services.author_data_service import AuthorDataService, STAGES_PATH
from services.information_service import InformationService, REGISTRY_PATH
from services.suspense_service import SuspenseService
from services.character_detail_service import strip_author_only, select_character_details
from services.material_reference_service import MaterialReferenceService, references as source_references, paragraph_references, effective_provenance


class MaterialBudgetError(ValueError):
    def __init__(self, report):
        self.report = report
        names = '、'.join(item['label'] for item in report.get('overflow', [])[:6])
        super().__init__('必用材料无法完整放入本次范围，请调整预算或拆分：' + names)


class ContextPackService:
    """One bounded request, with each saved source represented once."""

    def __init__(self, store):
        self.store = store

    @staticmethod
    def _json(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

    def build(self, project_id, chapter_id, manifest, requirements, *, previous_end='', current_end='', max_chars=14000, allow_overflow=False, max_input_bytes=None):
        from services.change_suggestion_service import ChangeSuggestionService
        with ChangeSuggestionService(self.store).lock(project_id):
            return self._build(project_id, chapter_id, manifest, requirements, previous_end=previous_end, current_end=current_end, max_chars=max_chars, allow_overflow=allow_overflow, max_input_bytes=max_input_bytes)

    def _build(self, project_id, chapter_id, manifest, requirements, *, previous_end='', current_end='', max_chars=14000, allow_overflow=False, max_input_bytes=None):
        if not 2000 <= max_chars <= 100000:
            raise ValueError('取材范围必须在 2000 至 100000 字符之间。')
        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
        visible = set(order[:order.index(chapter_id) + 1]) if chapter_id in order else {chapter_id}
        future = set(order) - visible
        scope_service = WorldScopeService(self.store)
        control = manifest.get('generation_control') or {}
        supplied = manifest.get('author_scope')
        resolved = supplied if isinstance(supplied, dict) and 'scope' in supplied else scope_service.resolve(
            project_id, chapter_id=chapter_id, story_card_id=control.get('story_card_id') or manifest.get('story_planning', {}).get('story_card_id'),
            event_ref=control.get('scene_ref'), branch_id=control.get('branch_id'), pov_character_id=control.get('pov_character_id'),
            world_context=control.get('world_context') or requirements.get('场景', {}).get('world_context'), pov=control.get('pov'))
        scope = resolved['scope']
        requirements = strip_author_only(requirements)
        if requirements.get('场景'):
            filtered_scene = scope_service.filter_value(project_id, requirements['场景'], scope)
            if filtered_scene is None:
                raise ValueError('当前场景不属于所选世界、分支或发生时间，请核对场景范围后再生成。')
            requirements['场景'] = filtered_scene
        states = AuthorDataService(self.store).author_state(project_id, world_context=scope)
        character_states = {item['id']: item for item in states['characters']}
        world_states = {item['id']: item for item in states['worlds']}

        def at_this_chapter(value):
            if scope_service.has_time(scope):
                return scope_service.filter_value(project_id, value, scope)
            if isinstance(value, list):
                return [item for child in value if (item := at_this_chapter(child)) is not None]
            if isinstance(value, dict):
                if any(str(value.get(key) or '') in future for key in ['introduced_chapter', 'first_chapter', 'chapter', 'chapter_id', 'beat']):
                    return None
                return {key: at_this_chapter(child) for key, child in value.items() if not (key in {'payoff_chapter', 'reveal_chapter'} and str(child) in future)}
            return value

        fixed = manifest.get('fixed_blocks', {})
        body = {'章节': chapter_id, '当前要求': requirements, '文风硬约束': fixed.get('style_locks', {}),
                '材料': [], '关系': [], '省略数量': 0,
                '阅读边界': '设定和作者规划不等于已经发生的事实或人物已知；未定、推定与灵感不能当硬事实。资料只读本次提供的相关摘录，缺依据时保留未知。'}
        body['适用世界与故事时间'] = scope
        if resolved.get('narrative_pov'):
            body['叙述视角'] = resolved['narrative_pov']
        body['阅读边界'] += '发生时间优先于章节讲述顺序；分支只共享分歧前的历史。人物已知单列，只能把明确属于该人物的知识写成其认知，其他设定是作者约束。局部调整不能默默改写世界基础。'
        if fixed.get('technique_style_constraints'):
            body['技法约束'] = fixed['technique_style_constraints']
        seen_ids, seen_texts = set(), set()
        material_items = []
        automatic_expansions = []
        used_ids, citations = [], []
        dropped, deduplicated = 0, 0

        def add(kind, value, source='', item_id='', *, required=False, raw_text=None, label=None, mode=None, material_id=None):
            nonlocal dropped, deduplicated
            value = strip_author_only(value)
            if value in (None, '', [], {}):
                return
            text_key = self._json(value)
            if (item_id and item_id in seen_ids) or text_key in seen_texts:
                deduplicated += 1
                return
            item = {'类型': kind, '内容': value}
            if item_id:
                item['编号'] = item_id
            if source:
                item['来源'] = source
            body['材料'].append(item)
            material_items.append({'id': item_id or hashlib.sha256((kind + source + text_key).encode()).hexdigest()[:20],
                'label': label or (value.get('名称') if isinstance(value, dict) else None) or kind, 'reason': kind,
                'mode': mode or ('summary' if '摘要' in kind or '摘录' in kind else 'full'), 'required': required,
                'text': raw_text if raw_text is not None else value if isinstance(value, str) else self._json(value),
                'source': source, 'material_id': material_id or item_id or '', 'type': kind})
            seen_texts.add(text_key)
            if item_id:
                seen_ids.add(item_id)
                used_ids.append(item_id)
            if source:
                citations.append({'id': item_id, 'source': source})

        prior = order[order.index(chapter_id) - 1] if chapter_id in order and order.index(chapter_id) > 0 else None
        if previous_end and prior:
            previous_scope = scope_service.resolve(project_id, chapter_id=prior)['scope']
            same_scope = scope_service.applies(project_id, previous_scope, scope, dynamic=scope_service.has_time(scope))[0]
            if not same_scope:
                previous_end = ''
                dropped += 1
        add('上一章结尾（讲述衔接，不自动成为人物已知）', previous_end[-1800:])
        add('本章已写结尾', current_end[-3500:], required=bool(current_end))
        add('文风要求', fixed.get('style_guide', {}), 'cards/style_001.yaml', 'style_001', required=True)
        rehearsals = manifest.get('scene_rehearsals', {})
        rehearsal_dependencies = {STAGES_PATH, 'drafts/.chapter_order'}
        story = scope.get('story_card_id')
        suspense_ids = set()
        reader_offset = manifest.get('reader_offset', len(current_end))
        if story:
            suspense = SuspenseService(self.store).chapter_context(
                project_id, story, chapter_id, scope.get('branch_id'), reader_offset=reader_offset)
            rehearsal_dependencies.update(suspense['sources'])
            suspense_ids.update(suspense['information_ids'])
            if suspense['items'] and control.get('include_lines') is not False:
                add('悬念安排与读者已见原文', suspense['items'], item_id='suspense_context', required=True)
                body['阅读边界'] += '悬念引文只表示读者已见，不代表人物知情。setup 提出疑问，response 回应已有线索；谜底未获本章授权时保留未知。'
        info = InformationService(self.store)
        protected_facts = {row['fact_ref'] for row in info.list(project_id)
                           if row['id'] in suspense_ids and row.get('fact_ref')} if suspense_ids else set()
        info_limit = 4000 if 'reader_offset' in manifest else min(5000, max_chars // 3)
        information = info.materials(project_id, scope, actor_ids=requirements.get('场景', {}).get('cast', []),
            max_chars=info_limit, suspense_ids=suspense_ids, reader_chapter_id=chapter_id, reader_offset=reader_offset)
        if information.get('omitted_count'):
            raise ValueError('本场关键的信息边界超过取材预算，请减少关联信息或扩大本次范围，不能静默丢弃认知限制。')
        for source in information.get('sources', []):
            rehearsal_dependencies.add(source)
        if information.get('items'):
            add('人物信息边界与读者展示（表达和相信不是真相）', information, STAGES_PATH, 'information_context', required=True)
        for source in resolved.get('sources', []):
            if source.startswith(('cards/', 'drafts/')):
                rehearsal_dependencies.add(source.split('#', 1)[0])
        rehearsal_ids = []
        scene_technique_ids = []
        include_scene_techniques = manifest.get('generation_control', {}).get('include_techniques') is not False
        for item in rehearsals.get('items', []):
            if item.get('confirmed') is not True or item.get('stale'):
                continue
            value = {key: item[key] for key in ['title', 'text', 'outcome', 'next_question', 'technique_applications'] if item.get(key)}
            if item.get('local_values'):
                value['本表章节编排与备注'] = {'内容': item['local_values'], '来源': item.get('projection_source', '')}
            if not include_scene_techniques:
                value.pop('technique_applications', None)
            before = len(body['材料'])
            add('作者确认的场景安排', value, item.get('source', ''), item.get('id', ''), required=True)
            if len(body['材料']) > before:
                rehearsal_ids.append(item.get('id'))
                rehearsal_dependencies.update(item.get('source_versions', {}))
                if include_scene_techniques:
                    scene_technique_ids.extend(item.get('technique_ids', []))
        if scene_technique_ids:
            selected = WritingReferenceService(self.store).collect(project_id, reference_ids=scene_technique_ids, include_global=False, max_chars=max_chars)
            if selected.get('omitted_count'):
                raise ValueError('本场选用的技法无法完整取用，请核对技法或缩小本次范围后再生成。')
            for item in selected['references']:
                add('作者确认的场景技法', {'名称': item['title'], '内容': item['payload']}, item['source'], item['id'], required=True)
        linked = manifest.get('linked_materials', {})
        event_context = manifest.get('event_context', {})
        if event_context:
            stage = {key: value for key, value in event_context.items() if key not in {'source_versions', 'sources', 'facts', 'max_chars', 'used_chars'}}
            add('事件阶段（进入本场前与本场计划目标）', stage, (event_context.get('event_order') or {}).get('source', ''), 'event_context:' + str(event_context.get('scene_ref') or 'unknown'), required=bool(event_context.get('scene_ref')))
            rehearsal_dependencies.update(event_context.get('source_versions', {}))
        address_rules = manifest.get('address_rules', [])
        for rule in address_rules:
            source_card = self.store.read_yaml(project_id, rule['source'].split('#', 1)[0])
            if not scope_service.card_visible(project_id, source_card, scope) or scope.get('world_id') and rule['card_id'] not in world_states:
                continue
            add('世界称谓通则', {'世界': rule['label'], '规则': rule['text']}, rule['source'], rule['id'], required=True)
        rule_cards = {rule['card_id'] for rule in address_rules}
        world_baselines = manifest.get('world_baselines', [])
        for base in world_baselines:
            source_card = self.store.read_yaml(project_id, base['source'].split('#', 1)[0])
            if not scope_service.card_visible(project_id, source_card, scope) or scope.get('world_id') and base['card_id'] not in world_states:
                continue
            add('世界参照与作者改动（非真实历史预测）', {'世界': base['label'], '基础': base['value']}, base['source'], base['id'], required=True)
        base_cards = {base['card_id'] for base in world_baselines}
        cast = set(requirements.get('场景', {}).get('cast', []))
        cards = [*linked.get('cards', []), *manifest.get('included_cards', [])]
        for cid in (control.get('character_detail_focus') or {}):
            if cid in character_states:
                cards.append(character_states[cid]['base'])
        def has_hard_rules(card_type, payload):
            explicit = card_type == 'world_rule' or payload.get('entry_type') == 'rule' or bool(payload.get('required') or payload.get('hard_constraint')) or any(payload.get(key) for key in ['rules', 'requirements', 'limits', 'costs', 'conditions', 'exceptions'])
            mixed = card_type in {'world', 'worldview', 'lore'} and any(marker in str(payload.get(field) or '') for field in ['content', 'description'] for marker in ['规则', '必须', '不得', '禁止', '条件：', '例外：'])
            return explicit or mixed

        if control.get('include_cards') is not False:
            cards.extend(item['base'] for item in world_states.values() if has_hard_rules(item['base'].get('type'), item['state']))
        seen_cards = set()
        for card in cards:
            cid = card.get('id')
            if not cid or card.get('type') not in {'character', 'world', 'world_rule', 'worldview', 'lore', 'style'}:
                continue
            if cid in seen_cards:
                deduplicated += 1
                continue
            seen_cards.add(cid)
            saved_card = self.store.read_yaml(project_id, f'cards/{cid}.yaml')
            if saved_card:
                card = {**saved_card, 'source': card.get('source') or f'cards/{cid}.yaml'}
            if not scope_service.card_visible(project_id, card, scope):
                dropped += 1
                continue
            if card.get('type') in {'world', 'world_rule', 'worldview', 'lore'} and scope.get('world_id') and cid not in world_states:
                dropped += 1
                continue
            effective = character_states.get(cid) or world_states.get(cid)
            if effective:
                card = {**card, 'payload': effective['state']}
            payload = at_this_chapter(strip_author_only(card.get('payload', {})))
            payload = scope_service.filter_value(project_id, payload, scope)
            from services.world_map_material_service import filter_map_scope
            payload = filter_map_scope(self.store, project_id, payload, scope)
            if not isinstance(payload, dict) or payload.get('canon_status') in {'hypothesis', 'inspiration'} or payload.get('setting_status') == 'unset' or payload.get('confirmation_status') in {'pending', 'pending_author_review'}:
                continue
            if payload.get('setting_status') == 'not_applicable':
                payload = {'适用性': '作者明确不采用此设定，不得据此添加能力或事件。', 'summary': payload.get('summary', '')}
            else:
                payload = {key: value for key, value in payload.items() if key not in {'writing_references', 'links', 'map_url', 'versions', 'content', 'description', 'updated_at', 'created_at', 'sources', 'source_origin', 'import_source_keys', 'field_provenance'}}
                if card.get('type') == 'character':
                    focused = (control.get('character_detail_focus') or {}).get(cid, [])
                    selection_scene = {**requirements.get('场景', {}), '本次作者要求': {key: requirements[key] for key in ['作者共识', '作者试写要求', '场景表达参考（可选，转成小说语言）'] if key in requirements}}
                    sections = select_character_details(self.store, project_id, {**card, 'payload': payload}, scope, selection_scene, focus_ids=focused)
                    payload.pop('detail_sections', None)
                    for section in sections:
                        full = section['id'] in focused or section.get('usage') == 'focus' or section.get('expanded_for_task')
                        add('作者重点人物原文' if full else '相关人物表现参考',
                            {'人物': cid, '标题': section['title'], '正文': section['content'], **{key: section[key] for key in ['scope', 'target_ids', 'relationship_ids', 'situation', 'portrayal'] if section.get(key)}},
                            f"cards/{cid}.yaml#payload.detail_sections.@{section['id']}.content", f"{cid}:detail:{section['id']}",
                            required=full, raw_text=section['content'], label=f"{card.get('title') or cid} · {section['title']}", material_id=cid, mode=section.get('material_mode', 'full'))
                        if material_items and material_items[-1]['id'] == f"{cid}:detail:{section['id']}":
                            material_items[-1]['reason'] = section['selection_reason']
                            material_items[-1]['references'] = [{'label': '查看完整人物段', 'source': f"cards/{cid}.yaml#payload.detail_sections.@{section['id']}.content", 'material_id': cid}]
                            if full:
                                material_items[-1]['references'] += source_references(section['content'])
                                for ref in material_items[-1]['references'][1:]:
                                    path = ref['source'].split('#', 1)[0]
                                    if '/' not in path:
                                        path = f'cards/{path}.yaml'
                                    if self.store._safe_path(project_id, path).is_file():
                                        automatic_expansions.append({**ref, 'follow_refs': True, 'automatic': True})
                            effective_provenance(material_items[-1], effective, field='detail_sections', section_id=section['id'], scope=scope)
                    if payload.get('arc'):
                        payload['成长安排（未定位事件，不当作此时状态）'] = payload.pop('arc')
                    if event_context.get('scene_ref'):
                        payload.pop('relationships', None)
                original = card.get('payload', {})
                for field in ['content', 'description']:
                    detail = original.get(field)
                    if not isinstance(detail, str) or not detail:
                        continue
                    full = card.get('type') in {'world', 'world_rule', 'worldview', 'lore'} and has_hard_rules(card.get('type'), original)
                    if full:
                        add('适用世界原文（规则、条件和例外完整）', detail, f'cards/{cid}.yaml#payload.{field}', f'{cid}:{field}',
                            required=True, raw_text=detail, label=card.get('title') or cid, material_id=cid)
                        if material_items and material_items[-1]['id'] == f'{cid}:{field}':
                            effective_provenance(material_items[-1], effective, field=field, scope=scope)
                    else:
                        payload['原文摘要'] = original.get('summary') or original.get('identity') or '原文未带入，可按稳定引用展开。'
                        payload['摘要说明'] = '这是摘要，详细原文可沿稳定引用按需展开。'
                if isinstance(payload.get('extra_context'), dict):
                    payload['extra_context'] = {key: value for key, value in payload['extra_context'].items() if key != 'map_url' and not (key == 'address_rules' and cid in rule_cards or key == 'world_base' and cid in base_cards)}
            value = {'名称': card.get('title', ''), '设定': payload}
            kind = '人物设定' if card.get('type') == 'character' else '已保存设定'
            must_keep = cid in cast or has_hard_rules(card.get('type'), card.get('payload', {}))
            add(kind, value, card.get('source') or f'cards/{cid}.yaml', cid, required=must_keep)
            if material_items and material_items[-1]['id'] == cid:
                material_items[-1]['references'] = [{'label': f'展开{field}原文', 'source': f'cards/{cid}.yaml#payload.{field}', 'material_id': cid} for field in ['content', 'description'] if isinstance(card.get('payload', {}).get(field), str) and card['payload'][field]]
                for field in ['content', 'description']:
                    if isinstance(card.get('payload', {}).get(field), str):
                        material_items[-1]['references'] += paragraph_references(card['payload'][field], f'cards/{cid}.yaml#payload.{field}', cid)
                effective_provenance(material_items[-1], effective, scope=scope)

        for fact in event_context.get('facts', []) if event_context.get('scene_ref') else linked.get('facts', []):
            if fact.get('record', fact).get('id') in protected_facts:
                continue
            value = fact if event_context.get('scene_ref') else at_this_chapter(fact)
            if not scope_service.fact_visible(project_id, fact.get('record', fact), scope):
                dropped += 1
                continue
            if fact.get('confirmed') is not False and value is not None:
                add('原文支持的事实', value, fact.get('source', ''), fact.get('id', ''))
        for cid in sorted(cast | ({scope['pov_character_id']} if scope.get('pov_character_id') else set())):
            character = character_states.get(cid)
            if not character:
                continue
            pov = scope.get('pov_character_id')
            if character['knowledge'] and (not pov or cid == pov):
                add('此人物的信息状态（知道、相信与怀疑分开，不能转给他人）', {'人物': cid, '认知及原阶段依据': character['knowledge']}, STAGES_PATH, f'knowledge:{cid}', required=cid == pov)
            if character['age'].get('value') is not None:
                add('人物此时年龄（有明确依据）', {'人物': cid, **character['age']}, f'cards/{cid}.yaml', f'age:{cid}')
        selected_entities = set(character_states) & (cast | seen_ids)
        for relation in states['relations']:
            if not any(item['entity_id'] in selected_entities for item in relation['participants']):
                continue
            add('共享关系（称呼有明确发出人与对象）', {'id': relation['id'], **relation['state']}, relation['sources'][-1]['path'], relation['id'], label=relation['state'].get('label') or '人物关系')
            if material_items and material_items[-1]['id'] == relation['id']:
                material_items[-1].update(material_type='relationship', material_id=relation['id'])
                if relation.get('stages') and not relation.get('uncertainties'):
                    stage_id = relation['stages'][-1]['id']
                    material_items[-1].update(source=f'{STAGES_PATH}#{stage_id}', stage_id=stage_id, source_record_id=stage_id)
        planning = manifest.get('story_planning', {})
        event_order = event_context.get('event_order') or {}
        event_owner = event_order.get('owner_card_id')
        allowed_scenes = None
        if event_owner:
            events = self.store.read_yaml(project_id, f'cards/{event_owner}.yaml').get('payload', {}).get('important_scenes', [])
            allowed_scenes = {row.get('id') for row in events[:event_order['before_index'] + 1] if isinstance(row, dict)}
        for item in planning.get('related_rows', []):
            # The confirmed scene arrangement has its own version-checked material.
            row = {key: value for key, value in item.get('values', {}).items() if key != 'rehearsal'}
            row = scope_service.filter_value(project_id, row, scope)
            if row is None:
                dropped += 1
                continue
            if item.get('projection_source'):
                rehearsal_dependencies.add(item['projection_source'].split('#', 1)[0])
                row['本表编排来源'] = item['projection_source']
            if allowed_scenes is not None and item.get('source', '').startswith(f'cards/{event_owner}.yaml#'):
                anchor = row.get('id') if item.get('table') == 'important_scenes' else row.get('scene_id')
                if anchor and anchor not in allowed_scenes:
                    dropped += 1
                    continue
            row_id = str(row.get('id') or '')
            add('作者规划（不是已发生事实）', row, item.get('source', ''), f'plan:{row_id}' if row_id else '', label=str(row.get('scene') or row.get('title') or row.get('beat') or row.get('goal') or '相关情节规划'))
        for item in planning.get('beat_summary', []):
            row_id = str(item.get('id') or '')
            add('整书节拍（结构参考，不能提前揭示）', {key: value for key, value in item.items() if key not in {'source', 'id'}}, item.get('source', ''), f'plan:{row_id}' if row_id else '')
        for item in planning.get('future_plans', []):
            add('未来作者计划（单列结构参考，不是已发生或人物已知）', {key: value for key, value in item.items() if key != 'source'}, item.get('source', ''), f"future:{item.get('id') or ''}")
        references = manifest.get('writing_references', {})
        for item in references.get('references', []):
            add('选用写作参考（不是作品事实）', {'名称': item.get('title', ''), '内容': item.get('payload', {})}, item.get('source', ''), item.get('id', ''))
        # Category recommendations may not appear among explicitly pinned references.
        for item in fixed.get('technique_checklist', []):
            tid = item.get('technique_id')
            if tid and tid not in seen_ids:
                add('本章技法要求', item, f'cards/{tid}.yaml', tid)
        for item in linked.get('summaries', []):
            if item.get('chapter_id') in visible and item.get('chapter_id') != chapter_id:
                add('过去章节摘要', item.get('summary', ''), item.get('source', ''), item.get('chapter_id', ''))
        for item in manifest.get('evidence', []):
            source = item.get('source', {})
            if str(source.get('path') or '').startswith('assets/') and not source.get('card_id'):
                # Raw imports lack formal world/time/knowledge applicability; author browsing remains available.
                continue
            source_path = str(source.get('path') or '').split('#', 1)[0]
            if source_path in {'canon/facts.jsonl', 'canon/revisions.jsonl', STAGES_PATH, REGISTRY_PATH}:
                continue
            card_path = f"cards/{source['card_id']}.yaml" if source.get('card_id') else source_path
            if card_path.startswith('cards/') and card_path.endswith('.yaml'):
                source_card = self.store.read_yaml(project_id, card_path)
                if source_card.get('type') == 'story' and any(source_card.get('payload', {}).get(key) for key in ('hidden_line', 'foreshadowings')):
                    continue
                if not scope_service.card_visible(project_id, source_card, scope):
                    continue
                if strip_author_only(source_card.get('payload', {})) != source_card.get('payload', {}):
                    continue
            if source.get('chapter_id') and scope_service.has_time(scope):
                excerpt_scope = scope_service.resolve(project_id, chapter_id=source['chapter_id'])['scope']
                if not scope_service.applies(project_id, excerpt_scope, scope, dynamic=True)[0]:
                    continue
            if source.get('chapter_id') and source['chapter_id'] not in visible:
                continue
            card_id = source.get('card_id')
            if event_context.get('scene_ref') and source.get('path') == 'canon/facts.jsonl':
                continue
            if card_id and card_id in seen_ids:
                deduplicated += 1
                continue
            excerpt = item.get('text', '')
            for rule in address_rules:
                if rule['text'] in excerpt:
                    excerpt = excerpt.replace(rule['text'], '（称谓通则见专用项）')
                    deduplicated += 1
            for base in world_baselines:
                for representation in [str(base['value']), json.dumps(base['value'], ensure_ascii=False), self._json(base['value'])]:
                    if representation in excerpt:
                        excerpt = excerpt.replace(representation, '（世界参照见专用项）')
                        deduplicated += 1
            excerpt_key = '原句' if excerpt == item.get('text', '') else '摘录（重复设定已省略）'
            add('检索原文依据', {excerpt_key: excerpt[:1200], '位置': source}, source.get('path', ''), item.get('chunk_id', ''))
        if not any(card.get('type') == 'style' and card.get('id') in seen_ids for card in cards):
            add('文风要求', fixed.get('style_guide', {}), 'cards/style_001.yaml', 'style_001')
        for relation in linked.get('relationships', []):
            if event_context.get('scene_ref'):
                continue
            if relation.get('source') not in seen_ids or relation.get('target') not in seen_ids:
                continue
            item = {key: relation[key] for key in ['source', 'target', 'label', 'confirmed'] if key in relation}
            if item in body['关系']:
                continue
            add('已保存引用关系', item, (relation.get('evidence') or {}).get('path', ''), relation.get('id', ''))
        expanded = MaterialReferenceService(self.store).expand(project_id, [*control.get('material_expansions', []), *automatic_expansions], scope, requirements.get('场景', {}), chapter_id)
        for item in expanded['items']:
            before = len(material_items)
            add(item['type'], item['text'], item['source'], item['id'], required=True, raw_text=item['text'], label=item['label'], mode='expanded', material_id=item['material_id'])
            if len(material_items) > before:
                material_items[-1].update({key: item[key] for key in ['depth', 'via', 'references']})
                material_items[-1]['reason'] = item['reason']
                material_items[-1].update({key: item[key] for key in ['logical_source', 'material_type', 'stage_id', 'source_record_id', 'sources', 'local_override'] if key in item})
        dropped += int(references.get('omitted_count', len(references.get('omitted', [])))) + int(planning.get('omitted_rows', 0))
        body['省略数量'] = dropped
        for item, meta in zip(body['材料'], material_items):
            if meta.get('stage_id') or meta.get('local_override'):
                item['来源'] = meta['source']
                item['来源记录'] = {key: meta[key] for key in ['stage_id', 'sources', 'local_override'] if key in meta}
        pairs = list(zip(body['材料'], material_items))
        body['材料'] = [item for item, meta in pairs if meta['required']]
        required_chars = len(self._json(body))
        overflow = list(expanded['overflow'])
        if required_chars > max_chars:
            overflow += [{key: meta[key] for key in ['id', 'label', 'source', 'required']} | {'chars': len(meta['text']), 'reason': '必用内容须全文保留，合计超过本次输入范围。'} for _, meta in pairs if meta['required']]
            if not overflow:
                overflow = [{'id': 'request', 'label': '当前目标与硬约束', 'source': '', 'required': True, 'chars': required_chars, 'reason': '当前要求自身已超过输入范围。'}]
        chosen = {meta['id'] for _, meta in pairs if meta['required']}
        if not overflow:
            for item, meta in pairs:
                if meta['required']:
                    continue
                body['材料'].append(item)
                candidate = self._json(body)
                if len(candidate) > max_chars - 32 or max_input_bytes is not None and len(candidate.encode('utf-8')) > max_input_bytes:
                    body['材料'].pop()
                    dropped += 1
                else:
                    chosen.add(meta['id'])
        selected_pairs = [(item, meta) for item, meta in pairs if meta['id'] in chosen]
        body['材料'] = [item for item, _ in selected_pairs]
        body['省略数量'] = dropped
        text = self._json(body)
        used_ids = [meta['id'] for _, meta in selected_pairs]
        citations = [{'id': meta['id'], 'source': meta['source']} for _, meta in selected_pairs if meta['source']]
        versions = dict(expanded['source_versions'])
        for source in {citation['source'].split('#', 1)[0] for citation in citations} | rehearsal_dependencies:
            if source.startswith(('cards/', 'drafts/', 'canon/', 'sessions/suspense/')):
                path = self.store._safe_path(project_id, source)
                versions[source] = hashlib.sha256(path.read_bytes() if path.exists() else b'').hexdigest()
        report = {'ready': not overflow, 'overflow': overflow, 'items': [meta for _, meta in selected_pairs], 'required_chars': required_chars,
                      'used_chars': len(text), 'max_chars': max_chars, 'used_ids': used_ids,
                      'dropped_count': dropped, 'deduplicated_count': deduplicated, 'citations': citations,
                      'source_versions': versions, 'rehearsal_ids': rehearsal_ids, 'author_scope': resolved}
        if overflow and not allow_overflow:
            raise MaterialBudgetError(report)
        return text, report

    def sources_unchanged(self, project_id, versions):
        for source, digest in versions.items():
            if digest.startswith(('author-meta:', 'inventory:')):
                from services.generation_material_service import source_version
                if source_version(self.store, project_id, source) != digest:
                    return False
                continue
            path = self.store._safe_path(project_id, source)
            actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ''
            if actual != digest and not (not path.exists() and digest == hashlib.sha256(b'').hexdigest()):
                return False
        return True
