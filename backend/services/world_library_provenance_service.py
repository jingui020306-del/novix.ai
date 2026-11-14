"""Freeze source-book clocks and detach reading positions in a reusable world snapshot.

Only returns a derived manifest; the source project and its locked history are untouched.
"""
import copy
import hashlib
import re

from services.world_scope_service import WorldScopeService


_CHAPTER_KEYS = {'chapter', 'chapter_id', 'first_chapter', 'payoff_chapter', 'introduced_chapter', 'reveal_chapter',
                 'first_chapter_id', 'payoff_chapter_id', 'start_chapter', 'end_chapter'}
_EVENT_KEYS = {'event_ref', 'first_event_ref', 'payoff_event_ref', 'fork_event_ref', 'canonical_event_ref', 'scene_ref'}
_CLOCK_KEYS = {'world_id', 'branch_id', 'time', 'period_id', 'region_ids', 'base_setting_ids', 'local_adjustments', 'overrides', 'pov_character_id'}


def prepare_snapshot_provenance(store, source_project_id, snapshot):
    result = copy.deepcopy(snapshot)
    world = WorldScopeService(store)
    cards = {card['id']: card for card in result.get('cards', [])}
    files = {item['path']: copy.deepcopy(item) for item in result.get('source_files', [])}
    file_text, queue, processed, extra_owners = {}, {}, set(), {}
    warnings = list(result.get('warnings', []))

    def chapter_reference(chapter, original_path=None):
        original_path = original_path or f'drafts/{chapter}.md'
        path = original_path.split('#', 1)[0]
        origin = {'project_id': source_project_id, 'chapter_id': chapter, 'path': original_path}
        if not re.fullmatch(r'drafts/[\w-]+\.md', path):
            return {'path': None, 'source_chapter_id': chapter, 'source_origin': origin, 'source_unavailable': True}
        target = store._safe_path(source_project_id, path)
        if target.is_file():
            before = target.stat()
            raw = target.read_bytes()
            after = target.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise FileExistsError('原章节在世界资料快照期间发生变化，请重新核对。')
            digest = hashlib.sha256(raw).hexdigest()
            files[path] = {'path': path, 'adopt_path': f'assets/world_library_sources/{digest}.md', 'sha256': digest, 'size': len(raw)}
            file_text[path] = raw.decode('utf-8')
            origin['revision'] = digest
        else:
            warnings.append(f'原章节 {chapter} 的正文已不可用；保留原句与出处说明，不指向新作品的同名章节。')
        meta = store.read_json(source_project_id, f'drafts/{chapter}.meta.json') if re.fullmatch(r'[\w-]+', str(chapter)) else {}
        if meta.get('world_context'):
            origin['world_context'] = copy.deepcopy(meta['world_context'])
        if meta.get('story_card_id'):
            origin['story_card_id'] = meta['story_card_id']
        return {'path': original_path if path in files else None, 'source_chapter_id': chapter, 'source_origin': origin,
                **({'source_unavailable': True} if path not in files else {})}

    def card_reference(card):
        path = f"cards/{card['id']}.yaml"
        origin = {'project_id': source_project_id, 'owner_card_id': card['id'], 'owner_type': card.get('type'), 'title': card.get('title')}
        source = store._safe_path(source_project_id, path)
        if path in files:
            origin['revision'] = files[path]['sha256']
        elif source.is_file():
            before = source.stat()
            raw = source.read_bytes()
            after = source.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise FileExistsError('原事件资料在世界快照期间更新，请重新核对。')
            digest = hashlib.sha256(raw).hexdigest()
            files[path] = {'path': path, 'adopt_path': f'assets/world_library_sources/{digest}.yaml', 'sha256': digest, 'size': len(raw)}
            origin['revision'] = digest
        return {'kind': 'world_library_source', 'path': path if path in files else None, 'source_origin': origin}

    def event_reference(value):
        try:
            owner, row, index, canonical = world.event(source_project_id, value)
        except (ValueError, FileNotFoundError) as exc:
            raise ValueError('世界历史的事件出处已不存在，不能把旧编号指向新作品；请先核对原事件。') from exc
        queue[(canonical['owner_card_id'], canonical['scene_id'])] = (owner, row, index, canonical)
        return canonical

    def frozen_scope(scope, *, reference=None, chapter=None, preserve_unknown=False):
        scope = copy.deepcopy(scope or {})
        reference = reference or scope.get('time', {}).get('event_ref') or scope.get('event_ref')
        if reference:
            reference = event_reference(reference)
        resolved = world.resolve(source_project_id, story_card_id=scope.get('story_card_id'),
            chapter_id=None if reference else chapter or scope.get('chapter_id'), event_ref=reference, world_context=scope)['scope']
        value = {key: copy.deepcopy(child) for key, child in resolved.items() if key in _CLOCK_KEYS}
        if reference:
            owner, row, _, _ = world.event(source_project_id, reference)
            story_id = owner['id'] if owner.get('type') == 'story' else owner.get('payload', {}).get('story_card_id')
            story = owner if story_id == owner['id'] else store.read_yaml(source_project_id, f'cards/{story_id}.yaml') if story_id else {}
            inherited = copy.deepcopy(story.get('payload', {}).get('world_context', {}).get('time', {}))
            if row.get('chapter'):
                inherited.update(store.read_json(source_project_id, f"drafts/{row['chapter']}.meta.json").get('world_context', {}).get('time', {}))
            inherited.update(row.get('world_context', {}).get('time', {}))
            value['time'] = {**{key: child for key, child in inherited.items() if key in {'year', 'date', 'elapsed_years'}}, **value.get('time', {})}
        if preserve_unknown:
            value = {key: child for key, child in value.items() if key == 'time' or key in scope}
        if preserve_unknown and not world.has_time(scope) and not reference:
            value['time'] = {}
        if 'pov_character_id' not in scope:
            value.pop('pov_character_id', None)
        return value

    def visit(value, *, source=False):
        if isinstance(value, list):
            return [visit(child, source=source) for child in value]
        if isinstance(value, str):
            if source and re.fullmatch(r'drafts/[\w-]+\.md(?:#.*)?', value):
                chapter = value.split('#', 1)[0][7:-3]
                return {'kind': 'world_library_source', **chapter_reference(chapter, value)}
            return value
        if not isinstance(value, dict):
            return copy.deepcopy(value)
        out, chapters = {}, []
        draft_path = next((value[key] for key in ['path', 'source_path'] if isinstance(value.get(key), str) and value[key].startswith('drafts/') and value[key].split('#', 1)[0].endswith('.md')), None)
        chapter = value.get('chapter_id') if source else None
        if draft_path:
            chapter = draft_path.split('#', 1)[0][7:-3]
        reference = chapter_reference(chapter, draft_path) if chapter else None
        for key, child in value.items():
            if key == 'source_origin' or key.startswith('source_original_') or key in {'source_chapter_id', 'source_chapter_refs'}:
                out[key] = copy.deepcopy(child)
            elif key in _CHAPTER_KEYS and isinstance(child, str) and child:
                if not source or key != 'chapter_id':
                    chapters.append({'field': key, **chapter_reference(child)})
            elif key in _EVENT_KEYS and child:
                out[key] = event_reference(child)
            elif key == 'causal_event_refs' and isinstance(child, list):
                out[key] = [event_reference(item) for item in child]
            else:
                out[key] = visit(child, source=key in {'source', 'sources', 'evidence'})
        if reference:
            prior_origin = out.get('source_origin') or {}
            out.update(reference)
            out['source_origin'] = {**reference['source_origin'], **prior_origin}
            if value.get('kind'):
                out['source_origin'].setdefault('kind', value['kind'])
            out['kind'] = 'world_library_source'
            if draft_path and 'source_path' in value:
                out['source_path'] = reference['path']
            quote = value.get('quote')
            if isinstance(quote, str) and quote:
                path = (draft_path or f'drafts/{chapter}.md').split('#', 1)[0]
                out['source_quote_verified'] = bool(path in file_text and quote in file_text[path])
        if chapters:
            out['source_chapter_refs'] = [*out.get('source_chapter_refs', []), *chapters]
        return out

    def source_scope_origin(item, scope):
        if scope.get('chapter_id') or scope.get('story_card_id'):
            item.setdefault('source_origin', {}).update(project_id=source_project_id, scope=copy.deepcopy(scope))

    def freeze_event(owner, row, index):
        reference = {'owner_card_id': owner['id'], 'scene_id': str(row.get('id') or f'index_{index}')}
        copied = copy.deepcopy(row)
        copied['id'] = reference['scene_id']
        copied['world_context'] = frozen_scope(row.get('world_context'), reference=reference)
        # Preserve a valid original order and explicit predecessors, never the source book's chapter schedule.
        local, shared = [], list(copied.get('causal_event_refs', []) or [])
        for previous in copied.get('causal_scene_ids', []) or []:
            canonical = event_reference({'owner_card_id': owner['id'], 'scene_id': previous})
            if canonical['owner_card_id'] == owner['id']:
                local.append(canonical['scene_id'])
            else:
                shared.append(canonical)
        if 'causal_scene_ids' in copied:
            copied['causal_scene_ids'] = local
        if shared:
            copied['causal_event_refs'] = shared
        return visit(copied)

    for card in list(cards.values()):
        payload = card.get('payload', {})
        if payload.get('world_context'):
            source_scope_origin(payload, payload['world_context'])
            payload['world_context'] = frozen_scope(payload['world_context'], preserve_unknown=True)
        if card.get('type') in {'story', 'outline'}:
            original = store.read_yaml(source_project_id, f"cards/{card['id']}.yaml")
            scenes = [freeze_event(original or card, row, index) for index, row in enumerate(payload.get('important_scenes', [])) if isinstance(row, dict)]
            prepared = payload.get('library_history_anchor') is True
            reference = card_reference(original or card) if not prepared else None
            sources = list(payload.get('sources', []))
            if reference and reference not in sources:
                sources.append(reference)
            title = card.get('title') if prepared else '世界历史锚点 · ' + str(card.get('title') or '原故事')
            card = {'id': card['id'], 'type': 'outline', 'title': title, 'tags': [], 'links': [],
                'payload': {'library_history_anchor': True, 'important_scenes': scenes, 'world_context': payload.get('world_context', {}),
                    'sources': sources, 'source_origin': payload.get('source_origin') if prepared else reference['source_origin']}}
        cards[card['id']] = visit(card)
    for field in ['stages', 'facts', 'relationships', 'information']:
        rows = []
        for original in result.get(field, []):
            item = copy.deepcopy(original)
            if item.get('kind') == 'void':
                rows.append(item)
                continue
            scope = item.get('world_context') or (item.get('scope') if isinstance(item.get('scope'), dict) else {}) or {}
            if field == 'facts':
                scope = {**scope, **{key: item[key] for key in ['world_id', 'branch_id', 'time', 'story_card_id'] if key in item}}
                evidence = item.get('evidence') or {}
                reference = item.get('event_ref') or evidence.get('event_ref')
                item['scope'] = frozen_scope(scope, reference=reference, chapter=evidence.get('chapter_id'))
                item.pop('world_context', None)
                item.pop('story_card_id', None)
            elif scope:
                item['scope'] = frozen_scope(scope, preserve_unknown=True)
            source_scope_origin(item, scope)
            rows.append(visit(item))
        result[field] = rows
    result['sources'] = visit(result.get('sources', []), source=True)

    while queue:
        key, (owner, row, index, canonical) = queue.popitem()
        if key in processed:
            continue
        processed.add(key)
        if owner['id'] in cards:
            continue
        frozen = freeze_event(owner, row, index)
        context = frozen['world_context']
        if context.get('world_id') and context['world_id'] not in cards:
            raise ValueError('历史事件依赖另一个未包含的世界，请先核对采用范围；不会借用新作品的同编号世界。')
        capsule = extra_owners.setdefault(owner['id'], {'id': owner['id'], 'type': 'outline', 'title': '世界历史锚点 · ' + str(owner.get('title') or '原故事'),
            'tags': [], 'links': [], 'payload': {'library_history_anchor': True, 'world_context': {'time': {}, **{key: context[key] for key in ['world_id', 'branch_id'] if key in context}},
                'important_scenes': [], 'sources': [card_reference(owner)],
                'source_origin': {'project_id': source_project_id, 'owner_card_id': owner['id'], 'owner_type': owner.get('type'), 'title': owner.get('title')}}})
        capsule['payload']['important_scenes'].append((index, frozen))
    for owner_id, capsule in extra_owners.items():
        capsule['payload']['important_scenes'] = [row for _, row in sorted(capsule['payload']['important_scenes'], key=lambda item: item[0])]
        cards[owner_id] = capsule
    result['cards'] = list(cards.values())
    result['source_files'] = [files[path] for path in sorted(files)]
    result['warnings'] = list(dict.fromkeys(warnings))
    return result
