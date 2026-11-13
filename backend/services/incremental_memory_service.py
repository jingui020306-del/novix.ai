from __future__ import annotations

import hashlib
import json
import threading
import uuid
from collections import defaultdict

from services.kb_service import KBService, text_features
from services.summary_service import make_summaries


_LOCKS = defaultdict(threading.RLock)


class IncrementalMemoryService:
    """Local, extractive derivatives. Saving never calls a model."""

    state_path = 'meta/memory_index_state.json'

    def __init__(self, store, kb=None):
        self.store = store
        self.kb = kb or KBService(store)

    def _write_state(self, project_id, state):
        path = self.store._safe_path(project_id, self.state_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
        try:
            temporary.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def _digest(self, project_id, path):
        target = self.store._safe_path(project_id, path)
        raw = target.read_bytes() if target.exists() else b''
        if path.startswith('drafts/') and path.endswith('.meta.json') and raw:
            meta = json.loads(raw)
            raw = json.dumps({key: meta[key] for key in ['title', 'chapter_title', 'volume_id', 'order_index', 'pinned_techniques', 'pinned_technique_categories', 'tool_skill_ids', 'material_ids', 'writing_alignment'] if key in meta}, sort_keys=True, ensure_ascii=False).encode()
        return hashlib.sha256(raw).hexdigest()

    def mark(self, project_id, path):
        with _LOCKS[str(self.store._project_dir(project_id))]:
            state = self.store.read_json(project_id, self.state_path)
            digest = self._digest(project_id, path)
            if state.get('sources', {}).get(path, {}).get('hash') == digest:
                return
            state.setdefault('dirty', {})[path] = digest
            self._write_state(project_id, state)

    def _sources(self, project_id):
        drafts = self.store._safe_path(project_id, 'drafts')
        cards = self.store._safe_path(project_id, 'cards')
        paths = [*drafts.glob('*.md'), *drafts.glob('*.meta.json'), *cards.glob('*.yaml'), *cards.glob('blueprint_*.json')]
        for rel in ['canon/facts.jsonl', 'canon/revisions.jsonl']:
            source = self.store._safe_path(project_id, rel)
            if source.exists():
                paths.append(source)
        root = self.store._project_dir(project_id)
        return {str(path.relative_to(root)): [path.stat().st_mtime_ns, path.stat().st_size] for path in paths}

    def prepare(self, project_id):
        with _LOCKS[str(self.store._project_dir(project_id))]:
            return self._prepare(project_id)

    def _prepare(self, project_id):
        state = self.store.read_json(project_id, self.state_path)
        previous = state.get('sources', {})
        dirty = state.get('dirty', {})
        inventory = self._sources(project_id)
        current = dict(previous)
        changed = []
        for path in sorted(set(inventory) | set(previous) | set(dirty)):
            stamp = inventory.get(path)
            before = previous.get(path, {})
            if stamp == before.get('stamp') and path not in dirty:
                continue
            digest = self._digest(project_id, path)
            if digest != before.get('hash'):
                changed.append(path)
            if stamp is not None:
                current[path] = {'stamp': stamp, 'hash': digest}
            else:
                current.pop(path, None)
        chapters = [path for path in changed if path.startswith('drafts/') and path.endswith('.md')]
        world_rows = self.store.read_jsonl(project_id, 'meta/kb/kb_world/chunks.jsonl')
        indexed_world_paths = {row.get('source', {}).get('path') for row in world_rows if row.get('source', {}).get('kind') == 'world_card'}
        world_paths = [path for path in changed if path.startswith('cards/') and (path in indexed_world_paths or self.store.read_yaml(project_id, path).get('type') in {'world', 'world_rule', 'lore'})]
        facts_changed = bool({'canon/facts.jsonl', 'canon/revisions.jsonl'} & set(changed))
        rebuilt = []
        for path in chapters:
            chapter_id = path.removeprefix('drafts/').removesuffix('.md')
            rebuilt.append(chapter_id)
            if path not in inventory:
                continue
            text = self.store.read_md(project_id, path)
            summary = make_summaries(chapter_id, text)
            # Merge into the current metadata; never replace unrelated author fields.
            meta = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json')
            meta.update({key: summary[key] for key in ['chapter_summary', 'scene_summaries', 'open_questions']})
            self.store.write_json(project_id, f'drafts/{chapter_id}.meta.json', meta)
            self.store.write_md(project_id, f'meta/summaries/{chapter_id}.summary.md', summary['chapter_summary'])
            self.store.write_json(project_id, f'meta/summaries/{chapter_id}.scene_summaries.json', summary['scene_summaries'])
        if chapters:
            rows = self.store.read_jsonl(project_id, 'meta/kb/kb_manuscript/chunks.jsonl')
            rows = [row for row in rows if row.get('source', {}).get('chapter_id') not in rebuilt]
            for chapter_id in rebuilt:
                rows.extend(self.kb._rows_for_chapter(chapter_id, self.store.read_md(project_id, f'drafts/{chapter_id}.md')))
            self._save_rows(project_id, 'kb_manuscript', rows)
        if world_paths or facts_changed:
            rows = world_rows
            rows = [row for row in rows if row.get('source', {}).get('path') not in world_paths and not (facts_changed and row.get('source', {}).get('kind') == 'world_fact')]
            for path in world_paths:
                card = self.store.read_yaml(project_id, path)
                if card.get('type') not in {'world', 'world_rule', 'lore'}:
                    continue
                text = json.dumps(card.get('payload', {}), ensure_ascii=False)
                cid = card.get('id') or path.split('/')[-1].removesuffix('.yaml')
                rows.append(self._row(f'{cid}_c0000', text, {'path': path, 'kind': 'world_card', 'card_id': cid, 'field_path': 'payload'}))
            if facts_changed:
                rows.extend(self.kb.world_fact_rows(project_id))
            self._save_rows(project_id, 'kb_world', rows)
        # External writes may happen while derivatives are prepared. Never bless a stale snapshot.
        latest_inventory = self._sources(project_id)
        observed = {path: stamp for path, stamp in inventory.items() if not path.endswith('.meta.json')}
        latest = {path: stamp for path, stamp in latest_inventory.items() if not path.endswith('.meta.json')}
        if observed != latest or any(self._digest(project_id, path) != current.get(path, {}).get('hash', hashlib.sha256(b'').hexdigest()) for path in changed):
            raise ValueError('资料在准备期间又有修改，请再次生成以读取最新保存内容。')
        state.update(sources=current, dirty={}, summary_method='local_extractive')
        self._write_state(project_id, state)
        return {'updated_sources': changed, 'updated_chapters': rebuilt, 'summary_method': 'local_extractive'}

    def _save_rows(self, project_id, kb_id, rows):
        self.store.write_md(project_id, f'meta/kb/{kb_id}/chunks.jsonl', ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
        # Chunk extraction is incremental; BM25 corpus statistics are recomputed locally.
        self.kb._reindex_kb(project_id, kb_id)

    @staticmethod
    def _row(chunk_id, text, source):
        return {'chunk_id': chunk_id, 'kb_id': 'kb_world', 'asset_id': None, 'ordinal': 0, 'text': text, 'cleaned_text': text, 'features': text_features(text), 'source': source}
