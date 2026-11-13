from __future__ import annotations

import json
import hashlib

from services.writing_reference_service import WritingReferenceService
from services.world_scope_service import WorldScopeService
from services.author_data_service import AuthorDataService, STAGES_PATH


class ContextPackService:
    """One bounded request, with each saved source represented once."""

    def __init__(self, store):
        self.store = store

    @staticmethod
    def _json(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

    def build(self, project_id, chapter_id, manifest, requirements, *, previous_end='', current_end='', max_chars=14000):
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
        requirements = dict(requirements)
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
        if len(self._json(body)) > max_chars - 700:
            raise ValueError('本章目标和硬约束超出取材范围，请缩小本次场景或精简重复要求后再生成。')
        seen_ids, seen_texts = set(), set()
        used_ids, citations = [], []
        dropped, deduplicated = 0, 0

        def add(kind, value, source='', item_id='', *, required=False):
            nonlocal dropped, deduplicated
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
            if len(self._json(body)) > max_chars - 350:
                body['材料'].pop()
                if required:
                    if kind in {'作者确认的场景安排', '作者确认的场景技法'}:
                        raise ValueError('已确认的场景推演超出本次取材范围，请缩小生成范围后再生成。')
                    raise ValueError('本章人物或世界硬设定超出取材范围，请缩小本次场景或精简重复设定后再生成。')
                dropped += 1
                return
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
        rehearsal_dependencies = {STAGES_PATH}
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
        seen_cards = set()
        for card in cards:
            cid = card.get('id')
            if not cid or card.get('type') not in {'character', 'world', 'world_rule', 'lore', 'style'}:
                continue
            if cid in seen_cards:
                deduplicated += 1
                continue
            seen_cards.add(cid)
            if not scope_service.card_visible(project_id, card, scope):
                dropped += 1
                continue
            if card.get('type') in {'world', 'world_rule', 'lore'} and scope.get('world_id') and cid not in world_states:
                dropped += 1
                continue
            effective = character_states.get(cid) or world_states.get(cid)
            if effective:
                card = {**card, 'payload': effective['state']}
            payload = at_this_chapter(card.get('payload', {}))
            payload = scope_service.filter_value(project_id, payload, scope)
            if not isinstance(payload, dict) or payload.get('canon_status') in {'hypothesis', 'inspiration'} or payload.get('setting_status') == 'unset' or payload.get('confirmation_status') in {'pending', 'pending_author_review'}:
                continue
            if payload.get('setting_status') == 'not_applicable':
                payload = {'适用性': '作者明确不采用此设定，不得据此添加能力或事件。', 'summary': payload.get('summary', '')}
            else:
                payload = {key: value for key, value in payload.items() if key not in {'writing_references', 'links', 'map_url', 'versions', 'content', 'description', 'updated_at', 'created_at'}}
                if card.get('type') == 'character':
                    if payload.get('arc'):
                        payload['成长安排（未定位事件，不当作此时状态）'] = payload.pop('arc')
                    if event_context.get('scene_ref'):
                        payload.pop('relationships', None)
                original = card.get('payload', {})
                detail = str(original.get('content') or original.get('description') or '')
                if detail:
                    # shortcut: local excerpts preserve wording, not a semantic model summary.
                    payload['正文摘录'] = detail[:1200]
                    if len(detail) > 1200:
                        payload['摘录说明'] = '正文未完整载入；不能把摘录未写出的内容当作已知。'
                if isinstance(payload.get('extra_context'), dict):
                    payload['extra_context'] = {key: value for key, value in payload['extra_context'].items() if key != 'map_url' and not (key == 'address_rules' and cid in rule_cards or key == 'world_base' and cid in base_cards)}
            value = {'名称': card.get('title', ''), '设定': payload}
            kind = '人物设定' if card.get('type') == 'character' else '已保存设定'
            must_keep = cid in cast or card.get('type') in {'world', 'world_rule', 'lore'}
            if must_keep and len(self._json(body)) + len(self._json(value)) + 500 > max_chars:
                keys = {'name', 'identity', 'gender', 'pronouns', 'address_notes', 'relationships', 'core_motivation', 'voice', 'boundaries', 'summary', 'rules', 'requirements', 'limits', 'costs', 'setting_status', 'canon_status', 'domain_status'}
                value = {'名称': card.get('title', ''), '设定': {key: child for key, child in payload.items() if key in keys}, '摘录说明': '其他描写按预算省略，硬设定保留。'}
                dropped += 1
            add(kind, value, card.get('source') or f'cards/{cid}.yaml', cid, required=must_keep)

        for fact in event_context.get('facts', []) if event_context.get('scene_ref') else linked.get('facts', []):
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
                add('此人物此刻明确已知（不能转给其他人物）', {'人物': cid, '已知': character['knowledge']}, STAGES_PATH, f'knowledge:{cid}', required=cid == pov)
            if character['age'].get('value') is not None:
                add('人物此时年龄（有明确依据）', {'人物': cid, **character['age']}, f'cards/{cid}.yaml', f'age:{cid}')
        selected_entities = set(character_states) & (cast | seen_ids)
        for relation in states['relations']:
            if not any(item['entity_id'] in selected_entities for item in relation['participants']):
                continue
            add('共享关系（称呼有明确发出人与对象）', {'id': relation['id'], **relation['state']}, relation['sources'][-1]['path'], relation['id'])
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
            add('作者规划（不是已发生事实）', row, item.get('source', ''), f'plan:{row_id}' if row_id else '')
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
            if source.get('path') in {'canon/facts.jsonl', STAGES_PATH}:
                continue
            if source.get('card_id'):
                source_card = self.store.read_yaml(project_id, f"cards/{source['card_id']}.yaml")
                if not scope_service.card_visible(project_id, source_card, scope):
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
            body['关系'].append(item)
            if len(self._json(body)) > max_chars - 100:
                body['关系'].pop()
                dropped += 1
                break
        dropped += int(references.get('omitted_count', len(references.get('omitted', [])))) + int(planning.get('omitted_rows', 0))
        body['省略数量'] = dropped
        text = self._json(body)
        if len(text) > max_chars:
            raise ValueError('本次材料超出取材范围，请缩小生成场景后重试。')
        versions = {}
        for source in {citation['source'].split('#', 1)[0] for citation in citations} | rehearsal_dependencies:
            if source.startswith(('cards/', 'drafts/', 'canon/')):
                path = self.store._safe_path(project_id, source)
                if path.exists() or source == STAGES_PATH:
                    versions[source] = hashlib.sha256(path.read_bytes() if path.exists() else b'').hexdigest()
        return text, {'used_chars': len(text), 'max_chars': max_chars, 'used_ids': used_ids,
                      'dropped_count': dropped, 'deduplicated_count': deduplicated, 'citations': citations,
                      'source_versions': versions, 'rehearsal_ids': rehearsal_ids, 'author_scope': resolved}

    def sources_unchanged(self, project_id, versions):
        for source, digest in versions.items():
            path = self.store._safe_path(project_id, source)
            if hashlib.sha256(path.read_bytes() if path.exists() else b'').hexdigest() != digest:
                return False
        return True
