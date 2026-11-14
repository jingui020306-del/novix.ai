"""File-authoritative index and world-library regressions; all writes use tmp_path."""
from pathlib import Path
import sqlite3
import struct
import sys
import zlib
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.author_data_service import AuthorDataService
from services.context_pack_service import ContextPackService
from services.edit_version_service import revision
from storage.fs_store import FSStore


@pytest.fixture
def index_env(tmp_path, monkeypatch):
    store = FSStore(tmp_path / 'data')
    store.ensure_project('p', '隔离世界验收')
    monkeypatch.setitem(sys.modules, 'main', SimpleNamespace(store=store))
    from routers import material_index, projects
    app = FastAPI()
    for module in [material_index, projects]:
        app.include_router(module.router)
        if hasattr(module, 'get_store'):
            app.dependency_overrides[module.get_store] = lambda: store
    with TestClient(app) as client:
        yield store, client


@pytest.fixture
def library_env(index_env):
    store, client = index_env
    from routers import world_library
    client.app.include_router(world_library.router)
    if hasattr(world_library, 'get_store'):
        client.app.dependency_overrides[world_library.get_store] = lambda: store
    return store, client


def card(store, identity, kind, payload, *, tags=(), links=()):
    value = {'id': identity, 'type': kind, 'title': payload.get('name') or identity,
             'tags': list(tags), 'links': list(links), 'payload': payload}
    store.write_yaml('p', f'cards/{identity}.yaml', value)
    return value


def result(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def formal_bytes(store, project='p'):
    root = store._project_dir(project)
    return {str(path.relative_to(root)): path.read_bytes() for name in ['cards', 'canon', 'drafts']
            for path in store._safe_path(project, name).rglob('*') if path.is_file()}


def png_bytes(color=(40, 100, 140)):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00' + bytes(color))) + chunk(b'IEND', b'')


def world_fixture(store, *, with_map=False):
    world = card(store, 'world_1', 'world', {'name': '青丘', 'rules': ['每夜闭门'], 'summary': '原世界'}, links=['north'])
    card(store, 'north', 'world', {'name': '北岸', 'entry_type': 'place', 'parent_id': 'world_1', 'summary': '河流北岸'})
    author = AuthorDataService(store)
    author.create_relationship('p', {'label': '水路相通', 'participants': [{'entity_id': 'world_1'}, {'entity_id': 'north'}]})
    author.add_stage('p', 'world', 'north', {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 1930}},
        'changes': {'summary': '1930年的北岸开放'}, 'source': {'kind': 'author'}})
    if with_map:
        from services.material_import_service import MaterialImportService
        card(store, 'bridge', 'world', {'name': '渡船', 'entry_type': 'place', 'parent_id': 'world_1'})
        north = store.read_yaml('p', 'cards/north.yaml')
        north['payload']['material_ids'] = ['bridge']
        store.write_yaml('p', 'cards/north.yaml', north)
        batch = MaterialImportService(store).create('p', {'purpose': 'world', 'world_context': {'world_id': 'world_1'}}, raw=png_bytes(), filename='原图.png')
        world['payload']['maps'] = [{'id': 'original_map', 'title': '河港图', 'kind': 'map', 'coordinate_system': 'grid', 'scope': {'world_id': 'world_1'},
            'source': {'batch_id': batch['id'], 'source_id': batch['source']['id'], 'raw_path': batch['source']['raw_path'], 'version': batch['source']['version']},
            'hotspots': [{'id': 'north_pin', 'label': '北岸', 'coordinates': {'x': 40, 'y': 12}, 'display_position': {'x': 0.3, 'y': 0.7}, 'entity_id': 'north', 'status': 'confirmed'}]}]
        store.write_yaml('p', 'cards/world_1.yaml', world)
    return world


def test_index_chinese_short_names_ambiguity_and_versioned_ignore_do_not_edit_prose(index_env):
    store, client = index_env
    world_fixture(store)
    relations = result(client.get('/api/projects/p/material-index/search', params={'q': '水路相通', 'type': 'relationship'}))['items']
    assert len(relations) == 1 and 'outline_author_registry.yaml' in relations[0]['source']
    context = {'world_id': 'world_1'}
    for identity in ['person_a', 'person_b']:
        card(store, identity, 'character', {'name': '青', 'identity': '', 'aliases': ['小青'], 'world_context': context}, tags=['北方'])
    text = '小青在青丘等候。'
    store.write_md('p', 'drafts/chapter_001.md', text)
    store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': context})
    for query in ['青', '小青']:
        matches = result(client.get('/api/projects/p/material-index/search', params={'q': query, 'world_id': 'world_1'}))
        assert {'person_a', 'person_b'} <= {item['id'] for item in matches['items']}
    body = {'text': text, 'chapter_id': 'chapter_001', 'world_context': context,
            'source_revision': revision(store, 'p', 'drafts/chapter_001.md')}
    mentions = result(client.post('/api/projects/p/material-index/mentions', json=body))
    target = next(item for item in mentions['matches'] if item['text'] == '小青')
    assert target['start'] == 0 and target['end'] == 2 and target['status'] == 'ambiguous'
    assert {'person_a', 'person_b'} <= {item['id'] for item in target['candidates']}
    result(client.put('/api/projects/p/material-index/mention-choices', json={'target': 'drafts/chapter_001.md',
        'base_revision': body['source_revision'], 'choices': [{'text': '小青', 'start': 0, 'end': 2, 'ignore': True}]}))
    ignored = result(client.post('/api/projects/p/material-index/mentions', json=body))
    assert next(item for item in ignored['matches'] if item['text'] == '小青')['status'] == 'ignored'
    assert store.read_md('p', 'drafts/chapter_001.md') == text
    store.write_md('p', 'drafts/chapter_001.md', '后来，' + text)
    changed = result(client.post('/api/projects/p/material-index/mentions', json={**body, 'text': '后来，' + text,
        'source_revision': revision(store, 'p', 'drafts/chapter_001.md')}))
    assert next(item for item in changed['matches'] if item['text'] == '小青')['status'] == 'ambiguous'


def test_index_type_projection_preserves_author_tags_after_type_change(index_env):
    store, client = index_env
    value = card(store, 'subject', 'character', {'name': '北方', 'identity': ''}, tags=['人物', '北方'])
    old = result(client.get('/api/projects/p/material-index/search', params={'q': '北方'}))
    old_item = next(item for item in old['items'] if item['id'] == 'subject')
    assert '人物' in old_item['type_labels']
    value.update(type='world', payload={'name': '北方', 'entry_type': 'place', 'summary': '已改为地点资料'})
    store.write_yaml('p', 'cards/subject.yaml', value)
    latest = result(client.get('/api/projects/p/material-index/search', params={'q': '北方'}))
    item = next(item for item in latest['items'] if item['id'] == 'subject')
    assert item['type'] == 'place' and '人物' not in item['type_labels']
    assert item['tags'] == ['人物', '北方']
    tags = result(client.get('/api/projects/p/material-index/tags'))['items']
    assert any(item['label'] == '人物' and item['kind'] == 'author' for item in tags)


def test_sqlite_loss_corruption_and_failed_rebuild_preserve_authoritative_files(index_env, monkeypatch):
    store, client = index_env
    world = world_fixture(store)
    store.write_md('p', 'drafts/chapter_001.md', '作者正文保持。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
    pack = ContextPackService(store)
    _, report = pack.build('p', 'chapter_001', {'included_cards': [world], 'generation_control': {
        'world_context': {'world_id': 'world_1', 'time': {'year': 1940}}}}, {'场景': {}})
    result(client.post('/api/projects/p/material-index/rebuild'))
    database = store._safe_path('p', 'meta/material_index.sqlite3')
    before = formal_bytes(store)
    assert database.is_file()
    database.write_bytes(b'not a sqlite database')
    found = result(client.get('/api/projects/p/material-index/search', params={'q': '北岸'}))
    assert any(item['id'] == 'north' for item in found['items'])
    result(client.post('/api/projects/p/material-index/rebuild'))
    database.unlink()
    found = result(client.get('/api/projects/p/material-index/search', params={'q': '青丘'}))
    assert any(item['id'] == 'world_1' for item in found['items'])
    result(client.post('/api/projects/p/material-index/rebuild'))
    replace = Path.replace

    def fail_index_publish(source, target):
        if Path(target) == database:
            raise OSError('模拟新索引发布失败')
        return replace(source, target)

    with monkeypatch.context() as patch:
        patch.setattr(Path, 'replace', fail_index_publish)
        failed = result(client.post('/api/projects/p/material-index/rebuild'))
        assert failed['state'] in {'degraded', 'pending'} and failed.get('error')
    with sqlite3.connect(database) as connection:
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    found = result(client.get('/api/projects/p/material-index/search', params={'q': '北岸'}))
    assert any(item['id'] == 'north' for item in found['items'])
    assert formal_bytes(store) == before
    assert pack.sources_unchanged('p', report['source_versions'])


def test_index_world_and_branch_filters_share_only_pre_fork_material(index_env):
    store, client = index_env
    card(store, 'world_1', 'world', {})
    card(store, 'world_2', 'world', {})
    card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [
        {'id': 'fork', 'world_context': {'time': {'year': 1940}}}]})
    AuthorDataService(store).put_branches('p', 'world_1', {'branches': [{'id': 'alternate', 'label': '分歧走向',
        'parent_branch_id': 'main', 'fork_event_ref': {'owner_card_id': 'story_1', 'scene_id': 'fork'}}]})
    for identity, world, branch, year in [
        ('shared_old', 'world_1', 'main', 1930), ('main_future', 'world_1', 'main', 1950),
        ('alt_future', 'world_1', 'alternate', 1950), ('foreign', 'world_2', 'main', 1930),
    ]:
        card(store, identity, 'character', {'name': identity, 'identity': '秘密材料',
            'world_context': {'world_id': world, 'branch_id': branch, 'time': {'year': year}}})
    def ids(branch):
        return {item['id'] for item in result(client.get('/api/projects/p/material-index/search', params={
            'q': '秘密', 'world_id': 'world_1', 'branch_id': branch, 'year': 1960}))['items']}
    assert ids('alternate') == {'shared_old', 'alt_future'}
    assert ids('main') == {'shared_old', 'main_future'}


def test_private_library_adoption_is_idempotent_pinned_and_independent_of_source_updates(library_env):
    store, client = library_env
    world = world_fixture(store, with_map=True)
    card(store, 'legacy_b', 'character', {'name': '旧关系乙', 'identity': '', 'world_context': {'world_id': 'world_1'}})
    card(store, 'legacy_a', 'character', {'name': '旧关系甲', 'identity': '', 'world_context': {'world_id': 'world_1'},
        'relationships': [{'target': 'legacy_b', 'type': '护送', 'description': '只保留原来的一条有向关系'}],
        'detail_sections': [{'id': 'address_habit', 'title': '对同行人的态度', 'content': '对这位同行人讲话简短。',
            'usage': 'relevant', 'relationship_ids': ['legacy:legacy_a:relationships:0']}]})
    world['links'].append('legacy_a')
    from services.material_import_service import MaterialImportService
    text_source = MaterialImportService(store).create('p', {'purpose': 'world', 'world_context': {'world_id': 'world_1'}},
        raw='河港制度的原始文字。'.encode(), filename='制度.txt')
    world['payload']['sources'] = [{'kind': 'import', 'import_batch_id': text_source['id'], 'path': f"sessions/material_imports/{text_source['id']}.json",
        'version': text_source['source']['version'], 'quote': '河港制度的原始文字。'}]
    store.write_yaml('p', 'cards/world_1.yaml', world)
    store.write_md('p', 'assets/unrelated_private.txt', '不属于这个世界的个人文字')
    source = formal_bytes(store)
    source_all = {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
                  for path in store._project_dir('p').rglob('*') if path.is_file()}
    saved = result(client.post('/api/projects/p/world-library/save', json={'world_id': 'world_1', 'title': '我的河港',
        'base_revision': revision(store, 'p', 'cards/world_1.yaml')}))
    item = saved.get('item', saved)
    assert item['visibility'] == 'private' and item['prepared'] is True
    identity = quote(item['id'], safe='')
    result(client.post(f"/api/projects/{item['library_project_id']}/material-index/rebuild"))
    manifest = result(client.get('/api/world-library/' + identity))
    assert manifest['version'] == item['version']
    assert manifest['cards'] and manifest['stages'] and manifest['relationships']
    assert not any('unrelated_private.txt' in attachment['path'] for attachment in manifest['attachments'])
    store.write_md(item['library_project_id'], 'assets/another_unused.txt', '另一个未引用附件')
    assert result(client.get('/api/world-library/' + identity))['version'] == item['version']
    store.ensure_project('target', '采用实例')
    store._safe_path('target', 'cards/outline_author_registry.yaml').write_text(
        'id: outline_author_registry\ntype: outline\ntitle: 旧YAML关系\npayload:\n  relationship_registry: []\n', encoding='utf-8')
    north_id = next(card['id'] for card in manifest['cards'] if card.get('payload', {}).get('name') == '北岸')
    body = {'project_id': 'target', 'version': item['version'], 'request_id': 'fixed_adoption', 'selected_ids': [north_id]}
    result(client.post('/api/world-library/' + identity + '/adopt', json={**body, 'request_id': 'empty_selection', 'selected_ids': []}), 400)
    adopted = result(client.post('/api/world-library/' + identity + '/adopt', json=body))
    before_retry = formal_bytes(store, 'target')
    repeated = result(client.post('/api/world-library/' + identity + '/adopt', json=body))
    assert repeated['adoption_id'] == adopted['adoption_id'] and formal_bytes(store, 'target') == before_retry
    result(client.post('/api/world-library/' + identity + '/adopt', json={**body, 'title': '同编号不能换另一项选择'}), 409)
    assert formal_bytes(store, 'target') == before_retry
    assert formal_bytes(store) == source
    world = store.read_yaml('target', f"cards/{adopted['world_id']}.yaml")
    assert world['payload']['rules'] == ['每夜闭门']
    assert adopted['added_dependencies']
    assert all(link in adopted['card_ids'] for link in world.get('links', []))
    north = next(store.read_yaml('target', f'cards/{card_id}.yaml') for card_id in adopted['card_ids']
                 if store.read_yaml('target', f'cards/{card_id}.yaml').get('payload', {}).get('name') == '北岸')
    assert north['payload']['parent_id'] == adopted['world_id']
    relationships = AuthorDataService(store).relationships('target')
    assert relationships and all(person['entity_id'] in adopted['card_ids'] for row in relationships for person in row['participants'])
    legacy_a = next(store.read_yaml('target', f'cards/{identity}.yaml') for identity in adopted['card_ids']
                    if store.read_yaml('target', f'cards/{identity}.yaml').get('payload', {}).get('name') == '旧关系甲')
    legacy_id = f"legacy:{legacy_a['id']}:relationships:0"
    assert legacy_a['payload']['detail_sections'][0]['relationship_ids'] == [legacy_id]
    assert len(legacy_a['payload']['relationships']) == 1
    assert len([row for row in relationships if row['id'].startswith('legacy:')]) == 1
    registry = store.read_yaml('target', 'cards/outline_author_registry.yaml')['payload']['relationship_registry']
    assert len(registry) == 1 and registry[0]['label'] == '水路相通'
    stages = store.read_jsonl('target', 'canon/author_stages.jsonl')
    assert stages and all(row['entity_id'] in adopted['card_ids'] and row['scope']['world_id'] == adopted['world_id'] for row in stages)
    from services.world_map_material_service import validate_maps
    validate_maps(store, 'target', world)
    image = world['payload']['maps'][0]
    assert image['hotspots'][0]['entity_id'] == north['id']
    assert image['scope']['world_id'] == adopted['world_id']
    assert store._safe_path('target', image['source']['raw_path']).read_bytes() == png_bytes()
    capsule = MaterialImportService(store).get('target', image['source']['batch_id'])
    assert any(source['id'] == image['source']['source_id'] for source in capsule['sources'])
    imported_source = world['payload']['sources'][0]
    text_capsule = MaterialImportService(store).get('target', imported_source['import_batch_id'])
    assert text_capsule['source']['original_text'] == '河港制度的原始文字。'
    assert store._safe_path('target', imported_source['path']).is_file()
    world['payload']['summary'] = '只改当前实例'
    store.write_yaml('target', f"cards/{world['id']}.yaml", world)
    diff = result(client.get('/api/projects/target/world-library/diff', params={'world_id': world['id']}))
    assert not diff['changed'] and diff['current_source_version'] == item['version']
    library_project = item['library_project_id']
    original_world = store.read_yaml(library_project, f"cards/{item['world_id']}.yaml")
    original_world['payload']['rules'] = ['新版源资料规则']
    store.write_yaml(library_project, f"cards/{item['world_id']}.yaml", original_world)
    diff = result(client.get('/api/projects/target/world-library/diff', params={'world_id': world['id']}))
    assert diff['changed'] and diff['latest_source_version'] != item['version']
    assert store.read_yaml('target', f"cards/{world['id']}.yaml")['payload'] == world['payload']
    result(client.post('/api/world-library/' + identity + '/adopt', json={**body, 'request_id': 'stale_version'}), 409)
    assert formal_bytes(store) == source
    assert {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
            for path in store._project_dir('p').rglob('*') if path.is_file()} == source_all


def test_adoption_lock_preflight_and_interrupted_journal_never_overwrite_new_author_edits(library_env, monkeypatch):
    store, client = library_env
    world_fixture(store)
    item = result(client.post('/api/projects/p/world-library/save', json={'world_id': 'world_1', 'title': '事务验收',
        'base_revision': revision(store, 'p', 'cards/world_1.yaml')}))
    from services.world_library_service import WorldLibraryService
    from services.author_control_service import AuthorControlService
    service = WorldLibraryService(store)
    store.ensure_project('locked', '已有关系锁')
    store.write_yaml('locked', 'cards/outline_author_registry.yaml', {'id': 'outline_author_registry', 'type': 'outline', 'title': '关系', 'payload': {'relationship_registry': []}})
    AuthorControlService(store).confirm('locked', {'targets': [{'target': 'cards/outline_author_registry.yaml',
        'paths': ['/payload/relationship_registry'], 'base_revision': revision(store, 'locked', 'cards/outline_author_registry.yaml')}]})
    saved = formal_bytes(store, 'locked')
    with pytest.raises(FileExistsError):
        service.adopt(item['id'], {'project_id': 'locked', 'version': item['version'], 'request_id': 'locked_attempt'})
    assert formal_bytes(store, 'locked') == saved
    for edited in [False, True]:
        target = 'edited' if edited else 'clean'
        store.ensure_project(target, '中断后恢复')
        replace, publications = Path.replace, []

        def fail_second_card(source, destination):
            if Path(destination).parent == store._safe_path(target, 'cards'):
                publications.append(Path(destination))
                if len(publications) == 2:
                    raise OSError('模拟第二卡发布失败')
            return replace(source, destination)

        request_id = 'adopt_' + target
        with monkeypatch.context() as patch:
            patch.setattr(Path, 'replace', fail_second_card)
            with pytest.raises(OSError, match='第二卡'):
                service.adopt(item['id'], {'project_id': target, 'version': item['version'], 'request_id': request_id})
        journal = store.read_json(target, f'sessions/world_library/{request_id}.json')
        assert journal['status'] == 'applying' and len(publications) == 2
        if edited:
            path = publications[0]
            value = store.read_yaml(target, 'cards/' + path.name)
            value.setdefault('payload', {})['summary'] = '作者在中断后手写的新版本'
            store.write_yaml(target, 'cards/' + path.name, value)
            before = formal_bytes(store, target)
            with pytest.raises(FileExistsError):
                service.recover_pending(target)
            assert formal_bytes(store, target) == before
        else:
            service.recover_pending(target)
            assert store.read_json(target, f'sessions/world_library/{request_id}.json')['status'] == 'adopted'
            before = formal_bytes(store, target)
            service.recover_pending(target)
            assert formal_bytes(store, target) == before


def test_public_catalog_excludes_private_and_raw_sources_cannot_be_adopted(library_env):
    store, client = library_env
    made = result(client.post('/api/world-library', json={'title': '私人的未整理材料'}))
    private = made.get('item', made)
    assert private['visibility'] == 'private'
    library_project = private['library_project_id']
    from services.material_import_service import MaterialImportService
    MaterialImportService(store).create(library_project, {'purpose': 'world', 'text': '尚未确认成卡的私人材料。'})
    public = result(client.get('/api/world-library', params={'visibility': 'public'}))['items']
    examples = [item for item in public if item['kind'] == 'prepared_example']
    assert len(examples) >= 5 and all(item['visibility'] == 'public' and item['prepared'] and item['entry_count'] > 0 for item in examples)
    assert all(item.get('library_project_id') != library_project for item in public)
    normal_projects = result(client.get('/api/projects'))
    assert all(item.get('id') != library_project and item.get('project_id') != library_project for item in normal_projects)
    raw = next(item for item in result(client.get('/api/world-library'))['items'] if item.get('library_project_id') == library_project)
    assert raw['kind'] == 'source_material' and raw['prepared'] is False
    result(client.post('/api/world-library/' + quote(raw['id'], safe='') + '/adopt', json={
        'project_id': 'p', 'version': raw['version'], 'request_id': 'raw_is_not_world'}), 400)


def test_adopted_history_freezes_source_clock_knowledge_and_quote_without_source_chapters(library_env):
    from services.information_service import InformationService
    from services.world_scope_service import WorldScopeService

    store, client = library_env
    card(store, 'world_1', 'world', {'name': '旧河港', 'entry_type': 'world'})
    for identity, name in [('person_a', '甲'), ('person_b', '乙')]:
        card(store, identity, 'character', {'name': name, 'identity': '起点身份', 'world_context': {'world_id': 'world_1'}})
    secret, claim = '甲秘密取走黄铜钥匙', '旧管家拿走黄铜钥匙'
    text = secret + '。甲却对乙说：' + claim + '。'
    store.write_md('p', 'drafts/chapter_001.md', text)
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
    store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': {'world_id': 'world_1', 'time': {'year': 1930}}})
    # This source owner is not a member of the world: only the referenced history belongs in the reusable capsule.
    card(store, 'source_story', 'story', {'logline': '原书整本计划不属于复用世界', 'character_storylines': [{'notes': '原书完整人物线'}], 'important_scenes': [
        {'id': 'earlier', 'title': '前一年的交接', 'world_context': {'world_id': 'world_1', 'time': {'year': 1929}}},
        {'title': '钥匙失踪', 'chapter': 'chapter_001', 'characters': ['person_a', 'person_b'], 'causal_scene_ids': ['earlier']},
    ]})
    anchor = {'owner_card_id': 'source_story', 'scene_id': 'index_1'}
    scope = {'world_id': 'world_1', 'time': {'event_ref': anchor, 'position': 'immediate_after'}}
    source = {'kind': 'chapter', 'chapter_id': 'chapter_001', 'path': 'drafts/chapter_001.md', 'quote': secret}
    author = AuthorDataService(store)
    author.add_stage('p', 'character', 'person_b', {'status': 'confirmed', 'scope': scope,
        'changes': {'identity': '1930年受命守门'}, 'source': source})
    store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'key_fact', 'value': secret, 'entity_id': 'world_1',
        'scope': 'world_state', 'world_context': {'world_id': 'world_1'}, 'public': True, 'event_ref': anchor, 'evidence': source})
    information = InformationService(store)
    information.save('p', {'id': 'key_info', 'label': '钥匙去向', 'truth_status': 'confirmed', 'fact_ref': 'key_fact',
        'scope': {'world_id': 'world_1'}, 'sources': [source]})
    for kind, data in [
        ('occurrence', {'value': secret}),
        ('expression', {'value': claim, 'speaker_id': 'person_a', 'heard_by': ['person_b'], 'audience_ids': ['person_b'], 'intent': 'lie'}),
    ]:
        row = information.add_record('p', 'key_info', {'record_type': kind, 'status': 'confirmed', 'scope': scope, 'source': source, 'data': data})
    information.add_record('p', 'key_info', {'record_type': 'awareness', 'status': 'confirmed', 'scope': scope, 'source': source,
        'data': {'value': claim, 'character_id': 'person_b', 'state': 'believes', 'expression_ref': row['id'], 'basis': '听甲陈述'}})
    information.add_record('p', 'key_info', {'record_type': 'reader_disclosure', 'status': 'confirmed',
        'scope': {'world_id': 'world_1'}, 'source': source, 'data': {'value': secret, 'chapter_id': 'chapter_001',
        'start': 0, 'end': len(secret), 'mode': 'shown', 'source_revision': revision(store, 'p', 'drafts/chapter_001.md')}})
    source_bytes = {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
                    for path in store._project_dir('p').rglob('*') if path.is_file()}
    saved = result(client.post('/api/projects/p/world-library/save', json={'world_id': 'world_1', 'title': '1930年的河港'}))
    store.ensure_project('target', '2099年的新书')
    store.write_md('target', 'drafts/chapter_001.md', '新作品2099年的独立正文。')
    store.write_md('target', 'drafts/.chapter_order', 'chapter_001')
    store.write_json('target', 'drafts/chapter_001.meta.json', {'world_context': {'time': {'year': 2099}}})
    target_chapters = {path.name: path.read_bytes() for path in store._safe_path('target', 'drafts').iterdir() if path.is_file()}
    adopted = result(client.post('/api/world-library/' + quote(saved['id'], safe='') + '/adopt', json={
        'project_id': 'target', 'version': saved['version'], 'request_id': 'history_without_live_chapters'}))
    cards = [store.read_yaml('target', f'cards/{identity}.yaml') for identity in adopted['card_ids']]
    person_b = next(item['id'] for item in cards if item['type'] == 'character' and item['payload']['name'] == '乙')
    history = next(item for item in cards if item['payload'].get('library_history_anchor'))
    assert history['type'] == 'outline' and 'logline' not in history['payload'] and 'character_storylines' not in history['payload']
    assert any(item['path'].startswith('assets/') and store._safe_path('target', item['path']).is_file() for item in history['payload']['sources'])
    scenes = history['payload']['important_scenes']
    assert {scene['id'] for scene in scenes} == {'earlier', 'index_1'}
    event = next(scene for scene in scenes if scene['id'] == 'index_1')
    assert event['world_context']['time']['year'] == 1930 and 'chapter' not in event
    assert event['causal_scene_ids'] == ['earlier']
    stages = store.read_jsonl('target', 'canon/author_stages.jsonl')
    assert stages and all(row.get('record_type') != 'reader_disclosure' for row in stages)
    assert all(row['scope']['time']['year'] == 1930 and not row['scope'].get('chapter_id') for row in stages)
    changed = next(row for row in stages if row['entity_type'] == 'character')
    assert changed['scope']['time']['event_ref']['owner_card_id'] == history['id']
    evidence = changed['source']
    assert evidence['path'].startswith('assets/') and '/world_library_sources/' in evidence['path'] and 'chapter_id' not in evidence
    assert evidence['source_chapter_id'] == 'chapter_001' and evidence['source_quote_verified'] is True
    assert secret in store.read_md('target', evidence['path'])
    early = {'world_id': adopted['world_id'], 'time': {'year': 1920}, 'pov_character_id': person_b}
    later = {**early, 'time': {'year': 1940}}
    assert AuthorDataService(store).character_state('target', person_b, world_context=early)['state']['identity'] == '起点身份'
    assert AuthorDataService(store).character_state('target', person_b, world_context=later)['state']['identity'] == '1930年受命守门'
    item = InformationService(store).state('target', world_context=later)['items'][0]
    assert item['truth_value'] == secret and item['awareness'][0]['data']['value'] == claim
    assert item['awareness'][0]['data']['state'] == 'believes' and not item['reader_disclosures']
    assert item['awareness'][0]['data']['expression_ref'] == item['expressions'][0]['id']
    information_source = item['sources'][0]
    assert information_source['kind'] == 'world_library_source' and 'chapter_id' not in information_source
    assert information_source['source_chapter_id'] == 'chapter_001' and secret in store.read_md('target', information_source['path'])
    materials = InformationService(store).materials('target', later, actor_ids=[person_b], information_ids=[item['id']])
    assert claim in str(materials) and secret not in str(materials)
    before_materials = InformationService(store).materials('target', early, actor_ids=[person_b], information_ids=[item['id']])
    assert claim not in str(before_materials) and secret not in str(before_materials)
    fact = store.read_jsonl('target', 'canon/facts.jsonl')[0]
    assert fact['scope']['time']['year'] == 1930 and 'chapter_id' not in fact['evidence']
    assert fact['evidence']['path'].startswith('assets/') and secret in store.read_md('target', fact['evidence']['path'])
    assert not WorldScopeService(store).fact_visible('target', fact, early)
    assert WorldScopeService(store).fact_visible('target', fact, {key: value for key, value in later.items() if key != 'pov_character_id'})
    assert {path.name: path.read_bytes() for path in store._safe_path('target', 'drafts').iterdir() if path.is_file()} == target_chapters
    assert {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
            for path in store._project_dir('p').rglob('*') if path.is_file()} == source_bytes
