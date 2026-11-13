from __future__ import annotations

import json
import re


class WritingReferenceService:
    """Resolve only the author's selected references from their latest files."""

    def __init__(self, store):
        self.store = store

    def collect(self, project_id: str, *, cards=(), chapter_id=None, cast=(), reference_ids=(), story_card_id=None, include_global=True, max_chars=6000):
        owners = list(cards)
        supplied = {card.get('id') for card in owners if card.get('id')}
        stories = []
        for path in sorted(self.store._safe_path(project_id, 'cards').glob('*.yaml')):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if card.get('id') in supplied:
                continue
            if card.get('type') == 'story':
                stories.append(card)
            if card.get('id') in cast or (chapter_id and card.get('id') == 'style_001'):
                owners.append(card)
        if include_global and not any(card.get('type') == 'story' for card in owners) and stories:
            matched = [card for card in stories if card.get('id') == story_card_id] if story_card_id else [card for card in stories if chapter_id and any(isinstance(row, dict) and (row.get('chapter') == chapter_id or row.get('chapter_id') == chapter_id) for row in card.get('payload', {}).get('chapter_plan', []))]
            if story_card_id and not matched:
                raise ValueError('选定的故事不存在，请重新选择故事。')
            # Follow one story only: an explicit chapter plan, otherwise the established first story.
            owners.append((matched or stories)[0])
        selected = []
        for card in owners:
            ids = card.get('payload', {}).get('writing_references') or []
            if not isinstance(ids, list):
                raise ValueError('选用的写作参考格式不正确，请重新选择。')
            selected.extend((rid, card.get('id') or '当前编辑内容') for rid in ids)
        if not isinstance(reference_ids, (list, tuple)):
            raise ValueError('选用的写作参考格式不正确，请重新选择。')
        selected.extend((rid, '本次构思') for rid in reference_ids)
        if chapter_id:
            meta = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json')
            selected.extend((row.get('technique_id'), chapter_id) for row in meta.get('pinned_techniques', []) if isinstance(row, dict))
            selected.extend((rid, chapter_id) for rid in meta.get('tool_skill_ids', []) or [])
        unique = []
        seen = set()
        for rid, owner in selected:
            if not isinstance(rid, str) or not re.fullmatch(r'[\w-]+', rid):
                raise ValueError('选用的写作参考格式不正确，请重新选择。')
            if rid in seen:
                continue
            seen.add(rid)
            unique.append((rid, owner))
        result = {'references': [], 'omitted': [], 'omitted_count': len(unique)}
        def fits():
            return len(json.dumps(result, ensure_ascii=False)) <= max_chars
        if not fits():
            raise ValueError('本次写作参考预算过小。')
        omissions = []
        for rid, owner in unique:
            card = self.store.read_yaml(project_id, f'cards/{rid}.yaml')
            title = str(card.get('title') or card.get('payload', {}).get('name') or '未命名参考')
            reason = ''
            if card.get('type') not in {'technique', 'tool_skill'}:
                reason = '参考不存在或类型不支持，请重新选择'
            elif re.fullmatch(r'[a-z]+_扩展技法_\d+', title):
                title, reason = '待完善的写作参考', '内容尚未完善，本次不采用'
            item = {'id': rid, 'title': title, 'type': card.get('type'), 'source': f'cards/{rid}.yaml', 'selected_by': owner, 'payload': card.get('payload', {})}
            if not reason:
                result['references'].append(item)
                result['omitted_count'] -= 1
                if not fits():
                    result['references'].pop()
                    result['omitted_count'] += 1
                    reason = '超出本次参考预算，请减少选用内容'
            if reason:
                omissions.append({'id': rid[:120], 'title': title[:48], 'reason': reason, 'selected_by': str(owner)[:80]})
        # Keep the total even when individual explanations cannot fit beside the actual references.
        for item in omissions:
            variants = [item, {'title': item['title'][:24], 'reason': item['reason']}, {'reason': item['reason']}]
            for summary in variants:
                result['omitted'].append(summary)
                if fits():
                    break
                result['omitted'].pop()
            else:
                break
        result['policy'] = '仅作写作参考，不是作品事实；优先遵守作者要求与已保存设定。'
        if not fits():
            result.pop('policy')
        return result
