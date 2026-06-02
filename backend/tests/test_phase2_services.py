from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from context_engine.budget_manager import BudgetManager
from jobs.manager import JobManager
from services.context_engine import ContextEngine
from services.evidence_service import EvidenceService
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


def test_read_yaml_accepts_simple_yaml_cards(tmp_path: Path):
    s = make_store(tmp_path)
    path = s._safe_path("p1", "cards/simple_yaml_card.yaml")
    path.write_text(
        "id: simple_yaml_card\n"
        "type: lore\n"
        "title: 简单 YAML 卡\n"
        "tags: [lore, test]\n"
        "links: []\n"
        "payload:\n"
        "  summary: 可被兼容读取。\n"
        "  level: 2\n",
        encoding="utf-8",
    )
    got = s.read_yaml("p1", "cards/simple_yaml_card.yaml")
    assert got["type"] == "lore"
    assert got["tags"] == ["lore", "test"]
    assert got["payload"]["summary"] == "可被兼容读取。"
    assert got["payload"]["level"] == 2


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
    from schemas.json_schemas import CARD_TYPE_SCHEMAS, VOLUME_SCHEMA

    assert "technique" in CARD_TYPE_SCHEMAS
    assert "technique_category" in CARD_TYPE_SCHEMAS
    assert "tool_skill" in CARD_TYPE_SCHEMAS
    assert VOLUME_SCHEMA["properties"]["chapter_ids"]["type"] == "array"
    story_props = CARD_TYPE_SCHEMAS["story"]["properties"]["payload"]["properties"]
    t_props = CARD_TYPE_SCHEMAS["technique"]["properties"]["payload"]["properties"]
    c_props = CARD_TYPE_SCHEMAS["technique_category"]["properties"]["payload"]["properties"]
    tool_props = CARD_TYPE_SCHEMAS["tool_skill"]["properties"]["payload"]["properties"]
    assert "keywords" in story_props and "target_reader" in story_props and "banned_items" in story_props
    assert "apply_steps" in t_props and "signals" in t_props and "intensity_levels" in t_props
    assert "name" in c_props and "sort_order" in c_props and "core_techniques" in c_props
    assert tool_props["auto_apply_allowed"]["default"] is False
    assert tool_props["evidence_required"]["default"] is True


def test_demo_seed_contains_build_fields_and_tool_skills(tmp_path: Path):
    s = make_store(tmp_path)

    story = s.read_yaml("p1", "cards/story_001.yaml")
    tool_skill = s.read_yaml("p1", "cards/tool_skill_problem_checker.yaml")
    technique = s.read_yaml("p1", "cards/technique_001.yaml")

    assert story["payload"]["keywords"]
    assert story["payload"]["target_reader"]
    assert story["payload"]["banned_items"]
    assert tool_skill["type"] == "tool_skill"
    assert tool_skill["payload"]["auto_apply_allowed"] is False
    assert "悬念" in technique["title"]


def test_build_drafts_api_roundtrip(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    client = TestClient(app_main.app)
    story = app_main.store.read_yaml("p1", "cards/story_001.yaml")

    created = client.post("/api/projects/p1/build-drafts", json={
        "kind": "story_overview",
        "revision": 2,
        "selected_chapter": "chapter_001",
        "story_card": story,
    })
    assert created.status_code == 200
    body = created.json()
    assert body["kind"] == "story_overview"
    assert body["revision"] == 2
    assert body["status"] == "pending"
    assert body["draft_id"].startswith("build_story_overview_")
    assert "keywords" in body["body"]

    listed = client.get("/api/projects/p1/build-drafts?kind=story_overview")
    assert listed.status_code == 200
    assert any(x["draft_id"] == body["draft_id"] for x in listed.json())

    updated = client.put(f"/api/projects/p1/build-drafts/{body['draft_id']}", json={
        "body": '{"accepted": true}',
        "status": "accepted",
        "accepted_target": "story_001",
    })
    assert updated.status_code == 200
    assert updated.json()["status"] == "accepted"
    assert updated.json()["accepted_target"] == "story_001"

    bad = client.post("/api/projects/p1/build-drafts", json={"kind": "not_real"})
    assert bad.status_code == 400


def test_volumes_api_and_chapter_meta_binding(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    client = TestClient(app_main.app)

    created = client.post('/api/projects/p1/volumes', json={
        'id': 'volume_001',
        'title': '第一卷',
        'summary': '开篇卷',
        'order_index': 1,
    })
    assert created.status_code == 200

    put = client.put('/api/projects/p1/drafts/chapter_002', json={
        'content': '# Chapter 002\n\n新的线索出现。',
        'title': '第二章',
        'volume_id': 'volume_001',
        'order_index': 2,
        'chapter_status': 'drafting',
    })
    assert put.status_code == 200
    meta = client.get('/api/projects/p1/drafts/chapter_002/meta').json()
    assert meta['volume_id'] == 'volume_001'
    assert meta['chapter_title'] == '第二章'

    volumes = client.get('/api/projects/p1/volumes')
    assert volumes.status_code == 200
    rows = volumes.json()
    volume = [x for x in rows if x['id'] == 'volume_001'][0]
    assert any(ch['chapter_id'] == 'chapter_002' for ch in volume['chapters'])


def test_legacy_chapter_defaults_to_default_volume(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    app_main.store.write_md('p1', 'drafts/chapter_legacy.md', '# Legacy')
    app_main.store.write_md('p1', 'drafts/.chapter_order', 'chapter_legacy\n')
    app_main.store.write_json('p1', 'drafts/chapter_legacy.meta.json', {'chapter_id': 'chapter_legacy', 'title': '旧章节'})

    client = TestClient(app_main.app)
    details = client.get('/api/projects/p1/drafts/details').json()
    assert details[0]['volume_id'] == 'volume_default'
    assert details[0]['chapter_status'] == 'drafting'


def test_story_structure_roundtrip_with_chapter_binding(tmp_path: Path):
    s = make_store(tmp_path)
    story = s.read_yaml('p1', 'cards/story_001.yaml')
    story['payload']['chapter_plan'][0]['chapter_id'] = 'chapter_001'
    story['payload']['foreshadowings'][0]['status'] = '已埋'
    s.write_yaml('p1', 'cards/story_001.yaml', story)
    got = s.read_yaml('p1', 'cards/story_001.yaml')
    assert got['payload']['chapter_plan'][0]['chapter_id'] == 'chapter_001'
    assert got['payload']['foreshadowings'][0]['status'] == '已埋'


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
    brief = [e for e in events if e["event"] == "TECHNIQUE_BRIEF"][0]["data"]
    assert brief.get("technique_agent_tags")
    assert any(row.get("agent_tags") for row in brief.get("technique_checklist", []))

    manifest = [e for e in events if e["event"] == "CONTEXT_MANIFEST"][0]["data"]
    assert "technique_brief" in manifest.get("fixed_blocks", {})
    assert manifest.get("fixed_blocks", {}).get("technique_agent_tags")


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


def test_evidence_marks_and_trust_report_verify_quotes(tmp_path: Path):
    s = make_store(tmp_path)
    s.write_md('p1', 'drafts/chapter_001.md', '# c1\n\n林秋摸到口袋里的旧票根。蓝色车票被雨水浸湿。')
    svc = EvidenceService(s)

    marks = svc.build_marks('p1', 'chapter_001', job_id='job_test', model='mock', technique_checklist=[
        {'technique_id': 'technique_001', 'must_have_signals': ['蓝色车票']},
        {'technique_id': 'technique_missing', 'must_have_signals': ['不存在的技法信号']},
    ])
    svc.save_marks('p1', 'chapter_001', marks)
    report = svc.build_trust_report('p1', 'chapter_001', marks)

    assert any(m['target_type'] == 'technique' and m['detection']['support_level'] == 'supported' for m in marks)
    assert any(m['target_id'] == 'technique_missing' and m['detection']['support_level'] == 'unsupported' for m in marks)
    assert report['unsupported_count'] >= 1
    bad = svc.verify_mark('p1', {'chapter_id': 'chapter_001', 'span': {'quote': '假的引用'}, 'detection': {'support_level': 'supported', 'confidence': 0.9}})
    assert bad['detection']['support_level'] == 'unsupported'


def test_canon_append_fact_marks_unverified_quote(tmp_path: Path):
    import main as app_main

    app_main.store = make_store(tmp_path)
    client = TestClient(app_main.app)
    res = client.post('/api/projects/p1/canon/append-fact', json={
        'id': 'fact_bad_quote',
        'scope': 'chapter_summary',
        'key': 'summary',
        'value': 'AI 声称的事实',
        'confidence': 0.9,
        'evidence': {'chapter_id': 'chapter_001', 'quote': '正文里没有这句话'},
    })
    assert res.status_code == 200
    body = res.json()
    assert body['evidence_verification']['support_level'] == 'unsupported'
    fact = [x for x in app_main.store.read_jsonl('p1', 'canon/facts.jsonl') if x.get('id') == 'fact_bad_quote'][0]
    assert fact['status'] == 'unverified'
    assert fact['confidence'] <= 0.2


def test_write_job_emits_three_agent_trust_events_and_marks(tmp_path: Path):
    s = make_store(tmp_path)
    kb = KBService(s)
    ctx = ContextEngine(s, kb)
    jm = JobManager(s, ctx, LLMGateway())

    import asyncio

    async def _run():
        jid = await jm.run_write_job('p1', {
            'chapter_id': 'chapter_001',
            'blueprint_id': 'blueprint_001',
            'scene_index': 0,
            'auto_apply_patch': False,
            'word_checkpoint_chars': 10,
        })
        events = []
        async for e in jm.stream(jid):
            events.append(e)
        return jid, events

    job_id, events = asyncio.run(_run())
    seen = [e['event'] for e in events]
    for required in ['PRE_REVIEW_PLAN', 'CONTEXT_MANIFEST', 'WRITER_DRAFT', 'MARK_EXTRACTION', 'CLAIM_VERIFICATION', 'CRITIC_REVIEW', 'PROOFREAD_PATCH', 'TRUST_REPORT']:
        assert required in seen
    for evt in events:
        if evt['event'] == 'DONE':
            continue
        data = evt['data']
        assert data['job_id'] == job_id
        assert 'stage' in data and 'provider' in data and 'model' in data and 'fallback' in data
    assert s.read_jsonl('p1', 'meta/evidence_marks/chapter_001.jsonl')
    assert s.read_json('p1', 'meta/trust_reports/chapter_001.json')['chapter_id'] == 'chapter_001'
    pack = s.read_json('p1', f'meta/memory_packs/chapter_001/{job_id}.json')
    assert 'source_mark_ids' in pack and 'compression_reason' in pack


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


def test_fsstore_rejects_project_id_outside_data_root(tmp_path: Path):
    store = FSStore(tmp_path / "data")
    try:
        store._project_dir("../data_hijack")
        assert False, "expected ValueError for traversal project id"
    except ValueError:
        pass


def test_split_chunks_preserves_overflow_sentence_content():
    from services.kb_service import split_chunks

    long_sentence = "甲" * 900
    text = f"第一段。\n\n{long_sentence}。结尾。"
    chunks = split_chunks(text)
    merged = "".join(chunks)
    assert "第一段" in merged
    assert "结尾" in merged
    assert len(merged) >= len("第一段。" + long_sentence + "。结尾。")


def test_create_job_invalid_payload_returns_400_and_stream_not_hanging(tmp_path: Path):
    store = make_store(tmp_path)
    kb = KBService(store)
    ctx = ContextEngine(store, kb)
    jm = JobManager(store, ctx, LLMGateway())

    import main as app_main

    old_store = app_main.store
    old_kb = app_main.kb_service
    old_ctx = app_main.context_engine
    old_jm = app_main.job_manager
    app_main.store = store
    app_main.kb_service = kb
    app_main.context_engine = ctx
    app_main.job_manager = jm
    try:
        client = TestClient(app_main.app)
        resp = client.post('/api/projects/p1/jobs/write', json={'blueprint_id': 'blueprint_001'})
        assert resp.status_code == 400
        assert 'chapter_id' in resp.text
    finally:
        app_main.store = old_store
        app_main.kb_service = old_kb
        app_main.context_engine = old_ctx
        app_main.job_manager = old_jm
