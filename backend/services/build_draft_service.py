from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from storage.fs_store import FSStore


BUILD_DRAFT_KINDS = {"story_overview", "character_seed", "lines", "foreshadowing"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BuildDraftService:
    def __init__(self, store: FSStore) -> None:
        self.store = store

    def _story_payload(self, story_card: dict[str, Any] | None) -> dict[str, Any]:
        if story_card and isinstance(story_card.get("payload"), dict):
            return story_card["payload"]
        return {}

    def _draft_path(self, draft_id: str) -> str:
        return f"meta/build_drafts/{draft_id}.json"

    def list_drafts(self, project_id: str, kind: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        root = self.store._safe_path(project_id, "meta/build_drafts")
        rows: list[dict[str, Any]] = []
        for path in root.glob("*.json"):
            row = self.store.read_json(project_id, f"meta/build_drafts/{path.name}")
            if not row:
                continue
            if kind and row.get("kind") != kind:
                continue
            if status and row.get("status") != status:
                continue
            rows.append(row)
        return sorted(rows, key=lambda x: str(x.get("created_at") or ""), reverse=True)

    def get_draft(self, project_id: str, draft_id: str) -> dict[str, Any]:
        return self.store.read_json(project_id, self._draft_path(draft_id))

    def create_draft(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        kind = str(body.get("kind") or "")
        if kind not in BUILD_DRAFT_KINDS:
            raise ValueError(f"Unsupported build draft kind: {kind}")

        revision = int(body.get("revision") or 1)
        story_card = body.get("story_card") if isinstance(body.get("story_card"), dict) else {}
        selected_chapter = str(body.get("selected_chapter") or "chapter_001")
        payload = self._story_payload(story_card)
        title = str(story_card.get("title") or "未命名小说") if story_card else "未命名小说"

        content = self._content_for_kind(kind, title, payload, selected_chapter, revision)
        draft_id = f"build_{kind}_{uuid.uuid4().hex[:10]}"
        rec = {
            "draft_id": draft_id,
            "kind": kind,
            "title": self._title_for_kind(kind),
            "revision": revision,
            "status": "pending",
            "source": "api_template",
            "selected_chapter": selected_chapter,
            "body": json.dumps(content, ensure_ascii=False, indent=2),
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "input_summary": {
                "story_id": story_card.get("id") if story_card else "",
                "story_title": title,
                "keywords": payload.get("keywords", []),
            },
            "review_policy": "作者可编辑草案；确认后才写入卡片或事实库。",
        }
        self.store.write_json(project_id, self._draft_path(draft_id), rec)
        return rec

    def update_draft(self, project_id: str, draft_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        rec = self.get_draft(project_id, draft_id)
        if not rec:
            raise FileNotFoundError(draft_id)
        for key in ["body", "status", "accepted_target", "accepted_scope", "rejection_reason"]:
            if key in patch:
                rec[key] = patch[key]
        if rec.get("status") == "rejected" and not rec.get("rejection_reason"):
            rec["rejection_reason"] = "作者拒绝"
        rec["updated_at"] = now_iso()
        self.store.write_json(project_id, self._draft_path(draft_id), rec)
        return rec

    def _title_for_kind(self, kind: str) -> str:
        return {
            "story_overview": "故事总控草案",
            "character_seed": "人物初设草案",
            "lines": "明线/暗线草案",
            "foreshadowing": "伏笔草案",
        }[kind]

    def _content_for_kind(self, kind: str, title: str, payload: dict[str, Any], chapter_id: str, revision: int) -> dict[str, Any]:
        if kind == "story_overview":
            scenes = [
                row for row in (payload.get("important_scenes") or [])
                if isinstance(row, dict) and (row.get("scene") or row.get("purpose") or row.get("chapter"))
            ]
            return {
                "logline": payload.get("logline") or f"{title}的主角在关键事件中被迫面对核心秘密。",
                "theme": payload.get("theme") or "选择的代价与自我边界",
                "genre": payload.get("genre") or "长篇类型小说",
                "worldview": payload.get("worldview") or "请补充世界背景、关键规则和限制。",
                "main_conflict": payload.get("main_conflict") or "主角目标与外部压力、隐藏真相之间形成持续冲突。",
                "keywords": payload.get("keywords") or ["主角秘密", "阶段冲突", f"刷新{revision}"],
                "target_reader": payload.get("target_reader") or "喜欢人物动机清晰、伏笔可回查、章节钩子明确的长篇读者。",
                "platform_style": payload.get("platform_style") or "章节节奏紧，每章有明确推进和未解问题。",
                "banned_items": payload.get("banned_items") or ["不要提前揭示最终真相", "不要让角色违背硬设定"],
                "important_scenes": scenes or [{"scene": "开篇关键场景", "purpose": "触发主冲突", "chapter": chapter_id}],
            }
        if kind == "character_seed":
            return {
                "id": f"character_draft_{uuid.uuid4().hex[:8]}",
                "type": "character",
                "title": "待确认人物",
                "tags": ["pending_ai_draft"],
                "links": [],
                "payload": {
                    "name": "待确认人物",
                    "identity": "请改写身份",
                    "appearance": "",
                    "core_motivation": f"被卷入「{payload.get('main_conflict') or '主冲突'}」并寻找自己的答案。",
                    "personality_traits": ["克制", "警觉"],
                    "family_background": "",
                    "voice": "说话谨慎，避免一次性暴露真实想法。",
                    "boundaries": ["不能无证据相信陌生人"],
                    "relationships": [],
                    "arc": [{"beat": chapter_id, "goal": "在本章做出第一个主动选择"}],
                    "role": "supporting",
                    "importance": 3,
                },
            }
        if kind == "lines":
            return {
                "open_line": [{"chapter": chapter_id, "event": "表面事件待确认", "goal": "角色本章可见目标", "conflict": "阻碍/冲突", "result": "本章结果"}],
                "hidden_line": [{"chapter": chapter_id, "truth": "暗处真实信息待确认", "visible_hint": "读者能看见的提示", "hidden_meaning": "提示背后的真实意义", "reveal_timing": "后续揭示"}],
            }
        return {
            "foreshadowings": [{
                "id": f"foreshadow_{uuid.uuid4().hex[:8]}",
                "content": "待确认伏笔",
                "first_chapter": chapter_id,
                "surface_signal": "正文中可看见的显示方式",
                "reader_feeling": "读者当下感受",
                "true_meaning": "真实意义",
                "payoff_chapter": "",
                "payoff": "",
                "emphasis": "反复出现但暂不解释",
                "status": "未出现",
            }],
        }
