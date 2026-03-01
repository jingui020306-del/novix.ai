from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from typing import Any

from services.context_engine import ContextEngine
from services.llm_gateway import LLMGateway
from agents.technique_director import TechniqueDirector, derive_technique_adherence_issues
from services.summary_service import make_summaries
from services.canon_extractor_service import CanonExtractorService
from services.llm_config_service import LLMConfigService
from storage.fs_store import FSStore, apply_patch_ops


class JobManager:
    def __init__(self, store: FSStore, context_engine: ContextEngine, llm_gateway: LLMGateway) -> None:
        self.store = store
        self.context_engine = context_engine
        self.llm_gateway = llm_gateway
        self.queues: dict[str, asyncio.Queue] = defaultdict(asyncio.Queue)
        self.canon_extractor = CanonExtractorService(llm_gateway)
        self.technique_director = TechniqueDirector(store)

    async def emit(self, project_id: str, job_id: str, event: str, data: Any) -> None:
        payload = {"event": event, "data": data}
        self.store.append_jsonl(project_id, "sessions/session_001.jsonl", {"job_id": job_id, **payload})
        await self.queues[job_id].put(payload)

    async def run_write_job(self, project_id: str, payload: dict[str, Any]) -> str:
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        asyncio.create_task(self._pipeline(job_id, project_id, payload))
        return job_id

    def _resolve_profile(self, project_id: str, payload: dict[str, Any], module: str = "writer") -> tuple[str, dict[str, Any], dict[str, Any]]:
        project = self.store.read_yaml(project_id, "project.yaml")
        project_profiles = project.get("llm_profiles", {})
        cfg = LLMConfigService(self.store.data_dir)
        global_profiles = cfg.read_profiles()
        assignments = cfg.read_assignments()
        profiles = {**global_profiles, **project_profiles}

        req_profile_id = payload.get("llm_profile_id")
        assignment_profile_id = assignments.get(module)
        project_default = project.get("default_llm_profile_id", "mock_default")
        req_id = req_profile_id or assignment_profile_id or project_default

        selected = profiles.get(req_id, profiles.get("mock_default", self.llm_gateway.env_defaults()))
        fallback = profiles.get("mock_default", {"provider": "mock", "model": "mock-writer-v1", "stream": True})
        return req_id, selected, fallback

    async def _writer(self, project_id: str, job_id: str, messages: list[dict[str, str]], selected: dict[str, Any], fallback: dict[str, Any]) -> tuple[str, dict[str, Any], list[str]]:
        used = selected
        tokens: list[str] = []
        try:
            async for delta in self.llm_gateway.chat_stream(messages, selected.get("model", ""), 0.7, 900, selected):
                tokens.append(delta)
                await self.emit(project_id, job_id, "WRITER_TOKEN", {"delta": delta, "provider": selected.get("provider"), "model": selected.get("model")})
        except Exception as e:
            await self.emit(project_id, job_id, "ERROR", {"stage": "writer", "provider": selected.get("provider"), "message": str(e)})
            used = fallback
            async for delta in self.llm_gateway.chat_stream(messages, fallback.get("model", "mock-writer-v1"), 0.7, 900, fallback):
                tokens.append(delta)
                await self.emit(project_id, job_id, "WRITER_TOKEN", {"delta": delta, "provider": fallback.get("provider"), "model": fallback.get("model"), "fallback": True})
        return "".join(tokens), used, tokens

    async def _complete_with_fallback(self, project_id: str, job_id: str, stage: str, messages: list[dict[str, str]], selected: dict[str, Any], fallback: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            return await self.llm_gateway.chat_complete(messages, selected.get("model", ""), 0.4, 500, selected), selected
        except Exception as e:
            await self.emit(project_id, job_id, "ERROR", {"stage": stage, "provider": selected.get("provider"), "message": str(e)})
            return await self.llm_gateway.chat_complete(messages, fallback.get("model", "mock-writer-v1"), 0.4, 500, fallback), fallback


    def _persist_memory_pack(self, project_id: str, chapter_id: str, job_id: str, manifest: dict[str, Any]) -> None:
        pack = {
            "pack_id": f"{chapter_id}:{job_id}",
            "chapter_id": chapter_id,
            "job_id": job_id,
            "fixed_blocks": manifest.get("fixed_blocks", {}),
            "evidence": manifest.get("evidence", []),
            "citation_map": manifest.get("citation_map", {}),
            "budget_report": manifest.get("budget", {}),
            "dropped_items": manifest.get("dropped_items", []),
            "compression_steps": manifest.get("compression_steps", []),
        }
        self.store.write_json(project_id, f"meta/memory_packs/{chapter_id}/{job_id}.json", pack)


    def _normalize_selection_range(self, payload: dict[str, Any]) -> dict[str, int] | None:
        sr = payload.get("selection_range")
        if not isinstance(sr, dict):
            return None
        try:
            start = int(sr.get("start", 0))
            end = int(sr.get("end", 0))
        except Exception:
            return None
        if start < 1 or end < start:
            return None
        return {"start": start, "end": end}

    def _clip_ops_to_selection(self, ops: list[dict[str, Any]], selection_range: dict[str, int] | None) -> list[dict[str, Any]]:
        if not selection_range:
            return ops
        out: list[dict[str, Any]] = []
        s0, e0 = selection_range["start"], selection_range["end"]
        for op in ops:
            tr = op.get("target_range", {})
            try:
                s = int(tr.get("start", 0))
                e = int(tr.get("end", s))
            except Exception:
                continue
            if s < s0 or e > e0:
                continue
            out.append(op)
        return out

    async def _pipeline(self, job_id: str, project_id: str, payload: dict[str, Any]) -> None:
        chapter_id = payload["chapter_id"]
        selection_range = self._normalize_selection_range(payload)
        bp = self.store.read_json(project_id, f"cards/{payload['blueprint_id']}.json")
        scene = bp.get("scene_plan", [])[payload.get("scene_index", 0)]
        outline = self.store.read_yaml(project_id, "cards/outline_001.yaml")
        req_profile_id, selected, fallback = self._resolve_profile(project_id, payload, "writer")

        plan = {"scene": scene, "beats": outline.get("payload", {}).get("beats", [])}
        await self.emit(project_id, job_id, "DIRECTOR_PLAN", plan)

        selected_bundle = self.technique_director.resolve_selected_bundle(project_id, chapter_id, outline, scene)
        selected_techniques = selected_bundle.get("selected_techniques", [])
        selected_categories = selected_bundle.get("selected_categories", [])
        technique_bundle = self.technique_director.build(
            project_id,
            chapter_id,
            plan,
            self.store.read_yaml(project_id, "cards/style_001.yaml").get("payload", {}).get("style_guide", {}),
            self.store.read_jsonl(project_id, "canon/facts.jsonl")[-8:],
            selected_techniques,
            selected_categories,
        )
        await self.emit(project_id, job_id, "TECHNIQUE_BRIEF", technique_bundle)
        chapter_meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
        chapter_meta["technique_brief"] = technique_bundle.get("technique_brief", "")
        chapter_meta["technique_checklist"] = technique_bundle.get("technique_checklist", [])
        self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", chapter_meta)

        manifest = self.context_engine.build_manifest(project_id, chapter_id, scene, payload.get("constraints", {}), technique_bundle)
        manifest["llm"] = {"requested_profile_id": req_profile_id, "requested_provider": selected.get("provider"), "requested_model": selected.get("model")}
        manifest["usage_estimate"] = {"prompt_tokens": 0, "completion_tokens": 0}
        self._persist_memory_pack(project_id, chapter_id, job_id, manifest)
        await self.emit(project_id, job_id, "CONTEXT_MANIFEST", manifest)

        guide_text = str(manifest["fixed_blocks"].get("style_guide", {}))
        world_facts = manifest.get("world_facts", [])[:5]
        writer_messages = [
            {"role": "system", "content": "你是长篇小说写作助手，按提供文风与场景目标写作，必须遵守style locks。"},
            {"role": "user", "content": f"scene={scene}\nstyle_guide={guide_text}\nstyle_locks={manifest.get('fixed_blocks',{}).get('style_locks',{})}\nworld_facts={world_facts}\ntechnique_brief={manifest.get('fixed_blocks',{}).get('technique_brief','')}\ntechnique_checklist={manifest.get('fixed_blocks',{}).get('technique_checklist',[])}\n请写一段章节草稿。"},
        ]
        writer_text, writer_used, writer_tokens = await self._writer(project_id, job_id, writer_messages, selected, fallback)
        draft = f"# {chapter_id}\n\n{writer_text}" if writer_text else f"# {chapter_id}\n\n林秋在{scene.get('situation')}做出选择。"
        self.store.write_md(project_id, f"drafts/{chapter_id}.md", draft)
        manifest["usage_estimate"] = {
            "prompt_tokens": max(1, len(str(writer_messages)) // 4),
            "completion_tokens": max(1, len("".join(writer_tokens)) // 4),
        }
        await self.emit(project_id, job_id, "WRITER_DRAFT", {"chapter_id": chapter_id, "text": draft, "provider": writer_used.get("provider"), "model": writer_used.get("model"), "fallback": writer_used.get("provider") != selected.get("provider")})

        critic_messages = [{"role": "system", "content": "你是审稿人，输出一句主要问题。"}, {"role": "user", "content": draft[:900] + "\n证据:" + str(manifest.get("critic_evidence", [])[:3])}]
        _, critic_selected, critic_fallback = self._resolve_profile(project_id, payload, "critic")
        critic_out, critic_used = await self._complete_with_fallback(project_id, job_id, "critic", critic_messages, critic_selected, critic_fallback)
        issues = [{"issue": (critic_out.get("text") or "冲突可增强")[:120], "evidence": {"chapter_id": chapter_id, "quote": draft.splitlines()[-1][:40]}}]
        style_locks = manifest.get("fixed_blocks", {}).get("style_locks", {})
        if style_locks.get("punctuation") and ("!" in draft or "！" in draft):
            issues.append({"issue": "style_drift: punctuation lock violated", "evidence": {"chapter_id": chapter_id, "quote": "!"}})
        tech_issues = derive_technique_adherence_issues(chapter_id, draft, manifest.get("fixed_blocks", {}).get("technique_checklist", []))
        issues.extend(tech_issues)
        for issue in issues:
            self.store.append_jsonl(project_id, "canon/issues.jsonl", issue)
        await self.emit(project_id, job_id, "CRITIC_REVIEW", {"issues": issues, "provider": critic_used.get("provider"), "model": critic_used.get("model")})

        editor_scope_hint = f"selection_range={selection_range}" if selection_range else "selection_range=None(whole chapter)"
        editor_messages = [
            {"role": "system", "content": "你是编辑。输出JSON: {\"ops\":[{\"op_id\":\"op_001\",\"type\":\"replace\",\"target_range\":{\"start\":2,\"end\":3},\"before\":\"...\",\"after\":\"...\",\"rationale\":\"...\"}]}. 若给定 selection_range，则所有 target_range 必须完全落在 selection_range 内。"},
            {"role": "user", "content": f"{editor_scope_hint}\n{draft[:1200]}"},
        ]
        _, editor_selected, editor_fallback = self._resolve_profile(project_id, payload, "editor")
        editor_out, editor_used = await self._complete_with_fallback(project_id, job_id, "editor", editor_messages, editor_selected, editor_fallback)
        ops = []
        try:
            obj = json.loads(editor_out.get("text", "{}"))
            ops = obj.get("ops", []) if isinstance(obj, dict) else []
        except Exception:
            ops = []
        if not ops:
            ops = [{"op_id": "op_001", "type": "replace", "target_range": {"start": 2, "end": 3}, "before": "", "after": "林秋停了两秒。她收起手机，走进雨里，决定赴约。", "rationale": "增强节奏与动作"}]
        if selection_range and not self._clip_ops_to_selection(ops, selection_range):
            s0, e0 = selection_range["start"], selection_range["end"]
            ops = [{"op_id": "op_sel_001", "type": "replace", "target_range": {"start": s0, "end": e0}, "before": "", "after": "（选区内润色）", "rationale": "选区编辑兜底"}]
        technique_issue = next((x for x in issues if x.get("type") == "technique_adherence"), None)
        if technique_issue:
            ops.insert(0, {
                "op_id": "op_technique_001",
                "type": "replace",
                "target_range": {"start": 2, "end": 3},
                "before": "",
                "after": f"（技法修复）{technique_issue.get('suggested_fix', '补充技法信号。')}",
                "rationale": "优先修复 technique_adherence，最小改动",
            })

        ops = self._clip_ops_to_selection(ops, selection_range)
        await self.emit(project_id, job_id, "EDITOR_PATCH", {"patch_id": f"patch_{job_id}", "ops": ops, "provider": editor_used.get("provider"), "model": editor_used.get("model"), "selection_range": selection_range})

        auto_apply = bool(payload.get("auto_apply_patch", False))
        if auto_apply:
            apply_ops = []
            for op in ops:
                tr = op.get("target_range", {})
                apply_ops.append({"op": op.get("type", op.get("op", "replace")), "start": int(tr.get("start", op.get("start", 0))), "end": int(tr.get("end", op.get("end", tr.get("start", 0)))), "value": op.get("after", op.get("value", ""))})
            updated, diff = apply_patch_ops(draft, apply_ops)
            await self.emit(project_id, job_id, "DIFF", {"diff": diff})
            self.store.write_md(project_id, f"drafts/{chapter_id}.md", updated)
            self.store.append_jsonl(project_id, f"drafts/{chapter_id}.patch.jsonl", {"patch_id": f"patch_{job_id}", "patch_ops": ops, "accept_op_ids": [o.get("op_id") for o in ops], "accepted_op_ids": [o.get("op_id") for o in ops], "rejected_op_ids": [], "diff": diff, "job_id": job_id})
            await self.emit(project_id, job_id, "MERGE_RESULT", {"chapter_id": chapter_id, "applied": True, "accepted_op_ids": [o.get("op_id") for o in ops], "rejected_op_ids": []})

            summary = make_summaries(chapter_id, updated)
            meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
            meta.update(summary)
            self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", meta)
            self.store.write_md(project_id, f"meta/summaries/{chapter_id}.summary.md", summary["chapter_summary"])
            self.store.write_json(project_id, f"meta/summaries/{chapter_id}.scene_summaries.json", summary["scene_summaries"])

            chapter_fact = {"id": f"fact_{job_id}", "scope": "chapter_summary", "key": "summary", "value": summary["chapter_summary"], "confidence": 0.8, "evidence": {"chapter_id": chapter_id}, "sources": [{"path": f"drafts/{chapter_id}.md"}]}
            self.store.append_jsonl(project_id, "canon/facts.jsonl", chapter_fact)
            for s in summary["scene_summaries"]:
                self.store.append_jsonl(project_id, "canon/facts.jsonl", {"id": f"fact_{uuid.uuid4().hex[:10]}", "scope": "scene_summary", "key": "scene", "value": s["summary"], "confidence": 0.7, "evidence": {"chapter_id": chapter_id}, "sources": [{"path": f"drafts/{chapter_id}.md"}]})
            _, canon_selected, canon_fallback = self._resolve_profile(project_id, payload, "canon_extractor")
            canon_profile = canon_selected
            if canon_profile.get("provider") == "mock" and writer_used.get("provider") != "mock":
                canon_profile = writer_used
            extracted = await self.canon_extractor.extract(chapter_id, updated, {"scene_index": payload.get("scene_index", 0), "beats": scene.get("beats", []), "cast": scene.get("cast", [])}, canon_profile)
            for fact in extracted.get("facts", []):
                self.store.append_jsonl(project_id, "canon/facts.jsonl", fact)
            for issue in extracted.get("issues", []):
                self.store.append_jsonl(project_id, "canon/issues.jsonl", issue)
            for proposal in extracted.get("new_entity_proposals", []):
                self.store.append_jsonl(project_id, "canon/proposals.jsonl", proposal)
            meta["proposals"] = extracted.get("new_entity_proposals", [])
            self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", meta)
            await self.emit(project_id, job_id, "CANON_UPDATES", {"facts": [chapter_fact, *extracted.get("facts", [])], "proposals": extracted.get("new_entity_proposals", []), "summary": summary, "provider": writer_used.get("provider")})
        else:
            await self.emit(project_id, job_id, "DIFF", {"diff": ""})
            await self.emit(project_id, job_id, "MERGE_RESULT", {"chapter_id": chapter_id, "applied": False, "pending_patch": True})
            await self.emit(project_id, job_id, "CANON_UPDATES", {"facts": [], "summary": None, "provider": writer_used.get("provider")})

        self._update_rolling_summary(project_id, "session_001")
        await self.queues[job_id].put({"event": "DONE", "data": {"job_id": job_id}})

    def _update_rolling_summary(self, project_id: str, sid: str) -> None:
        events = self.store.read_jsonl(project_id, f"sessions/{sid}.jsonl")
        if len(events) < 30:
            return
        meta = self.store.read_json(project_id, f"sessions/{sid}.meta.json")
        last = events[-10:]
        summary = " | ".join([f"{e.get('job_id','evt')}:{str(e.get('event',''))[:40]}" for e in last])[:600]
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
