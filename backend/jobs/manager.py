from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from typing import Any

from storage.fs_store import FSStore, apply_patch_ops


class JobManager:
    def __init__(self, store: FSStore) -> None:
        self.store = store
        self.queues: dict[str, asyncio.Queue] = defaultdict(asyncio.Queue)

    async def emit(self, job_id: str, event: str, data: Any) -> None:
        await self.queues[job_id].put({"event": event, "data": data})

    async def run_write_job(self, project_id: str, payload: dict[str, Any]) -> str:
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        asyncio.create_task(self._pipeline(job_id, project_id, payload))
        return job_id

    async def _pipeline(self, job_id: str, project_id: str, payload: dict[str, Any]) -> None:
        chapter_id = payload["chapter_id"]
        bp = self.store.read_json(project_id, f"cards/{payload['blueprint_id']}.json")
        scene = bp.get("scene_plan", [])[payload.get("scene_index", 0)]
        outline = self.store.read_yaml(project_id, "cards/outline_001.yaml")

        plan = {"scene": scene, "beats": outline.get("payload", {}).get("beats", [])}
        await self.emit(job_id, "DIRECTOR_PLAN", plan)

        cards = self.store.read_yaml(project_id, "cards/style_001.yaml")
        facts = self.store.read_jsonl(project_id, "canon/facts.jsonl")[-3:]
        context_manifest = {"style": cards, "scene": scene, "facts": facts, "evidence": []}
        await self.emit(job_id, "CONTEXT_MANIFEST", context_manifest)

        draft = f"# {chapter_id}\n\n【场景目标】{scene.get('purpose')}\n林秋遵循冷峻叙述，进入{scene.get('situation')}并做出选择。"
        self.store.write_md(project_id, f"drafts/{chapter_id}.md", draft)
        await self.emit(job_id, "WRITER_DRAFT", {"chapter_id": chapter_id, "text": draft})

        issues = [{"issue": "冲突张力可增强", "evidence": {"chapter_id": chapter_id, "quote": "并做出选择"}}]
        for it in issues:
            self.store.append_jsonl(project_id, "canon/issues.jsonl", it)
        await self.emit(job_id, "CRITIC_REVIEW", {"issues": issues})

        ops = [{"op": "replace", "start": 2, "end": 3, "value": f"林秋在雨中反复确认短信来源，最终决定赴约，承担后果。"}]
        updated, diff = apply_patch_ops(draft, ops)
        await self.emit(job_id, "EDITOR_PATCH", {"ops": ops})
        await self.emit(job_id, "DIFF", {"diff": diff})

        self.store.write_md(project_id, f"drafts/{chapter_id}.md", updated)
        self.store.append_jsonl(project_id, f"drafts/{chapter_id}.patch.jsonl", {"ops": ops, "diff": diff})
        await self.emit(job_id, "MERGE_RESULT", {"chapter_id": chapter_id, "applied": True})

        fact = {"fact": "林秋在雨夜决定赴约调查匿名线索", "evidence": {"chapter_id": chapter_id, "quote": "决定赴约"}}
        self.store.append_jsonl(project_id, "canon/facts.jsonl", fact)
        await self.emit(job_id, "CANON_UPDATES", {"facts": [fact]})

        self.store.append_jsonl(project_id, "sessions/session_001.jsonl", {"job_id": job_id, "context_manifest": context_manifest, "plan": plan})
        await self.queues[job_id].put({"event": "DONE", "data": {"job_id": job_id}})

    async def stream(self, job_id: str):
        queue = self.queues[job_id]
        while True:
            event = await queue.get()
            yield event
            if event["event"] == "DONE":
                break
