from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from storage.fs_store import FSStore, now_iso


SUPPORT_LEVELS = {"supported", "partial", "unsupported", "contradicted"}
AUTHOR_FEEDBACK_ACTIONS = {"confirm_hit", "false_positive", "ignore_chapter"}


def _hash_short(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]


class EvidenceService:
    def __init__(self, store: FSStore):
        self.store = store

    def _cards(self, project_id: str, card_type: str) -> list[dict[str, Any]]:
        cards_dir = self.store._safe_path(project_id, "cards")
        rows: list[dict[str, Any]] = []
        if not cards_dir.exists():
            return rows
        for f in cards_dir.glob("*.yaml"):
            card = self.store.read_yaml(project_id, f"cards/{f.name}")
            if card.get("type") == card_type:
                rows.append(card)
        return rows

    def _story_payload(self, project_id: str) -> dict[str, Any]:
        stories = self._cards(project_id, "story")
        if not stories:
            return {}
        return stories[0].get("payload", {}) or {}

    def _line_span_for_quote(self, text: str, quote: str) -> tuple[int, int, str] | None:
        quote = str(quote or "").strip()
        if not quote:
            return None
        lines = text.splitlines()
        for i, line in enumerate(lines, start=1):
            if quote in line:
                return i, i, quote
        compact = "".join(lines)
        if quote in compact and lines:
            return 1, min(len(lines), 3), quote
        return None

    def _first_text_hit(self, text: str, candidates: list[Any]) -> tuple[int, int, str] | None:
        for raw in candidates:
            value = str(raw or "").strip()
            if len(value) < 2:
                continue
            hit = self._line_span_for_quote(text, value)
            if hit:
                return hit
        return None

    def _make_mark(
        self,
        chapter_id: str,
        target_type: str,
        target_id: str,
        label: str,
        support_level: str,
        span: tuple[int, int, str] | None,
        *,
        confidence: float,
        method: str,
        matched_signals: list[str] | None = None,
        job_id: str = "",
        stage: str = "MARK_EXTRACTION",
        model: str = "",
        note: str = "",
    ) -> dict[str, Any]:
        start, end, quote = span if span else (0, 0, "")
        level = support_level if support_level in SUPPORT_LEVELS else "unsupported"
        seed = f"{chapter_id}:{target_type}:{target_id}:{label}:{start}:{quote}:{job_id}"
        return {
            "mark_id": f"mark_{_hash_short(seed)}",
            "chapter_id": chapter_id,
            "target_type": target_type,
            "target_id": target_id,
            "label": label,
            "claim_id": f"claim_{_hash_short(seed + ':claim')}",
            "span": {
                "source_path": f"drafts/{chapter_id}.md",
                "start_line": start,
                "end_line": end,
                "quote": quote,
            },
            "detection": {
                "method": method,
                "confidence": confidence,
                "support_level": level,
                "matched_signals": matched_signals or [],
                "note": note,
            },
            "agent_trace": {
                "job_id": job_id,
                "stage": stage,
                "model": model,
                "ts": now_iso(),
            },
        }

    def verify_mark(self, project_id: str, mark: dict[str, Any]) -> dict[str, Any]:
        chapter_id = str(mark.get("chapter_id") or "")
        text = self.store.read_md(project_id, f"drafts/{chapter_id}.md")
        span = mark.get("span", {}) if isinstance(mark.get("span"), dict) else {}
        quote = str(span.get("quote") or "")
        detection = mark.setdefault("detection", {})
        if not quote:
            detection["support_level"] = "unsupported"
            detection["confidence"] = min(float(detection.get("confidence", 0.0) or 0.0), 0.2)
            detection["note"] = detection.get("note") or "缺少可回查 quote"
            return mark
        if self._line_span_for_quote(text, quote):
            if detection.get("support_level") not in {"partial", "contradicted"}:
                detection["support_level"] = "supported"
            detection["confidence"] = max(float(detection.get("confidence", 0.0) or 0.0), 0.75)
            return mark
        detection["support_level"] = "unsupported"
        detection["confidence"] = min(float(detection.get("confidence", 0.0) or 0.0), 0.2)
        detection["note"] = "quote 不存在于当前正文"
        span["start_line"] = 0
        span["end_line"] = 0
        span["quote"] = ""
        mark["span"] = span
        return mark

    def build_marks(
        self,
        project_id: str,
        chapter_id: str,
        *,
        job_id: str = "",
        model: str = "",
        technique_checklist: list[dict[str, Any]] | None = None,
        issues: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        text = self.store.read_md(project_id, f"drafts/{chapter_id}.md")
        story = self._story_payload(project_id)
        marks: list[dict[str, Any]] = []

        for card in self._cards(project_id, "character"):
            payload = card.get("payload", {}) or {}
            names = [card.get("title"), payload.get("name"), *(payload.get("aliases") or [])]
            hit = self._first_text_hit(text, names)
            if hit:
                marks.append(self._make_mark(chapter_id, "character", card.get("id", ""), card.get("title") or card.get("id", ""), "supported", hit, confidence=0.82, method="rule", matched_signals=[hit[2]], job_id=job_id, model=model))

        for row in story.get("open_line", []) or []:
            if row.get("chapter") != chapter_id and row.get("chapter_id") != chapter_id:
                continue
            candidates = [row.get("event"), row.get("result"), row.get("goal")]
            hit = self._first_text_hit(text, candidates)
            level = "supported" if hit else "unsupported"
            marks.append(self._make_mark(chapter_id, "open_line", row.get("id") or row.get("chapter") or chapter_id, row.get("event") or "明线节点", level, hit, confidence=0.78 if hit else 0.18, method="rule", matched_signals=[hit[2]] if hit else [], job_id=job_id, model=model, note="" if hit else "正文未找到明线事件/结果"))

        for row in story.get("hidden_line", []) or []:
            if row.get("chapter") != chapter_id and row.get("chapter_id") != chapter_id:
                continue
            candidates = [row.get("visible_hint"), row.get("hidden_meaning")]
            hit = self._first_text_hit(text, candidates)
            level = "supported" if hit else "unsupported"
            marks.append(self._make_mark(chapter_id, "hidden_line", row.get("id") or row.get("chapter") or chapter_id, row.get("visible_hint") or row.get("truth") or "暗线节点", level, hit, confidence=0.76 if hit else 0.18, method="rule", matched_signals=[hit[2]] if hit else [], job_id=job_id, model=model, note="" if hit else "正文未找到暗线可见提示"))

        for row in story.get("foreshadowings", []) or []:
            if row.get("first_chapter") != chapter_id and row.get("payoff_chapter") != chapter_id:
                continue
            candidates = [row.get("surface_signal"), row.get("content"), row.get("payoff")]
            hit = self._first_text_hit(text, candidates)
            level = "supported" if hit else "unsupported"
            marks.append(self._make_mark(chapter_id, "foreshadowing", row.get("id") or f"foreshadow_{uuid.uuid4().hex[:6]}", row.get("content") or "伏笔", level, hit, confidence=0.76 if hit else 0.16, method="rule", matched_signals=[hit[2]] if hit else [], job_id=job_id, model=model, note="" if hit else "正文未找到伏笔显示方式"))

        for item in technique_checklist or []:
            tid = str(item.get("technique_id") or "")
            signals = [str(x) for x in (item.get("must_have_signals") or []) if str(x).strip()]
            hit = self._first_text_hit(text, signals)
            level = "supported" if hit else "unsupported"
            marks.append(self._make_mark(chapter_id, "technique", tid, tid, level, hit, confidence=0.74 if hit else 0.15, method="rule", matched_signals=[hit[2]] if hit else [], job_id=job_id, model=model, note="" if hit else "未找到技法可观察信号"))

        for issue in issues or []:
            ev = issue.get("evidence", {}) if isinstance(issue.get("evidence"), dict) else {}
            quote = ev.get("quote") or issue.get("summary") or issue.get("issue")
            hit = self._line_span_for_quote(text, str(quote or ""))
            marks.append(self._make_mark(chapter_id, "canon_fact", issue.get("id") or f"issue_{_hash_short(str(issue))}", issue.get("summary") or issue.get("issue") or "风险", "partial" if hit else "unsupported", hit, confidence=0.55 if hit else 0.12, method="llm_extractor", matched_signals=[hit[2]] if hit else [], job_id=job_id, stage="CLAIM_VERIFICATION", model=model, note=issue.get("summary") or issue.get("issue") or "审查风险"))

        verified = [self.verify_mark(project_id, m) for m in marks]
        return verified

    def save_marks(self, project_id: str, chapter_id: str, marks: list[dict[str, Any]]) -> None:
        rel = f"meta/evidence_marks/{chapter_id}.jsonl"
        path = self.store._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
        for mark in marks:
            self.store.append_jsonl(project_id, rel, mark)

    def list_marks(self, project_id: str, chapter_id: str) -> list[dict[str, Any]]:
        return self.store.read_jsonl(project_id, f"meta/evidence_marks/{chapter_id}.jsonl")

    def update_mark_feedback(self, project_id: str, chapter_id: str, mark_id: str, action: str, note: str = "") -> dict[str, Any]:
        if action not in AUTHOR_FEEDBACK_ACTIONS:
            raise ValueError("invalid feedback action")
        rel = f"meta/evidence_marks/{chapter_id}.jsonl"
        marks = self.list_marks(project_id, chapter_id)
        updated: dict[str, Any] | None = None
        for mark in marks:
            if mark.get("mark_id") != mark_id:
                continue
            detection = mark.setdefault("detection", {})
            previous = detection.get("support_level", "unsupported")
            feedback = {
                "action": action,
                "note": note,
                "previous_support_level": previous,
                "ts": now_iso(),
            }
            mark["author_feedback"] = feedback
            quote = str(((mark.get("span") or {}) if isinstance(mark.get("span"), dict) else {}).get("quote") or "")
            if action == "confirm_hit":
                if quote:
                    detection["support_level"] = "supported"
                    detection["confidence"] = max(float(detection.get("confidence", 0.0) or 0.0), 0.95)
                    detection["note"] = note or "作者确认命中"
                else:
                    detection["support_level"] = "unsupported"
                    detection["confidence"] = min(float(detection.get("confidence", 0.0) or 0.0), 0.2)
                    detection["note"] = note or "作者确认，但缺少可回查 quote，不能作为已命中证据"
            elif action == "false_positive":
                detection["support_level"] = "unsupported"
                detection["confidence"] = min(float(detection.get("confidence", 0.0) or 0.0), 0.1)
                detection["note"] = note or "作者标记为误判"
            elif action == "ignore_chapter":
                detection["ignored_by_author"] = True
                detection["note"] = note or "作者选择本章忽略"
            updated = mark
            break
        if updated is None:
            raise KeyError("mark not found")
        path = self.store._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(mark, ensure_ascii=False) for mark in marks) + ("\n" if marks else ""), encoding="utf-8")
        return updated

    def build_trust_report(self, project_id: str, chapter_id: str, marks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        marks = marks if marks is not None else self.list_marks(project_id, chapter_id)
        counts = {level: 0 for level in SUPPORT_LEVELS}
        ignored_count = 0
        for mark in marks:
            if (mark.get("detection", {}) or {}).get("ignored_by_author"):
                ignored_count += 1
                continue
            level = (mark.get("detection", {}) or {}).get("support_level", "unsupported")
            counts[level if level in counts else "unsupported"] += 1
        total = max(1, len(marks) - ignored_count)
        supported = counts["supported"] + counts["partial"] * 0.5
        risks = [
            m for m in marks
            if not (m.get("detection", {}) or {}).get("ignored_by_author")
            and (m.get("detection", {}) or {}).get("support_level") in {"unsupported", "contradicted"}
        ]
        report = {
            "chapter_id": chapter_id,
            "support_counts": counts,
            "support_rate": round(supported / total, 3),
            "required_count": len(marks),
            "ignored_count": ignored_count,
            "unsupported_count": counts["unsupported"],
            "contradicted_count": counts["contradicted"],
            "risks": risks[:20],
            "updated_at": now_iso(),
        }
        self.store.write_json(project_id, f"meta/trust_reports/{chapter_id}.json", report)
        return report

    def get_trust_report(self, project_id: str, chapter_id: str) -> dict[str, Any]:
        report = self.store.read_json(project_id, f"meta/trust_reports/{chapter_id}.json")
        if report:
            return report
        return self.build_trust_report(project_id, chapter_id)

    def verify_fact_evidence(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        evidence = body.get("evidence") if isinstance(body.get("evidence"), dict) else {}
        chapter_id = str(evidence.get("chapter_id") or "")
        if not chapter_id:
            return {"support_level": "unsupported", "reason": "Missing evidence.chapter_id"}
        quote = str(evidence.get("quote") or "")
        line_range = evidence.get("line_range") or [evidence.get("start_line"), evidence.get("end_line")]
        if quote:
            hit = self._line_span_for_quote(self.store.read_md(project_id, f"drafts/{chapter_id}.md"), quote)
            if hit:
                return {"support_level": "supported", "reason": "quote verified", "line_range": [hit[0], hit[1]], "quote": hit[2]}
            return {"support_level": "unsupported", "reason": "quote not found"}
        if isinstance(line_range, list) and len(line_range) == 2 and line_range[0] and line_range[1]:
            return {"support_level": "partial", "reason": "line range provided without quote", "line_range": line_range}
        return {"support_level": "unsupported", "reason": "Missing quote or line range"}
