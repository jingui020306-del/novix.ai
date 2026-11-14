"""Reusable world files and versioned work instances; SQLite never owns a pack."""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
import uuid
from contextlib import ExitStack
from functools import lru_cache
from pathlib import Path

from services.author_control_service import AuthorControlService
from services.change_suggestion_service import ChangeSuggestionService
from services.edit_version_service import check_revision
from services.world_scope_service import WorldScopeService, entity_id
from storage.fs_store import now_iso


RESOURCE_DIR = Path(__file__).resolve().parents[1] / 'resources/world_library'
WORLD_TYPES = {'world', 'worldview', 'world_rule', 'lore'}
TOOLS = [
    {'id': 'worldspinner', 'title': 'Worldspinner Atlas', 'url': 'https://www.worldspinner.com/fantasyWorldMaps.html', 'description': '下载预生成地图与背景资料包；当前不再提供原交互生成器。'},
    {'id': 'donjon', 'title': 'Donjon', 'url': 'https://donjon.bin.sh/fantasy/', 'description': '世界地图、城镇、日历等细节构思工具。'},
    {'id': 'springhole', 'title': 'Springhole', 'url': 'https://springhole.net/writing_roleplaying_randomators/worldbuilding.htm', 'description': '世界、文化与族群等随机灵感；生成成果可作为原材料导入。'},
]


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def fingerprint(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


@lru_cache(maxsize=1024)
def _file_hash(path, size, modified, inode):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    after = Path(path).stat()
    if (after.st_size, after.st_mtime_ns, after.st_ino) != (size, modified, inode):
        raise FileExistsError('原材料在读取期间发生变化，请重试。')
    return result.hexdigest()


def file_hash(path):
    stat = path.stat()
    return _file_hash(str(path), stat.st_size, stat.st_mtime_ns, stat.st_ino)


def remap(value, identities, paths=None):
    if isinstance(value, list):
        return [remap(item, identities, paths) for item in value]
    if isinstance(value, dict):
        return {key: copy.deepcopy(item) if key == 'source_origin' or key.startswith('source_original_') or key in {'source_chapter_id', 'source_chapter_refs'} else remap(item, identities, paths)
                for key, item in value.items() if key not in {'_revision', '_source_versions', 'change_suggestions'}}
    if isinstance(value, str):
        if value in identities:
            return identities[value]
        if value in (paths or {}):
            return paths[value]
        if '#' in value:
            path, suffix = value.split('#', 1)
            return (paths or {}).get(path, path) + '#' + suffix
        if ':important_scenes:' in value:
            owner, suffix = value.split(':important_scenes:', 1)
            return identities.get(owner, owner) + ':important_scenes:' + identities.get(suffix, suffix)
    return value


class WorldLibraryService:
    def __init__(self, store, resource_dir=None):
        self.store = store
        self.resource_dir = Path(resource_dir) if resource_dir else RESOURCE_DIR

    @staticmethod
    def _summary(pack):
        keys = ['id', 'title', 'summary', 'category', 'tags', 'visibility', 'kind', 'version', 'prepared', 'library_project_id', 'world_id', 'source']
        return {**{key: pack.get(key) for key in keys}, 'entry_count': len(pack.get('cards', [])),
                'attachment_count': len(pack.get('attachments', [])), 'attachment_bytes': sum(item.get('size', 0) for item in pack.get('attachments', []))}

    def list(self, *, category='', visibility=''):
        items = []
        if visibility not in {'', 'public', 'private'}:
            raise ValueError('资料范围请选择公共参考或个人资料。')
        if visibility != 'private':
            for path in sorted(self.resource_dir.glob('*.json')):
                pack = self._builtin(path.stem)
                if not category or pack.get('category') == category:
                    items.append(self._summary(pack))
        if visibility != 'public':
            for project in self.store.list_projects():
                if project.get('kind') != 'world_library':
                    continue
                pack = self._personal(project['id'])
                if not category or pack.get('category') == category:
                    items.append(self._summary(pack))
        return {'items': items, 'tools': TOOLS}

    def _builtin(self, pack_id):
        path = self.resource_dir / (entity_id(pack_id, '世界资料') + '.json')
        if not path.is_file():
            raise FileNotFoundError('公共世界示例不存在。')
        pack = json.loads(path.read_text(encoding='utf-8'))
        if pack.get('format') != 'novix_world_pack' or pack.get('schema_version') != 1:
            raise ValueError('世界示例格式不正确。')
        return {**pack, 'id': pack_id, 'version': fingerprint(pack), 'prepared': bool(pack.get('cards')), 'kind': 'prepared_example', 'visibility': 'public', 'library_project_id': None}

    def _snapshot(self, project_id, world_id=None):
        world = WorldScopeService(self.store)
        all_cards = [self.store.read_yaml(project_id, f'cards/{path.name}') for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml'))]
        cards = [card for card in all_cards if card.get('id') and card.get('id') != 'outline_author_registry' and
                 (not world_id or world.belongs_to_world(project_id, card, world_id))]
        ids = {card['id'] for card in cards}
        ids.update(f"legacy:{card['id']}:relationships:{index}" for card in cards for index, row in enumerate(card.get('payload', {}).get('relationships', [])) if isinstance(row, dict) and row.get('target'))
        registry = self.store.read_yaml(project_id, 'cards/outline_author_registry.yaml').get('payload', {})
        relations = [copy.deepcopy(row) for row in registry.get('relationship_registry', []) if row.get('participants') and all(item.get('entity_id') in ids for item in row['participants'])]
        ids.update(row['id'] for row in relations)
        all_stages = self.store.read_jsonl(project_id, 'canon/author_stages.jsonl')
        from services.author_control_service import AuthorControlService
        facts = [row for row in AuthorControlService(self.store).read(project_id, 'canon/facts.jsonl') if row.get('entity_id') in ids or
                 row.get('world_id') in ids or isinstance(row.get('scope'), dict) and row['scope'].get('world_id') in ids]
        def strings(value):
            if isinstance(value, dict):
                for child in value.values():
                    yield from strings(child)
            elif isinstance(value, list):
                for child in value:
                    yield from strings(child)
            elif isinstance(value, str):
                yield value
        referenced = set(strings([cards, *(row for row in all_stages if row.get('entity_id') in ids)]))
        fact_ids = {row.get('id') for row in facts}
        information = [copy.deepcopy(row) for row in registry.get('information_registry', []) if row.get('id') in referenced or
                       row.get('fact_ref') and row['fact_ref'] in fact_ids or row.get('scope', {}).get('world_id') in ids]
        ids.update(row['id'] for row in information)
        stages = [row for row in all_stages if (row.get('entity_id') in ids or row.get('kind') == 'void') and row.get('record_type') not in {'reader_disclosure', 'review_decision'}]
        included_stages = {row['id'] for row in stages if row.get('entity_id') in ids}
        stages = [row for row in stages if row.get('kind') != 'void' or set(row.get('voids', [])) & included_stages]
        fact_ids = {row.get('id') for row in facts}
        for row in information:
            if row.get('fact_ref') and row['fact_ref'] not in fact_ids:
                fact = next((item for item in AuthorControlService(self.store).read(project_id, 'canon/facts.jsonl') if item.get('id') == row['fact_ref']), None)
                if fact is None:
                    raise ValueError('世界信息引用的原事实不存在，请先核对来源。')
                facts.append(fact)
                fact_ids.add(fact['id'])
        needed = set(strings([cards, stages, facts, information]))
        for card in all_cards:
            if card.get('id') in needed and card['id'] not in ids and card['id'] != 'outline_author_registry':
                cards.append(card)
                ids.add(card['id'])
        from services.world_library_provenance_service import prepare_snapshot_provenance
        prepared = prepare_snapshot_provenance(self.store, project_id, {'cards': cards, 'stages': stages, 'relationships': relations, 'facts': facts, 'information': information})
        cards, stages, relations, facts, information = [prepared[key] for key in ['cards', 'stages', 'relationships', 'facts', 'information']]
        batches = {}
        referenced_files = set()
        def find_sources(value):
            if isinstance(value, dict):
                for field in ['batch_id', 'import_batch_id']:
                    if isinstance(value.get(field), str):
                        bid = entity_id(value[field], '原材料批次')
                        if bid not in batches:
                            record = self.store.read_json(project_id, f'sessions/material_imports/{bid}.json')
                            if record.get('source'):
                                batches[bid] = {key: copy.deepcopy(record[key]) for key in ['id', 'purpose', 'created_at', 'source', 'sources', 'world_context', 'warnings'] if key in record}
                                find_sources(batches[bid])
                for child in value.values():
                    find_sources(child)
            elif isinstance(value, list):
                for child in value:
                    find_sources(child)
            elif isinstance(value, str):
                relative = value.split('#', 1)[0]
                if relative.startswith(('assets/', 'sessions/material_imports/')):
                    path = self.store._safe_path(project_id, relative)
                    if path.is_file() and not (path.parent.name == 'material_imports' and path.suffix == '.json'):
                        referenced_files.add(relative)
        find_sources([cards, stages, relations, facts, information])
        # Raw, not-yet-organized libraries still expose their own original materials.
        if not cards and not world_id:
            for path in self.store._safe_path(project_id, 'sessions/material_imports').glob('*.json'):
                find_sources({'import_batch_id': path.stem})
        for bid in batches:
            for path in self.store._safe_path(project_id, f'sessions/material_imports/{bid}').rglob('*'):
                if path.is_file() and path.suffix not in {'.tmp', '.import'}:
                    referenced_files.add(str(path.relative_to(self.store._project_dir(project_id))))
        attachments = copy.deepcopy(prepared.get('source_files', []))
        for relative in sorted(referenced_files):
            path = self.store._safe_path(project_id, relative)
            attachments.append({'path': relative, 'sha256': file_hash(path), 'size': path.stat().st_size})
        return {'format': 'novix_world_pack', 'schema_version': 1, 'world_id': world_id,
                'cards': copy.deepcopy(cards), 'stages': stages, 'relationships': relations, 'facts': facts, 'information': information, 'attachments': attachments,
                'warnings': [*prepared.get('warnings', []), *(['原作品的读者披露顺序未带入新作品；人物经历与认知仍保留历史。'] if any(row.get('entity_id') in ids and row.get('record_type') == 'reader_disclosure' for row in all_stages) else [])],
                'source_batches': batches,
                'sources': [copy.deepcopy(source) for card in cards for source in card.get('payload', {}).get('sources', [])]}

    def _personal(self, project_id):
        project_id = entity_id(project_id, '个人资料库')
        project = self.store.read_yaml(project_id, 'project.yaml')
        if project.get('kind') != 'world_library' or project.get('visibility') != 'private':
            raise FileNotFoundError('个人世界资料不存在。')
        snapshot = self._snapshot(project_id, project.get('world_id'))
        worlds = [card for card in snapshot['cards'] if card.get('type') in WORLD_TYPES]
        root = next((card for card in worlds if card['id'] == project.get('world_id')), None)
        candidates = [card for card in worlds if card.get('payload', {}).get('entry_type') == 'world']
        if root is None and len(candidates) == 1:
            root = candidates[0]
        candidates = [card for card in worlds if not card.get('payload', {}).get('parent_id') and not card.get('payload', {}).get('world_context', {}).get('world_id')]
        if root is None and len(candidates) == 1:
            root = candidates[0]
        root = root or {}
        if root and not project.get('world_id'):
            snapshot = self._snapshot(project_id, root['id'])
        snapshot['world_id'] = root.get('id')
        snapshot.update(title=project.get('title', '个人世界'), category=project.get('category', '自定义'), tags=project.get('tags', []),
                        summary=project.get('summary') or root.get('payload', {}).get('summary') or root.get('payload', {}).get('content', '')[:250])
        return {**snapshot, 'id': project_id, 'library_project_id': project_id, 'visibility': 'private', 'prepared': bool(root),
                'kind': 'personal_world' if worlds else 'source_material', 'version': fingerprint(snapshot),
                'source': project.get('library_origin') or {'kind': 'personal', 'label': '仅保存在本机的个人资料'}}

    def get(self, pack_id):
        entity_id(pack_id, '世界资料')
        if (self.resource_dir / f'{pack_id}.json').is_file():
            return self._builtin(pack_id)
        return self._personal(pack_id)

    def create(self, body):
        title = str(body.get('title') or '').strip()
        if not title or len(title) > 200:
            raise ValueError('请为个人世界资料填写200字以内的名称。')
        category = str(body.get('category') or '自定义').strip()
        if len(category) > 100:
            raise ValueError('世界类型名称过长。')
        project_id = 'world_library_' + uuid.uuid4().hex[:12]
        self.store.ensure_project(project_id, title)
        project = self.store.read_yaml(project_id, 'project.yaml')
        project.update(kind='world_library', visibility='private', category=category)
        self.store.write_yaml(project_id, 'project.yaml', project)
        return self._personal(project_id)

    def _record_path(self, request_id):
        return f'sessions/world_library/{entity_id(request_id, "采用记录")}.json'

    def _check_operations(self, project_id, operations):
        controls = AuthorControlService(self.store)
        for operation in operations:
            path = operation['path']
            if operation['kind'] == 'append':
                for row in operation['rows']:
                    controls.assert_append(project_id, path, row)
            else:
                current = self.store._safe_path(project_id, path)
                text = current.read_text(encoding='utf-8') if current.exists() else None
                if text not in {operation['before'], operation['after']}:
                    raise FileExistsError('采用过程中资料已有新编辑，已暂停，请核对后重试。')
                before = self.store.read_yaml(project_id, path) if text else {}
                after = operation.get('after_value') if 'after_value' in operation else json.loads(operation['after']) if operation['after'] is not None else None
                controls.assert_write(project_id, path, before, after)

    def apply_operations(self, project_id, operations):
        from services.incremental_memory_service import IncrementalMemoryService
        from storage.fs_store import _atomic_text
        self._check_operations(project_id, operations)
        for operation in operations:
            path = operation['path']
            if operation['kind'] == 'append':
                ids = {row.get('id') for row in self.store.read_jsonl(project_id, path)}
                for row in operation['rows']:
                    if row.get('id') not in ids:
                        self.store.append_jsonl(project_id, path, row)
            else:
                target = self.store._safe_path(project_id, path)
                if operation['after'] is None:
                    target.unlink(missing_ok=True)
                elif not target.exists() or target.read_text(encoding='utf-8') != operation['after']:
                    _atomic_text(target, operation['after'])
            IncrementalMemoryService(self.store).mark(project_id, path)

    def _execute(self, project_id, record):
        self.apply_operations(project_id, record['operations'])
        record.update(status='adopted', adopted_at=now_iso())
        self.store.write_json(project_id, self._record_path(record['id']), record)
        return record['result']

    def recover_pending(self, project_id):
        directory = self.store._safe_path(project_id, 'sessions/world_library')
        for path in directory.glob('*.json'):
            record = self.store.read_json(project_id, f'sessions/world_library/{path.name}')
            if record.get('status') == 'applying':
                with ChangeSuggestionService(self.store).lock(project_id):
                    self._execute(project_id, record)

    def _copy_assets(self, source_project, target_project, adoption_id, attachments, batch_ids=None):
        paths = {}
        for item in attachments:
            source = self.store._safe_path(source_project, item['path'])
            if file_hash(source) != item['sha256']:
                raise FileExistsError('原附件已有变化，请重新核对世界资料版本。')
            relative = item.get('adopt_path') or f"assets/world_library/{adoption_id}/{item['path']}"
            for original, mapped in (batch_ids or {}).items():
                prefix = f'sessions/material_imports/{original}/'
                if item['path'].startswith(prefix):
                    relative = f'sessions/material_imports/{mapped}/' + item['path'][len(prefix):]
                    break
            target = self.store._safe_path(target_project, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists() or file_hash(target) != item['sha256']:
                temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
                try:
                    shutil.copyfile(source, temporary)
                    if file_hash(temporary) != item['sha256']:
                        raise FileExistsError('复制附件时原材料发生变化，请重试。')
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
            paths[item['path']] = relative
        return paths

    def _adopt(self, project_id, pack, body):
        request_id = entity_id(body.get('request_id') or 'adopt_' + uuid.uuid4().hex[:18], '采用记录')
        target_path = self._record_path(request_id)
        existing = self.store.read_json(project_id, target_path)
        key = fingerprint({'pack': pack['id'], 'version': body.get('version'), 'selected_ids': body.get('selected_ids'), 'title': body.get('title')})
        if existing:
            if existing.get('request_hash') != key:
                raise FileExistsError('这次采用编号已用于另一份选择，请重新建立操作。')
            return existing['result'] if existing['status'] == 'adopted' else self._execute(project_id, existing)
        if not pack.get('prepared'):
            raise ValueError('这仍是原始材料，请先在个人资料库整理、核对并确认条目，再供作品选用。')
        if body.get('version') != pack['version']:
            raise FileExistsError('世界资料库已有新版本，请重新核对采用范围。')
        all_cards = {card['id']: card for card in pack.get('cards', [])}
        if 'selected_ids' in body and (not isinstance(body['selected_ids'], list) or any(not isinstance(item, str) for item in body['selected_ids'])):
            raise ValueError('请选择要采用的世界条目列表。')
        selected = set(body['selected_ids']) if 'selected_ids' in body else set(all_cards)
        if not selected:
            raise ValueError('请至少选择一项世界资料。')
        if not selected <= set(all_cards):
            raise ValueError('所选世界条目不存在，请刷新资料。')
        selected.add(pack['world_id'])
        requested = set(selected)
        pending = list(selected)
        def references(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key not in {'id', 'summary', 'content', 'description', 'quote', 'text', 'original_text', 'source_origin', 'source_chapter_id', 'source_chapter_refs'} and not key.startswith('source_original_'):
                        yield from references(child)
            elif isinstance(value, list):
                for child in value:
                    yield from references(child)
            elif isinstance(value, str):
                if value in all_cards:
                    yield value
                elif ':important_scenes:' in value and value.split(':', 1)[0] in all_cards:
                    yield value.split(':', 1)[0]
                elif value.startswith('cards/') and value.split('#', 1)[0].endswith('.yaml'):
                    yield Path(value.split('#', 1)[0]).stem
        while pending:
            card = all_cards[pending.pop()]
            facts_for_card = [row for row in pack.get('facts', []) if row.get('entity_id') == card['id'] or row.get('scope', {}).get('world_id') == card['id'] or row.get('world_id') == card['id']]
            info_for_card = [row for row in pack.get('information', []) if row.get('scope', {}).get('world_id') == card['id'] or row.get('fact_ref') and row['fact_ref'] in {fact.get('id') for fact in facts_for_card}]
            facts_for_card.extend(row for row in pack.get('facts', []) if row.get('id') in {item.get('fact_ref') for item in info_for_card} and row not in facts_for_card)
            needed = [card, *facts_for_card, *info_for_card, *(row for row in pack.get('stages', []) if row.get('entity_id') == card['id'] or row.get('entity_id') in {item['id'] for item in info_for_card})]
            for target in references(needed):
                if target in all_cards and target not in selected:
                    selected.add(target)
                    pending.append(target)
        identity = {old: 'world_' + uuid.uuid5(uuid.NAMESPACE_URL, request_id + ':' + old).hex[:18] for old in selected}
        for old in selected:
            for index, row in enumerate(all_cards[old].get('payload', {}).get('relationships', [])):
                if isinstance(row, dict) and row.get('target'):
                    identity[f'legacy:{old}:relationships:{index}'] = f'legacy:{identity[old]}:relationships:{index}'
        relations = [row for row in pack.get('relationships', []) if all(item.get('entity_id') in selected for item in row.get('participants', []))]
        identity.update({row['id']: 'relationship_' + uuid.uuid5(uuid.NAMESPACE_URL, request_id + ':' + row['id']).hex[:18] for row in relations})
        applicable_ids = set(identity) | {row['id'] for row in relations}
        facts = [row for row in pack.get('facts', []) if row.get('entity_id') in applicable_ids or not row.get('entity_id') and
                 (row.get('world_id') in selected or isinstance(row.get('scope'), dict) and row['scope'].get('world_id') in selected)]
        selected_text = encoded([[all_cards[old] for old in selected], [row for row in pack.get('stages', []) if row.get('entity_id') in applicable_ids]])
        fact_ids = {row.get('id') for row in facts}
        information = [row for row in pack.get('information', []) if row.get('scope', {}).get('world_id') in selected or f'"{row["id"]}"' in selected_text or row.get('fact_ref') and row['fact_ref'] in fact_ids]
        facts.extend(row for row in pack.get('facts', []) if row.get('id') in {item.get('fact_ref') for item in information} and row not in facts)
        identity.update({row['id']: 'information_' + uuid.uuid5(uuid.NAMESPACE_URL, request_id + ':' + row['id']).hex[:18] for row in information})
        applicable_ids.update(row['id'] for row in information)
        stage_rows = [row for row in pack.get('stages', []) if row.get('entity_id') in applicable_ids and
                      (not row.get('data', {}).get('character_id') or row['data']['character_id'] in selected) and
                      (not row.get('data', {}).get('speaker_id') or row['data']['speaker_id'] in selected)]
        stage_ids = {row['id'] for row in stage_rows}
        stage_rows.extend(row for row in pack.get('stages', []) if row.get('kind') == 'void' and set(row.get('voids', [])) & stage_ids)
        identity.update({row['id']: 'stage_' + uuid.uuid5(uuid.NAMESPACE_URL, request_id + ':' + row['id']).hex[:18] for row in stage_rows})
        identity.update({row['id']: 'fact_' + uuid.uuid5(uuid.NAMESPACE_URL, request_id + ':' + row['id']).hex[:18] for row in facts if row.get('id')})
        def check_entity_references(value):
            if isinstance(value, list):
                for child in value:
                    check_entity_references(child)
            elif isinstance(value, dict):
                for field, child in value.items():
                    if field == 'source_origin' or field.startswith('source_original_') or field in {'source_chapter_id', 'source_chapter_refs'}:
                        continue
                    if field in {'character_id', 'pov_character_id', 'speaker_id', 'audience_ids', 'heard_by', 'known_by', 'target_ids', 'relationship_ids', 'information_id', 'information_ids', 'fact_ref', 'entity_id', 'world_id', 'parent_id', 'base_setting_ids', 'region_ids'}:
                        values = child if isinstance(child, list) else [child]
                        if any(isinstance(item, str) and item and item not in identity for item in values):
                            raise ValueError('所选资料存在未包含的人物、信息或设定引用，请补选关联条目并核对后采用；不会借用当前作品的同编号资料。')
                    check_entity_references(child)
        check_entity_references([[all_cards[old] for old in selected], relations, information, stage_rows, facts])
        source_project = pack.get('library_project_id')
        batch_ids = {old: 'import_lib_' + uuid.uuid5(uuid.NAMESPACE_URL, request_id + ':' + old).hex[:18] for old in pack.get('source_batches', {})}
        identity.update(batch_ids)
        paths = {f'cards/{old}.yaml': f'cards/{new}.yaml' for old, new in identity.items() if old in all_cards}
        paths.update({f'sessions/material_imports/{old}.json': f'sessions/material_imports/{new}.json' for old, new in batch_ids.items()})
        if source_project:
            paths.update(self._copy_assets(source_project, project_id, request_id, pack.get('attachments', []), batch_ids))
        for old, original in pack.get('source_batches', {}).items():
            capsule = remap(original, identity, paths)
            capsule.update(id=batch_ids[old], status='applied', reference_only=True, candidates=[], operations=[], results=[], usage_calls=[])
            path = f"sessions/material_imports/{batch_ids[old]}.json"
            previous = self.store.read_json(project_id, path)
            if previous and previous != capsule:
                raise FileExistsError('原材料出处副本已有后续编辑，不能静默覆盖。')
            self.store.write_json(project_id, path, capsule)
        operations = []
        for old in sorted(selected):
            card = remap(all_cards[old], identity, paths)
            payload = card.setdefault('payload', {})
            if old == pack['world_id']:
                card['title'] = str(body.get('title') or card.get('title') or pack['title'])[:200]
                payload['library_source'] = {'id': pack['id'], 'version': pack['version'], 'source_world_id': pack['world_id'], 'adoption_id': request_id, 'visibility': pack['visibility']}
            if card.get('type') in WORLD_TYPES and old != pack['world_id'] and not payload.get('parent_id') and not payload.get('world_context'):
                payload['parent_id'] = identity[pack['world_id']]
            path = f"cards/{card['id']}.yaml"
            before_path = self.store._safe_path(project_id, path)
            if before_path.exists():
                raise FileExistsError('本次新世界编号与已有资料冲突，请重新建立采用操作。')
            operations.append({'path': path, 'before': None, 'after': encoded(card), 'kind': 'replace'})
        if relations or information:
            path = 'cards/outline_author_registry.yaml'
            registry = self.store.read_yaml(project_id, path) or {'id': 'outline_author_registry', 'type': 'outline', 'title': '作者资料关联', 'tags': [], 'links': [], 'payload': {}}
            before = self.store._safe_path(project_id, path)
            registry.setdefault('payload', {}).setdefault('relationship_registry', []).extend(remap(relations, identity, paths))
            registry['payload'].setdefault('information_registry', []).extend(remap(information, identity, paths))
            operations.append({'path': path, 'before': before.read_text(encoding='utf-8') if before.exists() else None, 'after': encoded(registry), 'kind': 'replace'})
        for path, rows in [('canon/author_stages.jsonl', stage_rows), ('canon/facts.jsonl', facts)]:
            if rows:
                operations.append({'path': path, 'rows': remap(rows, identity, paths), 'kind': 'append'})
        self._check_operations(project_id, operations)
        result = {'world_id': identity[pack['world_id']], 'card_ids': [identity[old] for old in sorted(selected)], 'adoption_id': request_id, 'source_version': pack['version'],
                  'source': pack.get('source'), 'added_dependencies': sorted(selected - requested), 'warnings': pack.get('warnings', [])}
        record = {'id': request_id, 'status': 'applying', 'request_hash': key, 'created_at': now_iso(), 'operations': operations,
                  'source_snapshot': {**copy.deepcopy(pack), 'attachments': remap(pack.get('attachments', []), {}, paths)}, 'result': result}
        self.store.write_json(project_id, target_path, record)
        return self._execute(project_id, record)

    def adopt(self, pack_id, body):
        entity_id(pack_id, '世界资料')
        project_id = entity_id(body.get('project_id'), '作品')
        if not self.store.read_yaml(project_id, 'project.yaml'):
            raise FileNotFoundError('作品不存在。')
        with ExitStack() as stack:
            source_project = pack_id if self.store.read_yaml(pack_id, 'project.yaml').get('kind') == 'world_library' else None
            for value in sorted({project_id, source_project} - {None}):
                stack.enter_context(ChangeSuggestionService(self.store).lock(value))
            return self._adopt(project_id, self.get(pack_id), body)

    def save(self, project_id, body):
        world_id = entity_id(body.get('world_id'), '世界')
        with ChangeSuggestionService(self.store).lock(project_id):
            card = self.store.read_yaml(project_id, f'cards/{world_id}.yaml')
            if card.get('type') not in WORLD_TYPES:
                raise ValueError('请选择一个已保存的世界。')
            check_revision(self.store, project_id, f'cards/{world_id}.yaml', body.get('base_revision'))
            source = self._snapshot(project_id, world_id)
            source.update(id='source_' + project_id + '_' + world_id, title=card.get('title'), prepared=True, visibility='private',
                          library_project_id=project_id, source={'kind': 'author_world', 'project_id': project_id, 'world_id': world_id})
            source['version'] = fingerprint(source)
            library = self.create({'title': body.get('title') or card.get('title'), 'category': body.get('category') or '自定义'})
            with ChangeSuggestionService(self.store).lock(library['library_project_id']):
                result = self._adopt(library['library_project_id'], source, {'version': source['version'], 'request_id': 'save_' + uuid.uuid4().hex[:18]})
                project = self.store.read_yaml(library['library_project_id'], 'project.yaml')
                project['library_origin'] = source['source']
                project['world_id'] = result['world_id']
                self.store.write_yaml(library['library_project_id'], 'project.yaml', project)
            return {**self._personal(library['library_project_id']), 'world_id': result['world_id']}

    def diff(self, project_id, world_id):
        card = self.store.read_yaml(project_id, f'cards/{entity_id(world_id)}.yaml')
        source = card.get('payload', {}).get('library_source') or {}
        if not source:
            return {'current_source_version': None, 'latest_source_version': None, 'changed': [], 'added': [], 'removed': [], 'can_update': False}
        adopted = self.store.read_json(project_id, self._record_path(source['adoption_id']))
        old = adopted.get('source_snapshot', {})
        if source['id'].startswith('source_'):
            return {'current_source_version': source['version'], 'latest_source_version': source['version'], 'changed': [], 'added': [], 'removed': [], 'can_update': False}
        latest = self.get(source['id'])
        before = {row['id']: row for row in old.get('cards', [])}
        after = {row['id']: row for row in latest.get('cards', [])}
        return {'current_source_version': source['version'], 'latest_source_version': latest['version'],
                'changed': [{'id': key, 'label': after[key].get('title'), 'before': before[key], 'after': after[key]} for key in before.keys() & after.keys() if before[key] != after[key]],
                'added': [after[key] for key in after.keys() - before.keys()], 'removed': [before[key] for key in before.keys() - after.keys()],
                'can_update': source['version'] != latest['version']}
