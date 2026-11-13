"""High-risk author data regressions; every store is isolated from real projects."""
import copy
import asyncio
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import zipfile
import hashlib
from contextlib import nullcontext
from email.message import Message

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import cards, drafts
from services.change_suggestion_service import ChangeSuggestionService
from services.kb_service import KBService
from services.author_data_service import AuthorDataService
from services.world_scope_service import WorldScopeService
from services.context_pack_service import ContextPackService
from services.material_import_service import MaterialImportService
from services.authoring_service import AuthoringService
from services.style_service import StyleService
from services import change_suggestion_service as change_module
from services import material_import_service as import_module
from services import material_reader_service as reader_module
from services import llm_gateway as gateway_module
from services.token_usage import summarize_usage
from services.editing_service import create_patch_review
from services.scene_rehearsal_service import SceneRehearsalService
from services.knowledge_graph_service import KnowledgeGraphService
from storage.fs_store import FSStore


@pytest.fixture
def store(tmp_path, monkeypatch):
    value = FSStore(tmp_path / 'data')
    value.ensure_project('p', '隔离验收')
    # A lazy router import must never bootstrap the real main/data directory.
    monkeypatch.setitem(sys.modules, 'main', SimpleNamespace(store=value))
    return value


def card(store, card_id, kind, payload):
    value = {'id': card_id, 'type': kind, 'title': card_id, 'tags': [], 'links': [], 'payload': payload}
    store.write_yaml('p', f'cards/{card_id}.yaml', value)
    return value


def suggestion_service(store, complete):
    manager = SimpleNamespace(store=store, _resolve_profile=lambda *args: (
        'isolated', {'provider': 'ollama', 'model': 'fake', 'base_url': 'http://not-called.invalid'}, None))
    authoring = AuthoringService(manager)
    authoring.complete = complete
    return ChangeSuggestionService(store, authoring)


def test_card_prose_and_meta_stale_tabs_return_409_without_overwriting(store):
    card(store, 'person_a', 'character', {'name': '甲', 'relationships': []})
    store.write_md('p', 'drafts/chapter_001.md', '作者原稿。')
    store.write_json('p', 'drafts/chapter_001.meta.json', {'chapter_id': 'chapter_001', 'title': '原章名'})
    app = FastAPI()
    app.include_router(cards.router)
    app.include_router(drafts.router)
    app.dependency_overrides[cards.get_store] = lambda: store
    app.dependency_overrides[cards.get_change_service] = lambda: ChangeSuggestionService(store)
    app.dependency_overrides[drafts.get_store] = lambda: store
    app.dependency_overrides[drafts.get_kb] = lambda: KBService(store)
    with TestClient(app) as client:
        url = '/api/projects/p/cards/person_a'
        original = client.get(url).json()
        first = client.put(url, json={**original, 'title': '先保存的标题'})
        assert first.status_code == 200
        saved = store._safe_path('p', 'cards/person_a.yaml').read_bytes()
        assert first.json()['_revision'] != original['_revision']
        stale = client.put(url, json={**original, 'title': '旧页覆盖'})
        assert stale.status_code == 409
        assert store._safe_path('p', 'cards/person_a.yaml').read_bytes() == saved
        assert '_revision' not in store.read_yaml('p', 'cards/person_a.yaml')

        url = '/api/projects/p/drafts/chapter_001'
        original = client.get(url).json()
        assert client.put(url, json={'base_revision': original['revision'], 'content': '作者新稿。'}).status_code == 200
        saved = store._safe_path('p', 'drafts/chapter_001.md').read_bytes()
        snapshots = copy.deepcopy(store.read_json('p', 'drafts/chapter_001.meta.json')['versions'])
        assert client.put(url, json={'base_revision': original['revision'], 'content': '旧模型结果。'}).status_code == 409
        assert store._safe_path('p', 'drafts/chapter_001.md').read_bytes() == saved
        assert store.read_json('p', 'drafts/chapter_001.meta.json')['versions'] == snapshots

        url += '/meta'
        original = client.get(url).json()
        assert client.put(url, json={**original, 'title': '新章名'}).status_code == 200
        saved = store._safe_path('p', 'drafts/chapter_001.meta.json').read_bytes()
        assert client.put(url, json={**original, 'title': '旧页章名'}).status_code == 409
        assert store._safe_path('p', 'drafts/chapter_001.meta.json').read_bytes() == saved
        assert '_revision' not in store.read_json('p', 'drafts/chapter_001.meta.json')
        current = client.get(url.removesuffix('/meta')).json()
        assert client.put(url, json={**current['meta'], 'title': '另一页更新元信息'}).status_code == 200
        saved_meta = store._safe_path('p', 'drafts/chapter_001.meta.json').read_bytes()
        saved_prose = store._safe_path('p', 'drafts/chapter_001.md').read_bytes()
        stale_meta = client.put(url.removesuffix('/meta'), json={'content': current['content'],
            'base_revision': current['revision'], 'meta_revision': current['meta']['_revision'], 'title': '旧元信息回写'})
        assert stale_meta.status_code == 409
        assert store._safe_path('p', 'drafts/chapter_001.meta.json').read_bytes() == saved_meta
        assert store._safe_path('p', 'drafts/chapter_001.md').read_bytes() == saved_prose


def test_world_inheritance_state_knowledge_and_age_follow_time_not_chapter_order(store):
    card(store, 'world_1', 'world', {'rules': ['港口归所有人共有']})
    card(store, 'person_a', 'character', {'name': '甲', 'identity': '学徒', 'initial_age': 20,
         'initial_age_time': {'year': 2000}, 'world_context': {'world_id': 'world_1'}})
    card(store, 'style_001', 'style', {'style_guide': {'pov': '第三人称'}})
    card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1', 'time': {'year': 2000},
         'local_adjustments': '故事基础'}, 'important_scenes': [{'id': 'arrival', 'pov': '甲的第一人称', 'world_context': {'time': {'year': 2025}}}]})
    store.write_md('p', 'drafts/.chapter_order', 'chapter_later\nchapter_earlier\n')
    for chapter, year in [('chapter_later', 2020), ('chapter_earlier', 2005)]:
        store.write_json('p', f'drafts/{chapter}.meta.json', {'story_card_id': 'story_1', 'pov': '第三人称近距离',
                         'pov_character_id': 'person_a', 'world_context': {'time': {'year': year}}})
    originals = {name: store._safe_path('p', f'cards/{name}.yaml').read_bytes() for name in ['world_1', 'person_a']}
    service = AuthorDataService(store)
    for year, rule in [(2018, '高架港口'), (2004, '运河港口')]:
        service.add_stage('p', 'world', 'world_1', {'scope': {'world_id': 'world_1', 'time': {'year': year}},
                          'status': 'confirmed', 'changes': {'transport': rule}, 'source': {'kind': 'author_confirmed'}})
    service.add_stage('p', 'character', 'person_a', {'scope': {'world_id': 'world_1', 'time': {'year': 2015}},
        'status': 'confirmed', 'changes': {'identity': '领航员'}, 'source': {'kind': 'author_confirmed'},
        'knowledge': [{'value': '暗门口令', 'known_by': ['person_a'], 'learned_at': {'year': 2018}},
                      {'value': '仅乙知道的秘密', 'known_by': ['person_b']}]})
    early = service.author_state('p', chapter_id='chapter_earlier')
    later = service.author_state('p', chapter_id='chapter_later')
    assert early['worlds'][0]['state']['transport'] == '运河港口'
    assert later['worlds'][0]['state']['transport'] == '高架港口'
    assert early['worlds'][0]['base']['id'] == later['worlds'][0]['base']['id'] == 'world_1'
    assert early['characters'][0]['state']['identity'] == '学徒'
    assert early['characters'][0]['age']['value'] == 25
    assert later['characters'][0]['age']['value'] == 40
    assert [item['value'] for item in later['characters'][0]['knowledge']] == ['暗门口令']
    mid = service.character_state('p', 'person_a', world_context={'world_id': 'world_1', 'time': {'year': 2016}})
    assert mid['state']['identity'] == '领航员' and mid['knowledge'] == []
    scene = service.world.resolve('p', chapter_id='chapter_later', event_ref='story_1:important_scenes:arrival')
    assert scene['scope']['time']['year'] == 2025
    assert scene['scope']['local_adjustments'] == '故事基础'
    assert scene['inherited_from']['time.year'].startswith('cards/story_1.yaml#payload.important_scenes')
    assert scene['narrative_pov'] == '甲的第一人称' and scene['scope']['pov_character_id'] == 'person_a'
    explicit = service.world.resolve('p', chapter_id='chapter_later', event_ref='story_1:important_scenes:arrival', pov='本次第三人称')
    assert explicit['narrative_pov'] == '本次第三人称' and explicit['inherited_from']['narrative_pov'] == 'request.pov'
    unspecified = service.world.resolve('p', story_card_id='story_1', pov='甲的第一人称')
    assert 'pov_character_id' not in unspecified['scope'] and unspecified['warnings']
    unknown = service.character_state('p', 'person_a', world_context={'world_id': 'world_1'})
    assert unknown['state']['identity'] == '学徒' and unknown['knowledge'] == []
    assert unknown['age']['value'] is None and unknown['uncertainties']
    for name, content in originals.items():
        assert store._safe_path('p', f'cards/{name}.yaml').read_bytes() == content


def test_fork_only_inherits_pre_fork_history_and_unknown_phase_is_conservative(store):
    card(store, 'world_1', 'world', {'rules': ['基础不变']})
    card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [
        {'id': 'old'}, {'id': 'fork'}, {'id': 'later'}]})
    service = AuthorDataService(store)
    refs = {name: {'owner_card_id': 'story_1', 'scene_id': name} for name in ['old', 'fork', 'later']}
    service.put_branches('p', 'world_1', {'branches': [{'id': 'alternate', 'label': '另一走向',
        'parent_branch_id': 'main', 'fork_event_ref': refs['fork']}]})
    for stage_id, branch, event, changes in [
        ('shared', 'main', 'old', {'shared': '分歧前共同历史'}),
        ('main_only', 'main', 'later', {'main_secret': '主分支后续'}),
        ('alt_only', 'alternate', 'later', {'alt_secret': '另一分支后续'}),
    ]:
        service.add_stage('p', 'world', 'world_1', {'id': stage_id, 'status': 'confirmed', 'source': {'kind': 'author_confirmed'},
            'scope': {'world_id': 'world_1', 'branch_id': branch, 'time': {'event_ref': refs[event], 'position': 'before'}}, 'changes': changes})
    service.add_stage('p', 'world', 'world_1', {'id': 'remote_phase', 'status': 'confirmed', 'source': {'kind': 'author_confirmed'},
        'scope': {'world_id': 'world_1', 'time': {'event_ref': refs['fork'], 'position': 'phase', 'phase': '多年之后'}},
        'changes': {'remote': '不是刚结束'}})
    main = service.author_state('p', event_ref=refs['later'])['worlds'][0]['state']
    alternate = service.author_state('p', event_ref=refs['later'], branch_id='alternate')['worlds'][0]['state']
    assert main['shared'] == alternate['shared'] == '分歧前共同历史'
    assert 'main_secret' in main and 'alt_secret' not in main
    assert 'alt_secret' in alternate and 'main_secret' not in alternate
    immediate = service.author_state('p', world_context={'world_id': 'world_1', 'time': {'event_ref': refs['fork'], 'position': 'immediate_after'}})
    assert 'remote' not in immediate['worlds'][0]['state']
    with pytest.raises(ValueError, match='阶段'):
        WorldScopeService(store).resolve('p', world_context={'world_id': 'world_1', 'time': {'event_ref': refs['fork'], 'position': 'phase'}})


def test_four_participant_relationship_is_one_record_with_directed_addresses_and_stages(store):
    originals = {}
    for name in ['a', 'b', 'c', 'd']:
        card(store, f'person_{name}', 'character', {'name': name, 'relationships': []})
        originals[name] = store._safe_path('p', f'cards/person_{name}.yaml').read_bytes()
    card(store, 'world_1', 'world', {})
    service = AuthorDataService(store)
    participants = [{'entity_id': 'person_a', 'role': '新成员', 'addresses': [{'target_id': 'person_b', 'address_as': '队长'}]},
                    {'entity_id': 'person_b', 'role': '领队'}, {'entity_id': 'person_c', 'role': '向导'}, {'entity_id': 'person_d', 'role': '同行者'}]
    row = service.create_relationship('p', {'id': 'shared_team', 'label': '共同远行', 'direction': 'directed', 'participants': participants})
    assert len(service.relationships('p')) == 1
    assert row['participants'] == participants and row['direction'] == 'directed'
    stale = copy.deepcopy(row)
    updated = service.update_relationship('p', row['id'], {**row, 'notes': '四人都引用同一份关系'})
    with pytest.raises(FileExistsError):
        service.update_relationship('p', row['id'], {**stale, 'notes': '旧标签页覆盖'})
    assert service.relationship('p', row['id'])['notes'] == updated['notes']
    service.add_stage('p', 'relationship', row['id'], {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 2010}},
        'changes': {'label': '离散后的同伴'}, 'source': {'kind': 'author_confirmed'}})
    before = service.author_state('p', world_context={'world_id': 'world_1', 'time': {'year': 2005}})['relations']
    after = service.author_state('p', world_context={'world_id': 'world_1', 'time': {'year': 2015}})['relations']
    assert [item['id'] for item in before] == [item['id'] for item in after] == ['shared_team']
    assert before[0]['state']['label'] == '共同远行' and after[0]['state']['label'] == '离散后的同伴'
    assert after[0]['state']['participants'] == participants
    for name, content in originals.items():
        assert store._safe_path('p', f'cards/person_{name}.yaml').read_bytes() == content


def test_same_named_events_keep_identity_and_explicit_alias_updates_one_source(store):
    card(store, 'story_1', 'story', {'important_scenes': [
        {'id': 'first', 'scene': '同名相遇', 'summary': '第一次', 'rehearsal': {'text': '作者已确认安排'}},
        {'id': 'second', 'scene': '同名相遇', 'summary': '第二次', 'causal_scene_ids': ['first']},
        {'id': 'consequence', 'scene': '共同后果', 'causal_scene_ids': ['first', 'second']}]})
    card(store, 'outline_1', 'outline', {'story_card_id': 'story_1', 'important_scenes': [
        {'id': 'mapped', 'canonical_event_ref': {'owner_card_id': 'story_1', 'scene_id': 'first'}}]})
    service = AuthorDataService(store)
    rows = service.events('p', 'story_1')
    assert len(rows) == 4 and len({row['canonical_id'] for row in rows}) == 3
    assert any(row['duplicate_conflicts'] for row in rows if row['scene_id'] in {'first', 'second'})
    original = service.event('p', 'story_1', 'first')
    values = {**original['values'], 'summary': '改标题之外的同一事件内容'}
    service.update_event('p', 'outline_1', 'mapped', {'values': values, 'base_revision': original['_revision']})
    assert service.event('p', 'outline_1', 'mapped')['shared_values'] == values
    arrangement = SceneRehearsalService(store).get('p', 'outline_1', 'mapped')
    assert arrangement['owner_card_id'] == 'story_1' and arrangement['scene_id'] == 'first'
    graph = KnowledgeGraphService(store).graph('p')
    assert any(edge['label'] == '同一事件的来源映射' and edge['target'] == 'story_1:important_scenes:first' for edge in graph['edges'])
    saved = store.read_yaml('p', 'cards/story_1.yaml')['payload']['important_scenes']
    assert len(saved) == 3 and saved[0]['rehearsal']['text'] == '作者已确认安排'
    assert saved[1]['summary'] == '第二次' and saved[1]['causal_scene_ids'] == ['first']
    assert saved[2]['causal_scene_ids'] == ['first', 'second']
    with pytest.raises(FileExistsError):
        service.update_event('p', 'story_1', 'first', {'values': original['values'], 'base_revision': original['_revision']})


def test_stage_correction_keeps_history_but_removes_superseded_knowledge(store):
    card(store, 'world_1', 'world', {})
    card(store, 'person_a', 'character', {'name': '甲', 'identity': '学徒'})
    original = store._safe_path('p', 'cards/person_a.yaml').read_bytes()
    service = AuthorDataService(store)
    scope = {'world_id': 'world_1', 'time': {'year': 2010}}
    service.add_stage('p', 'character', 'person_a', {'id': 'mistaken', 'scope': scope, 'status': 'confirmed',
        'changes': {'identity': '船长'}, 'knowledge': [{'value': '误记的暗号'}], 'source': {'kind': 'author_confirmed'}})
    history = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    service.add_stage('p', 'character', 'person_a', {'id': 'corrected', 'supersedes': 'mistaken', 'scope': scope,
        'status': 'confirmed', 'changes': {'identity': '领航员'}, 'knowledge': [], 'source': {'kind': 'author_correction'}})
    current = service.character_state('p', 'person_a', world_context=scope)
    assert current['state']['identity'] == '领航员' and current['knowledge'] == []
    assert [row['id'] for row in current['changes']] == ['corrected']
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes().startswith(history)
    assert len(service.stages('p', 'character', 'person_a')) == 2
    assert store._safe_path('p', 'cards/person_a.yaml').read_bytes() == original


def test_prompt_pack_excludes_sibling_future_and_other_pov_knowledge_and_guards_stages(store):
    world = card(store, 'world_1', 'world', {'rules': ['保留共同基础']})
    people = [card(store, f'person_{name}', 'character', {'name': name, 'identity': '初始人物',
              'world_context': {'world_id': 'world_1'}}) for name in ['a', 'b']]
    card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [
        {'id': 'old'}, {'id': 'fork'}, {'id': 'later'}]})
    refs = {name: {'owner_card_id': 'story_1', 'scene_id': name} for name in ['old', 'fork', 'later']}
    service = AuthorDataService(store)
    service.put_branches('p', 'world_1', {'branches': [
        {'id': name, 'parent_branch_id': 'main', 'fork_event_ref': refs['fork']} for name in ['alternate', 'sibling']]})
    _, empty_report = ContextPackService(store).build('p', 'chapter_flashback',
        {'generation_control': {'world_context': {'world_id': 'world_1'}}}, {'场景': {}})
    assert 'canon/author_stages.jsonl' in empty_report['source_versions']
    for person, text in [('a', '甲在分歧前已知的口令'), ('b', '乙专有秘密不应进入甲视角')]:
        service.add_stage('p', 'character', f'person_{person}', {'status': 'confirmed', 'source': {'kind': 'author_confirmed'},
            'scope': {'world_id': 'world_1', 'time': {'event_ref': refs['old'], 'position': 'before'}},
            'knowledge': [{'value': text, 'known_by': [f'person_{person}']}]})
    assert not ContextPackService(store).sources_unchanged('p', empty_report['source_versions'])
    for branch, event, position, text in [
        ('alternate', 'fork', 'before', '甲在本分支已成为领航员'),
        ('sibling', 'later', 'before', '兄弟分支身份不可泄露'),
        ('main', 'later', 'immediate_after', '未来身份不可泄露'),
    ]:
        service.add_stage('p', 'character', 'person_a', {'status': 'confirmed', 'source': {'kind': 'author_confirmed'},
            'scope': {'world_id': 'world_1', 'branch_id': branch, 'time': {'event_ref': refs[event], 'position': position}},
            'changes': {'identity': text}})
    scope = {'world_id': 'world_1', 'branch_id': 'alternate', 'time': {'event_ref': refs['later'], 'position': 'before'}}
    facts = [
        {'id': 'fact_old', 'statement': '分歧前公开事实', 'public': True, 'scope': {'world_id': 'world_1', 'time': {'event_ref': refs['old']}}},
        {'id': 'fact_future', 'statement': '未来事实不可泄露', 'public': True, 'scope': {'world_id': 'world_1', 'time': {'event_ref': refs['later'], 'position': 'immediate_after'}}},
        {'id': 'fact_unknown', 'statement': '未知时间事实不可泄露', 'public': True, 'scope': {'world_id': 'world_1'}},
    ]
    manifest = {'generation_control': {'story_card_id': 'story_1', 'world_context': scope, 'pov_character_id': 'person_a'},
                'included_cards': [world, *people], 'linked_materials': {'facts': facts}}
    pack = ContextPackService(store)
    text, report = pack.build('p', 'chapter_flashback', manifest, {'场景': {'cast': ['person_a', 'person_b']}})
    for expected in ['保留共同基础', '甲在分歧前已知的口令', '甲在本分支已成为领航员', '分歧前公开事实']:
        assert expected in text
    for forbidden in ['乙专有秘密不应进入甲视角', '兄弟分支身份不可泄露', '未来身份不可泄露', '未来事实不可泄露', '未知时间事实不可泄露']:
        assert forbidden not in text
    assert 'canon/author_stages.jsonl' in report['source_versions']
    assert pack.sources_unchanged('p', report['source_versions'])
    service.add_stage('p', 'world', 'world_1', {'status': 'planned', 'scope': {}, 'changes': {'summary': '生成期间的新记录'}, 'source': {'kind': 'author'}})
    assert not pack.sources_unchanged('p', report['source_versions'])


def test_import_retries_and_reimport_deduplicate_by_source_not_label(store):
    service = MaterialImportService(store)
    values = {'kind': 'character', 'label': '阿河', 'values': {'name': '阿河', 'identity': '船工'}, 'evidence': [{'quote': '阿河是船工。'}]}
    first = service.create('p', {'text': '阿河是船工。', 'purpose': 'story'})
    first = service.update('p', first['id'], {'base_revision': first['revision'], 'candidates': [
        {**values, 'id': 'candidate_a'}, {**values, 'id': 'candidate_b'}]})
    applied = service.apply('p', first['id'], {'base_revision': first['revision'], 'selected_ids': ['candidate_a', 'candidate_b']})
    targets = {item['target_id'] for item in applied['results']}
    assert len(targets) == 1
    paths = list(store._safe_path('p', 'cards').glob('*.yaml'))
    assert len(paths) == 1
    saved = paths[0].read_bytes()
    assert service.apply('p', first['id'], {'base_revision': first['revision'], 'selected_ids': ['candidate_a']})['status'] == 'applied'
    assert paths[0].read_bytes() == saved
    second = service.create('p', {'text': '阿河是船工。', 'purpose': 'story'})
    second = service.update('p', second['id'], {'base_revision': second['revision'], 'candidates': [{**values, 'id': 'candidate_c'}]})
    result = service.apply('p', second['id'], {'base_revision': second['revision'], 'selected_ids': ['candidate_c']})
    assert {item['target_id'] for item in result['results']} == targets
    assert len(list(store._safe_path('p', 'cards').glob('*.yaml'))) == 1
    assert paths[0].read_bytes() == saved
    assert service.get('p', first['id'])['source']['original_text'] == '阿河是船工。'


def test_interrupted_import_recovers_remaining_files_once(store, monkeypatch):
    service = MaterialImportService(store)
    work = service.create('p', {'text': '甲住在临港城。', 'purpose': 'world'})
    work = service.update('p', work['id'], {'base_revision': work['revision'], 'candidates': [
        {'id': 'person', 'kind': 'character', 'label': '甲', 'values': {'name': '甲'}},
        {'id': 'world', 'kind': 'world', 'label': '临港城', 'values': {'summary': '临港城'}}]})
    replace, calls = Path.replace, []

    def interrupt_second_card(path, target):
        if Path(target).parent.name == 'cards':
            calls.append(str(target))
            if len(calls) == 2:
                raise OSError('模拟第二个文件发布前中断')
        return replace(path, target)

    with monkeypatch.context() as patch:
        patch.setattr(Path, 'replace', interrupt_second_card)
        with pytest.raises(OSError, match='中断'):
            service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['person', 'world']})
    assert service.get('p', work['id'])['status'] == 'applying'
    assert len(list(store._safe_path('p', 'cards').glob('*.yaml'))) == 1
    MaterialImportService(store).recover_pending('p')
    recovered = service.get('p', work['id'])
    assert recovered['status'] == 'applied' and len(recovered['results']) == 2
    saved = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    assert len(saved) == 2
    assert store.read_json('p', 'sessions/material_imports/pending.json')['ids'] == []
    service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['person', 'world']})
    assert saved == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}


@pytest.mark.parametrize('edit_same_field', [False, True])
def test_import_undo_preserves_later_edits_and_reads_legacy_yaml(store, edit_same_field):
    path = store._safe_path('p', 'cards/person_a.yaml')
    path.write_text('id: person_a\ntype: character\ntitle: 阿河\npayload:\n  name: 阿河\n  voice: ""\n  appearance: 原衣着\n', encoding='utf-8')
    service = MaterialImportService(store)
    work = service.create('p', {'text': '阿河说话低沉。', 'purpose': 'story'})
    work = service.update('p', work['id'], {'base_revision': work['revision'], 'candidates': [
        {'id': 'voice', 'kind': 'character', 'target_id': 'person_a', 'label': '阿河', 'values': {'voice': '低沉'}}]})
    applied = service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['voice']})
    value = store.read_yaml('p', 'cards/person_a.yaml')
    value['payload']['voice' if edit_same_field else 'appearance'] = '作者后续手改'
    store.write_yaml('p', 'cards/person_a.yaml', value)
    saved = path.read_bytes()
    if edit_same_field:
        with pytest.raises(FileExistsError):
            service.undo('p', work['id'], {'base_revision': applied['revision']})
        assert path.read_bytes() == saved
    else:
        undone = service.undo('p', work['id'], {'base_revision': applied['revision']})
        assert undone['status'] == 'undone'
        restored = store.read_yaml('p', 'cards/person_a.yaml')['payload']
        assert restored['voice'] == '' and restored['appearance'] == '作者后续手改'


def test_ai_import_result_cannot_overwrite_a_work_draft_edited_while_waiting(store):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        restarted = asyncio.Event()

        class PausedAuthoring:
            calls = 0
            async def complete(self, *args, **kwargs):
                self.calls += 1
                if self.calls == 2:
                    restarted.set()
                    await asyncio.Event().wait()
                started.set()
                await release.wait()
                kwargs['usage_callback']({'module': 'setup_story', 'provider': 'fake', 'model': 'isolated',
                                          'prompt_tokens': 4, 'completion_tokens': 2, 'total_tokens': 6, 'estimated': True})
                return json.dumps({'candidates': [{'kind': 'character', 'values': {'name': '旧AI候选'}, 'evidence': [{'quote': '甲是船工。'}]}]}, ensure_ascii=False)

        service = MaterialImportService(store, PausedAuthoring())
        work = service.create('p', {'text': '甲是船工。', 'purpose': 'story'})
        pending = asyncio.create_task(service.extract('p', work['id'], {'base_revision': work['revision'], 'use_ai': True}))
        await asyncio.wait_for(started.wait(), timeout=2)
        current = service.get('p', work['id'])
        saved = service.update('p', work['id'], {'base_revision': current['revision'], 'cleaned_text': '作者等待期间修订。', 'candidates': []})
        newer = asyncio.create_task(service.extract('p', work['id'], {'base_revision': saved['revision'], 'use_ai': True}))
        await asyncio.wait_for(restarted.wait(), timeout=2)
        release.set()
        with pytest.raises(FileExistsError):
            await asyncio.wait_for(pending, timeout=2)
        latest = service.get('p', work['id'])
        assert latest['cleaned_text'] == '作者等待期间修订。' and latest['candidates'] == []
        assert latest['usage']['total_tokens'] == 6 and latest['usage_calls'][0]['import_attempt_status'] == 'stale'
        key = str(store._project_dir('p')) + ':' + work['id']
        assert import_module._TASKS.get(key) is newer
        service.cancel('p', work['id'])
        with pytest.raises(ValueError, match='取消'):
            await asyncio.wait_for(newer, timeout=2)
        assert key not in import_module._TASKS
        assert list(store._safe_path('p', 'cards').glob('*.yaml')) == []

    asyncio.run(scenario())


def test_material_file_reading_keeps_raw_scope_and_does_not_invent_image_text(store, monkeypatch):
    service = MaterialImportService(store)
    text = service.create('p', {'purpose': 'story'}, raw='故事摘要：渡口重逢。'.encode('utf-16'), filename='材料.txt')
    assert text['source']['original_text'] == '故事摘要：渡口重逢。'
    document = io.BytesIO()
    with zipfile.ZipFile(document, 'w') as archive:
        archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>临港城</w:t></w:r></w:p><w:p><w:r><w:t>规则未定</w:t></w:r></w:p></w:body></w:document>')
    raw = document.getvalue()
    word = service.create('p', {'purpose': 'world'}, raw=raw, filename='../材料.docx')
    assert word['source']['original_text'] == '临港城\n规则未定'
    assert word['source']['coverage'] == 'document_body_text' and word['source']['warnings']
    assert word['source']['filename'] == '材料.docx'
    assert store._safe_path('p', word['source']['raw_path']).read_bytes() == raw
    import struct
    import zlib
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    image = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', 1, 1, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\x00')) + chunk(b'IEND', b'')
    scan = service.create('p', {'purpose': 'world'}, raw=image, filename='不能凭文件名编规则.png')
    assert scan['source']['original_text'] == '' and scan['candidates'] == []
    assert scan['source']['coverage'] == 'needs_visual_reading'
    with pytest.raises(ValueError):
        service.create('p', {'purpose': 'world'}, raw=b'not a pdf', filename='伪造.pdf')
    html = '<html><title>书名不等于全文</title><p>请登录后阅读，仅可读取简介。</p><script>不应采集的脚本</script></html>'.encode()
    headers = Message()
    headers['Content-Type'] = 'text/html; charset=utf-8'
    page = SimpleNamespace(read=lambda size: html[:size], headers=headers, url='https://reference.invalid/login')
    opener = SimpleNamespace(open=lambda request, timeout: nullcontext(page))
    monkeypatch.setattr(reader_module.urllib.request, 'build_opener', lambda *args: opener)
    monkeypatch.setattr(reader_module.socket, 'getaddrinfo', lambda *args, **kwargs: [(2, 1, 6, '', ('8.8.8.8', 443))])
    reference = service.create('p', {'purpose': 'story', 'url': 'https://reference.invalid/chapter'})['source']
    assert reference['url'] == 'https://reference.invalid/chapter' and reference['final_url'].endswith('/login')
    assert reference['coverage'] == 'limited_page_text' and reference['warnings']
    assert '请登录后阅读' in reference['original_text'] and '不应采集的脚本' not in reference['original_text']
    assert reference['fetched_at'] and reference['version'] == hashlib.sha256(html).hexdigest()


def test_import_stage_undo_appends_compensation_without_rewriting_character_or_canon(store):
    card(store, 'world_1', 'world', {})
    card(store, 'person_a', 'character', {'name': '甲', 'identity': '学徒'})
    original = store._safe_path('p', 'cards/person_a.yaml').read_bytes()
    service = MaterialImportService(store)
    scope = {'world_id': 'world_1', 'time': {'year': 2010}}
    work = service.create('p', {'text': '甲在2010年成为领航员。', 'purpose': 'story'})
    work = service.update('p', work['id'], {'base_revision': work['revision'], 'candidates': [
        {'id': 'stage', 'kind': 'fact', 'label': '甲的变化', 'scope': scope,
         'values': {'entity_id': 'person_a', 'status': 'confirmed', 'changes': {'identity': '领航员'}}}]})
    applied = service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['stage']})
    author = AuthorDataService(store)
    assert author.character_state('p', 'person_a', world_context=scope)['state']['identity'] == '领航员'
    history = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    service.undo('p', work['id'], {'base_revision': applied['revision']})
    assert author.character_state('p', 'person_a', world_context=scope)['state']['identity'] == '学徒'
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes().startswith(history)
    assert any(row.get('kind') == 'void' for row in store.read_jsonl('p', 'canon/author_stages.jsonl'))
    assert store._safe_path('p', 'cards/person_a.yaml').read_bytes() == original


def test_import_scope_does_not_make_branch_specific_characters_global(store):
    card(store, 'world_1', 'world', {})
    card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [{'id': 'fork'}, {'id': 'later'}]})
    author = AuthorDataService(store)
    author.put_branches('p', 'world_1', {'branches': [{'id': 'alternate', 'parent_branch_id': 'main',
        'fork_event_ref': {'owner_card_id': 'story_1', 'scene_id': 'fork'}}]})
    scope = {'world_id': 'world_1', 'branch_id': 'alternate', 'time': {'event_ref': {'owner_card_id': 'story_1', 'scene_id': 'later'}}}
    service = MaterialImportService(store)
    work = service.create('p', {'text': '岔路分支才出现的人物。', 'purpose': 'story', 'world_context': scope})
    work = service.update('p', work['id'], {'base_revision': work['revision'], 'candidates': [
        {'id': 'branch_person', 'kind': 'character', 'values': {'name': '岔路人物'}, 'scope': scope}]})
    result = service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['branch_person']})
    target = result['results'][0]['target_id']
    assert target in {item['id'] for item in author.author_state('p', world_context=scope)['characters']}
    main = {**scope, 'branch_id': 'main'}
    assert target not in {item['id'] for item in author.author_state('p', world_context=main)['characters']}


def test_setting_suggestions_coalesce_once_partial_apply_and_safe_undo(store, monkeypatch):
    source = '阿河穿旧蓝衣。\n\n阿舟戴旧帽。'
    store.write_md('p', 'drafts/chapter_001.md', source)
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\n')
    calls = []

    async def complete(*args, **kwargs):
        calls.append(args)
        return json.dumps({'changes': [{'before': '阿河穿旧蓝衣。', 'after': '阿河穿红衣。'},
                                       {'before': '阿舟戴旧帽。', 'after': '阿舟戴新帽。'}]}, ensure_ascii=False)

    service = suggestion_service(store, complete)
    queued = []
    for cid, name in [('person_a', '阿河'), ('person_b', '阿舟')]:
        before = card(store, cid, 'character', {'name': name, 'appearance': '旧'})
        after = {**before, 'payload': {**before['payload'], 'appearance': '新'}}
        store.write_yaml('p', f'cards/{cid}.yaml', after)
        queued.extend(service.enqueue('p', cid, before, after)['task_ids'])
    assert len(queued) == 2
    monkeypatch.setitem(change_module._EDITED_AT, str(store._project_dir('p')), 0)
    asyncio.run(service.process('p', queued))
    ready = [row for row in service.list('p') if row['status'] == 'ready']
    assert len(calls) == len(ready) == 1 and len(ready[0]['setting_changes']) == 2
    task = ready[0]
    assert len(task['ops']) == 2
    first = task['ops'][0]
    assert source[first['start']:first['end']] == first['before']
    applied = service.apply('p', task['id'], accept_op_ids=[first['op_id']])
    assert applied['applied_text'] == '阿河穿红衣。\n\n阿舟戴旧帽。'
    assert store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
    store.write_md('p', 'drafts/chapter_001.md', applied['applied_text'] + '\n作者后来又写的内容。')
    saved = store.read_md('p', 'drafts/chapter_001.md')
    with pytest.raises(FileExistsError):
        service.undo('p', task['id'])
    assert store.read_md('p', 'drafts/chapter_001.md') == saved
    store.write_md('p', 'drafts/chapter_001.md', applied['applied_text'])
    assert service.undo('p', task['id'])['status'] == 'undone'
    assert store.read_md('p', 'drafts/chapter_001.md') == source


def test_cancel_setting_suggestion_cancels_the_actual_awaited_model_task(store, monkeypatch):
    async def scenario():
        started, cancelled = asyncio.Event(), asyncio.Event()

        async def complete(*args, **kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        service = suggestion_service(store, complete)
        source = '阿河穿旧蓝衣。'
        store.write_md('p', 'drafts/chapter_001.md', source)
        store.write_md('p', 'drafts/.chapter_order', 'chapter_001\n')
        before = card(store, 'person_a', 'character', {'name': '阿河', 'appearance': '旧蓝衣'})
        after = {**before, 'payload': {**before['payload'], 'appearance': '红衣'}}
        store.write_yaml('p', 'cards/person_a.yaml', after)
        queued = service.enqueue('p', 'person_a', before, after)['task_ids']
        assert len(queued) == 1
        monkeypatch.setitem(change_module._EDITED_AT, str(store._project_dir('p')), 0)
        running = asyncio.create_task(service.process('p', queued))
        await asyncio.wait_for(started.wait(), timeout=2)
        service.cancel('p', queued[0])
        await asyncio.wait_for(running, timeout=2)
        assert cancelled.is_set() and service.get('p', queued[0])['status'] == 'cancelled'
        assert store.read_md('p', 'drafts/chapter_001.md') == source
        assert not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
        assert (str(store._project_dir('p')), queued[0]) not in change_module._ACTIVE

    asyncio.run(scenario())


def test_stage_suggestions_are_current_idempotent_and_skip_future_chapters(store, monkeypatch):
    card(store, 'world_1', 'world', {})
    card(store, 'person_a', 'character', {'name': '阿河', 'identity': '学徒'})
    store.write_md('p', 'drafts/chapter_001.md', '阿河走进港口。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\n')
    store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': {'world_id': 'world_1', 'time': {'year': 2020}}})
    calls = []

    async def complete(*args, **kwargs):
        calls.append(args)
        return '{"changes":[]}'

    service, author = suggestion_service(store, complete), AuthorDataService(store)
    stage = author.add_stage('p', 'character', 'person_a', {'id': 'current_stage', 'status': 'confirmed',
        'scope': {'world_id': 'world_1', 'time': {'year': 2010}}, 'changes': {'identity': '领航员'}, 'source': {'kind': 'author'}})
    queued = service.enqueue_stage('p', 'character', 'person_a', stage)
    assert queued['queued_count'] == 1
    assert service.get('p', queued['task_ids'][0])['status'] == 'queued'
    count = len(service.list('p'))
    duplicate = service.enqueue_stage('p', 'character', 'person_a', stage)
    assert duplicate['task_ids'] == queued['task_ids'] and len(service.list('p')) == count
    monkeypatch.setitem(change_module._EDITED_AT, str(store._project_dir('p')), 0)
    asyncio.run(service.process('p', queued['task_ids']))
    assert len(calls) == 1 and service.get('p', queued['task_ids'][0])['status'] == 'unchanged'
    future = author.add_stage('p', 'character', 'person_a', {'id': 'future_stage', 'status': 'confirmed',
        'scope': {'world_id': 'world_1', 'time': {'year': 2030}}, 'changes': {'identity': '未来身份'}, 'source': {'kind': 'author'}})
    assert service.enqueue_stage('p', 'character', 'person_a', future)['queued_count'] == 0


def test_style_analysis_uses_selected_original_samples_and_returns_an_unsaved_candidate(store):
    card(store, 'style_1', 'style', {'tone': '作者自己的语气', 'style_guide': {'pov': '第一人称'}})
    original = store._safe_path('p', 'cards/style_1.yaml').read_bytes()
    kb, service = KBService(store), StyleService(store, KBService(store))
    with pytest.raises(ValueError, match='样本|原文'):
        service.analyze('p', 'style_1', [])
    sample = kb.upload_text('p', 'style_sample', '参考原文.txt', '我推开门。屋里很静。\n“回来了吗？”她问。')
    ai = kb.upload_text('p', 'style_sample', 'AI效果.txt', '这只是AI效果示例！')
    store.write_json('p', ai['saved_path'] + '.json', {'source_kind': 'ai_example'})
    result = service.analyze('p', 'style_1', [sample['asset_id'], sample['asset_id']])
    assert result['candidate']['payload']['tone'] == '作者自己的语气'
    assert result['candidate']['payload']['style_guide']['pov'] == '第一人称'
    assert 'sentence_length' in result['candidate']['payload']['style_guide']
    assert list(result['source_versions']) == [sample['saved_path']] and len(result['evidence']) == 1
    assert store._safe_path('p', 'cards/style_1.yaml').read_bytes() == original
    with pytest.raises(ValueError, match='AI'):
        service.analyze('p', 'style_1', [ai['asset_id']])


def test_cross_owner_event_causes_reject_cycles_and_keep_future_evidence_out_of_prompt(store):
    world = card(store, 'world_1', 'world', {'summary': '共同世界基础'})
    earlier = {'owner_card_id': 'story_1', 'scene_id': 'earlier'}
    current = {'owner_card_id': 'outline_1', 'scene_id': 'current'}
    future = {'owner_card_id': 'story_1', 'scene_id': 'future'}
    story = card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [
        {'id': 'earlier'}, {'id': 'future', 'causal_event_refs': [current]}]})
    card(store, 'outline_1', 'outline', {'story_card_id': 'story_1', 'important_scenes': [
        {'id': 'current', 'causal_event_refs': [earlier]}]})
    scope = WorldScopeService(store)
    scope.validate_event_links('p', story)
    assert scope.predecessors('p', current) == [earlier]
    assert scope.compare_time('p', {'event_ref': earlier}, {'event_ref': current}) == -1
    assert scope.compare_time('p', {'event_ref': future}, {'event_ref': current}) == 1
    cycle = copy.deepcopy(story)
    cycle['payload']['important_scenes'][0]['causal_event_refs'] = [current]
    original = store._safe_path('p', 'cards/story_1.yaml').read_bytes()
    with pytest.raises(ValueError, match='循环'):
        scope.validate_event_links('p', cycle)
    assert store._safe_path('p', 'cards/story_1.yaml').read_bytes() == original
    graph = KnowledgeGraphService(store).graph('p')
    assert any(edge['label'] == '承接前因' and edge['source'] == 'outline_1:important_scenes:current'
               and edge['target'] == 'story_1:important_scenes:earlier' for edge in graph['edges'])
    facts = [{'id': 'old_fact', 'statement': '已发生前因的公开证据', 'public': True,
              'scope': {'world_id': 'world_1', 'time': {'event_ref': earlier, 'position': 'immediate_after'}}},
             {'id': 'future_fact', 'statement': '未来证据不能出现在当前场', 'public': True,
              'scope': {'world_id': 'world_1', 'time': {'event_ref': future, 'position': 'immediate_after'}}}]
    manifest = {'generation_control': {'scene_ref': current}, 'included_cards': [world], 'linked_materials': {'facts': facts}}
    text, _ = ContextPackService(store).build('p', 'chapter_001', manifest, {'场景': {}})
    assert '已发生前因的公开证据' in text and '未来证据不能出现在当前场' not in text


def test_import_fingerprints_scope_explicit_new_and_skipped_entities_are_distinct(store):
    card(store, 'world_1', 'world', {})
    card(store, 'person_original', 'character', {'name': '阿河', 'identity': '作者原有身份'})
    original = store._safe_path('p', 'cards/person_original.yaml').read_bytes()
    service, works = MaterialImportService(store), []
    for year, version in [(2000, '甲本'), (2010, '甲本'), (2000, '乙本')]:
        work = service.create('p', {'text': '阿河是船工。', 'purpose': 'story', 'reference_scope': {'version': version},
                                  'world_context': {'world_id': 'world_1', 'time': {'year': year}}})
        work = service.update('p', work['id'], {'base_revision': work['revision'], 'candidates': [
            {'id': 'fresh', 'kind': 'character', 'label': '阿河', 'target_id': 'person_original', 'values': {'name': '阿河', 'identity': '候选身份'}}]})
        works.append(work)
    assert len({work['candidates'][0]['source_key'] for work in works}) == 3
    created = []
    for work, mode in zip(works, ['new', 'add']):
        result = service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['fresh'], 'decisions': {'fresh': {'mode': mode}}})
        created.append(result['results'][0]['target_id'])
    assert len(set(created)) == 2 and 'person_original' not in created
    assert store._safe_path('p', 'cards/person_original.yaml').read_bytes() == original
    nullable = service.create('p', {'text': '另一世界。', 'purpose': 'world'})
    nullable = service.update('p', nullable['id'], {'base_revision': nullable['revision'], 'candidates': [
        {'id': 'nullable', 'kind': 'world', 'values': {'summary': '另一世界', 'branches': [{'id': 'main', 'parent_branch_id': None}]}}]})
    result = service.apply('p', nullable['id'], {'base_revision': nullable['revision'], 'selected_ids': ['nullable']})
    target = result['results'][0]['target_id']
    assert store.read_yaml('p', f'cards/{target}.yaml')['payload']['branches'][0]['parent_branch_id'] is None
    skipped = service.create('p', {'text': '一个未决定采用的人物与关系。', 'purpose': 'relations'})
    skipped = service.update('p', skipped['id'], {'base_revision': skipped['revision'], 'candidates': [
        {'id': 'skip_person', 'kind': 'character', 'values': {'name': '未加入角色'}},
        {'id': 'dangling_relation', 'kind': 'relationship', 'values': {'label': '不能悬空', 'participants': [
            {'entity_id': 'skip_person'}, {'entity_id': 'person_original'}]}}]})
    before = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(ValueError):
        service.apply('p', skipped['id'], {'base_revision': skipped['revision'], 'selected_ids': ['skip_person', 'dangling_relation'],
                                          'decisions': {'skip_person': {'mode': 'skip'}}})
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}


def test_batch_shared_relation_stage_reimport_and_event_rebase_preserve_author_edits(store):
    card(store, 'world_1', 'world', {})
    card(store, 'story_1', 'story', {'important_scenes': [
        {'id': 'first', 'scene': '原第一场', 'summary': '', 'time': '', 'rehearsal': {'text': '原安排'}},
        {'id': 'second', 'scene': '原第二场'}]})
    service = MaterialImportService(store)
    candidates = [{'id': f'person_{name}', 'kind': 'character', 'label': name, 'values': {'name': name}} for name in ['甲', '乙', '丙', '丁']]
    candidates += [
        {'id': 'team', 'kind': 'relationship', 'label': '四人共同关系', 'values': {'label': '四人共同关系',
            'participants': [{'entity_id': f'person_{name}', 'role': '同行'} for name in ['甲', '乙', '丙', '丁']]}},
        {'id': 'team_stage', 'kind': 'fact', 'values': {'entity_id': 'team', 'status': 'confirmed', 'changes': {'notes': '已经共同承诺'}}},
        {'id': 'event_update', 'kind': 'event', 'target_id': 'story_1:important_scenes:first', 'values': {'summary': '材料中的补充', 'time': '深夜'}},
    ]
    scope = {'world_id': 'world_1', 'time': {'year': 2010}}
    body = {'text': '甲乙丙丁共同承诺，在深夜承接原第一场。', 'purpose': 'relations', 'story_card_id': 'story_1', 'world_context': scope}
    work = service.create('p', body)
    work = service.update('p', work['id'], {'base_revision': work['revision'], 'candidates': candidates})
    selected = [item['id'] for item in candidates]
    applied = service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': selected})
    stages = store.read_jsonl('p', 'canon/author_stages.jsonl')
    first_stage_id = stages[0]['id']
    rows = store.read_yaml('p', 'cards/story_1.yaml')['payload']['important_scenes']
    assert [row['id'] for row in rows] == ['first', 'second'] and rows[0]['time'] == '深夜'
    assert rows[0]['rehearsal']['text'] == '原安排'
    assert not store._safe_path('p', 'cards/outline_planning_story_1.yaml').exists()
    author = AuthorDataService(store)
    assert len(author.relationships('p')) == 1 and len(author.relationships('p')[0]['participants']) == 4
    assert author.author_state('p', world_context=scope)['relations'][0]['state']['notes'] == '已经共同承诺'
    service.undo('p', work['id'], {'base_revision': applied['revision']})
    assert store.read_jsonl('p', 'canon/author_stages.jsonl')[:1] == stages
    second = service.create('p', body)
    second = service.update('p', second['id'], {'base_revision': second['revision'], 'candidates': candidates})
    story = store.read_yaml('p', 'cards/story_1.yaml')
    story['payload']['important_scenes'][0]['summary'] = '作者最新手写，不允许被填充覆盖'
    store.write_yaml('p', 'cards/story_1.yaml', story)
    before = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError):
        service.apply('p', second['id'], {'base_revision': second['revision'], 'selected_ids': selected})
    rebased = service.rebase('p', second['id'], {'base_revision': second['revision']})
    assert any(item['path'] == 'cards/story_1.yaml' for item in rebased['rebase_changes'])
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    service.apply('p', second['id'], {'base_revision': rebased['revision'], 'selected_ids': selected})
    current = store.read_yaml('p', 'cards/story_1.yaml')['payload']['important_scenes']
    assert [row['id'] for row in current] == ['first', 'second']
    assert current[0]['summary'] == '作者最新手写，不允许被填充覆盖' and current[0]['time'] == '深夜'
    confirmed = author.author_state('p', world_context=scope)['relations'][0]
    assert confirmed['state']['notes'] == '已经共同承诺'
    assert confirmed['stages'][0]['id'] != first_stage_id


def test_multiple_character_stages_coalesce_without_future_stage_eating_queue(store, monkeypatch):
    async def scenario():
        card(store, 'world_1', 'world', {})
        card(store, 'person_a', 'character', {'name': '阿河', 'identity': '学徒'})
        card(store, 'person_b', 'character', {'name': '阿舟'})
        store.write_md('p', 'drafts/chapter_001.md', '阿河走进港口。')
        store.write_md('p', 'drafts/.chapter_order', 'chapter_001\n')
        store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': {'world_id': 'world_1', 'time': {'year': 2020}}})
        prompts = []

        async def complete(*args, **kwargs):
            prompts.append(args[-1])
            return '{"changes":[]}'

        service, author = suggestion_service(store, complete), AuthorDataService(store)
        for stage_id, year, changes, knowledge in [
            ('identity_stage', 2010, {'identity': '远航领航员'}, []),
            ('knowledge_stage', 2015, {}, [{'value': '北岸的暗号'}]),
        ]:
            stage = author.add_stage('p', 'character', 'person_a', {'id': stage_id, 'status': 'confirmed',
                'scope': {'world_id': 'world_1', 'time': {'year': year}}, 'changes': changes, 'knowledge': knowledge, 'source': {'kind': 'author'}})
            queued = service.enqueue_stage('p', 'character', 'person_a', stage)
            assert queued['queued_count'] == 1
        future = author.add_stage('p', 'character', 'person_a', {'id': 'future_extra', 'status': 'confirmed',
            'scope': {'world_id': 'world_1', 'time': {'year': 2030}}, 'changes': {'identity': '不可提前采用的未来身份'}, 'source': {'kind': 'author'}})
        assert service.enqueue_stage('p', 'character', 'person_a', future)['queued_count'] == 0
        assert service.get('p', queued['task_ids'][0])['status'] == 'queued'
        monkeypatch.setitem(change_module._EDITED_AT, str(store._project_dir('p')), 0)
        await service.process('p', queued['task_ids'])
        assert len(prompts) == 1 and '远航领航员' in prompts[0] and '北岸的暗号' in prompts[0]
        assert '不可提前采用的未来身份' not in prompts[0]
        relation = author.create_relationship('p', {'label': '共同行动', 'participants': [
            {'entity_id': 'person_a'}, {'entity_id': 'person_b'}]})
        stage = author.add_stage('p', 'relationship', relation['id'], {'status': 'confirmed',
            'scope': {'world_id': 'world_1', 'time': {'year': 2018}}, 'changes': {'notes': '关系已发展'}, 'source': {'kind': 'author'}})
        affected = service.enqueue_stage('p', 'relationship', relation['id'], stage)
        assert affected['queued_count'] >= 1
        assert all(service.get('p', task)['chapter_id'] == 'chapter_001' for task in affected['task_ids'])

    asyncio.run(scenario())


def test_ollama_image_transport_separates_base64_and_marks_unknown_image_usage(monkeypatch):
    import httpx
    client_type = httpx.AsyncClient
    encoded = 'A' * 16000
    messages = [{'role': 'user', 'content': [{'type': 'text', 'text': '分析这张图'},
                 {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + encoded}}]}]

    async def scenario():
        for reported in [False, True]:
            sent = []
            def handle(request):
                sent.append(json.loads(request.content))
                result = {'message': {'content': '外貌候选'}, 'done': True}
                if reported:
                    result.update(prompt_eval_count=17, eval_count=3)
                return httpx.Response(200, text=json.dumps(result) + '\n', headers={'content-type': 'application/x-ndjson'})
            transport = httpx.MockTransport(handle)
            monkeypatch.setattr(gateway_module.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=transport, **kwargs))
            result = await gateway_module.LLMGateway().chat_complete(messages, 'fake-vision', 0, 100,
                {'provider': 'ollama', 'base_url': 'http://not-called.invalid'})
            assert result['text'] == '外貌候选'
            assert sent[0]['messages'] == [{'role': 'user', 'content': '分析这张图', 'images': [encoded]}]
            usage = result['usage']
            if reported:
                assert usage['prompt_tokens'] == 17 and usage['completion_tokens'] == 3 and not usage['estimated']
                assert not usage.get('image_tokens_unknown')
            else:
                assert usage['prompt_tokens'] < 10 and usage['estimated'] and usage['image_tokens_unknown']
                assert summarize_usage([{'module': 'setup_character', **usage}])['image_tokens_unknown']
        assert isinstance(messages[0]['content'], list)

    asyncio.run(scenario())


def test_patch_review_rejects_changed_source_and_can_only_be_applied_once(store):
    store.write_md('p', 'drafts/chapter_001.md', '# 原章\n作者原句。')
    operation = {'op_id': 'edit_1', 'type': 'replace', 'target_range': {'start': 1, 'end': 2},
                 'before': '作者原句。', 'after': '旧候选改句。'}
    old = create_patch_review(store, 'p', 'chapter_001', 'old_patch', [operation])
    app = FastAPI()
    app.include_router(drafts.router)
    app.dependency_overrides[drafts.get_store] = lambda: store
    app.dependency_overrides[drafts.get_kb] = lambda: KBService(store)
    url = '/api/projects/p/drafts/chapter_001'
    draft_dir = store._safe_path('p', 'drafts')

    def snapshot():
        return {str(path.relative_to(draft_dir)): path.read_bytes() for path in draft_dir.rglob('*') if path.is_file()}

    with TestClient(app) as client:
        initial = client.get(url).json()
        assert client.put(url, json={'base_revision': initial['revision'], 'meta_revision': initial['meta']['_revision'],
                                    'content': '# 原章\n作者另存的新句。'}).status_code == 200
        latest = client.get(url).json()
        saved = snapshot()
        stale = client.post(url + '/apply-patch', json={'base_revision': latest['revision'], 'patch_review_id': old['review_id'],
                           'patch_id': 'old_patch', 'ops': old['ops'], 'accept_op_ids': ['edit_1']})
        assert stale.status_code == 409 and snapshot() == saved
        assert not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
        fresh = create_patch_review(store, 'p', 'chapter_001', 'fresh_patch', [
            {**operation, 'before': '作者另存的新句。', 'after': '作者确认的改句。'}])
        body = {'base_revision': latest['revision'], 'patch_review_id': fresh['review_id'],
                'patch_id': 'fresh_patch', 'ops': fresh['ops'], 'accept_op_ids': ['edit_1']}
        accepted = client.post(url + '/apply-patch', json=body)
        assert accepted.status_code == 200 and accepted.json()['content'] == '# 原章\n作者确认的改句。'
        assert len(store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')) == 1
        saved = snapshot()
        body['base_revision'] = client.get(url).json()['revision']
        assert client.post(url + '/apply-patch', json=body).status_code == 409
        assert snapshot() == saved
