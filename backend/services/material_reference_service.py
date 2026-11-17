"""Resolve explicit stable source references without following the whole graph."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import PurePosixPath

from services.character_detail_service import strip_author_only, select_character_details
from services.world_scope_service import WorldScopeService
from services.author_data_service import AuthorDataService


def references(text, *, source='', material_id=''):
    result, seen = [], set()
    for target in [*re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', text or ''), *re.findall(r'\[[^\]]*\]\(([^)]+)\)', text or '')]:
        target = target.strip()
        if target.startswith(('http:', 'https:', '#')) or target in seen:
            continue
        seen.add(target)
        result.append({'label': target, 'source': target, **({'material_id': target} if '/' not in target and '#' not in target else {})})
    return result


def paragraph_references(text, source, material_id=''):
    rows = []
    for index, match in enumerate(re.finditer(r'\S[\s\S]*?(?=\n\s*\n|$)', text)):
        if len(rows) >= 40:
            break
        rows.append({'label': f'第{index + 1}段原文', 'source': source, 'material_id': material_id, 'start': match.start(), 'end': match.end()})
    return rows


def effective_provenance(item, effective, *, field='', section_id='', scope=None):
    """Keep a logical object link, but locate changed text at its actual saved stage."""
    if not effective:
        return item
    base = effective.get('base', {})
    item['material_type'] = 'character' if base.get('type') == 'character' else 'world'
    item['logical_source'] = item['source']
    candidates = []
    conflicted = {row.get('field') for row in effective.get('uncertainties', []) if isinstance(row, dict)}
    for row in effective.get('changes', []):
        changes = row.get('changes') or {}
        if section_id:
            value = next((entry for entry in changes.get('detail_sections', []) if entry.get('id') == section_id), None)
            current = next((entry for entry in effective['state'].get('detail_sections', []) if entry.get('id') == section_id), None)
            matches = value is not None and value == current and f'detail_sections.{section_id}' not in conflicted
        elif field:
            matches = field in changes and changes[field] == effective['state'].get(field) and field not in conflicted
        else:
            matches = any(key not in conflicted and value == effective['state'].get(key) for key, value in changes.items())
        if matches:
            candidates.append(row)
    if candidates:
        stage = candidates[-1]['id']
        item.update(source=f'canon/author_stages.jsonl#{stage}', stage_id=stage, source_record_id=stage,
                    sources=[{'path': f"cards/{base['id']}.yaml"}, *[{'path': 'canon/author_stages.jsonl', 'record_id': row['id']} for row in candidates]])
    local = [row for row in effective.get('local_changes', []) if not field or row.get('path', [None, None])[1:2] == [field]]
    if local:
        item.update(source='request.world_context.overrides', local_override=True,
                    sources=[{'path': f"cards/{base['id']}.yaml"}, {'path': 'request.world_context.overrides', 'target_id': base['id']}])
        item.pop('stage_id', None)
        item.pop('source_record_id', None)
    return item


class MaterialReferenceService:
    def __init__(self, store):
        self.store, self.world = store, WorldScopeService(store)

    def _scope_filter(self, project, value, scope):
        if isinstance(value, list):
            return [child for row in value if (child := self._scope_filter(project, row, scope)) is not None]
        if isinstance(value, dict):
            context = value.get('scope')
            if isinstance(context, dict) and not self.world.applies(project, context, scope)[0]:
                return None
            if scope.get('pov_character_id') and 'known_by' in value and value.get('public') is not True and scope['pov_character_id'] not in (value.get('known_by') or []):
                return None
            return {key: self._scope_filter(project, child, scope) for key, child in value.items()}
        return value

    def _read(self, project, ref, scope, scene, chapter_id):
        raw = str(ref.get('source') or ref.get('material_id') or '')
        path, _, fragment = raw.partition('#')
        if not path:
            raise ValueError('缺少稳定来源。')
        if '/' not in path:
            card_path = f'cards/{path.removesuffix(".yaml")}.yaml'
            draft_path = f'drafts/{path.removesuffix(".md")}.md'
            path = card_path if self.store._safe_path(project, card_path).is_file() else draft_path
        if PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts or not path.startswith(('cards/', 'drafts/', 'assets/')):
            raise ValueError('只支持当前作品中的正式资料与来源文件。')
        if path.startswith('assets/'):
            raise ValueError('原始附件尚无可核验的正式适用范围与人物知情依据；请先确认成正式条目，再按条目引用。原件仍可由作者查看。')
        file = self.store._safe_path(project, path)
        if not file.is_file():
            raise ValueError('来源已不存在，请重新选择。')
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        card_id, extra_refs, effective = '', [], None
        if path.startswith('cards/'):
            card = self.store.read_yaml(project, path)
            card_id = card.get('id') or file.stem
            if not self.world.card_visible(project, card, scope):
                raise ValueError('来源不适用当前世界、分支或故事时间。')
            payload = card.get('payload', {})
            protected = {'hidden_line', 'foreshadowings'} if card.get('type') == 'story' else set()
            if 'information_registry' in payload:
                protected.add('information_registry')
            if protected.intersection(payload):
                if fragment.removeprefix('payload.').split('.')[0] in protected:
                    raise ValueError('暗线、伏笔和信息底稿请按章节取用已授权部分。')
                payload = {key: value for key, value in payload.items() if key not in protected}
            if payload.get('canon_status') in {'hypothesis', 'inspiration'} or payload.get('confirmation_status') in {'pending', 'pending_author_review'}:
                raise ValueError('来源尚未确认，不能作为本次正式依据展开。')
            if scope.get('pov_character_id') and payload.get('known_by') and scope['pov_character_id'] not in payload['known_by']:
                raise ValueError('来源未属于当前视角人物已知。')
            if card.get('type') == 'character':
                effective = AuthorDataService(self.store).character_state(project, card_id, world_context=scope)
                payload = effective['state']
            elif card.get('type') in {'world', 'world_rule', 'worldview', 'lore'}:
                snapshot = AuthorDataService(self.store).author_state(project, world_context=scope)
                effective = next((row for row in snapshot['worlds'] if row['id'] == card_id), None)
                if not effective:
                    raise ValueError('该世界资料不适用当前范围。')
                payload = effective['state']
            # Preserve privacy inherited from the whole card before drilling down to a scalar.
            safe_payload = self.world.filter_value(project, self._scope_filter(project, strip_author_only(payload), scope), scope)
            if safe_payload is None:
                raise ValueError('来源不适用当前世界、分支或故事时间。')
            value = safe_payload
            keys = fragment.removeprefix('payload.').split('.') if fragment else []
            if any(key in {'author_only', 'author_notes', 'private', 'private_notes'} for key in keys):
                raise ValueError('作者私有参考不可带入模型。')
            if keys and keys[0] == 'detail_sections':
                if len(keys) < 2 or not keys[1].startswith('@'):
                    raise ValueError('补充段请使用稳定段编号引用，不能使用易变行号。')
                sid = keys[1][1:]
                original = next((row for row in payload.get('detail_sections', []) if isinstance(row, dict) and row.get('id') == sid), None)
                if not original or original.get('removed'):
                    raise ValueError('所选人物段已删除或不在当前阶段。')
                if original.get('usage') == 'author_only':
                    raise ValueError('该段仅作者查看，不可带入模型。')
                allowed = select_character_details(self.store, project, {**card, 'payload': payload}, scope, scene, focus_ids=[sid])
                selected = next((row for row in allowed if row['id'] == sid), None)
                if not selected:
                    raise ValueError('该段不适用当前时期、对象、关系或视角。')
                value = selected.get('content', '')
            else:
                probe = payload
                for key in keys:
                    if isinstance(probe, dict) and (probe.get('usage') == 'author_only' or probe.get('author_only') is True or probe.get('private') is True):
                        raise ValueError('所选字段继承作者私有范围，不可带入模型。')
                    if isinstance(probe, dict) and (probe.get('scope') and not self.world.applies(project, probe['scope'], scope)[0] or scope.get('pov_character_id') and probe.get('known_by') and scope['pov_character_id'] not in probe['known_by']):
                        raise ValueError('所选字段不适用当前范围或未属于视角人物已知。')
                    probe = probe.get(key) if isinstance(probe, dict) else None
                if isinstance(probe, dict) and (probe.get('usage') == 'author_only' or probe.get('author_only') is True or probe.get('private') is True):
                    raise ValueError('所选字段仅作者查看，不可带入模型。')
                if isinstance(probe, dict) and (probe.get('scope') and not self.world.applies(project, probe['scope'], scope)[0] or scope.get('pov_character_id') and probe.get('known_by') and scope['pov_character_id'] not in probe['known_by']):
                    raise ValueError('所选字段不适用当前范围或未属于视角人物已知。')
                for key in keys:
                    if isinstance(value, dict) and (value.get('usage') == 'author_only' or value.get('author_only') is True or value.get('private') is True):
                        raise ValueError('所选字段继承作者私有范围，不可带入模型。')
                    if not isinstance(value, dict) or key not in value or value[key] is None:
                        raise ValueError('所选字段已不存在，请重新选择。')
                    value = value[key]
                value = self.world.filter_value(project, strip_author_only(value), scope)
                if value is None:
                    raise ValueError('所选来源不适用当前范围。')
                # A whole character card must use the same section selector as normal materials.
                if not keys and card.get('type') == 'character' and isinstance(value, dict):
                    value['detail_sections'] = select_character_details(self.store, project, {**card, 'payload': payload}, scope, scene)
                if not keys:
                    fields = [value.get(key) for key in ['content', 'description'] if isinstance(value.get(key), str)] if isinstance(value, dict) else []
                    value = '\n\n'.join(fields) if fields else value
            label = card.get('title') or card_id
            for link in payload.get('links', []) or [] if not fragment else []:
                if isinstance(link, str):
                    extra_refs.append({'label': link, 'source': link})
                elif isinstance(link, dict) and (link.get('target') or link.get('id')):
                    extra_refs.append({'label': link.get('label') or link.get('target') or link['id'], 'source': link.get('target') or link['id']})
        else:
            if path.startswith('drafts/'):
                source_chapter = file.stem
                order = self.store.read_md(project, 'drafts/.chapter_order').splitlines()
                visible = order[:order.index(chapter_id) + 1] if chapter_id in order else [chapter_id]
                if source_chapter not in visible:
                    raise ValueError('所选正文位于当前阅读边界之后。')
                source_scope = self.world.resolve(project, chapter_id=source_chapter)['scope']
                if not self.world.applies(project, source_scope, scope, dynamic=self.world.has_time(scope))[0]:
                    raise ValueError('所选正文不属于当前世界、分支或故事时间。')
                source_pov = self.store.read_json(project, f'drafts/{source_chapter}.meta.json').get('pov_character_id')
                if scope.get('pov_character_id') and source_pov and source_pov != scope['pov_character_id']:
                    raise ValueError('该段来自另一人物视角，尚未明确属于当前人物已知。')
            elif not ref.get('start') and ref.get('end') is None:
                raise ValueError('来源附件须指定已核对的段落范围，不能自动展开整包资料。')
            value = file.read_text(encoding='utf-8')
            label = file.name
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        start, end = ref.get('start', 0), ref.get('end', len(text))
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int) or not isinstance(end, int) or not 0 <= start <= end <= len(text):
            raise ValueError('引用段落位置已失效，请重新核对来源。')
        text = text[start:end]
        stable = path + ('#' + fragment if fragment else '')
        item = {'id': 'expand:' + hashlib.sha256((stable + ':' + str(start) + ':' + str(end)).encode()).hexdigest()[:20],
                'label': label, 'reason': '作者指定展开' , 'mode': 'expanded', 'required': True, 'text': text,
                'source': stable, 'material_id': card_id, 'type': '按需展开原文', 'references': references(text) + extra_refs}
        if effective:
            parts = fragment.removeprefix('payload.').split('.') if fragment else []
            effective_provenance(item, effective, field=parts[0] if parts else '', section_id=parts[1][1:] if len(parts) > 1 and parts[0] == 'detail_sections' and parts[1].startswith('@') else '', scope=scope)
        return item, path, digest

    def expand(self, project, choices, scope, scene, chapter_id):
        items, overflow, versions, seen = [], [], {}, set()
        queue = [(choice if isinstance(choice, dict) else {'source': choice}, 0, []) for choice in choices or []]
        while queue:
            if len(seen) >= 200:
                overflow.append({'id': 'expansion_limit', 'label': '展开引用数量', 'source': '', 'required': True, 'chars': 0, 'reason': '已达到200个来源的安全展开上限，请缩小本次关联范围。'})
                break
            ref, depth, via = queue.pop(0)
            key = (str(ref.get('source') or ref.get('material_id')), ref.get('start'), ref.get('end'))
            if key in seen:
                continue
            seen.add(key)
            try:
                item, path, digest = self._read(project, ref, scope, scene, chapter_id)
            except (ValueError, FileNotFoundError, KeyError) as exc:
                overflow.append({'id': str(key[0]), 'label': str(ref.get('label') or key[0]), 'source': str(key[0]), 'required': True, 'chars': 0, 'reason': str(exc)})
                continue
            if any(parent.split('#', 1)[0] == path for parent in via):
                continue
            if any(prior['id'] == item['id'] for prior in items):
                continue
            item.update(depth=depth, via=via)
            if ref.get('automatic'):
                item['reason'] = '当前任务关联人物段，沿明确来源链接展开'
            items.append(item)
            versions[path] = digest
            if item.get('stage_id') or path.startswith('cards/'):
                stage_path = self.store._safe_path(project, 'canon/author_stages.jsonl')
                versions['canon/author_stages.jsonl'] = hashlib.sha256(stage_path.read_bytes() if stage_path.exists() else b'').hexdigest()
            if ref.get('follow_refs') and depth < 2:
                queue.extend(({**child, 'follow_refs': True, 'automatic': ref.get('automatic', False)}, depth + 1, [*via, item.get('logical_source') or item['source']]) for child in item['references'])
        return {'items': items, 'overflow': overflow, 'source_versions': versions}
