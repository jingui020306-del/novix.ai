import time
from pathlib import Path

from fastapi.testclient import TestClient

from main import app, store


client = TestClient(app)


def test_mock_closed_loop():
    r = client.post('/api/projects', json={"title": "T1"})
    assert r.status_code == 200
    pid = r.json()['project_id']

    character = {
        "id": "character_900",
        "type": "character",
        "title": "测试角色",
        "tags": [],
        "links": [],
        "payload": {
            "name": "甲", "identity": "侦探", "appearance": "高瘦", "core_motivation": "求真", "personality_traits": ["敏锐"],
            "family_background": "普通", "voice": "简洁", "boundaries": ["不杀人"], "relationships": [], "arc": []
        },
    }
    assert client.post(f'/api/projects/{pid}/cards', json=character).status_code == 200

    bp = {"id": "blueprint_001", "story_type_id": "longform_novel", "scene_plan": [{"scene_id": "s1", "phase": "setup", "purpose": "引子", "situation": "地铁站", "choice_points": ["追踪"], "cast": ["character_900"], "beats": ["b1"]}]}
    assert client.post(f'/api/projects/{pid}/blueprints', json=bp).status_code == 200

    store.write_yaml(pid, 'cards/style_001.yaml', {"id": "style_001", "type": "style", "title": "style", "payload": {"tone": "冷峻"}})
    store.write_yaml(pid, 'cards/outline_001.yaml', {"id": "outline_001", "type": "outline", "title": "outline", "payload": {"beats": [{"id": "b1", "summary": "开始"}]}})
    store.write_md(pid, 'drafts/chapter_001.md', '# c1\n\nold')

    jr = client.post(f'/api/projects/{pid}/jobs/write', json={"chapter_id": "chapter_001", "blueprint_id": "blueprint_001", "scene_index": 0, "agents": [], "constraints": {"max_words": 800}})
    assert jr.status_code == 200
    job_id = jr.json()['job_id']

    with client.websocket_connect(f'/api/jobs/{job_id}/stream') as ws:
        seen = []
        while True:
            evt = ws.receive_json()
            seen.append(evt['event'])
            if evt['event'] == 'DONE':
                break
    assert 'WRITER_DRAFT' in seen and 'CANON_UPDATES' in seen

    draft = client.get(f'/api/projects/{pid}/drafts/chapter_001').json()['content']
    assert '决定赴约' in draft

    facts = client.get(f'/api/projects/{pid}/canon/facts').json()
    assert len(facts) >= 1

    patch_log = store.read_jsonl(pid, 'drafts/chapter_001.patch.jsonl')
    assert patch_log
