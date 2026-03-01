from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from context_engine.budget_manager import BudgetManager
from jobs.manager import JobManager
from services.context_engine import ContextEngine
from services.kb_service import KBService
from services.llm_gateway import LLMGateway
from services.wiki_import_service import WikiImportService
from services.editing_service import (
    add_message_version,
    activate_message_version,
    apply_selected_patch,
    chapter_meta,
    redo,
    rollback_version,
    undo,
)
from storage.fs_store import FSStore


def make_store(tmp_path: Path) -> FSStore:
    store = FSStore(tmp_path / "data")
    store.init_demo_project("p1")
    return store


def test_budget_manager_allocation(tmp_path: Path):
    s = make_store(tmp_path)
    cfg = s.read_yaml("p1", "project.yaml")
    bm = BudgetManager.from_project(cfg)
    limits = bm.bucket_limits()
    assert limits["system_rules"] > 0 and limits["output_reserve"] > 0
    report = bm.build_report({"cards": limits["cards"] + 1}, ["style_examples"])
    assert report["over_limit"]["cards"].startswith("over_limit")


def test_patch_accept_reject_and_versions_and_rollback(tmp_path: Path):
    s = make_store(tmp_path)
    s.write_md("p1", "drafts/chapter_001.md", "line1\nline2\nline3")
    res = apply_selected_patch(
        s,
        "p1",
        "chapter_001",
        "p001",
        [
            {"op_id": "op1", "type": "replace", "target_range": {"start": 1, "end": 2}, "before": "line2", "after": "line2A", "rationale": "a"},
            {"op_id": "op2", "type": "replace", "target_range": {"start": 2, "end": 3}, "before": "line3", "after": "line3B", "rationale": "b"},
        ],
        ["op1"],
    )
    assert "op1" in res["accepted_op_ids"] and "op2" in res["rejected_op_ids"]
    content = s.read_md("p1", "drafts/chapter_001.md")
    assert "line2A" in content and "line3B" not in content

    versions = chapter_meta(s, "p1", "chapter_001")["versions"]
    assert versions
    rolled = rollback_version(s, "p1", "chapter_001", versions[0]["version_id"])
    assert rolled["version_id"] == versions[0]["version_id"]


def test_sessions_message_versions_undo_redo(tmp_path: Path):
    s = make_store(tmp_path)
    sid = "session_001"
    add_message_version(s, "p1", sid, "m1", "v1")
    add_message_version(s, "p1", sid, "m1", "v2")
    activate_message_version(s, "p1", sid, "m1", "mv0001")
    meta = s.read_json("p1", f"sessions/{sid}.meta.json")
    assert meta["messages"]["m1"]["active_version"] == "mv0001"

    undo(s, "p1", sid)
    meta2 = s.read_json("p1", f"sessions/{sid}.meta.json")
    assert meta2["messages"]["m1"]["active_version"] == "mv0002"

    redo(s, "p1", sid)
    meta3 = s.read_json("p1", f"sessions/{sid}.meta.json")
    assert meta3["messages"]["m1"]["active_version"] == "mv0001"


def test_docs_and_manuscript_query_multi_and_manifest_trace(tmp_path: Path):
    s = make_store(tmp_path)
    kb = KBService(s)
    kb.upload_text("p1", "doc", "ref.md", "临港城有三层港区。雨季交通中断会影响补给。")
    kb.reindex("p1", "all")
    out = kb.query_multi("p1", "港区 补给", 8, [{"kb_id": "kb_docs", "weight": 1.0}, {"kb_id": "kb_manuscript", "weight": 1.2}])
    assert out and any(x["kb_id"] in {"kb_docs", "kb_manuscript"} for x in out)

    ctx = ContextEngine(s, kb)
    scene = s.read_json("p1", "cards/blueprint_001.json")["scene_plan"][0]
    manifest = ctx.build_manifest("p1", "chapter_001", scene, {"max_tokens": 1200})
    assert manifest.get("citation_map")
    assert any(e.get("kb_id") == "kb_manuscript" for e in manifest.get("evidence", []))
    assert manifest.get("budget")


def test_wiki_import_and_world_query(tmp_path: Path):
    s = make_store(tmp_path)
    wiki = WikiImportService(s)
    result = wiki.import_html("p1", "<html><head><title>测试页面</title></head><body><table class='infobox'><tr><th>别名</th><td>夜港</td></tr></table><h2>能力</h2><p>潮汐术。</p></body></html>")
    assert result["parsed"]["infobox"].get("别名") == "夜港"
    assert s.read_jsonl("p1", "canon/proposals.jsonl")

    kb = KBService(s)
    kb.reindex("p1", "kb_world")
    rows = kb.query("p1", "kb_world", "封锁 临港城", 5)
    assert rows and rows[0]["source"].get("path")


def test_provider_fallback_to_mock_and_canon_append(tmp_path: Path):
    s = make_store(tmp_path)
    project = s.read_yaml("p1", "project.yaml")
    project["llm_profiles"]["bad_provider"] = {
        "provider": "openai_compat",
        "model": "bad-model",
        "base_url": "http://127.0.0.1:9",
        "api_key": "",
        "timeout_s": 1,
        "stream": True,
    }
    s.write_yaml("p1", "project.yaml", project)

    kb = KBService(s)
    ctx = ContextEngine(s, kb)
    jm = JobManager(s, ctx, LLMGateway())

    import asyncio

    async def _run():
        jid = await jm.run_write_job("p1", {"chapter_id": "chapter_001", "blueprint_id": "blueprint_001", "scene_index": 0, "llm_profile_id": "bad_provider", "auto_apply_patch": True})
        seen = []
        async for e in jm.stream(jid):
            seen.append(e)
        return seen

    events = asyncio.run(_run())
    assert any(e["event"] == "ERROR" for e in events)
    wd = [e for e in events if e["event"] == "WRITER_DRAFT"][0]["data"]
    assert wd["provider"] == "mock"
    assert s.read_jsonl("p1", "canon/facts.jsonl")
    assert s.read_jsonl("p1", "canon/proposals.jsonl")


def test_character_schema_exposes_role_importance_age(tmp_path: Path):
    from schemas.json_schemas import CARD_TYPE_SCHEMAS

    schema = CARD_TYPE_SCHEMAS['character']
    payload_props = schema['properties']['payload']['properties']

    assert payload_props['role']['enum'] == ['protagonist', 'supporting', 'antagonist', 'other']
    assert payload_props['importance']['type'] == 'integer'
    assert payload_props['age']['type'] == 'integer'
    assert schema['properties']['stars']['minimum'] == 0
    assert schema['properties']['importance']['minimum'] == 1


def test_cards_api_roundtrip_character_role_importance_age(tmp_path: Path):
    s = make_store(tmp_path)

    card = {
        'id': 'character_test_001',
        'type': 'character',
        'title': 'Alice',
        'tags': ['主角', 'protagonist'],
        'links': [],
        'payload': {
            'name': 'Alice',
            'identity': '医学院研究生',
            'appearance': '短发',
            'core_motivation': '守护家人',
            'personality_traits': ['冷静', '克制'],
            'family_background': '普通家庭',
            'voice': '短句',
            'boundaries': ['不伤及无辜'],
            'relationships': [],
            'arc': [],
            'role': 'protagonist',
            'importance': 5,
            'age': 24,
        },
    }

    s.write_yaml('p1', 'cards/character_test_001.yaml', card)
    got = s.read_yaml('p1', 'cards/character_test_001.yaml')
    assert got['payload']['role'] == 'protagonist'
    assert got['payload']['importance'] == 5
    assert got['payload']['age'] == 24


def test_schema_contains_technique_and_category_payloads(tmp_path: Path):
    from schemas.json_schemas import CARD_TYPE_SCHEMAS

    assert "technique" in CARD_TYPE_SCHEMAS
    assert "technique_category" in CARD_TYPE_SCHEMAS
    t_props = CARD_TYPE_SCHEMAS["technique"]["properties"]["payload"]["properties"]
    c_props = CARD_TYPE_SCHEMAS["technique_category"]["properties"]["payload"]["properties"]
    assert "apply_steps" in t_props and "signals" in t_props and "intensity_levels" in t_props
    assert "name" in c_props and "sort_order" in c_props and "core_techniques" in c_props


def test_technique_merge_chapter_pinned_overrides_outline(tmp_path: Path):
    from agents.technique_director import merge_technique_mounts

    outline_prefs = [
        {"scope": "arc", "ref": "arc_main", "techniques": [{"technique_id": "technique_001", "intensity": "low"}, {"technique_id": "technique_010", "intensity": "med"}]},
        {"scope": "chapter", "ref": "chapter_001", "techniques": [{"technique_id": "technique_001", "intensity": "med", "notes": "chapter default"}]},
        {"scope": "beat", "ref": "chapter_001.b0", "techniques": [{"technique_id": "technique_001", "intensity": "high"}, {"technique_id": "technique_020", "intensity": "low"}]},
    ]
    pinned = [
        {"technique_id": "technique_001", "intensity": "med", "weight": 1.6, "notes": "pinned override"},
        {"technique_id": "technique_030", "intensity": "high"},
    ]

    selected, categories = merge_technique_mounts(outline_prefs, pinned, "chapter_001", scene_index=0)
    ids = [x["technique_id"] for x in selected]
    assert ids[:2] == ["technique_001", "technique_030"]
    assert ids.index("technique_020") < ids.index("technique_010")

    row = [x for x in selected if x["technique_id"] == "technique_001"][0]
    assert row["source"] == "pinned"
    assert row["effective_intensity"] == "med"
    assert row["effective_weight"] == 1.6

    beat_row = [x for x in selected if x["technique_id"] == "technique_020"][0]
    assert beat_row["source"] == "outline:beat"
    assert beat_row["effective_weight"] == 0.6


def test_pinned_technique_upsert_dedup_overwrites_fields():
    from agents.technique_director import upsert_pinned_technique_rows

    rows = [{"technique_id": "technique_001", "intensity": "low", "weight": 0.6, "notes": "old"}]
    out = upsert_pinned_technique_rows(rows, {"technique_id": "technique_001", "intensity": "high", "weight": 1.8, "notes": "new"})
    assert len(out) == 1
    assert out[0]["intensity"] == "high" and out[0]["weight"] == 1.8 and out[0]["notes"] == "new"



def test_macro_category_auto_recommends_micro(tmp_path: Path):
    from agents.technique_director import TechniqueDirector

    s = make_store(tmp_path)
    # category with core_techniques
    cat = {
        "id": "technique_category_narrative",
        "type": "technique_category",
        "title": "叙事艺术",
        "tags": [],
        "links": [],
        "payload": {"name": "叙事艺术", "core_techniques": ["technique_001", "technique_002", "technique_003"]},
    }
    s.write_yaml("p1", "cards/technique_category_narrative.yaml", cat)
    for i in [1, 2, 3]:
        s.write_yaml("p1", f"cards/technique_{i:03d}.yaml", {
            "id": f"technique_{i:03d}", "type": "technique", "title": f"T{i}", "tags": [], "links": ["technique_category_narrative"],
            "payload": {"name": f"T{i}", "apply_steps": ["a", "b", "c"], "signals": ["s1", "s2"]},
        })

    outline = s.read_yaml("p1", "cards/outline_001.yaml")
    outline.setdefault("payload", {})["technique_prefs"] = [
        {"scope": "chapter", "ref": "chapter_001", "categories": [{"category_id": "technique_category_narrative", "intensity": "high"}], "techniques": []}
    ]
    s.write_yaml("p1", "cards/outline_001.yaml", outline)

    td = TechniqueDirector(s)
    bundle = td.resolve_selected_bundle("p1", "chapter_001", outline, {"scene_index": 0})
    selected = bundle["selected_techniques"]
    assert any(x.get("source") == "auto_from_category" for x in selected)
    assert len([x for x in selected if x.get("source") == "auto_from_category"]) >= 2

def test_job_emits_technique_brief_and_manifest_fixed_block(tmp_path: Path):
    s = make_store(tmp_path)
    kb = KBService(s)
    ctx = ContextEngine(s, kb)
    jm = JobManager(s, ctx, LLMGateway())

    import asyncio

    async def _run():
        jid = await jm.run_write_job("p1", {"chapter_id": "chapter_001", "blueprint_id": "blueprint_001", "scene_index": 0, "llm_profile_id": "mock_default", "auto_apply_patch": False})
        events = []
        async for e in jm.stream(jid):
            events.append(e)
        return events

    events = asyncio.run(_run())
    assert any(e["event"] == "TECHNIQUE_BRIEF" for e in events)
    manifest = [e for e in events if e["event"] == "CONTEXT_MANIFEST"][0]["data"]
    assert "technique_brief" in manifest.get("fixed_blocks", {})


def test_critic_adds_technique_adherence_issue(tmp_path: Path):
    from agents.technique_director import derive_technique_adherence_issues

    issues = derive_technique_adherence_issues(
        "chapter_001",
        "# chapter_001\n\n林秋走进雨里。",
        [{"technique_id": "technique_001", "must_have_signals": ["镜头切换", "留白"]}],
    )
    assert issues and issues[0]["type"] == "technique_adherence"


def test_llm_config_profiles_assignments_crud(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    app_main.job_manager.store = app_main.store
    app_main.job_manager.context_engine.store = app_main.store
    app_main.job_manager.context_engine.kb = KBService(app_main.store)
    app_main.job_manager.technique_director.store = app_main.store
    app_main.llm_config_service = __import__("services.llm_config_service", fromlist=["LLMConfigService"]).LLMConfigService(app_main.store.data_dir)

    client = TestClient(app_main.app)

    rp = client.get('/api/config/llm/profiles')
    assert rp.status_code == 200 and 'profiles' in rp.json()

    up = client.post('/api/config/llm/profiles', json={
        'mode': 'upsert',
        'id': 'test_profile',
        'profile': {'provider': 'mock', 'model': 'mock-writer-v2', 'stream': True},
    })
    assert up.status_code == 200
    assert up.json()['profiles']['test_profile']['model'] == 'mock-writer-v2'

    ra = client.get('/api/config/llm/assignments')
    assert ra.status_code == 200 and 'assignments' in ra.json()

    ua = client.post('/api/config/llm/assignments', json={'mode': 'upsert', 'module': 'critic', 'profile_id': 'test_profile'})
    assert ua.status_code == 200
    assert ua.json()['assignments']['critic'] == 'test_profile'

    meta = client.get('/api/config/llm/providers_meta')
    assert meta.status_code == 200
    providers = meta.json()['providers']
    provider_ids = {p['provider_id'] for p in providers}
    for expected in {
        'mock',
        'ollama',
        'llama_cpp',
        'openai_compat:deepseek',
        'openai_compat:qwen',
        'openai_compat:kimi',
        'openai_compat:glm',
        'openai_compat:gemini',
        'openai_compat:grok',
        'openai_compat:custom',
    }:
        assert expected in provider_ids
    deepseek = [p for p in providers if p['provider_id'] == 'openai_compat:deepseek'][0]
    assert deepseek['display_name']
    assert 'provider' in deepseek['required_fields']
    assert 'api_key' in deepseek['optional_fields']
    assert deepseek['supports_stream'] is True


def test_assignment_profile_applied_for_module_and_fallback(tmp_path: Path):
    s = make_store(tmp_path)
    cfg_mod = __import__('services.llm_config_service', fromlist=['LLMConfigService'])
    cfg = cfg_mod.LLMConfigService(s.data_dir)

    profiles = cfg.read_profiles()
    profiles['bad_profile'] = {
        'provider': 'openai_compat',
        'model': 'bad-model',
        'base_url': 'http://127.0.0.1:9',
        'api_key': '',
        'timeout_s': 1,
        'stream': True,
    }
    cfg.write_profiles(profiles)
    cfg.write_assignments({'writer': 'bad_profile', 'critic': 'mock_default', 'editor': 'mock_default', 'canon_extractor': 'mock_default'})

    kb = KBService(s)
    ctx = ContextEngine(s, kb)
    jm = JobManager(s, ctx, LLMGateway())

    import asyncio

    async def _run():
        jid = await jm.run_write_job('p1', {'chapter_id': 'chapter_001', 'blueprint_id': 'blueprint_001', 'scene_index': 0, 'auto_apply_patch': False})
        events = []
        async for e in jm.stream(jid):
            events.append(e)
        return events

    events = asyncio.run(_run())
    manifest = [e for e in events if e['event'] == 'CONTEXT_MANIFEST'][0]['data']
    assert manifest['llm']['requested_profile_id'] == 'bad_profile'
    assert any(e['event'] == 'ERROR' and e['data'].get('stage') == 'writer' for e in events)
    wd = [e for e in events if e['event'] == 'WRITER_DRAFT'][0]['data']
    assert wd['provider'] == 'mock' and wd['fallback'] is True


def test_memory_pack_generated_and_readable(tmp_path: Path):
    import main as app_main
    import asyncio

    app_main.store = make_store(tmp_path)
    app_main.job_manager.store = app_main.store
    app_main.job_manager.context_engine.store = app_main.store
    app_main.job_manager.context_engine.kb = KBService(app_main.store)
    app_main.job_manager.technique_director.store = app_main.store

    async def _run():
        jid = await app_main.job_manager.run_write_job('p1', {
            'chapter_id': 'chapter_001',
            'blueprint_id': 'blueprint_001',
            'scene_index': 0,
            'llm_profile_id': 'mock_default',
            'auto_apply_patch': False,
        })
        async for _ in app_main.job_manager.stream(jid):
            pass
        return jid

    job_id = asyncio.run(_run())

    client = TestClient(app_main.app)
    packs = client.get('/api/projects/p1/memory_packs?chapter_id=chapter_001')
    assert packs.status_code == 200
    rows = packs.json()
    assert rows and rows[0]['pack_id'].startswith('chapter_001:job_')

    detail = client.get(f"/api/projects/p1/memory_packs/{rows[0]['pack_id']}")
    assert detail.status_code == 200
    pack = detail.json()
    assert pack['job_id'] == job_id
    assert 'budget_report' in pack and isinstance(pack['budget_report'], dict)
    assert 'evidence' in pack and isinstance(pack['evidence'], list)


def test_kb_query_card_stars_importance_weighting_affects_rank(tmp_path: Path):
    s = make_store(tmp_path)
    kb = KBService(s)

    s.write_yaml('p1', 'cards/character_rank_a.yaml', {
        'id': 'character_rank_a',
        'type': 'character',
        'title': 'A',
        'stars': 5,
        'importance': 5,
        'payload': {},
    })
    s.write_yaml('p1', 'cards/character_rank_b.yaml', {
        'id': 'character_rank_b',
        'type': 'character',
        'title': 'B',
        'stars': 0,
        'importance': 3,
        'payload': {},
    })

    rows = [
        {
            'chunk_id': 'a_0001',
            'kb_id': 'kb_docs',
            'asset_id': None,
            'ordinal': 0,
            'text': '临港城 封锁',
            'cleaned_text': '临港城 封锁',
            'features': {},
            'source': {'path': 'cards/character_rank_a.yaml', 'kind': 'card'},
        },
        {
            'chunk_id': 'b_0001',
            'kb_id': 'kb_docs',
            'asset_id': None,
            'ordinal': 1,
            'text': '临港城 封锁',
            'cleaned_text': '临港城 封锁',
            'features': {},
            'source': {'path': 'cards/character_rank_b.yaml', 'kind': 'card'},
        },
    ]
    for r in rows:
        s.append_jsonl('p1', 'meta/kb/kb_docs/chunks.jsonl', r)
    kb.reindex('p1', 'kb_docs')

    out = kb.query('p1', 'kb_docs', '临港城 封锁', top_k=2)
    assert len(out) == 2
    assert out[0]['chunk_id'] == 'a_0001'
    assert out[0]['score'] > out[1]['score']
    assert out[0]['retrieval_score'] == out[1]['retrieval_score']


def test_apply_patch_rejects_out_of_selection_range(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    app_main.job_manager.store = app_main.store
    app_main.job_manager.context_engine.store = app_main.store
    app_main.job_manager.context_engine.kb = KBService(app_main.store)

    app_main.store.write_md('p1', 'drafts/chapter_001.md', 'L1\nL2\nL3\nL4')
    client = TestClient(app_main.app)

    bad = client.post('/api/projects/p1/drafts/chapter_001/apply-patch', json={
        'patch_id': 'p_bad',
        'patch_ops': [
            {'op_id': 'op_bad', 'type': 'replace', 'target_range': {'start': 1, 'end': 1}, 'after': 'X'}
        ],
        'accept_op_ids': ['op_bad'],
        'selection_range': {'start': 2, 'end': 3},
    })
    assert bad.status_code == 400

    good = client.post('/api/projects/p1/drafts/chapter_001/apply-patch', json={
        'patch_id': 'p_good',
        'patch_ops': [
            {'op_id': 'op_ok', 'type': 'replace', 'target_range': {'start': 2, 'end': 2}, 'after': 'L2X'}
        ],
        'accept_op_ids': ['op_ok'],
        'selection_range': {'start': 2, 'end': 3},
    })
    assert good.status_code == 200
    assert 'L2X' in app_main.store.read_md('p1', 'drafts/chapter_001.md')


def test_analyze_endpoint_appends_facts_proposals_and_session_events(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    app_main.job_manager.store = app_main.store
    app_main.job_manager.context_engine.store = app_main.store
    app_main.job_manager.context_engine.kb = KBService(app_main.store)

    s = app_main.store
    s.write_md('p1', 'drafts/chapter_001.md', '# chapter_001\n\n临港城夜色沉下去。林秋看见黑潮同盟的标记。')

    facts_before = s.read_jsonl('p1', 'canon/facts.jsonl')
    proposals_before = s.read_jsonl('p1', 'canon/proposals.jsonl')

    client = TestClient(app_main.app)
    res = client.post('/api/projects/p1/analyze/chapter_001', json={'reason': 'test'})
    assert res.status_code == 200
    body = res.json()
    assert body['new_facts_count'] >= 1
    assert body['new_proposals_count'] >= 1

    facts_after = s.read_jsonl('p1', 'canon/facts.jsonl')
    proposals_after = s.read_jsonl('p1', 'canon/proposals.jsonl')
    assert len(facts_after) >= len(facts_before)
    assert len(proposals_after) >= len(proposals_before)
    assert facts_after[:len(facts_before)] == facts_before
    assert proposals_after[:len(proposals_before)] == proposals_before

    sess = s.read_jsonl('p1', 'sessions/session_001.jsonl')
    events = [x.get('event') for x in sess]
    assert 'ANALYZE_TRIGGERED' in events
    assert 'ANALYZE_RESULT' in events


def test_canon_fact_revise_and_composed_view(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    app_main.job_manager.store = app_main.store
    app_main.job_manager.context_engine.store = app_main.store
    app_main.job_manager.context_engine.kb = KBService(app_main.store)

    s = app_main.store
    s.append_jsonl('p1', 'canon/facts.jsonl', {
        'id': 'fact_test_001',
        'scope': 'world_state',
        'key': 'status',
        'value': '封锁中',
        'confidence': 0.8,
        'evidence': {'chapter_id': 'chapter_001', 'quote': '封锁'},
        'sources': [{'path': 'drafts/chapter_001.md'}],
    })
    before = s.read_jsonl('p1', 'canon/facts.jsonl')

    client = TestClient(app_main.app)
    rv = client.post('/api/projects/p1/canon/facts/fact_test_001/revise', json={
        'patch': {'value': '解除封锁', 'confidence': 0.9},
        'reason': '剧情推进后状态变化',
    })
    assert rv.status_code == 200

    rev_rows = s.read_jsonl('p1', 'canon/revisions.jsonl')
    assert rev_rows and rev_rows[-1]['target_fact_id'] == 'fact_test_001'

    after = s.read_jsonl('p1', 'canon/facts.jsonl')
    assert after == before

    composed = client.get('/api/projects/p1/canon/facts?include_revisions=true')
    assert composed.status_code == 200
    rows = composed.json()
    row = [x for x in rows if x.get('id') == 'fact_test_001'][-1]
    assert row['value'] == '解除封锁'
    assert row['_revised'] is True
    assert row['_original']['value'] == '封锁中'
