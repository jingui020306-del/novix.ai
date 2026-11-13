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
from services.editing_service import create_chapter_review, create_patch_review, save_snapshot
from services.llm_config_service import LLMConfigService
from services.knowledge_graph_service import KnowledgeGraphService
from services.writing_reference_service import WritingReferenceService
from services.incremental_memory_service import IncrementalMemoryService
from services.context_pack_service import ContextPackService
from services.world_scope_service import WorldScopeService
from services.change_suggestion_service import ChangeSuggestionService
from services.story_planning_service import StoryPlanningService
from services.scene_rehearsal_service import SceneRehearsalService
from services.shared_material_service import SharedMaterialService, CHARACTER_PORTRAYAL_GUIDANCE
from services.token_usage import normalize_usage, summarize_usage
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
        from services.author_control_service import AuthorControlService
        AuthorControlService(self.store).assert_unlocked(project_id, f'drafts/{chapter_id}.md')
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
        target = self.store._safe_path(project_id, self._job_path(job_id))
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(f'.{uuid.uuid4().hex}.tmp')
        temporary.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(target)
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
        rec = self.store.read_json(project_id, self._job_path(job_id))
        if not rec:
            return rec
        events = [
            row for row in self.store.read_jsonl(project_id, "sessions/session_001.jsonl")
            if row.get("job_id") == job_id
        ]
        detail = {**rec, "events": events, "event_total": len(events)}
        manifest = next((row.get("data") for row in reversed(events) if row.get("event") == "CONTEXT_MANIFEST"), None)
        trust_report = next((row.get("data") for row in reversed(events) if row.get("event") == "TRUST_REPORT"), None)
        if manifest is not None:
            detail["context_manifest"] = manifest
        if trust_report is not None:
            detail["trust_report_event"] = trust_report
        return detail

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
        legacy_module = {
            "chapter_writer": "writer",
            "chapter_reviewer": "critic",
            "proofreader": "editor",
        }.get(module)
        if legacy_module and (not assignment_profile_id or assignment_profile_id == "mock_default") and assignments.get(legacy_module):
            assignment_profile_id = assignments.get(legacy_module)
        project_default = project.get("default_llm_profile_id", "mock_default")
        req_id = req_profile_id or assignment_profile_id or project_default

        selected = profiles.get(req_id, profiles.get("mock_default", self.llm_gateway.env_defaults()))
        fallback = profiles.get("mock_default", {"provider": "mock", "model": "mock-writer-v1", "stream": True})
        return req_id, selected, fallback

    def _record_usage(self, project_id: str, job_id: str, module: str, profile: dict, usage: dict, *, status: str = 'completed') -> None:
        record = self.store.read_json(project_id, self._job_path(job_id)) or {}
        call = {'call_id': uuid.uuid4().hex[:12], 'module': module, 'provider': profile.get('provider', ''),
                'model': profile.get('model', ''), **normalize_usage(usage), 'status': status}
        calls = [*(record.get('usage_calls') or []), call]
        self._write_job_record(project_id, job_id, {'usage_calls': calls, 'usage': summarize_usage(calls)})
        self.store.append_jsonl(project_id, 'sessions/session_001.jsonl', {'job_id': job_id, 'event': 'TOKEN_USAGE', 'data': call})

    async def _tracked_stream(self, project_id: str, job_id: str, messages: list, profile: dict, max_tokens: int):
        reported, output = {}, []
        completed = False
        try:
            async for delta in self.llm_gateway.chat_stream(messages, profile.get('model', ''), 0.7, max_tokens, {**profile, '_usage_callback': reported.update}):
                output.append(delta)
                yield delta
            completed = True
        finally:
            self._record_usage(project_id, job_id, 'chapter_writer', profile, normalize_usage(reported, messages=messages, text=''.join(output)), status='completed' if completed else 'interrupted')

    async def _tracked_complete(self, project_id: str, job_id: str, module: str, messages: list, profile: dict) -> dict:
        reported, result = {}, {}
        completed = False
        try:
            result = await self.llm_gateway.chat_complete(messages, profile.get('model', ''), 0.4, 500, {**profile, '_usage_callback': reported.update})
            completed = True
            return result
        finally:
            self._record_usage(project_id, job_id, module, profile, normalize_usage(reported or result.get('usage'), messages=messages, text=result.get('text', '')), status='completed' if completed else 'interrupted')

    async def _writer(self, project_id: str, job_id: str, messages: list[dict[str, str]], selected: dict[str, Any], fallback: dict[str, Any], *, max_tokens: int = 900, strict: bool = False) -> tuple[str, dict[str, Any], list[str]]:
        used = selected
        tokens: list[str] = []
        try:
            async for delta in self._tracked_stream(project_id, job_id, messages, selected, max_tokens):
                tokens.append(delta)
                await self.emit(project_id, job_id, "WRITER_TOKEN", {"delta": delta, "provider": selected.get("provider"), "model": selected.get("model")})
        except Exception as e:
            if strict:
                raise
            await self.emit(project_id, job_id, "ERROR", {"stage": "writer", "provider": selected.get("provider"), "message": str(e)})
            used = fallback
            async for delta in self._tracked_stream(project_id, job_id, messages, fallback, 900):
                tokens.append(delta)
                await self.emit(project_id, job_id, "WRITER_TOKEN", {"delta": delta, "provider": fallback.get("provider"), "model": fallback.get("model"), "fallback": True})
        return "".join(tokens), used, tokens

    async def _complete_with_fallback(self, project_id: str, job_id: str, stage: str, messages: list[dict[str, str]], selected: dict[str, Any], fallback: dict[str, Any], *, strict: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
        module = {'critic': 'chapter_reviewer', 'editor': 'proofreader'}.get(stage, stage)
        try:
            return await self._tracked_complete(project_id, job_id, module, messages, selected), selected
        except Exception as e:
            if strict:
                raise
            await self.emit(project_id, job_id, "ERROR", {"stage": stage, "provider": selected.get("provider"), "message": str(e)})
            return await self._tracked_complete(project_id, job_id, module, messages, fallback), fallback


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

    def _story_targets_for_chapter(self, project_id: str, chapter_id: str, story_card_id: str | None = None) -> dict[str, Any]:
        cards_dir = self.store._safe_path(project_id, "cards")
        story = {}
        story_card_id = story_card_id or self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('story_card_id')
        if story_card_id:
            story = self.store.read_yaml(project_id, f'cards/{story_card_id}.yaml').get('payload', {})
        elif cards_dir.exists():
            matches = []
            for f in cards_dir.glob("*.yaml"):
                card = self.store.read_yaml(project_id, f"cards/{f.name}")
                if card.get("type") == "story":
                    matches.append(card.get('payload', {}) or {})
            linked_stories = [value for value in matches if any(row.get('chapter_id') == chapter_id or row.get('chapter') == chapter_id for row in value.get('chapter_plan', []) if isinstance(row, dict))]
            choices = linked_stories or matches
            if len(choices) == 1:
                story = choices[0]
        def linked(section: str) -> list[dict[str, Any]]:
            rows = story.get(section, []) or []
            return [r for r in rows if r.get("chapter") == chapter_id or r.get("chapter_id") == chapter_id or r.get("first_chapter") == chapter_id or r.get("payoff_chapter") == chapter_id]

        return {
            'scope': 'author_plan',
            'knowledge_boundary': '以下是作者的结构安排，不表示事件已经发生或人物已经知道隐藏信息。',
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
            previous_chapter_status = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('chapter_status', 'drafting')
            self._write_chapter_status(project_id, chapter_id, "生成中")
            selection_range = self._normalize_selection_range(payload)
            scene = bp.get("scene_plan", [])[scene_index]
            writing_run = payload.get('writing_run') or {}
            original_draft = self.store.read_md(project_id, f'drafts/{chapter_id}.md')
            if writing_run.get('beat_index') is not None:
                beat_index = writing_run['beat_index']
                scene = {**scene, 'beats': [scene['beats'][beat_index]]}
            elif writing_run:
                scene = {**scene, 'chapter_scenes': bp['scene_plan']}
            outline = self.store.read_yaml(project_id, "cards/outline_001.yaml")
            generation_control = payload.get("generation_control") if isinstance(payload.get("generation_control"), dict) else {}
            scope_service = WorldScopeService(self.store)
            author_scope = scope_service.resolve(project_id, story_card_id=generation_control.get('story_card_id'), chapter_id=chapter_id,
                event_ref=generation_control.get('scene_ref'), world_context=generation_control.get('world_context'), branch_id=generation_control.get('branch_id'), pov_character_id=generation_control.get('pov_character_id'), pov=generation_control.get('pov'))
            scope = author_scope['scope']
            req_profile_id, selected, fallback = self._resolve_profile(project_id, payload, "chapter_writer")

            plan = {"scene": scene, "beats": outline.get("payload", {}).get("beats", [])}
            await self.emit(project_id, job_id, "DIRECTOR_PLAN", {**plan, "output_summary": "导演阶段生成场景计划"})

            selected_bundle = self.technique_director.resolve_selected_bundle(project_id, chapter_id, outline, scene)
            selected_techniques = selected_bundle.get("selected_techniques", [])
            selected_categories = selected_bundle.get("selected_categories", [])
            if generation_control.get('include_techniques') is False:
                selected_techniques, selected_categories = [], []
            story_targets = self._story_targets_for_chapter(project_id, chapter_id, scope.get('story_card_id'))
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
                [fact for fact in self.store.read_jsonl(project_id, "canon/facts.jsonl") if scope_service.fact_visible(project_id, fact, scope)][-8:],
                selected_techniques,
                selected_categories,
            )
            await self.emit(project_id, job_id, "TECHNIQUE_BRIEF", {**technique_bundle, "input_summary": "读取 pinned 技法和宏观技法分类", "output_summary": "生成技法 brief 与 checklist"})
            chapter_meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
            chapter_meta["technique_brief"] = technique_bundle.get("technique_brief", "")
            chapter_meta["technique_checklist"] = technique_bundle.get("technique_checklist", [])
            if writing_run:
                chapter_meta['writing_scene'] = {'blueprint_id': payload['blueprint_id'], 'scene_index': scene_index}
            self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", chapter_meta)

            manifest = self.context_engine.build_manifest(project_id, chapter_id, scene, payload.get("constraints", {}), technique_bundle)
            manifest['author_scope'] = author_scope
            if writing_run:
                manifest['linked_materials'] = KnowledgeGraphService(self.store).materials(project_id, chapter_id, scene, max_chars=min(12000, max(2000, int(payload.get('constraints', {}).get('max_tokens', 2400)) * 3)), include_references=generation_control.get('include_techniques') is not False, world_context=scope, story_card_id=generation_control.get('story_card_id'), scene_ref=generation_control.get('scene_ref'), branch_id=scope.get('branch_id'), pov_character_id=scope.get('pov_character_id'))
            reference_cards = [*manifest.get('included_cards', []), *[card for card in manifest.get('linked_materials', {}).get('cards', []) if card.get('type') in {'world', 'style', 'world_rule', 'lore'}]]
            world_ids = [card.get('id') for card in reference_cards if card.get('type') in {'world', 'world_rule', 'lore', 'worldview'}]
            manifest['address_rules'] = SharedMaterialService(self.store).address_rules(project_id, chapter_id, world_ids=world_ids, world_context=scope) if generation_control.get('include_cards') is not False else []
            manifest['world_baselines'] = SharedMaterialService(self.store).world_baselines(project_id, chapter_id, world_ids=world_ids, world_context=scope) if generation_control.get('include_cards') is not False else []
            manifest['event_context'] = KnowledgeGraphService(self.store).event_context(project_id, chapter_id, generation_control.get('scene_ref'), generation_control.get('story_card_id'), world_context=scope, branch_id=scope.get('branch_id'), pov_character_id=scope.get('pov_character_id')) if generation_control.get('include_lines') is not False else {}
            manifest['writing_references'] = WritingReferenceService(self.store).collect(project_id, cards=reference_cards, chapter_id=chapter_id, cast=scene.get('cast', []), story_card_id=generation_control.get('story_card_id')) if generation_control.get('include_techniques') is not False else {'references': [], 'omitted': []}
            manifest['story_planning'] = StoryPlanningService(self.store).chapter_materials(project_id, chapter_id, story_card_id=generation_control.get('story_card_id'), world_context=scope, scene_ref=generation_control.get('scene_ref'))
            if writing_run:
                rehearsals = SceneRehearsalService(self.store).writer_materials(project_id, chapter_id, story_card_id=generation_control.get('story_card_id'), scene_ref=generation_control.get('scene_ref'))
                if rehearsals.get('stale'):
                    raise ValueError('本章关联的场景推演依据已变化，请回到情节工作表核对并重新确认，再生成正文。')
                manifest['scene_rehearsals'] = rehearsals
            manifest["llm"] = {"requested_profile_id": req_profile_id, "requested_provider": selected.get("provider"), "requested_model": selected.get("model")}
            manifest["generation_control"] = generation_control
            manifest["usage_estimate"] = {"prompt_tokens": 0, "completion_tokens": 0}
            manifest["manifest_hash"] = self._hash_payload(manifest)
            manifest["evidence_policy"] = {"required_quote_for_supported": True, "unsupported_without_quote": True}
            if manifest.get("compression_steps") and not manifest.get("compression_reason"):
                manifest["compression_reason"] = "上下文预算触发裁剪，优先保留 style locks、章节目标、人物硬设定、未回收伏笔、世界规则。"
            guide_text = str(manifest["fixed_blocks"].get("style_guide", {}))
            world_facts = manifest.get("world_facts", [])[:5]
            writer_messages = [
                {"role": "system", "content": "你是长篇小说写作助手，按提供文风与场景目标写作，必须遵守style locks。"},
                {"role": "user", "content": f"scene={scene}\nstyle_guide={guide_text}\nstyle_locks={manifest.get('fixed_blocks',{}).get('style_locks',{})}\nworld_facts={world_facts}\ntechnique_brief={manifest.get('fixed_blocks',{}).get('technique_brief','')}\ntechnique_checklist={manifest.get('fixed_blocks',{}).get('technique_checklist',[])}\ntechnique_agent_tags={manifest.get('fixed_blocks',{}).get('technique_agent_tags',[])}\n请写一段章节草稿。"},
            ]
            if writing_run:
                order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
                prior = order[order.index(chapter_id) - 1] if chapter_id in order and order.index(chapter_id) > 0 else None
                direction = generation_control.get('scene_direction') or generation_control.get('writing_alignment', {}).get('scene_direction') or {}
                direction = {key: str(direction[key]) for key in ['shots', 'setting', 'motivation', 'performance', 'focus', 'atmosphere', 'perception', 'reader_feeling', 'dramatic_function'] if isinstance(direction, dict) and direction.get(key)}
                writer_messages = [{'role': 'system', 'content': '你是中文小说写作助手。只输出小说正文，不输出写作说明或摄影脚本。根据章节计划与作者共识写作；承接前文，保持人物与事实一致，必须遵守文风约束。只使用给定材料；缺少依据时不要自创关键事实。作者设定不代表人物已知信息，不要把未来秘密写成人物已知。每次写作都要从全局故事线、当前章节目标落实到场景：作者意图优先，先按作者确定的段落作用（推进、人物、伏笔、回收、转折或蓄势）选择细节，再把感知、动作或反应、随后变化连成因果。从选定角色的注意与处境出发，选择真正有作用的视觉、听觉或触觉素材，不罗列五感、不并列堆放景物、不随意跳视角；不能擅自把素材升格为新伏笔或新事实。保持空间和时间连续，让人物动机驱动动作、表情、沉默与对话。描写焦点可由远及近，再落到推动情绪或冲突的具体细节；用人物不说话时的细小动作与环境变化烘托情绪，细节有主次，不堆满感官。参考镜头、画面和布景需要转换成自然小说叙述，不照搬机位或剪辑术语；适量运用贴合文风的描写、结构和抒情技法，修辞服务情节而非堆砌。已确认的场景推演是作者采用的创作安排，不是既成事实。依照它把重要人物各自的打算写成互相牵动的行动与回应：一个人的行为应改变另一个人能够或愿意作出的选择，再由反应改变局势。沉默、退让和注意转移同样可以形成变化；空间、物件与环境要实际影响行动，而非均匀堆砌景物。保留每个角色的底线，情绪、神态随处境变化，不把人物参考图的定格表情写成恒定状态。让本场后果形成后场问题；所选技法按作者指定的作用位置服务铺势与转折，不擅自增加秘密、人物或规则。引用的写作工具仅作为约束，不额外生成一轮规划或自动检查。'}, {'role': 'user', 'content': json.dumps({
                    '本次范围': writing_run.get('label'),
                    '写作方式': '只续写当前桥段，不重复已经写过的内容' if writing_run.get('append') else '完成当前章节的场景与目标',
                    '章节计划': payload.get('constraints', {}).get('chapter_plan', {}),
                    '故事要求': story_targets,
                    '作者共识': generation_control.get('writing_alignment', {}),
                    '叙述视角': author_scope.get('narrative_pov') or '沿用作者已有叙述，视角人物的知识不得超出本次资料范围。',
                    '场景表达参考（可选，转成小说语言）': direction,
                    '人物与设定': manifest.get('fixed_blocks', {}),
                    '本章相关材料（最新保存版，包含来源）': manifest['linked_materials'],
                    '作者选用的写作参考': manifest['writing_references'],
                    '关联情节规划（作者规划，不代表人物已知）': manifest['story_planning'],
                    '上一章结尾': self.store.read_md(project_id, f'drafts/{prior}.md')[-2500:] if prior else '',
                    '本章已写内容': writing_run.get('append_base', '')[-6000:] if writing_run.get('append') else '',
                }, ensure_ascii=False)}]
                requirements = json.loads(writer_messages[-1]['content'])
                requirements = {key: requirements[key] for key in ['本次范围', '写作方式', '章节计划', '故事要求', '作者共识', '叙述视角', '场景表达参考（可选，转成小说语言）']}
                requirements['场景'] = scene
                input_limit = payload.get('constraints', {}).get('context_max_chars', 14000)
                if isinstance(input_limit, bool) or not isinstance(input_limit, int) or not 4000 <= input_limit <= 100000:
                    raise ValueError('本次取材范围必须在 4000 至 100000 字符之间。')
                if generation_control.get('include_lines') is False:
                    requirements.pop('故事要求')
                pack_manifest = manifest
                if generation_control.get('include_cards') is False:
                    pack_manifest = {**manifest, 'included_cards': [], 'linked_materials': {**manifest['linked_materials'], 'cards': []}, 'fixed_blocks': {**manifest['fixed_blocks'], 'style_guide': {}, 'style_locks': {}}}
                writer_messages[-1]['content'], report = ContextPackService(self.store).build(
                    project_id, chapter_id, pack_manifest, requirements,
                    previous_end=self.store.read_md(project_id, f'drafts/{prior}.md') if prior else '',
                    current_end=writing_run.get('append_base', '') if writing_run.get('append') else '',
                    max_chars=input_limit - 2000,
                )
                manifest['context_pack'] = {**report, 'request_char_limit': input_limit, 'writer_request_chars': sum(len(message['content']) for message in writer_messages)}
            if not writing_run:
                writer_messages[-1]['content'], report = ContextPackService(self.store).build(project_id, chapter_id, manifest,
                    {'场景': scene, '故事要求': story_targets, '叙述视角': author_scope.get('narrative_pov') or '沿用作者视角'}, max_chars=14000)
                manifest['context_pack'] = report
                writer_messages[0]['content'] += '只采用本次有来源资料，规划不等于已发生事实，人物不能提前知道未来秘密。'
            address_guidance = '遵守人物已保存的性别、代词、称呼说明和世界称谓通则；人物关系address_as表示当前人物如何称呼target，不能反用。不从外貌、ABO分类或性别推断亲属与称呼，未知时用姓名或保留未知。'
            writer_messages[0]['content'] += address_guidance + CHARACTER_PORTRAYAL_GUIDANCE
            manifest['manifest_hash'] = self._hash_payload({key: value for key, value in manifest.items() if key != 'manifest_hash'})
            self._persist_memory_pack(project_id, chapter_id, job_id, manifest)
            await self.emit(project_id, job_id, "CONTEXT_MANIFEST", {**manifest, "input_summary": "组装上下文、证据、预算和压缩记录", "output_summary": f"使用证据 {len(manifest.get('evidence', []))} 条，压缩 {len(manifest.get('compression_steps', []))} 步"})
            writer_text, writer_used, writer_tokens = await self._writer(project_id, job_id, writer_messages, selected, fallback, max_tokens=int(payload.get('constraints', {}).get('max_tokens', 2400)) if writing_run else 900, strict=bool(writing_run))
            draft = f"# {chapter_id}\n\n{writer_text}" if writer_text else f"# {chapter_id}\n\n林秋在{scene.get('situation')}做出选择。"
            if writing_run:
                if not writer_text.strip():
                    raise ValueError('模型未返回正文。')
                if writing_run.get('append'):
                    draft = writing_run.get('append_base', original_draft).rstrip() + '\n\n' + writer_text
            with ChangeSuggestionService(self.store).lock(project_id):
                if not ContextPackService(self.store).sources_unchanged(project_id, manifest['context_pack'].get('source_versions', {})):
                    raise ValueError('生成期间采用的资料已更新，原正文保留，请重新核对后生成。')
                if self.store.read_md(project_id, f'drafts/{chapter_id}.md') != original_draft:
                    raise ValueError('生成期间作者已修改正文，已保留新编辑，请重新生成。')
                if writing_run:
                    current_scope = scope_service.resolve(project_id, story_card_id=generation_control.get('story_card_id'), chapter_id=chapter_id, event_ref=generation_control.get('scene_ref'), world_context=generation_control.get('world_context'), branch_id=generation_control.get('branch_id'), pov_character_id=generation_control.get('pov_character_id'), pov=generation_control.get('pov'))
                    if current_scope['scope'] != scope or current_scope.get('narrative_pov') != author_scope.get('narrative_pov'):
                        raise ValueError('生成期间故事时间、分支或叙述视角已变化，原正文保留，请重新核对后生成。')
                    if not ContextPackService(self.store).sources_unchanged(project_id, manifest['context_pack'].get('source_versions', {})):
                        raise ValueError('生成期间引用的设定已有新修改，已保留作者的最新资料与原正文，请重新生成。')
                    if generation_control.get('include_cards') is not False and SharedMaterialService(self.store).address_rules(project_id, chapter_id, world_ids=world_ids, world_context=scope) != manifest['address_rules']:
                        raise ValueError('生成期间世界称谓通则已变化，请使用最新资料重新生成。')
                    if generation_control.get('include_cards') is not False and SharedMaterialService(self.store).world_baselines(project_id, chapter_id, world_ids=world_ids, world_context=scope) != manifest['world_baselines']:
                        raise ValueError('生成期间世界参照已变化，请使用最新资料重新生成。')
                    if generation_control.get('include_lines') is not False and KnowledgeGraphService(self.store).event_context(project_id, chapter_id, generation_control.get('scene_ref'), generation_control.get('story_card_id'), world_context=scope, branch_id=scope.get('branch_id'), pov_character_id=scope.get('pov_character_id')) != manifest['event_context']:
                        raise ValueError('生成期间事件或关系依据已有变化，原正文已保留，请重新生成。')
                    if self.store.read_md(project_id, f'drafts/{chapter_id}.md') != original_draft:
                        raise ValueError('正文在生成期间被修改，已保留作者的新内容，请重新生成。')
                previous_draft = self.store.read_md(project_id, f"drafts/{chapter_id}.md")
                from services.author_control_service import AuthorControlService
                AuthorControlService(self.store).assert_write(project_id, f'drafts/{chapter_id}.md', previous_draft, draft)
                if previous_draft:
                    save_snapshot(self.store, project_id, chapter_id, previous_draft, reason="before_ai_draft", patch_id=job_id)
                self.store.write_md(project_id, f"drafts/{chapter_id}.md", draft)
                IncrementalMemoryService(self.store).mark(project_id, f'drafts/{chapter_id}.md')
                review = create_chapter_review(self.store, project_id, chapter_id, draft, job_id=job_id, source="writer_agent")
                self._write_chapter_status(project_id, chapter_id, "待审稿")
            manifest["usage_estimate"] = {
                "prompt_tokens": max(1, len(str(writer_messages)) // 4),
                "completion_tokens": max(1, len("".join(writer_tokens)) // 4),
            }
            checkpoints = self._writer_checkpoints(chapter_id, draft, word_checkpoint_chars)
            manifest["writer_checkpoints"] = checkpoints
            if checkpoints:
                await self.emit(project_id, job_id, "WRITER_CHECKPOINT", {"chapter_id": chapter_id, "checkpoints": checkpoints, "provider": writer_used.get("provider"), "model": writer_used.get("model"), "fallback": writer_used.get("provider") != selected.get("provider"), "input_summary": f"按 {word_checkpoint_chars} 字阈值压缩", "output_summary": f"生成 {len(checkpoints)} 个阶段摘要"})
            await self.emit(project_id, job_id, "WRITER_DRAFT", {"chapter_id": chapter_id, "review_id": review.get("review_id"), "text": draft, "provider": writer_used.get("provider"), "model": writer_used.get("model"), "fallback": writer_used.get("provider") != selected.get("provider"), "input_summary": "撰写 Agent 使用 manifest 和审查清单生成正文", "output_summary": f"生成正文 {len(draft)} 字，进入作者待审"})

            tech_issues = derive_technique_adherence_issues(chapter_id, draft, manifest.get("fixed_blocks", {}).get("technique_checklist", []))
            marks = self.evidence_service.build_marks(project_id, chapter_id, job_id=job_id, model=writer_used.get("model", ""), technique_checklist=manifest.get("fixed_blocks", {}).get("technique_checklist", []), issues=tech_issues)
            self.evidence_service.save_marks(project_id, chapter_id, marks)
            supported = [m for m in marks if m.get("detection", {}).get("support_level") == "supported"]
            unsupported = [m for m in marks if m.get("detection", {}).get("support_level") == "unsupported"]
            await self.emit(project_id, job_id, "MARK_EXTRACTION", {"chapter_id": chapter_id, "marks": marks, "provider": "rules", "model": "evidence-rules-v1", "input_summary": "从正文抽取人物、技法、明线、暗线、伏笔命中", "output_summary": f"supported={len(supported)}, unsupported={len(unsupported)}"})
            await self.emit(project_id, job_id, "CLAIM_VERIFICATION", {"chapter_id": chapter_id, "verified_mark_ids": [m.get("mark_id") for m in supported], "unsupported_mark_ids": [m.get("mark_id") for m in unsupported], "provider": "rules", "model": "quote-verifier-v1", "input_summary": "回查 quote 和行号", "output_summary": f"{len(unsupported)} 条未证实"})

            critic_messages = [{'role': 'system', 'content': '你是小说审稿人，只根据当前正文、已保存设定和有来源的材料指出主要问题；明确事件阶段优先于章节讲述顺序，不把未来事件或读者已知当作人物已知；没有依据时明确未知。'}, {'role': 'user', 'content': draft[:900] + '\n本次取材（规划不能当作已发生事实）：' + writer_messages[-1]['content']}]
            from services.information_service import InformationService
            review_information = InformationService(self.store).materials(project_id, scope, for_review=True, actor_ids=scene.get('cast', []), max_chars=5000)
            if review_information['items']:
                critic_messages[-1]['content'] += '\n审查专用的信息边界（不要将私有真相写回有限视角正文）：' + json.dumps(review_information, ensure_ascii=False)
                critic_messages[0]['content'] += '区分真实冲突、人物误信或有意说谎、不可靠叙述、未定真相和有意悬念；有意安排且依据未变时不要反复误报，不要自动把谎话修成真话或提前揭密。'
            critic_messages[0]['content'] += address_guidance + CHARACTER_PORTRAYAL_GUIDANCE
            _, critic_selected, critic_fallback = self._resolve_profile(project_id, payload, "chapter_reviewer")
            critic_out, critic_used = await self._complete_with_fallback(project_id, job_id, "critic", critic_messages, critic_selected, critic_fallback, strict=bool(writing_run))
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
            _, editor_selected, editor_fallback = self._resolve_profile(project_id, payload, "proofreader")
            editor_out, editor_used = await self._complete_with_fallback(project_id, job_id, "editor", editor_messages, editor_selected, editor_fallback, strict=bool(writing_run))
            ops = []
            valid_editor_output = False
            try:
                obj = json.loads(editor_out.get("text", "{}"))
                ops = obj.get("ops", []) if isinstance(obj, dict) else []
                valid_editor_output = isinstance(obj, dict) and isinstance(obj.get('ops'), list)
            except Exception:
                ops = []
            if writing_run and editor_used.get('provider') != 'mock' and not valid_editor_output:
                raise ValueError('校对模型返回格式无效，已保留生成的草稿，请检查后继续。')
            if not ops and not writing_run:
                ops = [{"op_id": "op_001", "type": "replace", "target_range": {"start": 2, "end": 3}, "before": "", "after": "林秋停了两秒。她收起手机，走进雨里，决定赴约。", "rationale": "增强节奏与动作"}]
            if not writing_run and selection_range and not self._clip_ops_to_selection(ops, selection_range):
                s0, e0 = selection_range["start"], selection_range["end"]
                ops = [{"op_id": "op_sel_001", "type": "replace", "target_range": {"start": s0, "end": e0}, "before": "", "after": "（选区内润色）", "rationale": "选区编辑兜底"}]
            technique_issue = next((x for x in issues if x.get("type") == "technique_adherence"), None)
            if technique_issue and not writing_run:
                ops.insert(0, {
                    "op_id": "op_technique_001",
                    "type": "replace",
                    "target_range": {"start": 2, "end": 3},
                    "before": "",
                    "after": f"（技法修复）{technique_issue.get('suggested_fix', '补充技法信号。')}",
                    "rationale": "优先修复 technique_adherence，最小改动",
                })

            ops = self._clip_ops_to_selection(ops, selection_range)
            patch_review = create_patch_review(
                self.store,
                project_id,
                chapter_id,
                f"patch_{job_id}",
                ops,
                job_id=job_id,
                selection_range=selection_range,
                provider=editor_used.get("provider", ""),
                model=editor_used.get("model", ""),
            )
            patch_payload = {"patch_id": f"patch_{job_id}", "patch_review_id": patch_review.get("review_id"), "ops": ops, "provider": editor_used.get("provider"), "model": editor_used.get("model"), "selection_range": selection_range, "input_summary": "基础校对 Agent 只做语言层 patch，不新增事实", "output_summary": f"生成 {len(ops)} 条待审 patch"}
            if writing_run and not ops:
                patch_payload['output_summary'] = '未生成可应用的修改建议，保留原文；模拟预览不代表真实模型校对。' if editor_used.get('provider') == 'mock' else '没有可应用的修改建议，保留原文。'
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
                with ChangeSuggestionService(self.store).lock(project_id):
                    if self.store.read_md(project_id, f'drafts/{chapter_id}.md') != draft:
                        raise ValueError('校对期间正文已有新编辑，旧修改未应用，作者新稿保留。')
                    self.store.write_md(project_id, f"drafts/{chapter_id}.md", updated)
                IncrementalMemoryService(self.store).mark(project_id, f'drafts/{chapter_id}.md')
                self.store.append_jsonl(project_id, f"drafts/{chapter_id}.patch.jsonl", {"patch_id": f"patch_{job_id}", "patch_ops": ops, "accept_op_ids": [o.get("op_id") for o in ops], "accepted_op_ids": [o.get("op_id") for o in ops], "rejected_op_ids": [], "diff": diff, "job_id": job_id})
                await self.emit(project_id, job_id, "MERGE_RESULT", {"chapter_id": chapter_id, "applied": True, "accepted_op_ids": [o.get("op_id") for o in ops], "rejected_op_ids": []})

                summary = make_summaries(chapter_id, updated)
                meta = self.store.read_json(project_id, f"drafts/{chapter_id}.meta.json")
                meta.update(summary)
                self.store.write_json(project_id, f"drafts/{chapter_id}.meta.json", meta)
                self.store.write_md(project_id, f"meta/summaries/{chapter_id}.summary.md", summary["chapter_summary"])
                self.store.write_json(project_id, f"meta/summaries/{chapter_id}.scene_summaries.json", summary["scene_summaries"])

                chapter_fact = {"id": f"fact_{job_id}", "scope": "chapter_summary", 'world_context': scope, "key": "summary", "value": summary["chapter_summary"], "confidence": 0.8, "evidence": {"chapter_id": chapter_id, "quote": summary["chapter_summary"][:80]}, "sources": [{"path": f"drafts/{chapter_id}.md"}]}
                self.store.append_jsonl(project_id, "canon/facts.jsonl", chapter_fact)
                for scene_summary in summary["scene_summaries"]:
                    self.store.append_jsonl(project_id, "canon/facts.jsonl", {"id": f"fact_{uuid.uuid4().hex[:10]}", "scope": "scene_summary", 'world_context': scope, "key": "scene", "value": scene_summary["summary"], "confidence": 0.7, "evidence": {"chapter_id": chapter_id, "quote": scene_summary["summary"][:80]}, "sources": [{"path": f"drafts/{chapter_id}.md"}]})
                _, canon_selected, _canon_fallback = self._resolve_profile(project_id, payload, "canon_extractor")
                canon_profile = canon_selected
                if canon_profile.get("provider") == "mock" and writer_used.get("provider") != "mock":
                    canon_profile = writer_used
                extracted = await self.canon_extractor.extract(chapter_id, updated, {"scene_index": scene_index, "beats": scene.get("beats", []), "cast": scene.get("cast", [])}, canon_profile, usage_callback=lambda stats: self._record_usage(project_id, job_id, 'canon_extractor', canon_profile, stats, status=stats.get('status', 'completed')))
                if self.store.read_md(project_id, f'drafts/{chapter_id}.md') != updated:
                    raise ValueError('核对期间正文已有新编辑，旧事实提取结果未写入，作者新稿保留。')
                for fact in extracted.get("facts", []):
                    self.store.append_jsonl(project_id, "canon/facts.jsonl", {**fact, 'world_context': scope})
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
        except asyncio.CancelledError:
            if payload.get('writing_run'):
                self._write_job_record(project_id, job_id, {'status': 'failed', 'last_error': '服务停止，本段尚未完成，可从断点重试。'})
                if self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('chapter_status') == '生成中':
                    self._write_chapter_status(project_id, chapter_id, previous_chapter_status)
            raise
        except Exception as exc:
            if payload.get('writing_run') and 'chapter_id' in locals() and self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('chapter_status') == '生成中':
                self._write_chapter_status(project_id, chapter_id, previous_chapter_status)
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
