"""Exercise the same rehearsal routes and isolated card storage used by the workbench."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from test_author_workflow import card, store
from services.authoring_service import AuthoringService
from services.change_suggestion_service import ChangeSuggestionService


def test_local_rehearsal_route_replays_beliefs_without_cloud_or_canon_changes(store, monkeypatch):
    from routers import scene_rehearsals as api
    for person_id, name in [('elder', '姐姐'), ('younger', '妹妹'), ('outsider', '其他人')]:
        card(store, person_id, 'character', {'name': name})
    card(store, 'story_1', 'story', {'important_scenes': [
        {'id': 'talk', 'scene': '商议', 'characters': ['elder', 'younger']}]})
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[api.get_store] = lambda: store
    app.dependency_overrides[api.get_change_service] = lambda: ChangeSuggestionService(store)
    def unexpected(*args, **kwargs):
        pytest.fail('local rehearsal used a language model or queued a background suggestion')
    monkeypatch.setattr(AuthoringService, 'complete', unexpected)
    monkeypatch.setattr(ChangeSuggestionService, 'enqueue', unexpected)
    client = TestClient(app)
    path = '/api/projects/p/scene-rehearsals/story_1/talk'
    snap = client.get(path).json()
    base = {k: snap[k] for k in ('draft', 'source_versions', 'base_hash')}
    original = store.read_yaml('p', 'cards/story_1.yaml')
    options = snap['local_options']
    assert set(options['cast']) == {'elder', 'younger'}
    for choices in options['presets'].values():
        spec = {'actor_id': 'elder', 'partner_id': 'younger', 'topic': '本次事项', 'available': True,
                'choices': choices, 'actor_confidence': 0.8, 'partner_confidence': 0.8}
        def simulate(**changes):
            return client.post(path + '/simulate', json={**base, 'simulation': {**spec, **changes}})
        active = simulate().json()
        assert [s['chosen'] for s in active['steps']] == [choices['act'], choices['respond']]
        assert simulate(partner_confidence=0.2).json()['steps'][1]['chosen'] == choices['check']
        held = simulate(available=False).json()
        assert [s['chosen'] for s in held['steps']] == [choices['hold']]
        assert simulate(partner_id='outsider').status_code == 400
        assert simulate(actor_confidence=2).status_code == 422
    assert store.read_yaml('p', 'cards/story_1.yaml') == original
    draft = active['draft']
    request = {**base, 'draft': draft}
    assert client.post(path + '/preview', json=request).status_code == 200
    confirmed = client.post(path + '/confirm', json=request)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()['saved']['local_simulation'] == draft['local_simulation']
    assert confirmed.json()['change_suggestions']['queued_count'] == 0
    assert client.get(path).json()['draft'] == draft
    assert simulate().status_code == 409
    assert not store.read_jsonl('p', 'canon/facts.jsonl')


def test_local_rehearsal_engine_chain():
    from rehearsal_engines.runtime import availability
    from services.local_rehearsal import LocalRehearsal, PRESETS, rehearse
    from services.rehearsal_tools import social_actions
    installed = availability()
    if not installed['praxish']:
        pytest.skip('Node is not installed')
    assert social_actions(True)['after'] == {'act': ['respond', 'check'], 'hold': []}
    assert social_actions(False)['first'] == ['hold']
    if not all(installed.values()):
        pytest.skip('Install Sabre and FAtiMA for the full local integration test')
    context = {'scene': {'values': {'characters': ['a', 'b']}}, 'intersections': [], 'storylines': [],
               'characters': [{'id': key, 'label': key, 'payload': {}} for key in ('a', 'b')]}
    spec = LocalRehearsal(actor_id='a', partner_id='b', topic='本场事项', available=True,
                          choices=PRESETS['提出请求'], engines=list(installed), actor_confidence=0.8,
                          partner_confidence=0.57, desirability=8)
    positive = rehearse(context, spec)
    negative = rehearse(context, spec.model_copy(update={'desirability': -8}))
    assert positive['steps'][1]['acts'] and not negative['steps'][1]['acts']
    assert positive['engines']['fatima']['mood'] > 0 > negative['engines']['fatima']['mood']
    assert positive['engines']['sabre'] == [spec.choices.act, spec.choices.respond]
    unavailable = rehearse(context, spec.model_copy(update={'available': False}))
    assert unavailable['engines']['sabre'] == [] and 'fatima' not in unavailable['engines']
