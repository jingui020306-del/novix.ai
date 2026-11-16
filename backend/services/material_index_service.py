"""Rebuildable author search; source files remain the only editable authority."""
from __future__ import annotations

import copy
import hashlib
import json
import re
import sqlite3
import uuid
from collections import Counter, defaultdict

from services.change_suggestion_service import ChangeSuggestionService
from services.edit_version_service import check_revision, revision
from services.world_scope_service import WorldScopeService, entity_id
from storage.fs_store import now_iso


INDEX_PATH = 'meta/material_index.sqlite3'
STATE_PATH = 'meta/material_index_state.json'
TYPE_LABELS = {'character': '人物', 'world': '世界设定', 'worldview': '世界设定', 'world_rule': '规则', 'lore': '背景资料',
               'story': '故事', 'outline': '工作表', 'style': '文风', 'scene': '事件', 'relationship': '关系', 'fact': '事实',
               'chapter': '章节', 'source_material': '原始材料', 'place': '地点', 'region': '地区', 'organization': '组织',
               'faction': '组织', 'civilization': '文明', 'period': '时期', 'species': '族群', 'rule': '规则', 'history': '历史事件'}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def words(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return '\n'.join(words(item) for item in value)
    if isinstance(value, dict):
        return '\n'.join(words(item) for key, item in value.items() if key not in {'_revision', 'reference_choices'})
    return ''


class MaterialIndexService:
    def __init__(self, store):
        self.store = store

    def _files(self, project_id):
        paths = [self.store._safe_path(project_id, 'project.yaml')]
        for folder, patterns in [('cards', ['*.yaml', '*.json']), ('canon', ['*.jsonl']), ('drafts', ['*.md', '*.meta.json', '.chapter_order']),
                                 ('sessions/material_imports', ['*.json']), ('assets', ['**/*.txt'])]:
            directory = self.store._safe_path(project_id, folder)
            paths.extend(path for pattern in patterns for path in directory.glob(pattern) if path.is_file())
        return sorted(set(path for path in paths if path.exists()))

    def _signature(self, project_id):
        root = self.store._project_dir(project_id)
        return digest([(str(path.relative_to(root)), path.stat().st_mtime_ns, path.stat().st_size, path.stat().st_ino)
                       for path in self._files(project_id)])

    def _objects(self, project_id):
        from services.author_data_service import AuthorDataService
        from services.author_control_service import AuthorControlService
        stage_names = defaultdict(list)
        for row in self.store.read_jsonl(project_id, 'canon/author_stages.jsonl'):
            changes = row.get('changes') or {}
            naming = changes.get('name_change') or {}
            aliases = changes.get('aliases') or []
            if row.get('status') == 'confirmed':
                stage_names[row.get('entity_id')].extend(name for name in [naming.get('name'), changes.get('name'), changes.get('period_address'), *(aliases if isinstance(aliases, list) else [aliases])] if isinstance(name, str) and name.strip())
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if not card.get('id') or card.get('id') == 'outline_author_registry':
                continue
            payload = card.get('payload') or {}
            kind = payload.get('entry_type') if card.get('type') in {'world', 'worldview', 'world_rule', 'lore'} else card.get('type')
            kind = kind or card.get('type', 'world')
            aliases = payload.get('aliases', [])
            if isinstance(aliases, str):
                aliases = [aliases]
            aliases = [item for item in aliases if isinstance(item, str) and item.strip()]
            label = str(payload.get('name') or card.get('title') or card['id'])
            names = list(dict.fromkeys([label, str(card.get('title') or ''), *aliases, *stage_names[card['id']]]))
            labels = list(dict.fromkeys([TYPE_LABELS.get(card.get('type'), card.get('type', '资料')), TYPE_LABELS.get(kind, kind)]))
            yield {'id': card['id'], 'label': label, 'type': kind, 'card_type': card.get('type'), 'type_labels': labels,
                            'tags': list(dict.fromkeys(tag.strip() for tag in card.get('tags', []) if isinstance(tag, str) and tag.strip())),
                            'aliases': [name for name in names if name and name != label], 'source': f'cards/{path.name}',
                            'summary': str(payload.get('summary') or payload.get('identity') or payload.get('content') or payload.get('setting') or '')[:500],
                            'scope': payload.get('world_context') or payload.get('scope') or {}, 'text': words(payload), 'card': card}
        for event in AuthorDataService(self.store).events(project_id):
            if event['id'] != event['canonical_id']:
                continue
            row = event['effective_values']
            yield {'id': event['id'], 'label': row.get('scene') or '未命名事件', 'type': 'scene', 'type_labels': ['事件'], 'tags': [], 'aliases': [],
                            'source': event['canonical_source'], 'summary': row.get('plot', '')[:500], 'text': words(row),
                            'scope': row.get('world_context') or {}, 'row': row}
        for row in AuthorDataService(self.store).relationships(project_id):
            yield {'id': row['id'], 'label': row.get('label') or '共享关系', 'type': 'relationship', 'type_labels': ['关系'],
                            'tags': row.get('tags') or [], 'aliases': [], 'source': row['sources'][-1]['path'],
                            'summary': str(row.get('summary') or row.get('description') or row.get('label') or '')[:500],
                            'text': words(row), 'scope': row.get('scope') or {}, 'relationship': row}
        for fact in AuthorControlService(self.store).read(project_id, 'canon/facts.jsonl'):
            yield {'id': 'fact:' + str(fact.get('id') or digest(fact)), 'label': str(fact.get('key') or '作品事实'), 'type': 'fact',
                            'type_labels': ['事实'], 'tags': [], 'aliases': [], 'source': 'canon/facts.jsonl', 'summary': str(fact.get('value') or '')[:500],
                            'text': words(fact), 'scope': fact.get('scope') if isinstance(fact.get('scope'), dict) else {}, 'fact': fact}
        for path in sorted(self.store._safe_path(project_id, 'drafts').glob('*.md')):
            meta = self.store.read_json(project_id, f'drafts/{path.stem}.meta.json')
            text = path.read_text(encoding='utf-8')
            yield {'id': path.stem, 'label': meta.get('chapter_title') or meta.get('title') or path.stem, 'type': 'chapter', 'type_labels': ['章节'],
                            'tags': [], 'aliases': [], 'source': f'drafts/{path.name}', 'summary': meta.get('chapter_summary') or text[:240],
                            'text': text, 'scope': meta.get('world_context') or {}, 'chapter_id': path.stem}
        for path in sorted(self.store._safe_path(project_id, 'sessions/material_imports').glob('*.json')):
            record = self.store.read_json(project_id, f'sessions/material_imports/{path.name}')
            if not record.get('id') or not record.get('source'):
                continue
            from services.material_import_service import MaterialImportService
            reader = MaterialImportService(self.store)
            for source in record.get('sources') or [record['source']]:
                content = reader.source_content(project_id, source)
                text = content.get('original_text') or content.get('text') or '\n'.join(page.get('text', '') for page in content.get('pages', []))
                visual = [self.store.read_json(project_id, page['transcription_path']).get('transcription', '') for page in source.get('pages', []) if page.get('transcription_path')]
                text = '\n'.join([text, source.get('transcription', ''), *visual])
                yield {'id': f"source:{record['id']}:{source.get('id') or source.get('version')}", 'label': source.get('filename') or source.get('url') or '原始材料',
                                'type': 'source_material', 'type_labels': ['原始材料'], 'tags': [], 'aliases': [],
                                'source': source.get('raw_path') or f'sessions/material_imports/{path.name}', 'summary': text[:300],
                                'text': text, 'scope': record.get('world_context') or {}, 'coverage': source.get('coverage'),
                                'source_version': source.get('version'), 'batch_id': record['id'], 'source_id': source.get('id'),
                                'url_preview': f"/api/projects/{project_id}/material-imports/{record['id']}/source?source_id={source.get('id', '')}"}

    def _write_database(self, project_id, path, signature):
        count = 0
        with sqlite3.connect(path) as db:
            db.executescript('''CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
                CREATE TABLE objects(id TEXT PRIMARY KEY,label TEXT,type TEXT,text TEXT,record TEXT);
                CREATE TABLE aliases(name TEXT,object_id TEXT,UNIQUE(name,object_id));
                CREATE INDEX alias_name ON aliases(name);
                CREATE TABLE tags(label TEXT,kind TEXT,object_id TEXT);
                CREATE INDEX tag_label ON tags(label,kind);
                CREATE TABLE relations(id TEXT PRIMARY KEY,source TEXT,target TEXT,label TEXT,record TEXT);
                CREATE TABLE stages(id TEXT PRIMARY KEY,entity_id TEXT,record TEXT);
                CREATE TABLE sources(object_id TEXT,path TEXT,version TEXT,record TEXT);''')
            fts = True
            try:
                db.execute("CREATE VIRTUAL TABLE fulltext USING fts5(object_id UNINDEXED,label,names,text,tokenize='trigram')")
            except sqlite3.OperationalError:
                fts = False
            for item in self._objects(project_id):
                count += 1
                db.execute('INSERT OR REPLACE INTO objects VALUES (?,?,?,?,?)', (item['id'], item['label'], item['type'], item['text'], json.dumps(item, ensure_ascii=False)))
                names = list(dict.fromkeys([item['label'], *item['aliases']]))
                db.executemany('INSERT OR IGNORE INTO aliases VALUES (?,?)', [(name.casefold(), item['id']) for name in names if name])
                db.executemany('INSERT INTO tags VALUES (?,?,?)', [(tag, kind, item['id']) for kind, tags in [('author', item['tags']), ('type', item['type_labels'])] for tag in tags])
                source = self.store._safe_path(project_id, item['source'].split('#')[0])
                version = item.get('source_version') or (hashlib.sha256(source.read_bytes()).hexdigest() if source.is_file() and source.stat().st_size < 5_000_000 else '')
                db.execute('INSERT INTO sources VALUES (?,?,?,?)', (item['id'], item['source'], version, json.dumps({'coverage': item.get('coverage')}, ensure_ascii=False)))
                if fts:
                    db.execute('INSERT INTO fulltext VALUES (?,?,?,?)', (item['id'], item['label'], ' '.join(names), item['text']))
            from services.knowledge_graph_service import KnowledgeGraphService
            for edge in KnowledgeGraphService(self.store).graph(project_id)['edges']:
                db.execute('INSERT OR REPLACE INTO relations VALUES (?,?,?,?,?)', (edge['id'], edge['source'], edge['target'], edge['label'], json.dumps(edge, ensure_ascii=False)))
            for row in self.store.read_jsonl(project_id, 'canon/author_stages.jsonl'):
                if row.get('id'):
                    db.execute('INSERT OR REPLACE INTO stages VALUES (?,?,?)', (row['id'], row.get('entity_id', ''), json.dumps(row, ensure_ascii=False)))
            db.executemany('INSERT INTO metadata VALUES (?,?)', [('generation', signature), ('fts_enabled', str(int(fts))), ('schema', '2')])
            db.commit()
        return {'objects': count, 'fts_enabled': fts}

    def _state(self, project_id, error=None):
        try:
            self.store.write_json(project_id, STATE_PATH, {'state': 'pending' if error else 'ready', 'error': error, 'updated_at': now_iso()})
        except OSError:
            pass

    def status(self, project_id):
        if not self.store._safe_path(project_id, 'project.yaml').exists():
            raise FileNotFoundError('作品或私人资料库不存在。')
        try:
            path = self.store._safe_path(project_id, INDEX_PATH)
            if not path.exists():
                return {'state': 'pending', 'counts': {}, 'fts_enabled': False, 'error': None}
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
                values = dict(db.execute('SELECT key,value FROM metadata'))
                count = db.execute('SELECT count(*) FROM objects').fetchone()[0]
            pending = self.store.read_json(project_id, STATE_PATH)
            state = 'ready' if values.get('schema') == '2' and values.get('generation') == self._signature(project_id) and not pending.get('error') else 'pending'
            return {'state': state, 'revision': values.get('generation'), 'counts': {'objects': count}, 'fts_enabled': values.get('fts_enabled') == '1', 'error': pending.get('error')}
        except (sqlite3.Error, OSError, ValueError):
            return {'state': 'degraded', 'counts': {}, 'fts_enabled': False, 'error': '检索副本需要重建，正式资料仍保留。'}

    def rebuild(self, project_id):
        with ChangeSuggestionService(self.store).lock(project_id):
            self.status(project_id)
            target = self.store._safe_path(project_id, INDEX_PATH)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
            try:
                signature = self._signature(project_id)
                self._write_database(project_id, temporary, signature)
                if signature != self._signature(project_id):
                    raise FileExistsError('资料在整理期间发生变化，请重试检索整理。')
                temporary.replace(target)
                self._state(project_id)
                return self.status(project_id)
            except (sqlite3.Error, OSError, ValueError) as exc:
                self._state(project_id, '检索整理暂未完成；将直接读取已保存资料，可稍后重试。')
                return {**self.status(project_id), 'state': 'degraded', 'error': '检索整理暂未完成；将直接读取已保存资料，可稍后重试。'}
            finally:
                temporary.unlink(missing_ok=True)

    def _rows(self, project_id, query=''):
        state = self.status(project_id)
        if state['state'] != 'ready':
            state = self.rebuild(project_id)
        if state['state'] != 'ready':
            return self._objects(project_id), state
        def read_rows():
            try:
                with sqlite3.connect(self.store._safe_path(project_id, INDEX_PATH)) as db:
                    if query and len(query) >= 3 and state['fts_enabled']:
                        token = '"' + query.replace('"', '""') + '"'
                        rows = db.execute('SELECT record FROM objects WHERE id IN (SELECT object_id FROM fulltext WHERE fulltext MATCH ?)', (token,))
                    elif query:
                        token = '%' + query.casefold().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
                        rows = db.execute("SELECT record FROM objects WHERE lower(label) LIKE ? ESCAPE '\\' OR lower(text) LIKE ? ESCAPE '\\' OR id IN (SELECT object_id FROM aliases WHERE name LIKE ? ESCAPE '\\')", (token, token, token))
                    else:
                        rows = db.execute('SELECT record FROM objects')
                    for row in rows:
                        yield json.loads(row[0])
            except (sqlite3.Error, OSError, ValueError):
                self._state(project_id, '检索副本暂不可用，正在沿用正式资料。')
                state.update(state='degraded', error='检索副本暂不可用，正在沿用正式资料。')
                yield from self._objects(project_id)
        return read_rows(), state

    def _scope(self, project_id, filters):
        context = copy.deepcopy(filters.get('world_context') or {})
        for key in ['world_id', 'branch_id', 'period_id']:
            if filters.get(key):
                context[key] = filters[key]
        if filters.get('region_id'):
            context['region_ids'] = [filters['region_id']]
        if filters.get('year') is not None:
            context['time'] = {**context.get('time', {}), 'year': int(filters['year'])}
        if not context and not filters.get('chapter_id') and not filters.get('story_card_id'):
            return None
        return WorldScopeService(self.store).resolve(project_id, world_context=context, chapter_id=filters.get('chapter_id'), story_card_id=filters.get('story_card_id'))['scope']

    def _visible(self, project_id, item, scope):
        if scope is None:
            return True
        world = WorldScopeService(self.store)
        if item.get('card'):
            return world.card_visible(project_id, item['card'], scope)
        if item.get('fact'):
            return world.fact_visible(project_id, item['fact'], scope)
        return world.applies(project_id, item.get('scope'), scope)[0]

    @staticmethod
    def _public(item):
        return {key: value for key, value in item.items() if key not in {'text', 'card', 'row', 'fact', 'relationship'}}

    def _at_scope(self, project_id, item, scope):
        if scope is None or item.get('card_type') != 'character':
            return item
        from services.author_data_service import AuthorDataService
        state = AuthorDataService(self.store).character_state(project_id, item['id'], world_context=scope)
        names = state['names']
        aliases = [names.get('base_name'), *names.get('aliases', []), names.get('period_address')]
        aliases.extend(name for row in state['changes'] for name in [row.get('changes', {}).get('name_change', {}).get('name'), row.get('changes', {}).get('name')])
        return {**item, 'label': names.get('current_name') or item['label'],
                'aliases': list(dict.fromkeys(name for name in aliases if name and name != names.get('current_name'))),
                'summary': str(state['state'].get('identity') or state['state'].get('summary') or ''),
                'text': words(state['state']), 'scope': scope, 'stage_sources': state['sources']}

    def resolve_names(self, project_id, names, **filters):
        """Find only names mentioned in one import unit; no project catalogue enters the prompt."""
        if not isinstance(names, list) or len(names) > 1000 or any(not isinstance(name, str) or len(name) > 300 for name in names):
            raise ValueError('请按片段提供至多1000个、每个300字以内的名称。')
        wanted = {name.casefold() for name in names if name.strip()}
        matches = {name: [] for name in wanted}
        if not wanted:
            return matches
        rows, _ = self._rows(project_id)
        scope = self._scope(project_id, filters)
        for row in rows:
            if row['type'] in {'source_material', 'chapter', 'scene', 'fact', 'relationship', 'outline'}:
                continue
            if not wanted.intersection(name.casefold() for name in [row['label'], *row['aliases']]) or not self._visible(project_id, row, scope):
                continue
            row = self._at_scope(project_id, row, scope)
            matched = wanted.intersection(name.casefold() for name in [row['label'], *row['aliases']])
            for name in matched:
                matches[name].append({'id': row['id'], 'type': row.get('card_type') or row['type'], 'name': row['label'],
                                      'identity': row['summary'][:500], 'source': row['source']})
        return matches

    def search(self, project_id, **filters):
        query = str(filters.get('q') or '').strip()
        if len(query) > 200:
            raise ValueError('搜索内容请控制在200字内。')
        rows, state = self._rows(project_id, query)
        scope = self._scope(project_id, filters)
        tags = filters.get('tags') or []
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        rows = (self._at_scope(project_id, item, scope) for item in rows if self._visible(project_id, item, scope))
        rows = [self._public(item) for item in rows if (not query or query.casefold() in (item['label'] + ' ' + ' '.join(item['aliases']) + ' ' + item['text']).casefold())
                and (not filters.get('type') or filters['type'] in {item['type'], item.get('card_type')})
                and all(tag in item['tags'] or tag in item['type_labels'] for tag in tags)]
        rows.sort(key=lambda item: (item['label'] != query, query not in [item['label'], *item['aliases']], item['label'], item['id']))
        return {'items': [self._public(item) for item in rows], **state}

    def tags(self, project_id):
        rows, state = self._rows(project_id)
        counts = Counter((label, kind) for item in rows for kind, values in [('author', item['tags']), ('type', item['type_labels'])] for label in values)
        return {'items': [{'label': label, 'kind': kind, 'count': count} for (label, kind), count in sorted(counts.items())], **state}

    def mentions(self, project_id, body):
        text = body.get('text')
        if not isinstance(text, str) or len(text) > 300000:
            raise ValueError('名称识别每次支持30万字以内的文字。')
        rows, state = self._rows(project_id)
        scope = self._scope(project_id, body)
        names = defaultdict(list)
        for item in rows:
            if item['type'] in {'source_material', 'chapter', 'scene', 'style', 'outline', 'story', 'fact', 'relationship'} or not self._visible(project_id, item, scope):
                continue
            if not any(name and name in text for name in [item['label'], *item['aliases']]):
                continue
            item = self._at_scope(project_id, item, scope)
            for name in [item['label'], *item['aliases']]:
                if name.strip() and item['id'] not in {row['id'] for row in names[name]}:
                    names[name].append(item)
        matches, occupied = [], set()
        choices = []
        chapter = body.get('chapter_id')
        if chapter:
            choices = self.store.read_json(project_id, f'drafts/{entity_id(chapter)}.meta.json').get('reference_choices', [])
        elif body.get('target', '').startswith('cards/'):
            choices = self.store.read_yaml(project_id, body['target']).get('reference_choices', [])
        basis = hashlib.sha256(text.encode()).hexdigest()
        for name in sorted(names, key=lambda value: (-len(value), value)):
            for found in re.finditer(re.escape(name), text):
                if set(range(found.start(), found.end())) & occupied:
                    continue
                if re.fullmatch(r'[\w -]+', name, re.ASCII) and ((found.start() and text[found.start() - 1].isascii() and text[found.start() - 1].isalnum()) or (found.end() < len(text) and text[found.end()].isascii() and text[found.end()].isalnum())):
                    continue
                candidates = names[name]
                choice = next((row for row in choices if row.get('text') == name and row.get('source_revision') == basis and row.get('start', found.start()) == found.start() and row.get('end', found.end()) == found.end()), {})
                selected = choice.get('entity_id')
                if selected not in {item['id'] for item in candidates}:
                    selected = candidates[0]['id'] if len(candidates) == 1 else None
                status = 'ignored' if choice.get('ignore') else 'unique' if selected else 'ambiguous'
                matches.append({'start': found.start(), 'end': found.end(), 'text': name, 'status': status, 'selected_id': selected,
                                'candidates': [self._public(item) for item in candidates]})
                occupied.update(range(found.start(), found.end()))
        return {'matches': sorted(matches, key=lambda row: row['start']), 'revision': basis, **state}

    def save_choices(self, project_id, body):
        target = body.get('target', '')
        if not re.fullmatch(r'(cards/[\w-]+\.yaml|drafts/[\w-]+\.(?:meta\.json|md))', target):
            raise ValueError('名称选择须关联已保存的卡片或章节。')
        source_target = target if target.endswith('.md') else target.replace('.meta.json', '.md') if target.startswith('drafts/') else target
        storage_target = target[:-3] + '.meta.json' if target.endswith('.md') else target
        choices = body.get('choices')
        if not isinstance(choices, list) or len(choices) > 1000:
            raise ValueError('名称选择格式不正确。')
        with ChangeSuggestionService(self.store).lock(project_id):
            check_revision(self.store, project_id, target, body.get('base_revision', ''))
            if target.startswith('drafts/') and body.get('meta_revision') is not None:
                check_revision(self.store, project_id, storage_target, body['meta_revision'])
            value = self.store.read_yaml(project_id, storage_target) if target.startswith('cards/') else self.store.read_json(project_id, storage_target)
            if not value:
                raise FileNotFoundError('原资料不存在。')
            if target.startswith('drafts/'):
                text = self.store.read_md(project_id, source_target)
            else:
                from services.author_control_service import field
                pointer = body.get('field') or '/payload/content'
                if not isinstance(pointer, str) or not pointer.startswith('/payload/') or len(pointer) > 1000:
                    raise ValueError('请选择名称出现的具体资料字段。')
                text = field(value, pointer)
            if not isinstance(text, str):
                raise ValueError('请提供本次识别的原文字。')
            if body.get('text') is not None and body['text'] != text:
                raise FileExistsError('原文字已有变化，请保存并重新核对名称。')
            basis = hashlib.sha256(text.encode()).hexdigest()
            if body.get('source_revision') and body['source_revision'] != basis:
                raise FileExistsError('原文字已修改，请重新核对名称。')
            candidates = self.mentions(project_id, {**body, 'text': text, 'target': target})['matches']
            saved = []
            for row in choices:
                match = next((item for item in candidates if item['text'] == row.get('text') and item['start'] == row.get('start', item['start']) and item['end'] == row.get('end', item['end'])), None)
                if not match or not row.get('ignore') and row.get('entity_id') not in {item['id'] for item in match['candidates']}:
                    raise ValueError('请选择该处名称已有的匹配资料，或忽略本次匹配。')
                saved.append({**{key: row[key] for key in ['text', 'start', 'end', 'entity_id', 'ignore'] if key in row}, 'source_revision': basis})
            value['reference_choices'] = [row for row in value.get('reference_choices', []) if row.get('source_revision') == basis and not any(item.get('text') == row.get('text') and item.get('start') == row.get('start') for item in saved)] + saved
            if target.startswith('cards/'):
                self.store.write_yaml(project_id, storage_target, value)
            else:
                self.store.write_json(project_id, storage_target, value)
            return {'saved': len(saved), 'revision': revision(self.store, project_id, source_target), 'body_revision': revision(self.store, project_id, source_target),
                    'meta_revision': revision(self.store, project_id, storage_target), 'source_revision': basis}
