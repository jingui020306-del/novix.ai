from __future__ import annotations

from typing import Any

from services.kb_service import KBService
from storage.fs_store import FSStore


def approx_tokens(text: str) -> int:
    return max(1, len(text) // 2)


class ContextEngine:
    def __init__(self, store: FSStore, kb: KBService):
        self.store = store
        self.kb = kb

    def build_manifest(self, project_id: str, chapter_id: str, scene: dict[str, Any], constraints: dict[str, Any] | None = None) -> dict[str, Any]:
        constraints = constraints or {}
        proj = self.store.read_yaml(project_id, "project.yaml")
        budget = int(constraints.get("max_tokens") or proj.get("token_budgets", {}).get("default", 2400))
        style = self.store.read_yaml(project_id, "cards/style_001.yaml")
        outline = self.store.read_yaml(project_id, "cards/outline_001.yaml")
        cast = scene.get("cast", [])
        cards = [self.store.read_yaml(project_id, f"cards/{cid}.yaml") for cid in cast if cid]
        canon_facts = self.store.read_jsonl(project_id, "canon/facts.jsonl")[-8:]
        canon_issues = self.store.read_jsonl(project_id, "canon/issues.jsonl")[-8:]
        chapter_meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")

        guide = style.get("payload", {}).get("style_guide", {})
        policy = style.get("payload", {}).get("injection_policy", {"max_examples": 4, "max_chars_per_example": 800})
        active_assets = style.get("payload", {}).get("active_style_sample_asset_ids", [])
        query_text = " ".join([scene.get("purpose", ""), scene.get("situation", ""), *scene.get("choice_points", [])])

        if not self.store.read_jsonl(project_id, "meta/kb/kb_manuscript/chunks.jsonl"):
            self.kb.reindex_manuscript(project_id)

        writer_evidence = self.kb.query_multi(project_id, query_text, 12, [
            {"kb_id": "kb_manuscript", "weight": 1.2},
            {"kb_id": "kb_docs", "weight": 1.0},
            {"kb_id": "kb_style", "weight": 0.6},
        ], filters={})

        critic_evidence = self.kb.query_multi(project_id, query_text + " 冲突 设定 矛盾", 10, [
            {"kb_id": "kb_manuscript", "weight": 1.3},
            {"kb_id": "kb_docs", "weight": 1.0},
            {"kb_id": "kb_style", "weight": 0.2},
        ], filters={})

        style_examples = [e for e in writer_evidence if e.get("kb_id") == "kb_style"][: int(policy.get("max_examples", 4))]
        for ex in style_examples:
            ex["text"] = ex["text"][: int(policy.get("max_chars_per_example", 800))]

        evidence = writer_evidence[:12]
        citation_map = {e["chunk_id"]: e["source"] for e in evidence}

        fixed_blocks = {
            "style_guide": guide,
            "scene_plan": scene,
            "outline_beats": outline.get("payload", {}).get("beats", []),
        }
        manifest = {
            "token_budgets": {"max_tokens": budget},
            "fixed_blocks": fixed_blocks,
            "included_cards": cards,
            "included_canon": {"facts": canon_facts, "issues": canon_issues},
            "included_evidence_chunks": {"style_examples": style_examples, "draft_summaries": chapter_meta.get("scene_summaries", [])},
            "evidence": evidence,
            "world_facts": world_facts,
            "citation_map": citation_map,
            "critic_evidence": critic_evidence,
            "dropped_items": dropped_items,
            "compression_steps": compression_steps,
        }

        usage = {
            "system_rules": approx_tokens(str(fixed_blocks)),
            "cards": approx_tokens(str(cards)),
            "canon": approx_tokens(str(canon_facts) + str(canon_issues)),
            "summaries": approx_tokens(str(chapter_meta.get("scene_summaries", []))),
            "current_draft": approx_tokens(self.store.read_md(project_id, f"drafts/{chapter_id}.md")),
            "world": approx_tokens(str(world_facts)),
            "output_reserve": limits.get("output_reserve", 0),
        }

        if usage["cards"] > limits["cards"]:
            compression_steps.append("trim_cards_fields")
            trimmed_cards = []
            for c in cards:
                p = c.get("payload", {})
                trimmed_cards.append({"id": c.get("id"), "type": c.get("type"), "payload": {"identity": p.get("identity"), "voice": p.get("voice"), "boundaries": p.get("boundaries")}})
            manifest["included_cards"] = trimmed_cards
            usage["cards"] = approx_tokens(str(trimmed_cards))

        if usage["current_draft"] + usage["canon"] > limits["current_draft"] + limits["canon"]:
            compression_steps.append("prefer_manuscript_summary")
            man = [e for e in manifest["evidence"] if e.get("kb_id") == "kb_manuscript"][:2]
            docs = [e for e in manifest["evidence"] if e.get("kb_id") == "kb_docs"][:1]
            manifest["evidence"] = man + docs
            manifest["citation_map"] = {e["chunk_id"]: e["source"] for e in manifest["evidence"]}
            manifest["included_evidence_chunks"]["draft_summaries"] = [{"chapter_summary": chapter_meta.get("chapter_summary", "")[:200]}]

        examples_tokens = approx_tokens(str(style_examples))
        if used + examples_tokens > budget:
            manifest["dropped_items"].append("style_examples")
            manifest["included_evidence_chunks"]["style_examples"] = []
        return manifest
