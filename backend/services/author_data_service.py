from __future__ import annotations

import copy
import json
import uuid

from services.world_scope_service import WorldScopeService, entity_id
from storage.fs_store import now_iso


REGISTRY_ID = 'outline_author_registry'
STAGES_PATH = 'canon/author_stages.jsonl'
EVENT_LOCAL_FIELDS = ('chapter', 'thread_id', 'beat_id', 'notes')


class AuthorDataService:
    """Shared author objects stay on cards; changing states stay in append-only canon."""

    def __init__(self, store):
        self.store = store
        self.world = WorldScopeService(store)

    def _lock(self, project_id):
        from services.change_suggestion_service import ChangeSuggestionService
        return ChangeSuggestionService(self.store).lock(project_id)

    def _version(self, project_id, rel, value):
        from services.edit_version_service import decorate
        return decorate(self.store, project_id, rel, value)

    def _check_version(self, project_id, rel, expected):
        from services.edit_version_service import check_revision
        check_revision(self.store, project_id, rel, expected)

    def _cards(self, project_id):
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if card.get('id'):
                yield card, f'cards/{path.name}'

    @staticmethod
    def _event_id(owner, scene):
        return f'{owner}:important_scenes:{scene}'

    def events(self, project_id, story_card_id=None):
        rows = []
        for card, source in self._cards(project_id):
            if card.get('type') not in {'story', 'outline'}:
                continue
            story = card['id'] if card.get('type') == 'story' else card.get('payload', {}).get('story_card_id')
            if story_card_id and story != story_card_id:
                continue
            for index, row in enumerate(card.get('payload', {}).get('important_scenes', []) or []):
                if not isinstance(row, dict):
                    continue
                scene_id = str(row.get('id') or f'index_{index}')
                ref = {'owner_card_id': card['id'], 'scene_id': scene_id}
                item = {'id': self._event_id(card['id'], scene_id), 'owner_card_id': card['id'], 'scene_id': scene_id, 'story_card_id': story,
                        'values': copy.deepcopy(row), 'sources': [{'path': f'{source}#payload.important_scenes.{index}'}], 'aliases': [], 'duplicate_conflicts': []}
                item['canonical_id'] = item['id']
                item['canonical_source'] = item['sources'][0]['path']
                item['local_values'] = {key: copy.deepcopy(row[key]) for key in EVENT_LOCAL_FIELDS if key in row}
                item['effective_values'] = copy.deepcopy(row)
                if row.get('canonical_event_ref'):
                    try:
                        _, original, original_index, canonical = self.world.event(project_id, ref)
                        item['canonical_id'] = self._event_id(canonical['owner_card_id'], canonical['scene_id'])
                        item['aliases'].append(canonical)
                        item['shared_values'] = copy.deepcopy(original)
                        item['effective_values'] = {**copy.deepcopy(original), **copy.deepcopy(item['local_values'])}
                        item['canonical_source'] = f"cards/{canonical['owner_card_id']}.yaml#payload.important_scenes.{original_index}"
                    except (ValueError, FileNotFoundError) as exc:
                        item['duplicate_conflicts'].append({'kind': 'broken_mapping', 'message': str(exc)})
                decorated = self._version(project_id, source, item)
                if item['canonical_id'] != item['id'] and item.get('shared_values'):
                    canonical_owner = self.world.event_ref(item['canonical_id'])['owner_card_id']
                    decorated['source_revision'] = decorated['_revision']
                    decorated['_revision'] = self._version(project_id, f'cards/{canonical_owner}.yaml', {})['_revision']
                rows.append(decorated)
        for item in rows:
            matches = [other for other in rows if other['id'] != item['id'] and other['story_card_id'] == item['story_card_id'] and
                       (other['scene_id'] == item['scene_id'] or (str(item['values'].get('scene') or '').strip() and other['values'].get('scene') == item['values'].get('scene')))]
            for other in matches:
                if item['canonical_id'] == other['canonical_id']:
                    item['aliases'].append({'owner_card_id': other['owner_card_id'], 'scene_id': other['scene_id']})
                else:
                    item['duplicate_conflicts'].append({'kind': 'identity_unconfirmed', 'event_id': other['id'], 'message': '同名或同编号不代表同一事件；需确认来源映射，原行均保留。'})
        return rows

    def event_projection(self, project_id, reference, chapter_id=None):
        ref = self.world.event_ref(reference)
        event = self.event(project_id, ref['owner_card_id'], ref['scene_id'])
        if not chapter_id or event['id'] != event['canonical_id'] or event['effective_values'].get('chapter') == chapter_id:
            return event
        matches = [item for item in self.events(project_id) if item['canonical_id'] == event['canonical_id'] and item['effective_values'].get('chapter') == chapter_id]
        if len(matches) > 1:
            raise ValueError('同一事件在本章有多份表内安排，请明确选择当前工作表中的那一行。')
        return matches[0] if matches else event

    def event(self, project_id, owner_id, scene_id):
        entity_id(owner_id, '来源')
        entity_id(scene_id, '事件')
        events = self.events(project_id)
        match = next((row for row in events if row['owner_card_id'] == owner_id and row['scene_id'] == scene_id), None)
        # Old unnumbered rows used ":0"; the catalog now labels that same row "index_0".
        if not match and scene_id.isdigit():
            match = next((row for row in events if row['owner_card_id'] == owner_id and row['scene_id'] == f'index_{scene_id}' and not row['values'].get('id')), None)
        if not match:
            raise FileNotFoundError('这个事件已不存在。')
        return match

    def _save_card(self, project_id, card, before):
        from services.shared_material_service import SharedMaterialService
        from services.incremental_memory_service import IncrementalMemoryService
        source = f"cards/{card['id']}.yaml"
        clean = {key: value for key, value in card.items() if key not in {'_revision', 'change_suggestions'}}
        from services.author_control_service import AuthorControlService
        AuthorControlService(self.store).assert_write(project_id, source, before, clean)
        SharedMaterialService(self.store).validate_card(project_id, card['id'], clean, before)
        clean['updated_at'] = now_iso()
        self.store.write_yaml(project_id, source, clean)
        IncrementalMemoryService(self.store).mark(project_id, source)
        return clean

    def update_event(self, project_id, owner_id, scene_id, body):
        with self._lock(project_id):
            row = self.event(project_id, owner_id, scene_id)
            if row['canonical_id'] != row['id']:
                canonical = self.world.event_ref(row['canonical_id'])
                return self.update_event(project_id, canonical['owner_card_id'], canonical['scene_id'], body)
            source = f'cards/{owner_id}.yaml'
            self._check_version(project_id, source, body.get('base_revision', body.get('_revision')))
            owner = self.store.read_yaml(project_id, source)
            before = copy.deepcopy(owner)
            index = next(index for index, value in enumerate(owner['payload']['important_scenes']) if isinstance(value, dict) and scene_id == str(value.get('id') or f'index_{index}'))
            value = body.get('values')
            if not isinstance(value, dict):
                raise ValueError('事件内容须为对象。')
            if value.get('id', owner['payload']['important_scenes'][index].get('id')) != owner['payload']['important_scenes'][index].get('id'):
                raise ValueError('事件编号不能通过改标题或保存改动。')
            if value.get('world_context'):
                self.world.validate_context(project_id, value['world_context'])
            saved_rehearsal = owner['payload']['important_scenes'][index].get('rehearsal')
            if saved_rehearsal:
                if value.get('rehearsal') is not None and value['rehearsal'] != saved_rehearsal:
                    raise FileExistsError('场景安排请回正文场景编辑器修改；事件保存不会覆盖已有推演。')
                value = {**value, 'rehearsal': copy.deepcopy(saved_rehearsal)}
            if value.get('canonical_event_ref'):
                target = self.world.event(project_id, value['canonical_event_ref'])[-1]
                if target == {'owner_card_id': owner_id, 'scene_id': scene_id}:
                    raise ValueError('事件不能映射到自己。')
            owner['payload']['important_scenes'][index] = copy.deepcopy(value)
            self._save_card(project_id, owner, before)
            return self.event(project_id, owner_id, scene_id)

    def prepare_relationship(self, project_id, body, previous=None, *, extra_entities=None):
        previous = previous or {}
        participants = body.get('participants')
        if not isinstance(participants, list) or not 2 <= len(participants) <= 30:
            raise ValueError('共享关系请选择2至30位参与者，共同经历请放在事件中。')
        if any(not isinstance(item, dict) for item in participants):
            raise ValueError('关系参与者格式不正确。')
        for item in participants:
            entity_id(item.get('entity_id'), '关系参与者')
        ids = [item.get('entity_id') if isinstance(item, dict) else None for item in participants]
        if len(set(ids)) != len(ids):
            raise ValueError('关系参与者不能重复。')
        for item in participants:
            card_id = entity_id(item.get('entity_id'), '关系参与者')
            if not self.store.read_yaml(project_id, f'cards/{card_id}.yaml') and card_id not in (extra_entities or {}):
                raise ValueError('关系参与者不存在，请重新选择。')
            for key in ['role', 'address_as']:
                if key in item and (not isinstance(item[key], str) or len(item[key]) > 500):
                    raise ValueError('参与角色和称呼须为500字以内文字。')
            target = item.get('address_target_id')
            if target and (target not in ids or target == card_id):
                raise ValueError('称呼对象须为同一关系中的另一位参与者。')
            if item.get('address_as') and len(ids) > 2 and not target:
                raise ValueError('多人关系中的特殊称呼须明确称呼哪位参与者。')
            addresses = item.get('addresses', [])
            if not isinstance(addresses, list) or len(addresses) > 30:
                raise ValueError('有向称呼须为最多30项的列表。')
            for address in addresses:
                if not isinstance(address, dict) or address.get('target_id') not in ids or address.get('target_id') == card_id or not isinstance(address.get('address_as'), str):
                    raise ValueError('有向称呼须写明同一关系中的另一位人物。')
        if body.get('direction', 'undirected') not in {'directed', 'undirected'}:
            raise ValueError('关系方向请选择有向或无向；人物顺序不会被自动颠倒。')
        for key, maximum in [('label', 500), ('notes', 6000)]:
            if not isinstance(body.get(key, ''), str) or len(body.get(key, '')) > maximum:
                raise ValueError('关系名称或补充说明过长。')
        scope = body.get('scope') or {}
        self.world.validate_context(project_id, scope, extra_entities=extra_entities)
        return {'id': previous.get('id') or body.get('id') or f'relationship_{uuid.uuid4().hex[:14]}',
                'label': body.get('label', ''), 'participants': copy.deepcopy(participants), 'direction': body.get('direction', 'undirected'),
                'notes': body.get('notes', ''), 'scope': copy.deepcopy(scope), 'sources': copy.deepcopy(body.get('sources') or previous.get('sources') or [])}

    def relationships(self, project_id):
        result = []
        for card, source in self._cards(project_id):
            payload = card.get('payload', {})
            for index, row in enumerate(payload.get('relationship_registry', []) or []):
                if not isinstance(row, dict) or not row.get('id'):
                    continue
                path = ['payload', 'relationship_registry', str(index)]
                result.append(self._version(project_id, source, {**copy.deepcopy(row), 'stages': self.stages(project_id, 'relationship', row['id']),
                    'sources': [*(row.get('sources') or []), {'path': f'{source}#payload.relationship_registry.{index}'}],
                    'owner_card_id': card['id'], 'owner_path': path, 'legacy': False}))
            for index, row in enumerate(payload.get('relationships', []) or []):
                if not isinstance(row, dict) or not row.get('target'):
                    continue
                record = {'id': f"legacy:{card['id']}:relationships:{index}", 'label': row.get('type') or '人物关系',
                          'participants': [{'entity_id': card['id'], 'role': '', **({'address_as': row['address_as']} if 'address_as' in row else {})}, {'entity_id': row['target'], 'role': ''}],
                          'direction': 'directed', 'notes': row.get('notes', ''), 'scope': row.get('scope') or payload.get('world_context') or {}, 'stages': [],
                          'sources': [{'path': f'{source}#payload.relationships.{index}'}], 'owner_card_id': card['id'], 'owner_path': ['payload', 'relationships', str(index)], 'legacy': True}
                result.append(self._version(project_id, source, record))
        return result

    def relationship(self, project_id, relationship_id):
        item = next((row for row in self.relationships(project_id) if row['id'] == relationship_id), None)
        if not item:
            raise FileNotFoundError('这条关系不存在。')
        return item

    def create_relationship(self, project_id, body):
        with self._lock(project_id):
            row = self.prepare_relationship(project_id, body)
            entity_id(row['id'], '关系')
            if any(item['id'] == row['id'] for item in self.relationships(project_id)):
                raise ValueError('关系编号已存在，请编辑同一条记录。')
            source = f'cards/{REGISTRY_ID}.yaml'
            self._check_version(project_id, source, body.get('_revision'))
            card = self.store.read_yaml(project_id, source) or {'id': REGISTRY_ID, 'type': 'outline', 'title': '共享人物关系', 'tags': [], 'links': [], 'payload': {}}
            before = copy.deepcopy(card)
            card.setdefault('payload', {}).setdefault('relationship_registry', []).append(row)
            self._save_card(project_id, card, before)
            return self.relationship(project_id, row['id'])

    def update_relationship(self, project_id, relationship_id, body):
        with self._lock(project_id):
            old = self.relationship(project_id, relationship_id)
            source = f"cards/{old['owner_card_id']}.yaml"
            self._check_version(project_id, source, body.get('_revision'))
            row = self.prepare_relationship(project_id, body, old)
            card = self.store.read_yaml(project_id, source)
            before = copy.deepcopy(card)
            index = int(old['owner_path'][-1])
            if old['legacy']:
                # Preserve the old owner's perspective and original shape; never migrate on read.
                owner = old['owner_card_id']
                by_id = {item['entity_id']: item for item in row['participants']}
                other = old['participants'][1]['entity_id']
                if set(by_id) != {owner, other}:
                    raise ValueError('旧关系请在原记录修改这两位人物；多人共享关系请新建。')
                original = card['payload']['relationships'][index]
                original.update(type=row['label'], notes=row['notes'])
                if 'address_as' in by_id[owner]:
                    original['address_as'] = by_id[owner]['address_as']
                if by_id[other].get('address_as') != old['participants'][1].get('address_as'):
                    raise ValueError('旧关系只保存原人物如何称呼对方，不能反写对方称呼。')
            else:
                card['payload']['relationship_registry'][index] = row
            self._save_card(project_id, card, before)
            return self.relationship(project_id, relationship_id)

    def stages(self, project_id, entity_type, target_id):
        return [self._version(project_id, STAGES_PATH, row) for row in self.store.read_jsonl(project_id, STAGES_PATH)
                if row.get('entity_type') == entity_type and row.get('entity_id') == target_id]

    def prepare_stage(self, project_id, entity_type, target_id, body, *, extra_entities=None):
        """Validate an import/manual stage without writing; callers can journal append atomically."""
        if entity_type not in {'character', 'world', 'relationship'}:
            raise ValueError('不支持这类阶段记录。')
        if entity_type == 'relationship':
            if (extra_entities or {}).get(target_id) != 'relationship':
                self.relationship(project_id, target_id)
        else:
            entity_id(target_id)
            card = self.store.read_yaml(project_id, f'cards/{target_id}.yaml')
            card_type = card.get('type') or (extra_entities or {}).get(target_id)
            if not card_type or (entity_type == 'character' and card_type != 'character') or (entity_type == 'world' and card_type not in {'world', 'worldview', 'lore', 'world_rule'}):
                raise FileNotFoundError('阶段对应的资料不存在。')
        status = body.get('status', 'planned')
        if status not in {'planned', 'confirmed', 'retracted'}:
            raise ValueError('阶段须标为计划、已确认或撤销。')
        scope = body.get('scope') or {}
        self.world.validate_context(project_id, scope, extra_entities=extra_entities)
        changes, knowledge = body.get('changes') or {}, body.get('knowledge') or []
        if not isinstance(changes, dict) or not isinstance(knowledge, list) or any(not isinstance(item, dict) or not isinstance(item.get('value'), str) for item in knowledge):
            raise ValueError('状态变化为对象，人物已知为含value文字的列表；两者不可混作人物初始设定。')
        if 'knowledge' in changes or 'known_by' in changes:
            raise ValueError('人物认知请写入单独knowledge，不混入状态字段。')
        if entity_type in {'character', 'world'}:
            from schemas.json_schemas import CARD_TYPE_SCHEMAS
            from services.material_import_service import _validate_fields
            properties = CARD_TYPE_SCHEMAS[entity_type]['properties']['payload'].get('properties', {})
            _validate_fields(changes, {'type': 'object', 'properties': {key: properties[key] for key in changes if key in properties and key != 'detail_sections'}}, '阶段变化')
        if 'detail_sections' in changes:
            if entity_type != 'character':
                raise ValueError('人物补充阶段须追加到同一人物，不写入世界或关系。')
            from services.character_detail_service import validate_detail_sections
            validate_detail_sections(self.store, project_id, changes['detail_sections'], allow_removed=True, extra_entities=extra_entities)
        naming = changes.get('name_change')
        if naming is not None and (not isinstance(naming, dict) or naming.get('kind') not in {'rename', 'alias', 'period_address'} or not isinstance(naming.get('name'), str) or not naming['name'].strip()):
            raise ValueError('剧情改名、别名与阶段称呼须分开标明kind和name；初始姓名纠错请编辑原人物卡。')
        if not body.get('source'):
            raise ValueError('阶段记录须保留作者确认或正文证据来源。')
        if not isinstance(body['source'], (str, dict)):
            raise ValueError('阶段来源须为文字或含出处的对象。')
        if status == 'confirmed' and isinstance(body['source'], dict) and body['source'].get('kind') == 'chapter':
            source = body['source']
            path, quote = source.get('path', ''), source.get('quote', '')
            if not isinstance(path, str) or not path.startswith('drafts/') or not path.endswith('.md') or not isinstance(quote, str) or not quote or quote not in self.store.read_md(project_id, path):
                raise ValueError('阶段的正文依据未能核实；请保留有效原句和章节位置，或由作者明确确认。')
        if status == 'confirmed' and not self.world.has_time(scope):
            raise ValueError('已确认阶段须注明发生时间或事件锚点；时间未定可先保存计划。')
        for item in knowledge:
            if item.get('state', 'knows') not in {'knows', 'believes', 'suspects', 'misunderstands', 'conceals'}:
                raise ValueError('认知状态请选择知道、相信、怀疑、误解或隐瞒。')
            if item.get('information_id') and (extra_entities or {}).get(item['information_id']) != 'information':
                from services.information_service import InformationService
                InformationService(self.store).get(project_id, item['information_id'])
            if item.get('learned_at'):
                self.world.validate_context(project_id, {'time': item['learned_at']})
            if item.get('known_by') and (not isinstance(item['known_by'], list) or any(not isinstance(cid, str) for cid in item['known_by'])):
                raise ValueError('知情人物须为人物编号列表。')
        stage_id = body.get('id') or f'stage_{uuid.uuid4().hex[:14]}'
        entity_id(stage_id, '阶段')
        previous = self.stages(project_id, entity_type, target_id)
        if body.get('supersedes') and not any(row['id'] == body['supersedes'] for row in previous):
            raise ValueError('被修订阶段不属于此人物或世界。')
        if status == 'retracted' and not body.get('supersedes'):
            raise ValueError('撤销须指明原阶段，不删除历史。')
        if status == 'retracted' and not scope:
            scope = copy.deepcopy(next(row['scope'] for row in previous if row['id'] == body['supersedes']))
        if entity_type == 'relationship' and changes:
            if (extra_entities or {}).get(target_id) == 'relationship':
                if 'participants' in changes:
                    self.prepare_relationship(project_id, {'id': target_id, **changes}, extra_entities=extra_entities)
                elif 'direction' in changes and changes['direction'] not in {'directed', 'undirected'}:
                    raise ValueError('关系方向须为有向或无向。')
                for key, maximum in [('label', 500), ('notes', 6000)]:
                    if key in changes and (not isinstance(changes[key], str) or len(changes[key]) > maximum):
                        raise ValueError('关系阶段名称或说明格式不正确。')
            else:
                original = self.relationship(project_id, target_id)
                self.prepare_relationship(project_id, {**original, **changes}, original, extra_entities=extra_entities)
        row = {'id': stage_id, 'entity_type': entity_type, 'entity_id': target_id, 'status': status,
               'scope': copy.deepcopy(scope), 'changes': copy.deepcopy(changes), 'knowledge': copy.deepcopy(knowledge),
               'source': copy.deepcopy(body['source']), 'label': str(body.get('label') or ''), 'created_at': now_iso()}
        if body.get('supersedes'):
            row['supersedes'] = body['supersedes']
        if body.get('import_batch_id'):
            row['import_batch_id'] = body['import_batch_id']
        return row

    def add_stage(self, project_id, entity_type, target_id, body):
        with self._lock(project_id):
            self._check_version(project_id, STAGES_PATH, body.get('_revision'))
            row = self.prepare_stage(project_id, entity_type, target_id, body)
            from services.author_control_service import AuthorControlService
            AuthorControlService(self.store).assert_stage(project_id, entity_type, target_id, row['changes'], row['status'])
            previous = self.stages(project_id, entity_type, target_id)
            existing = next((item for item in previous if item['id'] == row['id']), None)
            if existing:
                if all(existing.get(key) == value for key, value in row.items() if key != 'created_at'):
                    return existing
                raise FileExistsError('该阶段编号已存在且内容不同；请新增修订记录。')
            self.store.append_jsonl(project_id, STAGES_PATH, row)
            return self._version(project_id, STAGES_PATH, row)

    def put_branches(self, project_id, world_id, body):
        with self._lock(project_id):
            entity_id(world_id, '世界')
            source = f'cards/{world_id}.yaml'
            self._check_version(project_id, source, body.get('_revision'))
            card = self.store.read_yaml(project_id, source)
            if not card or card.get('type') not in {'world', 'worldview', 'world_rule', 'lore'}:
                raise FileNotFoundError('世界资料不存在。')
            rows = body.get('branches')
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError('事件分支须为列表。')
            rows = copy.deepcopy(rows)
            if not any(row.get('id') == 'main' for row in rows):
                rows.insert(0, {'id': 'main', 'label': '主世界', 'parent_branch_id': None, 'fork_event_ref': None})
            ids = [entity_id(row.get('id'), '分支') for row in rows]
            if len(set(ids)) != len(ids):
                raise ValueError('分支编号不能重复。')
            by_id = {row['id']: row for row in rows}
            for row in rows:
                if row['id'] == 'main':
                    if row.get('parent_branch_id') or row.get('fork_event_ref'):
                        raise ValueError('主世界不能指向另一个父分支。')
                    continue
                if row.get('parent_branch_id') not in by_id or not row.get('fork_event_ref'):
                    raise ValueError('新分支须选择已有父分支及明确分歧事件。')
                owner, event, _, ref = self.world.event(project_id, row['fork_event_ref'])
                context = self.world.resolve(project_id, event_ref=ref)['scope']
                if context.get('world_id') and context['world_id'] != world_id:
                    raise ValueError('分歧事件不属于当前世界。')
                row['fork_event_ref'] = ref
                seen, cursor = set(), row['id']
                while cursor:
                    if cursor in seen:
                        raise ValueError('事件分支不能形成循环。')
                    seen.add(cursor)
                    cursor = by_id[cursor].get('parent_branch_id')
            before = copy.deepcopy(card)
            card.setdefault('payload', {})['branches'] = rows
            self._save_card(project_id, card, before)
            return self.branches(project_id, world_id)

    def branches(self, project_id, world_id):
        return self._version(project_id, f'cards/{world_id}.yaml', {'world_id': world_id, 'branches': self.world.branches(project_id, world_id)})

    def _active_stages(self, project_id, entity_type, target_id, scope):
        rows = self.stages(project_id, entity_type, target_id)
        voids = {stage for record in self.store.read_jsonl(project_id, STAGES_PATH) if record.get('kind') == 'void' for stage in record.get('voids', [])}
        rows = [row for row in rows if row['id'] not in voids]
        superseded = {row.get('supersedes') for row in rows if row.get('status') in {'confirmed', 'retracted'} and
                      self.world.applies(project_id, row.get('scope'), scope, dynamic=True)[0]}
        applied, uncertain = [], []
        for row in rows:
            if row['id'] in superseded or row.get('status') != 'confirmed':
                continue
            valid, reason = self.world.applies(project_id, row.get('scope'), scope, dynamic=True)
            if valid:
                applied.append(row)
            elif '不确定' in reason or '缺少' in reason:
                uncertain.append({'id': row['id'], 'reason': reason})
        # File order is not story chronology: apply earlier changes first.
        from functools import cmp_to_key
        def compare(a, b):
            return self.world.compare_time(project_id, a.get('scope', {}).get('time'), b.get('scope', {}).get('time')) or 0
        applied.sort(key=cmp_to_key(compare))
        return applied, uncertain

    def _apply_changes(self, project_id, base, rows):
        state, fields, uncertain = copy.deepcopy(base), {}, []
        for row in rows:
            for key, value in row['changes'].items():
                if key == 'detail_sections':
                    sections = {item['id']: copy.deepcopy(item) for item in state.get(key, [])}
                    baseline = {item['id']: item for item in base.get(key, [])}
                    for section in value:
                        identity = ('detail_sections', section['id'])
                        prior = fields.get(identity)
                        compared = self.world.compare_time(project_id, prior['scope'].get('time'), row['scope'].get('time')) if prior else -1
                        old = next((item for item in prior['changes'][key] if item['id'] == section['id']), None) if prior else None
                        if prior and compared in (None, 0) and old != section:
                            uncertain.append({'field': f"detail_sections.{section['id']}", 'stage_ids': [prior['id'], row['id']], 'reason': '同段变化先后未明，保留起点，不按保存顺序猜测。'})
                            if section['id'] in baseline:
                                sections[section['id']] = copy.deepcopy(baseline[section['id']])
                            else:
                                sections.pop(section['id'], None)
                        elif section.get('removed'):
                            sections.pop(section['id'], None)
                        else:
                            sections[section['id']] = copy.deepcopy(section)
                        fields[identity] = row
                    state[key] = list(sections.values())
                    continue
                prior = fields.get(key)
                compared = self.world.compare_time(project_id, prior['scope'].get('time'), row['scope'].get('time')) if prior else -1
                if prior and compared in (None, 0) and prior['changes'][key] != value:
                    uncertain.append({'field': key, 'stage_ids': [prior['id'], row['id']], 'reason': '两个状态的先后未明确；保留基础值，不按保存顺序猜测。'})
                    if key in base:
                        state[key] = copy.deepcopy(base[key])
                    else:
                        state.pop(key, None)
                else:
                    state[key] = copy.deepcopy(value)
                fields[key] = row
        return state, uncertain

    def character_state(self, project_id, character_id, *, _information_snapshot=None, **scope_args):
        entity_id(character_id, '人物')
        card = self.store.read_yaml(project_id, f'cards/{character_id}.yaml')
        if card.get('type') != 'character':
            raise FileNotFoundError('人物资料不存在。')
        resolved = self.world.resolve(project_id, **scope_args)
        scope = resolved['scope']
        applied, uncertainties = self._active_stages(project_id, 'character', character_id, scope)
        state, conflicts = self._apply_changes(project_id, card.get('payload', {}), applied)
        uncertainties.extend(conflicts)
        names = {'base_name': card.get('payload', {}).get('name') or card.get('title'), 'current_name': state.get('name'), 'aliases': list(state.get('aliases') or []), 'period_address': ''}
        for row in applied:
            naming = row.get('changes', {}).get('name_change') or {}
            if naming.get('kind') == 'rename':
                names['current_name'] = naming['name']
            elif naming.get('kind') == 'alias' and naming['name'] not in names['aliases']:
                names['aliases'].append(naming['name'])
            elif naming.get('kind') == 'period_address':
                names['period_address'] = naming['name']
        state['name'] = names['current_name']
        if names['aliases']:
            state['aliases'] = names['aliases']
        if names['period_address']:
            state['period_address'] = names['period_address']
        knowledge, sources = [], [{'path': f'cards/{character_id}.yaml'}]
        for row in applied:
            sources.append({'path': STAGES_PATH, 'record_id': row['id'], 'evidence': row['source']})
            for item in row.get('knowledge', []):
                if item.get('known_by') and character_id not in item['known_by']:
                    continue
                if item.get('learned_at') and not self.world.applies(project_id, {**row['scope'], 'time': item['learned_at']}, scope, dynamic=True)[0]:
                    continue
                knowledge.append({**copy.deepcopy(item), 'state': item.get('state', 'knows'), 'scope': row['scope'], 'source': row['source'], 'stage_id': row['id']})
        from services.information_service import InformationService
        information = _information_snapshot or InformationService(self.store).state(project_id, world_context=scope)
        awareness = [record for item in information['items'] for record in item['awareness'] if record['data'].get('character_id') == character_id]
        return {'id': character_id, 'base': card, 'state': state, 'knowledge': knowledge, 'information_awareness': awareness, 'age': self.world.age(card.get('payload', {}), scope),
                'changes': applied, 'names': names, 'scope': scope, 'sources': sources, 'uncertainties': [*resolved['warnings'], *uncertainties]}

    def world_state(self, project_id, world_id, **scope_args):
        entity_id(world_id, '世界')
        context = {**(scope_args.get('world_context') or {}), 'world_id': world_id}
        scope_args['world_context'] = context
        snapshot = self.author_state(project_id, **scope_args)
        item = next((row for row in snapshot['worlds'] if row['id'] == world_id), None)
        if not item:
            raise FileNotFoundError('世界资料不存在或不适用于当前时间分支。')
        return {**item, 'scope': snapshot['scope'], 'inherited_from': snapshot['inherited_from'], 'uncertainties': [*snapshot['warnings'], *item['uncertainties']]}

    def character_snapshot(self, project_id, character_id, body):
        if not isinstance(body, dict) or not isinstance(body.get('world_context', {}), dict):
            raise ValueError('请选择要查看的世界与故事时间。')
        card = self.store.read_yaml(project_id, f'cards/{entity_id(character_id, "人物")}.yaml')
        if card.get('type') != 'character':
            raise FileNotFoundError('人物资料不存在。')
        args = {key: body[key] for key in ['story_card_id', 'chapter_id', 'event_ref', 'branch_id'] if body.get(key)}
        context = copy.deepcopy(body.get('world_context') or {})
        if 'world_context' in body:
            inherited = self.world.resolve(project_id, **args)['scope']
            context.setdefault('world_id', inherited.get('world_id') or (card.get('payload', {}).get('world_context') or {}).get('world_id'))
            if not context.get('world_id'):
                context.pop('world_id', None)
            for key in ['story_card_id', 'chapter_id']:
                if args.get(key):
                    value = args.pop(key)
                    if key != 'story_card_id' or not context.get('world_id') or self.store.read_yaml(project_id, f'cards/{value}.yaml').get('payload', {}).get('world_context', {}).get('world_id') == context['world_id']:
                        context[key] = value
        args['world_context'] = context
        scope = self.world.resolve(project_id, **args)['scope']
        if not self.world.card_visible(project_id, card, scope):
            raise ValueError('此人物不属于当前查看的世界或分支，请重新选择范围。')
        return self.character_state(project_id, character_id, **args)

    def world_snapshot(self, project_id, world_id, body):
        entity_id(world_id, '世界')
        if not isinstance(body, dict) or not isinstance(body.get('world_context', {}), dict):
            raise ValueError('请选择要浏览的世界、时期和地区。')
        if self.store.read_yaml(project_id, f'cards/{world_id}.yaml').get('type') not in {'world', 'worldview', 'world_rule', 'lore'}:
            raise FileNotFoundError('世界资料不存在。')
        context = {**body.get('world_context', {}), 'world_id': world_id}
        args = {key: body[key] for key in ['story_card_id', 'chapter_id', 'pov_character_id'] if body.get(key)}
        if 'world_context' in body:
            # Browsing filters replace inherited time; selecting a period must not restore the story's old year.
            story_id = args.pop('story_card_id', None)
            if story_id and self.store.read_yaml(project_id, f'cards/{entity_id(story_id)}.yaml').get('payload', {}).get('world_context', {}).get('world_id') == world_id:
                context['story_card_id'] = story_id
            if args.get('chapter_id'):
                context['chapter_id'] = args.pop('chapter_id')
        snapshot = self.author_state(project_id, world_context=context, **args)
        visible = {row['id'] for key in ['worlds', 'characters'] for row in snapshot[key]}
        relations = [{**row, 'sources': [*row.get('sources', []), *[{'path': STAGES_PATH, 'record_id': stage['id'], 'evidence': stage['source']} for stage in row.get('stages', [])]]}
            for row in snapshot['relations'] if all(person['entity_id'] in visible for person in row['state']['participants'])]
        return {**snapshot, 'relations': relations, 'relationships': relations, 'uncertainties': snapshot['warnings']}

    def author_state(self, project_id, **scope_args):
        resolved = self.world.resolve(project_id, **scope_args)
        scope = resolved['scope']
        from services.information_service import InformationService
        information = InformationService(self.store).state(project_id, world_context=scope)
        characters, worlds, sources = [], [], list(resolved['sources'])
        for card, source in self._cards(project_id):
            if not self.world.card_visible(project_id, card, scope):
                continue
            if card.get('type') == 'character':
                item = self.character_state(project_id, card['id'], _information_snapshot=information, world_context=scope)
                characters.append(item)
            if card.get('type') in {'world', 'worldview', 'world_rule', 'lore'}:
                if scope.get('world_id') and not self.world.belongs_to_world(project_id, card, scope['world_id']):
                    continue
                changes, uncertain = self._active_stages(project_id, 'world', card['id'], scope)
                state, conflicts = self._apply_changes(project_id, card.get('payload', {}), changes)
                uncertain.extend(conflicts)
                state, local_changes = self.world.apply_overrides(project_id, card, state, scope)
                worlds.append({'id': card['id'], 'base': card, 'state': state, 'changes': changes, 'local_changes': local_changes, 'uncertainties': uncertain, 'sources': [{'path': source}, *[{'path': STAGES_PATH, 'record_id': row['id']} for row in changes]]})
        relations = []
        for relation in self.relationships(project_id):
            if not self.world.applies(project_id, relation.get('scope'), scope)[0]:
                continue
            stages, _ = self._active_stages(project_id, 'relationship', relation['id'], scope)
            state, conflicts = self._apply_changes(project_id, {key: relation[key] for key in ['label', 'participants', 'direction', 'notes']}, stages)
            relations.append({**relation, 'state': state, 'stages': stages, 'uncertainties': conflicts})
        events = []
        for event in self.events(project_id, scope.get('story_card_id')):
            event_scope = event['values'].get('world_context') or {}
            try:
                event_scope = self.world.resolve(project_id, event_ref=event['id'])['scope']
            except (ValueError, FileNotFoundError):
                pass
            if not self.world.applies(project_id, event_scope, scope)[0]:
                continue
            relation = self.world.compare_time(project_id, {**event_scope.get('time', {}), 'event_ref': self.world.event_ref(event['id'])}, scope.get('time'))
            events.append({**event, 'temporal_status': 'past_or_current' if relation is not None and relation <= 0 else 'planned_or_unlocated'})
        options = self.world.options(project_id, scope['world_id']) if scope.get('world_id') else {'branches': [], 'periods': [], 'regions': []}
        return {**resolved, 'characters': characters, 'worlds': worlds, 'relations': relations, 'events': events,
                'information_items': information['items'], **{key: options[key] for key in ['branches', 'periods', 'regions']}, 'sources': sources}
