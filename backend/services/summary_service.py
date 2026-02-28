from __future__ import annotations

import re
from typing import Any


def make_summaries(chapter_id: str, text: str) -> dict[str, Any]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip() and not p.startswith("#")]
    first = paragraphs[0] if paragraphs else ""
    last = paragraphs[-1] if paragraphs else ""
    named = [p for p in paragraphs if re.search(r"林秋|他|她|他们", p)]
    chapter_summary = "；".join([x for x in [first, *(named[:2]), last] if x])[:600]
    scene_summaries = [{"scene_id": f"scene_{i+1}", "summary": p[:150]} for i, p in enumerate(paragraphs[:3])]
    open_questions = []
    if "?" in text or "？" in text or "是否" in text:
        open_questions.append("关键抉择尚未完全揭示后果")
    canon_candidates = [{"type": "event", "text": s["summary"][:90]} for s in scene_summaries if s.get("summary")]
    return {
        "chapter_summary": chapter_summary,
        "scene_summaries": scene_summaries,
        "open_questions": open_questions,
        "canon_candidates": canon_candidates,
    }
