from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid

from services.author_data_service import AuthorDataService, REGISTRY_ID, STAGES_PATH
from services.edit_version_service import check_revision, revision
from services.world_scope_service import WorldScopeService, entity_id
from storage.fs_store import now_iso


REGISTRY_PATH = f'cards/{REGISTRY_ID}.yaml'
RECORD_TYPES = {'occurrence', 'expression', 'awareness', 'reader_disclosure', 'review_decision'}
PROVENANCE = {'material_fact', 'character_statement', 'inference', 'ai_addition', 'author_edit'}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class InformationService:
    """One information identity; expressions, beliefs and reading positions are references."""

    def __init__(self, store):
        self.store = store
        self.world = WorldScopeService(store)
        self.author_data = AuthorDataService(store)

    def _lock(self, project_id):
        return self.author_data._lock(project_id)

    def list(self, project_id):
        card = self.store.read_yaml(project_id, REGISTRY_PATH)
        return [{**copy.deepcopy(row), '_revision': revision(self.store, project_id, REGISTRY_PATH),
                 'source': f'{REGISTRY_PATH}#payload.information_registry.{index}'}
                for index, row in enumerate(card.get('payload', {}).get('information_registry', []) or []) if isinstance(row, dict)]

    def get(self, project_id, information_id):
        entity_id(information_id, '信息')
        item = next((row for row in self.list(project_id) if row.get('id') == information_id), None)
        if not item:
            raise FileNotFoundError('这条信息尚未保存或已经不存在。')
        return item

    def fact(self, project_id, fact_id):
        row = next((copy.deepcopy(value) for value in self.store.read_jsonl(project_id, 'canon/facts.jsonl') if value.get('id') == fact_id), None)
        if row is None:
            raise ValueError('关联的作品事实不存在，请重新选择。')
        def merge(target, patch):
            for key, value in patch.items():
                if isinstance(value, dict) and isinstance(target.get(key), dict):
                    merge(target[key], value)
                else:
                    target[key] = copy.deepcopy(value)
        for change in self.store.read_jsonl(project_id, 'canon/revisions.jsonl'):
            if change.get('target_fact_id') == fact_id:
                merge(row, change.get('patch') or {})
        return row

    def prepare_item(self, project_id, body, previous=None, *, extra_entities=None):
        previous = previous or {}
        item_id = previous.get('id') or body.get('id') or f'information_{uuid.uuid4().hex[:14]}'
        entity_id(item_id, '信息')
        label = body.get('label', previous.get('label', ''))
        if not isinstance(label, str) or not label.strip() or len(label) > 500:
            raise ValueError('请填写500字以内的信息名称。')
        status = body.get('truth_status', previous.get('truth_status', 'undecided'))
        if status not in {'undecided', 'confirmed', 'unverified'}:
            raise ValueError('真相请选择尚未决定、作者确定或待核对。')
        fact_ref = body.get('fact_ref', previous.get('fact_ref')) or None
        value = body.get('truth_value', previous.get('truth_value'))
        if value is not None and (not isinstance(value, str) or len(value) > 10000):
            raise ValueError('真相须为10000字以内文字；未定时保留空白。')
        if fact_ref:
            entity_id(fact_ref, '事实')
            if (extra_entities or {}).get(fact_ref) != 'fact':
                self.fact(project_id, fact_ref)
            if value not in (None, ''):
                raise ValueError('已关联作品事实时，真相从原事实读取，请勿重复填写。')
            value = None
        if status == 'confirmed' and not fact_ref and not str(value or '').strip():
            raise ValueError('尚未决定的真相请留空，不要标为已确定。')
        scope = copy.deepcopy(body.get('scope', previous.get('scope', {})) or {})
        self.world.validate_context(project_id, scope, extra_entities=extra_entities)
        sources = body.get('sources', previous.get('sources', []))
        if not isinstance(sources, list) or any(not isinstance(source, dict) for source in sources):
            raise ValueError('信息来源须为出处列表。')
        provenance = body.get('provenance', previous.get('provenance', 'author_edit'))
        if provenance not in PROVENANCE:
            raise ValueError('请选择原材料、人物说法、推断、AI补全或作者修改。')
        return {'id': item_id, 'label': label.strip(), 'truth_status': status, 'truth_value': value,
                'fact_ref': fact_ref, 'scope': scope, 'sources': copy.deepcopy(sources), 'provenance': provenance,
                **({'import_source_keys': copy.deepcopy(previous['import_source_keys'])} if previous.get('import_source_keys') else {})}

    def save(self, project_id, body, information_id=None):
        with self._lock(project_id):
            check_revision(self.store, project_id, REGISTRY_PATH, body.get('_revision'))
            previous = self.get(project_id, information_id) if information_id else None
            value = self.prepare_item(project_id, body, previous)
            if not previous and any(row.get('id') == value['id'] for row in self.list(project_id)):
                raise FileExistsError('这个信息编号已存在，请修改同一条信息。')
            card = self.store.read_yaml(project_id, REGISTRY_PATH) or {'id': REGISTRY_ID, 'type': 'outline', 'title': '共享人物关系与信息', 'tags': [], 'links': [], 'payload': {}}
            before = copy.deepcopy(card)
            rows = card.setdefault('payload', {}).setdefault('information_registry', [])
            index = next((index for index, row in enumerate(rows) if row.get('id') == value['id']), None)
            if index is None:
                rows.append(value)
            else:
                rows[index] = value
            self.author_data._save_card(project_id, card, before)
            return self.get(project_id, value['id'])

    def records(self, project_id, information_id):
        self.get(project_id, information_id)
        return [{**copy.deepcopy(row), '_revision': revision(self.store, project_id, STAGES_PATH),
                 **({'evidence_status': 'valid' if self.disclosure_valid(project_id, row) else 'stale'} if row.get('record_type') == 'reader_disclosure' and row.get('status') == 'confirmed' else {})}
                for row in self.store.read_jsonl(project_id, STAGES_PATH) if row.get('entity_type') == 'information' and row.get('entity_id') == information_id]

    def _character(self, project_id, value, extra_entities=None):
        entity_id(value, '人物')
        if self.store.read_yaml(project_id, f'cards/{value}.yaml').get('type') != 'character' and (extra_entities or {}).get(value) != 'character':
            raise ValueError('关联人物不存在，请选择已有角色。')

    def prepare_record(self, project_id, information_id, body, *, extra_entities=None):
        if (extra_entities or {}).get(information_id) != 'information':
            self.get(project_id, information_id)
        kind, status = body.get('record_type'), body.get('status', 'planned')
        if status == 'retracted' and body.get('supersedes'):
            requested_id = body.get('id')
            original = next((row for row in self.records(project_id, information_id) if row['id'] == body['supersedes']), None)
            if original:
                body = {**original, **body, 'data': body.get('data') or original.get('data', {}), 'scope': body.get('scope') or original.get('scope', {})}
                body.pop('id', None)
                if requested_id:
                    body['id'] = requested_id
                kind = body.get('record_type')
        if kind not in RECORD_TYPES or kind == 'review_decision':
            raise ValueError('请选择发生情况、表达、人物认知或读者展示。')
        if status not in {'planned', 'confirmed', 'retracted'}:
            raise ValueError('请选择计划或已确认；撤销须保留原记录。')
        scope, data = copy.deepcopy(body.get('scope') or {}), copy.deepcopy(body.get('data') or {})
        self.world.validate_context(project_id, scope, extra_entities=extra_entities)
        event_ref = scope.get('time', {}).get('event_ref') or scope.get('event_ref')
        if kind != 'reader_disclosure' and (scope.get('story_card_id') or scope.get('chapter_id') or event_ref):
            scope = self.world.resolve(project_id, story_card_id=scope.get('story_card_id'),
                chapter_id=scope.get('chapter_id'), event_ref=event_ref, world_context=scope)['scope']
        if not isinstance(data, dict) or len(json.dumps(data, ensure_ascii=False)) > 18000:
            raise ValueError('信息变化内容格式不正确或过长。')
        source = body.get('source')
        if not isinstance(source, (dict, str)) or not source:
            raise ValueError('请保留信息变化的作者说明或正文依据。')
        if kind != 'reader_disclosure' and status == 'confirmed' and not self.world.has_time(scope):
            raise ValueError('已确认的发生、表达和认知须注明故事发生时间或事件。')
        value = data.get('value')
        if not isinstance(value, str) or not value.strip() or len(value) > 6000:
            raise ValueError('请填写6000字以内的信息内容，不自动猜测空白。')
        if kind == 'expression':
            self._character(project_id, data.get('speaker_id'), extra_entities)
            for key in ['audience_ids', 'heard_by']:
                people = data.get(key, [])
                if not isinstance(people, list) or any(not isinstance(person, str) for person in people) or len(set(people)) != len(people):
                    raise ValueError('表达对象与听到的人须为不重复的人物列表。')
                for person in people:
                    self._character(project_id, person, extra_entities)
            if data.get('intent', 'statement') not in {'statement', 'lie', 'conceal', 'uncertain'}:
                raise ValueError('表达意图请选择陈述、说谎、隐瞒或未定。')
        elif kind == 'awareness':
            self._character(project_id, data.get('character_id'), extra_entities)
            if data.get('state') not in {'knows', 'believes', 'suspects', 'misunderstands', 'conceals'}:
                raise ValueError('请选择知道、相信、怀疑、误解或隐瞒，不把听到自动当作知道。')
            if not isinstance(data.get('basis', ''), str):
                raise ValueError('认知依据须为文字。')
            if data.get('expression_ref'):
                expression = next((row for row in self.records(project_id, information_id) if row.get('id') == data['expression_ref'] and row.get('record_type') == 'expression'), None)
                if not expression:
                    raise ValueError('所引用的表达不属于这条信息，请重新选择。')
        elif kind == 'reader_disclosure':
            chapter = entity_id(data.get('chapter_id'), '章节')
            if data.get('mode') not in {'shown', 'hint', 'claim'}:
                raise ValueError('请选择明确展示、暗示或人物说法。')
            if status == 'confirmed':
                text = self.store.read_md(project_id, f'drafts/{chapter}.md')
                start, end = data.get('start'), data.get('end')
                if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or not 0 <= start < end <= len(text):
                    raise ValueError('已展示信息须选择已保存正文中的有效片段。')
                check_revision(self.store, project_id, f'drafts/{chapter}.md', data.get('source_revision', ''))
                data['quote'] = text[start:end]
        record_id = body.get('id') or f'stage_{uuid.uuid4().hex[:14]}'
        entity_id(record_id, '信息变化')
        previous = self.records(project_id, information_id) if (extra_entities or {}).get(information_id) != 'information' else []
        if body.get('supersedes') and not any(row['id'] == body['supersedes'] for row in previous):
            raise ValueError('被更正记录不属于这条信息。')
        if status == 'retracted' and not body.get('supersedes'):
            raise ValueError('撤销须选择原信息记录，不删除历史。')
        return {'id': record_id, 'entity_type': 'information', 'entity_id': information_id, 'record_type': kind, 'status': status,
                'scope': scope, 'data': data, 'changes': {}, 'knowledge': [], 'source': copy.deepcopy(source), 'created_at': now_iso(),
                **({'supersedes': body['supersedes']} if body.get('supersedes') else {})}

    def add_record(self, project_id, information_id, body):
        from services.author_control_service import AuthorControlService
        with self._lock(project_id):
            check_revision(self.store, project_id, STAGES_PATH, body.get('_revision'))
            row = self.prepare_record(project_id, information_id, body)
            AuthorControlService(self.store).assert_stage(project_id, 'information', information_id, row['data'], row['status'])
            existing = next((old for old in self.records(project_id, information_id) if old['id'] == row['id']), None)
            if existing:
                if all(existing.get(key) == value for key, value in row.items() if key != 'created_at'):
                    return existing
                raise FileExistsError('该记录编号已经使用，请追加更正，不能覆盖历史。')
            self.store.append_jsonl(project_id, STAGES_PATH, row)
            return {**row, '_revision': revision(self.store, project_id, STAGES_PATH)}

    def disclosure_valid(self, project_id, row):
        data = row.get('data') or {}
        chapter = data.get('chapter_id')
        if not isinstance(chapter, str):
            return False
        path = f'drafts/{entity_id(chapter)}.md'
        text = self.store.read_md(project_id, path)
        start, end = data.get('start', -1), data.get('end', -1)
        return (data.get('source_revision') == revision(self.store, project_id, path) and isinstance(start, int) and isinstance(end, int)
                and 0 <= start < end <= len(text) and text[start:end] == data.get('quote'))

    def _active(self, project_id, information_id):
        history = self.store.read_jsonl(project_id, STAGES_PATH)
        voids = {value for row in history if row.get('kind') == 'void' for value in row.get('voids', [])}
        rows = [row for row in history if row.get('entity_type') == 'information' and row.get('entity_id') == information_id and row.get('id') not in voids]
        return rows

    def disclosure_applies(self, project_id, record_scope, target_scope):
        source = dict(record_scope or {})
        source.setdefault('branch_id', 'main')
        if source['branch_id'] == target_scope.get('branch_id', 'main'):
            source.pop('time', None)
            return self.world.applies(project_id, source, target_scope)[0]
        # Only shared pre-fork disclosures cross branches. On the selected branch their
        # reading position, not the narrative clock (which may run backwards), decides visibility.
        return self.world.applies(project_id, source, {**target_scope, 'time': source.get('time', {})})[0]

    def _visible_rows(self, project_id, information_id, scope, reader_chapter_id=None, reader_offset=None, *, verify_disclosures=True):
        rows = self._active(project_id, information_id)
        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
        reading = reader_chapter_id or scope.get('chapter_id')
        reader_index = order.index(reading) if reading in order else None
        applicable = []
        for row in rows:
            kind = row.get('record_type')
            if row.get('status') != 'confirmed' or kind == 'review_decision':
                continue
            if kind == 'reader_disclosure':
                if not self.disclosure_applies(project_id, row.get('scope'), scope):
                    continue
                data = row['data']
                chapter = data.get('chapter_id')
                if (verify_disclosures and not self.disclosure_valid(project_id, row)) or reader_index is None or chapter not in order or order.index(chapter) > reader_index:
                    continue
                if chapter == reading and reader_offset is not None and data.get('end', 0) > reader_offset:
                    continue
            elif not self.world.applies(project_id, row.get('scope'), scope, dynamic=True)[0]:
                continue
            applicable.append(row)
        superseded = {row.get('supersedes') for row in rows if row.get('status') in {'confirmed', 'retracted'} and
                      (row in applicable or row.get('record_type') == 'reader_disclosure' and row.get('status') == 'retracted' and
                       self.disclosure_applies(project_id, row.get('scope'), scope) or
                       self.world.applies(project_id, row.get('scope'), scope, dynamic=True)[0])}
        return [row for row in applicable if row['id'] not in superseded]

    def state(self, project_id, *, reader_chapter_id=None, reader_offset=None, information_ids=None, **scope_args):
        resolved = self.world.resolve(project_id, **scope_args)
        scope, items, sources = resolved['scope'], [], set()
        selected = set(information_ids) if information_ids is not None else None
        for item in self.list(project_id):
            if selected is not None and item['id'] not in selected or not self.world.applies(project_id, item.get('scope'), scope)[0]:
                continue
            value = {**item, 'occurrences': [], 'expressions': [], 'awareness': [], 'reader_disclosures': [], 'planned': []}
            if item.get('truth_status') != 'confirmed':
                value['truth_value'] = None
            elif item.get('fact_ref'):
                fact = self.fact(project_id, item['fact_ref'])
                value['truth_value'] = fact.get('value')
                value['truth_source'] = {'path': 'canon/facts.jsonl', 'fact_id': item['fact_ref']}
                sources.update(['canon/facts.jsonl', 'canon/revisions.jsonl'])
            for row in self._visible_rows(project_id, item['id'], scope, reader_chapter_id, reader_offset):
                bucket = {'occurrence': 'occurrences', 'expression': 'expressions', 'awareness': 'awareness', 'reader_disclosure': 'reader_disclosures'}[row['record_type']]
                value[bucket].append(copy.deepcopy(row))
                if row['record_type'] == 'reader_disclosure':
                    sources.add(f"drafts/{row['data']['chapter_id']}.md")
            for row in value['awareness']:
                peers = [other for other in value['awareness'] if other['data'].get('character_id') == row['data'].get('character_id')]
                maximal = [other for other in peers if not any(self.world.compare_time(project_id, other.get('scope', {}).get('time'), later.get('scope', {}).get('time')) == -1 for later in peers)]
                row['current'] = row['id'] == maximal[0]['id'] if len(maximal) == 1 else 'uncertain'
            for row in self._active(project_id, item['id']):
                if row.get('status') == 'planned' and self.world.applies(project_id, {key: value for key, value in row.get('scope', {}).items() if key != 'time'}, scope)[0]:
                    value['planned'].append(copy.deepcopy(row))
            value['review_decisions'] = self.decisions(project_id, item['id'], chapter_id=scope.get('chapter_id'))
            items.append(value)
            sources.add(REGISTRY_PATH)
            sources.add(STAGES_PATH)
            sources.add('drafts/.chapter_order')
        return {**resolved, 'items': items, 'sources': sorted(sources)}

    def selected_ids(self, project_id, *, chapter_id=None, event_ref=None, card_ids=()):
        result = set()
        if chapter_id:
            result.update(self.store.read_json(project_id, f'drafts/{entity_id(chapter_id)}.meta.json').get('information_ids', []) or [])
        if event_ref:
            owner, row, _, _ = self.world.event(project_id, event_ref)
            result.update(row.get('information_ids', []) or [])
            result.update(owner.get('payload', {}).get('information_ids', []) or [])
        for card_id in card_ids:
            card = self.store.read_yaml(project_id, f'cards/{entity_id(card_id)}.yaml')
            result.update(card.get('payload', {}).get('information_ids', []) or [])
        return result

    def materials(self, project_id, scope, *, for_review=False, reader_chapter_id=None, reader_offset=None, information_ids=None, actor_ids=(), max_chars=5000, suspense_ids=()):
        if information_ids is None:
            cards = [*actor_ids, *([scope['story_card_id']] if scope.get('story_card_id') else [])]
            information_ids = self.selected_ids(project_id, chapter_id=scope.get('chapter_id'), event_ref=scope.get('event_ref'), card_ids=cards)
            actors = set(actor_ids) | ({scope['pov_character_id']} if scope.get('pov_character_id') else set())
            for row in self.store.read_jsonl(project_id, STAGES_PATH):
                if row.get('entity_type') != 'information' or row.get('status') != 'confirmed' or not self.world.applies(project_id, row.get('scope'), scope, dynamic=True)[0]:
                    continue
                data = row.get('data') or {}
                if data.get('character_id') in actors or data.get('speaker_id') in actors or actors & set(data.get('heard_by', [])):
                    information_ids.add(row['entity_id'])
        snapshot = self.state(project_id, world_context=scope, reader_chapter_id=reader_chapter_id, reader_offset=reader_offset, information_ids=information_ids)
        result = {'items': [], 'sources': snapshot['sources'], 'max_chars': max_chars, 'omitted_count': 0,
                  'policy': '作者真相、发生、表达、人物认知和读者展示分开；听见不等于相信，误信不能替换成作者真相。只记录作品提供的信息，不推断读者理解。'}
        pov = scope.get('pov_character_id')
        for item in snapshot['items']:
            awareness = [row for row in item['awareness'] if (not pov or row['data'].get('character_id') == pov) and row.get('current') is not False]
            if item['id'] in suspense_ids and not for_review:
                # The suspense packet carries the reader's exact excerpts. The writer can
                # respect a character's knowledge boundary without seeing the hidden answer.
                entry = {'id': item['id'], 'awareness': [{key: row['data'][key] for key in ('character_id', 'state') if key in row['data']}
                                                        for row in awareness]}
            elif pov and not for_review:
                def limited(row):
                    data = copy.deepcopy(row['data'])
                    if row['record_type'] == 'expression' and data.get('speaker_id') != pov:
                        data.pop('intent', None)
                    return {'id': row['id'], 'record_type': row['record_type'], 'scope': row['scope'], 'data': data, **({'current': row['current']} if 'current' in row else {}),
                            'source': {'path': STAGES_PATH, 'record_id': row['id']}}
                entry = {'id': item['id'], 'awareness': [limited(row) for row in awareness], 'expressions': [limited(row) for row in item['expressions'] if pov == row['data'].get('speaker_id') or pov in row['data'].get('heard_by', [])]}
                # Values come from the person's actual belief; never substitute the truth registry.
                entry['reader_boundary'] = [{key: row['data'][key] for key in ('chapter_id', 'mode') if key in row['data']} for row in item['reader_disclosures']]
            else:
                entry = {key: item[key] for key in ['id', 'label', 'truth_status', 'truth_value', 'occurrences', 'expressions', 'awareness', 'reader_disclosures', 'planned', 'review_decisions']}
                if not for_review:
                    entry.pop('planned', None)
            result['items'].append(entry)
            if len(json.dumps(result, ensure_ascii=False)) > max_chars - 50:
                result['items'].pop()
                result['omitted_count'] += 1
        result['used_chars'] = 0
        for _ in range(3):
            result['used_chars'] = len(json.dumps(result, ensure_ascii=False))
        if result['used_chars'] > max_chars:
            raise ValueError('信息边界与来源超出本次预算，请缩小范围。')
        return result

    def fact_allowed(self, project_id, fact_id, scope):
        pov = scope.get('pov_character_id')
        for item in self.list(project_id):
            if item.get('fact_ref') != fact_id:
                continue
            if item.get('truth_status') != 'confirmed':
                return False
            if not pov:
                return True
            truth = self.fact(project_id, fact_id).get('value')
            snapshot = self.state(project_id, world_context=scope, information_ids=[item['id']])
            current = [row for info in snapshot['items'] for row in info['awareness'] if row['data'].get('character_id') == pov and row.get('current') is not False]
            return bool(current) and all(row.get('current') is True and row['data'].get('state') in {'knows', 'conceals'} and row['data'].get('value') == truth for row in current)
        return True

    def quote_context(self, project_id, path, quote):
        text = self.store.read_md(project_id, path)
        matches = [match.start() for match in re.finditer('(?=' + re.escape(quote) + ')', text)]
        if len(matches) != 1:
            return {'matches': len(matches)}
        start, end = matches[0], matches[0] + len(quote)
        separators = list(re.finditer(r'\r?\n[ \t]*\r?\n+', text))
        before = [match for match in separators if match.end() <= start]
        after = next((match.start() for match in separators if match.start() >= end), len(text))
        return {'matches': 1, 'paragraph': text[before[-1].end() if before else 0:after], 'paragraph_index': len(before)}

    def _decision_signature(self, project_id, information_id, data):
        item = self.get(project_id, information_id)
        item = {key: value for key, value in item.items() if key not in {'_revision', 'source'}}
        bindings = {'information': item, 'fact': self.fact(project_id, item['fact_ref']) if item.get('fact_ref') else None, 'actors': {}, 'sources': {}}
        for actor in data.get('actor_ids', []):
            card = self.store.read_yaml(project_id, f'cards/{entity_id(actor)}.yaml')
            bindings['actors'][actor] = card.get('payload', {})
        for path in data.get('source_versions', {}):
            if path == REGISTRY_PATH:
                continue
            if path == STAGES_PATH:
                scope = self.world.resolve(project_id, chapter_id=data.get('chapter_id'), event_ref=data.get('event_ref'))['scope']
                rows = self._visible_rows(project_id, information_id, scope, verify_disclosures=not data.get('quote_source'))
                if data.get('quote_source'):
                    # Decision evidence follows its paragraph; disclosure validity keeps its stricter full-draft guard.
                    rows = copy.deepcopy(rows)
                    for row in rows:
                        if row.get('record_type') == 'reader_disclosure':
                            source = f"drafts/{row['data']['chapter_id']}.md"
                            quote = row['data'].get('quote')
                            context = self.quote_context(project_id, source, quote) if quote else {}
                            row['evidence_context'] = context if context.get('matches') == 1 else {'revision': revision(self.store, project_id, source)}
                bindings['sources'][path] = rows
            elif path == data.get('quote_source'):
                bindings['sources'][path] = self.quote_context(project_id, path, data['quote'])
            else:
                bindings['sources'][path] = revision(self.store, project_id, path)
        if data.get('quote_source') and data['quote_source'] not in bindings['sources']:
            bindings['sources'][data['quote_source']] = self.quote_context(project_id, data['quote_source'], data['quote'])
        elif data.get('chapter_id') and not any(path.startswith('drafts/') for path in data.get('source_versions', {})):
            bindings['chapter'] = revision(self.store, project_id, f"drafts/{data['chapter_id']}.md")
        return digest(bindings)

    def add_decision(self, project_id, information_id, body):
        with self._lock(project_id):
            self.get(project_id, information_id)
            action = body.get('action')
            if action not in {'intentional', 'correct', 'defer'}:
                raise ValueError('请选择修正、有意安排或暂不处理。')
            data = {key: copy.deepcopy(body[key]) for key in ['action', 'chapter_id', 'event_ref', 'actor_ids', 'reason', 'quote', 'source_versions'] if key in body}
            if data.get('chapter_id'):
                entity_id(data['chapter_id'], '章节')
            for actor in data.get('actor_ids', []):
                self._character(project_id, actor)
            if data.get('event_ref'):
                self.world.event(project_id, data['event_ref'])
            if not isinstance(data.get('reason'), str) or not data['reason'].strip():
                raise ValueError('请说明此处安排或处理决定。')
            versions = data.setdefault('source_versions', {})
            if not isinstance(versions, dict):
                raise ValueError('审查依据版本格式不正确。')
            for path, expected in versions.items():
                if not isinstance(path, str) or not isinstance(expected, str) or not path.startswith(('cards/', 'canon/', 'drafts/')):
                    raise ValueError('审查依据须为当前作品的资料。')
                check_revision(self.store, project_id, path, expected)
            quote = data.get('quote')
            if quote is not None and not isinstance(quote, str):
                raise ValueError('请引用需要确认的具体原句。')
            if quote:
                paths = [f"drafts/{data['chapter_id']}.md"] if data.get('chapter_id') else [path for path in versions if path.startswith('drafts/') and path.endswith('.md')]
                matches = [(path, self.quote_context(project_id, path, quote)['matches']) for path in paths]
                if paths and (sum(count for _, count in matches) != 1):
                    raise ValueError('引用原句不存在或出现多次，请选取更完整且唯一的原段落再确认安排。')
                if matches:
                    data['quote_source'] = next(path for path, count in matches if count == 1)
            data['signature'] = self._decision_signature(project_id, information_id, data)
            same_binding = [row for row in self.decisions(project_id, information_id, chapter_id=data.get('chapter_id')) if
                            row.get('chapter_id') == data.get('chapter_id') and row.get('event_ref') == data.get('event_ref') and
                            set(row.get('actor_ids', [])) == set(data.get('actor_ids', [])) and row.get('quote') == data.get('quote')]
            if same_binding and same_binding[-1].get('signature') == data['signature'] and same_binding[-1].get('action') == action and same_binding[-1].get('reason') == data['reason']:
                return same_binding[-1]
            row = {'id': f'decision_{uuid.uuid4().hex[:14]}', 'entity_type': 'information', 'entity_id': information_id, 'record_type': 'review_decision',
                   'status': 'confirmed', 'data': data, 'scope': {}, 'changes': {}, 'knowledge': [], 'source': {'kind': 'author'}, 'created_at': now_iso()}
            if same_binding:
                row['supersedes'] = same_binding[-1]['id']
            self.store.append_jsonl(project_id, STAGES_PATH, row)
            return {**data, 'id': row['id'], 'status': 'active', 'source': row['source']}

    def decisions(self, project_id, information_id, chapter_id=None):
        self.get(project_id, information_id)
        result = []
        history = self._active(project_id, information_id)
        superseded = {row.get('supersedes') for row in history if row.get('record_type') == 'review_decision'}
        for row in history:
            if row.get('record_type') != 'review_decision':
                continue
            if row['id'] in superseded:
                continue
            data = row.get('data') or {}
            if chapter_id and data.get('chapter_id') != chapter_id:
                continue
            current = self._decision_signature(project_id, information_id, data)
            result.append({**copy.deepcopy(data), 'id': row['id'], 'status': 'active' if current == data.get('signature') else 'stale', 'source': row.get('source')})
        return result
