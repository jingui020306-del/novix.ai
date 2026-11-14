"""Explicit, previewed author organization changes over the same card/event files."""
from __future__ import annotations

import copy
import re
import uuid

from services.change_suggestion_service import ChangeSuggestionService
from services.edit_version_service import check_revision, revision
from services.shared_material_service import SharedMaterialService
from services.world_library_service import WorldLibraryService, WORLD_TYPES, encoded
from services.world_scope_service import WorldScopeService, entity_id
from storage.fs_store import now_iso


def replace_ids(value, mapping, key=''):
    if isinstance(value, dict):
        return {name: replace_ids(item, mapping, name) for name, item in value.items()}
    if isinstance(value, list):
        return [replace_ids(item, mapping, key) for item in value]
    if isinstance(value, str) and (key in {'target', 'entity_id', 'character_id', 'parent_id', 'world_id', 'pov_character_id', 'links', 'material_ids', 'characters', 'base_setting_ids', 'region_ids'} or key.endswith('_ids')):
        return mapping.get(value, value)
    return value


class CardOperationService:
    def __init__(self, store):
        self.store = store

    def _path(self, identity):
        return f'sessions/card_operations/{entity_id(identity)}.json'

    def get(self, project_id, identity):
        value = self.store.read_json(project_id, self._path(identity))
        if not value:
            raise FileNotFoundError('这份整理预览不存在。')
        return {**{key: item for key, item in value.items() if key not in {'operations', 'undo_operations'}}, 'revision': revision(self.store, project_id, self._path(identity))}

    def _card(self, project_id, identity):
        value = self.store.read_yaml(project_id, f'cards/{entity_id(identity)}.yaml')
        if not value:
            raise FileNotFoundError('所选资料不存在。')
        return value

    @staticmethod
    def _parts(body, text):
        pieces = body.get('parts')
        if pieces is None:
            pieces = [{'title': value.splitlines()[0][:100], 'content': value} for value in re.split(r'\n\s*\n', text) if value.strip()]
        if not isinstance(pieces, list) or not 2 <= len(pieces) <= 100:
            raise ValueError('请提供至少两段要拆出的内容，可按空行整理后再核对。')
        if any(not isinstance(row, dict) or not isinstance(row.get('title'), str) or not row['title'].strip() or not isinstance(row.get('content'), str) or len(row['title']) > 200 or len(row['content']) > 100000 for row in pieces):
            raise ValueError('每张卡须有名称和文字内容，名称不超过200字。')
        return pieces

    def preview(self, project_id, body):
        action = body.get('action')
        if action not in {'split', 'merge', 'reparent', 'reorder', 'promote', 'wrap'}:
            raise ValueError('请选择拆分、合并、调整父级、展示排序或转为事件。')
        for field in ['ids', 'order']:
            if field in body and (not isinstance(body[field], list) or any(not isinstance(item, str) for item in body[field])):
                raise ValueError('请选择要整理的资料列表。')
        with ChangeSuggestionService(self.store).lock(project_id):
            cards = {}
            before = {}
            deleted = set()
            results = {}
            warnings = []
            metadata_operations = []
            def load(identity):
                if identity not in cards:
                    value = self._card(project_id, identity)
                    cards[identity] = copy.deepcopy(value)
                    before[identity] = value
                return cards[identity]
            source_id = body.get('source_id') or body.get('target_id')
            if isinstance(source_id, str) and ':important_scenes:' in source_id:
                ref = WorldScopeService(self.store).event(project_id, source_id)[-1]
                owner = load(ref['owner_card_id'])
                rows = owner['payload']['important_scenes']
                index = next(i for i, row in enumerate(rows) if row.get('id') == ref['scene_id'])
                row = rows[index]
                if action == 'split':
                    parts = self._parts(body, row.get('plot') or row.get('scene') or '')
                    replacements = []
                    for number, part in enumerate(parts):
                        piece = copy.deepcopy(row)
                        piece.update(id=row['id'] if number == 0 else 'event_' + uuid.uuid4().hex[:14], scene=part['title'], plot=part['content'])
                        piece.pop('rehearsal', None)
                        if number:
                            for field in ['causal_event_refs', 'causal_scene_ids', 'canonical_event_ref']:
                                piece.pop(field, None)
                        replacements.append(piece)
                    rows[index:index + 1] = replacements
                    results['event_ids'] = [f"{ref['owner_card_id']}:important_scenes:{item['id']}" for item in replacements]
                    warnings.append('拆分稿不沿用原场景的确认结果；后续事件的前因仍待作者指定，不会自动认定因果。')
                elif action == 'reorder':
                    order = body.get('order') or body.get('ids') or []
                    normalized = [WorldScopeService.event_ref(item) for item in order]
                    if len(normalized) != len({str(item) for item in normalized}) or any(item['owner_card_id'] != ref['owner_card_id'] for item in normalized):
                        raise ValueError('请在同一张工作表中调整事件展示顺序。')
                    for number, item in enumerate(normalized):
                        target = next((value for value in rows if value.get('id') == item['scene_id']), None)
                        if target is None:
                            raise ValueError('排序事件不存在。')
                        target['sort_order'] = number
                    warnings.append('只改变展示次序；原事件时间、前因连接和章节顺序保持独立。')
                else:
                    raise ValueError('事件请使用拆分或展示排序；世界条目的父级与合并在原资料中整理。')
            elif action == 'reorder':
                order = body.get('order') or body.get('ids') or []
                if not isinstance(order, list) or not order or len(order) != len(set(order)):
                    raise ValueError('请选择不重复的资料排序。')
                for number, identity in enumerate(order):
                    load(identity).setdefault('payload', {})['sort_order'] = number
                warnings.append('只整理资料的展示顺序，不改变发生时间或正文阅读顺序。')
            elif action in {'reparent', 'wrap'}:
                identities = body.get('ids') or ([source_id] if source_id else [])
                if not identities:
                    raise ValueError('请选择要整理父级的世界条目。')
                parent = body.get('parent_id')
                if action == 'wrap':
                    title = str(body.get('title') or '').strip()
                    if not title or len(title) > 200:
                        raise ValueError('请填写新分组名称。')
                    parent = 'world_group_' + uuid.uuid4().hex[:14]
                    original = load(identities[0])
                    cards[parent] = {'id': parent, 'type': 'world', 'title': title, 'tags': [], 'links': [], 'payload': {'entry_type': 'group',
                        **{key: copy.deepcopy(original.get('payload', {})[key]) for key in ['parent_id', 'world_context'] if key in original.get('payload', {})}, 'summary': '', 'content': ''}}
                    before[parent] = None
                    results['parent_id'] = parent
                elif parent:
                    if load(parent).get('type') not in WORLD_TYPES:
                        raise ValueError('父级须为已有世界条目。')
                for identity in identities:
                    card = load(identity)
                    if card.get('type') not in WORLD_TYPES or parent == identity:
                        raise ValueError('世界条目不能成为自己的父级。')
                    context_world = card.get('payload', {}).get('world_context', {}).get('world_id')
                    if parent and context_world and not WorldScopeService(self.store).belongs_to_world(project_id, load(parent), context_world):
                        raise ValueError('这个父级属于其他世界；调整分组不能改变条目采用的世界。')
                    ancestors = set()
                    cursor = parent
                    while cursor:
                        if cursor == identity or cursor in ancestors:
                            raise ValueError('父级调整会形成循环，请选择其他分组。')
                        ancestors.add(cursor)
                        cursor = load(cursor).get('payload', {}).get('parent_id')
                    if parent:
                        card.setdefault('payload', {})['parent_id'] = parent
                    else:
                        card.setdefault('payload', {}).pop('parent_id', None)
                warnings.append('这是资料组织层级的调整，不表示故事中发生了领土或归属变化；历史变化请使用阶段记录。')
            elif action == 'split':
                source = load(source_id)
                if source.get('type') not in WORLD_TYPES | {'outline'}:
                    raise ValueError('此处拆分世界资料或灵感；人物的补充段在人物资料中整理。')
                payload = source.setdefault('payload', {})
                parts = self._parts(body, payload.get('content') or payload.get('summary') or '')
                results['ids'] = []
                for number, part in enumerate(parts):
                    identity = 'world_part_' + uuid.uuid4().hex[:14]
                    cards[identity] = {'id': identity, 'type': 'world', 'title': part['title'], 'tags': source.get('tags', []), 'links': [],
                        'payload': {'entry_type': 'custom', 'parent_id': source_id, 'summary': '', 'content': part['content'], 'sort_order': number,
                                    'sources': [{'path': f'cards/{source_id}.yaml', 'operation': 'author_split'}]}}
                    before[identity] = None
                    results['ids'].append(identity)
                payload['content'] = ''
                warnings.append('原条目作为父级保留；已拆文字移至子项，原文保存在本次可撤销记录中。')
            elif action == 'promote':
                source = load(source_id)
                owner = load(body.get('story_card_id'))
                if owner.get('type') != 'story':
                    raise ValueError('请选择故事，再将灵感安排为事件。')
                existing = source.get('payload', {}).get('promoted_event_ref')
                if existing:
                    raise ValueError('这条灵感已经转为事件，请打开已有事件继续编辑。')
                event_id = 'event_' + uuid.uuid4().hex[:14]
                owner.setdefault('payload', {}).setdefault('important_scenes', []).append({'id': event_id, 'scene': body.get('title') or source.get('title') or '新事件',
                    'plot': source.get('payload', {}).get('content') or source.get('payload', {}).get('summary') or '', 'material_ids': [source['id']]})
                reference = {'owner_card_id': owner['id'], 'scene_id': event_id}
                source.setdefault('payload', {})['promoted_event_ref'] = reference
                results['event_id'] = f"{owner['id']}:important_scenes:{event_id}"
                warnings.append('新增的是作者规划，尚不代表故事事实已经发生；原灵感保留为来源。')
            elif action == 'merge':
                identities = list(dict.fromkeys(body.get('ids') or []))
                target_id = body.get('target_id') or source_id
                if target_id not in identities or len(identities) < 2:
                    raise ValueError('请选择至少两张卡，并指定合并后保留的资料。')
                selected = [load(identity) for identity in identities]
                if any(card.get('type') not in WORLD_TYPES for card in selected):
                    raise ValueError('这里只合并世界资料；人物和已发生事件须分别保留身份与历史。')
                obsolete = set(identities) - {target_id}
                canon_rows = [row for path in self.store._safe_path(project_id, 'canon').glob('*.jsonl') for row in self.store.read_jsonl(project_id, 'canon/' + path.name)]
                if any(any(identity in encoded(row) for identity in obsolete) for row in canon_rows):
                    warnings.append('待合并条目已有事实、阶段或锁定历史，不能删除其身份；请改用父级分组，或先在原记录核对历史。')
                else:
                    target = load(target_id)
                    parent = target.get('payload', {}).get('parent_id')
                    seen = {target_id}
                    while parent in obsolete:
                        if parent in seen:
                            raise ValueError('原资料的父级存在循环，请先核对原条目。')
                        seen.add(parent)
                        parent = load(parent).get('payload', {}).get('parent_id')
                    if parent:
                        target.setdefault('payload', {})['parent_id'] = parent
                    else:
                        target.setdefault('payload', {}).pop('parent_id', None)
                    for other in selected:
                        for key, value in other.get('payload', {}).items():
                            if key in {'name', 'content', 'summary', 'aliases', 'parent_id', 'sort_order', 'library_source'} or value in (None, '', [], {}):
                                continue
                            current = target['payload'].get(key)
                            if current in (None, '', [], {}):
                                target['payload'][key] = copy.deepcopy(value)
                            elif isinstance(value, list) and isinstance(current, list):
                                target['payload'][key] = current + [copy.deepcopy(item) for item in value if item not in current]
                            elif current != value:
                                raise ValueError('待合并资料存在不同的结构化设定，请先核对相应字段，或使用父级分组保留各自资料。')
                    target.setdefault('payload', {})['content'] = '\n\n'.join(str(card.get('payload', {}).get('content') or card.get('payload', {}).get('summary') or '') for card in selected if card.get('payload', {}).get('content') or card.get('payload', {}).get('summary'))
                    target['payload']['aliases'] = list(dict.fromkeys([*target['payload'].get('aliases', []), *(str(card.get('payload', {}).get('name') or card.get('title') or '') for card in selected if card['id'] != target_id)]))
                    target['tags'] = list(dict.fromkeys(tag for card in selected for tag in card.get('tags', [])))
                    target['links'] = list(dict.fromkeys(link for card in selected for link in card.get('links', [])))
                    mapping = {identity: target_id for identity in obsolete}
                    for path in self.store._safe_path(project_id, 'cards').glob('*.yaml'):
                        card = load(path.stem)
                        if card['id'] not in obsolete:
                            cards[card['id']] = replace_ids(card, mapping)
                    deleted.update(obsolete)
                    for path in self.store._safe_path(project_id, 'drafts').glob('*.meta.json'):
                        relative = 'drafts/' + path.name
                        original = self.store.read_json(project_id, relative)
                        updated = replace_ids(original, mapping)
                        if original != updated:
                            metadata_operations.append({'path': relative, 'kind': 'replace', 'before': path.read_text(encoding='utf-8'),
                                'before_value': original, 'after': encoded(updated), 'after_value': updated})
                    results['ids'] = [target_id]
            operations, changes, impacts = [], [], []
            for identity, card in list(cards.items()):
                if identity in deleted or card.get('type') not in WORLD_TYPES:
                    continue
                cursor, ancestors = identity, set()
                while cursor:
                    if cursor in ancestors:
                        raise ValueError('整理后会形成循环父级，请选择其他保留条目。')
                    ancestors.add(cursor)
                    cursor = load(cursor).get('payload', {}).get('parent_id')
            for identity, after in cards.items():
                original = before[identity]
                if original == after and identity not in deleted:
                    continue
                path = f'cards/{entity_id(identity)}.yaml'
                original_path = self.store._safe_path(project_id, path)
                value = None if identity in deleted else after
                operations.append({'path': path, 'kind': 'replace', 'before': original_path.read_text(encoding='utf-8') if original_path.exists() else None,
                                   'before_value': original, 'after': encoded(value) if value is not None else None, 'after_value': value})
                changes.append({'id': identity, 'label': after.get('title') or identity, 'before': original, 'after': value})
                if original:
                    impacts.extend(SharedMaterialService(self.store).affected_chapters(project_id, identity, original, value or {}))
            operations.extend(metadata_operations)
            for operation in metadata_operations:
                changes.append({'id': operation['path'], 'label': '相关章节的资料引用', 'before': operation['before_value'], 'after': operation['after_value']})
            can_apply = bool(operations)
            try:
                WorldLibraryService(self.store)._check_operations(project_id, operations)
            except FileExistsError as exc:
                can_apply = False
                warnings.append(str(exc))
            identity = 'organize_' + uuid.uuid4().hex[:18]
            record = {'id': identity, 'action': action, 'status': 'draft', 'created_at': now_iso(), 'summary': {'split': '拆分为可分别编辑的条目', 'merge': '合并内容并保留引用', 'reparent': '调整资料分组', 'reorder': '调整展示顺序', 'promote': '将灵感安排为事件', 'wrap': '新增父级分组'}[action],
                      'operations': operations, 'changes': changes, 'impacts': impacts, 'warnings': warnings, 'can_apply': can_apply, 'result': results}
            self.store.write_json(project_id, self._path(identity), record)
            return self.get(project_id, identity)

    def _execute(self, project_id, record, *, undo=False):
        WorldLibraryService(self.store).apply_operations(project_id, record['undo_operations' if undo else 'operations'])
        record['status'] = 'undone' if undo else 'applied'
        self.store.write_json(project_id, self._path(record['id']), record)
        return self.get(project_id, record['id'])

    def apply(self, project_id, identity, body):
        with ChangeSuggestionService(self.store).lock(project_id):
            record = self.store.read_json(project_id, self._path(identity))
            if record.get('status') == 'applied':
                return self.get(project_id, identity)
            if record.get('status') == 'applying':
                return self._execute(project_id, record)
            check_revision(self.store, project_id, self._path(identity), body.get('revision', ''))
            if record.get('status') != 'draft' or not record.get('can_apply'):
                raise ValueError('这份预览不能直接采用，请处理提示后重新整理。')
            WorldLibraryService(self.store)._check_operations(project_id, record['operations'])
            record['status'] = 'applying'
            self.store.write_json(project_id, self._path(identity), record)
            return self._execute(project_id, record)

    def undo(self, project_id, identity, body):
        with ChangeSuggestionService(self.store).lock(project_id):
            record = self.store.read_json(project_id, self._path(identity))
            if record.get('status') == 'undone':
                return self.get(project_id, identity)
            if record.get('status') == 'undoing':
                return self._execute(project_id, record, undo=True)
            check_revision(self.store, project_id, self._path(identity), body.get('revision', ''))
            if record.get('status') != 'applied':
                raise ValueError('只有已采用的整理操作可以撤销。')
            operations = []
            for operation in reversed(record['operations']):
                path = operation['path']
                file = self.store._safe_path(project_id, path)
                actual = file.read_text(encoding='utf-8') if file.exists() else None
                if actual != operation['after']:
                    raise FileExistsError('整理后已有新编辑，撤销已暂停；不会覆盖后来内容。')
                operations.append({'path': path, 'kind': 'replace', 'before': actual, 'after': operation['before'], 'after_value': operation['before_value']})
            WorldLibraryService(self.store)._check_operations(project_id, operations)
            record.update(status='undoing', undo_operations=operations)
            self.store.write_json(project_id, self._path(identity), record)
            return self._execute(project_id, record, undo=True)

    def recover_pending(self, project_id):
        for path in self.store._safe_path(project_id, 'sessions/card_operations').glob('*.json'):
            record = self.store.read_json(project_id, 'sessions/card_operations/' + path.name)
            if record.get('status') in {'applying', 'undoing'}:
                with ChangeSuggestionService(self.store).lock(project_id):
                    self._execute(project_id, record, undo=record['status'] == 'undoing')
