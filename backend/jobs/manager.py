from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from typing import Any

from services.context_engine import ContextEngine
from services.summary_service import make_summaries
from storage.fs_store import FSStore, apply_patch_ops


class JobManager:
    def __init__(self, store: FSStore, context_engine: ContextEngine) -> None:
        self.store = store
        self.context_engine = context_engine
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

        manifest = self.context_engine.build_manifest(project_id, chapter_id, scene, payload.get("constraints", {}))
        await self.emit(job_id, "CONTEXT_MANIFEST", manifest)

        guide_text = str(manifest["fixed_blocks"].get("style_guide", {}))
        examples = manifest.get("included_evidence_chunks", {}).get("style_examples", [])
        ex_text = "\n".join([f"例{i+1}:{e['text'][:60]}" for i, e in enumerate(examples[:3])])
        draft = f"# {chapter_id}\n\n【场景目标】{scene.get('purpose')}\n【文风规则】{guide_text}\n{ex_text}\n林秋在{scene.get('situation')}，为“{scene.get('choice_points', ['选择'])[0]}”迟疑后做出决定。"
        self.store.write_md(project_id, f"drafts/{chapter_id}.md", draft)
        await self.emit(job_id, "WRITER_DRAFT", {"chapter_id": chapter_id, "text": draft})

        issues = [{"issue": "冲突可再压缩成更短句", "evidence": {"chapter_id": chapter_id, "quote": "迟疑后做出决定"}}]
        for issue in issues:
            self.store.append_jsonl(project_id, "canon/issues.jsonl", issue)
        await self.emit(job_id, "CRITIC_REVIEW", {"issues": issues})

        ops = [{"op": "replace", "start": 4, "end": 5, "value": f"林秋停了两秒。她收起手机，走进雨里，决定赴约。"}]
        updated, diff = apply_patch_ops(draft, ops)
        await self.emit(job_id, "EDITOR_PATCH", {"ops": ops})
        await self.emit(job_id, "DIFF", {"diff": diff})

        self.store.write_md(project_id, f"drafts/{chapter_id}.md", updated)
        self.store.append_jsonl(project_id, f"drafts/{chapter_id}.patch.jsonl", {"ops": ops, "diff": diff, "job_id": job_id})
        await self.emit(job_id, "MERGE_RESULT", {"chapter_id": chapter_id, "applied": True})

        summary = make_summaries(chapter_id, updated)
        meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
        meta.update(summary)
        self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", meta)

        self.store.write_md(project_id, f"meta/summaries/{chapter_id}.summary.md", summary["chapter_summary"])
        self.store.write_json(project_id, f"meta/summaries/{chapter_id}.scene_summaries.json", summary["scene_summaries"])

        chapter_fact = {
            "scope": "chapter_summary",
            "fact": summary["chapter_summary"],
            "evidence": {"chapter_id": chapter_id},
        }
        self.store.append_jsonl(project_id, "canon/facts.jsonl", chapter_fact)
        for s in summary["scene_summaries"]:
            self.store.append_jsonl(project_id, "canon/facts.jsonl", {"scope": "scene_summary", "fact": s["summary"], "evidence": {"chapter_id": chapter_id}})

        canon_update = {"facts": [chapter_fact], "summary": summary}
        await self.emit(job_id, "CANON_UPDATES", canon_update)

        self.store.append_jsonl(project_id, "sessions/session_001.jsonl", {"job_id": job_id, "plan": plan, "context_manifest": manifest})
        self._update_rolling_summary(project_id, "session_001")
        await self.queues[job_id].put({"event": "DONE", "data": {"job_id": job_id}})

    def _update_rolling_summary(self, project_id: str, sid: str) -> None:
        events = self.store.read_jsonl(project_id, f"sessions/{sid}.jsonl")
        if len(events) < 30:
            return
        meta = self.store.read_json(project_id, f"sessions/{sid}.meta.json")
        last = events[-10:]
        summary = " | ".join([f"{e.get('job_id','evt')}:{str(e.get('plan',{}))[:40]}" for e in last])[:600]
        meta["rolling_summary"] = summary
        meta["last_summarized_message_id"] = str(len(events))
        self.store.write_json(project_id, f"sessions/{sid}.meta.json", meta)

    async def stream(self, job_id: str):
        queue = self.queues[job_id]
        while True:
            event = await queue.get()
            yield event
            if event["event"] == "DONE":
                break
