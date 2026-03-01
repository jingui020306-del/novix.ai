from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from services.llm_gateway import LLMGateway


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CanonExtractorService:
    def __init__(self, llm_gateway: LLMGateway):
        self.llm_gateway = llm_gateway

    async def extract(self, chapter_id: str, chapter_markdown: str, chapter_meta: dict[str, Any], llm_profile: dict[str, Any]) -> dict[str, Any]:
        llm_result = await self._extract_llm(chapter_markdown, chapter_meta, llm_profile)
        if llm_result:
            return llm_result
        return self._extract_rules(chapter_id, chapter_markdown)

    async def _extract_llm(self, chapter_markdown: str, chapter_meta: dict[str, Any], llm_profile: dict[str, Any]) -> dict[str, Any] | None:
        provider = llm_profile.get("provider", "mock")
        if provider == "mock":
            return None
        prompt = (
            "输出严格JSON: {facts:[], issues:[], new_entity_proposals:[]}。\n"
            "facts包含scope/entity_id/key/value/confidence/evidence/sources。\n"
            f"chapter_meta={chapter_meta}\ntext={chapter_markdown[:4000]}"
        )
        msg = [{"role": "system", "content": "你是canon抽取器。"}, {"role": "user", "content": prompt}]
        try:
            out = await self.llm_gateway.chat_complete(msg, llm_profile.get("model", ""), 0.2, 700, llm_profile)
            text = out.get("text", "{}")
            try:
                return json.loads(text)
            except Exception:
                repaired = self._repair_json(text)
                return json.loads(repaired)
        except Exception:
            return None

    def _repair_json(self, text: str) -> str:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return text[start:end + 1]
        return '{"facts":[],"issues":[],"new_entity_proposals":[]}'

    def _extract_rules(self, chapter_id: str, chapter_markdown: str) -> dict[str, Any]:
        lines = [x for x in chapter_markdown.splitlines() if x.strip()]
        summary = "".join(lines[:2])[:220]
        if not summary:
            summary = chapter_markdown[:220]
        facts = [{
            "id": f"fact_{uuid.uuid4().hex[:10]}",
            "scope": "chapter_summary",
            "key": "summary",
            "value": summary,
            "confidence": 0.6,
            "evidence": {"chapter_id": chapter_id, "start_line": 1, "end_line": min(len(lines), 3), "quote": summary[:80]},
            "sources": [{"path": f"drafts/{chapter_id}.md"}],
        }]
        world_sent = next((l for l in lines if any(t in l for t in ["世界", "王国", "城", "规则", "战争", "禁令"])), "")
        if world_sent:
            facts.append({
                "id": f"fact_{uuid.uuid4().hex[:10]}",
                "scope": "world_state",
                "key": "world_signal",
                "value": world_sent[:180],
                "confidence": 0.55,
                "evidence": {"chapter_id": chapter_id, "quote": world_sent[:80]},
                "sources": [{"path": f"drafts/{chapter_id}.md"}],
            })
        proposals = self._heuristic_proposals(chapter_id, chapter_markdown)
        if not proposals:
            proposals = [{"proposal_id": f"proposal_{uuid.uuid4().hex[:10]}", "status": "pending", "entity_type": "location", "name": "临港城", "confidence": 0.45, "evidence": {"chapter_id": chapter_id, "quote": summary[:20]}, "source": "fallback", "ts": now_iso()}]
        return {
            "facts": facts,
            "issues": [],
            "new_entity_proposals": proposals,
        }

    def _heuristic_proposals(self, chapter_id: str, text: str) -> list[dict[str, Any]]:
        proposal: list[dict[str, Any]] = []
        candidates = re.findall(r"[\u4e00-\u9fa5]{2,8}", text)
        freq: dict[str, int] = {}
        for c in candidates:
            freq[c] = freq.get(c, 0) + 1
        verbs = ["说", "问", "看", "走", "来到", "离开"]
        for token, count in freq.items():
            kind = None
            if len(token) in (2, 3, 4) and count >= 2:
                kind = "character"
            if any(token.endswith(suf) for suf in ["城", "镇", "村", "巷", "街", "府", "宫", "馆", "山", "河", "岛", "港"]):
                kind = "location"
            if any(token.endswith(suf) for suf in ["会", "盟", "团", "局", "司", "门", "宗", "派", "学院"]):
                kind = "faction"
            if any(token.endswith(suf) for suf in ["剑", "印", "令", "书", "卷", "药", "钥", "枪", "甲"]):
                kind = "item"
            if not kind and count >= 2 and any(v in text for v in verbs):
                kind = "character"
            if kind:
                proposal.append({
                    "proposal_id": f"proposal_{uuid.uuid4().hex[:10]}",
                    "status": "pending",
                    "entity_type": kind,
                    "name": token,
                    "confidence": min(0.95, 0.4 + count * 0.1),
                    "evidence": {"chapter_id": chapter_id, "quote": token},
                    "source": "heuristic",
                    "ts": now_iso(),
                })
        uniq = {}
        for p in proposal:
            uniq[p["name"] + p["entity_type"]] = p
        return list(uniq.values())[:20]
