from pathlib import Path
import sys


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
    assert "name" in c_props and "sort_order" in c_props


def test_technique_merge_chapter_pinned_overrides_outline(tmp_path: Path):
    from agents.technique_director import TechniqueDirector

    s = make_store(tmp_path)
    outline = s.read_yaml("p1", "cards/outline_001.yaml")
    outline.setdefault("payload", {})["technique_prefs"] = [
        {"scope": "chapter", "ref": "chapter_001", "techniques": [{"technique_id": "technique_001", "intensity": "low", "notes": "outline"}]}
    ]
    s.write_yaml("p1", "cards/outline_001.yaml", outline)
    meta = s.read_json("p1", "drafts/chapter_001.meta.json")
    meta["pinned_techniques"] = [{"technique_id": "technique_001", "intensity": "high", "notes": "chapter"}]
    s.write_json("p1", "drafts/chapter_001.meta.json", meta)

    td = TechniqueDirector(s)
    selected = td.resolve_selected_techniques("p1", "chapter_001", outline, {"scene_index": 0})
    row = [x for x in selected if x["technique_id"] == "technique_001"][0]
    assert row["intensity"] == "high"
    assert row["notes"] == "chapter"


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
