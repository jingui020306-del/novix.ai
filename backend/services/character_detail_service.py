"""Author-defined character details share the card/stage identity and prompt boundary."""
import copy
import json
import re

from services.world_scope_service import WorldScopeService, entity_id


def strip_author_only(value, _private_context=False):
    if isinstance(value, dict):
        if value.get('usage') == 'author_only' or value.get('author_only') is True or value.get('private') is True:
            return {}
        sections = value.get('detail_sections')
        private = isinstance(sections, list) and any(isinstance(row, dict) and row.get('usage') == 'author_only' for row in sections)
        changes = value.get('changes', {}).get('detail_sections') if isinstance(value.get('changes'), dict) else None
        private = private or isinstance(changes, list) and any(isinstance(row, dict) and row.get('usage') == 'author_only' for row in changes)
        private = private or _private_context
        result = {key: [strip_author_only(row, private) for row in child if isinstance(row, dict) and row.get('usage') != 'author_only' and not row.get('removed')]
                if key == 'detail_sections' and isinstance(child, list) else strip_author_only(child, private) for key, child in value.items() if key not in {'author_notes', 'private_notes', 'author_only'}}
        if private or str(value.get('id', '')).startswith('self_'):
            # Shared import quotations can repeat a now-private detail; keep source references, not that raw quotation.
            keys = {'id', 'kind', 'path', 'source_id', 'record_id', 'version', 'import_batch_id', 'page', 'pages', 'line_range', 'url'}
            for key in ['source', 'sources']:
                if isinstance(result.get(key), dict):
                    result[key] = {name: child for name, child in result[key].items() if name in keys}
                elif isinstance(result.get(key), list):
                    result[key] = [{name: child for name, child in row.items() if name in keys} for row in result[key] if isinstance(row, dict)]
        return result
    if isinstance(value, list):
        return [strip_author_only(child, _private_context) for child in value]
    return copy.deepcopy(value)


def validate_detail_sections(store, project_id, sections, *, allow_removed=False, extra_entities=None):
    if not isinstance(sections, list) or len(sections) > 200:
        raise ValueError('人物补充段须为至多200段的列表。')
    ids, world = set(), WorldScopeService(store)
    for row in sections:
        if not isinstance(row, dict):
            raise ValueError('人物补充段格式不正确。')
        sid = entity_id(row.get('id'), '补充段')
        if sid in ids:
            raise ValueError('人物补充段编号重复，请合并同一段或保留不同编号。')
        ids.add(sid)
        if row.get('removed'):
            if not allow_removed or row['removed'] is not True:
                raise ValueError('移除阶段补充须保留原段编号；初始资料直接删除该段。')
            continue
        for key, limit in [('title', 200), ('content', 12000), ('summary', 2000), ('situation', 2000), ('response', 120)]:
            text = row.get(key, '')
            if not isinstance(text, str) or len(text) > limit or key in {'title', 'content'} and not text.strip():
                raise ValueError('请填写人物补充段名称与内容，名称最多200字、正文最多12000字。')
        rating = row.get('desirability')
        if rating is not None and (type(rating) is not int or not -10 <= rating <= 10):
            raise ValueError('事件对目标的影响须为 −10 至 10 的整数，或留空。')
        if row.get('usage', 'relevant') not in {'relevant', 'focus', 'author_only'}:
            raise ValueError('补充段请选择按场景参考、重点参考或仅作者查看。')
        world.validate_context(project_id, row.get('scope') or {}, extra_entities=extra_entities)
        for key in ['target_ids', 'relationship_ids']:
            refs = row.get(key, [])
            if not isinstance(refs, list) or any(not isinstance(ref, str) for ref in refs) or len(set(refs)) != len(refs):
                raise ValueError('补充段的适用人物与共享关系须为不重复的编号列表。')
            for ref in refs:
                if key == 'target_ids':
                    entity_id(ref, '人物')
                    if store.read_yaml(project_id, f'cards/{ref}.yaml').get('type') != 'character' and (extra_entities or {}).get(ref) != 'character':
                        raise ValueError('补充段适用对象须选择已有的人物。')
                elif (extra_entities or {}).get(ref) != 'relationship':
                    from services.author_data_service import AuthorDataService
                    AuthorDataService(store).relationship(project_id, ref)
        if not isinstance(row.get('sources', []), list) or any(not isinstance(source, (str, dict)) for source in row.get('sources', [])):
            raise ValueError('补充段来源须为出处列表。')


def detail_is_relevant(row, scene):
    """Only expand a saved detail when the present task names its concrete subject."""
    query = json.dumps(scene or {}, ensure_ascii=False)
    hints = [str(row.get(key) or '').strip() for key in ['situation', 'title']]
    if any(len(hint) >= 4 and hint in query for hint in hints):
        return True
    pairs = {hint[i:i + 2] for hint in hints for i in range(len(hint) - 1)}
    pairs -= {'人物', '场景', '对话', '动作', '描写', '经历', '参考', '关系', '情绪', '时候'}
    hits = {pair for pair in pairs if pair in query}
    return len(hits) >= 3


def select_character_details(store, project_id, card, scope, scene, *, focus_ids=(), max_chars=2500):
    world, scene = WorldScopeService(store), scene or {}
    card = strip_author_only(card)
    actors = set(scene.get('cast', []) or scene.get('characters', []))
    actors.discard(card.get('id'))
    query = json.dumps(scene, ensure_ascii=False)
    ranked = []
    for index, row in enumerate(card.get('payload', {}).get('detail_sections', []) or []):
        if not isinstance(row, dict) or row.get('usage') == 'author_only' or row.get('removed'):
            continue
        if not world.applies(project_id, row.get('scope'), scope)[0]:
            continue
        if row.get('scope', {}).get('pov_character_id') and row['scope']['pov_character_id'] != scope.get('pov_character_id'):
            continue
        if row.get('target_ids') and not actors.intersection(row['target_ids']):
            continue
        if row.get('relationship_ids'):
            from services.author_data_service import AuthorDataService
            related = [AuthorDataService(store).relationship(project_id, ref) for ref in row['relationship_ids']]
            if not any({person['entity_id'] for person in relation['participants']} <= (actors | {card.get('id')}) for relation in related):
                continue
        words = re.findall(r'[\w\u4e00-\u9fff]{2,}', str(row.get('situation') or ''))
        score = 100 if row.get('id') in focus_ids else 50 if row.get('usage') == 'focus' else 0
        score += sum(word in query for word in words)
        score += sum(word[index:index + 2] in query for word in words for index in range(len(word) - 1))
        ranked.append((-score, index, row))
    selected, used = [], 0
    for _, _, row in sorted(ranked, key=lambda item: item[:2]):
        relevant = detail_is_relevant(row, scene)
        item = {**strip_author_only(row), 'portrayal': '条件性倾向：服从当前目标与处境，不要求每次重复动作，不新增人物事实。',
                'selection_reason': '作者勾选全文' if row.get('id') in focus_ids else '保存为重点参考' if row.get('usage') == 'focus' else '当前任务明确关联' if relevant else '普通场景参考',
                'expanded_for_task': relevant}
        size = len(json.dumps(item, ensure_ascii=False))
        required = row.get('id') in focus_ids or row.get('usage') == 'focus' or relevant
        if not required and (row.get('summary') or len(row.get('content', '')) > 1200):
            item['content'] = row.get('summary') or f"{row.get('title', '')}：原文未展开，可按来源查看。"
            item['material_mode'] = 'summary'
            size = len(json.dumps(item, ensure_ascii=False))
        if required or used + size <= max_chars:
            selected.append(item)
            if not required:
                used += size
    return selected
