from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from collections import defaultdict
from typing import Any

from services.context_engine import ContextEngine
from services.llm_gateway import LLMGateway
from agents.technique_director import TechniqueDirector, derive_technique_adherence_issues
from services.summary_service import make_summaries
from services.canon_extractor_service import CanonExtractorService
from services.evidence_service import EvidenceService
from services.llm_config_service import LLMConfigService
from storage.fs_store import FSStore, apply_patch_ops, now_iso


class JobManager:
    def __init__(self, store: FSStore, context_engine: ContextEngine, llm_gateway: LLMGateway) -> None:
        self.store = store
        self.context_engine = context_engine
        self.llm_gateway = llm_gateway
        self.queues: dict[str, asyncio.Queue] = defaultdict(asyncio.Queue)
        self.canon_extractor = CanonExtractorService(llm_gateway)
        self.technique_director = TechniqueDirector(store)
        self.evidence_service = EvidenceService(store)

    async def emit(self, project_id: str, job_id: str, event: str, data: Any) -> None:
        if isinstance(data, dict):
            data = {
                "job_id": job_id,
                "stage": data.get("stage", event),
                "provider": data.get("provider", "system"),
                "model": data.get("model", ""),
                "fallback": bool(data.get("fallback", False)),
                "input_summary": data.get("input_summary", ""),
                "output_summary": data.get("output_summary", ""),
                **data,
            }
        payload = {"event": event, "data": data}
        self.store.append_jsonl(project_id, "sessions/session_001.jsonl", {"job_id": job_id, **payload})
        self._record_job_event(project_id, job_id, event, data)
        await self.queues[job_id].put(payload)

    async def run_write_job(self, project_id: str, payload: dict[str, Any]) -> str:
        chapter_id, _bp, scene_index = self._validate_write_payload(project_id, payload)
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        self._write_job_record(project_id, job_id, {
            "job_id": job_id,
            "project_id": project_id,
            "chapter_id": chapter_id,
            "scene_index": scene_index,
            "job_type": "write",
            "agent_mode": "three_agent",
            "status": "queued",
            "stage": "queued",
            "requested_profile_id": payload.get("llm_profile_id") or "",
            "auto_apply_patch": bool(payload.get("auto_apply_patch", False)),
            "word_checkpoint_chars": int(payload.get("word_checkpoint_chars") or 1500),
            "event_counts": {},
            "last_event": "",
            "last_error": "",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "completed_at": "",
            "input_summary": "作者请求生成本章；后端将自动编排审查、撰写、校对三 Agent。",
            "output_summary": "",
        })
        asyncio.create_task(self._pipeline(job_id, project_id, payload))
        return job_id

    def _job_path(self, job_id: str) -> str:
        return f"meta/jobs/{job_id}.json"

    def _write_job_record(self, project_id: str, job_id: str, rec: dict[str, Any]) -> dict[str, Any]:
        current = self.store.read_json(project_id, self._job_path(job_id)) or {}
        merged = {**current, **rec, "updated_at": rec.get("updated_at") or now_iso()}
        self.store.write_json(project_id, self._job_path(job_id), merged)
        return merged

    def _record_job_event(self, project_id: str, job_id: str, event: str, data: Any) -> None:
        if not isinstance(data, dict):
            data = {}
        current = self.store.read_json(project_id, self._job_path(job_id)) or {"job_id": job_id, "project_id": project_id, "event_counts": {}}
        counts = current.get("event_counts") if isinstance(current.get("event_counts"), dict) else {}
        counts[event] = int(counts.get(event, 0)) + 1
        next_status = current.get("status") or "running"
        if event == "ERROR" and data.get("stage") == "pipeline":
            next_status = "failed"
        elif event == "ERROR":
            next_status = "running"
        elif event == "TRUST_REPORT":
            next_status = "awaiting_review"
        elif event in {"CANON_UPDATES", "MERGE_RESULT"} and next_status not in {"failed", "cancelled"}:
            next_status = "finalizing"
        elif next_status in {"queued", ""}:
            next_status = "running"

        patch = {
            "status": next_status,
            "stage": data.get("stage", event),
            "last_event": event,
            "last_error": data.get("message", current.get("last_error", "")) if event == "ERROR" else current.get("last_error", ""),
            "provider": data.get("provider", current.get("provider", "")),
            "model": data.get("model", current.get("model", "")),
            "fallback": bool(current.get("fallback", False) or data.get("fallback", False)),
            "input_summary": data.get("input_summary", current.get("input_summary", "")),
            "output_summary": data.get("output_summary", current.get("output_summary", "")),
            "event_counts": counts,
            "updated_at": now_iso(),
        }
        self._write_job_record(project_id, job_id, patch)

    def finish_job(self, project_id: str, job_id: str, status: str = "completed") -> dict[str, Any]:
        current = self.store.read_json(project_id, self._job_path(job_id)) or {"job_id": job_id, "project_id": project_id}
        if current.get("status") == "failed":
            status = "failed"
        return self._write_job_record(project_id, job_id, {
            "status": status,
            "stage": "DONE",
            "last_event": "DONE",
            "completed_at": now_iso(),
            "updated_at": now_iso(),
            "output_summary": current.get("output_summary") or ("写作任务完成" if status == "completed" else current.get("last_error", "")),
        })

    def get_job(self, project_id: str, job_id: str) -> dict[str, Any]:
        return self.store.read_json(project_id, self._job_path(job_id))

    def list_jobs(self, project_id: str, status: str | None = None, chapter_id: str | None = None) -> list[dict[str, Any]]:
        root = self.store._safe_path(project_id, "meta/jobs")
        rows: list[dict[str, Any]] = []
        if not root.exists():
            return rows
        for path in root.glob("*.json"):
            row = self.store.read_json(project_id, f"meta/jobs/{path.name}")
            if not row:
                continue
            if status and row.get("status") != status:
                continue
            if chapter_id and row.get("chapter_id") != chapter_id:
                continue
            rows.append(row)
        return sorted(rows, key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)

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


    def _persist_memory_pack(self, project_id: str, chapter_id: str, job_id: str, manifest: dict[str, Any], mark_ids: list[str] | None = None) -> None:
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
            "source_mark_ids": mark_ids or [],
            "dropped_mark_ids": manifest.get("dropped_mark_ids", []),
            "compression_reason": manifest.get("compression_reason", ""),
        }
        self.store.write_json(project_id, f"meta/memory_packs/{chapter_id}/{job_id}.json", pack)

    def _hash_payload(self, value: Any) -> str:
        return hashlib.sha1(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:12]

    def _write_chapter_status(self, project_id: str, chapter_id: str, status: str) -> None:
        meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
        meta.setdefault("chapter_id", chapter_id)
        meta["chapter_status"] = status
        self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", meta)

    def _story_targets_for_chapter(self, project_id: str, chapter_id: str) -> dict[str, Any]:
        cards_dir = self.store._safe_path(project_id, "cards")
        story = {}
        if cards_dir.exists():
            for f in cards_dir.glob("*.yaml"):
                card = self.store.read_yaml(project_id, f"cards/{f.name}")
                if card.get("type") == "story":
                    story = card.get("payload", {}) or {}
                    break
        def linked(section: str) -> list[dict[str, Any]]:
            rows = story.get(section, []) or []
            return [r for r in rows if r.get("chapter") == chapter_id or r.get("chapter_id") == chapter_id or r.get("first_chapter") == chapter_id or r.get("payoff_chapter") == chapter_id]

        return {
            "chapter_plan": linked("chapter_plan"),
            "open_line": linked("open_line"),
            "hidden_line": linked("hidden_line"),
            "foreshadowings": linked("foreshadowings"),
        }

    def _writer_checkpoints(self, chapter_id: str, draft: str, threshold: int) -> list[dict[str, Any]]:
        if threshold <= 0:
            threshold = 1500
        body = draft.replace(f"# {chapter_id}", "", 1).strip()
        checkpoints = []
        for idx, start in enumerate(range(0, len(body), threshold), start=1):
            chunk = body[start:start + threshold]
            if len(chunk) < threshold and checkpoints:
                continue
            if not chunk:
                continue
            checkpoints.append({
                "checkpoint_id": f"{chapter_id}:cp_{idx:03d}",
                "char_start": start,
                "char_end": start + len(chunk),
                "summary": chunk[:220],
            })
        return checkpoints


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

    def _validate_write_payload(self, project_id: str, payload: dict[str, Any]) -> tuple[str, dict[str, Any], int]:
        chapter_id = payload.get("chapter_id")
        if not isinstance(chapter_id, str) or not chapter_id.strip():
            raise ValueError("chapter_id is required")

        blueprint_id = payload.get("blueprint_id")
        if not isinstance(blueprint_id, str) or not blueprint_id.strip():
            raise ValueError("blueprint_id is required")

        bp = self.store.read_json(project_id, f"cards/{blueprint_id}.json")
        scene_plan = bp.get("scene_plan") if isinstance(bp, dict) else None
        if not isinstance(scene_plan, list) or not scene_plan:
            raise ValueError("blueprint scene_plan is empty")

        scene_index = payload.get("scene_index", 0)
        try:
            scene_index = int(scene_index)
        except Exception as exc:
            raise ValueError("scene_index must be an integer") from exc
        if scene_index < 0 or scene_index >= len(scene_plan):
            raise ValueError("scene_index out of range")

        return chapter_id, bp, scene_index

    async def _pipeline(self, job_id: str, project_id: str, payload: dict[str, Any]) -> None:
        try:
            chapter_id, bp, scene_index = self._validate_write_payload(project_id, payload)
            payload = {"agent_mode": "three_agent", "auto_apply_patch": False, "word_checkpoint_chars": 1500, **payload}
            word_checkpoint_chars = int(payload.get("word_checkpoint_chars") or 1500)
            self._write_chapter_status(project_id, chapter_id, "生成中")
            selection_range = self._normalize_selection_range(payload)
            scene = bp.get("scene_plan", [])[scene_index]
            outline = self.store.read_yaml(project_id, "cards/outline_001.yaml")
            req_profile_id, selected, fallback = self._resolve_profile(project_id, payload, "writer")

            plan = {"scene": scene, "beats": outline.get("payload", {}).get("beats", [])}
            await self.emit(project_id, job_id, "DIRECTOR_PLAN", {**plan, "output_summary": "导演阶段生成场景计划"})

            selected_bundle = self.technique_director.resolve_selected_bundle(project_id, chapter_id, outline, scene)
            selected_techniques = selected_bundle.get("selected_techniques", [])
            selected_categories = selected_bundle.get("selected_categories", [])
            story_targets = self._story_targets_for_chapter(project_id, chapter_id)
            pre_review_plan = {
                "agent": "审查 Agent",
                "chapter_id": chapter_id,
                "story_targets": story_targets,
                "required_targets": {
                    "characters": scene.get("cast", []),
                    "techniques": [x.get("technique_id") for x in selected_techniques],
                    "categories": [x.get("category_id") for x in selected_categories],
                    "open_line": len(story_targets.get("open_line", [])),
                    "hidden_line": len(story_targets.get("hidden_line", [])),
                    "foreshadowings": len(story_targets.get("foreshadowings", [])),
                },
                "risks": [],
                "input_summary": "读取章节计划、人物、技法、明线、暗线、伏笔",
                "output_summary": "生成本章审查清单，不直接改正文",
            }
            await self.emit(project_id, job_id, "PRE_REVIEW_PLAN", pre_review_plan)
            technique_bundle = self.technique_director.build(
                project_id,
                chapter_id,
                plan,
                self.store.read_yaml(project_id, "cards/style_001.yaml").get("payload", {}).get("style_guide", {}),
                self.store.read_jsonl(project_id, "canon/facts.jsonl")[-8:],
                selected_techniques,
                selected_categories,
            )
            await self.emit(project_id, job_id, "TECHNIQUE_BRIEF", {**technique_bundle, "input_summary": "读取 pinned 技法和宏观技法分类", "output_summary": "生成技法 brief 与 checklist"})
            chapter_meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
            chapter_meta["technique_brief"] = technique_bundle.get("technique_brief", "")
            chapter_meta["technique_checklist"] = technique_bundle.get("technique_checklist", [])
            self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", chapter_meta)

            manifest = self.context_engine.build_manifest(project_id, chapter_id, scene, payload.get("constraints", {}), technique_bundle)
            manifest["llm"] = {"requested_profile_id": req_profile_id, "requested_provider": selected.get("provider"), "requested_model": selected.get("model")}
            manifest["usage_estimate"] = {"prompt_tokens": 0, "completion_tokens": 0}
            manifest["manifest_hash"] = self._hash_payload(manifest)
            manifest["evidence_policy"] = {"required_quote_for_supported": True, "unsupported_without_quote": True}
            if manifest.get("compression_steps") and not manifest.get("compression_reason"):
                manifest["compression_reason"] = "上下文预算触发裁剪，优先保留 style locks、章节目标、人物硬设定、未回收伏笔、世界规则。"
            self._persist_memory_pack(project_id, chapter_id, job_id, manifest)
            await self.emit(project_id, job_id, "CONTEXT_MANIFEST", {**manifest, "input_summary": "组装上下文、证据、预算和压缩记录", "output_summary": f"使用证据 {len(manifest.get('evidence', []))} 条，压缩 {len(manifest.get('compression_steps', []))} 步"})

            guide_text = str(manifest["fixed_blocks"].get("style_guide", {}))
            world_facts = manifest.get("world_facts", [])[:5]
            writer_messages = [
                {"role": "system", "content": "你是长篇小说写作助手，按提供文风与场景目标写作，必须遵守style locks。"},
                {"role": "user", "content": f"scene={scene}\nstyle_guide={guide_text}\nstyle_locks={manifest.get('fixed_blocks',{}).get('style_locks',{})}\nworld_facts={world_facts}\ntechnique_brief={manifest.get('fixed_blocks',{}).get('technique_brief','')}\ntechnique_checklist={manifest.get('fixed_blocks',{}).get('technique_checklist',[])}\ntechnique_agent_tags={manifest.get('fixed_blocks',{}).get('technique_agent_tags',[])}\n请写一段章节草稿。"},
            ]
            writer_text, writer_used, writer_tokens = await self._writer(project_id, job_id, writer_messages, selected, fallback)
            draft = f"# {chapter_id}\n\n{writer_text}" if writer_text else f"# {chapter_id}\n\n林秋在{scene.get('situation')}做出选择。"
            self.store.write_md(project_id, f"drafts/{chapter_id}.md", draft)
            self._write_chapter_status(project_id, chapter_id, "待审稿")
            manifest["usage_estimate"] = {
                "prompt_tokens": max(1, len(str(writer_messages)) // 4),
                "completion_tokens": max(1, len("".join(writer_tokens)) // 4),
            }
            checkpoints = self._writer_checkpoints(chapter_id, draft, word_checkpoint_chars)
            manifest["writer_checkpoints"] = checkpoints
            if checkpoints:
                await self.emit(project_id, job_id, "WRITER_CHECKPOINT", {"chapter_id": chapter_id, "checkpoints": checkpoints, "provider": writer_used.get("provider"), "model": writer_used.get("model"), "fallback": writer_used.get("provider") != selected.get("provider"), "input_summary": f"按 {word_checkpoint_chars} 字阈值压缩", "output_summary": f"生成 {len(checkpoints)} 个阶段摘要"})
            await self.emit(project_id, job_id, "WRITER_DRAFT", {"chapter_id": chapter_id, "text": draft, "provider": writer_used.get("provider"), "model": writer_used.get("model"), "fallback": writer_used.get("provider") != selected.get("provider"), "input_summary": "撰写 Agent 使用 manifest 和审查清单生成正文", "output_summary": f"生成正文 {len(draft)} 字"})

            tech_issues = derive_technique_adherence_issues(chapter_id, draft, manifest.get("fixed_blocks", {}).get("technique_checklist", []))
            marks = self.evidence_service.build_marks(project_id, chapter_id, job_id=job_id, model=writer_used.get("model", ""), technique_checklist=manifest.get("fixed_blocks", {}).get("technique_checklist", []), issues=tech_issues)
            self.evidence_service.save_marks(project_id, chapter_id, marks)
            supported = [m for m in marks if m.get("detection", {}).get("support_level") == "supported"]
            unsupported = [m for m in marks if m.get("detection", {}).get("support_level") == "unsupported"]
            await self.emit(project_id, job_id, "MARK_EXTRACTION", {"chapter_id": chapter_id, "marks": marks, "provider": "rules", "model": "evidence-rules-v1", "input_summary": "从正文抽取人物、技法、明线、暗线、伏笔命中", "output_summary": f"supported={len(supported)}, unsupported={len(unsupported)}"})
            await self.emit(project_id, job_id, "CLAIM_VERIFICATION", {"chapter_id": chapter_id, "verified_mark_ids": [m.get("mark_id") for m in supported], "unsupported_mark_ids": [m.get("mark_id") for m in unsupported], "provider": "rules", "model": "quote-verifier-v1", "input_summary": "回查 quote 和行号", "output_summary": f"{len(unsupported)} 条未证实"})

            critic_messages = [{"role": "system", "content": "你是审稿人，输出一句主要问题。"}, {"role": "user", "content": draft[:900] + "\n证据:" + str(manifest.get("critic_evidence", [])[:3])}]
            _, critic_selected, critic_fallback = self._resolve_profile(project_id, payload, "critic")
            critic_out, critic_used = await self._complete_with_fallback(project_id, job_id, "critic", critic_messages, critic_selected, critic_fallback)
            issues = [{"issue": (critic_out.get("text") or "冲突可增强")[:120], "evidence": {"chapter_id": chapter_id, "quote": draft.splitlines()[-1][:40]}}]
            style_locks = manifest.get("fixed_blocks", {}).get("style_locks", {})
            if style_locks.get("punctuation") and ("!" in draft or "！" in draft):
                issues.append({"issue": "style_drift: punctuation lock violated", "evidence": {"chapter_id": chapter_id, "quote": "!"}})
            issues.extend(tech_issues)
            for issue in issues:
                self.store.append_jsonl(project_id, "canon/issues.jsonl", issue)
            await self.emit(project_id, job_id, "CRITIC_REVIEW", {"issues": issues, "provider": critic_used.get("provider"), "model": critic_used.get("model"), "input_summary": "审查 Agent 复核正文、人设/技法/设定风险", "output_summary": f"发现 {len(issues)} 条问题"})

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
            patch_payload = {"patch_id": f"patch_{job_id}", "ops": ops, "provider": editor_used.get("provider"), "model": editor_used.get("model"), "selection_range": selection_range, "input_summary": "基础校对 Agent 只做语言层 patch，不新增事实", "output_summary": f"生成 {len(ops)} 条待审 patch"}
            await self.emit(project_id, job_id, "PROOFREAD_PATCH", patch_payload)
            await self.emit(project_id, job_id, "EDITOR_PATCH", patch_payload)

            trust_report = self.evidence_service.build_trust_report(project_id, chapter_id, marks)
            self._persist_memory_pack(project_id, chapter_id, job_id, manifest, [m.get("mark_id", "") for m in marks])
            await self.emit(project_id, job_id, "TRUST_REPORT", {"chapter_id": chapter_id, "trust_report": trust_report, "provider": "rules", "model": "trust-report-v1", "input_summary": "汇总 supported / partial / unsupported / contradicted", "output_summary": f"support_rate={trust_report.get('support_rate')}"})

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

                chapter_fact = {"id": f"fact_{job_id}", "scope": "chapter_summary", "key": "summary", "value": summary["chapter_summary"], "confidence": 0.8, "evidence": {"chapter_id": chapter_id, "quote": summary["chapter_summary"][:80]}, "sources": [{"path": f"drafts/{chapter_id}.md"}]}
                self.store.append_jsonl(project_id, "canon/facts.jsonl", chapter_fact)
                for scene_summary in summary["scene_summaries"]:
                    self.store.append_jsonl(project_id, "canon/facts.jsonl", {"id": f"fact_{uuid.uuid4().hex[:10]}", "scope": "scene_summary", "key": "scene", "value": scene_summary["summary"], "confidence": 0.7, "evidence": {"chapter_id": chapter_id, "quote": scene_summary["summary"][:80]}, "sources": [{"path": f"drafts/{chapter_id}.md"}]})
                _, canon_selected, _canon_fallback = self._resolve_profile(project_id, payload, "canon_extractor")
                canon_profile = canon_selected
                if canon_profile.get("provider") == "mock" and writer_used.get("provider") != "mock":
                    canon_profile = writer_used
                extracted = await self.canon_extractor.extract(chapter_id, updated, {"scene_index": scene_index, "beats": scene.get("beats", []), "cast": scene.get("cast", [])}, canon_profile)
                for fact in extracted.get("facts", []):
                    self.store.append_jsonl(project_id, "canon/facts.jsonl", fact)
                for issue in extracted.get("issues", []):
                    self.store.append_jsonl(project_id, "canon/issues.jsonl", issue)
                for proposal in extracted.get("new_entity_proposals", []):
                    self.store.append_jsonl(project_id, "canon/proposals.jsonl", proposal)
                meta["proposals"] = extracted.get("new_entity_proposals", [])
                meta["chapter_status"] = "已保存"
                self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", meta)
                await self.emit(project_id, job_id, "CANON_UPDATES", {"facts": [chapter_fact, *extracted.get("facts", [])], "proposals": extracted.get("new_entity_proposals", []), "summary": summary, "provider": writer_used.get("provider")})
            else:
                await self.emit(project_id, job_id, "DIFF", {"diff": ""})
                await self.emit(project_id, job_id, "MERGE_RESULT", {"chapter_id": chapter_id, "applied": False, "pending_patch": True})
                await self.emit(project_id, job_id, "CANON_UPDATES", {"facts": [], "summary": None, "provider": writer_used.get("provider")})

            self._update_rolling_summary(project_id, "session_001")
        except Exception as exc:
            await self.emit(project_id, job_id, "ERROR", {"stage": "pipeline", "message": str(exc)})
        finally:
            self.finish_job(project_id, job_id)
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
