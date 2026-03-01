from __future__ import annotations

from typing import Any

from storage.fs_store import FSStore


class TechniqueDirector:
    def __init__(self, store: FSStore):
        self.store = store

    def resolve_selected_techniques(self, project_id: str, chapter_id: str, outline: dict[str, Any], scene: dict[str, Any]) -> list[dict[str, Any]]:
        prefs = outline.get("payload", {}).get("technique_prefs", []) or []
        chapter_meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
        pinned = chapter_meta.get("pinned_techniques", []) or []

        scene_ref = f"{chapter_id}.b{(scene.get('scene_index', 0) if isinstance(scene.get('scene_index', 0), int) else 0)}"
        merged: dict[str, dict[str, Any]] = {}
        for row in prefs:
            scope = row.get("scope")
            ref = row.get("ref", "")
            if scope not in {"arc", "chapter", "beat"}:
                continue
            if scope == "arc" or (scope == "chapter" and ref == chapter_id) or (scope == "beat" and (ref == scene_ref or ref.startswith(chapter_id))):
                for t in row.get("techniques", []) or []:
                    tid = t.get("technique_id")
                    if tid:
                        merged[tid] = {"technique_id": tid, "intensity": t.get("intensity", "med"), "notes": t.get("notes", "")}
        for t in pinned:
            tid = t.get("technique_id")
            if tid:
                merged[tid] = {"technique_id": tid, "intensity": t.get("intensity", "med"), "notes": t.get("notes", "")}
        return list(merged.values())

    def build(self, project_id: str, chapter_id: str, plan: dict[str, Any], style_guide: dict[str, Any] | None, world_facts: list[dict[str, Any]] | None, selected: list[dict[str, Any]]) -> dict[str, Any]:
        cards_dir = self.store._safe_path(project_id, 'cards')
        cards = {}
        for f in cards_dir.glob('*.yaml'):
            card = self.store.read_yaml(project_id, f'cards/{f.name}')
            if card.get('type') == 'technique' and card.get('id'):
                cards[card['id']] = card
        checklist = []
        lines = [f"场景目标: {plan.get('scene', {}).get('purpose', '')}"]
        if style_guide:
            lines.append(f"文风约束: {style_guide}")
        if world_facts:
            lines.append(f"世界事实采样: {len(world_facts)} 条")

        for s in selected:
            tid = s.get("technique_id")
            card = cards.get(tid, {})
            p = card.get("payload", {})
            name = p.get("name") or card.get("title") or tid
            signals = (p.get("signals") or [])[:3]
            avoid = (p.get("do_dont", {}).get("dont") or [])[:2]
            checklist.append({
                "technique_id": tid,
                "must_have_signals": signals,
                "avoid": avoid,
                "intensity": s.get("intensity", "med"),
            })
            steps = (p.get("apply_steps") or [])[:3]
            lines.append(f"- {name}({s.get('intensity','med')}): " + "；".join(steps))

        constraints = {}
        for row in checklist:
            tid = row.get("technique_id")
            card = cards.get(tid, {})
            metrics = card.get("payload", {}).get("metrics") or {}
            for k, v in metrics.items():
                constraints[k] = v

        brief = "\n".join(lines)[:1200]
        return {
            "technique_brief": brief,
            "technique_checklist": checklist,
            "technique_style_constraints": constraints,
            "selected_techniques": selected,
        }


def derive_technique_adherence_issues(chapter_id: str, draft_text: str, checklist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues = []
    lower = draft_text.lower()
    last_line = draft_text.splitlines()[-1] if draft_text.splitlines() else ""
    for item in checklist:
        signals = item.get("must_have_signals", []) or []
        if not signals:
            continue
        hit = any(str(sig).lower() in lower for sig in signals)
        if not hit:
            issues.append({
                "type": "technique_adherence",
                "summary": f"未达成技法信号: {item.get('technique_id')}",
                "evidence": {"chapter_id": chapter_id, "line_range": [max(1, len(draft_text.splitlines()) - 1), len(draft_text.splitlines())], "quote": last_line[:120]},
                "suggested_fix": f"补入信号元素: {', '.join(signals[:2])}",
                "technique_id": item.get("technique_id"),
            })
    return issues
