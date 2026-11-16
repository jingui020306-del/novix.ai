from __future__ import annotations

import re

from services.knowledge_graph_service import KnowledgeGraphService
from services.planning_threads import thread_names


DIRECTIONS = ['geography', 'biology', 'physics_magic', 'metaphysics', 'technology', 'culture']
SETTING_STATUSES = ['unset', 'not_applicable', 'set']
CANON_STATUSES = ['canon', 'hypothesis', 'inspiration']
CREATION_STATUSES = ['new', 'draft', 'complete']
CHARACTER_PORTRAYAL_GUIDANCE = (
    '人物卡中的基础外貌、语言特征和性格是倾向与背景依据，不是每场固定的表情、衣服或语气。'
    '结合成长经历、此刻目标、交谈对象、压力和身体处境，使行动、沉默、措辞与情绪自然变化；'
    '服饰细节应符合场合与前后连续性，不必每场换装，也不随机堆砌反应。'
    '事件阶段材料区分进入本场前的关系与本场计划造成的变化，计划不等于已发生事实或人物已知。'
    '没有社会关系记录仍可按共同事件中的目标和阻碍推进，不擅自补亲属、恋人或敌友身份。'
)


class SharedMaterialService:
    def __init__(self, store):
        self.store = store

    def catalog(self, project_id):
        return KnowledgeGraphService(self.store).graph(project_id)['nodes']

    def _world_cards(self, project_id, chapter_id, world_ids, world_context=None):
        from services.world_scope_service import WorldScopeService
        service = WorldScopeService(self.store)
        scope = service.resolve(project_id, chapter_id=chapter_id, world_context=world_context)['scope']
        cards = []
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if card.get('type') in {'world', 'world_rule', 'lore', 'worldview'}:
                cards.append((card, f'cards/{path.name}'))
        root = next((card for card, _ in cards if card.get('id') == scope.get('world_id')), None)
        root = root or next((card for card, _ in cards if card.get('payload', {}).get('entry_type') == 'world'), None)
        root = root or next((card for card, _ in cards if card.get('type') == 'world' and not card.get('payload', {}).get('parent_id') and not card.get('payload', {}).get('direction')), None)
        root = root or next((card for card, _ in cards if not card.get('payload', {}).get('parent_id') and not card.get('payload', {}).get('direction')), None)
        selected = set(world_ids) | ({root['id']} if root and root.get('id') else set())
        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
        visible = set(order[:order.index(chapter_id) + 1]) if chapter_id in order else set()
        for card, source in cards:
            payload = card.get('payload', {})
            if card.get('id') not in selected:
                continue
            if not service.card_visible(project_id, card, scope):
                continue
            if scope.get('world_id') and not service.belongs_to_world(project_id, card, scope['world_id']):
                continue
            if payload.get('setting_status') in {'unset', 'not_applicable'} or payload.get('canon_status') in {'hypothesis', 'inspiration'} or payload.get('confirmation_status') in {'pending', 'pending_author_review'}:
                continue
            if chapter_id is not None and any(payload.get(key) in set(order) - visible for key in ['introduced_chapter', 'first_chapter']):
                continue
            yield card, source

    def address_rules(self, project_id, chapter_id=None, *, world_ids=(), world_context=None):
        return [{'id': f"address_rules:{card['id']}", 'card_id': card['id'], 'label': card.get('title') or card['id'],
                 'text': text.strip(), 'source': f'{source}#payload.extra_context.address_rules'}
                for card, source in self._world_cards(project_id, chapter_id, world_ids, world_context)
                if isinstance(text := (card.get('payload', {}).get('extra_context') or {}).get('address_rules'), str) and text.strip()]

    def world_baselines(self, project_id, chapter_id=None, *, world_ids=(), world_context=None):
        return [{'id': f"world_base:{card['id']}", 'card_id': card['id'], 'label': card.get('title') or card['id'],
                 'value': value, 'source': f'{source}#payload.extra_context.world_base'}
                for card, source in self._world_cards(project_id, chapter_id, world_ids, world_context)
                if isinstance(value := (card.get('payload', {}).get('extra_context') or {}).get('world_base'), dict) and any(v not in ('', None) for v in value.values())]

    def backlinks(self, project_id, target_id):
        graph = KnowledgeGraphService(self.store).graph(project_id)
        nodes = {node['id']: node for node in graph['nodes']}
        if target_id not in nodes:
            raise ValueError('引用的资料不存在，请重新选择。')
        return {'target_id': target_id, 'items': [
            {'source_id': edge['source'], 'label': nodes[edge['source']]['label'], 'type': nodes[edge['source']]['type'],
             'source': nodes[edge['source']]['source'], 'relation': edge['label'], 'evidence': edge.get('evidence', {})}
            for edge in graph['edges'] if edge['target'] == target_id
        ]}

    def deletion_impact(self, project_id, target_id, *, owned_ids=()):
        graph = KnowledgeGraphService(self.store)._base_graph(project_id, None)
        nodes = {node['id']: node for node in graph['nodes']}
        target_path = f'cards/{target_id}.yaml'
        owned = {target_id, *owned_ids, *(node['id'] for node in graph['nodes'] if node.get('source', '').split('#', 1)[0] == target_path)}
        items, seen = [], set()
        def add(label, source, relation):
            key = (source, relation)
            if key not in seen:
                seen.add(key)
                items.append({'label': label, 'source': source, 'relation': relation})
        for edge in graph['edges']:
            node = nodes.get(edge['source'])
            if edge['target'] in owned and node and node.get('source', '').split('#', 1)[0] != target_path:
                add(node['label'], node['source'], edge['label'])
        single = {'world_id', 'parent_id', 'story_card_id', 'pov_character_id', 'target', 'target_id', 'entity_id', 'owner_card_id', 'speaker_id', 'character_id', 'card_id', 'technique_id', 'information_id', 'relationship_id'}
        plural = {'material_ids', 'writing_references', 'tool_skill_ids', 'cast', 'characters', 'character_ids', 'audience_ids', 'heard_by', 'base_setting_ids', 'region_ids', 'information_ids'}
        def scan(value, source, label, pointer=''):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key in single and isinstance(child, str) and child in owned or key in plural and isinstance(child, list) and any(isinstance(ref, str) and ref in owned for ref in child) or key == 'path' and isinstance(child, str) and child.split('#', 1)[0] == target_path:
                        add(label, source + '#' + pointer + '/' + key, '保存的资料关联')
                    scan(child, source, label, pointer + '/' + key)
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    scan(child, source, label, pointer + '/' + str(index))
        for path in self.store._safe_path(project_id, 'cards').glob('*.yaml'):
            source = f'cards/{path.name}'
            if source != target_path:
                card = self.store.read_yaml(project_id, source)
                scan(card, source, card.get('title') or '已有资料')
        for path in self.store._safe_path(project_id, 'drafts').glob('*.meta.json'):
            source = f'drafts/{path.name}'
            value = self.store.read_json(project_id, source)
            scan(value, source, value.get('title') or '章节关联')
        for source in ['canon/author_stages.jsonl', 'canon/facts.jsonl', 'canon/revisions.jsonl']:
            rows = self.store.read_jsonl(project_id, source)
            voids = {identity for row in rows for identity in row.get('voids', [])}
            scan([row for row in rows if row.get('kind') != 'void' and row.get('id') not in voids], source, '阶段与事实历史')
        return {'target_id': target_id, 'items': items}

    def assert_card_deletions(self, project_id, operations):
        removed = [row['path'] for row in operations if row.get('kind') == 'replace' and row['path'].startswith('cards/') and row.get('after') is None]
        if not removed:
            return
        import json
        from services.material_import_service import _PlannedStore
        from storage.fs_store import _read_simple_yaml
        files, appends = {}, {}
        for operation in operations:
            path = operation['path']
            if operation['kind'] == 'append':
                appends.setdefault(path, []).extend(operation['rows'])
            elif operation.get('after') is None:
                files[path] = None
            elif 'after_value' in operation:
                files[path] = operation['after_value']
            else:
                try:
                    files[path] = json.loads(operation['after'])
                except ValueError:
                    files[path] = _read_simple_yaml(operation['after'])
        original = KnowledgeGraphService(self.store)._base_graph(project_id, None)
        projected = SharedMaterialService(_PlannedStore(self.store, files, appends))
        impacts = []
        for path in removed:
            owned = [node['id'] for node in original['nodes'] if node.get('source', '').split('#', 1)[0] == path]
            impacts.extend(projected.deletion_impact(project_id, path.removeprefix('cards/').removesuffix('.yaml'), owned_ids=owned)['items'])
        if impacts:
            error = FileExistsError('后来保存的资料仍引用本次新增内容，撤销已暂停，请先核对这些关联。')
            error.impact = impacts
            raise error

    def validate_ids(self, project_id, values, *, previous=(), extra_ids=()):
        if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
            raise ValueError('关联资料必须从资料列表中选择。')
        valid = {node['id'] for node in self.catalog(project_id)} | set(extra_ids)
        # Legacy links are preserved; newly added references must resolve to a real entity.
        if any(value not in valid and value not in previous for value in values):
            raise ValueError('关联的资料不存在，请重新选择人物、世界条目或章节。')

    def validate_card(self, project_id, card_id, card, previous=None):
        previous = previous or {}
        payload = card.get('payload') or {}
        before = previous.get('payload') or {}
        if not isinstance(payload, dict):
            raise ValueError('设定内容格式不正确。')
        from services.world_scope_service import WorldScopeService
        world_scope = WorldScopeService(self.store)
        if 'world_context' in payload:
            world_scope.validate_context(project_id, payload['world_context'])
        if 'information_ids' in payload:
            from services.information_service import InformationService
            refs = payload['information_ids']
            available = {row['id'] for row in InformationService(self.store).list(project_id)}
            if not isinstance(refs, list) or any(not isinstance(ref, str) or ref not in available for ref in refs):
                raise ValueError('关联信息须选择已保存的信息条目，不复制秘密或事件。')
        if 'maps' in payload:
            from services.world_map_material_service import validate_maps
            validate_maps(self.store, project_id, card)
        if card.get('type') == 'character':
            if 'detail_sections' in payload:
                from services.character_detail_service import validate_detail_sections
                validate_detail_sections(self.store, project_id, payload['detail_sections'])
            if payload.get('detail_level') not in {None, 'brief', 'detailed'}:
                raise ValueError('人物资料请选择简略或详细。')
            if 'initial_age' in payload and (isinstance(payload['initial_age'], bool) or not isinstance(payload['initial_age'], (int, float)) or payload['initial_age'] < 0):
                raise ValueError('初始年龄须为非负数；不确定时请留空。')
            if payload.get('initial_age_time'):
                world_scope.validate_context(project_id, {'time': payload['initial_age_time']})
            if payload.get('birth_date'):
                world_scope.validate_context(project_id, {'time': {'date': payload['birth_date']}})
            for key, limit in [('gender', 200), ('pronouns', 200), ('address_notes', 2000)]:
                if key in payload and (not isinstance(payload[key], str) or len(payload[key]) > limit):
                    raise ValueError('人物性别、代词与称呼说明须为文字；短项最多200字，说明最多2000字。')
        if 'links' in card:
            self.validate_ids(project_id, card['links'], previous=previous.get('links', []), extra_ids=[card_id])
        if 'material_ids' in payload:
            self.validate_ids(project_id, payload['material_ids'], previous=before.get('material_ids', []), extra_ids=[card_id])
        if 'relationships' in payload:
            rows = payload['relationships']
            if not isinstance(rows, list) or any(not isinstance(row, dict) or not isinstance(row.get('target'), str) for row in rows):
                raise ValueError('人物或世界关系格式不正确，请重新选择关联目标。')
            if any('address_as' in row and (not isinstance(row['address_as'], str) or len(row['address_as']) > 200) for row in rows):
                raise ValueError('特殊关系称呼须为200字以内的文字。')
            self.validate_ids(project_id, [row['target'] for row in rows], previous=[row.get('target') for row in before.get('relationships', []) if isinstance(row, dict)], extra_ids=[card_id])
        scenes = payload.get('important_scenes', [])
        if card.get('type') in {'story', 'outline'} and isinstance(scenes, list):
            for row in scenes:
                if isinstance(row, dict) and 'world_context' in row:
                    world_scope.validate_context(project_id, row['world_context'])
                if isinstance(row, dict) and row.get('pov') and (not isinstance(row['pov'], str) or len(row['pov']) > 2000):
                    raise ValueError('场景叙述视角须为2000字以内的文字。')
                if isinstance(row, dict) and row.get('pov_character_id'):
                    from services.world_scope_service import entity_id
                    target = entity_id(row['pov_character_id'], '视角人物')
                    if self.store.read_yaml(project_id, f'cards/{target}.yaml').get('type') != 'character':
                        raise ValueError('视角人物不存在，请选择已有角色。')
                if isinstance(row, dict) and 'information_ids' in row:
                    from services.information_service import InformationService
                    available = {item['id'] for item in InformationService(self.store).list(project_id)}
                    if not isinstance(row['information_ids'], list) or any(not isinstance(ref, str) or ref not in available for ref in row['information_ids']):
                        raise ValueError('事件须引用已保存的信息编号。')
            if any(isinstance(row, dict) and 'causal_event_refs' in row for row in scenes):
                world_scope.validate_event_links(project_id, card)
        if card.get('type') in {'story', 'outline'} and isinstance(scenes, list) and any(isinstance(row, dict) and ('causal_scene_ids' in row or 'relationship_changes' in row) for row in scenes):
            ids = [row.get('id') for row in scenes if isinstance(row, dict)]
            if any(not isinstance(sid, str) or not re.fullmatch(r'[\w-]+', sid) for sid in ids) or len(set(ids)) != len(ids):
                raise ValueError('连接事件前，请为每件事保留唯一的事件编号。')
            causes, following = {}, {sid: [] for sid in ids}
            entities = {node['id'] for node in self.catalog(project_id) if node['type'] in {'character', 'world', 'world_rule', 'worldview', 'lore'}}
            for row in scenes:
                if not isinstance(row, dict):
                    raise ValueError('事件内容格式不正确。')
                predecessors = row.get('causal_scene_ids', [])
                if not isinstance(predecessors, list) or any(not isinstance(sid, str) or sid not in following or sid == row['id'] for sid in predecessors) or len(set(predecessors)) != len(predecessors):
                    raise ValueError('前因必须选择同一工作表中的其他事件，不能重复或连接自己。')
                causes[row['id']] = len(predecessors)
                for sid in predecessors:
                    following[sid].append(row['id'])
                changes = row.get('relationship_changes', [])
                if not isinstance(changes, list) or any(not isinstance(change, dict) for change in changes):
                    raise ValueError('事件中的关系变化格式不正确。')
                change_ids = [change.get('id') for change in changes]
                if any(not isinstance(cid, str) or not re.fullmatch(r'[\w-]+', cid) for cid in change_ids) or len(set(change_ids)) != len(change_ids):
                    raise ValueError('关系变化编号无效或重复，请重新添加该项。')
                for change in changes:
                    if any(not isinstance(change.get(key), str) or change[key] not in entities for key in ['source_id', 'target_id']) or change['source_id'] == change['target_id']:
                        raise ValueError('请选择关系两端已有的人物或世界条目，两端不能相同。')
                    if any(not isinstance(change.get(key, ''), str) or len(change.get(key, '')) > limit for key, limit in [('relation', 500), ('notes', 2000)]):
                        raise ValueError('关系说明须为文字，关系名称最多500字、补充最多2000字。')
            ready = [sid for sid, count in causes.items() if not count]
            visited = 0
            while ready:
                visited += 1
                for sid in following[ready.pop()]:
                    causes[sid] -= 1
                    if causes[sid] == 0:
                        ready.append(sid)
            if visited != len(causes):
                raise ValueError('事件前因形成循环，请调整连接，保留可推进的因果关系。')
        if card.get('type') == 'story':
            for row in payload.get('foreshadowings', []) or []:
                if not isinstance(row, dict):
                    continue
                for key in ['first_event_ref', 'payoff_event_ref']:
                    if key not in row:
                        continue
                    ref = row[key]
                    if not isinstance(ref, dict) or any(not isinstance(ref.get(k), str) or not re.fullmatch(r'[\w-]+', ref[k]) for k in ['owner_card_id', 'scene_id']):
                        raise ValueError('伏笔的事件锚点格式不正确，请重新选择事件。')
                    owner = card if ref['owner_card_id'] == card_id else self.store.read_yaml(project_id, f"cards/{ref['owner_card_id']}.yaml")
                    if owner.get('type') not in {'story', 'outline'} or owner.get('type') == 'story' and owner.get('id') != card_id or owner.get('type') == 'outline' and owner.get('payload', {}).get('story_card_id') != card_id:
                        raise ValueError('请选择本故事的情节作为伏笔锚点。')
                    if not any(isinstance(event, dict) and ref['scene_id'] in {str(event.get('id') or index), f'index_{index}' if not event.get('id') else ''} for index, event in enumerate(owner.get('payload', {}).get('important_scenes', []))):
                        raise ValueError('伏笔关联事件尚未保存或已不存在，请先保存工作表再选择。')
        if card.get('type') == 'outline' and payload.get('planning_worksheet'):
            threads = payload.get('plot_threads', [])
            if not isinstance(threads, list) or any(not isinstance(row, dict) or not isinstance(row.get('id'), str) or not re.fullmatch(r'[\w-]+', row['id']) or not isinstance(row.get('name'), str) for row in threads):
                raise ValueError('故事线列表格式不正确，请填写名称并使用有效的故事线编号。')
            if len({row['id'] for row in threads}) != len(threads):
                raise ValueError('故事线编号重复，请保留一份。')
            valid_threads, old_threads = thread_names(payload), thread_names(before)
            for table in ['important_scenes', 'character_intersections', 'character_storylines', 'beat_sheet']:
                old_rows = {row.get('id'): row for row in before.get(table, []) or [] if isinstance(row, dict)}
                for row in payload.get(table, []) or []:
                    if table == 'character_storylines' and isinstance(row, dict) and 'emotion' in row and (not isinstance(row['emotion'], str) or len(row['emotion']) > 2000):
                        raise ValueError('人物情绪变化须为2000字以内的文字。')
                    if table == 'important_scenes' and isinstance(row, dict) and row.get('thread_id'):
                        tid = row['thread_id']
                        old_tid = old_rows.get(row.get('id'), {}).get('thread_id')
                        if not isinstance(tid, str) or tid not in valid_threads and (tid != old_tid or tid in old_threads):
                            raise ValueError('事件关联的故事线不存在；请先调整事件归属，再移除故事线。')
                    if isinstance(row, dict) and 'material_ids' in row:
                        self.validate_ids(project_id, row['material_ids'], previous=old_rows.get(row.get('id'), {}).get('material_ids', []), extra_ids=[card_id])
        if card.get('type') in {'world', 'world_rule', 'lore', 'worldview'}:
            extra = payload.get('extra_context', {})
            if not isinstance(extra, dict) or 'address_rules' in extra and (not isinstance(extra['address_rules'], str) or len(extra['address_rules']) > 2000):
                raise ValueError('世界称谓通则须为2000字以内的文字。')
            if 'world_base' in extra:
                base = extra['world_base']
                if not isinstance(base, dict) or any(key in base and (not isinstance(base[key], str) or len(base[key]) > limit) for key, limit in [('reference', 200), ('changes', 4000), ('history', 4000)]):
                    raise ValueError('世界基准须为文字说明：参照最多200字，改动和历史各最多4000字。')
                if any(key in base and (isinstance(base[key], bool) or not isinstance(base[key], int)) for key in ['base_year', 'offset_years']):
                    raise ValueError('基准年份和前后偏移请填写整数；未确定时可以留空。')
        if card.get('type') != 'world':
            return
        for key, allowed in [('direction', DIRECTIONS), ('setting_status', SETTING_STATUSES), ('canon_status', CANON_STATUSES), ('creation_status', CREATION_STATUSES)]:
            if key in payload and payload[key] and payload[key] not in allowed:
                raise ValueError({'direction': '请选择有效的世界方向。', 'setting_status': '请选择未设定、不适用或已设定。', 'canon_status': '请选择正典、推定或灵感。', 'creation_status': '请选择新增、待完善或已完成。'}[key])
        statuses = payload.get('domain_status', {})
        if not isinstance(statuses, dict) or any(key not in DIRECTIONS or value not in SETTING_STATUSES for key, value in statuses.items()):
            raise ValueError('世界方向状态格式不正确。')
        parent_id = payload.get('parent_id') or ''
        seen = {card_id}
        while parent_id:
            if not isinstance(parent_id, str) or not re.fullmatch(r'[\w-]+', parent_id):
                raise ValueError('上级世界条目不存在，请重新选择。')
            if parent_id in seen:
                raise ValueError('世界条目不能成为自己或下级条目的上级。')
            seen.add(parent_id)
            parent = self.store.read_yaml(project_id, f'cards/{parent_id}.yaml')
            if parent.get('type') not in {'world', 'world_rule', 'lore', 'worldview'}:
                raise ValueError('上级世界条目不存在，请重新选择。')
            parent_id = parent.get('payload', {}).get('parent_id') or ''

    def affected_chapters(self, project_id, card_id, before, after, *, local_scene=False):
        graph = KnowledgeGraphService(self.store).graph(project_id)
        chapter_nodes = {node['id'] for node in graph['nodes'] if node['type'] == 'chapter'}
        containers = {node['id'] for node in graph['nodes'] if node['type'] in {'story', 'outline'}}
        reverse = {}
        for edge in graph['edges']:
            if local_scene and (edge['source'] in containers or edge['target'] in containers):
                continue
            # World hierarchy does not imply that every sibling affects every chapter.
            if edge['label'] not in {'上级条目'}:
                reverse.setdefault(edge['target'], set()).add(edge['source'])
            if edge['label'] in {'计划章节', '发生 / 埋设于'}:
                reverse.setdefault(edge['source'], set()).add(edge['target'])
            if edge['label'] in {'章节计划', '情节规划', '明线', '暗线', '伏笔'}:
                reverse.setdefault(edge['source'], set()).add(edge['target'])
            if edge['label'] in {'引用', '关联资料'} and edge['target'] in chapter_nodes:
                reverse.setdefault(edge['source'], set()).add(edge['target'])
        related = {card_id}
        if local_scene and after.get('payload', {}).get('chapter') in chapter_nodes:
            related.add(after['payload']['chapter'])
        frontier = {card_id}
        for _ in range(3):
            frontier = {source for target in frontier for source in reverse.get(target, [])} - related
            related.update(frontier)
        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
        terms = set()
        for card in [before, after]:
            for value in [card.get('title'), card.get('payload', {}).get('name'), *(card.get('payload', {}).get('aliases') or [])]:
                if isinstance(value, str) and len(value.strip()) >= 2:
                    terms.add(value.strip())
        affected = []
        for chapter_id in order:
            text = self.store.read_md(project_id, f'drafts/{chapter_id}.md')
            if not '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#')).strip():
                continue
            meta = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json')
            used = meta.get('context_manifest') or {}
            used_ids = {item.get('id') for item in used.get('included_cards', []) if isinstance(item, dict)}
            used_ids.update(item.get('id') for item in used.get('linked_materials', {}).get('cards', []) if isinstance(item, dict))
            used_ids.update(used.get('context_pack', {}).get('used_ids', []))
            for path in self.store._safe_path(project_id, f'meta/memory_packs/{chapter_id}').glob('*.json'):
                pack = self.store.read_json(project_id, f'meta/memory_packs/{chapter_id}/{path.name}')
                used_ids.update(item.get('id') for item in pack.get('included_cards', []) if isinstance(item, dict))
                used_ids.update(item.get('id') for item in pack.get('linked_materials', {}).get('cards', []) if isinstance(item, dict))
                used_ids.update(pack.get('context_pack', {}).get('used_ids', []))
            mentioned = [term for term in terms if re.search(rf'(?<![A-Za-z0-9_]){re.escape(term)}(?![A-Za-z0-9_])', text)]
            if chapter_id in related or card_id in used_ids or mentioned:
                affected.append({'chapter_id': chapter_id, 'reasons': ['已保存引用'] if chapter_id in related else ['曾用于本章生成'] if card_id in used_ids else ['正文明确提及'], 'mentions': mentioned})
        return affected
