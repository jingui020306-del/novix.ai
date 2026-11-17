"""Author planning is private. Only confirmed excerpts and explicit public cues reach prose."""
from __future__ import annotations

import uuid

from services.edit_version_service import check_revision, revision
from services.author_data_service import STAGES_PATH
from services.information_service import InformationService, REGISTRY_PATH
from services.world_scope_service import entity_id


LEVELS = ('book', 'unit', 'chapter')
HOOKS = ('danger', 'choice', 'anomaly', 'shift', 'identity', 'other')
EVIDENCE = ('reminder', 'clue', 'choice', 'cost', 'misdirection', 'payoff')
DEFAULTS = {'book_min': 2, 'book_max': 4, 'hook_chapters': 3, 'reminder_limit': 3, 'pressure_limit': 3}


def wording(value, limit, label):
    if value is None:
        return ''
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f'{label}请填写{limit}字以内的文字。')
    return value.strip()


def find_thread(threads, thread_id):
    for thread in threads:
        if thread['id'] == thread_id:
            return thread
    raise FileNotFoundError('找不到所选悬念，请刷新后核对。')


class SuspenseService:
    def __init__(self, store):
        self.store = store
        self.info = InformationService(store)

    def _location(self, project_id, story_id, chapter_id=None, branch_id=None):
        story = self.store.read_yaml(project_id, f'cards/{entity_id(story_id, "故事")}.yaml')
        if story.get('type') != 'story':
            raise FileNotFoundError('请先保存故事策划。')
        context = dict(story.get('payload', {}).get('world_context') or {})
        if chapter_id:
            meta = self.store.read_json(project_id, f'drafts/{entity_id(chapter_id, "章节")}.meta.json')
            context.update(meta.get('world_context') or {})
        branch = entity_id(branch_id or context.get('branch_id') or 'main', '分支')
        if context.get('world_id'):
            branches = self.info.world.branches(project_id, context['world_id'])
            if branch not in {r['id'] for r in branches}:
                raise ValueError('所选世界没有这个分支。')
        elif branch != 'main':
            raise ValueError('请先在世界资料中建立并关联这个分支。')
        return story, branch, f'sessions/suspense/{story_id}/{branch}.json'

    def _chapters(self, project_id, story, branch):
        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
        stories = {}
        for path in self.store._safe_path(project_id, 'cards').glob('*.yaml'):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if card.get('type') == 'story':
                stories[card['id']] = {row.get('chapter_id') or row.get('chapter') for row in
                    card.get('payload', {}).get('chapter_plan') or [] if isinstance(row, dict)}
        # An orphaned draft can still be annotated, but its filename cannot establish reading order.
        legacy = sorted(p.stem for p in self.store._safe_path(project_id, 'drafts').glob('*.md'))
        ordered = set(order)
        result = []
        story_branch = (story.get('payload', {}).get('world_context') or {}).get('branch_id') or 'main'
        for key in dict.fromkeys([*order, *legacy]):
            if not key:
                continue
            meta = self.store.read_json(project_id, f'drafts/{entity_id(key)}.meta.json')
            context = meta.get('world_context') or {}
            owner = meta.get('story_card_id') or (meta.get('writing_alignment') or {}).get('story_card_id') or context.get('story_card_id')
            if owner:
                if owner != story['id']:
                    continue
            elif len(stories) > 1 and [sid for sid, ids in stories.items() if key in ids] != [story['id']]:
                continue
            if (context.get('branch_id') or story_branch) == branch:
                result.append({'id': key, 'title': meta.get('title') or meta.get('chapter_title') or key,
                               'volume_id': meta.get('volume_id') or 'volume_default', 'ordered': key in ordered})
        return result

    def snapshot(self, project_id, story_id, chapter_id=None, branch_id=None):
        with self.info._lock(project_id):
            story, branch, path = self._location(project_id, story_id, chapter_id, branch_id)
            data = self.store.read_json(project_id, path)
            chapters = self._chapters(project_id, story, branch)
            if chapter_id and not any(row['id'] == chapter_id for row in chapters):
                raise ValueError('本章不属于所选故事和分支。')
            settings = {**DEFAULTS, **data.get('settings', {})}
            threads = data.get('threads', [])
            ranks = {c['id']: i for i, c in enumerate(chapters) if c['ordered']}
            visible_chapters = {c['id'] for c in chapters}
            versions = {}
            self._link_children(threads)
            for thread in threads:
                for mark in [*thread['evidence'], *thread['linked_progress']]:
                    key = mark['chapter_id']
                    if key not in versions:
                        versions[key] = revision(self.store, project_id, f'drafts/{entity_id(key)}.md')
                    mark['valid'] = key in visible_chapters and bool(versions[key]) and versions[key] == mark['source_revision']
                active = [e for e in [*thread['evidence'], *thread['linked_progress']] if e['valid'] and (not chapter_id or e['chapter_id'] == chapter_id or
                          e['chapter_id'] in ranks and ranks[e['chapter_id']] < ranks.get(chapter_id, -1))]
                thread['status'] = 'paid' if any(e['kind'] == 'payoff' for e in active) else 'open' if active else 'planned'
            current = chapter_id or next((key for key in reversed(ranks)
                       if self.store.read_md(project_id, f'drafts/{key}.md').strip()), None)
            return {'story_id': story_id, 'branch_id': branch, '_revision': revision(self.store, project_id, path),
                    'threads': threads, 'chapters': chapters, 'settings': settings,
                    'checks': self._checks(threads, chapters, ranks, current, settings)}

    @staticmethod
    def _link_children(threads):
        by_id = {t['id']: t for t in threads}
        for t in threads:
            t['linked_progress'] = []
        for t in threads:
            parent = by_id.get(t.get('parent_id'))
            if parent:
                parent['linked_progress'].extend({**e, 'kind': 'clue', 'origin_thread_id': t['id']}
                    for e in t['evidence'] if e['kind'] == 'payoff')

    @staticmethod
    def _checks(threads, chapters, ranks, current, settings):
        checks = []
        def warn(code, thread, chapter, message):
            checks.append({'code': code, 'thread_id': thread.get('id', ''), 'chapter_id': chapter or '', 'message': message})
        end = ranks.get(current, -1)
        book_count = sum(t['level'] == 'book' for t in threads)
        if threads and not settings['book_min'] <= book_count <= settings['book_max']:
            warn('book_count', {}, None, f"已规划 {book_count} 条全书期待，可对照本故事的数量预设。")
        hooks, units = {}, []
        for thread in threads:
            setup = thread.get('setup_chapter_id')
            evidence = [*thread['evidence'], *thread['linked_progress']]
            marks = sorted((e for e in evidence if e['valid'] and ranks.get(e['chapter_id'], end + 1) <= end),
                           key=lambda e: (ranks[e['chapter_id']], e['start']))
            for e in evidence:
                if not e['valid']:
                    warn('stale_excerpt', thread, e['chapter_id'], '正文依据有变动，请重新选取原句。')
            paid = next((e for e in marks if e['kind'] == 'payoff'), None)
            due = ranks.get(thread.get('due_to'))
            if due is None and thread['level'] == 'chapter' and setup in ranks and not thread.get('due_to'):
                due = ranks[setup] + (thread.get('interval') or settings['hook_chapters'])
            if due is not None and end > due and not paid:
                warn('overdue', thread, thread.get('due_to') or setup, '已过计划回应区间，尚无有效兑现原句。')
            if paid and thread.get('due_from') in ranks and ranks[paid['chapter_id']] < ranks[thread['due_from']]:
                warn('early_payoff', thread, paid['chapter_id'], '正文提前回应了这条悬念，请核对揭晓位置。')
            if thread['level'] != 'chapter' and not paid and setup in ranks and end >= ranks[setup]:
                last = max([ranks[setup]] + [ranks[e['chapter_id']] for e in marks if e['kind'] != 'reminder'])
                idle_volumes = {c['volume_id'] for c in chapters[last:end + 1]}
                if ((thread.get('interval') and end - last >= thread['interval']) or
                    (not thread.get('interval') and len(idle_volumes) >= 3)):
                    warn('dormant', thread, setup, '这条期待已有一段时间没有新进展，可安排线索、选择或代价。')
            reminder_chapters, known = set(), set()
            for e in marks:
                key = ''.join(e['quote'].split())
                if e['kind'] == 'reminder' or key in known:
                    reminder_chapters.add(e['chapter_id'])
                else:
                    reminder_chapters.clear()
                    known.add(key)
                if len(reminder_chapters) == settings['reminder_limit']:
                    warn('repeated_prompt', thread, e['chapter_id'], '连续重提同一期待，尚无新的线索、选择或代价。')
                    break
            if paid and paid.get('payoff_type') == 'derivative' and not paid.get('followup_id'):
                warn('missing_followup', thread, paid['chapter_id'], '已标记衍生式兑现，可关联新引出的悬念。')
            if paid and any(e['kind'] == 'misdirection' and not e.get('explanation') for e in marks):
                warn('unexplained_clue', thread, paid['chapter_id'], '已有误导线索尚未注明揭晓后的解释。')
            if thread['level'] == 'chapter' and setup in ranks and ranks[setup] <= end:
                hooks.setdefault(setup, []).append(thread)
            if thread['level'] == 'unit':
                units.append((thread, paid))
        previous_type, length, pressure = None, 0, 0
        for chapter in chapters:
            same_chapter = hooks.get(chapter['id'], [])
            kinds = {t.get('hook_type') for t in same_chapter}
            kind = next(iter(kinds)) if len(kinds) == 1 else None
            length = length + 1 if kind and previous_type == kind else 1
            previous_type = kind
            pressure = pressure + 1 if kinds and kinds <= {'choice', 'danger'} else 0
            if same_chapter and not any(t.get('climax') for t in same_chapter):
                if max(length if kind else 0, pressure) >= settings['pressure_limit']:
                    warn('hook_rhythm', same_chapter[0], chapter['id'], '近期章尾连续使用相近钩子，可换一种牵引方式。')
        volumes = {c['id']: c['volume_id'] for c in chapters}
        for index, (before, after) in enumerate(zip(chapters, chapters[1:])):
            if before['volume_id'] == after['volume_id'] or index > end or not before['ordered'] or not after['ordered']:
                continue
            for t, paid in units:
                if paid and volumes.get(paid['chapter_id']) == before['volume_id'] and ranks[paid['chapter_id']] <= index:
                    relay = any(other['id'] != t['id'] and (
                        paid.get('followup_id') == other['id'] or
                        other.get('setup_chapter_id') in ranks and ranks[other['setup_chapter_id']] <= index and
                        ranks.get(other.get('due_to'), -1) > index) for other, _ in units)
                    if not relay:
                        warn('volume_handoff', t, before['id'], '卷内悬念已收束，可在卷末埋入下一单元的第一条线索。')
        return checks

    def change(self, project_id, story_id, body, *, action='plan', thread_id=None, evidence_id=None):
        with self.info._lock(project_id):
            story, branch, path = self._location(project_id, story_id, body.get('chapter_id'), body.get('branch_id'))
            if not isinstance(body.get('_revision'), str):
                raise ValueError('请从最新悬念计划保存。')
            check_revision(self.store, project_id, path, body['_revision'])
            data = self.store.read_json(project_id, path)
            threads = data.setdefault('threads', [])
            chapters = self._chapters(project_id, story, branch)
            if action == 'plan':
                if 'settings' in body:
                    settings = body['settings']
                    if not isinstance(settings, dict) or set(settings) - DEFAULTS.keys() or any(
                        type(value) is not int or not 1 <= value <= 1000 for value in settings.values()):
                        raise ValueError('预设数量请填写 1 至 1000 的整数。')
                    data['settings'] = {**DEFAULTS, **data.get('settings', {}), **settings}
                    if data['settings']['book_min'] > data['settings']['book_max']:
                        raise ValueError('全书期待的下限不能大于上限。')
                if 'thread' in body:
                    self._save_thread(project_id, story, branch, threads, chapters, body['thread'])
                elif 'settings' not in body:
                    raise ValueError('请填写悬念计划。')
            else:
                thread = find_thread(threads, thread_id)
                if action == 'add':
                    if body.get('review_basis'):
                        from services.suspense_review import check_review_basis
                        check_review_basis(self.store, project_id, story_id, thread_id, body)
                    self._add_evidence(project_id, thread, threads, chapters, body)
                elif action == 'remove':
                    match = next((e for e in thread['evidence'] if e['id'] == evidence_id), None)
                    if match is None:
                        raise FileNotFoundError('原句依据不存在。')
                    thread['evidence'].remove(match)
                elif action == 'delete':
                    if any(t.get('parent_id') == thread_id or any(e.get('followup_id') == thread_id for e in t['evidence']) for t in threads):
                        raise ValueError('请先调整引用这条悬念的子项和后续悬念。')
                    threads.remove(thread)
            self.store.write_json(project_id, path, data)
            return self.snapshot(project_id, story_id, branch_id=branch)

    def _save_thread(self, project_id, story, branch, threads, chapters, patch):
        if not isinstance(patch, dict):
            raise ValueError('悬念规划格式不正确。')
        if patch.get('id'):
            thread = find_thread(threads, entity_id(patch['id'], '悬念'))
        else:
            thread = {'id': 'thread_' + uuid.uuid4().hex[:14], 'evidence': []}
            threads.append(thread)
        fields = {'level', 'question', 'answer', 'parent_id', 'reader_prompt', 'hook_type', 'climax', 'setup_chapter_id',
                  'due_from', 'due_to', 'interval', 'information_id', 'foreshadowing_id', 'event_ref'}
        for key in ('parent_id', 'information_id', 'foreshadowing_id', 'setup_chapter_id', 'due_from', 'due_to'):
            if key in patch and patch[key] not in ('', None):
                entity_id(patch[key])
        thread.update({k: v for k, v in patch.items() if k in fields})
        for k in ('question', 'answer', 'reader_prompt'):
            thread[k] = wording(thread.get(k), 1200 if k == 'question' else 4000, '悬念内容')
        if not thread['question'] or thread.get('level') not in LEVELS:
            raise ValueError('请填写期待的问题并选择层级。')
        if thread.get('hook_type') not in (None, '', *HOOKS):
            raise ValueError('请选择有效的钩子类型。')
        if thread.get('climax') is not None and not isinstance(thread['climax'], bool):
            raise ValueError('持续高潮须为勾选项。')
        if thread.get('interval') is not None and (type(thread['interval']) is not int or not 1 <= thread['interval'] <= 1000):
            raise ValueError('回应间隔请填写 1 至 1000 的整数。')
        for t in threads:
            if t.get('parent_id'):
                parent = find_thread(threads, entity_id(t['parent_id']))
                if LEVELS.index(parent['level']) >= LEVELS.index(t['level']):
                    raise ValueError('父项须为更高一级的悬念。')
        known_chapters = {c['id'] for c in chapters}
        ranks = {c['id']: i for i, c in enumerate(chapters) if c['ordered']}
        positions = []
        for key in ['setup_chapter_id', 'due_from', 'due_to']:
            chapter = thread.get(key)
            if chapter:
                if chapter not in known_chapters:
                    raise ValueError('请选择本故事和分支的章节。')
                if chapter in ranks:
                    positions.append(ranks[chapter])
        if positions != sorted(positions):
            raise ValueError('请按提出、最早回应和最晚回应的阅读顺序安排。')
        if thread.get('information_id'):
            info = self.info.get(project_id, thread['information_id'])
            scope = info.get('scope') or {}
            if scope.get('story_card_id') not in (None, '', story['id']) or scope.get('branch_id') not in (None, '', branch):
                raise ValueError('所选信息不在本故事和分支的范围内。')
        if thread.get('foreshadowing_id') and not any(isinstance(r, dict) and r.get('id') == thread['foreshadowing_id']
            for r in story.get('payload', {}).get('foreshadowings') or []):
            raise ValueError('所选伏笔不属于这个故事。')
        if thread.get('event_ref'):
            self.info.world.resolve(project_id, story_card_id=story['id'], event_ref=thread['event_ref'])

    def _add_evidence(self, project_id, thread, threads, chapters, body):
        chapter = entity_id(body.get('chapter_id'), '章节')
        if not any(c['id'] == chapter for c in chapters):
            raise ValueError('请选择本故事、当前分支已保存的章节。')
        kind = body.get('kind')
        if kind not in EVIDENCE:
            raise ValueError('请选择原句的作用。')
        quote = wording(body.get('quote'), 4000, '引用原句')
        path = f'drafts/{chapter}.md'
        if not self.store._safe_path(project_id, path).is_file():
            raise FileNotFoundError('请先保存章节正文。')
        if not isinstance(body.get('source_revision'), str) or not body['source_revision']:
            raise ValueError('请从最新保存的正文选择原句。')
        text = self.store.read_md(project_id, path)
        check_revision(self.store, project_id, path, body['source_revision'])
        start = text.find(quote)
        if not quote or start == -1 or text.find(quote, start + 1) >= 0:
            raise ValueError('请从已保存正文中选取能唯一定位的原句。')
        mark = {'chapter_id': chapter, 'kind': kind, 'quote': quote, 'start': start, 'end': start + len(quote),
                'source_revision': revision(self.store, project_id, path),
                'explanation': wording(body.get('explanation'), 4000, '作者说明')}
        if kind == 'payoff':
            mark['payoff_type'] = body.get('payoff_type') or 'direct'
            if mark['payoff_type'] not in ('direct', 'reverse', 'derivative'):
                raise ValueError('请选择回应方式。')
            if body.get('followup_id'):
                if mark['payoff_type'] != 'derivative':
                    raise ValueError('只有衍生式兑现可以连接新的悬念。')
                followup = find_thread(threads, entity_id(body['followup_id']))
                if followup == thread:
                    raise ValueError('后续悬念须选择另一条安排。')
                mark['followup_id'] = followup['id']
        match = next((e for e in thread['evidence'] if all(e.get(k) == mark[k] for k in ('chapter_id', 'start', 'quote'))), None)
        if body.get('evidence_id'):
            previous = next((e for e in thread['evidence'] if e['id'] == entity_id(body['evidence_id'])), None)
            if not previous or previous['chapter_id'] != chapter:
                raise ValueError('只能更正本章、本悬念上的原句记录。')
            if match and match['id'] != previous['id']:
                raise FileExistsError('这个原句已有关联记录，请编辑现有标记。')
            match = previous
        if match:
            # Re-confirming the same passage refreshes its anchor without duplicating progress.
            mark['id'] = match['id']
            thread['evidence'][thread['evidence'].index(match)] = mark
        else:
            thread['evidence'].append({**mark, 'id': 'excerpt_' + uuid.uuid4().hex[:14]})

    def chapter_context(self, project_id, story_id, chapter_id, branch_id=None, reader_offset=0):
        result = {'items': [], 'sources': [], 'information_ids': []}
        if not story_id or not chapter_id:
            return result
        with self.info._lock(project_id):
            story_path = f'cards/{entity_id(story_id, "故事")}.yaml'
            meta_path = f'drafts/{entity_id(chapter_id, "章节")}.meta.json'
            story = self.store.read_yaml(project_id, story_path)
            story_scope = story.get('payload', {}).get('world_context') or {}
            meta_scope = self.store.read_json(project_id, meta_path).get('world_context') or {}
            branch = entity_id(branch_id or meta_scope.get('branch_id') or story_scope.get('branch_id') or 'main', '分支')
            path = f'sessions/suspense/{story_id}/{branch}.json'
            result['sources'] = [path, 'drafts/.chapter_order']
            data = self.store.read_json(project_id, path)
            if not data.get('threads'):
                return result
            story, branch, path = self._location(project_id, story_id, chapter_id, branch)
            chapters = self._chapters(project_id, story, branch)
            ranks = {c['id']: i for i, c in enumerate(chapters) if c['ordered']}
            if chapter_id not in {c['id'] for c in chapters}:
                return result
            result['information_ids'] = sorted({t['information_id'] for t in data['threads'] if t.get('information_id')})
            current = ranks.get(chapter_id, -1)
            result['sources'].extend([f'cards/{story_id}.yaml', f'drafts/{chapter_id}.meta.json'])
            source_set = set(result['sources'])
            versions = {}
            threads = data['threads']
            self._link_children(threads)
            cues, latest = {}, {}
            for t in threads:
                low, high = t.get('due_from') or t.get('due_to'), t.get('due_to') or t.get('due_from')
                if low and high and (chapter_id in (low, high) or low in ranks and high in ranks and ranks[low] < current < ranks[high]):
                    cues[t['id']] = 'response'
                elif t.get('setup_chapter_id') == chapter_id:
                    cues[t['id']] = 'setup'
                for e in [*t['evidence'], *t['linked_progress']]:
                    ch = e['chapter_id']
                    if ch in ranks and (ranks[ch] < current or ch == chapter_id and e['end'] <= (reader_offset or 0)):
                        latest[t['id']] = max(latest.get(t['id'], -1), ranks[ch])

            # Nearby reader disclosures can make a thread relevant even before its first manual annotation.
            if result['information_ids']:
                source_set.update([STAGES_PATH, REGISTRY_PATH])
                chapter_ranks = {}
                for row in self.store.read_jsonl(project_id, STAGES_PATH):
                    if row.get('entity_type') == 'information' and row.get('record_type') == 'reader_disclosure':
                        d = row.get('data', {})
                        pos = ranks.get(d.get('chapter_id'), -1)
                        if 0 <= pos < current or pos == current and pos >= 0 and d.get('end', 0) <= (reader_offset or 0):
                            chapter_ranks[row['entity_id']] = max(chapter_ranks.get(row['entity_id'], -1), pos)
                for t in threads:
                    if t.get('information_id') in chapter_ranks:
                        latest[t['id']] = max(latest.get(t['id'], -1), chapter_ranks[t['information_id']])

            parents = {t['id']: t.get('parent_id') for t in threads}
            def with_parents(ids):
                linked = set(ids)
                for key in ids:
                    while parents.get(key):
                        key = parents[key]
                        linked.add(key)
                return linked

            related = with_parents(cues)
            nearby = {key for key, pos in latest.items() if pos >= current - 3}
            candidates = related | with_parents(nearby)
            scope = None
            rows_by_thread, recent_open = {}, {}
            for t in threads:
                if t['id'] not in candidates:
                    continue
                excerpts = []
                already_paid = False
                for e in [*t['evidence'], *t['linked_progress']]:
                    ch = e['chapter_id']
                    if ch == chapter_id:
                        if e['end'] > (reader_offset or 0):
                            continue
                    elif ch not in ranks or ranks[ch] >= current:
                        continue
                    source = f'drafts/{entity_id(ch)}.md'
                    source_set.update([source, f'drafts/{ch}.meta.json'])
                    if ch not in versions:
                        versions[ch] = revision(self.store, project_id, source)
                    if versions[ch] == e['source_revision']:
                        already_paid = already_paid or e['kind'] == 'payoff'
                        excerpts.append((ranks.get(ch, -1), e['start'], {'chapter_id': ch, 'quote': e['quote']}))
                if already_paid:
                    continue
                if t.get('information_id'):
                    if scope is None:
                        scope = self.info.world.resolve(project_id, story_card_id=story_id, chapter_id=chapter_id, branch_id=branch)['scope']
                    rows = self.info._visible_rows(project_id, t['information_id'], scope, chapter_id, reader_offset or 0)
                    for row in rows:
                        if row['record_type'] != 'reader_disclosure':
                            continue
                        d = row['data']
                        ch = d['chapter_id']
                        if ch not in ranks or (ch != chapter_id and ranks[ch] >= current):
                            continue
                        source_set.update([f'drafts/{ch}.md', f'drafts/{ch}.meta.json'])
                        excerpts.append((ranks[ch], d['start'], {'chapter_id': ch, 'quote': d['quote']}))
                context = {'thread_id': t['id'], 'evidence': []}
                ordered_excerpts = sorted(excerpts, key=lambda row: row[:2])
                if ordered_excerpts and ordered_excerpts[-1][0] >= current - 3 and t['id'] not in related:
                    recent_open[t['id']] = ordered_excerpts[-1][0]
                for _, _, excerpt in ordered_excerpts[-2:]:
                    if excerpt not in context['evidence']:
                        context['evidence'].append(excerpt)
                if t['id'] in cues:
                    context['cue'] = cues[t['id']]
                    if t.get('setup_chapter_id') == chapter_id:
                        context['hook_type'] = t.get('hook_type') or 'other'
                        if t.get('reader_prompt'):
                            context['reader_prompt'] = t['reader_prompt']
                if context['evidence'] or context.get('cue'):
                    rows_by_thread[t['id']] = context
            # Explicit cues and their parents survive. Keep incidental nearby threads bounded for long serials.
            selected = related | with_parents(sorted(recent_open, key=recent_open.get, reverse=True)[:4])
            result['items'] = [row for key, row in rows_by_thread.items() if key in selected]
            result['sources'] = sorted(source_set)
            return result
