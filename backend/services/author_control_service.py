from __future__ import annotations

import copy
import json
import re
import uuid
import hashlib
from pathlib import Path
from contextlib import contextmanager
from contextvars import ContextVar

from services.edit_version_service import check_revision, revision
from storage.fs_store import now_iso

CONTROL_PATH = 'canon/author_controls.jsonl'
_PERMIT = ContextVar('author_amendment_scope', default=None)
_MISSING = object()


def parts(pointer):
    if not isinstance(pointer, str) or not pointer.startswith('/') or len(pointer) > 1000:
        raise ValueError('请选择需要保留或修改的具体字段。')
    return [] if pointer == '/' else [key.replace('~1', '/').replace('~0', '~') for key in pointer[1:].split('/')]


def field(value, pointer, default=None):
    for key in parts(pointer):
        if isinstance(value, list):
            if key.startswith('@'):
                value = next((row for row in value if isinstance(row, dict) and str(row.get('id')) == key[1:]), _MISSING)
            elif key.isdigit() and int(key) < len(value):
                value = value[int(key)]
            else:
                return default
        elif isinstance(value, dict):
            value = value.get(key, _MISSING)
        else:
            return default
        if value is _MISSING:
            return default
    return value


def changed(value, pointer, replacement):
    keys = parts(pointer)
    if not keys:
        return copy.deepcopy(replacement)
    result = copy.deepcopy(value)
    parent = result
    for key in keys[:-1]:
        if isinstance(parent, dict):
            parent = parent.setdefault(key, {})
        elif isinstance(parent, list):
            parent = field(parent, '/' + key, _MISSING)
        else:
            parent = _MISSING
        if parent is _MISSING:
            raise ValueError('选定的原条目已不存在，请重新核对修改范围。')
    key = keys[-1]
    if isinstance(parent, dict):
        if replacement is _MISSING:
            parent.pop(key, None)
        else:
            parent[key] = copy.deepcopy(replacement)
    elif isinstance(parent, list):
        index = next((i for i, row in enumerate(parent) if isinstance(row, dict) and str(row.get('id')) == key[1:]), None) if key.startswith('@') else int(key) if key.isdigit() and int(key) < len(parent) else None
        if index is None:
            raise ValueError('选定的原条目已不存在。')
        if replacement is _MISSING:
            parent.pop(index)
        else:
            parent[index] = copy.deepcopy(replacement)
    else:
        raise ValueError('不能在这个字段下继续修改子项。')
    return result


def _content(value):
    if isinstance(value, dict):
        return {key: _content(child) for key, child in value.items() if key not in {'updated_at', '_revision', 'change_suggestions', 'field_provenance'}}
    return [_content(child) for child in value] if isinstance(value, list) else value


class AuthorControlService:
    """Locks protect the existing source; amendments never temporarily unlock it."""

    def __init__(self, store):
        self.store = store

    def lock(self, project_id):
        from services.change_suggestion_service import ChangeSuggestionService
        return ChangeSuggestionService(self.store).lock(project_id)

    @staticmethod
    def target(value):
        if not isinstance(value, str) or not re.fullmatch(r'(cards/[\w-]+\.(?:yaml|json)|drafts/[\w-]+\.(?:md|meta\.json)|canon/(?:facts|author_stages)\.jsonl)', value):
            raise ValueError('请选择当前作品中的正式资料。')
        return value

    def read(self, project_id, target):
        target = self.target(target)
        if target.endswith('.md'):
            return self.store.read_md(project_id, target)
        if target == 'canon/facts.jsonl':
            from routers.canon import _compose_facts_with_revisions
            return [{key: value for key, value in row.items() if key not in {'_original', '_revised', '_revisions'}}
                    for row in _compose_facts_with_revisions(self.store, project_id)]
        if target.endswith('.jsonl'):
            return self.store.read_jsonl(project_id, target)
        return self.store.read_yaml(project_id, target) if target.endswith('.yaml') else self.store.read_json(project_id, target)

    def base_revision(self, project_id, target):
        if target == 'canon/facts.jsonl':
            return hashlib.sha256(json.dumps([revision(self.store, project_id, target), revision(self.store, project_id, 'canon/revisions.jsonl')]).encode()).hexdigest()
        return revision(self.store, project_id, target)

    def _check_base(self, project_id, target, expected):
        if expected != self.base_revision(project_id, target):
            if target == 'canon/facts.jsonl' and not self.store.read_jsonl(project_id, 'canon/revisions.jsonl') and expected == revision(self.store, project_id, target):
                return
            raise FileExistsError('正式资料或事实修订已经更新，请核对最新版本后再指定修改。')

    def _truth_targets(self, project_id, card, paths):
        result = []
        for info in card.get('payload', {}).get('information_registry', []) or []:
            if not info.get('id') or not info.get('fact_ref') or info.get('truth_status') != 'confirmed':
                continue
            prefix = '/payload/information_registry/@' + info['id']
            affects_truth = any(_content(field(card, pointer, _MISSING)) != _content(field(changed(card, prefix + '/' + key, '__lock_probe__'), pointer, _MISSING))
                                for pointer in paths for key in ['truth_value', 'truth_status', 'fact_ref'])
            if affects_truth:
                if not any(row.get('id') == info['fact_ref'] for row in self.read(project_id, 'canon/facts.jsonl')):
                    raise ValueError('信息引用的原事实不存在，请先核对来源。')
                result.append({'target': 'canon/facts.jsonl', 'paths': ['/@' + info['fact_ref'] + '/value'],
                               'base_revision': self.base_revision(project_id, 'canon/facts.jsonl'), 'linked_information_id': info['id']})
        return result

    def get(self, project_id, target):
        target = self.target(target)
        rows = self.store.read_jsonl(project_id, CONTROL_PATH)
        locks = [{**item, 'id': row['id'], 'created_at': row.get('ts'), 'reason': row.get('reason', '')} for row in rows for item in row.get('targets', []) if item['target'] == target]
        if target == 'canon/facts.jsonl':
            registry = self.read(project_id, 'cards/outline_author_registry.yaml')
            for row in rows:
                for item in row.get('targets', []):
                    if item['target'] != 'cards/outline_author_registry.yaml':
                        continue
                    for linked in self._truth_targets(project_id, registry, item['paths']):
                        if not any(lock['id'] == row['id'] and lock['paths'] == linked['paths'] for lock in locks):
                            locks.append({**linked, 'id': row['id'], 'created_at': row.get('ts'), 'reason': row.get('reason', '')})
        history = [{'id': row.get('amendment_id'), 'action': row['kind'], 'created_at': row.get('ts'), 'paths': row.get('paths', []), 'reason': row.get('reason', '')} for row in rows if row.get('target') == target and row.get('amendment_id')]
        return {'target': target, 'revision': revision(self.store, project_id, CONTROL_PATH), 'base_revision': self.base_revision(project_id, target), 'locks': locks, 'history': history}

    def confirm(self, project_id, body):
        targets = body.get('targets')
        if not isinstance(targets, list) or not 1 <= len(targets) <= 200:
            raise ValueError('请选择要确认保留的字段或条目。')
        with self.lock(project_id):
            check_revision(self.store, project_id, CONTROL_PATH, body.get('control_revision'))
            selected = []
            for item in targets:
                target = self.target(item.get('target'))
                if not self.store._safe_path(project_id, target).is_file():
                    raise ValueError('请先保存资料，再确认保留。')
                self._check_base(project_id, target, item.get('base_revision', ''))
                paths = item.get('paths') or ['/']
                if not isinstance(paths, list) or not 1 <= len(paths) <= 200:
                    raise ValueError('确认范围不正确。')
                for pointer in paths:
                    parts(pointer)
                selected.append({'target': target, 'paths': list(dict.fromkeys(paths)), 'base_revision': self.base_revision(project_id, target)})
                if target == 'cards/outline_author_registry.yaml':
                    selected.extend(self._truth_targets(project_id, self.read(project_id, target), paths))
            self.store.append_jsonl(project_id, CONTROL_PATH, {'id': 'lock_' + uuid.uuid4().hex[:14], 'kind': 'lock', 'targets': selected, 'reason': str(body.get('reason') or '')[:2000]})
            return {'targets': [self.get(project_id, item['target']) for item in selected], 'revision': revision(self.store, project_id, CONTROL_PATH)}

    def assert_write(self, project_id, target, before, after):
        # Derived indexes and work drafts are intentionally outside formal locks.
        if not self.active(project_id, target):
            return
        permit = _PERMIT.get()
        allowed = permit[2] if permit and permit[:2] == (str(self.store._project_dir(project_id)), target) else []
        for item in self.get(project_id, target)['locks']:
            for pointer in item['paths']:
                old, new = field(before, pointer, _MISSING), field(after, pointer, _MISSING)
                if old is _MISSING and new is _MISSING or _content(old) == _content(new):
                    continue
                if allowed:
                    permitted = copy.deepcopy(before)
                    for path in allowed:
                        permitted = changed(permitted, path, field(after, path, _MISSING))
                    if _content(field(permitted, pointer, _MISSING)) == _content(new):
                        continue
                raise FileExistsError('这部分资料已确认并锁定。请使用“指定修改”，其他内容与当前编辑均已保留。')

    def active(self, project_id, target):
        return bool(re.fullmatch(r'(cards/[\w-]+\.(?:yaml|json)|drafts/[\w-]+\.(?:md|meta\.json)|canon/(?:facts|author_stages)\.jsonl)', target) and self.store._safe_path(project_id, CONTROL_PATH).exists())

    def assert_unlocked(self, project_id, target):
        if self.get(project_id, target)['locks']:
            raise FileExistsError('这份正式资料已锁定。请先试写候选，或选择“指定修改”，不会直接覆盖。')

    def assert_append(self, project_id, target, row):
        if not self.store._safe_path(project_id, CONTROL_PATH).exists():
            return
        if target == 'canon/author_stages.jsonl':
            self.assert_stage(project_id, row.get('entity_type'), row.get('entity_id'), row.get('changes'), row.get('status'))
            if row.get('kind') == 'void' or row.get('supersedes') and row.get('status') in {'confirmed', 'retracted'}:
                before = self.store.read_jsonl(project_id, target)
                removed = [*row.get('voids', []), *([row['supersedes']] if row.get('supersedes') else [])]
                self.assert_write(project_id, target, before, [item for item in before if item.get('id') not in removed])
        elif target == 'canon/revisions.jsonl':
            from routers.canon import _compose_facts_with_revisions, _apply_patch
            before = _compose_facts_with_revisions(self.store, project_id)
            after = [_apply_patch(item, row.get('patch', {})) if item.get('id') == row.get('target_fact_id') else item for item in before]
            self.assert_write(project_id, 'canon/facts.jsonl', before, after)
        elif target == 'canon/facts.jsonl' and row.get('id'):
            before = self.store.read_jsonl(project_id, target)
            after = [row if item.get('id') == row['id'] else item for item in before]
            self.assert_write(project_id, target, before, after)

    def assert_stage(self, project_id, entity_type, entity_id, changes, status):
        if status != 'confirmed' or not changes:
            return
        target = f'cards/{entity_id}.yaml'
        if entity_type == 'relationship':
            target = 'cards/outline_author_registry.yaml'
            prefix = '/payload/relationship_registry/@' + entity_id
        elif entity_type == 'information':
            target = 'cards/outline_author_registry.yaml'
            prefix = '/payload/information_registry/@' + entity_id
        else:
            prefix = '/payload'
        # A new age/goal is a later state, while a changed invariant needs review.
        invariant = {'rules', 'boundaries', 'name', 'birth_date', 'birth_year', 'truth_value', 'truth_status'}
        before = self.read(project_id, target)
        after = copy.deepcopy(before)
        for key, value in changes.items():
            if key in invariant:
                after = changed(after, prefix + '/' + key, value)
        self.assert_write(project_id, target, before, after)

    def _path(self, edit_id):
        if not isinstance(edit_id, str) or not re.fullmatch(r'amend_[\w-]+', edit_id):
            raise ValueError('指定修改工作稿不存在。')
        return f'sessions/author_amendments/{edit_id}.json'

    def amendment(self, project_id, edit_id):
        value = self.store.read_json(project_id, self._path(edit_id))
        if not value:
            raise FileNotFoundError('这份指定修改工作稿不存在。')
        return {**value, 'revision': revision(self.store, project_id, self._path(edit_id))}

    def _save(self, project_id, record):
        self.store.write_json(project_id, self._path(record['id']), {key: value for key, value in record.items() if key != 'revision'})
        return self.amendment(project_id, record['id'])

    def start(self, project_id, body):
        with self.lock(project_id):
            target = self.target(body.get('target'))
            if target.endswith('.jsonl') and target != 'canon/facts.jsonl':
                raise ValueError('动态事实请通过阶段修订保留历史；不要改写整个历史文件。')
            self._check_base(project_id, target, body.get('base_revision', ''))
            check_revision(self.store, project_id, CONTROL_PATH, body.get('control_revision'))
            paths = body.get('paths') or ['/']
            if not isinstance(paths, list) or not 1 <= len(paths) <= 200:
                raise ValueError('请选择指定修改的范围。')
            for pointer in paths:
                parts(pointer)
            value = self.read(project_id, target)
            if not self.store._safe_path(project_id, target).exists():
                raise FileNotFoundError('请先保存原资料。')
            if target == 'canon/facts.jsonl':
                fact_ids = {parts(pointer)[0][1:] for pointer in paths if parts(pointer) and parts(pointer)[0].startswith('@')}
                if len(fact_ids) != 1 or any(len(parts(pointer)) < 2 or not parts(pointer)[0].startswith('@') or field(value, pointer, _MISSING) is _MISSING for pointer in paths):
                    raise ValueError('请选择同一条事实的已有字段，例如 /@事实编号/value；不改写整个历史。')
            before = {path: copy.deepcopy(field(value, path)) for path in paths}
            from services.shared_material_service import SharedMaterialService
            try:
                links = SharedMaterialService(self.store).backlinks(project_id, Path(target).stem) if target.startswith('cards/') else {}
            except ValueError:
                links = {}
            impacts = links.get('items', [])
            if target == 'canon/facts.jsonl':
                from services.information_service import InformationService
                impacts = [{'source_id': row['id'], 'label': row['label'], 'type': 'information', 'source': row['source'], 'relation': '真相引用此事实'}
                           for row in InformationService(self.store).list(project_id) if row.get('fact_ref') in fact_ids]
            return self._save(project_id, {'id': 'amend_' + uuid.uuid4().hex[:14], 'status': 'draft', 'target': target, 'paths': list(dict.fromkeys(paths)), 'before': before, 'changes': copy.deepcopy(before), 'original_value': value,
                'base_revision': self.base_revision(project_id, target), 'control_revision': revision(self.store, project_id, CONTROL_PATH), 'reason': str(body.get('reason') or '')[:2000], 'impacts': impacts, 'created_at': now_iso()})

    def update(self, project_id, edit_id, body):
        with self.lock(project_id):
            check_revision(self.store, project_id, self._path(edit_id), body.get('revision', ''))
            record = self.amendment(project_id, edit_id)
            if record['status'] != 'draft':
                raise ValueError('这份修改已经采用或恢复，请另建指定修改。')
            changes = body.get('changes')
            if not isinstance(changes, dict) or any(path not in record['paths'] for path in changes):
                raise ValueError('只能修改本次选定的字段，其他锁定内容保持不变。')
            record['changes'] = {**record['changes'], **changes}
            return self._save(project_id, record)

    @contextmanager
    def _authorized(self, project_id, target, paths):
        token = _PERMIT.set((str(self.store._project_dir(project_id)), target, paths))
        try:
            yield
        finally:
            _PERMIT.reset(token)

    def _write(self, project_id, target, value, edit_id, before):
        if target == 'canon/facts.jsonl':
            if not isinstance(value, list) or [row.get('id') for row in value] != [row.get('id') for row in before]:
                raise ValueError('指定事实修改保留原身份和历史，只修改选定字段。')
            edits = [(old, new) for old, new in zip(before, value) if _content(old) != _content(new)]
            if len(edits) > 1:
                raise ValueError('一次指定修改只处理一条事实。')
            def patch(old, new):
                if isinstance(old, dict) and isinstance(new, dict):
                    if set(old) != set(new):
                        raise ValueError('事实修订不删除或暗加历史字段；请选择已有字段，清空可明确填写null。')
                    return {key: patch(old[key], new[key]) for key in old if old[key] != new[key]}
                return copy.deepcopy(new)
            if edits:
                old, new = edits[0]
                delta = patch(old, new)
                operation_id = 'fact_' + edit_id
                if not any(row.get('id') == operation_id for row in self.store.read_jsonl(project_id, 'canon/revisions.jsonl')):
                    self.store.append_jsonl(project_id, 'canon/revisions.jsonl', {'id': operation_id, 'target_fact_id': old['id'], 'patch': delta,
                        'reason': '恢复本次指定修改' if edit_id.endswith('_restore') else '作者指定修改', 'amendment_id': edit_id.removesuffix('_restore')})
        elif target.endswith('.md'):
            if not isinstance(value, str):
                raise ValueError('正文必须是文字。')
            from services.editing_service import save_snapshot
            from difflib import unified_diff
            original = before
            chapter_id = target.split('/')[-1][:-3]
            if original != value:
                meta = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json')
                if not any(row.get('patch_id') == edit_id for row in meta.get('versions', [])):
                    save_snapshot(self.store, project_id, chapter_id, original, reason='before_apply_patch', patch_id=edit_id)
                self.store.write_md(project_id, target, value)
                if not any(row.get('patch_id') == edit_id for row in self.store.read_jsonl(project_id, f'drafts/{chapter_id}.patch.jsonl')):
                    self.store.append_jsonl(project_id, f'drafts/{chapter_id}.patch.jsonl', {'patch_id': edit_id, 'patch_ops': [{'op_id': edit_id, 'type': 'replace', 'target_range': {'start': 0, 'end': len(original.splitlines())}, 'before': original, 'after': value}], 'accepted_op_ids': [edit_id], 'diff': '\n'.join(unified_diff(original.splitlines(), value.splitlines(), fromfile='before', tofile='after', lineterm=''))})
        elif target.startswith('cards/'):
            if not isinstance(value, dict) or value.get('id') != Path(target).stem:
                raise ValueError('指定修改不能改变资料身份。')
            from services.material_import_service import _validate_fields
            from schemas.json_schemas import CARD_TYPE_SCHEMAS
            if value.get('type') in CARD_TYPE_SCHEMAS:
                _validate_fields(value, CARD_TYPE_SCHEMAS[value['type']])
            from services.shared_material_service import SharedMaterialService
            SharedMaterialService(self.store).validate_card(project_id, value['id'], value, self.read(project_id, target))
            if target == 'cards/outline_author_registry.yaml':
                from services.information_service import InformationService
                information = InformationService(self.store)
                rows = value.get('payload', {}).get('information_registry', [])
                if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows) or len({row.get('id') for row in rows}) != len(rows):
                    raise ValueError('共享信息须保留不重复的稳定身份。')
                for row in rows:
                    information.prepare_item(project_id, row, row)
            from services.world_scope_service import WorldScopeService
            world = WorldScopeService(self.store)
            if value.get('payload', {}).get('world_context'):
                world.validate_context(project_id, value['payload']['world_context'])
            if value.get('payload', {}).get('important_scenes'):
                world.validate_event_links(project_id, value)
            old_payload = self.read(project_id, target).get('payload', {})
            edited = {key: 'author_edit' for key, child in value.get('payload', {}).items() if key not in {'field_provenance', 'sources', 'import_source_keys'} and old_payload.get(key) != child}
            if edited and 'field_provenance' in value.get('payload', {}):
                value['payload']['field_provenance'] = {**value['payload'].get('field_provenance', {}), **edited}
            value['updated_at'] = now_iso()
            self.store.write_yaml(project_id, target, value)
        else:
            self.store.write_json(project_id, target, value)
        from services.incremental_memory_service import IncrementalMemoryService
        IncrementalMemoryService(self.store).mark(project_id, target)

    def apply(self, project_id, edit_id, body, *, restore=False):
        with self.lock(project_id):
            record = self.amendment(project_id, edit_id)
            if record['status'] == ('restored' if restore else 'applied'):
                return {**record, 'value': self.read(project_id, record['target'])}
            check_revision(self.store, project_id, self._path(edit_id), body.get('revision', ''))
            waiting = 'restoring' if restore else 'applying'
            if record['status'] not in {waiting, 'applied' if restore else 'draft'}:
                raise ValueError('这份指定修改不在可采用或恢复的状态。')
            target = record['target']
            current = self.read(project_id, target)
            if not restore and record['status'] != waiting:
                self._check_base(project_id, target, record['base_revision'])
                check_revision(self.store, project_id, CONTROL_PATH, record['control_revision'])
            if record['status'] == waiting:
                pending = record['pending']
                updated = pending['value']
                if _content(current) != _content(updated):
                    self._check_base(project_id, target, pending['base_revision'])
            else:
                updated = copy.deepcopy(current)
                for path in record['paths']:
                    if restore and _content(field(current, path)) != _content(record['applied_values'][path]):
                        raise FileExistsError('本次修改的字段已有后续编辑，恢复已暂停，新的内容没有被覆盖。')
                    value = field(record['original_value'], path, _MISSING) if restore else record['changes'][path]
                    updated = changed(updated, path, value)
                pending = {'value': updated, 'before': current, 'base_revision': self.base_revision(project_id, target)}
                record.update(status=waiting, pending=pending)
                record = self._save(project_id, record)
            # A failed validation stays editable; an interrupted disk write stays retryable.
            try:
                with self._authorized(project_id, target, record['paths']):
                    self.assert_write(project_id, target, current, updated)
                    self._write(project_id, target, updated, edit_id + ('_restore' if restore else ''), pending['before'])
            except (ValueError, FileExistsError):
                if self.base_revision(project_id, target) == pending['base_revision']:
                    record.update(status='applied' if restore else 'draft')
                    record.pop('pending', None)
                    self._save(project_id, record)
                raise
            record.update(status='restored' if restore else 'applied', value=self.read(project_id, target), applied_values={path: field(updated, path) for path in record['paths']}, base_revision=self.base_revision(project_id, target))
            event_id = edit_id + ('_restore' if restore else '_apply')
            if not any(row.get('id') == event_id for row in self.store.read_jsonl(project_id, CONTROL_PATH)):
                targets = [{'target': target, 'paths': record['paths'], 'base_revision': record['base_revision']}]
                if target == 'cards/outline_author_registry.yaml':
                    targets.extend(self._truth_targets(project_id, self.read(project_id, target), record['paths']))
                self.store.append_jsonl(project_id, CONTROL_PATH, {'id': event_id, 'kind': record['status'], 'amendment_id': edit_id, 'target': target, 'paths': record['paths'], 'reason': record['reason'], 'targets': targets})
            record.pop('pending', None)
            return self._save(project_id, record)
