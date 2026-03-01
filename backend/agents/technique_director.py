from __future__ import annotations

from typing import Any

from storage.fs_store import FSStore

DEFAULT_WEIGHTS = {"low": 0.6, "med": 1.0, "high": 1.4}


def _effective(intensity: str, weight: Any, defaults: dict[str, float]) -> tuple[str, float]:
    i = str(intensity or "med")
    w = float(weight) if weight is not None else float(defaults.get(i, 1.0))
    return i, w


def merge_technique_mounts(
    outline_prefs: list[dict[str, Any]],
    chapter_pinned: list[dict[str, Any]],
    chapter_id: str,
    scene_index: int = 0,
    weight_defaults: dict[str, float] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (selected_micro_techniques, selected_macro_categories)."""
    defaults = {**DEFAULT_WEIGHTS, **(weight_defaults or {})}

    precedence = {"outline:arc": 0, "outline:chapter": 1, "outline:beat": 2, "pinned": 3}
    techs: dict[str, dict[str, Any]] = {}
    cats: dict[str, dict[str, Any]] = {}
    seq: dict[str, int] = {}
    n = 0

    def apply_item(pool: dict[str, dict[str, Any]], key_name: str, row: dict[str, Any], source: str) -> None:
        nonlocal n
        key = row.get(key_name)
        if not key:
            return
        intensity, weight = _effective(row.get("intensity", "med"), row.get("weight"), defaults)
        base = pool.get(key, {key_name: key})
        out = {
            **base,
            key_name: key,
            "intensity": intensity,
            "weight": weight,
            "notes": row.get("notes", base.get("notes", "")),
            "source": source,
            "effective_intensity": intensity,
            "effective_weight": weight,
        }
        prev = pool.get(key)
        if not prev or precedence[source] >= precedence.get(prev.get("source", "outline:arc"), -1):
            pool[key] = out
            if key not in seq:
                seq[key] = n
                n += 1

    beat_ref = f"{chapter_id}.b{scene_index}"
    for scope in ("arc", "chapter", "beat"):
        for pref in outline_prefs or []:
            if pref.get("scope") != scope:
                continue
            ref = str(pref.get("ref", ""))
            matched = scope == "arc" or (scope == "chapter" and ref == chapter_id) or (scope == "beat" and (ref == beat_ref or ref.startswith(f"{chapter_id}.b")))
            if not matched:
                continue
            source = f"outline:{scope}"
            for t in pref.get("techniques", []) or []:
                apply_item(techs, "technique_id", t, source)
            for c in pref.get("categories", []) or []:
                apply_item(cats, "category_id", c, source)

    for row in chapter_pinned or []:
        apply_item(techs, "technique_id", row, "pinned")

    out_techs = list(techs.values())
    out_cats = list(cats.values())
    out_techs.sort(key=lambda x: (-precedence.get(str(x.get("source", "outline:arc")), 0), seq.get(str(x.get("technique_id", "")), 9999)))
    out_cats.sort(key=lambda x: (-precedence.get(str(x.get("source", "outline:arc")), 0), seq.get(str(x.get("category_id", "")), 9999)))
    return out_techs, out_cats


def upsert_pinned_technique_rows(rows: list[dict[str, Any]], item: dict[str, Any]) -> list[dict[str, Any]]:
    tid = item.get("technique_id")
    if not tid:
        return rows
    out = []
    replaced = False
    for r in rows or []:
        if r.get("technique_id") == tid:
            out.append({**r, **item})
            replaced = True
        else:
            out.append(r)
    if not replaced:
        out.insert(0, item)
    return out


class TechniqueDirector:
    def __init__(self, store: FSStore):
        self.store = store

    def _load_technique_cards(self, project_id: str) -> dict[str, dict[str, Any]]:
        cards_dir = self.store._safe_path(project_id, "cards")
        cards: dict[str, dict[str, Any]] = {}
        for f in cards_dir.glob("*.yaml"):
            card = self.store.read_yaml(project_id, f"cards/{f.name}")
            if card.get("type") == "technique" and card.get("id"):
                cards[card["id"]] = card
        return cards

    def _load_category_cards(self, project_id: str) -> dict[str, dict[str, Any]]:
        cards_dir = self.store._safe_path(project_id, "cards")
        cards: dict[str, dict[str, Any]] = {}
        for f in cards_dir.glob("*.yaml"):
            card = self.store.read_yaml(project_id, f"cards/{f.name}")
            if card.get("type") == "technique_category" and card.get("id"):
                cards[card["id"]] = card
        return cards

    def resolve_selected_bundle(self, project_id: str, chapter_id: str, outline: dict[str, Any], scene: dict[str, Any]) -> dict[str, Any]:
        prefs = outline.get("payload", {}).get("technique_prefs", []) or []
        chapter_meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
        pinned = chapter_meta.get("pinned_techniques", []) or []
        scene_index = int(scene.get("scene_index", 0) or 0)
        selected_techniques, selected_categories = merge_technique_mounts(prefs, pinned, chapter_id, scene_index)

        # macro -> auto micro 추천
        cat_cards = self._load_category_cards(project_id)
        for c in selected_categories:
            cc = cat_cards.get(c.get("category_id"), {})
            core = (cc.get("payload", {}) or {}).get("core_techniques", []) or []
            picks = core[:5]  # 3~5 by design; use up to 5
            for tid in picks:
                if any(x.get("technique_id") == tid for x in selected_techniques):
                    continue
                selected_techniques.append(
                    {
                        "technique_id": tid,
                        "source": "auto_from_category",
                        "intensity": c.get("effective_intensity", c.get("intensity", "med")),
                        "weight": c.get("effective_weight", c.get("weight", 1.0)),
                        "effective_intensity": c.get("effective_intensity", c.get("intensity", "med")),
                        "effective_weight": c.get("effective_weight", c.get("weight", 1.0)),
                        "notes": f"auto from {c.get('category_id')}",
                    }
                )

        return {
            "selected_techniques": selected_techniques,
            "selected_categories": selected_categories,
        }

    def resolve_selected_techniques(self, project_id: str, chapter_id: str, outline: dict[str, Any], scene: dict[str, Any]) -> list[dict[str, Any]]:
        return self.resolve_selected_bundle(project_id, chapter_id, outline, scene)["selected_techniques"]

    def build(
        self,
        project_id: str,
        chapter_id: str,
        plan: dict[str, Any],
        style_guide: dict[str, Any] | None,
        world_facts: list[dict[str, Any]] | None,
        selected_techniques: list[dict[str, Any]],
        selected_categories: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        cards = self._load_technique_cards(project_id)
        checklist: list[dict[str, Any]] = []
        lines = [f"场景目标: {plan.get('scene', {}).get('purpose', '')}"]
        if selected_categories:
            lines.append(f"宏观分类: {[c.get('category_id') for c in selected_categories]}")
        if style_guide:
            lines.append(f"文风约束: {style_guide}")
        if world_facts:
            lines.append(f"世界事实采样: {len(world_facts)} 条")

        for s in selected_techniques:
            tid = s.get("technique_id")
            card = cards.get(tid, {})
            p = card.get("payload", {})
            name = p.get("name") or card.get("title") or tid
            signals = (p.get("signals") or [])[:3]
            avoid = (p.get("do_dont", {}).get("dont") or [])[:2]
            checklist.append(
                {
                    "technique_id": tid,
                    "must_have_signals": signals,
                    "avoid": avoid,
                    "source": s.get("source", "outline:arc"),
                    "effective_intensity": s.get("effective_intensity", s.get("intensity", "med")),
                    "effective_weight": s.get("effective_weight", s.get("weight", 1.0)),
                }
            )
            steps = (p.get("apply_steps") or [])[:3]
            lines.append(
                f"- {name}({s.get('effective_intensity', s.get('intensity', 'med'))},w={s.get('effective_weight', s.get('weight', 1.0))},src={s.get('source','outline:arc')}): "
                + "；".join(steps)
            )

        constraints = {}
        for row in checklist:
            card = cards.get(row.get("technique_id"), {})
            metrics = card.get("payload", {}).get("metrics") or {}
            for k, v in metrics.items():
                constraints[k] = v

        brief = "\n".join(lines)[:1200]
        return {
            "technique_brief": brief,
            "technique_checklist": checklist,
            "technique_style_constraints": constraints,
            "selected_techniques": selected_techniques,
            "selected_categories": selected_categories or [],
        }


def derive_technique_adherence_issues(chapter_id: str, draft_text: str, checklist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues = []
    lower = draft_text.lower()
    lines = draft_text.splitlines()
    last_line = lines[-1] if lines else ""
    line_count = len(lines)
    for item in checklist:
        signals = item.get("must_have_signals", []) or []
        if not signals:
            continue
        hit = any(str(sig).lower() in lower for sig in signals)
        if not hit:
            issues.append(
                {
                    "type": "technique_adherence",
                    "summary": f"未达成技法信号: {item.get('technique_id')}",
                    "evidence": {
                        "chapter_id": chapter_id,
                        "line_range": [max(1, line_count - 1), max(1, line_count)],
                        "quote": last_line[:120],
                    },
                    "suggested_fix": f"补入信号元素: {', '.join(signals[:2])}",
                    "technique_id": item.get("technique_id"),
                    "signals": signals,
                }
            )
    return issues
