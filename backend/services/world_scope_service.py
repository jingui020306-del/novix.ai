from __future__ import annotations

import copy
import re
from datetime import date
from services.edit_version_service import check_revision


def entity_id(value, label='资料'):
    if not isinstance(value, str) or not re.fullmatch(r'[\w-]{1,120}', value):
        raise ValueError(f'{label}编号不正确。')
    return value


class WorldScopeService:
    """Resolve story time, never infer it from chapter order or wall-clock dates."""

    def __init__(self, store):
        self.store = store

    @staticmethod
    def event_ref(value):
        if isinstance(value, str):
            parts = value.split(':')
            if len(parts) == 3 and parts[1] == 'important_scenes':
                value = {'owner_card_id': parts[0], 'scene_id': parts[2]}
        if not isinstance(value, dict):
            raise ValueError('事件锚点须选择已保存的事件。')
        return {key: entity_id(value.get(key), '事件') for key in ['owner_card_id', 'scene_id']}

    def event(self, project_id, reference, _seen=None, *, overrides=None):
        ref = self.event_ref(reference)
        seen = set(_seen or ())
        key = (ref['owner_card_id'], ref['scene_id'])
        if key in seen:
            raise ValueError('事件来源映射形成循环，请核对原事件。')
        seen.add(key)
        owner = (overrides or {}).get(ref['owner_card_id']) or self.store.read_yaml(project_id, f"cards/{ref['owner_card_id']}.yaml")
        if owner.get('type') not in {'story', 'outline'}:
            raise FileNotFoundError('事件来源不存在。')
        for index, row in enumerate(owner.get('payload', {}).get('important_scenes', []) or []):
            if isinstance(row, dict) and ref['scene_id'] in {str(row.get('id') or index), f'index_{index}' if not row.get('id') else ''}:
                mapped = row.get('canonical_event_ref')
                if mapped:
                    return self.event(project_id, mapped, seen, overrides=overrides)
                return owner, row, index, {'owner_card_id': owner['id'], 'scene_id': str(row.get('id') or f'index_{index}')}
        raise FileNotFoundError('这个事件已不存在，请重新选择。')

    def predecessors(self, project_id, reference, *, overrides=None):
        owner, row, _, canonical = self.event(project_id, reference, overrides=overrides)
        local = row.get('causal_scene_ids') or []
        shared = row.get('causal_event_refs') or []
        if not isinstance(local, list) or any(not isinstance(item, str) for item in local) or not isinstance(shared, list):
            raise ValueError('事件前因须选择有效的原事件。')
        refs = [*({'owner_card_id': owner['id'], 'scene_id': item} for item in local), *shared]
        result = []
        for ref in refs:
            target = self.event(project_id, ref, overrides=overrides)[-1]
            if target not in result:
                result.append(target)
        return result

    def event_precedes(self, project_id, left, right):
        target = self.event(project_id, left)[-1]
        queue, seen = [self.event(project_id, right)[-1]], set()
        while queue:
            ref = queue.pop()
            key = (ref['owner_card_id'], ref['scene_id'])
            if key in seen:
                continue
            seen.add(key)
            for previous in self.predecessors(project_id, ref):
                if previous == target:
                    return True
                queue.append(previous)
        return False

    def validate_event_links(self, project_id, card, *, overrides=None):
        overrides = {**(overrides or {}), card['id']: card}
        complete, active = set(), set()
        for index, row in enumerate(card.get('payload', {}).get('important_scenes', []) or []):
            if not isinstance(row, dict):
                continue
            reference = {'owner_card_id': card['id'], 'scene_id': str(row.get('id') or f'index_{index}')}
            queue = [(reference, False)]
            while queue:
                ref, leaving = queue.pop()
                ref = self.event(project_id, ref, overrides=overrides)[-1]
                key = (ref['owner_card_id'], ref['scene_id'])
                if leaving:
                    active.discard(key)
                    complete.add(key)
                    continue
                if key in active:
                    raise ValueError('跨事件前因形成循环，请核对原事件连接。')
                if key in complete:
                    continue
                active.add(key)
                queue.append((ref, True))
                for parent in self.predecessors(project_id, ref, overrides=overrides):
                    queue.append((parent, False))

    def validate_context(self, project_id, value, *, extra_entities=None):
        if not isinstance(value, dict):
            raise ValueError('世界与发生时间须为对象。')
        if set(value) - {'world_id', 'branch_id', 'story_card_id', 'time', 'base_setting_ids', 'local_adjustments', 'pov_character_id', 'chapter_id', 'event_ref', 'period_id', 'region_ids', 'overrides', 'until'}:
            raise ValueError('世界与时间范围含有未知字段。')
        for key in ['world_id', 'branch_id', 'story_card_id', 'pov_character_id', 'chapter_id', 'period_id']:
            if value.get(key):
                entity_id(value[key])
        if value.get('world_id'):
            world = self.store.read_yaml(project_id, f"cards/{value['world_id']}.yaml")
            if (world.get('type') or (extra_entities or {}).get(value['world_id'])) not in {'world', 'worldview', 'world_rule', 'lore'}:
                raise ValueError('所选世界不存在。')
            branches = self.branches(project_id, value['world_id']) if world else [{'id': 'main'}]
            if value.get('branch_id', 'main') not in {row['id'] for row in branches}:
                raise ValueError('所选世界的事件分支不存在。')
            options = self.options(project_id, value['world_id']) if world else {'periods': [], 'regions': []}
            if value.get('period_id') and value['period_id'] not in {row['id'] for row in options['periods']} and value['period_id'] not in (extra_entities or {}):
                raise ValueError('所选时期不属于这个世界，请从原资料重新选择。')
            regions = value.get('region_ids', [])
            if not isinstance(regions, list) or any(not isinstance(region, str) for region in regions) or len(set(regions)) != len(regions):
                raise ValueError('地区须选择不重复的已有地区。')
            valid_regions = {row['id'] for row in options['regions']} | set(extra_entities or {})
            if any(region not in valid_regions for region in regions):
                raise ValueError('所选地区不属于这个世界，请重新选择。')
        elif value.get('period_id') or value.get('region_ids'):
            raise ValueError('选择时期或地区前，请先明确所属世界。')
        if 'base_setting_ids' in value and (not isinstance(value['base_setting_ids'], list) or any(not isinstance(item, str) for item in value['base_setting_ids'])):
            raise ValueError('基础设定须选择资料编号列表。')
        if 'local_adjustments' in value and (not isinstance(value['local_adjustments'], str) or len(value['local_adjustments']) > 6000):
            raise ValueError('局部调整须为6000字以内的文字。')
        overrides = value.get('overrides', [])
        if not isinstance(overrides, list) or len(overrides) > 100:
            raise ValueError('局部改动须为至多100项的具体字段改动。')
        for override in overrides:
            if not isinstance(override, dict) or not isinstance(override.get('path'), list) or len(override['path']) < 2 or any(not isinstance(key, str) for key in override['path']):
                raise ValueError('局部改动须关联原设定和具体字段。')
            target = entity_id(override.get('target_id'))
            card = self.store.read_yaml(project_id, f'cards/{target}.yaml')
            if card.get('type') not in {'world', 'worldview', 'world_rule', 'lore'} or not value.get('world_id') or not self.belongs_to_world(project_id, card, value['world_id']):
                raise ValueError('局部改动只能引用当前世界的原设定，不能混用其他世界。')
            if override['path'][0] != 'payload' or any(key in {'id', 'world_context', 'branches'} for key in override['path']):
                raise ValueError('局部改动仅修改设定内容，不改变身份、所属世界或分支定义。')
        if value.get('event_ref'):
            self.event(project_id, value['event_ref'])
        if 'until' in value:
            end = value['until']
            if not isinstance(end, dict) or not any(end.get(k) is not None for k in ('year', 'date', 'elapsed_years', 'event_ref')):
                raise ValueError('失效时间须包含年份、日期或事件。')
            self.validate_context(project_id, {'time': end}, extra_entities=extra_entities)
            order = self.compare_time(project_id, value.get('time'), end)
            if order is not None and order >= 0:
                raise ValueError('失效时间须晚于生效时间。')
        time = value.get('time', {})
        if not isinstance(time, dict):
            raise ValueError('发生时间格式不正确。')
        if 'year' in time and (not isinstance(time['year'], int) or isinstance(time['year'], bool)):
            raise ValueError('年份须为整数，未确定时请留空。')
        if 'elapsed_years' in time and (not isinstance(time['elapsed_years'], (int, float)) or isinstance(time['elapsed_years'], bool)):
            raise ValueError('明确经过的年数须为数字。')
        if time.get('date'):
            try:
                date.fromisoformat(time['date'])
            except (ValueError, TypeError):
                raise ValueError('日期请使用YYYY-MM-DD格式。') from None
            if 'year' in time and time['year'] != date.fromisoformat(time['date']).year:
                raise ValueError('年份与具体日期不一致，请核对发生时间。')
        if time.get('position') and time['position'] not in {'before', 'immediate_after', 'phase'}:
            raise ValueError('请选择事件前、刚结束或明确阶段。')
        if time.get('position') == 'phase' and not str(time.get('phase') or '').strip():
            raise ValueError('请选择或写明事件后的具体阶段。')
        if time.get('event_ref'):
            self.event(project_id, time['event_ref'])

    def branches(self, project_id, world_id):
        entity_id(world_id, '世界')
        world = self.store.read_yaml(project_id, f'cards/{world_id}.yaml')
        if not world:
            raise FileNotFoundError('世界资料不存在。')
        rows = copy.deepcopy(world.get('payload', {}).get('branches', []) or [])
        if not any(row.get('id') == 'main' for row in rows if isinstance(row, dict)):
            rows.insert(0, {'id': 'main', 'label': '主世界', 'parent_branch_id': None, 'fork_event_ref': None})
        return rows

    def options(self, project_id, world_id):
        entity_id(world_id, '世界')
        root = self.store.read_yaml(project_id, f'cards/{world_id}.yaml')
        if root.get('type') not in {'world', 'worldview', 'world_rule', 'lore'}:
            raise FileNotFoundError('世界资料不存在。')
        periods, regions = [], []
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            payload = card.get('payload') or {}
            if card.get('id') == world_id or not self.belongs_to_world(project_id, card, world_id):
                continue
            kind = payload.get('entry_type')
            item = {'id': card['id'], 'label': card.get('title') or '未命名条目', 'source': f'cards/{path.name}',
                    'time': payload.get('time') or payload.get('world_context', {}).get('time') or {}}
            if kind in {'period', 'history'}:
                periods.append(item)
            elif kind in {'place', 'region', 'location'}:
                regions.append(item)
        voids = {sid for row in self.store.read_jsonl(project_id, 'canon/author_stages.jsonl') if row.get('kind') == 'void' for sid in row.get('voids', [])}
        for row in self.store.read_jsonl(project_id, 'canon/author_stages.jsonl'):
            if row.get('entity_type') == 'world' and row.get('entity_id') == world_id and row.get('status') != 'retracted' and row.get('id') not in voids:
                periods.append({'id': row['id'], 'label': row.get('label') or row.get('changes', {}).get('summary') or '世界阶段',
                                'time': row.get('scope', {}).get('time', {}), 'source': f"canon/author_stages.jsonl#{row['id']}", 'status': row.get('status')})
        return {'world_id': world_id, 'periods': periods, 'regions': regions, 'branches': self.branches(project_id, world_id)}

    def resolve(self, project_id, *, story_card_id=None, chapter_id=None, event_ref=None, branch_id=None, world_context=None, pov_character_id=None, pov=None):
        scope, inherited, sources, warnings = {}, {}, [], []
        meta = self.store.read_json(project_id, f'drafts/{entity_id(chapter_id)}.meta.json') if chapter_id else {}
        scene_owner = scene_row = None
        canonical = None
        if event_ref:
            scene_owner, scene_row, index, canonical = self.event(project_id, event_ref)
            event_story = scene_owner.get('id') if scene_owner.get('type') == 'story' else scene_owner.get('payload', {}).get('story_card_id')
            if story_card_id and event_story and story_card_id != event_story:
                raise ValueError('当前事件不属于所选故事。')
            story_card_id = story_card_id or event_story
            if not chapter_id and scene_row.get('chapter'):
                chapter_id = entity_id(scene_row['chapter'], '章节')
                meta = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json')
        story_card_id = story_card_id or meta.get('story_card_id') or meta.get('writing_alignment', {}).get('story_card_id')
        if not story_card_id and chapter_id:
            matches = []
            for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
                card = self.store.read_yaml(project_id, f'cards/{path.name}')
                if card.get('type') == 'story' and any(isinstance(row, dict) and chapter_id in {row.get('chapter_id'), row.get('chapter')} for row in card.get('payload', {}).get('chapter_plan', []) or []):
                    matches.append(card['id'])
            if len(matches) == 1:
                story_card_id = matches[0]
            elif len(matches) > 1:
                warnings.append('本章关联多个故事，须明确选择故事后才能推定世界范围。')
        story = self.store.read_yaml(project_id, f'cards/{entity_id(story_card_id)}.yaml') if story_card_id else {}

        def merge(value, origin):
            if not isinstance(value, dict):
                return
            for key, child in value.items():
                if child in (None, ''):
                    continue
                if key == 'time' and not isinstance(child, dict):
                    raise ValueError('发生时间须为对象；未确定可留空。')
                if key == 'time' and isinstance(child, dict):
                    # A new event anchor replaces the prior anchor's phase, not its old "after".
                    if child.get('event_ref') and child['event_ref'] != scope.get('time', {}).get('event_ref'):
                        scope['time'] = {}
                    scope.setdefault('time', {}).update(copy.deepcopy(child))
                    for time_key in child:
                        inherited[f'time.{time_key}'] = origin
                else:
                    scope[key] = copy.deepcopy(child)
                    inherited[key] = origin
            if origin not in sources:
                sources.append(origin)

        if story:
            merge(story.get('payload', {}).get('world_context'), f'cards/{story_card_id}.yaml#payload.world_context')
        merge(meta.get('world_context'), f'drafts/{chapter_id}.meta.json#world_context')
        if scene_owner is not None:
            merge(scene_row.get('world_context'), f"cards/{scene_owner['id']}.yaml#payload.important_scenes.{index}.world_context")
        merge(world_context, 'request.world_context')
        if scope.get('period_id') and scope.get('world_id') and not self.has_time(scope):
            period = next((row for row in self.options(project_id, scope['world_id'])['periods'] if row['id'] == scope['period_id']), None)
            if period and period.get('time'):
                merge({'time': {**period['time'], **scope.get('time', {})}}, period['source'])
        if canonical:
            scope['event_ref'] = canonical
            scope.setdefault('time', {}).setdefault('event_ref', canonical)
            scope['time'].setdefault('position', 'before')
        if story_card_id:
            scope['story_card_id'] = story_card_id
        if chapter_id:
            scope['chapter_id'] = chapter_id
        if branch_id:
            scope['branch_id'] = entity_id(branch_id, '分支')
            inherited['branch_id'] = 'request.branch_id'
        scope.setdefault('branch_id', 'main')
        scope.setdefault('time', {})
        narrative_pov = ''
        style_id = story.get('payload', {}).get('style_card_id') or 'style_001'
        style = self.store.read_yaml(project_id, f'cards/{entity_id(style_id)}.yaml')
        if not style:
            styles = [self.store.read_yaml(project_id, f'cards/{path.name}') for path in self.store._safe_path(project_id, 'cards').glob('*.yaml')]
            styles = [card for card in styles if card.get('type') == 'style']
            style = styles[0] if len(styles) == 1 else {}
            style_id = style.get('id') or style_id
        choices = [(style.get('payload', {}).get('style_guide', {}).get('pov'), f'cards/{style_id}.yaml#payload.style_guide.pov'),
                   (meta.get('pov'), f'drafts/{chapter_id}.meta.json#pov')]
        if scene_row is not None:
            choices.append((scene_row.get('pov'), f"cards/{scene_owner['id']}.yaml#payload.important_scenes.{index}.pov"))
        choices.append((pov, 'request.pov'))
        for value, origin in choices:
            if value:
                if not isinstance(value, str) or len(value) > 2000:
                    raise ValueError('叙述视角须为2000字以内的文字。')
                narrative_pov = value
                inherited['narrative_pov'] = origin
                if origin not in sources:
                    sources.append(origin)
        inherited_character = (scene_row or {}).get('pov_character_id') or meta.get('pov_character_id')
        if inherited_character and not pov_character_id:
            pov_character_id = inherited_character
            inherited['pov_character_id'] = f"cards/{scene_owner['id']}.yaml#payload.important_scenes.{index}.pov_character_id" if (scene_row or {}).get('pov_character_id') else f'drafts/{chapter_id}.meta.json#pov_character_id'
        if pov_character_id:
            scope['pov_character_id'] = entity_id(pov_character_id, '视角人物')
            character = self.store.read_yaml(project_id, f'cards/{pov_character_id}.yaml')
            if character.get('type') != 'character':
                raise ValueError('视角人物不存在，请选择已有角色。')
        if narrative_pov and not scope.get('pov_character_id'):
            warnings.append('已指定叙述写法，但未选择明确视角人物；不会按姓名文字猜测其认知。')
        if not scope.get('world_id'):
            warnings.append('尚未指定世界，不能混用其他世界的动态状态。')
        if not self.has_time(scope):
            warnings.append('发生时间未定；不按章节号或最新记录猜测年龄和动态状态。')
        self.validate_context(project_id, scope)
        return {'scope': scope, 'narrative_pov': narrative_pov, 'inherited_from': inherited, 'sources': sources, 'warnings': warnings}

    def apply_overrides(self, project_id, card, state, scope):
        result, applied = copy.deepcopy(state), []
        for change in scope.get('overrides', []) or []:
            if change['target_id'] != card.get('id') or not self.card_visible(project_id, card, scope):
                continue
            check_revision(self.store, project_id, f"cards/{card['id']}.yaml", change.get('base_revision'))
            keys = change['path'][1:]
            original, target = card.get('payload', {}), result
            for key in keys[:-1]:
                if isinstance(original, list) and key.isdigit() and int(key) < len(original):
                    original = original[int(key)]
                elif isinstance(original, dict):
                    original = original.get(key, {})
                else:
                    raise ValueError('原设定字段位置已经变化，请重新核对局部改动。')
                if isinstance(target, list) and key.isdigit() and int(key) < len(target):
                    target = target[int(key)]
                elif isinstance(target, dict):
                    target = target.setdefault(key, {})
                else:
                    raise ValueError('局部改动字段位置已经变化。')
            final = keys[-1]
            before = original.get(final) if isinstance(original, dict) else original[int(final)] if final.isdigit() and int(final) < len(original) else None
            if 'before' in change and change['before'] != before:
                raise FileExistsError('局部改编依据的原设定已经变化，请先核对原值，正式世界未被覆盖。')
            if 'after' not in change:
                raise ValueError('局部改动须写明修改后的内容。')
            if isinstance(target, list):
                if not final.isdigit() or int(final) >= len(target):
                    raise ValueError('局部改动的列表位置不存在。')
                target[int(final)] = copy.deepcopy(change['after'])
            else:
                target[final] = copy.deepcopy(change['after'])
            applied.append({**copy.deepcopy(change), 'scope': 'story_local', 'source': f"cards/{card['id']}.yaml"})
        return result, applied

    @staticmethod
    def has_time(scope):
        time = scope.get('time', {})
        return any(time.get(key) not in (None, '') for key in ['year', 'date', 'event_ref', 'elapsed_years'])

    def compare_time(self, project_id, left, right):
        """-1/0/1, or None when chronology has no author-provided comparison."""
        left, right = left or {}, right or {}
        def clock(time):
            if not time.get('event_ref'):
                return time
            owner, row, _, _ = self.event(project_id, time['event_ref'])
            story_id = owner['id'] if owner.get('type') == 'story' else owner.get('payload', {}).get('story_card_id')
            story = owner if story_id == owner['id'] else self.store.read_yaml(project_id, f'cards/{entity_id(story_id)}.yaml') if story_id else {}
            inherited = {**story.get('payload', {}).get('world_context', {}).get('time', {})}
            if row.get('chapter'):
                inherited.update(self.store.read_json(project_id, f"drafts/{entity_id(row['chapter'])}.meta.json").get('world_context', {}).get('time', {}))
            inherited.update(row.get('world_context', {}).get('time', {}))
            return {**{key: child for key, child in inherited.items() if key in {'year', 'date', 'elapsed_years'}}, **time}
        left, right = clock(left), clock(right)
        if left.get('date') and right.get('date') and left['date'] != right['date']:
            return -1 if left['date'] < right['date'] else 1
        ly = left.get('year', int(left['date'][:4]) if left.get('date') else None)
        ry = right.get('year', int(right['date'][:4]) if right.get('date') else None)
        if ly is not None and ry is not None and ly != ry:
            return -1 if ly < ry else 1
        if left.get('event_ref') and right.get('event_ref'):
            lo, _, li, lr = self.event(project_id, left['event_ref'])
            ro, _, ri, rr = self.event(project_id, right['event_ref'])
            if lo['id'] == ro['id']:
                if li != ri:
                    if left.get('position') == 'phase' or right.get('position') == 'phase' and li > ri:
                        return None
                    return -1 if li < ri else 1
                lp, rp = left.get('position', 'before'), right.get('position', 'before')
                if lp == 'phase' or rp == 'phase':
                    if lp == rp and left.get('phase') == right.get('phase'):
                        return 0
                    if lp == 'before':
                        return -1
                    if rp == 'before':
                        return 1
                    # "a later phase" does not mean "just after".
                    return None
                return (lp == 'immediate_after') - (rp == 'immediate_after')
            left_first = self.event_precedes(project_id, left['event_ref'], right['event_ref'])
            right_first = self.event_precedes(project_id, right['event_ref'], left['event_ref'])
            if left_first != right_first:
                if left.get('position') == 'phase' or right.get('position') == 'phase' and right_first:
                    return None
                return -1 if left_first else 1
        if left.get('date') and right.get('date'):
            return (left['date'] > right['date']) - (left['date'] < right['date'])
        if ly is not None and ry is not None:
            if ly == ry and bool(left.get('date')) != bool(right.get('date')):
                return None
            return (ly > ry) - (ly < ry)
        if 'elapsed_years' in left and 'elapsed_years' in right:
            return (left['elapsed_years'] > right['elapsed_years']) - (left['elapsed_years'] < right['elapsed_years'])
        return None

    def applies(self, project_id, record_scope, target, *, dynamic=False):
        source = record_scope or {}
        for key in ['world_id', 'story_card_id']:
            if source.get(key) and source[key] != target.get(key):
                return False, f'{key}不在当前范围'
        if source.get('period_id') and source['period_id'] != target.get('period_id'):
            return False, '不属于当前采用时期' if target.get('period_id') else '缺少时期，尚不能核实适用范围'
        if source.get('region_ids') and not set(source['region_ids']) & set(target.get('region_ids') or []):
            return False, '不属于当前采用地区' if target.get('region_ids') else '缺少地区，尚不能核实适用范围'
        source_branch = source.get('branch_id', 'main')
        target_branch = target.get('branch_id', 'main')
        if source_branch != target_branch and (source.get('branch_id') or dynamic or self.has_time(source)):
            if not target.get('world_id'):
                return False, '缺少世界，不能核实分支历史'
            branches = {row['id']: row for row in self.branches(project_id, target['world_id'])}
            cursor, seen = target_branch, set()
            while cursor != source_branch:
                row = branches.get(cursor)
                if cursor in seen or not row or not row.get('parent_branch_id') or not row.get('fork_event_ref'):
                    return False, '不共享其他事件分支的后续历史'
                seen.add(cursor)
                fork_time = {'event_ref': row['fork_event_ref'], 'position': 'before'}
                relation = self.compare_time(project_id, source.get('time'), fork_time)
                if relation is None or relation > 0:
                    return False, '只能继承分歧点前有时间依据的历史'
                cursor = row['parent_branch_id']
        if source.get('until'):
            order = self.compare_time(project_id, target.get('time'), source['until'])
            if order is None or order >= 0:
                return False, '失效时间未能核实或已超出有效时期'
        if dynamic or self.has_time(source):
            relation = self.compare_time(project_id, source.get('time'), target.get('time'))
            if relation is None:
                return False, '发生时间或事件阶段不确定，未当作当前状态'
            if relation > 0:
                return False, '属于未来状态'
        return True, ''

    def card_visible(self, project_id, card, scope):
        payload = card.get('payload', {})
        context = payload.get('world_context') or (payload.get('scope') if isinstance(payload.get('scope'), dict) else {}) or (card.get('scope') if isinstance(card.get('scope'), dict) else {})
        if payload.get('world_id'):
            context = {**context, 'world_id': payload['world_id']}
        if scope.get('world_id') and card.get('type') in {'world', 'world_rule', 'worldview', 'lore'} and not self.belongs_to_world(project_id, card, scope['world_id']):
            return False
        return self.applies(project_id, context, scope)[0]

    def belongs_to_world(self, project_id, card, world_id):
        seen = set()
        while card and card.get('id') not in seen:
            if card.get('id') == world_id:
                return True
            seen.add(card.get('id'))
            payload = card.get('payload') or {}
            context = payload.get('world_context') or (payload.get('scope') if isinstance(payload.get('scope'), dict) else {})
            if context.get('world_id') == world_id or payload.get('world_id') == world_id:
                return True
            parent = payload.get('parent_id')
            if not parent:
                break
            card = self.store.read_yaml(project_id, f'cards/{entity_id(parent)}.yaml')
        return False

    def filter_value(self, project_id, value, scope):
        if isinstance(value, list):
            return [filtered for item in value if (filtered := self.filter_value(project_id, item, scope)) is not None]
        if isinstance(value, dict):
            explicit = value.get('world_context') or value.get('applicability')
            if explicit and not self.applies(project_id, explicit, scope)[0]:
                return None
            if value.get('branch_id') or value.get('world_id'):
                embedded = {key: value[key] for key in ['world_id', 'branch_id', 'time'] if key in value}
                if not self.applies(project_id, embedded, scope)[0]:
                    return None
            if self.has_time(scope):
                introduced = next((value.get(key) for key in ['introduced_chapter', 'first_chapter', 'chapter_id', 'chapter'] if isinstance(value.get(key), str) and value.get(key)), None)
                if introduced and introduced != scope.get('chapter_id'):
                    chapter_scope = self.resolve(project_id, chapter_id=introduced)['scope']
                    if not self.applies(project_id, chapter_scope, scope, dynamic=True)[0]:
                        return None
            return {key: self.filter_value(project_id, item, scope) for key, item in value.items()
                    if key not in {'branches', 'relationship_registry', 'reference_image'}}
        return value

    def fact_visible(self, project_id, fact, scope):
        if fact.get('id'):
            from services.information_service import InformationService
            if not InformationService(self.store).fact_allowed(project_id, fact['id'], scope):
                return False
        context = fact.get('world_context') or (fact.get('scope') if isinstance(fact.get('scope'), dict) else {})
        context = {**context}
        reference = fact.get('event_ref') or (fact.get('evidence') or {}).get('event_ref')
        inherited = {}
        try:
            if reference:
                inherited = self.resolve(project_id, event_ref=reference)['scope']
            elif (fact.get('evidence') or {}).get('chapter_id'):
                inherited = self.resolve(project_id, chapter_id=fact['evidence']['chapter_id'])['scope']
        except (ValueError, FileNotFoundError):
            return False
        context = {**{key: child for key, child in inherited.items() if key in {'world_id', 'branch_id', 'story_card_id', 'time'}}, **context}
        for key in ['world_id', 'branch_id', 'story_card_id', 'time']:
            if key in fact:
                context[key] = fact[key]
        if reference:
            context.setdefault('time', {})
            context['time'] = {**context['time'], 'event_ref': reference, 'position': context['time'].get('position', 'immediate_after')}
        if not self.applies(project_id, context, scope, dynamic=True)[0]:
            return False
        pov = scope.get('pov_character_id')
        known_by = fact.get('known_by') or []
        if pov and fact.get('public') is not True and pov not in known_by:
            return False
        learned = fact.get('learned_at')
        return not learned or self.applies(project_id, {**context, 'time': learned}, scope, dynamic=True)[0]

    @staticmethod
    def age(payload, scope):
        time = scope.get('time', {})
        born = payload.get('birth_date')
        if born and time.get('date'):
            try:
                birth, current = date.fromisoformat(born), date.fromisoformat(time['date'])
                years = current.year - birth.year - ((current.month, current.day) < (birth.month, birth.day))
                if years >= 0:
                    return {'value': years, 'basis': 'birth_date', 'estimated': False}
            except (ValueError, TypeError):
                pass
        initial = payload.get('initial_age', payload.get('age'))
        elapsed = time.get('elapsed_years')
        base_time = payload.get('initial_age_time') or {}
        if elapsed is None and isinstance(time.get('year'), int) and isinstance(base_time.get('year'), int):
            elapsed = time['year'] - base_time['year']
        if isinstance(initial, (int, float)) and not isinstance(initial, bool) and isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool) and initial + elapsed >= 0:
            return {'value': initial + elapsed, 'basis': 'initial_age_with_explicit_span', 'estimated': False}
        return {'value': None, 'basis': 'unknown', 'estimated': False, 'reason': '缺少可靠出生日期或初始年龄对应的明确时间跨度；不按章节推算。'}
