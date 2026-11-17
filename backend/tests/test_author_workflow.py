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
import threading
from contextlib import nullcontext
from email.message import Message

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import cards, drafts, projects
from services.change_suggestion_service import ChangeSuggestionService
from services.kb_service import KBService, text_features
from services.author_data_service import AuthorDataService
from services.world_scope_service import WorldScopeService
from services.context_pack_service import ContextPackService
from services.incremental_memory_service import IncrementalMemoryService
from services.material_import_service import MaterialImportService
from services.authoring_service import AuthoringService
from services.style_service import StyleService
from services import change_suggestion_service as change_module
from services import material_import_service as import_module
from services import material_reader_service as reader_module
from services import llm_gateway as gateway_module
from services.token_usage import summarize_usage
from services.editing_service import create_patch_review
from services.author_control_service import AuthorControlService
from services.information_service import InformationService
from services.trial_service import TrialService
from services.edit_version_service import revision
from services.scene_rehearsal_service import SceneRehearsalService
from services.knowledge_graph_service import KnowledgeGraphService
from services.character_detail_service import select_character_details, validate_detail_sections
from services.context_engine import ContextEngine
from jobs.manager import JobManager
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
    from routers import canon
    app.include_router(canon.router)
    app.dependency_overrides[canon.get_store] = lambda: store
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
        store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'fact_one', 'value': '原事实', 'evidence': {'chapter_id': 'chapter_001', 'quote': '作者新稿。'}})
        store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'fact_two', 'value': '另一事实'})
        original_facts = store._safe_path('p', 'canon/facts.jsonl').read_bytes()
        fact_url = '/api/projects/p/canon/facts/fact_one/revise'
        fact_rows = client.get('/api/projects/p/canon/facts?include_revisions=true').json()
        before_revision = next(row['_revision'] for row in fact_rows if row['id'] == 'fact_one')
        body = {'base_revision': before_revision, 'patch': {'value': '第一次修订'}, 'reason': '作者核对'}
        assert client.post(fact_url, json=body).status_code == 200
        current_fact = next(row for row in client.get('/api/projects/p/canon/facts?include_revisions=true').json() if row['id'] == 'fact_one')
        assert current_fact['value'] == '第一次修订' and current_fact['_revision'] != before_revision
        revisions = store._safe_path('p', 'canon/revisions.jsonl').read_bytes()
        assert client.post(fact_url, json=body).status_code == 409
        assert client.post(fact_url, json={'patch': {'value': '未核对新版'}, 'reason': '缺版本'}).status_code == 409
        assert store._safe_path('p', 'canon/revisions.jsonl').read_bytes() == revisions
        controls = AuthorControlService(store)
        controls.confirm('p', {'targets': [{'target': 'canon/facts.jsonl', 'paths': ['/@fact_one/value'],
            'base_revision': controls.get('p', 'canon/facts.jsonl')['base_revision']}]})
        assert client.post(fact_url, json={**body, 'base_revision': current_fact['_revision'], 'patch': {'value': '锁定后试图改写'}}).status_code == 409
        assert client.post('/api/projects/p/canon/facts/missing/revise', json=body).status_code == 404
        assert store._safe_path('p', 'canon/facts.jsonl').read_bytes() == original_facts
        assert store._safe_path('p', 'canon/revisions.jsonl').read_bytes() == revisions
        store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'pending_fact', 'value': '尚无依据的候选',
            'status': 'unverified', 'confirmation_status': 'pending_author_review',
            'evidence': {'chapter_id': 'chapter_001', 'quote': '正文没有这句'}})
        store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'legacy_pending', 'value': '旧待核实形状',
            'confirmation_status': 'pending', 'evidence': {'chapter_id': 'chapter_001', 'quote': '不存在的旧依据'}})
        pending_raw = store._safe_path('p', 'canon/facts.jsonl').read_bytes()
        pending_url = '/api/projects/p/canon/facts/pending_fact/revise'
        pending = next(row for row in client.get('/api/projects/p/canon/facts?include_revisions=true').json() if row['id'] == 'pending_fact')
        confirm = {'status': 'confirmed', 'confirmation_status': 'confirmed'}
        assert client.post(pending_url, json={'base_revision': pending['_revision'], 'patch': confirm, 'reason': '核实候选'}).status_code == 400
        assert store._safe_path('p', 'canon/revisions.jsonl').read_bytes() == revisions
        corrected = client.post(pending_url, json={'base_revision': pending['_revision'], 'patch': {
            'value': '作者新稿。', 'evidence': {'quote': '作者新稿。'}}, 'reason': '先修正原句'})
        assert corrected.status_code == 200
        confirmed = client.post(pending_url, json={'base_revision': corrected.json()['_revision'], 'patch': confirm, 'reason': '依据已核对'})
        assert confirmed.status_code == 200 and confirmed.json()['revision']['patch']['evidence_verification']['support_level'] == 'supported'
        legacy = next(row for row in client.get('/api/projects/p/canon/facts?include_revisions=true').json() if row['id'] == 'legacy_pending')
        verified_history = store._safe_path('p', 'canon/revisions.jsonl').read_bytes()
        assert client.post('/api/projects/p/canon/facts/legacy_pending/revise', json={
            'base_revision': legacy['_revision'], 'patch': confirm, 'reason': '旧形状也须核实'}).status_code == 400
        assert store._safe_path('p', 'canon/revisions.jsonl').read_bytes() == verified_history
        assert store._safe_path('p', 'canon/facts.jsonl').read_bytes() == pending_raw
        card(store, 'world_delete', 'world', {'name': '有引用的世界'})
        card(store, 'child_delete', 'world', {'name': '所属地区', 'parent_id': 'world_delete'})
        held = client.get('/api/projects/p/cards/world_delete').json()
        referenced_before = store._safe_path('p', 'cards/world_delete.yaml').read_bytes()
        blocked_delete = client.delete('/api/projects/p/cards/world_delete', params={'base_revision': held['_revision']})
        assert blocked_delete.status_code == 409 and blocked_delete.json()['detail']['impact']
        assert any('child_delete' in row['source'] for row in blocked_delete.json()['detail']['impact'])
        assert store._safe_path('p', 'cards/world_delete.yaml').read_bytes() == referenced_before
        card(store, 'orphan_delete', 'world', {'name': '没有引用的条目'})
        card(store, 'text_mention', 'outline', {'content': '这里的普通文字包含orphan_delete，不是正式引用。'})
        stale_delete = client.get('/api/projects/p/cards/orphan_delete').json()
        value = store.read_yaml('p', 'cards/orphan_delete.yaml')
        value['payload']['summary'] = '作者后来补充'
        store.write_yaml('p', 'cards/orphan_delete.yaml', value)
        latest_delete = client.get('/api/projects/p/cards/orphan_delete').json()
        assert client.delete('/api/projects/p/cards/orphan_delete').status_code == 409
        assert client.delete('/api/projects/p/cards/orphan_delete', params={'base_revision': stale_delete['_revision']}).status_code == 409
        card(store, 'locked_delete', 'world', {'name': '锁定条目'})
        locked_delete = client.get('/api/projects/p/cards/locked_delete').json()
        controls.confirm('p', {'targets': [{'target': 'cards/locked_delete.yaml', 'paths': ['/'], 'base_revision': locked_delete['_revision']}]})
        assert client.delete('/api/projects/p/cards/locked_delete', params={'base_revision': locked_delete['_revision']}).status_code == 409
        assert client.delete('/api/projects/p/cards/orphan_delete', params={'base_revision': latest_delete['_revision']}).status_code == 200
        assert not store._safe_path('p', 'cards/orphan_delete.yaml').exists()


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
                          'status': 'confirmed', 'changes': {'transport': rule, 'content': rule + '完整正文', 'rules': [rule + '规则'], 'boundaries': rule + '边界'}, 'source': {'kind': 'author_confirmed'}})
    service.add_stage('p', 'character', 'person_a', {'scope': {'world_id': 'world_1', 'time': {'year': 2015}},
        'status': 'confirmed', 'changes': {'identity': '领航员', 'core_motivation': '护送同行者安全抵岸', 'personality_traits': ['审慎', '果断'],
            'voice': '先说明条件再作承诺', 'appearance': '左手新增旧伤'}, 'source': {'kind': 'author_confirmed'},
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
    assert later['characters'][0]['state']['core_motivation'] == '护送同行者安全抵岸'
    assert later['characters'][0]['state']['personality_traits'] == ['审慎', '果断']
    assert later['characters'][0]['state']['voice'] == '先说明条件再作承诺'
    assert early['worlds'][0]['state']['rules'] == ['运河港口规则']
    assert later['worlds'][0]['state']['content'] == '高架港口完整正文'
    assert later['worlds'][0]['state']['boundaries'] == '高架港口边界'
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
    early_snapshot = service.character_snapshot('p', 'person_a', {'world_context': {'world_id': 'world_1', 'time': {'year': 2005}}})
    late_snapshot = service.character_snapshot('p', 'person_a', {'world_context': {'world_id': 'world_1', 'time': {'year': 2020}}})
    assert early_snapshot['state']['identity'] == '学徒' and 'appearance' not in early_snapshot['state']
    assert late_snapshot['state']['appearance'] == '左手新增旧伤' and late_snapshot['age']['value'] == 40
    history = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    for kind, identity, changes in [('character', 'person_a', {'personality_traits': '不应把字符串当列表'}), ('world', 'world_1', {'rules': '不应把字符串当规则列表'})]:
        with pytest.raises(ValueError):
            service.add_stage('p', kind, identity, {'scope': {'world_id': 'world_1', 'time': {'year': 2025}},
                'status': 'confirmed', 'changes': changes, 'source': {'kind': 'author'}})
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes() == history
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
    for identity in ['person_a', 'person_b']:
        card(store, identity, 'character', {'name': '同名人物', 'identity': '', 'aliases': ['共同别名']})
    observer = card(store, 'observer', 'world', {'summary': '只关联确定身份'})
    observer['links'] = ['同名人物', '共同别名', 'person_a']
    store.write_yaml('p', 'cards/observer.yaml', observer)
    card(store, 'story_1', 'story', {'important_scenes': [
        {'id': 'first', 'scene': '同名相遇', 'summary': '第一次', 'rehearsal': {'text': '作者已确认安排'}},
        {'id': 'second', 'scene': '同名相遇', 'summary': '第二次', 'causal_scene_ids': ['first']},
        {'id': 'consequence', 'scene': '共同后果', 'causal_scene_ids': ['first', 'second']}]})
    card(store, 'outline_1', 'outline', {'story_card_id': 'story_1', 'important_scenes': [
        {'id': 'mapped', 'notes': '本表编排说明', 'canonical_event_ref': {'owner_card_id': 'story_1', 'scene_id': 'first'}}]})
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
    assert {edge['target'] for edge in graph['edges'] if edge['source'] == 'observer' and edge['label'] == '引用'} == {'person_a'}
    nodes = {node['id']: node for node in graph['nodes']}
    scenes = [node for node in graph['nodes'] if node['type'] == 'scene']
    assert len(scenes) == 3 and 'outline_1:important_scenes:mapped' not in nodes
    first = nodes['story_1:important_scenes:first']
    assert any('cards/story_1.yaml' in item['path'] for item in first['sources'])
    assert any('cards/outline_1.yaml' in item['path'] for item in first['sources'])
    assert {'owner_card_id': 'outline_1', 'scene_id': 'mapped'} in first['aliases']
    projection = next(item for item in first['projections'] if item['owner_card_id'] == 'outline_1' and item['scene_id'] == 'mapped')
    assert projection['local_values']['notes'] == '本表编排说明'
    assert all(edge['source'] in nodes and edge['target'] in nodes for edge in graph['edges'])
    assert any(edge['source'] == 'outline_1' and edge['target'] == first['id'] and edge.get('alias_event_id') == 'outline_1:important_scenes:mapped' for edge in graph['edges'])
    assert any(edge['source'] == 'story_1:important_scenes:second' and edge['target'] == first['id'] and edge['label'] == '承接前因' for edge in graph['edges'])
    assert first['label'] == nodes['story_1:important_scenes:second']['label']
    assert first['duplicate_conflicts'] and nodes['story_1:important_scenes:second']['duplicate_conflicts']
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
    imports = MaterialImportService(store)
    originals = ['雨停了。', '我绕过灯塔前漫长寂静的街道，终于看见门边那盏熟悉的灯。']
    batch = imports.create('p', {'purpose': 'style', 'text': originals[0]})
    batch = imports.add_source('p', batch['id'], {'base_revision': batch['revision'], 'text': originals[1]})
    batch = imports.add_source('p', batch['id'], {'base_revision': batch['revision'], 'source_kind': 'ai_example', 'text': 'AI效果示例！' * 20})
    mixed = service.analyze('p', 'style_1', [], import_id=batch['id'])
    assert mixed['stats']['avg_sentence_len'] == sum(text_features(text)['avg_sentence_len'] for text in originals) / 2
    assert {item['source_id'] for item in mixed['evidence']} == {source['id'] for source in batch['sources'][:2]}
    assert len(mixed['evidence']) == 2 and mixed['warnings']
    assert mixed['source_versions'] == {f"sessions/material_imports/{batch['id']}.json": batch['revision']}
    assert store._safe_path('p', 'cards/style_1.yaml').read_bytes() == original


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


def test_paragraph_revision_relative_ops_partial_apply_and_undo_preserve_unicode_and_new_edits(store):
    from routers import authoring as authoring_router

    prefix, suffix = '# 原章\n前言：🌊码头。\n', '\n尾声与先前作者改动都保留。'
    selected = '甲🙂把信递给乙。\n保留这一行。\n应删除的一行。\n仍保留这一行。\n收束。\n'
    proposed = '甲🙂把密封信递给乙。\n保留这一行。\n仍保留这一行。\n新增的一声回应。\n收束。\n'
    source = prefix + selected + suffix
    store.write_md('p', 'drafts/chapter_002.md', source)
    store.write_md('p', 'drafts/.chapter_order', 'chapter_002')
    store.write_json('p', 'drafts/chapter_002.meta.json', {'chapter_id': 'chapter_002'})
    store.append_jsonl('p', 'drafts/chapter_002.patch.jsonl', {'patch_id': 'earlier_author_edit'})
    previous_patch = store._safe_path('p', 'drafts/chapter_002.patch.jsonl').read_bytes()
    calls = []

    async def complete(*args, **kwargs):
        calls.append(args)
        return proposed

    service = suggestion_service(store, complete).authoring
    app = FastAPI()
    app.include_router(authoring_router.router)
    app.include_router(drafts.router)
    app.dependency_overrides[authoring_router.get_authoring] = lambda: service
    app.dependency_overrides[drafts.get_store] = lambda: store
    app.dependency_overrides[drafts.get_kb] = lambda: KBService(store)
    url = '/api/projects/p/chapters/chapter_002/revise'

    def saved_drafts():
        return {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
                for path in store._safe_path('p', 'drafts').rglob('*') if path.is_file()}

    with TestClient(app) as client:
        before = saved_drafts()
        result = client.post(url, json={'source_text': source, 'mode': 'polish',
            'start': len(prefix), 'end': len(prefix) + len(selected)})
        assert result.status_code == 200, result.text
        assert len(calls) == 1 and saved_drafts() == before
        candidate = result.json()
        assert json.loads(calls[0][4])['待修改段落'] == selected
        assert candidate['start'] == len(prefix) and candidate['end'] == len(prefix) + len(selected)
        ops = candidate['ops']
        assert len(ops) == 3 and any(op['start'] == op['end'] for op in ops) and any(not op['after'] for op in ops)
        rebuilt = selected
        for op in reversed(ops):
            assert selected[op['start']:op['end']] == op['before']
            rebuilt = rebuilt[:op['start']] + op['after'] + rebuilt[op['end']:]
        assert rebuilt == candidate['text'] == proposed and candidate['diff']
        first = ops[0]
        partial = selected[:first['start']] + first['after'] + selected[first['end']:]
        assert partial.startswith('甲🙂把密封信') and '应删除的一行。' in partial and '新增的一声回应。' not in partial
        accepted = client.post(url + '/apply', json={**candidate, 'text': partial})
        assert accepted.status_code == 200
        applied = accepted.json()
        assert applied['content'] == prefix + partial + suffix
        assert applied['applied_revision'] == service.content_hash(applied['content'])
        undo = {'source_text': applied['content'], 'start': 0, 'end': len(applied['content']), 'text': source,
                'base_hash': applied['applied_revision'], 'mode': 'polish'}
        restored = client.post(url + '/apply', json=undo)
        assert restored.status_code == 200 and restored.json()['content'] == source
        assert store._safe_path('p', 'drafts/chapter_002.md').read_bytes() == source.encode()
        assert store._safe_path('p', 'drafts/chapter_002.patch.jsonl').read_bytes().startswith(previous_patch)
        assert len(store.read_jsonl('p', 'drafts/chapter_002.patch.jsonl')) == 3
        once = saved_drafts()
        assert client.post(url + '/apply', json=undo).status_code == 409 and saved_drafts() == once
        applied_again = client.post(url + '/apply', json={**candidate, 'text': partial}).json()
        current = client.get('/api/projects/p/drafts/chapter_002').json()
        assert client.put('/api/projects/p/drafts/chapter_002', json={'content': applied_again['content'] + '\n作者后写🙂，不许撤销掉。',
            'base_revision': current['revision'], 'meta_revision': current['meta']['_revision']}).status_code == 200
        before_stale = saved_drafts()
        stale_undo = client.post(url + '/apply', json={**undo, 'source_text': applied_again['content'],
            'end': len(applied_again['content']), 'base_hash': applied_again['applied_revision']})
        assert stale_undo.status_code == 409 and saved_drafts() == before_stale


def test_empty_construct_and_cursor_expand_keep_selected_reference_and_safe_receipt_undo(store):
    from routers import authoring as authoring_router

    chosen = card(store, 'tech_selected', 'technique', {'apply_steps': ['第一版实际方法：先看人物持物，再写回应。']})
    other = card(store, 'tech_other', 'technique', {'apply_steps': ['UNSELECTED_SAME_TITLE_METHOD']})
    for value in [chosen, other]:
        value['title'] = '同名写法'
        store.write_yaml('p', 'cards/' + value['id'] + '.yaml', value)
    chapters = [('chapter_empty', 'construct', '', 0), ('chapter_cursor', 'expand', '前文🌊仍在。\n后文🙂不变。', len('前文🌊仍在。\n'))]
    store.write_md('p', 'drafts/.chapter_order', '\n'.join(row[0] for row in chapters))
    calls = []

    async def complete(*args, **kwargs):
        calls.append(copy.deepcopy(args))
        return '门外的雨停了一瞬。🙂'

    service = suggestion_service(store, complete).authoring
    app = FastAPI()
    app.include_router(authoring_router.router)
    app.include_router(drafts.router)
    app.dependency_overrides[authoring_router.get_authoring] = lambda: service
    app.dependency_overrides[drafts.get_store] = lambda: store
    app.dependency_overrides[drafts.get_kb] = lambda: KBService(store)

    def files():
        return {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
                for path in store._project_dir('p').rglob('*') if path.is_file()}

    with TestClient(app) as client:
        for chapter, mode, source, cursor in chapters:
            chosen['payload']['apply_steps'] = ['最新实际方法：' + mode + '时先确定视线落点，再保留人物反应。']
            store.write_yaml('p', 'cards/tech_selected.yaml', chosen)
            store.write_md('p', f'drafts/{chapter}.md', source)
            store.write_json('p', f'drafts/{chapter}.meta.json', {'chapter_id': chapter, 'tool_skill_ids': []})
            url = f'/api/projects/p/chapters/{chapter}/revise'
            request = {'source_text': source, 'base_revision': revision(store, 'p', f'drafts/{chapter}.md'),
                'mode': mode, 'start': cursor, 'end': cursor, 'writing_references': ['tech_selected']}
            before, count = files(), len(calls)
            response = client.post(url, json=request)
            assert response.status_code == 200, response.text
            assert files() == before and len(calls) == count + 1
            candidate = response.json()
            selected = json.loads(calls[-1][4])['作者选用的写作参考']['references']
            assert len(selected) == 1 and selected[0]['id'] == 'tech_selected' and selected[0]['payload'] == chosen['payload']
            assert 'UNSELECTED_SAME_TITLE_METHOD' not in calls[-1][4]
            assert candidate['ops'] == [{'op_id': candidate['ops'][0]['op_id'], 'start': 0, 'end': 0, 'before': '', 'after': candidate['text']}]
            applied = client.post(url + '/apply', json=candidate)
            assert applied.status_code == 200
            receipt = applied.json()
            assert receipt['content'] == source[:cursor] + candidate['text'] + source[cursor:]
            assert receipt['revision'] == receipt['applied_revision'] == service.content_hash(receipt['content'])
            undo = {'source_text': receipt['content'], 'text': source, 'start': 0, 'end': len(receipt['content']),
                    'base_hash': receipt['applied_revision'], 'mode': mode}
            restored = client.post(url + '/apply', json=undo)
            assert restored.status_code == 200, restored.text
            assert restored.json()['content'] == source and store.read_md('p', f'drafts/{chapter}.md') == source
            current = client.get(f'/api/projects/p/drafts/{chapter}').json()
            assert client.put(f'/api/projects/p/drafts/{chapter}', json={'content': source + '另一处作者新稿🙂。',
                'base_revision': current['revision'], 'meta_revision': current['meta']['_revision']}).status_code == 200
            latest, count = files(), len(calls)
            assert client.post(url, json=request).status_code == 409
            assert client.post(url + '/apply', json=candidate).status_code == 409
            assert files() == latest and len(calls) == count
        chapter = 'chapter_cursor'
        current = store.read_md('p', f'drafts/{chapter}.md')
        request = {'source_text': current, 'base_revision': revision(store, 'p', f'drafts/{chapter}.md'),
                   'mode': 'expand', 'start': 0, 'end': 0, 'writing_references': ['tech_selected']}
        for kind, payload in [('technique', {'apply_steps': ['超预算完整方法。' * 1000]}), ('world', {'content': '同ID已不再是技法，不能按同名替代。'})]:
            invalid = {**chosen, 'type': kind, 'payload': payload}
            store.write_yaml('p', 'cards/tech_selected.yaml', invalid)
            before, count = files(), len(calls)
            rejected = client.post('/api/projects/p/chapters/chapter_cursor/revise', json=request)
            assert rejected.status_code == 400, rejected.text
            assert files() == before and len(calls) == count


def test_version_compare_and_rollback_share_current_revision_and_reject_later_edits(store, monkeypatch):
    source, compared, later = '历史正文🙂。', '比较时的正文。', '另一页后来保存的正文🌊。'
    store.write_md('p', 'drafts/chapter_001.md', compared)
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
    saved = drafts._save_snapshot(store, 'p', 'chapter_001', source, reason='manual_save')
    app = FastAPI()
    app.include_router(drafts.router)
    app.dependency_overrides[drafts.get_store] = lambda: store
    app.dependency_overrides[drafts.get_kb] = lambda: KBService(store)
    url = '/api/projects/p/drafts/chapter_001'
    reading, attempted = threading.Event(), threading.Event()
    acquired, failures = [], []
    project_lock = ChangeSuggestionService(store).lock('p')
    original_read = store.read_md

    def concurrent_write():
        try:
            assert reading.wait(3)
            unlocked = project_lock.acquire(blocking=False)
            acquired.append(unlocked)
            if unlocked:
                try:
                    store.write_md('p', 'drafts/chapter_001.md', later)
                finally:
                    project_lock.release()
                attempted.set()
            else:
                attempted.set()
                with project_lock:
                    store.write_md('p', 'drafts/chapter_001.md', later)
        except BaseException as exc:
            failures.append(exc)
            attempted.set()

    def read_then_attempt(project, path):
        text = original_read(project, path)
        if path == 'drafts/chapter_001.md' and not reading.is_set():
            reading.set()
            assert attempted.wait(3)
        return text

    def files():
        return {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
                for path in store._safe_path('p', 'drafts').rglob('*') if path.is_file()}

    with TestClient(app) as client:
        thread = threading.Thread(target=concurrent_write)
        with monkeypatch.context() as patch:
            patch.setattr(store, 'read_md', read_then_attempt)
            thread.start()
            comparison = client.get(url + '/versions/' + saved['version_id'] + '/compare')
            thread.join(3)
        assert not thread.is_alive() and not failures and acquired == [False]
        assert comparison.status_code == 200
        old = comparison.json()
        assert old['current_revision'] == AuthoringService.content_hash(compared)
        assert compared in old['diff'] and later not in old['diff'] and source in old['diff']
        assert store.read_md('p', 'drafts/chapter_001.md') == later
        current_files = files()
        for token in [old['current_revision'], None, '']:
            assert client.post(url + '/rollback', json={'version_id': saved['version_id'], 'base_revision': token}).status_code == 409
            assert files() == current_files
        assert client.post(url + '/rollback', json={'version_id': saved['version_id']}).status_code == 409
        assert files() == current_files
        fresh = client.get(url + '/versions/' + saved['version_id'] + '/compare').json()
        assert fresh['current_revision'] == AuthoringService.content_hash(later)
        restored = client.post(url + '/rollback', json={'version_id': saved['version_id'], 'base_revision': fresh['current_revision']})
        assert restored.status_code == 200 and restored.json()['content'] == source
        assert store.read_md('p', 'drafts/chapter_001.md') == source
        patches = store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
        assert len(patches) == 1 and patches[0]['patch_ops'][0]['before'] == later and patches[0]['patch_ops'][0]['after'] == source
        assert any(row['reason'].startswith('rollback_backup:') for row in store.read_json('p', 'drafts/chapter_001.meta.json')['versions'])


def test_rehearsal_composed_fact_revision_changes_materials_cache_and_confirmation_basis(store, monkeypatch):
    from routers import canon
    from services import automatic_rehearsal as automatic
    from services import scene_rehearsal_service as scene_module

    scope = {'world_id': 'world_1', 'time': {'year': 1931}}
    card(store, 'world_1', 'world', {'name': '旧港'})
    card(store, 'world_other', 'world', {'name': '另一世界'})
    for key in ['a', 'b']:
        card(store, 'person_' + key, 'character', {'name': key, 'identity': '守灯人', 'world_context': {'world_id': 'world_1'}})
    card(store, 'story_1', 'story', {'world_context': scope, 'important_scenes': [
        {'id': 'handover', 'scene': '先前交接', 'chapter': 'chapter_001', 'characters': ['person_a', 'person_b'], 'world_context': {'time': {'year': 1930}}},
        {'id': 'meeting', 'scene': '讨论备用灯', 'chapter': 'chapter_002', 'characters': ['person_a', 'person_b'], 'causal_scene_ids': ['handover']},
        {'id': 'future', 'scene': '未来灯塔', 'chapter': 'chapter_003', 'characters': ['person_a'], 'world_context': {'time': {'year': 1940}}}]})
    card(store, 'story_other', 'story', {'world_context': {'world_id': 'world_other', 'time': {'year': 1900}}, 'important_scenes': [
        {'id': 'unrelated', 'scene': '别处的旧事', 'chapter': 'chapter_other', 'characters': ['person_a']}]})
    for chapter, story, text in [('chapter_001', 'story_1', '备用灯先由甲保管，交接后改由乙保管。'),
            ('chapter_002', 'story_1', '两人谈论备用灯。'), ('chapter_003', 'story_1', '未来才会亮起红灯。'),
            ('chapter_other', 'story_other', '另一世界有无关的旧誓言。')]:
        store.write_md('p', f'drafts/{chapter}.md', text)
        store.write_json('p', f'drafts/{chapter}.meta.json', {'story_card_id': story})
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\nchapter_002\nchapter_003')
    store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'adopted', 'value': '备用灯由甲保管', 'public': True,
        'evidence': {'chapter_id': 'chapter_001', 'event_ref': 'story_1:important_scenes:handover', 'quote': '先由甲保管'}})
    calls = []

    def local_rehearsal(context, specification):
        calls.append(copy.deepcopy(context['facts']))
        return {'steps': [], 'engines': [], 'text': context['facts'][0]['value'], 'outcome': '仅验证同源缓存'}

    # The fake rehearsal bypasses tools; satisfy the real pair preflight before testing its cache.
    monkeypatch.setattr(scene_module, 'availability', lambda: {'praxish': True, 'sabre': True, 'fatima': True})
    monkeypatch.setattr(automatic, 'rehearse', local_rehearsal)
    service = SceneRehearsalService(store)
    original = service.get('p', 'story_1', 'meeting')
    assert [row['value'] for row in original['context']['facts']] == ['备用灯由甲保管']
    assert service.get('p', 'story_1', 'meeting')['automatic']['key'] == original['automatic']['key'] and len(calls) == 1
    for identity, chapter, reference, value in [('future', 'chapter_003', 'story_1:important_scenes:future', '未来才会亮起红灯'),
            ('unrelated', 'chapter_other', 'story_other:important_scenes:unrelated', '另一世界有无关的旧誓言')]:
        store.append_jsonl('p', 'canon/facts.jsonl', {'id': identity, 'value': value, 'public': True,
            'evidence': {'chapter_id': chapter, 'event_ref': reference, 'quote': value}})
    raw_facts = store._safe_path('p', 'canon/facts.jsonl').read_bytes()
    app = FastAPI()
    app.include_router(canon.router)
    app.dependency_overrides[canon.get_store] = lambda: store
    with TestClient(app) as client:
        for identity in ['future', 'unrelated']:
            value = next(row for row in client.get('/api/projects/p/canon/facts?include_revisions=true').json() if row['id'] == identity)
            assert client.post('/api/projects/p/canon/facts/' + identity + '/revise', json={
                'base_revision': value['_revision'], 'patch': {'value': '未用于当前场景的新说法'}, 'reason': '只改其他范围'}).status_code == 200
        unaffected = service.get('p', 'story_1', 'meeting')
        assert unaffected['source_versions'] == original['source_versions'] and unaffected['base_hash'] == original['base_hash']
        assert unaffected['automatic']['key'] == original['automatic']['key'] and len(calls) == 1
        assert [row['value'] for row in unaffected['context']['facts']] == ['备用灯由甲保管']
        used = next(row for row in client.get('/api/projects/p/canon/facts?include_revisions=true').json() if row['id'] == 'adopted')
        assert client.post('/api/projects/p/canon/facts/adopted/revise', json={'base_revision': used['_revision'],
            'patch': {'value': '备用灯由乙保管', 'evidence': {'quote': '交接后改由乙保管'}}, 'reason': '核对交接后的有效事实'}).status_code == 200
    latest = service.get('p', 'story_1', 'meeting')
    assert [row['value'] for row in latest['context']['facts']] == ['备用灯由乙保管']
    assert latest['source_versions']['canon/facts.jsonl'] != original['source_versions']['canon/facts.jsonl']
    assert latest['base_hash'] != original['base_hash'] and latest['automatic']['key'] != original['automatic']['key']
    assert len(calls) == 2 and latest['automatic']['text'] == '备用灯由乙保管'
    before = {str(path.relative_to(store._project_dir('p'))): path.read_bytes() for path in store._project_dir('p').rglob('*') if path.is_file()}
    with pytest.raises(FileExistsError):
        service.confirm('p', 'story_1', 'meeting', {key: original[key] for key in ['draft', 'source_versions', 'base_hash']})
    assert before == {str(path.relative_to(store._project_dir('p'))): path.read_bytes() for path in store._project_dir('p').rglob('*') if path.is_file()}
    assert store._safe_path('p', 'canon/facts.jsonl').read_bytes() == raw_facts


def test_confirmed_field_lock_blocks_store_import_and_confirmed_rule_changes(store):
    value = card(store, 'world_1', 'world', {'rules': ['潮汐有固定周期'], 'summary': '未锁定的说明'})
    target = 'cards/world_1.yaml'
    controls = AuthorControlService(store)
    controls.confirm('p', {'targets': [{'target': target, 'paths': ['/payload/rules'], 'base_revision': revision(store, 'p', target)}]})
    saved = store._safe_path('p', target).read_bytes()
    with pytest.raises(FileExistsError):
        store.write_yaml('p', target, {**value, 'payload': {**value['payload'], 'rules': ['绕过锁的规则']}})
    assert store._safe_path('p', target).read_bytes() == saved
    value['payload']['summary'] = '作者可继续补充未锁说明'
    store.write_yaml('p', target, value)
    saved = store._safe_path('p', target).read_bytes()
    imports = MaterialImportService(store)
    batch = imports.create('p', {'text': '潮汐没有固定周期。', 'purpose': 'world'})
    batch = imports.update('p', batch['id'], {'base_revision': batch['revision'], 'candidates': [
        {'id': 'rule', 'kind': 'world', 'target_id': 'world_1', 'values': {'rules': ['潮汐没有固定周期']}}]})
    with pytest.raises(FileExistsError):
        imports.apply('p', batch['id'], {'base_revision': batch['revision'], 'selected_ids': ['rule'], 'decisions': {'rule': {'mode': 'replace'}}})
    assert store._safe_path('p', target).read_bytes() == saved
    author = AuthorDataService(store)
    with pytest.raises(FileExistsError):
        author.add_stage('p', 'world', 'world_1', {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 2020}},
            'changes': {'rules': ['用追加阶段绕过正式规则']}, 'source': {'kind': 'author'}})
    assert store.read_jsonl('p', 'canon/author_stages.jsonl') == []
    author.add_stage('p', 'world', 'world_1', {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 2020}},
        'changes': {'summary': '此时城市经历暴潮，过去仍保留'}, 'source': {'kind': 'author'}})
    assert store._safe_path('p', target).read_bytes() == saved


def test_scoped_amendment_restore_and_id_based_row_locks_preserve_other_changes(store):
    card(store, 'world_1', 'world', {'rules': ['原规则'], 'limits': ['不能改变的另一规则'], 'summary': '原说明'})
    controls, target = AuthorControlService(store), 'cards/world_1.yaml'
    controls.confirm('p', {'targets': [{'target': target, 'paths': ['/payload/rules', '/payload/limits'], 'base_revision': revision(store, 'p', target)}]})
    held = controls.get('p', target)
    amendment = controls.start('p', {'target': target, 'paths': ['/payload/rules'], 'base_revision': held['base_revision'], 'control_revision': held['revision'], 'reason': '只改潮汐规则'})
    with pytest.raises(ValueError):
        controls.update('p', amendment['id'], {'revision': amendment['revision'], 'changes': {'/payload/limits': ['超出指定范围']}})
    amendment = controls.update('p', amendment['id'], {'revision': amendment['revision'], 'changes': {'/payload/rules': ['新规则']}})
    assert store.read_yaml('p', target)['payload']['rules'] == ['原规则']
    adopted = controls.apply('p', amendment['id'], {'revision': amendment['revision']})
    saved = store._safe_path('p', target).read_bytes()
    assert controls.apply('p', amendment['id'], {'revision': amendment['revision']})['status'] == 'applied'
    assert store._safe_path('p', target).read_bytes() == saved
    current = store.read_yaml('p', target)
    current['payload']['summary'] = '采用后作者又写的未锁字段'
    store.write_yaml('p', target, current)
    restored = controls.apply('p', amendment['id'], {'revision': adopted['revision']}, restore=True)
    assert restored['status'] == 'restored'
    current = store.read_yaml('p', target)
    assert current['payload'] == {'rules': ['原规则'], 'limits': ['不能改变的另一规则'], 'summary': '采用后作者又写的未锁字段'}
    with pytest.raises(FileExistsError):
        store.write_yaml('p', target, {**current, 'payload': {**current['payload'], 'rules': ['恢复后仍不能普通覆盖']}})
    assert [row['kind'] for row in store.read_jsonl('p', 'canon/author_controls.jsonl')] == ['lock', 'applied', 'restored']
    story = card(store, 'story_1', 'story', {'important_scenes': [{'id': 'first', 'summary': '锁住第一场'}, {'id': 'second', 'summary': '第二场'}]})
    story_target = 'cards/story_1.yaml'
    history = store._safe_path('p', 'canon/author_controls.jsonl').read_bytes()
    with pytest.raises(FileExistsError):
        controls.confirm('p', {'targets': [
            {'target': story_target, 'paths': ['/payload/important_scenes/@first/summary'], 'base_revision': revision(store, 'p', story_target)},
            {'target': target, 'paths': ['/'], 'base_revision': 'stale'}]})
    assert store._safe_path('p', 'canon/author_controls.jsonl').read_bytes() == history
    assert controls.get('p', story_target)['locks'] == []
    controls.confirm('p', {'targets': [{'target': story_target, 'paths': ['/payload/important_scenes/@first/summary'], 'base_revision': revision(store, 'p', story_target)}]})
    story['payload']['important_scenes'].reverse()
    store.write_yaml('p', story_target, story)
    story['payload']['important_scenes'][1]['summary'] = '换序不能绕过原ID锁'
    with pytest.raises(FileExistsError):
        store.write_yaml('p', story_target, story)


def test_information_truth_belief_and_reader_disclosure_follow_separate_axes(store):
    world = card(store, 'world_1', 'world', {'summary': '河港'})
    people = [card(store, 'person_' + key, 'character', {'name': key, 'identity': ''}) for key in 'abc']
    secret, claim = '甲秘密取走了黄铜钥匙', '丙取走了黄铜钥匙'
    store.write_md('p', 'drafts/prologue.md', secret + '。')
    store.write_md('p', 'drafts/chapter_001.md', '乙站在门外。')
    store.write_md('p', 'drafts/.chapter_order', 'prologue\nchapter_001')
    scope = {'world_id': 'world_1', 'time': {'year': 2020}, 'pov_character_id': 'person_b'}
    store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': scope, 'information_ids': ['key_info']})
    store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'key_fact', 'value': secret, 'scope': 'world_state', 'world_context': scope, 'public': True})
    service = InformationService(store)
    service.save('p', {'id': 'key_info', 'label': '钥匙去向', 'truth_status': 'confirmed', 'fact_ref': 'key_fact', 'scope': {'world_id': 'world_1'}})

    def record(kind, data, **extra):
        return service.add_record('p', 'key_info', {'record_type': kind, 'status': 'confirmed',
            'scope': {'world_id': 'world_1', 'time': {'year': 2020}}, 'source': {'kind': 'author'}, 'data': data, **extra})

    record('occurrence', {'value': secret})
    expression = record('expression', {'value': claim, 'speaker_id': 'person_a', 'audience_ids': ['person_b'], 'heard_by': ['person_b'], 'intent': 'lie'})
    record('awareness', {'value': claim, 'character_id': 'person_b', 'state': 'believes', 'basis': '听到甲的说法', 'expression_ref': expression['id']})
    record('reader_disclosure', {'value': secret, 'chapter_id': 'prologue', 'start': 0, 'end': len(secret), 'mode': 'shown',
        'source_revision': revision(store, 'p', 'drafts/prologue.md')})
    state = service.state('p', world_context=scope, reader_chapter_id='chapter_001')['items'][0]
    assert state['truth_value'] == secret and len(state['occurrences']) == 1
    assert state['awareness'][0]['data']['state'] == 'believes' and len(state['reader_disclosures']) == 1
    writer = service.materials('p', {**scope, 'chapter_id': 'chapter_001'})
    encoded = json.dumps(writer, ensure_ascii=False)
    assert claim in encoded and secret not in encoded and '"intent": "lie"' not in encoded
    assert not service.fact_allowed('p', 'key_fact', scope)
    manifest = {'generation_control': {'world_context': scope}, 'included_cards': [world, *people],
                'linked_materials': {'facts': [store.read_jsonl('p', 'canon/facts.jsonl')[0]]}}
    prompt, report = ContextPackService(store).build('p', 'chapter_001', manifest, {'场景': {'cast': ['person_b']}})
    assert claim in prompt and secret not in prompt
    review = service.materials('p', {**scope, 'chapter_id': 'chapter_001'}, for_review=True)
    assert secret in json.dumps(review, ensure_ascii=False)
    store.write_md('p', 'drafts/prologue.md', '序章已改，不再展示钥匙。')
    assert not ContextPackService(store).sources_unchanged('p', report['source_versions'])
    store.write_md('p', 'drafts/prologue.md', secret + '。')
    before = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\nprologue')
    reordered = service.state('p', world_context=scope, reader_chapter_id='chapter_001')['items'][0]
    assert not reordered['reader_disclosures'] and reordered['awareness'] == state['awareness']
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes() == before
    assert not ContextPackService(store).sources_unchanged('p', report['source_versions'])
    controls = AuthorControlService(store)
    registry = 'cards/outline_author_registry.yaml'
    controls.confirm('p', {'targets': [{'target': registry, 'paths': ['/payload/information_registry/@key_info/truth_value'],
        'base_revision': revision(store, 'p', registry)}]})
    assert controls.get('p', 'canon/facts.jsonl')['locks'][0]['paths'] == ['/@key_fact/value']
    store.append_jsonl('p', 'canon/facts.jsonl', {'id': 'dict_scoped_fact', 'value': '仅有范围，不擅自当世界事实分类', 'scope': {'world_id': 'world_1'}})
    memory = IncrementalMemoryService(store)
    memory.prepare('p')
    assert [row['source']['fact_id'] for row in KBService(store).world_fact_rows('p')] == ['key_fact']
    facts = store._safe_path('p', 'canon/facts.jsonl').read_bytes()
    with pytest.raises(FileExistsError):
        store.append_jsonl('p', 'canon/revisions.jsonl', {'target_fact_id': 'key_fact', 'patch': {'value': '通过原事实绕过已锁真相'}})
    assert not store.read_jsonl('p', 'canon/revisions.jsonl')
    original = controls.get('p', 'canon/facts.jsonl')
    work = controls.start('p', {'target': 'canon/facts.jsonl', 'paths': ['/@key_fact/value'], 'base_revision': original['base_revision']})
    work = controls.update('p', work['id'], {'revision': work['revision'], 'changes': {'/@key_fact/value': '作者指定修订后的真相'}})
    adopted = controls.apply('p', work['id'], {'revision': work['revision']})
    assert service.fact('p', 'key_fact')['value'] == '作者指定修订后的真相'
    assert 'canon/revisions.jsonl' in memory.prepare('p')['updated_sources']
    indexed = [row for row in store.read_jsonl('p', 'meta/kb/kb_world/chunks.jsonl') if row['source'].get('fact_id') == 'key_fact']
    assert indexed[0]['text'] == KBService(store).world_fact_rows('p')[0]['text'] == '作者指定修订后的真相'
    protected_prompt, _ = ContextPackService(store).build('p', 'chapter_001', {**manifest, 'evidence': indexed}, {'场景': {'cast': ['person_b']}})
    assert '作者指定修订后的真相' not in protected_prompt and claim in protected_prompt
    assert store._safe_path('p', 'canon/facts.jsonl').read_bytes() == facts
    controls.apply('p', work['id'], {'revision': adopted['revision']}, restore=True)
    assert service.fact('p', 'key_fact')['value'] == secret
    assert len(store.read_jsonl('p', 'canon/revisions.jsonl')) == 2
    assert store._safe_path('p', 'canon/facts.jsonl').read_bytes() == facts
    pending = service.get('p', 'key_info')
    service.save('p', {**pending, 'truth_status': 'undecided'}, 'key_info')
    undecided = service.state('p', world_context=scope)['items'][0]
    assert undecided['truth_value'] is None and undecided['truth_status'] == 'undecided'
    assert not service.fact_allowed('p', 'key_fact', scope)


def test_imported_information_chain_recovers_and_keeps_truth_belief_reader_and_locks_separate(store, monkeypatch):
    scope = {'world_id': 'world_1', 'time': {'year': 1930}}
    card(store, 'world_1', 'world', {'name': '河港', 'rules': []})
    card(store, 'story_1', 'story', {'world_context': scope, 'important_scenes': []})
    secret, claim = '甲拿走了黄铜钥匙', '丙拿走了黄铜钥匙'
    original = secret + '。甲对乙说：' + claim + '。乙相信了这句话。'
    store.write_md('p', 'drafts/chapter_001.md', original)
    store.write_md('p', 'drafts/chapter_002.md', '乙第二天还没有发现真相。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\nchapter_002')
    store.write_json('p', 'drafts/chapter_001.meta.json', {'story_card_id': 'story_1', 'world_context': scope})
    world_before = store._safe_path('p', 'cards/world_1.yaml').read_bytes()
    service = MaterialImportService(store)

    def candidate(identity, kind, values, row_scope=None):
        return {'id': identity, 'kind': kind, 'label': values.get('name') or values.get('label') or identity,
                'values': values, 'scope': row_scope or scope, 'provenance': 'author_edit', 'evidence': [{'quote': original}]}

    candidates = [candidate('new_' + letter, 'character', {'name': name, 'identity': '', 'world_context': {'world_id': 'world_1'}})
                  for letter, name in [('a', '甲'), ('b', '乙'), ('c', '丙')]]
    candidates += [candidate('theft_event', 'event', {'scene': '钥匙失踪', 'plot': original, 'chapter': 'chapter_001', 'characters': ['new_a', 'new_b']}),
        candidate('key_info', 'information', {'label': '钥匙去向', 'truth_status': 'confirmed', 'truth_value': secret}, {'world_id': 'world_1'})]
    record_scope = {'world_id': 'world_1', 'time': {'year': 1930, 'event_ref': 'theft_event', 'position': 'immediate_after'}}
    for identity, kind, data in [
        ('occurred', 'occurrence', {'value': secret}),
        ('lie', 'expression', {'value': claim, 'speaker_id': 'new_a', 'audience_ids': ['new_b'], 'heard_by': ['new_b'], 'intent': 'lie'}),
        ('knows', 'awareness', {'value': secret, 'character_id': 'new_a', 'state': 'knows', 'basis': '亲手取走'}),
        ('believes', 'awareness', {'value': claim, 'character_id': 'new_b', 'state': 'believes', 'basis': '听甲陈述', 'expression_candidate_id': 'lie'}),
        ('shown', 'reader_disclosure', {'value': secret, 'chapter_id': 'chapter_001', 'start': 0, 'end': len(secret),
            'mode': 'shown', 'source_revision': revision(store, 'p', 'drafts/chapter_001.md')}),
    ]:
        candidates.append(candidate(identity, 'information_record', {'information_candidate_id': 'key_info', 'record_type': kind,
            'status': 'confirmed', 'data': data}, {'world_id': 'world_1'} if kind == 'reader_disclosure' else record_scope))

    def work(values):
        batch = service.create('p', {'purpose': 'relations', 'story_card_id': 'story_1', 'world_context': scope, 'text': original})
        return service.update('p', batch['id'], {'base_revision': batch['revision'], 'candidates': copy.deepcopy(values)})

    selected_targets = {}

    def apply(batch):
        return service.apply('p', batch['id'], {'base_revision': batch['revision'],
            'selected_ids': [item['id'] for item in batch['candidates']],
            'decisions': {key: {'mode': 'fill', 'target_id': value} for key, value in selected_targets.items()}})

    batch = work(candidates)
    replace = Path.replace
    failed = [False]

    def interrupt_registry(path, destination):
        if Path(destination).name == 'outline_author_registry.yaml' and not failed[0]:
            failed[0] = True
            raise OSError('模拟信息registry发布中断')
        return replace(path, destination)

    with monkeypatch.context() as patch:
        patch.setattr(Path, 'replace', interrupt_registry)
        with pytest.raises(OSError, match='registry'):
            apply(batch)
    assert service.get('p', batch['id'])['status'] == 'applying'
    service.recover_pending('p')
    adopted = service.get('p', batch['id'])
    assert adopted['status'] == 'applied'
    before_retry = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    apply(adopted)
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes() == before_retry
    results = {row['candidate_id']: row for row in adopted['results']}
    selected_targets.update({key: row['target_id'] for key, row in results.items()
                             if key in {'new_a', 'new_b', 'new_c', 'theft_event', 'key_info'}})
    information_id, person_b = results['key_info']['target_id'], results['new_b']['target_id']
    assert results['key_info']['lock_target'] == 'cards/outline_author_registry.yaml'
    assert results['key_info']['lock_paths'] == ['/payload/information_registry/@' + information_id]
    assert results['believes']['lock_target'] == 'canon/author_stages.jsonl'
    assert results['believes']['lock_paths'] == ['/@' + results['believes']['target_id']]
    assert not store._safe_path('p', 'cards/' + results['believes']['target_id'] + '.yaml').exists()
    info = InformationService(store)
    now = {'world_id': 'world_1', 'story_card_id': 'story_1', 'time': {'year': 1931}}
    state = info.state('p', world_context=now, reader_chapter_id='chapter_002')['items'][0]
    assert state['truth_value'] == secret and len(state['occurrences']) == len(state['expressions']) == len(state['reader_disclosures']) == 1
    belief = next(row for row in state['awareness'] if row['data']['character_id'] == person_b)
    assert belief['data']['value'] == claim and belief['data']['state'] == 'believes'
    assert belief['data']['expression_ref'] == results['lie']['target_id']
    limited = info.materials('p', {**now, 'pov_character_id': person_b}, actor_ids=[person_b], information_ids=[information_id])
    assert claim in json.dumps(limited, ensure_ascii=False) and secret not in json.dumps(limited, ensure_ascii=False)
    store.write_md('p', 'drafts/.chapter_order', 'chapter_002\nchapter_001')
    moved = info.state('p', world_context=now, reader_chapter_id='chapter_002')['items'][0]
    assert not moved['reader_disclosures'] and moved['awareness'] == state['awareness']
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\nchapter_002')
    supplemental = copy.deepcopy(candidates)
    next(row for row in supplemental if row['id'] == 'believes')['values']['data']['basis'] = '对同一说法再次确认'
    extra = apply(work(supplemental))
    extra_result = next(row for row in extra['results'] if row['candidate_id'] == 'believes')
    current = info.state('p', world_context=now)['items'][0]
    assert len(current['expressions']) == 1 and len(current['awareness']) == 3
    new_belief = next(row for row in current['awareness'] if row['id'] == extra_result['target_id'])
    assert new_belief['data']['expression_ref'] == results['lie']['target_id']
    service.undo('p', extra['id'], {'base_revision': extra['revision']})
    original_history = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    undone = service.undo('p', adopted['id'], {'base_revision': adopted['revision']})
    assert undone['status'] == 'undone' and not info.list('p')
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes().startswith(original_history)
    assert any(row.get('kind') == 'void' for row in store.read_jsonl('p', 'canon/author_stages.jsonl'))
    selected_targets.clear()
    restored = apply(work(candidates))
    latest = info.state('p', world_context=now)['items'][0]
    assert len(latest['expressions']) == 1 and len(latest['awareness']) == 2
    actor = store.read_yaml('p', f"cards/{person_b}.yaml")
    actor['payload']['identity'] = '作者后写的身份'
    store.write_yaml('p', f"cards/{person_b}.yaml", actor)
    preserved = {str(path.relative_to(store._project_dir('p'))): path.read_bytes() for folder in ['cards', 'canon']
                 for path in store._safe_path('p', folder).rglob('*') if path.is_file()}
    with pytest.raises(FileExistsError):
        service.undo('p', restored['id'], {'base_revision': restored['revision']})
    assert {str(path.relative_to(store._project_dir('p'))): path.read_bytes() for folder in ['cards', 'canon']
            for path in store._safe_path('p', folder).rglob('*') if path.is_file()} == preserved
    controls = AuthorControlService(store)
    controls.confirm('p', {'targets': [{'target': results['key_info']['lock_target'], 'paths': results['key_info']['lock_paths'],
        'base_revision': controls.base_revision('p', results['key_info']['lock_target'])}]})
    blocked = work([candidate('locked_change', 'information', {'id': information_id, 'label': '钥匙去向', 'truth_status': 'confirmed', 'truth_value': '不应覆盖锁定真相'}),
                    candidate('unrelated', 'world', {'title': '不应先写入的地区', 'entry_type': 'place'})])
    before_blocked = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError):
        service.apply('p', blocked['id'], {'base_revision': blocked['revision'], 'selected_ids': ['locked_change', 'unrelated'],
            'decisions': {'locked_change': {'mode': 'replace', 'target_id': information_id}}})
    assert {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')} == before_blocked
    assert store._safe_path('p', 'cards/world_1.yaml').read_bytes() == world_before
    assert store.read_md('p', 'drafts/chapter_001.md') == original and not store.read_jsonl('p', 'canon/facts.jsonl')


def test_information_intention_signatures_and_disclosure_versions_remain_explicit(store):
    card(store, 'world_1', 'world', {})
    card(store, 'person_a', 'character', {'name': '甲', 'identity': ''})
    store.write_md('p', 'drafts/chapter_001.md', '甲说自己没有取钥匙。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
    service = InformationService(store)
    service.save('p', {'id': 'key_info', 'label': '钥匙去向', 'truth_status': 'undecided', 'scope': {'world_id': 'world_1'}})
    assert service.get('p', 'key_info')['truth_value'] is None
    card(store, 'story_1930', 'story', {'world_context': {'world_id': 'world_1', 'time': {'year': 1930}}})
    store.write_json('p', 'drafts/chapter_001.meta.json', {'story_card_id': 'story_1930', 'world_context': {'time': {'year': 1940}}})
    pending = {'record_type': 'awareness', 'status': 'confirmed', 'source': {'kind': 'author'},
               'data': {'character_id': 'person_a', 'state': 'believes', 'value': '尚待核实的钥匙说法'}}
    inherited = service.prepare_record('p', 'key_info', {**pending, 'scope': {'story_card_id': 'story_1930'}})
    chapter = service.prepare_record('p', 'key_info', {**pending, 'scope': {'chapter_id': 'chapter_001'}})
    assert inherited['scope']['time']['year'] == 1930 and chapter['scope']['time']['year'] == 1940
    with pytest.raises(ValueError, match='时间|事件'):
        service.prepare_record('p', 'key_info', {**pending, 'scope': {'world_id': 'world_1'}})
    text = store.read_md('p', 'drafts/chapter_001.md')
    disclosure = service.add_record('p', 'key_info', {'record_type': 'reader_disclosure', 'status': 'confirmed',
        'scope': {'world_id': 'world_1'}, 'source': {'kind': 'author'}, 'data': {'value': '甲自称没有拿钥匙', 'mode': 'claim',
        'chapter_id': 'chapter_001', 'start': 0, 'end': len(text), 'source_revision': revision(store, 'p', 'drafts/chapter_001.md')}})
    assert not disclosure['scope'].get('time')
    assert service.state('p', world_context={'world_id': 'world_1', 'time': {'year': 1800}},
                         reader_chapter_id='chapter_001')['items'][0]['reader_disclosures'][0]['id'] == disclosure['id']
    decision = {'action': 'intentional', 'chapter_id': 'chapter_001', 'actor_ids': ['person_a'], 'reason': '此处保留不可靠说法',
                'quote': text, 'source_versions': {'drafts/chapter_001.md': revision(store, 'p', 'drafts/chapter_001.md'),
                                                'canon/author_stages.jsonl': revision(store, 'p', 'canon/author_stages.jsonl')}}
    first = service.add_decision('p', 'key_info', decision)
    decision['source_versions']['canon/author_stages.jsonl'] = revision(store, 'p', 'canon/author_stages.jsonl')
    assert service.add_decision('p', 'key_info', decision)['id'] == first['id']
    assert service.decisions('p', 'key_info')[0]['status'] == 'active'
    assert service.get('p', 'key_info')['truth_status'] == 'undecided'
    store.write_md('p', 'drafts/chapter_001.md', text + '\n\n无关末段的环境描写。')
    assert service.decisions('p', 'key_info')[0]['status'] == 'active'
    store.write_md('p', 'drafts/chapter_001.md', text + '\n\n' + text)
    with pytest.raises(ValueError, match='原句|重复|唯一|多处'):
        service.add_decision('p', 'key_info', {**decision, 'source_versions': {
            'drafts/chapter_001.md': revision(store, 'p', 'drafts/chapter_001.md'),
            'canon/author_stages.jsonl': revision(store, 'p', 'canon/author_stages.jsonl')}})
    store.write_md('p', 'drafts/chapter_001.md', '作者后来重写了这段话。')
    assert not service.disclosure_valid('p', disclosure)
    assert service.records('p', 'key_info')[0]['evidence_status'] == 'stale'
    assert service.decisions('p', 'key_info')[0]['status'] == 'stale'
    assert not service.state('p', world_context={'world_id': 'world_1', 'time': {'year': 2020}},
                             reader_chapter_id='chapter_001')['items'][0]['reader_disclosures']
    target = 'cards/outline_author_registry.yaml'
    controls = AuthorControlService(store)
    work = controls.start('p', {'target': target, 'paths': ['/payload/information_registry/@key_info/truth_status'],
        'base_revision': revision(store, 'p', target)})
    work = controls.update('p', work['id'], {'revision': work['revision'],
        'changes': {'/payload/information_registry/@key_info/truth_status': 'invalid_status'}})
    before = store._safe_path('p', target).read_bytes()
    with pytest.raises(ValueError):
        controls.apply('p', work['id'], {'revision': work['revision']})
    assert store._safe_path('p', target).read_bytes() == before
    assert controls.amendment('p', work['id'])['status'] == 'draft'


def test_trial_isolation_discard_and_adoption_use_version_and_content_locks(store):
    original = '开头。原段。结尾。'
    store.write_md('p', 'drafts/chapter_001.md', original)
    authoring = suggestion_service(store, None).authoring
    service = TrialService(store, authoring)
    before = {str(path.relative_to(store._project_dir('p'))): path.read_bytes()
              for directory in ['cards', 'canon', 'drafts'] for path in store._safe_path('p', directory).rglob('*') if path.is_file()}
    first = service.create('p', 'chapter_001', {'start': 3, 'end': 6, 'text': '另一种写法。'})
    first = service.update('p', first['id'], {'revision': first['revision'], 'text': '仅试写，未采用。'})
    service.discard('p', first['id'], {'revision': first['revision']})
    for path, contents in before.items():
        assert store._safe_path('p', path).read_bytes() == contents
    stale = service.create('p', 'chapter_001', {'text': '迟来的试写'})
    store.write_md('p', 'drafts/chapter_001.md', '作者的新正文。')
    with pytest.raises(FileExistsError):
        service.apply('p', stale['id'], {'revision': stale['revision']})
    assert not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
    locked = service.create('p', 'chapter_001', {'text': '不该绕锁的试写'})
    AuthorControlService(store).confirm('p', {'targets': [{'target': 'drafts/chapter_001.md', 'paths': ['/'],
        'base_revision': revision(store, 'p', 'drafts/chapter_001.md')}]})
    with pytest.raises(FileExistsError):
        service.apply('p', locked['id'], {'revision': locked['revision']})
    assert store.read_md('p', 'drafts/chapter_001.md') == '作者的新正文。'
    assert not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
    store.write_md('p', 'drafts/chapter_002.md', original)
    fresh = service.create('p', 'chapter_002', {'start': 3, 'end': 6, 'text': '确认采用。'})
    accepted = service.apply('p', fresh['id'], {'revision': fresh['revision']})
    assert accepted['status'] == 'applied'
    assert store.read_md('p', 'drafts/chapter_002.md') == original[:3] + '确认采用。' + original[6:]
    assert len(store.read_jsonl('p', 'drafts/chapter_002.patch.jsonl')) == 1
    assert service.apply('p', fresh['id'], {'revision': fresh['revision']})['status'] == 'applied'
    assert len(store.read_jsonl('p', 'drafts/chapter_002.patch.jsonl')) == 1


def test_late_trial_ai_does_not_overwrite_manual_trial_or_formal_text(store):
    async def scenario():
        original = '正式正文保持。'
        store.write_md('p', 'drafts/chapter_001.md', original)
        store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
        store.write_json('p', 'drafts/chapter_001.meta.json', {'title': '第一章'})
        formal_meta = store._safe_path('p', 'drafts/chapter_001.meta.json').read_bytes()
        entered, release, calls = asyncio.Event(), asyncio.Event(), []

        async def complete(*args, **kwargs):
            assert kwargs['prepare_memory'] is False
            calls.append(args)
            kwargs['usage_callback']({'module': 'chapter_writer', 'provider': 'fake', 'model': 'isolated',
                                      'prompt_tokens': 8, 'completion_tokens': 3, 'total_tokens': 11, 'estimated': False})
            entered.set()
            await release.wait()
            return '晚到的AI试写。'

        service = TrialService(store, suggestion_service(store, complete).authoring)
        draft = service.create('p', 'chapter_001', {'text': '原试写稿'})
        task = asyncio.create_task(service.generate('p', draft['id'], {'revision': draft['revision']}))
        await asyncio.wait_for(entered.wait(), timeout=2)
        current = service.get('p', draft['id'])
        manual = service.update('p', draft['id'], {'revision': current['revision'], 'text': '作者在等待时手改的试写。'})
        release.set()
        with pytest.raises(FileExistsError):
            await task
        latest = service.get('p', draft['id'])
        assert latest['text'] == manual['text'] and latest['status'] == 'draft'
        assert len(calls) == 1 and latest['usage']['total_tokens'] == 11
        assert store.read_md('p', 'drafts/chapter_001.md') == original
        assert store._safe_path('p', 'drafts/chapter_001.meta.json').read_bytes() == formal_meta
        assert not store.read_jsonl('p', 'canon/facts.jsonl') and not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')

    asyncio.run(scenario())


def test_world_period_region_and_story_local_override_preserve_shared_base(store):
    card(store, 'world_1', 'world', {'rules': ['夜潮封港'], 'summary': '原世界'})
    card(store, 'world_2', 'world', {'rules': ['别的世界']})
    card(store, 'period_old', 'world', {'parent_id': 'world_1', 'entry_type': 'period', 'time': {'year': 1900}})
    card(store, 'region_north', 'world', {'parent_id': 'world_1', 'entry_type': 'region', 'summary': '北岸'})
    card(store, 'region_other', 'world', {'parent_id': 'world_2', 'entry_type': 'region'})
    service = WorldScopeService(store)
    options = service.options('p', 'world_1')
    assert [row['id'] for row in options['periods']] == ['period_old']
    assert [row['id'] for row in options['regions']] == ['region_north']
    target = 'cards/world_1.yaml'
    scope = {'world_id': 'world_1', 'period_id': 'period_old', 'region_ids': ['region_north'],
             'overrides': [{'target_id': 'world_1', 'path': ['payload', 'rules'], 'base_revision': revision(store, 'p', target),
                            'before': ['夜潮封港'], 'after': ['此故事北岸临时开放']} ]}
    before = store._safe_path('p', target).read_bytes()
    resolved = service.resolve('p', world_context=scope)
    assert resolved['scope']['time']['year'] == 1900
    state = AuthorDataService(store).author_state('p', world_context=scope)
    world = next(row for row in state['worlds'] if row['id'] == 'world_1')
    assert world['state']['rules'] == ['此故事北岸临时开放']
    assert store._safe_path('p', target).read_bytes() == before
    with pytest.raises(ValueError):
        service.resolve('p', world_context={**scope, 'region_ids': ['region_other']})
    with pytest.raises(ValueError):
        service.resolve('p', world_context={**scope, 'overrides': [{**scope['overrides'][0], 'target_id': 'world_2'}]})
    edited = store.read_yaml('p', target)
    edited['payload']['rules'] = ['原世界已由作者更新']
    store.write_yaml('p', target, edited)
    with pytest.raises(FileExistsError):
        AuthorDataService(store).author_state('p', world_context=scope)
    assert store.read_yaml('p', target)['payload']['rules'] == ['原世界已由作者更新']


def test_zip_restore_preserves_order_typed_sources_locks_and_never_resumes_tasks(store):
    card(store, 'world_1', 'world', {'rules': ['规则原文']})
    card(store, 'person_a', 'character', {'name': '甲', 'identity': ''})
    store.write_md('p', 'drafts/chapter_001.md', '作者正文。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_002\nchapter_001')
    service = InformationService(store)
    service.save('p', {'id': 'key_info', 'label': '钥匙', 'truth_status': 'undecided', 'sources': [{'url': 'https://example.invalid/source', 'fetched_at': '2026-11-14T00:21:00+08:00'}]})
    service.add_record('p', 'key_info', {'record_type': 'awareness', 'status': 'confirmed', 'scope': {'time': {'year': 2020}},
        'source': {'kind': 'author'}, 'data': {'character_id': 'person_a', 'state': 'suspects', 'value': '钥匙可能在北岸'}})
    AuthorControlService(store).confirm('p', {'targets': [{'target': 'cards/world_1.yaml', 'paths': ['/payload/rules'],
        'base_revision': revision(store, 'p', 'cards/world_1.yaml')}]})
    for directory, status in [('meta/jobs', 'running'), ('meta/writing_runs', 'queued'), ('sessions/trials', 'generating')]:
        store.write_json('p', directory + '/pending.json', {'id': 'pending', 'status': status})
    imports = MaterialImportService(store)
    batch = imports.create('p', {'purpose': 'world'}, raw='原始参考材料。'.encode(), filename='参考.txt')
    preserved = {path: store._safe_path('p', path).read_bytes() for path in [
        'drafts/.chapter_order', 'drafts/chapter_001.md', 'cards/world_1.yaml', 'cards/outline_author_registry.yaml',
        'canon/author_stages.jsonl', 'canon/author_controls.jsonl']}
    preserved[f"sessions/material_imports/{batch['id']}.json"] = store._safe_path('p', f"sessions/material_imports/{batch['id']}.json").read_bytes()
    preserved[batch['source']['raw_path']] = store._safe_path('p', batch['source']['raw_path']).read_bytes()
    app = FastAPI()
    app.include_router(projects.router)
    app.dependency_overrides[projects.get_store] = lambda: store
    with TestClient(app) as client:
        response = client.get('/api/projects/p/export.zip')
        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert 'p/drafts/.chapter_order' in archive.namelist()
        response = client.post('/api/projects/import.zip', files={'file': ('roundtrip.zip', response.content, 'application/zip')})
        assert response.status_code == 200, response.text
        restored = response.json()['project_id']
    for path, raw in preserved.items():
        assert store._safe_path(restored, path).read_bytes() == raw
    restored_batch = MaterialImportService(store).get(restored, batch['id'])
    assert restored_batch['source']['url_preview'].startswith(f'/api/projects/{restored}/')
    assert all(source['url_preview'].startswith(f'/api/projects/{restored}/') for source in restored_batch['sources'])
    assert store._safe_path(restored, f"sessions/material_imports/{batch['id']}.json").read_bytes() == preserved[f"sessions/material_imports/{batch['id']}.json"]
    assert store.read_json(restored, 'meta/jobs/pending.json')['status'] == 'failed'
    assert store.read_json(restored, 'meta/writing_runs/pending.json')['status'] == 'failed'
    assert store.read_json(restored, 'sessions/trials/pending.json')['status'] == 'needs_retry'
    value = store.read_yaml(restored, 'cards/world_1.yaml')
    value['payload']['rules'] = ['恢复后不能绕锁']
    with pytest.raises(FileExistsError):
        store.write_yaml(restored, 'cards/world_1.yaml', value)


def test_mixed_import_sources_and_targeted_completion_do_not_publish_or_overwrite(store):
    async def scenario():
        calls, outputs = [], []

        async def complete(*args, **kwargs):
            calls.append(args)
            return json.dumps(outputs.pop(0), ensure_ascii=False)

        service = MaterialImportService(store, suggestion_service(store, complete).authoring)
        batch = service.create('p', {'purpose': 'world', 'text': '港口每晚封闭。'})
        original_source = copy.deepcopy(batch['source'])
        batch = service.add_source('p', batch['id'], {'base_revision': batch['revision']}, raw='北岸只有一座灯塔。'.encode(), filename='北岸.txt')
        assert len(batch['sources']) == 2 and batch['source'] == original_source
        same = service.add_source('p', batch['id'], {'base_revision': batch['revision']}, raw='北岸只有一座灯塔。'.encode(), filename='北岸.txt')
        assert len(same['sources']) == 2 and same['revision'] == batch['revision']
        batch = service.update('p', batch['id'], {'base_revision': batch['revision'], 'candidates': [
            {'id': 'world_candidate', 'kind': 'world', 'values': {'name': '临港', 'summary': '作者已有说明', 'rules': [], 'limits': []}}]})
        outputs.append({'changes': [{'candidate_id': 'world_candidate', 'values': {'name': '不该改名', 'summary': '不该改说明', 'rules': ['港口每晚封闭'], 'limits': ['越权内容']},
            'evidence': [{'quote': '港口每晚封闭。', 'source_id': original_source['id']}]}]})
        batch = await service.complete('p', batch['id'], {'base_revision': batch['revision'], 'target_ids': ['world_candidate'], 'paths': ['rules', 'summary'], 'mode': 'faithful'})
        candidate = batch['candidates'][0]
        assert candidate['values'] == {'name': '临港', 'summary': '作者已有说明', 'rules': ['港口每晚封闭'], 'limits': []}
        assert candidate['field_provenance']['rules'] == 'material_fact'
        batch = await service.complete('p', batch['id'], {'base_revision': batch['revision'], 'target_ids': ['world_candidate'], 'paths': ['rules'], 'mode': 'faithful'})
        assert len(calls) == 1
        outputs.append({'changes': [{'candidate_id': 'world_candidate', 'values': {'limits': ['无原文依据的能力限制']}, 'evidence': []}]})
        batch = await service.complete('p', batch['id'], {'base_revision': batch['revision'], 'target_ids': ['world_candidate'], 'paths': ['limits'], 'mode': 'faithful'})
        assert batch['candidates'][0]['values']['limits'] == []
        outputs.append({'changes': [{'candidate_id': 'world_candidate', 'values': {'limits': ['作者主动要求的改编限制']}, 'evidence': []}]})
        batch = await service.complete('p', batch['id'], {'base_revision': batch['revision'], 'target_ids': ['world_candidate'], 'paths': ['limits'], 'mode': 'adaptation'})
        assert batch['candidates'][0]['field_provenance']['limits'] == 'ai_addition'
        assert batch['candidates'][0]['values']['summary'] == '作者已有说明'
        assert not list(store._safe_path('p', 'cards').glob('*.yaml'))
        assert not store.read_jsonl('p', 'canon/facts.jsonl')
        adopted = service.apply('p', batch['id'], {'base_revision': batch['revision'], 'selected_ids': ['world_candidate']})
        saved = store.read_yaml('p', f"cards/{adopted['results'][0]['target_id']}.yaml")
        assert saved['payload']['field_provenance']['rules'] == 'material_fact'
        assert saved['payload']['field_provenance']['limits'] == 'ai_addition'
        assert saved['payload']['field_provenance']['summary'] == 'author_edit'

    asyncio.run(scenario())


def test_import_lock_preflight_blocks_whole_apply_and_undo_before_partial_publish(store):
    card(store, 'world_1', 'world', {'summary': '可改的原说明'})
    card(store, 'world_2', 'world', {'summary': '锁定的原说明'})
    controls = AuthorControlService(store)
    controls.confirm('p', {'targets': [{'target': 'cards/world_2.yaml', 'paths': ['/payload/summary'],
        'base_revision': revision(store, 'p', 'cards/world_2.yaml')}]})
    service = MaterialImportService(store)
    batch = service.create('p', {'purpose': 'world', 'text': '两地改写资料'})
    batch = service.update('p', batch['id'], {'base_revision': batch['revision'], 'candidates': [
        {'id': 'first', 'kind': 'world', 'target_id': 'world_1', 'values': {'summary': '第一份新说明'}},
        {'id': 'second', 'kind': 'world', 'target_id': 'world_2', 'values': {'summary': '第二份新说明'}}]})
    saved = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError):
        service.apply('p', batch['id'], {'base_revision': batch['revision'], 'selected_ids': ['first', 'second'],
                      'decisions': {'first': {'mode': 'replace'}, 'second': {'mode': 'replace'}}})
    assert saved == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    batch = service.create('p', {'purpose': 'world', 'text': '新资料甲与新资料乙'})
    batch = service.update('p', batch['id'], {'base_revision': batch['revision'], 'candidates': [
        {'id': 'new_first', 'kind': 'world', 'values': {'summary': '新资料甲'}},
        {'id': 'new_second', 'kind': 'world', 'values': {'summary': '新资料乙'}}]})
    adopted = service.apply('p', batch['id'], {'base_revision': batch['revision'], 'selected_ids': ['new_first', 'new_second']})
    locked_id = adopted['results'][1]['target_id']
    controls.confirm('p', {'targets': [{'target': f'cards/{locked_id}.yaml', 'paths': ['/payload/summary'],
        'base_revision': revision(store, 'p', f'cards/{locked_id}.yaml')}]})
    saved = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError):
        service.undo('p', batch['id'], {'base_revision': adopted['revision']})
    assert saved == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    external = service.create('p', {'purpose': 'world', 'text': '有后写引用的新地区'})
    external = service.update('p', external['id'], {'base_revision': external['revision'], 'candidates': [
        {'id': 'new_place', 'kind': 'world', 'values': {'name': '潮汐站', 'entry_type': 'place'}}]})
    external = service.apply('p', external['id'], {'base_revision': external['revision'], 'selected_ids': ['new_place']})
    new_id = external['results'][0]['target_id']
    card(store, 'later_reference', 'outline', {'material_ids': [new_id]})
    saved = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError) as held:
        service.undo('p', external['id'], {'base_revision': external['revision']})
    assert held.value.impact and any('later_reference' in row['source'] for row in held.value.impact)
    assert saved == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    store._safe_path('p', 'cards/later_reference.yaml').unlink()
    assert service.undo('p', external['id'], {'base_revision': external['revision']})['status'] == 'undone'


def test_late_targeted_completion_keeps_manual_candidates_and_records_used_model_cost(store):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def complete(*args, **kwargs):
            kwargs['usage_callback']({'module': 'setup_story', 'provider': 'fake', 'model': 'isolated',
                                      'prompt_tokens': 7, 'completion_tokens': 4, 'total_tokens': 11, 'estimated': False})
            entered.set()
            await release.wait()
            return json.dumps({'changes': [{'candidate_id': 'one', 'values': {'rules': ['晚到的AI规则']}}]}, ensure_ascii=False)

        service = MaterialImportService(store, suggestion_service(store, complete).authoring)
        batch = service.create('p', {'purpose': 'world', 'text': '港口材料。'})
        batch = service.update('p', batch['id'], {'base_revision': batch['revision'], 'candidates': [
            {'id': 'one', 'kind': 'world', 'values': {'summary': '原工作稿', 'rules': []}}]})
        task = asyncio.create_task(service.complete('p', batch['id'], {'base_revision': batch['revision'], 'target_ids': ['one'], 'paths': ['rules'], 'mode': 'adaptation'}))
        await asyncio.wait_for(entered.wait(), timeout=2)
        current = service.get('p', batch['id'])
        manual = service.update('p', batch['id'], {'base_revision': current['revision'], 'candidates': [
            {'id': 'one', 'kind': 'world', 'values': {'summary': '作者等待时的手稿', 'rules': ['作者自写规则']}}]})
        release.set()
        with pytest.raises(FileExistsError):
            await task
        latest = service.get('p', batch['id'])
        assert latest['candidates'] == manual['candidates']
        assert latest['usage']['total_tokens'] == 11 and latest['usage_calls'][0]['attempt_status'] == 'stale'
        assert not list(store._safe_path('p', 'cards').glob('*.yaml'))

    asyncio.run(scenario())


def test_amendment_publish_and_restore_retry_once_and_atomic_writes_keep_old_bytes(store, monkeypatch):
    controls = AuthorControlService(store)
    target = 'drafts/chapter_001.md'
    store.write_md('p', target, '正式原稿。')
    controls.confirm('p', {'targets': [{'target': target, 'paths': ['/'], 'base_revision': revision(store, 'p', target)}]})
    work = controls.start('p', {'target': target, 'paths': ['/'], 'base_revision': revision(store, 'p', target)})
    work = controls.update('p', work['id'], {'revision': work['revision'], 'changes': {'/': '指定采用的新稿。'}})
    save = controls._save

    def fail_applied(project, record):
        if record['status'] == 'applied':
            raise OSError('模拟正式写入后工作稿保存中断')
        return save(project, record)

    with monkeypatch.context() as patch:
        patch.setattr(controls, '_save', fail_applied)
        with pytest.raises(OSError, match='中断'):
            controls.apply('p', work['id'], {'revision': work['revision']})
    pending = controls.amendment('p', work['id'])
    assert pending['status'] == 'applying' and store.read_md('p', target) == '指定采用的新稿。'
    applied = controls.apply('p', work['id'], {'revision': pending['revision']})
    assert applied['status'] == 'applied'
    assert len(store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')) == 1
    assert len([row for row in store.read_json('p', 'drafts/chapter_001.meta.json')['versions'] if row.get('patch_id') == work['id']]) == 1
    assert len([row for row in store.read_jsonl('p', 'canon/author_controls.jsonl') if row.get('amendment_id') == work['id']]) == 1

    world_target = 'cards/world_1.yaml'
    card(store, 'world_1', 'world', {'rules': ['旧规则'], 'summary': '旧说明'})
    controls.confirm('p', {'targets': [{'target': world_target, 'paths': ['/payload/rules'], 'base_revision': revision(store, 'p', world_target)}]})
    world_work = controls.start('p', {'target': world_target, 'paths': ['/payload/rules'], 'base_revision': revision(store, 'p', world_target)})
    world_work = controls.update('p', world_work['id'], {'revision': world_work['revision'], 'changes': {'/payload/rules': ['新规则']}})
    adopted = controls.apply('p', world_work['id'], {'revision': world_work['revision']})
    later = store.read_yaml('p', world_target)
    later['payload']['summary'] = '采用后另写的说明，不该恢复掉'
    store.write_yaml('p', world_target, later)

    def fail_restored(project, record):
        if record['status'] == 'restored':
            raise OSError('模拟恢复已写后工作稿保存中断')
        return save(project, record)

    with monkeypatch.context() as patch:
        patch.setattr(controls, '_save', fail_restored)
        with pytest.raises(OSError, match='中断'):
            controls.apply('p', world_work['id'], {'revision': adopted['revision']}, restore=True)
    pending = controls.amendment('p', world_work['id'])
    assert pending['status'] == 'restoring'
    restored = controls.apply('p', world_work['id'], {'revision': pending['revision']}, restore=True)
    assert restored['status'] == 'restored'
    assert store.read_yaml('p', world_target)['payload'] == {'rules': ['旧规则'], 'summary': '采用后另写的说明，不该恢复掉'}
    assert len([row for row in store.read_jsonl('p', 'canon/author_controls.jsonl') if row.get('amendment_id') == world_work['id'] and row['kind'] == 'restored']) == 1

    for path, writer, old, new in [
        ('cards/unlocked.yaml', store.write_yaml, {'name': '旧资料'}, {'name': '新资料'}),
        ('sessions/unlocked.json', store.write_json, {'value': '旧值'}, {'value': '新值'}),
        ('drafts/unlocked.md', store.write_md, '旧稿不能截断', '新稿'),
    ]:
        writer('p', path, old)
        destination, raw = store._safe_path('p', path), store._safe_path('p', path).read_bytes()
        original_replace = Path.replace

        def fail_replace(source, target):
            if Path(target) == destination:
                raise OSError('模拟原子替换失败')
            return original_replace(source, target)

        with monkeypatch.context() as patch:
            patch.setattr(Path, 'replace', fail_replace)
            with pytest.raises(OSError, match='替换失败'):
                writer('p', path, new)
        assert destination.read_bytes() == raw
        assert not list(destination.parent.glob(destination.name + '.*.tmp'))


def test_character_details_keep_stable_stage_identity_scope_and_author_private_boundary(store):
    card(store, 'world_1', 'world', {})
    card(store, 'person_b', 'character', {'name': '乙', 'identity': ''})
    card(store, 'person_c', 'character', {'name': '丙', 'identity': ''})
    complete_focus = ''.join(f'{number:04d}：他停下脚步，把话讲完，再看向对方。\n' for number in range(200))[:3200]
    sections = [
        {'id': 'habit', 'title': '紧张时', 'content': '起点习惯', 'usage': 'relevant', 'sources': ['作者原设定']},
        {'id': 'remove_later', 'title': '后来放下', 'content': '旧习惯', 'usage': 'relevant'},
        {'id': 'private', 'title': '作者秘密', 'content': 'PRIVATE_DETAIL_NEVER_MODEL', 'usage': 'author_only'},
        {'id': 'for_b', 'title': '面对乙', 'content': '只在乙面前调整措辞', 'usage': 'relevant', 'target_ids': ['person_b']},
        {'id': 'for_c', 'title': '面对丙', 'content': '不属于当前对象', 'usage': 'focus', 'target_ids': ['person_c']},
        {'id': 'complete_focus', 'title': '这次完整带入', 'content': complete_focus, 'usage': 'relevant'},
    ]
    base = card(store, 'person_a', 'character', {'name': '甲', 'identity': '', 'detail_sections': sections})
    validate_detail_sections(store, 'p', sections)
    with pytest.raises(ValueError):
        validate_detail_sections(store, 'p', [sections[0], sections[0]])
    before = store._safe_path('p', 'cards/person_a.yaml').read_bytes()
    author = AuthorDataService(store)
    changed = author.add_stage('p', 'character', 'person_a', {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 2010}},
        'changes': {'detail_sections': [{**sections[0], 'content': '经历后不再回避目光'}, {'id': 'remove_later', 'removed': True}]}, 'source': {'kind': 'author'}})
    assert changed['changes']['detail_sections'][1] == {'id': 'remove_later', 'removed': True}
    history = store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()
    with pytest.raises(ValueError):
        author.add_stage('p', 'character', 'person_a', {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 2011}},
            'changes': {'detail_sections': [{'id': 'not_a_tombstone', 'title': '缺少正文'}]}, 'source': {'kind': 'author'}})
    assert store._safe_path('p', 'canon/author_stages.jsonl').read_bytes() == history
    author.add_stage('p', 'character', 'person_a', {'status': 'confirmed', 'scope': {'world_id': 'world_1', 'time': {'year': 2030}},
        'changes': {'detail_sections': [{**sections[0], 'content': '未来终局习惯不得提前'}]}, 'source': {'kind': 'author'}})
    scope = {'world_id': 'world_1', 'time': {'year': 2020}}
    state = author.character_state('p', 'person_a', world_context=scope)['state']
    assert {row['id'] for row in state['detail_sections']} == {'habit', 'private', 'for_b', 'for_c', 'complete_focus'}
    assert next(row['content'] for row in state['detail_sections'] if row['id'] == 'habit') == '经历后不再回避目光'
    selected = select_character_details(store, 'p', {**base, 'payload': state}, scope,
                                        {'cast': ['person_a', 'person_b']}, focus_ids=['private', 'for_c', 'complete_focus'])
    assert {row['id'] for row in selected} == {'habit', 'for_b', 'complete_focus'}
    assert len(complete_focus) == 3200 and next(row['content'] for row in selected if row['id'] == 'complete_focus') == complete_focus
    assert 'PRIVATE_DETAIL_NEVER_MODEL' not in json.dumps(selected)
    assert store._safe_path('p', 'cards/person_a.yaml').read_bytes() == before
    early = author.character_state('p', 'person_a', world_context={'world_id': 'world_1', 'time': {'year': 2000}})['state']
    assert early['detail_sections'] == sections


def test_author_only_details_are_absent_at_actual_gateway_across_authoring_paths(store, monkeypatch):
    async def scenario():
        private = 'PRIVATE_SENTINEL_DO_NOT_SEND_20261114'
        public = '面对乙时先把话说完整，再移开视线'
        scope = {'world_id': 'world_1', 'time': {'year': 2020}}
        card(store, 'world_1', 'world', {})
        person = card(store, 'person_a', 'character', {'name': '阿青', 'identity': '信使',
            'sources': [{'path': 'sessions/original-reference.txt', 'quote': private, 'note': private}], 'detail_sections': [
            {'id': 'public', 'title': '交往细节', 'content': public, 'usage': 'focus'},
            {'id': 'private', 'title': '作者私密底稿', 'content': private, 'usage': 'author_only'}]})
        card(store, 'person_b', 'character', {'name': '乙', 'identity': '守门人'})
        card(store, 'story_1', 'story', {'world_context': scope, 'important_scenes': [
            {'id': 'meeting', 'scene': '门边交谈', 'chapter': 'chapter_001', 'characters': ['person_a', 'person_b'], 'cast': ['person_a', 'person_b']}]})
        store.write_md('p', 'drafts/chapter_001.md', '阿青走到门边，把信递给乙。')
        store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
        store.write_json('p', 'drafts/chapter_001.meta.json', {'story_card_id': 'story_1', 'world_context': scope, 'material_ids': ['person_a']})
        prompts, outputs = [], []

        class Gateway:
            async def chat_complete(self, messages, model, *args):
                prompts.append(copy.deepcopy(messages))
                return {'text': outputs.pop(0), 'usage': {'prompt_tokens': 2, 'completion_tokens': 2, 'total_tokens': 4, 'estimated': False}}

        manager = SimpleNamespace(store=store, llm_gateway=Gateway(), context_engine=SimpleNamespace(kb=KBService(store)),
            _resolve_profile=lambda p, body, module: ('isolated', {'provider': 'ollama', 'model': module, 'base_url': 'http://not-called.invalid'}, None))
        authoring = AuthoringService(manager)
        pack, _ = ContextPackService(store).build('p', 'chapter_001', {'included_cards': [person], 'generation_control': {
            'world_context': scope, 'character_detail_focus': {'person_a': ['private']}}}, {'场景': {'cast': ['person_a', 'person_b']}})
        assert private not in pack and public in pack
        outputs.append('{"value":"新的候选身份"}')
        await authoring.generate_field('p', {'card': person, 'path': ['payload', 'identity'], 'world_context': scope})
        rehearsal = SceneRehearsalService(store, authoring)
        current = rehearsal.get('p', 'story_1', 'meeting')
        outputs.append('{"draft":{"text":"阿青递信，乙接过后追问来意。","outcome":"信件已交付","next_question":"乙会不会放行？","technique_ids":[],"technique_applications":[]},"literary_impacts":[]}')
        await rehearsal.propose('p', 'story_1', 'meeting', {key: current[key] for key in ['draft', 'source_versions', 'base_hash']})
        text = store.read_md('p', 'drafts/chapter_001.md')
        outputs.append('阿青来到门边，将信交到乙手里。')
        revision_candidate = await authoring.revise('p', 'chapter_001', {'source_text': text, 'mode': 'cinematic', 'story_card_id': 'story_1',
            'scene_direction': {'prose_strategy': 'spatial_flow'}, 'allow_plot_change': False,
            'expression_style': '克制简洁，短句', 'emotional_atmosphere': '紧张中带一点迟疑'})
        assert revision_candidate['candidate_kind'] == 'expression_only' and store.read_md('p', 'drafts/chapter_001.md') == text
        cinematic = json.loads(prompts[-1][-1]['content'])
        assert cinematic['文字风格'] == '克制简洁，短句' and cinematic['情绪氛围'] == '紧张中带一点迟疑'
        for mode in ['rewrite', 'polish']:
            outputs.append(text)
            before_calls = len(prompts)
            await authoring.revise('p', 'chapter_001', {'source_text': text, 'mode': mode,
                'expression_style': '作者自定义写法', 'emotional_atmosphere': '宁静但不安', 'instructions': '注意修顺衔接'})
            requested = json.loads(prompts[-1][-1]['content'])
            assert len(prompts) == before_calls + 1 and requested['待修改段落'] == text
            assert requested['文字风格'] == ('作者自定义写法' if mode == 'rewrite' else '')
            assert requested['情绪氛围'] == ('宁静但不安' if mode == 'rewrite' else '')
            assert requested['作者要求'] == '注意修顺衔接'
        trials = TrialService(store, authoring)
        trial = trials.create('p', 'chapter_001', {'story_card_id': 'story_1'})
        outputs.append('阿青在门前停步，递出折好的信。')
        await trials.generate('p', trial['id'], {'revision': trial['revision'], 'scene_direction': {'prose_strategy': 'delayed_reveal'}})
        changed = copy.deepcopy(person)
        changed['payload']['detail_sections'][0]['content'] = '面对乙时先问清规矩，再递出信件'
        changed['payload']['detail_sections'][1]['content'] = private + '_CHANGED'
        store.write_yaml('p', 'cards/person_a.yaml', changed)
        changes = ChangeSuggestionService(store, authoring)
        queued = changes.enqueue('p', 'person_a', person, changed)
        assert queued['queued_count'] == 1
        monkeypatch.setitem(change_module._EDITED_AT, str(store._project_dir('p')), 0)
        outputs.append('{"changes":[]}')
        await changes.process('p', queued['task_ids'])
        assert len(prompts) == 7 and not outputs
        for label, messages in zip(['field', 'scene', 'cinematic', 'rewrite', 'polish', 'trial', 'change_suggestion'], prompts):
            assert private not in json.dumps(messages, ensure_ascii=False), label
        assert any(public in json.dumps(messages, ensure_ascii=False) for messages in prompts)
        assert 'spatial_flow' in prompts[2][-1]['content'] and 'delayed_reveal' in prompts[5][-1]['content']
        assert store.read_yaml('p', 'cards/person_a.yaml')['payload']['sources'][0]['quote'] == private

    asyncio.run(scenario())


def test_prose_strategy_uses_original_pipeline_calls_and_reviews_only_verifiable_range(store, monkeypatch):
    async def scenario():
        from services.generation_material_service import GenerationMaterialService
        from services.context_pack_service import MaterialBudgetError

        scope = {'world_id': 'world_1', 'time': {'year': 1930}}
        private = 'PRIVATE_WRITER_AND_REVIEWER_BOUNDARY'
        complete_focus = ''.join(f'{number:04d}：先看门闩，再判断此刻目标是否值得开门。\n' for number in range(240))[:3200]
        full_rule = '夜潮时不得开启外港。' + '仅以当前登记和潮位为准。' * 220 + '条件：潮位回落且值守者核准。例外：救生船可先通行后补登记。'
        card(store, 'world_1', 'world', {'summary': '河港', 'rules': [full_rule], 'canon_status': 'canon'})
        card(store, 'person_a', 'character', {'name': '阿青', 'identity': '信使', 'detail_sections': [
            {'id': 'private', 'title': '作者底稿', 'content': private, 'usage': 'author_only'},
            {'id': 'habit', 'title': '注意对象', 'content': complete_focus, 'usage': 'relevant'}]})
        card(store, 'style_001', 'style', {'style_guide': {'pov': '有限第三人称'}})
        card(store, 'outline_001', 'outline', {'beats': []})
        store.write_md('p', 'drafts/chapter_001.md', '')
        store.write_md('p', 'drafts/.chapter_order', 'chapter_001')
        store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': scope, 'pov_character_id': 'person_a'})
        store.write_json('p', 'cards/blueprint_1.json', {'id': 'blueprint_1', 'scene_plan': [
            {'cast': ['person_a'], 'purpose': '递信', 'situation': '走到门边交付信件', 'beats': []}]})
        calls = []
        sample = '阿青推开门。' + '他沿着墙根走到窗下，停住脚步。' * 1200

        class Gateway:
            async def chat_stream(self, messages, model, *args):
                calls.append((model, copy.deepcopy(messages)))
                yield sample

            async def chat_complete(self, messages, model, *args):
                calls.append((model, copy.deepcopy(messages)))
                if model == 'chapter_reviewer':
                    text = json.dumps({'issues': [
                        {'category': 'space_action', 'issue': '供作者判断的空间建议', 'quote': '阿青推开门。'},
                        {'category': 'repetition', 'issue': '无法回查的模型建议', 'quote': '这句话根本不在正文里'}]}, ensure_ascii=False)
                else:
                    text = '{"ops":[]}'
                return {'text': text, 'usage': {'prompt_tokens': 2, 'completion_tokens': 2, 'total_tokens': 4, 'estimated': False}}

        manager = JobManager(store, ContextEngine(store, KBService(store)), Gateway())
        window = [200000]
        monkeypatch.setattr(manager, '_resolve_profile', lambda p, body, module='writer': ('isolated',
            {'provider': 'ollama', 'model': module, 'base_url': 'http://not-called.invalid', 'context_window': window[0]},
            {'provider': 'ollama', 'model': module, 'base_url': 'http://not-called.invalid'}))
        payload = {'chapter_id': 'chapter_001', 'blueprint_id': 'blueprint_1', 'scene_index': 0,
            'writing_run': {'chapter_id': 'chapter_001', 'scene_index': 0, 'label': '本章'},
            'generation_control': {'world_context': scope, 'pov_character_id': 'person_a', 'character_detail_focus': {'person_a': ['habit']},
                'scene_direction': {'prose_strategy': 'spatial_flow'}}, 'auto_apply_patch': False}
        materials = GenerationMaterialService(manager)
        preview = materials.prepare('p', payload)
        prepared = materials.load('p', payload, preview['fingerprint'])
        assert preview['ready'] and not calls and prepared['manifest']['generation_materials'] == preview
        assert preview['request_status'] == 'prepared' and preview['sent'] is False
        assert next(item for item in preview['items'] if item['id'] == 'person_a:detail:habit')['text'] == complete_focus
        assert full_rule in json.loads(next(item for item in preview['items'] if item['id'] == 'world_1')['text'])['设定']['rules']
        payload['generation_control']['material_preview_fingerprint'] = preview['fingerprint']
        await manager._pipeline('job_prose', 'p', payload)
        job = manager.get_job('p', 'job_prose')
        assert job['status'] == 'completed', job.get('last_error')
        assert [model for model, _ in calls] == ['chapter_writer', 'chapter_reviewer', 'proofreader']
        assert calls[0][1] == prepared['messages']
        actual = job['context_manifest']['generation_materials']
        assert {key: value for key, value in actual.items() if key not in {'request_status', 'sent'}} == {
            key: value for key, value in preview.items() if key not in {'request_status', 'sent'}}
        assert actual['request_status'] == 'sent' and actual['sent'] is True
        assert 'spatial_flow' in calls[0][1][-1]['content']
        assert all(private not in json.dumps(messages, ensure_ascii=False) for _, messages in calls)
        review = next(row['data'] for row in job['events'] if row['event'] == 'CRITIC_REVIEW')
        assert review['format'] == 'structured' and review['coverage']['partial'] is True
        assert review['coverage']['examined_chars'] == 18000 < review['coverage']['total_chars']
        assert review['issues'][0]['support_level'] == 'supported' and review['issues'][0]['evidence']['quote'] == '阿青推开门。'
        assert review['issues'][1]['support_level'] == 'unsupported' and review['issues'][1]['evidence']['quote'] == ''
        assert not store.read_jsonl('p', 'canon/facts.jsonl')
        assert not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
        saved_draft = store._safe_path('p', 'drafts/chapter_001.md').read_bytes()
        next_preview = materials.prepare('p', payload)
        world = store.read_yaml('p', 'cards/world_1.yaml')
        world['payload']['rules'].append('作者在核对后新增的正式例外。')
        store.write_yaml('p', 'cards/world_1.yaml', world)
        payload['generation_control']['material_preview_fingerprint'] = next_preview['fingerprint']
        with pytest.raises(FileExistsError):
            materials.load('p', payload)
        await manager._pipeline('job_stale_preview', 'p', payload)
        assert len(calls) == 3 and manager.get_job('p', 'job_stale_preview')['status'] != 'completed'
        window[0] = 3000
        blocked = materials.prepare('p', payload)
        assert not blocked['ready'] and blocked['overflow'] and blocked['budget']['estimated'] is True
        assert blocked['budget']['estimated_input_tokens'] + blocked['budget']['output_reserved_tokens'] > 3000
        payload['generation_control']['material_preview_fingerprint'] = blocked['fingerprint']
        with pytest.raises(MaterialBudgetError):
            materials.load('p', payload)
        await manager._pipeline('job_budget_blocked', 'p', payload)
        assert len(calls) == 3 and manager.get_job('p', 'job_budget_blocked')['status'] != 'completed'
        window[0] = 200000
        payload['generation_control']['character_detail_focus']['person_a'].append('private')
        private_focus = materials.prepare('p', payload)
        assert not private_focus['ready'] and private not in json.dumps(private_focus, ensure_ascii=False)
        assert any(item['id'] == 'person_a:detail:private' for item in private_focus['overflow'])
        assert store._safe_path('p', 'drafts/chapter_001.md').read_bytes() == saved_draft
        assert not store.read_jsonl('p', 'canon/facts.jsonl') and not store.read_jsonl('p', 'drafts/chapter_001.patch.jsonl')
        original_blueprint = store._safe_path('p', 'cards/blueprint_1.json').read_bytes()
        canonical = 'story_fallback:important_scenes:current'
        card(store, 'story_fallback', 'story', {'world_context': scope, 'important_scenes': [
            {'id': 'current', 'scene': '递信', 'plot': '甲当场递信，等待答复。', 'chapter': 'chapter_001', 'characters': ['person_a']},
            {'id': 'future', 'scene': '未来递信', 'plot': '不属于当前章。', 'chapter': 'chapter_002', 'characters': ['person_a']}]})
        card(store, 'outline_fallback', 'outline', {'story_card_id': 'story_fallback', 'planning_worksheet': True, 'important_scenes': [
            {'id': 'mapped', 'chapter': 'chapter_001', 'canonical_event_ref': {'owner_card_id': 'story_fallback', 'scene_id': 'current'}},
            {'id': 'unconfirmed', 'scene': '递信', 'plot': '同名但还未确认是同一事件。', 'chapter': 'chapter_001', 'characters': ['person_a']}]})
        fallback = copy.deepcopy(payload)
        fallback['blueprint_id'] = 'blueprint_001'
        fallback['generation_control'].pop('material_preview_fingerprint', None)
        fallback['generation_control'].update(story_card_id='story_fallback', character_detail_focus={'person_a': ['habit']})
        _, derived, _ = manager._validate_write_payload('p', fallback)
        assert derived['derived_from_saved_scenes'] is True
        assert {scene['scene_id'] for scene in derived['scene_plan']} == {canonical, 'outline_fallback:important_scenes:unconfirmed'}
        fallback['generation_control']['scene_ref'] = 'outline_fallback:important_scenes:mapped'
        _, selected_scene, _ = manager._validate_write_payload('p', fallback)
        assert [scene['scene_id'] for scene in selected_scene['scene_plan']] == [canonical]
        assert any('cards/story_fallback.yaml' in str(source) for source in selected_scene['sources'])
        valid = {**fallback, 'blueprint_id': 'blueprint_1'}
        assert manager._validate_write_payload('p', valid)[1]['scene_plan'] == json.loads(original_blueprint)['scene_plan']
        assert store._safe_path('p', 'cards/blueprint_1.json').read_bytes() == original_blueprint
        with pytest.raises(ValueError) as missing:
            manager._validate_write_payload('p', {**fallback, 'blueprint_id': 'blueprint_explicit_missing'})
        assert any('\u4e00' <= char <= '\u9fff' for char in str(missing.value))
        fallback_preview = materials.prepare('p', fallback)
        fallback_prepared = materials.load('p', fallback, fallback_preview['fingerprint'])
        assert fallback_preview['ready'] and fallback_prepared['scene']['scene_id'] == canonical
        assert 'cards/story_fallback.yaml' in fallback_preview['source_versions']
        fallback['generation_control']['material_preview_fingerprint'] = fallback_preview['fingerprint']
        await manager._pipeline('job_no_blueprint', 'p', fallback)
        assert manager.get_job('p', 'job_no_blueprint')['status'] == 'completed'
        assert len(calls) == 6 and calls[3][1] == fallback_prepared['messages']
        assert not store._safe_path('p', 'cards/blueprint_001.json').exists()
        card(store, 'empty_story', 'story', {'world_context': scope, 'important_scenes': []})
        empty = copy.deepcopy(fallback)
        empty['generation_control'].update(story_card_id='empty_story', scene_ref=None)
        with pytest.raises(ValueError) as no_scene:
            manager._validate_write_payload('p', empty)
        assert any('\u4e00' <= char <= '\u9fff' for char in str(no_scene.value))
        assert not store._safe_path('p', 'cards/blueprint_001.json').exists()
        from services.writing_run_service import WritingRunService
        story = store.read_yaml('p', 'cards/story_fallback.yaml')
        story['payload']['chapter_plan'] = [{'chapter_id': 'chapter_001', 'title': '第一章'}, {'chapter_id': 'chapter_002', 'title': '第二章'}]
        store.write_yaml('p', 'cards/story_fallback.yaml', story)
        store.write_json('p', 'drafts/chapter_002.meta.json', {'story_card_id': 'story_fallback',
            'world_context': {'world_id': 'world_1', 'time': {'year': 1940}},
            'writing_alignment': {'changes': 'SECOND_CHAPTER_ONLY', 'scene_direction': {'prose_strategy': 'focus_closure'}}})
        multi = copy.deepcopy(fallback)
        multi.pop('writing_run', None)
        multi.update(scope='chapters', start_chapter='chapter_001', end_chapter='chapter_002', stop_point='end')
        multi['generation_control'].pop('material_preview_fingerprint', None)
        multi['generation_control'].update(include_techniques=False, writing_alignment={
            'changes': 'FIRST_CHAPTER_ONLY', 'scene_direction': {'prose_strategy': 'spatial_flow'}})
        initial = materials.prepare('p', multi)
        assert initial['ready']
        multi['generation_control']['material_preview_fingerprint'] = initial['fingerprint']
        runs, before_calls = WritingRunService(manager), len(calls)
        run = await runs.create('p', multi)
        await asyncio.wait_for(runs.tasks[('p', run['run_id'])], timeout=10)
        completed = runs.get('p', run['run_id'])
        assert completed['status'] == 'completed' and completed['next_index'] == 2, completed.get('message')
        writers = [messages for model, messages in calls[before_calls:] if model == 'chapter_writer']
        assert len(writers) == 2 and len(completed['job_ids']) == 2
        for messages, job_id in zip(writers, completed['job_ids']):
            actual_job = manager.get_job('p', job_id)
            actual_materials = actual_job['context_manifest']['generation_materials']
            snapshot = store.read_json('p', materials._path(actual_materials['fingerprint']))
            assert messages == snapshot['messages'] and actual_materials['sent'] is True
            assert actual_job['context_manifest']['generation_control']['include_techniques'] is False
        first_request, second_request = [json.loads(messages[-1]['content']) for messages in writers]
        assert first_request['当前要求']['场景']['scene_id'] == canonical
        assert second_request['当前要求']['场景']['scene_id'] == 'story_fallback:important_scenes:future'
        assert first_request['当前要求']['作者共识']['changes'] == 'FIRST_CHAPTER_ONLY'
        assert second_request['当前要求']['作者共识']['changes'] == 'SECOND_CHAPTER_ONLY'
        assert second_request['当前要求']['场景表达参考（可选，转成小说语言）'] == {'prose_strategy': 'focus_closure'}
        assert second_request['适用世界与故事时间']['time']['year'] == 1940
        assert 'FIRST_CHAPTER_ONLY' not in json.dumps(second_request['当前要求'], ensure_ascii=False)
        assert not store._safe_path('p', 'cards/blueprint_001.json').exists()
        world = store.read_yaml('p', 'cards/world_1.yaml')
        world['payload']['rules'].append('完整条款及其条件和例外必须一起保留。' * 1200)
        store.write_yaml('p', 'cards/world_1.yaml', world)
        large = copy.deepcopy(fallback)
        large['generation_control'].pop('material_preview_fingerprint', None)
        large_preview = materials.prepare('p', large)
        assert large_preview['ready'] and large_preview['budget']['used_chars'] > 14000
        assert large_preview['budget']['max_chars'] > 14000
        explicit = copy.deepcopy(large)
        explicit.setdefault('constraints', {})['context_max_chars'] = 14000
        explicit_preview = materials.prepare('p', explicit)
        assert not explicit_preview['ready'] and explicit_preview['budget']['max_chars'] == 14000
        window[0] = 10000
        small_preview = materials.prepare('p', large)
        assert not small_preview['ready']
        for overflow_preview in [explicit_preview, small_preview]:
            keys = [(item['id'], item['source']) for item in overflow_preview['overflow']]
            assert keys and len(keys) == len(set(keys))
        assert len(calls) == before_calls + 6

    asyncio.run(scenario())


def test_zip_import_preserves_paths_resumes_completed_units_and_links_candidates(store, monkeypatch):
    async def scenario():
        def archive(entries):
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as package:
                for path, content in entries:
                    package.writestr(path, content)
            return output.getvalue()

        raw = archive([('文明/规则.txt', '规则：每夜闭门。'), ('地区/规则.txt', '地区：北岸临河。'), ('其他/未知.bin', b'unknown-format')])
        calls, fail = [], [True]

        class Authoring:
            async def complete(self, *args, **kwargs):
                prompt = json.loads(args[-1])
                path = prompt['来源'].get('package_path') or prompt['来源'].get('filename')
                calls.append(path)
                if path == '新补充.txt':
                    return json.dumps({'cleaned_text': prompt['原文'], 'candidates': []}, ensure_ascii=False)
                if path.startswith('地区') and fail[0]:
                    fail[0] = False
                    raise RuntimeError('模拟第二文件模型暂时失败')
                parent = path.startswith('文明')
                candidate = {'id': 'parent' if parent else 'child', 'kind': 'world', 'label': '河港' if parent else '北岸',
                    'values': {'title': '河港' if parent else '北岸', 'entry_type': 'world' if parent else 'place', 'summary': prompt['原文']},
                    'evidence': [{'quote': prompt['原文']}]}
                if not parent:
                    candidate.update(parent_candidate_id='parent', material_candidate_ids=['parent'])
                return json.dumps({'cleaned_text': prompt['原文'], 'candidates': [candidate]}, ensure_ascii=False)

        class Stream(io.BytesIO):
            def read(self, size=-1):
                assert 0 < size <= 1024 * 1024
                return super().read(size)

        service = MaterialImportService(store, Authoring())
        work = service.create_upload('p', {'purpose': 'world'}, Stream(raw), '世界.zip')
        members = [source for source in work['sources'] if source.get('package_path')]
        assert {source['package_path'] for source in members} == {'文明/规则.txt', '地区/规则.txt', '其他/未知.bin'}
        assert len({source['raw_path'] for source in members}) == 3
        assert store._safe_path('p', work['source']['raw_path']).read_bytes() == raw
        work = await service.extract('p', work['id'], {'base_revision': work['revision'], 'max_units': 1})
        assert not work['progress']['complete'] and work['progress']['completed_units'] == 1
        with pytest.raises(RuntimeError, match='第二文件'):
            await service.extract('p', work['id'], {'base_revision': work['revision'], 'max_units': 1})
        failed = service.get('p', work['id'])
        assert failed['status'] == 'failed' and len(failed['extraction_units']) == 1 and failed['candidates'][0]['id'] == 'parent'
        work = await service.extract('p', work['id'], {'base_revision': failed['revision'], 'max_units': 2})
        assert calls == ['文明/规则.txt', '地区/规则.txt', '地区/规则.txt']
        assert work['progress']['completed_units'] == 2 and work['progress']['unread'] and not work['progress']['complete']
        assert {candidate['id'] for candidate in work['candidates']} == {'parent', 'child'}
        work = service.add_source('p', work['id'], {'base_revision': work['revision']}, raw='补充材料：守门会。'.encode(), filename='新补充.txt')
        work = await service.extract('p', work['id'], {'base_revision': work['revision'], 'max_units': 5})
        assert calls == ['文明/规则.txt', '地区/规则.txt', '地区/规则.txt', '新补充.txt']
        applied = service.apply('p', work['id'], {'base_revision': work['revision'], 'selected_ids': ['parent', 'child']})
        parent = next(row['target_id'] for row in applied['results'] if row['candidate_id'] == 'parent')
        child = next(row['target_id'] for row in applied['results'] if row['candidate_id'] == 'child')
        payload = store.read_yaml('p', f'cards/{child}.yaml')['payload']
        assert payload['parent_id'] == parent and parent in payload['material_ids']
        for entries in [[('../escape.txt', '越界')], [('A.txt', '一个版本'), ('a.txt', '另一个版本')]]:
            with pytest.raises(ValueError):
                service.create('p', {'purpose': 'world'}, raw=archive(entries), filename='bad.zip')
        from services import material_package_service
        monkeypatch.setattr(material_package_service, 'MAX_PACKAGE_FILES', 1)
        with pytest.raises(ValueError, match='文件|拆包'):
            service.create('p', {'purpose': 'world'}, raw=archive([('1.txt', '甲'), ('2.txt', '乙')]), filename='too-many.zip')
        assert not (store.data_dir.parent / 'escape.txt').exists()

    asyncio.run(scenario())


def test_pdf_text_and_visual_progress_and_map_coordinates_remain_separate(store, monkeypatch):
    import struct
    import zlib
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', 1, 1, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\x00')) + chunk(b'IEND', b'')
    monkeypatch.setattr(reader_module.shutil, 'which', lambda name: name)
    def extracted(arguments, **kwargs):
        if Path(arguments[0]).name == 'pdftotext':
            if arguments[-1] != '-':
                Path(arguments[-1]).write_text('规则：每夜闭门。' if arguments[2] == '1' else '', encoding='utf-8')
                return SimpleNamespace(stdout=b'')
            return SimpleNamespace(stdout='规则：每夜闭门。\f\f'.encode())
        return SimpleNamespace(stdout=b'Pages: 2\n')
    monkeypatch.setattr(reader_module.subprocess, 'run', extracted)
    root = card(store, 'world_1', 'world', {'entry_type': 'world', 'summary': '河港'})
    card(store, 'north', 'world', {'entry_type': 'place', 'parent_id': 'world_1'})
    card(store, 'world_2', 'world', {'entry_type': 'world'})
    card(store, 'foreign', 'world', {'entry_type': 'place', 'parent_id': 'world_2'})
    text_calls, visuals = [], []

    class Authoring:
        async def complete(self, *args, **kwargs):
            text_calls.append(json.loads(args[-1])['原文'])
            return '{"cleaned_text":"","candidates":[]}'

    service = MaterialImportService(store, Authoring())
    work = service.create('p', {'purpose': 'world', 'world_context': {'world_id': 'world_1'}}, raw=b'%PDF-1.4\nmocked external tool input', filename='图文.pdf')
    assert work['source']['page_count'] == 2 and work['source']['pages'][0]['text_status'] == 'read'
    assert all(page['visual_status'] == 'pending' for page in work['source']['pages'])

    def page_path(project, batch, source, page):
        target = store._safe_path(project, f'sessions/material_imports/{batch}/pages/{source}/{page}.png')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png)
        return target

    async def visual(project, record, body, calls):
        visuals.append(body['page'])
        return json.dumps({'transcription': '图示北岸' if body['page'] == 2 else '文字页视觉核对',
            'kind': 'map' if body['page'] == 2 else 'none', 'title': '北岸图',
            'hotspots': [{'label': '北岸', 'display_position': {'x': 0.2, 'y': 0.4}}]}, ensure_ascii=False)

    monkeypatch.setattr(service, 'pdf_page_path', page_path)
    monkeypatch.setattr(service, '_visual_text', visual)

    async def process():
        current = await service.extract('p', work['id'], {'base_revision': work['revision'], 'include_visual': False, 'max_units': 1})
        assert len(text_calls) == 1 and not visuals and not current['progress']['complete']
        current = await service.extract('p', work['id'], {'base_revision': current['revision'], 'max_units': 1})
        assert visuals == [1] and not current['progress']['complete']
        return await service.extract('p', work['id'], {'base_revision': current['revision'], 'max_units': 5})

    finished = asyncio.run(process())
    assert visuals == [1, 2] and finished['progress']['complete']
    image = next(candidate['values']['maps'][0] for candidate in finished['candidates'] if candidate['values'].get('maps'))
    assert image['source']['page'] == 2 and image['source']['version'] == work['source']['version']
    assert image['hotspots'][0]['status'] == 'candidate'
    image['coordinate_system'] = 'grid'
    image['hotspots'][0].update(coordinates={'x': 40, 'y': 12}, display_position={'x': 0.6, 'y': 0.3}, entity_id='north', status='confirmed')
    app = FastAPI()
    from fastapi.responses import JSONResponse
    # Mirror the production conflict handler without importing main or real data.
    app.add_exception_handler(FileExistsError, lambda request, exc: JSONResponse(status_code=409, content={'detail': str(exc)}))
    app.include_router(cards.router)
    app.dependency_overrides[cards.get_store] = lambda: store
    app.dependency_overrides[cards.get_change_service] = lambda: ChangeSuggestionService(store)
    canon = {path.name: path.read_bytes() for path in store._safe_path('p', 'canon').glob('*') if path.is_file()}
    with TestClient(app) as client:
        url = '/api/projects/p/cards/world_1'
        current = client.get(url).json()
        current['payload']['maps'] = [image]
        response = client.put(url, json=current)
        assert response.status_code == 200, response.text
        legacy = client.get(url).json()
        legacy['payload'].pop('entry_type')
        assert client.put(url, json=legacy).status_code == 200
        saved = store._safe_path('p', 'cards/world_1.yaml').read_bytes()
        assert store.read_yaml('p', 'cards/world_1.yaml')['payload']['maps'][0]['hotspots'][0]['coordinates'] == {'x': 40, 'y': 12}
        for field, value, code in [('entity_id', 'foreign', 400), ('version', 'stale_image_source', 409)]:
            bad = client.get(url).json()
            if field == 'entity_id':
                bad['payload']['maps'][0]['hotspots'][0][field] = value
            else:
                bad['payload']['maps'][0]['source'][field] = value
            assert client.put(url, json=bad).status_code == code
            assert store._safe_path('p', 'cards/world_1.yaml').read_bytes() == saved
    assert canon == {path.name: path.read_bytes() for path in store._safe_path('p', 'canon').glob('*') if path.is_file()}
    large = b'%PDF-1.4\n%' + b'x' * (13 * 1024 * 1024)
    read_bytes = Path.read_bytes
    def reject_reading_full_pdf(path):
        assert path.name != 'upload' and path.suffix != '.pdf', 'large original PDF must be streamed, not read_bytes'
        return read_bytes(path)
    with monkeypatch.context() as patch:
        patch.setattr(Path, 'read_bytes', reject_reading_full_pdf)
        lazy = service.create_upload('p', {'purpose': 'world'}, io.BytesIO(large), 'large.pdf')
        assert lazy['source']['lazy_pdf'] and lazy['source']['page_count'] == 2
        assert all(page['text_status'] == 'pending' for page in lazy['source']['pages'])
        local = asyncio.run(service.extract('p', lazy['id'], {'base_revision': lazy['revision'], 'use_ai': False}))
        assert local['source']['pages'][0]['text_status'] == 'read' and local['source']['pages'][1]['text_status'] == 'empty'
        assert not local['progress']['complete'] and all(page['visual_status'] == 'pending' for page in local['source']['pages'])
    assert store._safe_path('p', lazy['source']['raw_path']).read_bytes() == large
    with pytest.raises(ValueError, match='12 MB'):
        service.create_upload('p', {'purpose': 'world'}, io.BytesIO(large), 'too-large.txt')


def test_card_operations_preview_versions_locks_and_display_order_do_not_rewrite_history(store):
    from services.card_operation_service import CardOperationService
    service = CardOperationService(store)
    card(store, 'world_1', 'world', {'entry_type': 'world'})
    card(store, 'note', 'world', {'entry_type': 'custom', 'parent_id': 'world_1', 'content': '第一部分。\n\n第二部分。'})
    card(store, 'story_1', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [
        {'id': 'first', 'scene': '先发生', 'rehearsal': {'status': 'confirmed', 'text': '旧确认安排'}, 'world_context': {'time': {'year': 1930}}},
        {'id': 'second', 'scene': '后发生', 'world_context': {'time': {'year': 1940}}, 'causal_scene_ids': ['first']}]})
    store.write_md('p', 'drafts/chapter_001.md', '正式正文。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\nchapter_002')
    draft = store._safe_path('p', 'drafts/chapter_001.md').read_bytes()
    order = store._safe_path('p', 'drafts/.chapter_order').read_bytes()
    original = store._safe_path('p', 'cards/note.yaml').read_bytes()
    preview = service.preview('p', {'action': 'split', 'source_id': 'note'})
    assert preview['can_apply'] and store._safe_path('p', 'cards/note.yaml').read_bytes() == original
    changed = store.read_yaml('p', 'cards/note.yaml')
    changed['payload']['summary'] = '预览后作者新增'
    store.write_yaml('p', 'cards/note.yaml', changed)
    with pytest.raises(FileExistsError):
        service.apply('p', preview['id'], {'revision': preview['revision']})
    fresh = service.preview('p', {'action': 'split', 'source_id': 'note'})
    adopted = service.apply('p', fresh['id'], {'revision': fresh['revision']})
    child = adopted['result']['ids'][0]
    value = store.read_yaml('p', f'cards/{child}.yaml')
    value['payload']['summary'] = '拆分后作者继续写的内容'
    store.write_yaml('p', f'cards/{child}.yaml', value)
    before = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError):
        service.undo('p', fresh['id'], {'revision': adopted['revision']})
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(ValueError, match='循环'):
        service.preview('p', {'action': 'reparent', 'source_id': 'world_1', 'parent_id': child})
    display = service.preview('p', {'action': 'reorder', 'source_id': 'story_1:important_scenes:first',
        'order': ['story_1:important_scenes:second', 'story_1:important_scenes:first']})
    service.apply('p', display['id'], {'revision': display['revision']})
    rows = store.read_yaml('p', 'cards/story_1.yaml')['payload']['important_scenes']
    assert [row['id'] for row in rows] == ['first', 'second']
    assert [row['sort_order'] for row in rows] == [1, 0]
    assert rows[0]['world_context']['time']['year'] == 1930 and rows[1]['causal_scene_ids'] == ['first']
    assert store._safe_path('p', 'drafts/chapter_001.md').read_bytes() == draft
    assert store._safe_path('p', 'drafts/.chapter_order').read_bytes() == order
    split_event = service.preview('p', {'action': 'split', 'source_id': 'story_1:important_scenes:first',
        'parts': [{'title': '第一小段', 'content': '一个动作'}, {'title': '第二小段', 'content': '另一个动作'}]})
    service.apply('p', split_event['id'], {'revision': split_event['revision']})
    parts = store.read_yaml('p', 'cards/story_1.yaml')['payload']['important_scenes'][:2]
    assert all(not part.get('rehearsal') for part in parts)
    assert not parts[1].get('causal_scene_ids') and not parts[1].get('causal_event_refs')
    card(store, 'merge_a', 'world', {'parent_id': 'world_1', 'entry_type': 'custom', 'rules': ['规则甲'], 'content': '甲文'})
    card(store, 'merge_b', 'world', {'parent_id': 'world_1', 'entry_type': 'custom', 'rules': ['规则乙'], 'content': '乙文'})
    child_card = card(store, 'merge_child', 'world', {'parent_id': 'merge_b'})
    store.write_json('p', 'drafts/chapter_001.meta.json', {'material_ids': ['merge_b']})
    merged = service.preview('p', {'action': 'merge', 'ids': ['merge_a', 'merge_b'], 'target_id': 'merge_a'})
    service.apply('p', merged['id'], {'revision': merged['revision']})
    assert store.read_yaml('p', 'cards/merge_a.yaml')['payload']['rules'] == ['规则甲', '规则乙']
    assert not store._safe_path('p', 'cards/merge_b.yaml').exists()
    assert store.read_yaml('p', 'cards/merge_child.yaml')['payload']['parent_id'] == 'merge_a'
    assert store.read_json('p', 'drafts/chapter_001.meta.json')['material_ids'] == ['merge_a']
    assert store._safe_path('p', 'drafts/chapter_001.md').read_bytes() == draft
    card(store, 'locked_note', 'world', {'content': '甲。\n\n乙。'})
    locked = service.preview('p', {'action': 'split', 'source_id': 'locked_note'})
    AuthorControlService(store).confirm('p', {'targets': [{'target': 'cards/locked_note.yaml', 'paths': ['/payload/content'],
        'base_revision': revision(store, 'p', 'cards/locked_note.yaml')}]})
    before = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError):
        service.apply('p', locked['id'], {'revision': locked['revision']})
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    card(store, 'fresh_note', 'world', {'content': '丙。\n\n丁。'})
    independent = service.preview('p', {'action': 'split', 'source_id': 'fresh_note'})
    independent = service.apply('p', independent['id'], {'revision': independent['revision']})
    piece = independent['result']['ids'][0]
    card(store, 'late_piece_reference', 'outline', {'material_ids': [piece]})
    before = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    with pytest.raises(FileExistsError) as impact:
        service.undo('p', independent['id'], {'revision': independent['revision']})
    assert impact.value.impact and any('late_piece_reference' in row['source'] for row in impact.value.impact)
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    store._safe_path('p', 'cards/late_piece_reference.yaml').unlink()
    assert service.undo('p', independent['id'], {'revision': independent['revision']})['status'] == 'undone'
    assert not store.read_jsonl('p', 'canon/facts.jsonl') and not store.read_jsonl('p', 'canon/author_stages.jsonl')


def test_required_materials_preserve_full_focus_and_rule_exceptions_before_optional_text(store):
    from services.context_pack_service import MaterialBudgetError

    scope = {'world_id': 'world_1', 'time': {'year': 1930}}
    focus = ''.join(f'{number:04d}：先说明此刻目标，再判断是否开门。\n' for number in range(240))[:3200]
    rule = ''.join(f'{number:04d}：港口守则须遵守当前时点与当事人的权限。\n' for number in range(130))
    rule += '仅在潮位低于警戒线且守门人核准时开放。例外：救生船不受闭港限制，但必须登记。'
    world = card(store, 'world_1', 'world', {'rules': [rule], 'canon_status': 'canon', 'setting_status': 'set'})
    person = card(store, 'person_a', 'character', {'name': '甲', 'identity': '守门人', 'detail_sections': [
        {'id': 'focus', 'title': '完整目标与犹豫', 'content': focus, 'usage': 'relevant'}]})
    optional = card(store, 'style_extra', 'style', {'tone': '可选文风说明。' * 3000})
    store.write_md('p', 'drafts/chapter_001.md', '已保存原稿。')
    store.write_json('p', 'drafts/chapter_001.meta.json', {'world_context': scope})
    originals = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    manifest = {'included_cards': [optional, world, person], 'generation_control': {
        'world_context': scope, 'character_detail_focus': {'person_a': ['focus']}}}
    requirements = {'场景': {'cast': ['person_a'], 'purpose': '按现有条件判断是否开港'}}
    service = ContextPackService(store)
    text, report = service.build('p', 'chapter_001', manifest, requirements, max_chars=10000)

    def strings(value):
        if isinstance(value, dict):
            return [text for child in value.values() for text in strings(child)]
        if isinstance(value, list):
            return [text for child in value for text in strings(child)]
        return [value] if isinstance(value, str) else []

    assert len(focus) == 3200 and focus in strings(json.loads(text)) and rule in strings(json.loads(text))
    assert report['ready'] and not report['overflow'] and report['used_chars'] == len(text) <= 10000
    assert next(item for item in report['items'] if item['id'] == 'person_a:detail:focus')['text'] == focus
    assert next(item for item in report['items'] if item['id'] == 'person_a:detail:focus')['required']
    assert next(item for item in report['items'] if item['id'] == 'world_1')['required']
    assert 'style_extra' not in report['used_ids']
    with pytest.raises(MaterialBudgetError) as blocked:
        service.build('p', 'chapter_001', manifest, requirements, max_chars=2000)
    overflow = blocked.value.report
    assert not overflow['ready'] and overflow['required_chars'] > overflow['max_chars'] == 2000
    assert {'world_1', 'person_a:detail:focus'} <= {item['id'] for item in overflow['overflow']}
    assert next(item for item in overflow['items'] if item['id'] == 'person_a:detail:focus')['text'] == focus
    assert {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')} == originals
    assert store.read_md('p', 'drafts/chapter_001.md') == '已保存原稿。' and not store.read_jsonl('p', 'canon/facts.jsonl')


def test_reference_expansion_keeps_selected_range_and_blocks_cycles_future_and_private_sources(store):
    from services.material_reference_service import MaterialReferenceService

    scope = {'world_id': 'world_1', 'time': {'year': 1930}, 'pov_character_id': 'person_a'}
    old_content, new_content = '1930基准世界正文，条件完整保留。', '1950阶段世界正文，条件变化；例外为救生船先通行。'
    old_rule, new_rule = '1930基准规则：夜潮闭港。', '1950阶段规则：夜潮可依核准通行；救生船除外。'
    card(store, 'world_1', 'world', {'content': old_content, 'rules': [old_rule]})
    world_stage = AuthorDataService(store).add_stage('p', 'world', 'world_1', {'status': 'confirmed',
        'scope': {'world_id': 'world_1', 'time': {'year': 1950}},
        'changes': {'content': new_content, 'rules': [new_rule]}, 'source': {'kind': 'author'}})
    card(store, 'fork_story', 'story', {'world_context': {'world_id': 'world_1'}, 'important_scenes': [
        {'id': 'fork', 'world_context': {'time': {'year': 1940}}}]})
    AuthorDataService(store).put_branches('p', 'world_1', {'branches': [{'id': 'alternate', 'label': '另一分支',
        'parent_branch_id': 'main', 'fork_event_ref': {'owner_card_id': 'fork_story', 'scene_id': 'fork'}}]})
    card(store, 'person_a', 'character', {'name': '甲', 'identity': '', 'detail_sections': [
        {'id': 'private', 'title': '作者底稿', 'content': 'PRIVATE_REFERENCE_NEVER_SEND', 'usage': 'author_only'}]})
    selected = '第二段😀：只核对这封信，再决定是否放行。[[letter]]'
    memo_text = '首段不在这次选择范围。\n\n' + selected + '\n\n末段也不在这次选择范围。'
    card(store, 'memo', 'outline', {'summary': '只是一份摘要，原文未带入。', 'content': memo_text, 'world_context': {'world_id': 'world_1'}})
    letter_text = '原信：船在旧桥等候，勿向旁人说明。[[memo]]'
    card(store, 'letter', 'outline', {'content': letter_text, 'known_by': ['person_a'],
        'world_context': {'world_id': 'world_1', 'time': {'year': 1920}}})
    card(store, 'future', 'outline', {'content': '未来信件不得提前读', 'world_context': {'world_id': 'world_1', 'time': {'year': 1940}}})
    card(store, 'other_mind', 'outline', {'content': '另一人物私下收到的信', 'known_by': ['person_b'], 'world_context': {'world_id': 'world_1'}})
    card(store, 'private_node', 'outline', {'secret': {'usage': 'author_only', 'content': 'PRIVATE_NESTED_NEVER_SEND'},
        'future': {'scope': {'time': {'year': 1940}}, 'content': 'FUTURE_NESTED_NEVER_SEND'},
        'future_context': {'world_context': {'time': {'year': 1940}}, 'content': 'FUTURE_CONTEXT_NEVER_SEND'},
        'other_branch': {'scope': {'world_id': 'world_1', 'branch_id': 'alternate'}, 'content': 'OTHER_BRANCH_NEVER_SEND'},
        'other_mind': {'known_by': ['person_b'], 'content': 'OTHER_MIND_NEVER_SEND'}, 'world_context': {'world_id': 'world_1'}})
    store.write_md('p', 'drafts/chapter_001.md', '当前正文。')
    store.write_md('p', 'drafts/chapter_002.md', '后续章节不得提前展开。')
    store.write_md('p', 'drafts/.chapter_order', 'chapter_001\nchapter_002')
    store.write_md('p', 'assets/raw.txt', '尚未确认适用范围的原始资料。')
    originals = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    service = MaterialReferenceService(store)
    source = 'cards/memo.yaml#payload.content'
    choice = {'source': source, 'start': memo_text.index(selected), 'end': memo_text.index(selected) + len(selected), 'follow_refs': True}
    expanded = service.expand('p', [choice, choice], scope, {'cast': ['person_a']}, 'chapter_001')
    assert not expanded['overflow'] and len(expanded['items']) == 2
    assert expanded['items'][0]['text'] == selected and expanded['items'][1]['text'] == letter_text
    assert expanded['items'][0]['source'] == source and expanded['items'][1]['depth'] == 1
    assert expanded['items'][1]['via'] == [source]
    assert set(expanded['source_versions']) == {'cards/memo.yaml', 'cards/letter.yaml', 'canon/author_stages.jsonl'}
    separate = service.expand('p', [{'source': source, 'start': 0, 'end': 6},
        {'source': source, 'start': len(memo_text) - 6, 'end': len(memo_text)}], scope, {'cast': ['person_a']}, 'chapter_001')
    assert [item['text'] for item in separate['items']] == [memo_text[:6], memo_text[-6:]]
    for private_source in ['cards/person_a.yaml#payload.detail_sections.@private.content',
                           'cards/private_node.yaml#payload.secret', 'cards/private_node.yaml#payload.secret.content',
                           'cards/private_node.yaml#payload.future.content', 'cards/private_node.yaml#payload.future_context.content',
                           'cards/private_node.yaml#payload.other_branch.content', 'cards/private_node.yaml#payload.other_mind.content',
                           'cards/future.yaml', 'cards/other_mind.yaml', 'drafts/chapter_002.md', 'assets/raw.txt']:
        denied = service.expand('p', [{'source': private_source}], scope, {'cast': ['person_a']}, 'chapter_001')
        assert denied['overflow'] and denied['items'] == [], private_source
        assert 'PRIVATE_REFERENCE_NEVER_SEND' not in json.dumps(denied, ensure_ascii=False)
        assert 'PRIVATE_NESTED_NEVER_SEND' not in json.dumps(denied, ensure_ascii=False)
    whole = service.expand('p', [{'source': 'cards/private_node.yaml'}], scope, {'cast': ['person_a']}, 'chapter_001')
    forbidden = ['PRIVATE_NESTED_NEVER_SEND', 'FUTURE_NESTED_NEVER_SEND', 'FUTURE_CONTEXT_NEVER_SEND', 'OTHER_BRANCH_NEVER_SEND', 'OTHER_MIND_NEVER_SEND']
    assert not [secret for secret in forbidden if secret in json.dumps(whole, ensure_ascii=False)]
    for field, old, new in [('content', old_content, new_content), ('rules', [old_rule], [new_rule])]:
        reference = {'source': f'cards/world_1.yaml#payload.{field}'}
        early = service.expand('p', [reference], {**scope, 'time': {'year': 1920}}, {}, 'chapter_001')
        later = service.expand('p', [reference], {**scope, 'time': {'year': 1960}}, {}, 'chapter_001')
        assert not early['overflow'] and not later['overflow']
        assert (json.loads(early['items'][0]['text']) if field == 'rules' else early['items'][0]['text']) == old
        assert (json.loads(later['items'][0]['text']) if field == 'rules' else later['items'][0]['text']) == new
        item = later['items'][0]
        assert item['stage_id'] == item['source_record_id'] == world_stage['id']
        assert item['source'] == 'canon/author_stages.jsonl#' + world_stage['id']
        assert item['logical_source'] == reference['source']
        assert later['source_versions']['canon/author_stages.jsonl'] == hashlib.sha256(store._safe_path('p', 'canon/author_stages.jsonl').read_bytes()).hexdigest()
    assert {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')} == originals
    assert ContextPackService(store).sources_unchanged('p', expanded['source_versions'])
    letter = store.read_yaml('p', 'cards/letter.yaml')
    letter['payload']['content'] = '作者已修改的原信。'
    store.write_yaml('p', 'cards/letter.yaml', letter)
    assert not ContextPackService(store).sources_unchanged('p', expanded['source_versions'])


def test_short_import_resolves_names_without_sending_ten_thousand_object_catalog(store):
    async def scenario():
        folder, originals = store._safe_path('p', 'cards'), {}
        for number in range(10000):
            identity = f'bulk_{number:05d}'
            value = {'id': identity, 'type': 'character', 'title': identity, 'tags': [], 'links': [],
                     'payload': {'name': '阿青' if number == 9999 else f'人物{number:05d}', 'identity': '守门人' * 200}}
            raw = json.dumps(value, ensure_ascii=False).encode()
            (folder / f'{identity}.yaml').write_bytes(raw)
            originals[identity] = hashlib.sha256(raw).hexdigest()
        sent = []

        class Authoring:
            async def complete(self, *args, **kwargs):
                sent.append(copy.deepcopy(args))
                if '少量同名候选' in json.loads(args[-1]):
                    raise RuntimeError('模拟辅助身份判断暂时失败')
                return json.dumps({'cleaned_text': '阿青来', 'candidates': [{'id': 'person', 'kind': 'character', 'label': '阿青',
                    'values': {'name': '阿青', 'identity': ''}, 'evidence': [{'quote': '阿青'}]}]}, ensure_ascii=False)

        service = MaterialImportService(store, Authoring())
        batch = service.create('p', {'purpose': 'story', 'text': '阿青来'})
        ready = await service.extract('p', batch['id'], {'base_revision': batch['revision'], 'use_ai': True})
        assert len(sent) == 1
        request = json.loads(sent[0][-1])
        assert request['原文'] == '阿青来' and not request.get('已有正式对象')
        assert len(json.dumps(sent, ensure_ascii=False)) < 12000
        assert ready['candidates'][0]['possible_target_ids'] == ['bulk_09999']
        second = store.read_yaml('p', 'cards/bulk_09998.yaml')
        second['payload']['name'] = '阿青'
        store.write_yaml('p', 'cards/bulk_09998.yaml', second)
        originals['bulk_09998'] = hashlib.sha256((folder / 'bulk_09998.yaml').read_bytes()).hexdigest()
        batch = service.create('p', {'purpose': 'story', 'text': '阿青来'})
        ambiguous = await service.extract('p', batch['id'], {'base_revision': batch['revision'], 'use_ai': True})
        assert len(sent) == 3
        decision_request = json.loads(sent[-1][-1])
        assert len(decision_request['身份判断摘录']) <= 1800
        assert {row['id'] for row in decision_request['少量同名候选']} == {'bulk_09998', 'bulk_09999'}
        assert all(len(row['identity']) <= 500 for row in decision_request['少量同名候选'])
        assert len(json.dumps(sent, ensure_ascii=False)) < 16000
        candidate = ambiguous['candidates'][0]
        assert candidate['values']['name'] == '阿青' and candidate['values']['identity'] == ''
        assert set(candidate['possible_target_ids']) == {'bulk_09998', 'bulk_09999'} and not candidate.get('target_id')
        assert candidate.get('needs_review') and not candidate.get('identity_suggestion')
        assert {path.stem: hashlib.sha256(path.read_bytes()).hexdigest() for path in folder.glob('*.yaml')} == originals
        assert not store.read_jsonl('p', 'canon/facts.jsonl') and not list(store._safe_path('p', 'drafts').glob('*.md'))

    asyncio.run(scenario())


def test_offline_profile_group_locks_local_reroll_and_family_tendency_keep_source_cards(store):
    from services.family_service import FamilyService, PROFILE_FIELDS, preferred_traits, decision_bias

    scope = {'world_id': 'world_profile', 'time': {'year': 1930}}
    card(store, 'world_profile', 'world', {'name': '虚构港湾'})
    person = card(store, 'profile_center', 'character', {'name': '林秋', 'identity': '已锁身份',
        'initial_age': 35, 'initial_age_time': {'year': 1930}, 'voice': '作者留白前原值',
        'personality_traits': ['谨慎'], 'world_context': scope})
    controls = AuthorControlService(store)
    controls.confirm('p', {'targets': [{'target': 'cards/profile_center.yaml', 'paths': ['/payload/identity'],
        'base_revision': revision(store, 'p', 'cards/profile_center.yaml')}]})
    before = {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    service = FamilyService(store)
    request = {'center_id': person['id'], 'seed': 'stable-profile', 'world_context': scope,
               'fields': list(PROFILE_FIELDS), 'blank': ['voice']}
    result = service.profile('p', request)
    assert result == service.profile('p', request)
    assert set(result['values']) == {'core_motivation', 'vulnerability', 'personality_traits'}
    reroll = service.profile('p', {**request, 'fields': ['core_motivation'], 'counts': {'core_motivation': 1}})
    assert set(reroll['values']) == {'core_motivation'} and reroll['counts'] == {'core_motivation': 1}
    assert service.profile('p', request) == result
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    assert preferred_traits({'traits': {'谨慎': 2, '坦率': 3}}, '谨慎', 0.5) == [('坦率', 3), ('谨慎', 3.0)]
    assert decision_bias({'personality_traits': ['谨慎', '谨慎', '自由描述']}) == {'confidence_delta': -0.12, 'loss_delta': 1}
    assert decision_bias({'personality_traits': ['自由描述']}) == {'confidence_delta': 0.0, 'loss_delta': 0}
    draft = service.preview('p', {'center_id': person['id'], 'world_context': scope, 'mode': 'brother',
        'seed': 'family-local', 'limit': 2, 'family_trait': '谨慎', 'similarity': 0.5})
    assert not draft['conflicts'] and len(draft['nodes']) > 1
    assert draft['family_trait'] == '谨慎' and draft['similarity'] == 0.5
    member = next(row for row in draft['nodes'] if not row['existing'])
    frozen = service.update('p', draft['id'], {'revision': draft['revision'],
        'nodes': [{'id': member['id'], 'locked': ['name']}]})
    stable_nodes = copy.deepcopy(frozen['nodes'])
    with pytest.raises(ValueError):
        service.update('p', draft['id'], {'revision': frozen['revision'], 'reroll': {'node_id': member['id'], 'field': 'name'}})
    assert service.get('p', draft['id'])['nodes'] == stable_nodes
    redrawn = service.update('p', draft['id'], {'revision': frozen['revision'], 'reroll': {'node_id': member['id'], 'field': 'trait'}})
    for old, new in zip(stable_nodes, redrawn['nodes']):
        assert {k: v for k, v in old.items() if k != 'trait'} == {k: v for k, v in new.items() if k != 'trait'}
        if old['id'] != member['id']:
            assert old == new
    assert before == {path.name: path.read_bytes() for path in store._safe_path('p', 'cards').glob('*.yaml')}
    applied = service.apply('p', draft['id'], {'revision': redrawn['revision']})
    assert applied['status'] == 'applied'
    generated = store.read_yaml('p', f"cards/{member['id']}.yaml")
    assert generated['payload']['family_source']['family_trait'] == '谨慎'
    assert generated['payload']['family_source']['similarity'] == 0.5
    assert any({p['entity_id'] for p in row['participants']} == {person['id'], member['id']}
               for row in AuthorDataService(store).relationships('p'))
    service.undo('p', draft['id'], {'revision': applied['revision']})
    assert not store.read_yaml('p', f"cards/{member['id']}.yaml")
    assert store.read_yaml('p', 'cards/profile_center.yaml')['payload'] == person['payload']


def test_dialogue_captures_current_knowledge_private_audience_reference_and_safe_partial_undo(store, monkeypatch):
    from routers import authoring as authoring_router
    from services import scene_rehearsal_service as scene_module

    monkeypatch.setattr(scene_module, 'candidate', lambda *args, **kwargs: {'status': 'waiting'})
    scope = {'world_id': 'world_dialogue', 'time': {'year': 1930}}
    card(store, 'world_dialogue', 'world', {'name': '虚构旧港'})
    for identity, name in [('a', '林秋'), ('b', '沈舟'), ('c', '顾安')]:
        card(store, 'dialogue_' + identity, 'character', {'name': name, 'identity': '港口居民', 'voice': '初始口吻',
            'world_context': {'world_id': 'world_dialogue'}, 'detail_sections': [
                {'id': 'private', 'title': '作者备忘', 'content': 'AUTHOR_PRIVATE_SENTINEL', 'usage': 'author_only'}]})
    card(store, 'dialogue_story', 'story', {'world_context': scope, 'important_scenes': [
        {'id': 'meeting', 'scene': '码头相遇', 'chapter': 'chapter_dialogue', 'characters': ['dialogue_a', 'dialogue_b', 'dialogue_c']}]})
    selected = '林秋🙂站在门口。\n共同原文一。\n沈舟望向旧灯。\n共同原文二。\n顾安没有作声。'
    proposed = '林秋🙂停在门口。\n共同原文一。\n沈舟望向新灯。\n共同原文二。\n顾安终于应声。'
    source = '前文保持。\n' + selected + '\n尾声保持。'
    start, end = len('前文保持。\n'), len('前文保持。\n') + len(selected)
    store.write_md('p', 'drafts/chapter_dialogue.md', source)
    store.write_md('p', 'drafts/.chapter_order', 'chapter_dialogue')
    store.write_json('p', 'drafts/chapter_dialogue.meta.json', {'story_card_id': 'dialogue_story', 'world_context': scope})
    authors = AuthorDataService(store)
    authors.add_stage('p', 'character', 'dialogue_b', {'status': 'confirmed', 'scope': {'time': {'year': 1940}},
        'changes': {'voice': 'FUTURE_VOICE_SENTINEL'}, 'source': {'kind': 'author'}})
    information = InformationService(store)
    information.save('p', {'id': 'dialogue_info', 'label': '钥匙', 'truth_status': 'undecided', 'scope': {'world_id': 'world_dialogue'}})
    for actor, state, value in [('dialogue_a', 'knows', '钥匙藏在林秋袖中'), ('dialogue_b', 'believes', '钥匙还在桥头')]:
        information.add_record('p', 'dialogue_info', {'record_type': 'awareness', 'status': 'confirmed', 'scope': scope,
            'source': {'kind': 'author'}, 'data': {'character_id': actor, 'state': state, 'value': value, 'basis': '作者明确设定'}})
    technique = card(store, 'dialogue_method', 'technique', {'apply_steps': ['最新完整写法：只用听见的台词回应，不解释秘密。']})
    unsupported = card(store, 'dialogue_not_technique', 'world', {'content': '不能将世界卡伪称技法'})
    authors.add_stage('p', 'character', 'dialogue_a', {'status': 'confirmed', 'scope': {'time': {'year': 1920}},
        'changes': {'voice': '当期说话先停一拍'}, 'source': {'kind': 'author'}})
    scene_service = SceneRehearsalService(store)
    snapshot = scene_service.get('p', 'dialogue_story', 'meeting')
    draft = {**snapshot['draft'], 'text': '林秋选择暂缓。沈舟选择等候。顾安选择旁观。', 'outcome': '各人仍在码头。',
        'local_simulation': {'mode': 'ensemble', 'participants': [
            {'actor_id': 'dialogue_a', 'act': '说明', 'hold': '暂缓', 'visible_to': ['dialogue_b']},
            {'actor_id': 'dialogue_b', 'act': '回答', 'hold': '等候'}, {'actor_id': 'dialogue_c', 'act': '询问', 'hold': '旁观'}]}}
    scene_service.confirm('p', 'dialogue_story', 'meeting', {**snapshot, 'draft': draft})
    calls = []

    class Capture:
        async def chat_complete(self, messages, *args, **kwargs):
            calls.append(copy.deepcopy(messages))
            return {'text': ['A_PRIVATE_TURN', 'B_PUBLIC_TURN', 'C_PUBLIC_TURN', proposed][(len(calls) - 1) % 4],
                    'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}}

    manager = SimpleNamespace(store=store, llm_gateway=Capture(), _resolve_profile=lambda *args: (
        'isolated', {'provider': 'ollama', 'model': 'fake', 'base_url': 'http://not-called.invalid'}, None))
    service = AuthoringService(manager)
    app = FastAPI()
    app.include_router(authoring_router.router)
    app.dependency_overrides[authoring_router.get_authoring] = lambda: service
    url = '/api/projects/p/chapters/chapter_dialogue/revise'
    body = {'source_text': source, 'base_revision': revision(store, 'p', 'drafts/chapter_dialogue.md'),
        'editor_revision': revision(store, 'p', 'drafts/chapter_dialogue.md'), 'mode': 'dialogue', 'start': start, 'end': end,
        'story_card_id': 'dialogue_story', 'scene_ref': {'owner_card_id': 'dialogue_story', 'scene_id': 'meeting'},
        'instructions': '林秋：只试探来意，不说出袖中钥匙。', 'writing_references': ['dialogue_method']}

    def files():
        return {str(p.relative_to(store._project_dir('p'))): p.read_bytes() for p in store._project_dir('p').rglob('*') if p.is_file()}

    with TestClient(app) as client:
        before = files()
        assert client.post(url, json={**body, 'writing_references': [unsupported['id']]}).status_code == 400
        assert not calls and files() == before
        response = client.post(url, json=body)
        assert response.status_code == 200, response.text
        candidate = response.json()
        assert files() == before and len(calls) == 4
        a, b, c, final = [json.loads(row[-1]['content']) for row in calls]
        assert a['本人资料']['speaker_instructions'] == ['只试探来意，不说出袖中钥匙。']
        assert a['本人资料']['voice'] == '当期说话先停一拍'
        assert {'state': 'knows', 'value': '钥匙藏在林秋袖中'} in a['本人资料']['beliefs']
        assert {'state': 'believes', 'value': '钥匙还在桥头'} in b['本人资料']['beliefs']
        assert '钥匙藏在林秋袖中' not in json.dumps(b, ensure_ascii=False)
        assert b['之前听到的台词'] == ['A_PRIVATE_TURN'] and c['之前听到的台词'] == ['B_PUBLIC_TURN']
        assert 'FUTURE_VOICE_SENTINEL' not in json.dumps(calls) and 'AUTHOR_PRIVATE_SENTINEL' not in json.dumps(calls)
        assert final['作者选用的写作参考']['references'][0]['payload'] == technique['payload']
        assert candidate['diff'] and len(candidate['ops']) == 3
        first = candidate['ops'][0]
        assert selected[first['start']:first['end']] == first['before']
        partial = selected[:first['start']] + first['after'] + selected[first['end']:]
        assert '停在门口' in partial and '望向旧灯' in partial and '没有作声' in partial
        wrong = client.post(url + '/apply', json={**candidate, 'text': partial, 'instructions': '林秋：说出全部秘密。'})
        assert wrong.status_code == 409 and files() == before
        applied = client.post(url + '/apply', json={**candidate, 'text': partial})
        assert applied.status_code == 200, applied.text
        receipt = applied.json()
        assert receipt['content'] == source[:start] + partial + source[end:]
        undo = client.post(url + '/apply', json={'source_text': receipt['content'], 'text': source, 'start': 0,
            'end': len(receipt['content']), 'mode': 'polish', 'base_hash': receipt['applied_revision']})
        assert undo.status_code == 200 and undo.json()['content'] == source
        authors.add_stage('p', 'character', 'dialogue_a', {'status': 'confirmed', 'scope': {'time': {'year': 1920}},
            'changes': {'voice': '本场口吻已经改变'}, 'source': {'kind': 'author'}})
        stale = files()
        rejected = client.post(url + '/apply', json={**candidate, 'text': partial})
        assert rejected.status_code in {400, 409} and files() == stale
        assert len(calls) == 4


def test_local_pacing_keeps_story_source_exact_offsets_and_rejects_unlocated_marks(store, monkeypatch):
    import httpx
    from services import pacing_analysis as pacing
    from rehearsal_engines.pacing_model import OLLAMA_URL, PACING_MODEL

    full_outline = '总纲唯一原句：船将靠岸。'
    card(store, 'pacing_story', 'story', {'full_outline': full_outline, 'summary': '不是正式全文的短摘要'})
    card(store, 'other_story', 'story', {'full_outline': 'OTHER_STORY_OUTLINE_SENTINEL'})
    text = '旧灯仍在桥头。\n风声。门开了。🙂信落地。\n又说起信落地。'
    store.write_md('p', 'drafts/pacing_chapter.md', text)
    store.write_json('p', 'drafts/pacing_chapter.meta.json', {'story_card_id': 'pacing_story'})
    store.write_md('p', 'drafts/other_chapter.md', 'OTHER_STORY_PROSE_SENTINEL')
    store.write_json('p', 'drafts/other_chapter.meta.json', {'story_card_id': 'other_story'})
    store.write_md('p', 'drafts/.chapter_order', 'pacing_chapter\nother_chapter')
    assert list(pacing.source_blocks(store, 'p', 'pacing_story', None, '')) == [('总纲', full_outline), ('pacing_chapter', text)]
    assert list(pacing.source_blocks(store, 'p', 'pacing_story', 'pacing_chapter', '不应混入单章')) == [('pacing_chapter', text)]
    with pytest.raises(FileNotFoundError):
        list(pacing.source_blocks(store, 'p', 'pacing_story', 'other_chapter', ''))
    captures = []

    class LocalCapture:
        async def chat_complete(self, messages, model, temperature, max_tokens, extra):
            current = json.loads(messages[-1]['content'])
            captures.append((copy.deepcopy(messages), model, copy.deepcopy(extra)))
            body = current['本段']
            if body == '旧灯仍在桥头。':
                marks = [{'kind': '铺垫', 'quote': body}]
            elif body == '风声。门开了。🙂信落地。':
                marks = [{'kind': '推进', 'quote': '门开了。'}, {'kind': '揭示', 'quote': '信落地。'},
                         {'kind': '转折', 'quote': '原文里没有的句子'}, {'kind': '再次提及', 'quote': '风声。', 'prior_quote': '伪造前文'}]
            elif body == '又说起信落地。':
                marks = [{'kind': '再次提及', 'quote': body, 'prior_quote': '信落地。'}]
            else:
                marks = []
            return {'text': json.dumps({'marks': marks}, ensure_ascii=False)}

    monkeypatch.setattr(pacing, 'LLMGateway', LocalCapture)
    from collections import OrderedDict
    monkeypatch.setattr(pacing, '_cache', OrderedDict())
    before = {str(p.relative_to(store._project_dir('p'))): p.read_bytes() for p in store._project_dir('p').rglob('*') if p.is_file()}

    async def connected():
        return False

    result = asyncio.run(pacing.analyze(store, 'p', 'pacing_story', None, '', connected))
    assert result['model'] == PACING_MODEL == 'qwen2.5:7b' and result['blocks'] == 4
    assert len(result['marks']) == 4
    for mark in result['marks']:
        origin = full_outline if mark['source'] == '总纲' else text
        assert origin[mark['offset']:mark['offset'] + len(mark['quote'])] == mark['quote']
    assert [(row['kind'], row['quote']) for row in result['marks']] == [
        ('铺垫', '旧灯仍在桥头。'), ('推进', '门开了。'), ('揭示', '信落地。'), ('再次提及', '又说起信落地。')]
    assert result['marks'][-1]['prior_quote'] == '信落地。'
    assert all(model == PACING_MODEL and extra['provider'] == 'ollama' and extra['base_url'] == OLLAMA_URL
               and extra['local_only'] is True and extra['format'] for _, model, extra in captures)
    assert 'OTHER_STORY' not in json.dumps(captures)
    count = len(captures)
    assert asyncio.run(pacing.analyze(store, 'p', 'pacing_story', None, '', connected)) == result and len(captures) == count
    async def interrupted():
        return True
    assert asyncio.run(pacing.analyze(store, 'p', 'pacing_story', None, '', interrupted))['blocks'] == 0
    # Neither repeated/ambiguous quotes nor a made-up prior quote become accepted evidence.
    async def invalid_complete(self, *args, **kwargs):
        return {'text': json.dumps({'marks': [{'kind': '推进', 'quote': '重复'},
            {'kind': '再次提及', 'quote': '尾句', 'prior_quote': '不存在的前文'}]}, ensure_ascii=False)}
    monkeypatch.setattr(LocalCapture, 'chat_complete', invalid_complete)
    assert asyncio.run(pacing.annotate(('p', 'ambiguity'), '', '重复、重复、尾句')) == []
    async def unavailable(self, *args, **kwargs):
        raise httpx.ConnectError('local offline')
    monkeypatch.setattr(LocalCapture, 'chat_complete', unavailable)
    with pytest.raises(RuntimeError, match='本地节奏模型.*不可用'):
        asyncio.run(pacing.annotate(('p', 'unavailable'), '', '未读的新段落'))
    assert before == {str(p.relative_to(store._project_dir('p'))): p.read_bytes() for p in store._project_dir('p').rglob('*') if p.is_file()}


def test_pair_requires_all_tools_without_losing_character_stakes_or_solo_ensemble_paths(monkeypatch, tmp_path):
    from services import local_rehearsal as local
    from services import automatic_rehearsal as automatic

    choices = {'act': '递信', 'hold': '收信', 'effect': '对方收到信', 'respond': '回话', 'check': '查看封口'}
    base = {'actor_id': 'a', 'partner_id': 'b', 'topic': '传信', 'available': True, 'actor_confidence': 0.7,
        'partner_confidence': 0.8, 'choices': choices, 'actor_stakes': {'goal_fit': 1, 'stance': 1},
        'partner_stakes': {'exposes_weakness': True}}
    spec = local.LocalRehearsal(**base, engines=['praxish'])
    assert spec.engines == list(local.PAIR_ENGINES) == ['praxish', 'sabre', 'fatima']
    assert local.LocalRehearsal(**base, engines=[]).engines == spec.engines
    context = {'scene': {'values': {'characters': ['a', 'b']}}, 'intersections': [], 'storylines': [], 'characters': [
        {'id': 'a', 'label': '甲', 'payload': {'name': '甲', 'personality_traits': ['爱冒险']}},
        {'id': 'b', 'label': '乙', 'payload': {'name': '乙', 'personality_traits': ['谨慎'], 'vulnerability': '怕被拒绝'}}]}
    calls = []
    def decide(available, confidence, loss, act, hold, payload, stakes):
        calls.append(('decide', copy.deepcopy(payload), stakes.model_dump()))
        return {'acts': available, 'chosen': act if available else hold, 'alternatives': [act, hold]}
    monkeypatch.setattr(local, '_decide', decide)
    monkeypatch.setattr(local.rehearsal_tools, 'availability', lambda: dict.fromkeys(['psychsim', *local.PAIR_ENGINES], True))
    monkeypatch.setattr(local.rehearsal_tools, 'social_actions', lambda available: {'first': ['act'], 'after': {'act': ['respond'], 'hold': []}})
    monkeypatch.setattr(local.rehearsal_tools, 'appraise', lambda desirability: {'mood': -2})
    def plan(specification, loss, actor_bonus, partner_bonus):
        calls.append(('plan', specification, loss, actor_bonus, partner_bonus))
        return {'available': True, 'path': []}
    monkeypatch.setattr(local.rehearsal_tools, 'plan', plan)
    result = local.rehearse(context, spec)
    assert len(result['steps']) == 2 and set(result['engines']) == set(local.PAIR_ENGINES)
    actor, partner, planned = calls
    assert actor[1] == context['characters'][0]['payload'] and actor[2]['goal_fit'] == 1
    assert partner[1] == context['characters'][1]['payload'] and partner[2]['exposes_weakness'] is True
    assert planned[1].actor_confidence == pytest.approx(0.85) and planned[1].actor_loss == 3
    assert planned[2:] == (7, 2.0, -1.5)
    monkeypatch.setattr(local.rehearsal_tools, 'availability', lambda: {'psychsim': True, 'praxish': True, 'sabre': False, 'fatima': True})
    with pytest.raises(ValueError, match='sabre.*尚未安装'):
        local.rehearse(context, spec)
    saved = {'owner_card_id': 'story', 'scene_id': 'meeting', 'base_hash': 'fake', 'context': context,
        'saved': None, 'stale': False, 'draft': {'local_simulation': {**base, 'engines': ['praxish']}}}
    candidate = automatic.candidate('isolated', saved, {'praxish': True, 'sabre': False, 'fatima': True}, compute=False)
    assert candidate['status'] == 'unavailable' and 'sabre' in candidate['notice']
    assert candidate['settings']['engines'] == list(local.PAIR_ENGINES)
    # Single and ensemble turns must not invoke pair-only tools when those tools are absent.
    def forbidden(*args, **kwargs):
        raise AssertionError('pair-only tool called for solo/ensemble')
    monkeypatch.setattr(local.rehearsal_tools, 'social_actions', forbidden)
    monkeypatch.setattr(local.rehearsal_tools, 'appraise', forbidden)
    monkeypatch.setattr(local.rehearsal_tools, 'plan', forbidden)
    monkeypatch.setattr(local.rehearsal_tools, 'availability', lambda: {'psychsim': True})
    for mode, count in [('solo', 1), ('ensemble', 3)]:
        people = [{'id': f'p{i}', 'label': f'人物{i}', 'payload': {'name': f'人物{i}'}} for i in range(count)]
        cast = local.CastRehearsal(mode=mode, participants=[{'actor_id': row['id'], 'act': '发言', 'hold': '等待'} for row in people])
        report = local.rehearse({**context, 'scene': {'values': {'characters': [r['id'] for r in people]}}, 'characters': people}, cast)
        assert len(report['steps']) == count and report['engines'] == {}

    # Missing SDK exits before creating a cache, downloading files or spawning Git/build tools.
    import runpy
    import shutil
    import subprocess
    import urllib.request
    installer = Path(__file__).resolve().parents[1] / 'rehearsal_engines' / 'install.py'
    with monkeypatch.context() as guard:
        guard.syspath_prepend(str(installer.parent))
        guard.setitem(sys.modules, 'runtime', SimpleNamespace(FATIMA=None, HERE=installer.parent, SABRE=None,
            engine_dir=forbidden, fatima_dll=forbidden, sabre_jar=forbidden, availability=forbidden))
        guard.setattr(shutil, 'which', lambda executable: None if executable == 'dotnet' else '/unused')
        guard.setattr(subprocess, 'run', forbidden)
        guard.setattr(urllib.request, 'urlopen', forbidden)
        guard.setattr(urllib.request, 'build_opener', forbidden)
        for choice in ['all', 'fatima']:
            guard.setattr(sys, 'argv', [str(installer), choice])
            with pytest.raises(SystemExit, match=r'\.NET 8 SDK'):
                runpy.run_path(str(installer), run_name='__main__')
        assert not list(tmp_path.iterdir())

    # Conda prepares application engines without assuming its environment contains an Ollama service.
    setup_path = Path(__file__).resolve().parents[2] / 'scripts' / 'setup_env.py'
    setup = runpy.run_path(str(setup_path), run_name='novix_setup_test')
    prepare = setup['prepare_app']
    prepared = []
    with monkeypatch.context() as guard:
        app_root = tmp_path / 'isolated-app'
        guard.setitem(prepare.__globals__, 'ROOT', app_root)
        guard.setitem(prepare.__globals__, 'install_word_reader', lambda: prepared.append('word-reader'))
        guard.setitem(prepare.__globals__, 'urlopen', forbidden)
        guard.setattr(shutil, 'which', lambda executable: '/fake/npm')
        guard.setattr(subprocess, 'run', lambda command, **kwargs: prepared.append((command, kwargs)))
        prepare()
    commands = [item for item in prepared if isinstance(item, tuple)]
    assert [row[0][-1] for row in commands[-2:]] == ['sabre', 'fatima']
    assert all(str(row[0][1]) == str(app_root / 'backend/rehearsal_engines/install.py')
               and row[1] == {'cwd': app_root, 'check': True} for row in commands[-2:])
    assert [row[0][1:] for row in commands[:2]] == [['install', '--no-audit', '--no-fund'], ['run', 'build:static']]
    assert commands[2] == ([sys.executable, app_root / 'scripts/setup_local_model.py'], {'cwd': app_root, 'check': True})
    assert prepared[3] == 'word-reader' and len(commands) == 5
    assert not any(value in {'all', 'pacing'} for command, _ in commands for value in map(str, command))
    assert not list(tmp_path.iterdir())
