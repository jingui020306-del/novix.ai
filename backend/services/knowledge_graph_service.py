from __future__ import annotations

import json
import re
import hashlib
from collections import deque
from services.planning_threads import thread_names


class KnowledgeGraphService:
    """A read-through view of author files, not a second source of truth."""

    def __init__(self, store) -> None:
        self.store = store

    def _chapter_order(self, project_id: str) -> list[str]:
        return list(dict.fromkeys(self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()))

    def graph(self, project_id: str, chapter_id: str | None = None, *, event_ref: str | None = None, stage: str = 'after',
              world_context=None, story_card_id=None, branch_id=None, pov_character_id=None) -> dict:
        from services.world_scope_service import WorldScopeService
        service = WorldScopeService(self.store)
        scoped = bool(chapter_id or event_ref or world_context or story_card_id or branch_id or pov_character_id)
        if not scoped:
            return self._base_graph(project_id)
        resolved = service.resolve(project_id, chapter_id=chapter_id, event_ref=event_ref, story_card_id=story_card_id,
                                   branch_id=branch_id, world_context=world_context, pov_character_id=pov_character_id)
        scope = resolved['scope']
        if event_ref and stage in {'before', 'after'} and not (world_context or {}).get('time', {}).get('position'):
            scope['time']['position'] = 'before' if stage == 'before' else 'immediate_after'
        graph = self._event_graph(project_id, scope.get('event_ref') or event_ref, stage) if event_ref else self._base_graph(project_id, None if service.has_time(scope) else chapter_id)
        nodes = []
        for node in graph['nodes']:
            if node['type'] == 'chapter' and node['id'] != chapter_id and service.has_time(scope):
                chapter_scope = service.resolve(project_id, chapter_id=node['id'])['scope']
                if not service.applies(project_id, chapter_scope, scope, dynamic=True)[0]:
                    continue
            path = node['source'].split('#', 1)[0]
            if path.startswith('cards/') and path.endswith('.yaml'):
                card = self.store.read_yaml(project_id, path)
                if not service.card_visible(project_id, card, scope):
                    continue
                if scope.get('world_id') and card.get('type') in {'world', 'world_rule', 'worldview', 'lore'}:
                    payload = card.get('payload', {})
                    if not service.belongs_to_world(project_id, card, scope['world_id']):
                        continue
                if node['type'] == 'scene' and ':important_scenes:' in node['id']:
                    try:
                        event_scope = service.resolve(project_id, event_ref=node['id'])['scope']
                        if not service.applies(project_id, event_scope, scope)[0]:
                            continue
                    except (ValueError, FileNotFoundError):
                        continue
            if node['type'] in {'relationship', 'information'} and not service.applies(project_id, node.get('applicability'), scope)[0]:
                continue
            if node['type'] in {'character_state', 'world_state', 'relationship_state', 'information_state'} and not service.applies(project_id, node.get('applicability'), scope, dynamic=True)[0]:
                continue
            if node.get('superseded_by') and any(service.applies(project_id, replacement.get('scope'), scope, dynamic=True)[0] for replacement in node['superseded_by']):
                continue
            if node['type'] == 'fact':
                node = {**node, 'scope_visible': service.fact_visible(project_id, node.get('record', {}), scope)}
                if not node['scope_visible']:
                    continue
            nodes.append(node)
        ids = {node['id'] for node in nodes}
        graph.update(nodes=nodes, edges=[edge for edge in graph['edges'] if edge['source'] in ids and edge['target'] in ids], author_scope=resolved)
        return graph

    def _base_graph(self, project_id: str, chapter_id: str | None = None) -> dict:
        order = self._chapter_order(project_id)
        if chapter_id and chapter_id not in order:
            raise ValueError('章节不存在，请先创建章节。')
        visible = set(order[:order.index(chapter_id) + 1]) if chapter_id else set(order)
        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        cards = []
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if not card.get('id') or card.get('type') not in {'character', 'world', 'world_rule', 'worldview', 'lore', 'style', 'story', 'outline', 'tool_skill'}:
                continue
            first = card.get('payload', {}).get('introduced_chapter')
            if chapter_id and first and first not in visible:
                continue
            cards.append(card)
            pending = card.get('payload', {}).get('confirmation_status') in {'pending', 'pending_author_review'}
            payload = card.get('payload', {})
            adopted = payload.get('setting_status', 'set') == 'set'
            canonical = payload.get('canon_status', 'canon') == 'canon'
            status = 'pending' if pending else payload.get('setting_status') if not adopted else payload.get('canon_status') if not canonical else 'author_saved'
            nodes[card['id']] = {'id': card['id'], 'label': card.get('title') or card['id'], 'type': card['type'],
                                 'source': f'cards/{path.name}', 'confirmed': not pending and adopted and canonical, 'status': status,
                                 **{key: payload[key] for key in ['entry_type', 'direction', 'parent_id', 'setting_status', 'canon_status', 'creation_status', 'summary', 'core'] if key in payload}}
        reference_ids = {rid for card in cards for rid in card.get('payload', {}).get('writing_references', []) if isinstance(rid, str)}
        for chapter in visible:
            meta = self.store.read_json(project_id, f'drafts/{chapter}.meta.json')
            reference_ids.update(row.get('technique_id') for row in meta.get('pinned_techniques', []) if isinstance(row, dict))
        for rid in reference_ids:
            if not isinstance(rid, str) or not re.fullmatch(r'[\w-]+', rid) or rid in nodes:
                continue
            card = self.store.read_yaml(project_id, f'cards/{rid}.yaml')
            if card.get('type') in {'technique', 'tool_skill'}:
                label = str(card.get('title') or '写作参考')
                if re.fullmatch(r'[a-z]+_扩展技法_\d+', label):
                    label = '待完善的写作参考'
                nodes[rid] = {'id': rid, 'label': label, 'type': card['type'], 'source': f'cards/{rid}.yaml', 'confirmed': True, 'status': 'author_saved'}
        aliases = {str(value): card['id'] for card in cards for value in [card['id'], card.get('title'), card.get('payload', {}).get('name')] if value}
        for chapter in order:
            if chapter not in visible:
                continue
            meta = self.store.read_json(project_id, f'drafts/{chapter}.meta.json')
            nodes[chapter] = {'id': chapter, 'label': meta.get('title') or meta.get('chapter_title') or chapter,
                              'type': 'chapter', 'source': f'drafts/{chapter}.md', 'confirmed': True, 'status': 'author_saved'}
        def edge(source: str, target: str, label: str, **extra) -> None:
            if isinstance(source, str) and isinstance(target, str) and source in nodes and target in nodes:
                item = {'source': source, 'target': target, 'label': label, 'confirmed': nodes[source]['confirmed'] and nodes[target]['confirmed'], **extra}
                item['id'] = hashlib.sha256(json.dumps(item, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:20]
                if item not in edges:
                    edges.append(item)
        if not chapter_id:
            for path in sorted(self.store._safe_path(project_id, 'cards').glob('blueprint_*.json')):
                blueprint = self.store.read_json(project_id, f'cards/{path.name}')
                for index, scene in enumerate(blueprint.get('scene_plan', []) or []):
                    if not isinstance(scene, dict):
                        continue
                    nid = f'scene:{blueprint.get("id") or path.stem}:{index}'
                    source = f'cards/{path.name}#scene_plan.{index}'
                    nodes[nid] = {'id': nid, 'label': str(scene.get('purpose') or scene.get('situation') or '写作场景'), 'type': 'scene', 'source': source, 'confirmed': True, 'status': 'author_plan', 'scope': 'author_plan'}
                    for actor in scene.get('cast', []) or []:
                        if isinstance(actor, str):
                            edge(nid, actor, '出场人物', evidence={'path': source, 'field': 'cast'})
                    for target in scene.get('material_ids', []) or []:
                        if isinstance(target, str):
                            edge(nid, target, '关联资料', evidence={'path': source, 'field': 'material_ids'})
        for chapter in order:
            if chapter not in visible:
                continue
            meta = self.store.read_json(project_id, f'drafts/{chapter}.meta.json')
            for tool_id in meta.get('tool_skill_ids', []) or []:
                if isinstance(tool_id, str) and nodes.get(tool_id, {}).get('type') == 'tool_skill':
                    edge(chapter, tool_id, '本章引用', evidence={'path': f'drafts/{chapter}.meta.json', 'field': 'tool_skill_ids'})
            for row in meta.get('pinned_techniques', []) or []:
                if isinstance(row, dict):
                    edge(chapter, row.get('technique_id'), '写作参考', evidence={'path': f'drafts/{chapter}.meta.json', 'field': 'pinned_techniques'})
            reference = meta.get('writing_scene') or {}
            blueprint_id = reference.get('blueprint_id', '')
            index = reference.get('scene_index')
            if not re.fullmatch(r'[\w-]+', str(blueprint_id)) or not isinstance(index, int) or isinstance(index, bool):
                continue
            plan = self.store.read_json(project_id, f'cards/{blueprint_id}.json').get('scene_plan', [])
            if not 0 <= index < len(plan):
                continue
            scene = plan[index]
            nid = f'scene:{blueprint_id}:{index}'
            source = f'cards/{blueprint_id}.json#scene_plan.{index}'
            nodes[nid] = {'id': nid, 'label': str(scene.get('purpose') or scene.get('situation') or '写作场景'), 'type': 'scene', 'source': source, 'confirmed': True, 'status': 'author_saved'}
            edge(chapter, nid, '本章场景', evidence={'path': f'drafts/{chapter}.meta.json', 'field': 'writing_scene'})
            for actor in scene.get('cast', []) or []:
                edge(nid, str(actor), '出场人物', evidence={'path': source, 'field': 'cast'})
            for target in scene.get('material_ids', []) or []:
                if isinstance(target, str):
                    edge(nid, target, '关联资料', evidence={'path': source, 'field': 'material_ids'})
        for card in cards:
            cid, payload = card['id'], card.get('payload') or {}
            source = nodes[cid]['source']
            if payload.get('parent_id'):
                edge(cid, payload['parent_id'], '上级条目', evidence={'path': source, 'field': 'payload.parent_id'})
            for material_id in payload.get('material_ids', []) or []:
                if isinstance(material_id, str):
                    edge(cid, material_id, '关联资料', evidence={'path': source, 'field': 'payload.material_ids'})
            for rid in payload.get('writing_references', []) or []:
                if isinstance(rid, str):
                    edge(cid, rid, '写作参考', evidence={'path': source, 'field': 'payload.writing_references'})
            for linked in card.get('links', []) or []:
                edge(cid, aliases.get(str(linked), str(linked)), '引用', evidence={'path': source, 'field': 'links'})
            for relationship_index, relationship in enumerate(payload.get('relationships', []) or []):
                if not isinstance(relationship, dict):
                    continue
                if chapter_id and relationship.get('chapter') and relationship['chapter'] not in visible:
                    continue
                target = str(relationship.get('target') or '')
                edge(cid, aliases.get(target, target), str(relationship.get('type') or '相关人物'), scope='author_saved', owner_card_id=cid, temporal_chapter=relationship.get('chapter'),
                     owner_path=['payload', 'relationships', str(relationship_index)], evidence={'path': source, 'field': f'payload.relationships.{relationship_index}'},
                     **({'address_as': relationship['address_as']} if 'address_as' in relationship else {}))
            if card.get('type') == 'character':
                for arc_index, arc in enumerate(payload.get('arc', []) or []):
                    if not isinstance(arc, dict):
                        continue
                    nid = f'{cid}:arc:{arc_index}'
                    nodes[nid] = {'id': nid, 'label': str(arc.get('goal') or arc.get('beat') or '成长安排'), 'type': 'character_arc',
                                  'source': f'{source}#payload.arc.{arc_index}', 'confirmed': nodes[cid]['confirmed'], 'status': 'author_plan', 'scope': 'author_plan'}
                    edge(cid, nid, '成长安排', scope='author_plan', owner_card_id=cid, owner_path=['payload', 'arc', str(arc_index)], evidence={'path': source, 'field': f'payload.arc.{arc_index}'})
            for mention in re.findall(r'\[\[([^\]|#]+)(?:[^\]]*)\]\]', json.dumps(card, ensure_ascii=False)):
                edge(cid, aliases.get(mention, mention), '双向链接', evidence={'path': source})
            if card.get('type') != 'story':
                continue
            for section in ['chapter_plan', 'open_line', 'hidden_line', 'foreshadowings']:
                for index, row in enumerate(payload.get(section, []) or []):
                    if not isinstance(row, dict):
                        continue
                    first = str(row.get('first_chapter') or row.get('chapter_id') or row.get('chapter') or '')
                    if chapter_id and first not in visible:
                        continue
                    nid = f'{cid}:{section}:{row.get("id") or index}'
                    nodes[nid] = {'id': nid, 'label': str(row.get('content') or row.get('title') or row.get('event') or row.get('visible_hint') or row.get('focus') or section),
                                  'type': section, 'source': f'{source}#payload.{section}.{index}', 'confirmed': nodes[cid]['confirmed'], 'status': nodes[cid]['status']}
                    edge(cid, nid, {'chapter_plan': '章节计划', 'open_line': '明线', 'hidden_line': '暗线', 'foreshadowings': '伏笔'}[section], evidence={'path': source, 'field': f'payload.{section}.{index}'})
                    edge(nid, first, '发生 / 埋设于', evidence={'path': source})
                    payoff = str(row.get('payoff_chapter') or '')
                    if not chapter_id or payoff in visible:
                        edge(nid, payoff, '回收于', evidence={'path': source})
        for card in cards:
            cid, payload = card['id'], card.get('payload') or {}
            if card.get('type') != 'story' and (card.get('type') != 'outline' or not (payload.get('planning_worksheet') or 'important_scenes' in payload)):
                continue
            source = nodes[cid]['source']
            story_id = payload.get('story_card_id')
            threads = thread_names(payload)
            if card.get('type') == 'outline':
                edge(cid, story_id, '所属故事', evidence={'path': source, 'field': 'payload.story_card_id'})
            rows = []
            for table in ['important_scenes', 'character_intersections', 'character_storylines', 'beat_sheet']:
                for index, row in enumerate(payload.get(table, []) or []):
                    if not isinstance(row, dict):
                        continue
                    chapter = row.get('chapter')
                    if chapter_id and chapter not in visible:
                        continue
                    nid = f'{cid}:{table}:{row.get("id") or index}'
                    node_source = f'{source}#payload.{table}.{index}'
                    nodes[nid] = {'id': nid, 'label': str(row.get('scene') or row.get('name') or row.get('goal') or row.get('plot') or '情节安排'),
                                  'type': {'important_scenes': 'scene', 'character_intersections': 'character_intersection', 'character_storylines': 'character_storyline', 'beat_sheet': 'beat'}[table],
                                  'source': node_source, 'confirmed': nodes[cid]['confirmed'], 'status': 'author_plan', 'scope': 'author_plan'}
                    if table == 'important_scenes':
                        nodes[nid].update(thread_id=row.get('thread_id') or 'main', thread_name=threads.get(row.get('thread_id') or 'main', '未归类故事线'))
                    rows.append((nid, row, node_source))
                    aliases.setdefault(str(row.get('id') or ''), nid)
                    if table == 'important_scenes' and not row.get('id'):
                        aliases[f'{cid}:important_scenes:index_{index}'] = nid
                    edge(cid, nid, '情节规划', evidence={'path': source, 'field': f'payload.{table}.{index}'})
                    edge(nid, chapter, '计划章节', evidence={'path': node_source, 'field': 'chapter'})
            for nid, row, node_source in rows:
                for actor in [row.get('character_id'), *(row.get('characters', []) or [])]:
                    if isinstance(actor, str):
                        edge(nid, actor, '相关人物', evidence={'path': node_source, 'field': 'characters'})
                for field in ['scene_id', 'beat_id']:
                    if row.get(field):
                        target = f'{cid}:{"important_scenes" if field == "scene_id" else "beat_sheet"}:{row[field]}'
                        edge(nid, aliases.get(target, target), '关联场景' if field == 'scene_id' else '结构节拍', evidence={'path': node_source, 'field': field})
                for target in [*(row.get('scene_ids', []) or []), *(row.get('material_ids', []) or [])]:
                    if isinstance(target, str):
                        if target in (row.get('scene_ids', []) or []):
                            target = f'{cid}:important_scenes:{target}'
                        edge(nid, aliases.get(target, target), '关联资料', evidence={'path': node_source, 'field': 'material_ids'})
                if nodes[nid]['type'] == 'scene':
                    for target in row.get('causal_scene_ids', []) or []:
                        target = f'{cid}:important_scenes:{target}'
                        edge(nid, aliases.get(target, target), '承接前因', scope='author_plan', evidence={'path': node_source, 'field': 'causal_scene_ids'})
                    for change_index, change in enumerate(row.get('relationship_changes', []) or []):
                        if not isinstance(change, dict):
                            continue
                        edge(change.get('source_id'), change.get('target_id'), str(change.get('relation') or '关系变化'), scope='author_plan', event_ref=nid,
                             event_label=nodes[nid]['label'], owner_card_id=cid,
                             owner_path=['payload', *node_source.split('#', 1)[1].split('.')[1:], 'relationship_changes', str(change_index)],
                             evidence={'path': node_source, 'field': f'relationship_changes.{change_index}'}, notes=str(change.get('notes') or ''))
        # Event anchors reference existing scene nodes; no duplicate foreshadow or event records.
        for card in cards:
            for index, row in enumerate(card.get('payload', {}).get('foreshadowings', []) or []):
                if not isinstance(row, dict):
                    continue
                nid = f'{card["id"]}:foreshadowings:{row.get("id") or index}'
                for field, label in [('first_event_ref', '埋设事件'), ('payoff_event_ref', '回收事件')]:
                    ref = row.get(field)
                    if isinstance(ref, dict):
                        target = f'{ref.get("owner_card_id")}:important_scenes:{ref.get("scene_id")}'
                        edge(nid, aliases.get(target, target), label, scope='author_plan', evidence={'path': nodes[card['id']]['source'], 'field': f'payload.foreshadowings.{index}.{field}'})
        # Some saved references point to worksheet nodes created after the card and chapter pass.
        for card in cards:
            for field, targets in [('links', card.get('links', [])), ('payload.material_ids', card.get('payload', {}).get('material_ids', []))]:
                for target in targets or []:
                    if isinstance(target, str):
                        edge(card['id'], aliases.get(target, target), '引用' if field == 'links' else '关联资料', evidence={'path': nodes[card['id']]['source'], 'field': field})
        for chapter in visible:
            for target in self.store.read_json(project_id, f'drafts/{chapter}.meta.json').get('material_ids', []) or []:
                if isinstance(target, str):
                    edge(chapter, aliases.get(target, target), '关联资料', evidence={'path': f'drafts/{chapter}.meta.json', 'field': 'material_ids'})
        from services.author_data_service import AuthorDataService, STAGES_PATH
        author_data = AuthorDataService(self.store)
        events = author_data.events(project_id)
        event_aliases = {}
        by_event_id = {event['id']: event for event in events}
        visible_event_nodes = set(nodes)
        for event in events:
            nid = aliases.get(event['id'], event['id'])
            if nid not in visible_event_nodes:
                continue
            canonical_id = aliases.get(event['canonical_id'], event['canonical_id'])
            event_aliases[nid] = canonical_id
            event_aliases[event['id']] = canonical_id
            if canonical_id not in nodes:
                original = by_event_id[event['canonical_id']]
                value = original['values']
                nodes[canonical_id] = {**nodes[nid], 'id': canonical_id, 'source': original['canonical_source'],
                    'label': str(value.get('scene') or value.get('name') or value.get('goal') or value.get('plot') or '情节安排')}
            nodes[nid].update(canonical_id=event['canonical_id'], aliases=event['aliases'], duplicate_conflicts=event['duplicate_conflicts'])
            if event['canonical_id'] != event['id']:
                edge(event['owner_card_id'], canonical_id, '同一事件的来源映射', alias_event_id=event['id'],
                     evidence={'path': event['sources'][0]['path'], 'field': 'canonical_event_ref'}, layer='references')
            for reference in event['values'].get('causal_event_refs', []) or []:
                try:
                    target = author_data.world.event(project_id, reference)[-1]
                except (ValueError, FileNotFoundError):
                    continue
                target_id = f"{target['owner_card_id']}:important_scenes:{target['scene_id']}"
                edge(nid, target_id, '承接前因', scope='author_plan', evidence={'path': event['sources'][0]['path'], 'field': 'causal_event_refs'})
        from services.author_control_service import AuthorControlService
        for index, fact in enumerate(AuthorControlService(self.store).read(project_id, 'canon/facts.jsonl')):
            evidence = fact.get('evidence') or {}
            chapter = str(evidence.get('chapter_id') or '')
            if chapter_id and (not chapter or chapter not in visible):
                continue
            quote = str(evidence.get('quote') or '')
            verified = bool(chapter in visible and quote and quote in self.store.read_md(project_id, f'drafts/{chapter}.md'))
            nid = f'fact:{fact.get("id") or index}:{index}'
            nodes[nid] = {'id': nid, 'label': str(fact.get('value') or fact.get('key') or '作品事实'), 'type': 'fact',
                          'source': f'canon/facts.jsonl#L{index + 1}', 'confirmed': verified, 'status': 'supported' if verified else 'unverified', 'evidence': evidence,
                          'event_ref': fact.get('event_ref') or evidence.get('event_ref'), 'needs_review': not verified}
            nodes[nid]['record'] = fact
            edge(nid, chapter, '正文依据', evidence=evidence)
            for reference in fact.get('sources', []) or []:
                ref = reference.get('path', '') if isinstance(reference, dict) else str(reference)
                for card in cards:
                    if ref == nodes[card['id']]['source']:
                        edge(nid, card['id'], '引用设定', evidence=evidence)
        for relation in author_data.relationships(project_id):
            if relation['legacy']:
                continue
            nid = relation['id']
            nodes[nid] = {'id': nid, 'label': relation['label'], 'type': 'relationship', 'source': relation['sources'][-1]['path'],
                          'confirmed': True, 'status': 'author_saved', 'scope': 'author_saved', 'layer': 'relationships',
                          'participants': relation['participants'], 'direction': relation['direction'], 'applicability': relation.get('scope', {}),
                          'owner_card_id': relation['owner_card_id'], 'owner_path': relation['owner_path'], 'stages': relation['stages']}
            for participant in relation['participants']:
                edge(nid, participant['entity_id'], participant.get('role') or '关系参与者', layer='relationships', relationship_id=nid,
                     evidence={'path': relation['sources'][-1]['path']}, participant=participant, direction=relation['direction'], scope='author_saved')
        from services.information_service import InformationService
        information = InformationService(self.store)
        for item in information.list(project_id):
            nid = item['id']
            nodes[nid] = {'id': nid, 'label': item['label'], 'type': 'information', 'source': item['source'], 'confirmed': item.get('truth_status') == 'confirmed',
                          'status': item.get('truth_status'), 'applicability': item.get('scope', {}), 'layer': 'information'}
            if item.get('fact_ref'):
                for fact_node in list(nodes.values()):
                    if fact_node['type'] == 'fact' and fact_node.get('record', {}).get('id') == item['fact_ref']:
                        edge(nid, fact_node['id'], '真相引用原事实', layer='information', evidence={'path': item['source']})
        for card in cards:
            for info_id in card.get('payload', {}).get('information_ids', []) or []:
                edge(card['id'], info_id, '信息关联', layer='information', evidence={'path': nodes[card['id']]['source'], 'field': 'payload.information_ids'})
        for event in author_data.events(project_id):
            for info_id in event['effective_values'].get('information_ids', []) or []:
                edge(event['id'], info_id, '信息关联', layer='information', evidence={'path': event['canonical_source'], 'field': 'information_ids'})
        for chapter in visible:
            for info_id in self.store.read_json(project_id, f'drafts/{chapter}.meta.json').get('information_ids', []) or []:
                edge(chapter, info_id, '信息展示关联', layer='information', evidence={'path': f'drafts/{chapter}.meta.json', 'field': 'information_ids'})
        stage_rows = self.store.read_jsonl(project_id, STAGES_PATH)
        voids = {sid for row in stage_rows if row.get('kind') == 'void' for sid in row.get('voids', [])}
        for row in stage_rows:
            if row.get('kind') == 'void' or row.get('record_type') == 'review_decision' or row.get('id') in voids or row.get('status') == 'retracted' or row.get('entity_id') not in nodes:
                continue
            nid = f"state:{row['id']}"
            nodes[nid] = {'id': nid, 'label': row.get('label') or '、'.join(row.get('changes', {})) or '阶段记录',
                          'type': f"{row['entity_type']}_state", 'source': f"{STAGES_PATH}#{row['id']}", 'confirmed': row.get('status') == 'confirmed',
                          'status': row.get('status'), 'changes': row.get('changes', {}), 'applicability': row.get('scope', {}), 'evidence': row.get('source'), 'layer': 'states'}
            if row.get('entity_type') == 'information':
                nodes[nid].update(label=row.get('data', {}).get('value') or '信息记录', record_type=row.get('record_type'), data=row.get('data', {}))
                actor = row.get('data', {}).get('character_id') or row.get('data', {}).get('speaker_id')
                edge(nid, actor, '人物认知' if row.get('record_type') == 'awareness' else '表达', layer='information', evidence=row.get('source'))
            nodes[nid]['superseded_by'] = [replacement for replacement in stage_rows if replacement.get('supersedes') == row['id'] and replacement.get('status') in {'confirmed', 'retracted'}]
            edge(nid, row['entity_id'], '阶段变化', evidence=row.get('source'), layer='states')
        for event in events:
            nid = aliases.get(event['id'], event['id'])
            canonical_id = event_aliases.get(event['id'])
            if canonical_id not in nodes:
                continue
            node = nodes[canonical_id]
            node['canonical_id'] = event['canonical_id']
            node.setdefault('sources', [{'path': node['source']}])
            for source in event['sources']:
                if source not in node.setdefault('sources', []):
                    node['sources'].append(source)
            projection = {key: event[key] for key in ['id', 'owner_card_id', 'scene_id', 'local_values']}
            projection['source'] = event['sources'][0]['path']
            node.setdefault('projections', []).append(projection)
            if nid != canonical_id:
                alias = {'owner_card_id': event['owner_card_id'], 'scene_id': event['scene_id']}
                if alias not in node.setdefault('aliases', []):
                    node['aliases'].append(alias)
            for conflict in event['duplicate_conflicts']:
                if conflict not in node.setdefault('duplicate_conflicts', []):
                    node['duplicate_conflicts'].append(conflict)
        for alias_id, canonical_id in event_aliases.items():
            if alias_id != canonical_id:
                nodes.pop(alias_id, None)
        projected_edges = []
        for item in edges:
            item = {**item, **{key: event_aliases.get(item[key], item[key]) for key in ['source', 'target', 'event_ref'] if key in item}}
            item.pop('id', None)
            item['id'] = hashlib.sha256(json.dumps(item, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:20]
            if item['source'] in nodes and item['target'] in nodes and item not in projected_edges:
                projected_edges.append(item)
        edges = projected_edges
        self._relationship_history(edges)
        return {'nodes': list(nodes.values()), 'edges': edges, 'chapter_id': chapter_id, 'visible_chapters': [item for item in order if item in visible],
                'event_aliases': event_aliases,
                'policy': '关系来自已保存文件；正文事实需原句支持。按章节查看时不包含未来章节事实。'}

    @staticmethod
    def _relationship_history(edges):
        groups = {}
        for relation in edges:
            if relation.get('event_ref'):
                groups.setdefault((relation.get('owner_card_id'), relation['source'], relation['target']), []).append(relation)
        for relations in groups.values():
            history = [{key: item[key] for key in ['id', 'event_ref', 'event_label', 'label', 'notes', 'scope', 'owner_card_id', 'owner_path', 'evidence'] if key in item} for item in relations]
            for index, relation in enumerate(relations):
                relation['history'] = history
                relation['active'] = index == len(relations) - 1

    @staticmethod
    def _event_ref(value):
        if isinstance(value, dict):
            value = f'{value.get("owner_card_id")}:important_scenes:{value.get("scene_id")}'
        return value if isinstance(value, str) and re.fullmatch(r'[\w-]+:important_scenes:[\w-]+', value) else None

    def _event_position(self, project_id, reference):
        ref = self._event_ref(reference)
        if not ref:
            raise ValueError('请选择情节工作表中的有效事件。')
        owner_id, _, scene_id = ref.split(':')
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if card.get('id') != owner_id or (card.get('type') != 'story' and (card.get('type') != 'outline' or not (card.get('payload', {}).get('planning_worksheet') or 'important_scenes' in card.get('payload', {})))):
                continue
            rows = card.get('payload', {}).get('important_scenes', []) or []
            for index, row in enumerate(rows):
                if isinstance(row, dict) and scene_id in {str(row.get('id') or index), f'index_{index}' if not row.get('id') else ''}:
                    return card, f'cards/{path.name}', rows, index
        raise ValueError('这个事件已不存在，请返回情节工作表重新选择。')

    def _event_graph(self, project_id, reference, stage):
        if stage not in {'before', 'after'}:
            raise ValueError('请选择事件发生前或发生后。')
        card, source, rows, index = self._event_position(project_id, reference)
        ref = f'{card["id"]}:important_scenes:{rows[index].get("id") or index}'
        visible = {f'{card["id"]}:important_scenes:{row.get("id") or offset}' for offset, row in enumerate(rows[:index + (stage == 'after')]) if isinstance(row, dict)}
        from services.world_scope_service import WorldScopeService
        scope_service = WorldScopeService(self.store)
        pending = scope_service.predecessors(project_id, ref)
        visited_predecessors = set()
        while pending:
            previous = pending.pop()
            previous_id = f"{previous['owner_card_id']}:important_scenes:{previous['scene_id']}"
            if previous_id in visited_predecessors:
                continue
            visited_predecessors.add(previous_id)
            visible.add(previous_id)
            pending.extend(scope_service.predecessors(project_id, previous))
        graph = self.graph(project_id)
        event_aliases = graph.get('event_aliases', {})
        visible = {event_aliases.get(reference, reference) for reference in visible}
        nodes = []
        for node in graph['nodes']:
            nid = node['id']
            if ':important_scenes:' in nid and nid not in visible:
                continue
            if node.get('scope') == 'author_plan' and node['type'] in {'character_intersection', 'character_storyline', 'beat'}:
                owner = nid.split(':', 1)[0]
                if owner != card['id']:
                    continue
                table, offset = node['source'].split('#payload.', 1)[1].rsplit('.', 1)
                row = card.get('payload', {}).get(table, [])[int(offset)]
                linked = {row.get('scene_id'), *(row.get('scene_ids', []) or [])} - {None, ''}
                if not linked or not any(event_aliases.get(f'{owner}:important_scenes:{scene}', f'{owner}:important_scenes:{scene}') in visible for scene in linked):
                    continue
            elif node.get('scope') == 'author_plan' and node['type'] == 'scene' and ':important_scenes:' not in nid:
                continue
            if node['type'] == 'foreshadowings':
                owner = next((item for item in graph['nodes'] if item['id'] == nid.split(':', 1)[0]), None)
                if owner:
                    stored = self.store.read_yaml(project_id, owner['source'])
                    offset = int(node['source'].rsplit('.', 1)[1])
                    planned = stored.get('payload', {}).get('foreshadowings', [])[offset]
                    anchor = self._event_ref(planned.get('first_event_ref'))
                    anchor = event_aliases.get(anchor, anchor)
                    if anchor and anchor not in visible:
                        continue
            if node['type'] == 'fact':
                anchored = self._event_ref(node.get('event_ref'))
                anchored = event_aliases.get(anchored, anchored)
                if anchored and anchored not in visible:
                    continue
                if not anchored:
                    node.update(temporal_status='unknown', evidence_verified=node['confirmed'], confirmed=False)
            if node['type'] == 'character_arc':
                node['temporal_status'] = 'unanchored_author_plan'
            nodes.append(node)
        ids = {node['id'] for node in nodes}
        edges = [edge for edge in graph['edges'] if edge['source'] in ids and edge['target'] in ids and (not edge.get('event_ref') or edge['event_ref'] in visible)]
        for edge in edges:
            edge.pop('history', None)
            edge.pop('active', None)
            if edge.get('temporal_chapter'):
                anchored_scenes = {f'{card["id"]}:important_scenes:{row.get("id") or offset}' for offset, row in enumerate(rows) if isinstance(row, dict) and row.get('chapter') == edge['temporal_chapter']}
                if not anchored_scenes or not anchored_scenes <= visible:
                    edge['temporal_status'] = 'unknown'
        self._relationship_history(edges)
        graph.update(nodes=nodes, edges=edges, event_ref=ref, event_stage={'owner_card_id': card['id'], 'scene_id': rows[index].get('id') or str(index),
                     'label': rows[index].get('scene') or rows[index].get('plot') or '当前事件', 'stage': stage, 'index': index,
                     'order': 'important_scenes', 'source': f'{source}#payload.important_scenes.{index}'},
                     policy='按原情节事件顺序查看作者计划；章节是讲述安排。关系计划不是已发生事实；没有事件锚的正文事实不作为此时已知。')
        return graph

    def event_context(self, project_id, chapter_id=None, scene_ref=None, story_card_id=None, *, max_chars=4000, world_context=None, branch_id=None, pov_character_id=None):
        result = {'scene_ref': None, 'stage': 'before', 'actor_ids': [], 'event_order': None, 'relationships': [], 'current_event_changes': [], 'character_stages': [], 'arc_plans': [],
                  'causal_events': [], 'facts': [], 'uncertainties': [], 'sources': [], 'source_versions': {}, 'max_chars': max_chars, 'used_chars': 0, 'omitted_count': 0}
        if not scene_ref:
            references = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('material_ids', []) if chapter_id else []
            candidates = {}
            for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
                card = self.store.read_yaml(project_id, f'cards/{path.name}')
                if card.get('type') != 'story' and (card.get('type') != 'outline' or not (card.get('payload', {}).get('planning_worksheet') or 'important_scenes' in card.get('payload', {}))):
                    continue
                if story_card_id and (card.get('id') if card.get('type') == 'story' else card['payload'].get('story_card_id')) != story_card_id:
                    continue
                for index, row in enumerate(card['payload'].get('important_scenes', []) or []):
                    if not isinstance(row, dict):
                        continue
                    ref = f'{card["id"]}:important_scenes:{row.get("id") or index}'
                    if chapter_id and (row.get('chapter') == chapter_id or ref in references):
                        from services.world_scope_service import WorldScopeService
                        canonical = WorldScopeService(self.store).event(project_id, ref)[-1]
                        canonical_ref = f"{canonical['owner_card_id']}:important_scenes:{canonical['scene_id']}"
                        if canonical_ref not in candidates or row.get('chapter') == chapter_id:
                            candidates[canonical_ref] = ref
            if len(candidates) == 1:
                scene_ref = next(iter(candidates.values()))
            else:
                result['uncertainties'].append('本章没有唯一事件锚；不能用章节顺序推定人物关系阶段，请按具体场景核对。')
                return self._event_budget(result)
        from services.world_scope_service import WorldScopeService
        from services.author_data_service import AuthorDataService
        projection = AuthorDataService(self.store).event_projection(project_id, scene_ref, chapter_id)
        original_reference = projection['id']
        scene_ref = WorldScopeService(self.store).event(project_id, projection['canonical_id'])[-1]
        card, source, rows, index = self._event_position(project_id, scene_ref)
        if story_card_id and (card.get('id') if card.get('type') == 'story' else card['payload'].get('story_card_id')) != story_card_id:
            raise ValueError('当前事件不属于所选故事。')
        scene = rows[index]
        chapter_links = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('material_ids', []) or [] if chapter_id else []
        projection_chapter = projection['effective_values'].get('chapter')
        if chapter_id and projection_chapter and projection_chapter != chapter_id and not ({self._event_ref(scene_ref), original_reference} & set(chapter_links)):
            raise ValueError('这个事件没有关联当前章节，请先在工作表或章节材料中确认关联。')
        ref = f'{card["id"]}:important_scenes:{scene.get("id") or index}'
        from services.world_scope_service import WorldScopeService
        from services.author_data_service import AuthorDataService, STAGES_PATH
        scope_service = WorldScopeService(self.store)
        resolved = scope_service.resolve(project_id, chapter_id=chapter_id, event_ref=ref, story_card_id=story_card_id,
            world_context=world_context, branch_id=branch_id, pov_character_id=pov_character_id)
        author_state = AuthorDataService(self.store).author_state(project_id, world_context=resolved['scope'])
        result['author_scope'] = resolved
        result['projection'] = {'ref': projection['id'], 'values': projection['local_values'], 'source': projection['sources'][0]['path']}
        result['scene_ref'] = ref
        result['event_order'] = {'owner_card_id': card['id'], 'before_index': index, 'source': f'{source}#payload.important_scenes'}
        actors = set(scene.get('characters', []) or [])
        for row in card['payload'].get('character_intersections', []) or []:
            if isinstance(row, dict) and row.get('scene_id') == scene.get('id'):
                actors.update(row.get('characters', []) or [])
        result['actor_ids'] = sorted(actors)
        graph = self.graph(project_id, event_ref=ref, stage='before', world_context=resolved['scope'])
        def remember(path):
            relative = path.split('#', 1)[0]
            if relative not in result['source_versions']:
                file = self.store._safe_path(project_id, relative)
                if file.is_file():
                    result['source_versions'][relative] = hashlib.sha256(file.read_bytes()).hexdigest()
            if path not in result['sources']:
                result['sources'].append(path)
        remember(source)
        remember(projection['sources'][0]['path'])
        for relation in author_state['relations']:
            if not any(item['entity_id'] in actors for item in relation['participants']):
                continue
            path = relation['sources'][-1]['path']
            result['relationships'].append({'id': relation['id'], **relation['state'], 'scope': 'author_saved', 'source': path})
            remember(path)
            if relation['stages']:
                remember(STAGES_PATH)
        for change in scene.get('relationship_changes', []) or []:
            if isinstance(change, dict):
                result['current_event_changes'].append({**{key: change.get(key, '') for key in ['source_id', 'target_id', 'relation', 'notes']}, 'scope': 'author_plan', 'source': f'{source}#payload.important_scenes.{index}.relationship_changes'})
        earlier = {row.get('id'): offset for offset, row in enumerate(rows[:index]) if isinstance(row, dict) and row.get('id')}
        for offset, line in enumerate(card['payload'].get('character_storylines', []) or []):
            if not isinstance(line, dict) or line.get('character_id') not in actors or line.get('scene_id') not in earlier:
                continue
            line_scope = scope_service.resolve(project_id, event_ref={'owner_card_id': card['id'], 'scene_id': line['scene_id']})['scope']
            if not scope_service.applies(project_id, line_scope, resolved['scope'])[0] or scope_service.filter_value(project_id, line, resolved['scope']) is None:
                continue
            result['character_stages'].append({**{key: line.get(key, '') for key in ['character_id', 'choice', 'change', 'emotion']}, 'scope': 'author_plan', 'event_ref': f'{card["id"]}:important_scenes:{line["scene_id"]}', 'source': f'{source}#payload.character_storylines.{offset}'})
        for offset, previous in enumerate(rows[:index]):
            if not isinstance(previous, dict) or previous.get('id') not in (scene.get('causal_scene_ids', []) or []):
                continue
            previous_scope = scope_service.resolve(project_id, event_ref={'owner_card_id': card['id'], 'scene_id': previous['id']})['scope']
            if not scope_service.applies(project_id, previous_scope, resolved['scope'])[0]:
                result['uncertainties'].append('一项前因的世界、分支或时间与本场不符，未当作已发生前因。')
                continue
            result['causal_events'].append({'id': previous.get('id'), 'label': previous.get('scene') or '', 'outcome': previous.get('plot') or previous.get('purpose') or '',
                                            'scope': 'author_plan', 'source': f'{source}#payload.important_scenes.{offset}'})
        causal_refs = []
        for reference in scene.get('causal_event_refs', []) or []:
            previous_owner, previous, offset, previous_ref = scope_service.event(project_id, reference)
            causal_refs.append(previous_ref)
            previous_scope = scope_service.resolve(project_id, event_ref=previous_ref)['scope']
            if not scope_service.applies(project_id, previous_scope, resolved['scope'])[0]:
                result['uncertainties'].append('跨来源前因的世界、分支或时间与本场不符，未当作已发生前因。')
                continue
            previous_source = f"cards/{previous_owner['id']}.yaml#payload.important_scenes.{offset}"
            result['causal_events'].append({'id': f"{previous_ref['owner_card_id']}:important_scenes:{previous_ref['scene_id']}", 'label': previous.get('scene') or '',
                'outcome': previous.get('plot') or previous.get('purpose') or '', 'scope': 'author_plan', 'source': previous_source})
            remember(previous_source)
        for node in graph['nodes']:
            if node['type'] == 'character_arc' and node['id'].split(':', 1)[0] in actors:
                result['arc_plans'].append({'character_id': node['id'].split(':', 1)[0], 'goal': node['label'], 'scope': 'author_plan', 'temporal_status': 'unanchored', 'source': node['source']})
                remember(node['source'])
            if node['type'] == 'fact' and node['confirmed']:
                fact_ref = self._event_ref(node.get('event_ref'))
                fact_scene = next((row for row in rows[:index] if isinstance(row, dict) and fact_ref == f'{card["id"]}:important_scenes:{row.get("id")}'), {})
                if not fact_scene and fact_ref:
                    fact_scene = scope_service.event(project_id, fact_ref)[1]
                if not (actors & set(fact_scene.get('characters', []) or [])) and fact_scene.get('id') not in (scene.get('causal_scene_ids', []) or []) and scope_service.event_ref(fact_ref) not in causal_refs:
                    continue
                result['facts'].append({'id': node['id'], 'value': node['label'], 'evidence': node['evidence'], 'source': node['source'], 'record': node.get('record', {})})
                remember(node['source'])
                if node['evidence'].get('chapter_id'):
                    remember(f'drafts/{node["evidence"]["chapter_id"]}.md')
        if not actors:
            result['uncertainties'].append('未指定出场人物；不会凭同场或目标推造人物社会关系。')
        result['uncertainties'].append('事件前后关系和成长均为作者规划，不代表人物已经知情；正文证据不符须核对，不能自动改人物事实。')
        return self._event_budget(result)

    @staticmethod
    def _event_budget(result):
        # Keep dependency versions intact; fail rather than silently remove source guards.
        maximum = result['max_chars']
        if maximum < 500:
            raise ValueError('事件材料预算过小。')
        while True:
            paths = {(result.get('event_order') or {}).get('source', '').split('#', 1)[0]}
            paths.add((result.get('projection') or {}).get('source', '').split('#', 1)[0])
            for key in ['relationships', 'current_event_changes', 'character_stages', 'arc_plans', 'causal_events', 'facts']:
                for item in result[key]:
                    paths.add(item.get('source', '').split('#', 1)[0])
                    if key == 'facts' and item.get('evidence', {}).get('chapter_id'):
                        paths.add(f'drafts/{item["evidence"]["chapter_id"]}.md')
            result['source_versions'] = {path: digest for path, digest in result['source_versions'].items() if path in paths}
            for _ in range(3):
                result['used_chars'] = len(json.dumps(result, ensure_ascii=False))
            if result['used_chars'] <= maximum:
                return result
            bucket = next((key for key in ['arc_plans', 'sources', 'uncertainties'] if result[key]), None)
            if not bucket:
                raise ValueError('事件来源版本超出本次材料预算，请缩小相关资料。')
            result[bucket].pop()
            result['omitted_count'] += 1

    def materials(self, project_id: str, chapter_id: str, scene: dict, *, max_chars: int = 12000, include_references: bool = True,
                  world_context=None, story_card_id=None, scene_ref=None, branch_id=None, pov_character_id=None) -> dict:
        from services.world_scope_service import WorldScopeService
        scope_service = WorldScopeService(self.store)
        resolved = scope_service.resolve(project_id, chapter_id=chapter_id, event_ref=scene_ref, story_card_id=story_card_id,
            world_context=world_context or scene.get('world_context'), branch_id=branch_id, pov_character_id=pov_character_id)
        scope = resolved['scope']
        graph = self.graph(project_id, chapter_id, event_ref=scene_ref, stage='before', world_context=scope)
        visible_chapters = set(graph['visible_chapters'])
        known_chapters = set(self._chapter_order(project_id))

        def visible_value(value):
            if isinstance(value, list):
                return [filtered for item in value if (filtered := visible_value(item)) is not None]
            if isinstance(value, dict):
                if any(str(value.get(key) or '') in known_chapters - visible_chapters for key in ['introduced_chapter', 'first_chapter', 'chapter', 'chapter_id', 'beat']):
                    return None
                return {key: visible_value(item) for key, item in value.items() if not (key in {'payoff_chapter', 'reveal_chapter'} and str(item) in known_chapters - visible_chapters)}
            return value
        nodes = {node['id']: node for node in graph['nodes']}
        seeds = [chapter_id, *scene.get('cast', []), *scene.get('material_ids', []), *self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('material_ids', [])]
        if scope.get('world_id'):
            seeds.append(scope['world_id'])
        seeds.extend(scope.get('region_ids', []))
        seeds.extend(scope.get('base_setting_ids', []))
        if scope.get('period_id'):
            seeds.append(scope['period_id'])
        if not scene.get('cast'):
            seeds.extend([node['id'] for node in graph['nodes'] if node['type'] == 'character'][:2])
        neighbors: dict[str, set[str]] = {}
        for relation in graph['edges']:
            if not relation.get('confirmed') or relation.get('event_ref'):
                continue
            neighbors.setdefault(relation['source'], set()).add(relation['target'])
            neighbors.setdefault(relation['target'], set()).add(relation['source'])
        queue = deque((seed, 0) for seed in seeds)
        selected = []
        visited = set()
        while queue and len(selected) < 20:
            nid, depth = queue.popleft()
            if nid in visited or nid not in nodes:
                continue
            visited.add(nid)
            if nodes[nid]['confirmed'] or nodes[nid]['type'] == 'world' and nodes[nid].get('setting_status') in {'unset', 'not_applicable'}:
                selected.append(nodes[nid])
            if depth < 2 and nodes[nid]['type'] != 'story':
                queue.extend((next_id, depth + 1) for next_id in sorted(neighbors.get(nid, [])))
        selected.extend(node for node in graph['nodes'] if node['confirmed'] and node['id'] not in visited and (node['id'] == 'style_001' or node['type'] == 'world' and
            (node['id'] == scope.get('world_id') if scope.get('world_id') else node.get('core') or not node.get('entry_type') and not node.get('parent_id'))))
        explicit_tools = set(self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('tool_skill_ids', []) or []) if include_references else set()
        result = {'cards': [], 'facts': [], 'summaries': [], 'citations': [{'id': chapter_id, 'source': f'drafts/{chapter_id}.md'}], 'relationships': [], 'max_chars': max_chars}
        used = 0
        for node in selected:
            if node['type'] == 'chapter':
                if node['id'] == chapter_id:
                    continue
                meta = self.store.read_json(project_id, f'drafts/{node["id"]}.meta.json')
                item = {'chapter_id': node['id'], 'summary': str(meta.get('chapter_summary') or '')[:700], 'source': node['source']}
                bucket = 'summaries'
            elif node['type'] == 'fact':
                item, bucket = node, 'facts'
            elif node['type'] == 'relationship':
                item, bucket = {key: value for key, value in node.items() if key not in {'stages'}}, 'cards'
            elif node['source'].endswith('.yaml'):
                card = self.store.read_yaml(project_id, node['source'])
                if card.get('type') not in {'character', 'world', 'style', 'world_rule', 'worldview', 'lore'} and not (card.get('type') == 'tool_skill' and card.get('id') in explicit_tools):
                    continue
                item = {key: card[key] for key in ['id', 'type', 'title', 'tags', 'payload'] if key in card}
                if node.get('setting_status') in {'unset', 'not_applicable'}:
                    item['payload'] = {key: card.get('payload', {})[key] for key in ['direction', 'setting_status', 'canon_status', 'domain_status'] if key in card.get('payload', {})}
                    item['constraint_only'] = True
                item = visible_value(item)
                item = scope_service.filter_value(project_id, item, scope)
                if item is None:
                    continue
                item['source'] = node['source']
                bucket = 'cards'
            else:
                item, bucket = node, 'cards'
            size = len(json.dumps(item, ensure_ascii=False))
            if used + size > max_chars:
                continue
            result[bucket].append(item)
            result['citations'].append({'id': node['id'], 'source': node['source']})
            used += size
        def finalize() -> int:
            included = {item['id'] for item in result['citations']}
            result['relationships'] = [relation for relation in graph['edges'] if relation['source'] in included and relation['target'] in included and not relation.get('event_ref')][:30]
            result['used_chars'] = 0
            for _ in range(3):
                result['used_chars'] = len(json.dumps(result, ensure_ascii=False))
            return result['used_chars']
        while finalize() > max_chars:
            bucket = next((name for name in ['cards', 'facts', 'summaries'] if result[name]), None)
            if not bucket:
                raise ValueError('材料预算过小。')
            removed = result[bucket].pop()
            result['citations'] = [citation for citation in result['citations'] if citation['source'] != removed['source']]
        result['author_scope'] = resolved
        while finalize() > max_chars:
            bucket = next((name for name in ['cards', 'facts', 'summaries'] if result[name]), None)
            if not bucket:
                raise ValueError('世界范围与材料来源超出预算。')
            removed = result[bucket].pop()
            result['citations'] = [citation for citation in result['citations'] if citation['source'] != removed['source']]
        return result
