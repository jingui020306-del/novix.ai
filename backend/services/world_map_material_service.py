"""Map attachments and display markers never change the referenced world's facts."""
import hashlib
import math

from services.world_scope_service import WorldScopeService, entity_id


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_maps(store, project_id, card, *, extra_cards=None):
    maps = card.get('payload', {}).get('maps', [])
    if not isinstance(maps, list) or len(maps) > 200:
        raise ValueError('地图与插图须为至多200份的列表。')
    world = WorldScopeService(store)
    owner_world, cursor, visited = None, card, set()
    while cursor and cursor.get('id') not in visited:
        visited.add(cursor['id'])
        payload = cursor.get('payload', {})
        owner_world = payload.get('world_context', {}).get('world_id') or payload.get('world_id')
        if owner_world:
            break
        parent = payload.get('parent_id')
        if not parent:
            owner_world = cursor['id']
            break
        cursor = (extra_cards or {}).get(parent) or store.read_yaml(project_id, f'cards/{entity_id(parent)}.yaml')
    if not owner_world:
        raise ValueError('图件所属世界无法可靠定位，请先核对父级与世界关联。')
    ids = set()
    for item in maps:
        if not isinstance(item, dict):
            raise ValueError('地图资料格式不正确。')
        mid = entity_id(item.get('id'), '图件')
        if mid in ids:
            raise ValueError('同一图件请保留一个编号。')
        ids.add(mid)
        if not isinstance(item.get('title'), str) or item.get('kind') not in {'map', 'town', 'diagram', 'illustration'}:
            raise ValueError('请填写图名并区分地图、城镇图、结构图或插图。')
        system = item.get('coordinate_system')
        if system not in {'pixel', 'normalized', 'grid', 'geographic'}:
            raise ValueError('请保留原坐标类型，不把网格或经纬度当作像素。')
        scope = item.get('scope') or {}
        world.validate_context(project_id, scope, extra_entities={key: value.get('type') for key, value in (extra_cards or {}).items()})
        if owner_world and scope.get('world_id') and scope['world_id'] != owner_world:
            raise ValueError('图件适用世界与所属资料不一致。')
        source = item.get('source') or {}
        batch, sid = entity_id(source.get('batch_id'), '材料批次'), entity_id(source.get('source_id'), '来源')
        record = store.read_json(project_id, f'sessions/material_imports/{batch}.json')
        original = next((row for row in record.get('sources') or [record.get('source', {})] if row.get('id') == sid), None)
        if not original:
            raise ValueError('图件原材料尚未保存或来源不存在。')
        allowed = {original.get('raw_path')}
        if source.get('page'):
            page = source['page']
            if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= original.get('page_count', 0):
                raise ValueError('图页不在原PDF范围内。')
            allowed.add(f'sessions/material_imports/{batch}/pages/{sid}/{page}.png')
        if source.get('raw_path') not in allowed or not store._safe_path(project_id, source.get('raw_path') or '').is_file():
            raise ValueError('图件须引用已保留的原图或实际PDF图页。')
        if source.get('version') and source['version'] != original.get('version'):
            raise FileExistsError('图件来源版本已改变，请核对后重新绑定。')
        hotspots, pin_ids = item.get('hotspots', []), set()
        if not isinstance(hotspots, list) or len(hotspots) > 2000:
            raise ValueError('图上标记须为至多2000项的列表。')
        for pin in hotspots:
            if not isinstance(pin, dict):
                raise ValueError('图上标记格式不正确。')
            pid = entity_id(pin.get('id'), '标记')
            if pid in pin_ids:
                raise ValueError('图上标记编号重复。')
            pin_ids.add(pid)
            if not isinstance(pin.get('label'), str) or pin.get('status') not in {'candidate', 'confirmed'}:
                raise ValueError('标记须保留名称及待确认或已确认状态。')
            coordinates = pin.get('coordinates', {})
            keys = ['latitude', 'longitude'] if system == 'geographic' else ['x', 'y']
            if coordinates or pin['status'] == 'confirmed':
                if not isinstance(coordinates, dict) or any(not _number(coordinates.get(key)) for key in keys):
                    raise ValueError('坐标须使用原坐标类型对应的数值。')
                if system == 'normalized' and any(not 0 <= coordinates[key] <= 1 for key in keys) or system == 'geographic' and (not -90 <= coordinates['latitude'] <= 90 or not -180 <= coordinates['longitude'] <= 180):
                    raise ValueError('比例或经纬坐标超出有效范围。')
            display = pin.get('display_position')
            if display is not None and (not isinstance(display, dict) or any(not _number(display.get(key)) or not 0 <= display[key] <= 1 for key in ['x', 'y'])):
                raise ValueError('图面显示位置须为0至1的横纵比例，不改原坐标。')
            target = pin.get('entity_id')
            if pin['status'] == 'confirmed' and not target:
                raise ValueError('确认图上标记前，请选择已有的详细条目。')
            if target:
                entity_id(target, '条目')
                target_card = (extra_cards or {}).get(target) or store.read_yaml(project_id, f'cards/{target}.yaml')
                if not target_card or owner_world and not world.belongs_to_world(project_id, target_card, owner_world):
                    raise ValueError('图上标记须绑定当前世界中的实际资料，不自动新增地点事实。')


def visual_map_candidate(service, project_id, record, source, visual, page=None):
    if record.get('purpose') != 'world':
        return None
    kind = visual.get('kind')
    if kind not in {'map', 'town', 'diagram', 'illustration'}:
        return None
    seed = hashlib.sha256(f"{source['version']}:{page}".encode()).hexdigest()[:18]
    pins = []
    for index, row in enumerate(visual.get('hotspots', []) or []):
        if not isinstance(row, dict) or not isinstance(row.get('label'), str):
            continue
        display = row.get('display_position')
        if not isinstance(display, dict) or any(not _number(display.get(key)) or not 0 <= display[key] <= 1 for key in ['x', 'y']):
            display = None
        pins.append({'id': f'pin_{seed}_{index}', 'label': row['label'], 'coordinates': dict(display) if display else {},
            **({'display_position': dict(display)} if display else {}), 'status': 'candidate'})
    raw_path = str(service.pdf_page_path(project_id, record['id'], source['id'], page).relative_to(service.store._project_dir(project_id))) if page else source['raw_path']
    title = visual.get('title') or source.get('filename') or '待确认图件'
    image = {'id': 'map_' + seed, 'title': title, 'kind': kind, 'scope': record.get('world_context') or {}, 'coordinate_system': 'normalized',
        'source': {'batch_id': record['id'], 'source_id': source['id'], 'raw_path': raw_path, 'version': source['version'], **({'page': page} if page else {})}, 'hotspots': pins}
    return {'id': 'candidate_map_' + seed, 'kind': 'world', 'label': title, 'values': {'title': title, 'entry_type': 'place' if kind in {'map', 'town'} else 'reference', 'maps': [image]},
        'scope': record.get('world_context') or {}, 'provenance': 'material_fact', 'evidence': [{'source_id': source['id'], 'quote': visual.get('transcription', '')[:500], **({'page': page} if page else {})}]}


def filter_map_scope(store, project_id, payload, scope):
    if isinstance(payload, dict) and isinstance(payload.get('maps'), list):
        world = WorldScopeService(store)
        return {**payload, 'maps': [item for item in payload['maps'] if world.applies(project_id, item.get('scope'), scope)[0]]}
    return payload
