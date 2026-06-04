from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path
from typing import Any


WENSHAPE_SUBDIRS = ["cards", "canon", "drafts", "sessions", "volumes"]
EXT_SUBDIRS = [
    "assets/style_samples",
    "assets/docs",
    "assets/images",
    "assets/wiki",
    "meta/kb/kb_style",
    "meta/kb/kb_docs",
    "meta/kb/kb_manuscript",
    "meta/kb/kb_world",
    "meta/summaries",
    "meta/wiki",
    "meta/evidence_marks",
    "meta/trust_reports",
    "meta/build_drafts",
    "meta/chapter_reviews",
    "meta/patch_reviews",
    "meta/jobs",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_simple_yaml_scalar(raw: str) -> Any:
    value = raw.strip()
    if value == "[]":
        return []
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_parse_simple_yaml_scalar(x) for x in inner.split(",")]
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value in {"null", "None", "~"}:
        return None
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def _read_simple_yaml(text: str) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1] if stack else root
        if raw_value.strip() == "":
            child: dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            parent[key] = _parse_simple_yaml_scalar(raw_value)
    return root


@dataclass
class FSStore:
    data_dir: Path

    def __post_init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _project_dir(self, project_id: str) -> Path:
        base = self.data_dir.resolve()
        target = (base / project_id).resolve()
        if target == base or base not in target.parents:
            raise ValueError("Invalid project path")
        return target

    def _safe_path(self, project_id: str, *parts: str) -> Path:
        pdir = self._project_dir(project_id)
        target = (pdir.joinpath(*parts)).resolve()
        if target == pdir or pdir not in target.parents:
            raise ValueError("Path traversal blocked")
        return target

    def ensure_project(self, project_id: str, title: str) -> Path:
        pdir = self._project_dir(project_id)
        pdir.mkdir(parents=True, exist_ok=True)
        for s in WENSHAPE_SUBDIRS + EXT_SUBDIRS:
            (pdir / s).mkdir(parents=True, exist_ok=True)
        project = self.read_yaml(project_id, "project.yaml")
        if not project:
            project = {"id": project_id, "title": title, "created_at": now_iso()}
        project.setdefault("token_budgets", {
            "total": 131072,
            "allocation": {
                "system_rules_pct": 0.05,
                "cards_pct": 0.15,
                "canon_pct": 0.10,
                "summaries_pct": 0.20,
                "current_draft_pct": 0.30,
                "output_reserve_pct": 0.20,
                "world_pct": 0.10,
            },
            "caps": {"max_items_per_bucket": 50, "max_examples_style": 5},
        })
        project.setdefault("world_sources", ["project_local"])
        project.setdefault("default_llm_profile_id", "mock_default")
        project.setdefault("llm_profiles", {
            "mock_default": {"provider": "mock", "model": "mock-writer-v1", "base_url": "", "api_key": "", "timeout_s": 60, "stream": True},
            "ollama_default": {"provider": "ollama", "model": "qwen2.5:7b", "base_url": "http://127.0.0.1:11434", "api_key": "", "timeout_s": 60, "stream": True},
            "llama_cpp_default": {"provider": "llama_cpp", "model": "local-gguf", "base_url": "http://127.0.0.1:8080", "api_key": "", "timeout_s": 60, "stream": True},
            "openai_compat_default": {"provider": "openai_compat", "model": "gpt-4o-mini", "base_url": "http://127.0.0.1:8001", "api_key": "", "timeout_s": 60, "stream": True},
        })
        self.write_yaml(project_id, "project.yaml", project)
        return pdir

    def read_yaml(self, project_id: str, rel: str) -> dict[str, Any]:
        path = self._safe_path(project_id, rel)
        if not path.exists():
            return {}
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return _read_simple_yaml(text)

    def write_yaml(self, project_id: str, rel: str, data: dict[str, Any]) -> None:
        path = self._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def read_json(self, project_id: str, rel: str) -> dict[str, Any]:
        path = self._safe_path(project_id, rel)
        if not path.exists():
            return {}
        text = path.read_text(encoding="utf-8").strip()
        return json.loads(text) if text else {}

    def write_json(self, project_id: str, rel: str, data: Any) -> None:
        path = self._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def read_md(self, project_id: str, rel: str) -> str:
        path = self._safe_path(project_id, rel)
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def write_md(self, project_id: str, rel: str, text: str) -> None:
        path = self._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def read_jsonl(self, project_id: str, rel: str) -> list[dict[str, Any]]:
        path = self._safe_path(project_id, rel)
        if not path.exists():
            return []
        out: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
        return out

    def append_jsonl(self, project_id: str, rel: str, item: dict[str, Any]) -> None:
        path = self._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**item, "ts": item.get("ts", now_iso())}
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def list_projects(self) -> list[dict[str, Any]]:
        rows = []
        for p in self.data_dir.iterdir():
            if p.is_dir() and (p / "project.yaml").exists():
                project = self.read_yaml(p.name, "project.yaml")
                if project:
                    rows.append(project)
        return sorted(rows, key=lambda x: x.get("id", ""))

    def init_demo_project(self, project_id: str = "demo_project_001") -> None:
        self.ensure_project(project_id, "Demo Novel Project")
        self.write_yaml(project_id, "cards/character_001.yaml", {
            "id": "character_001", "type": "character", "title": "林秋", "tags": ["protagonist"], "links": ["worldview_001", "outline_001"],
            "payload": {
                "name": "林秋", "identity": "调查记者", "appearance": "短发、灰色风衣", "core_motivation": "查明父亲死亡真相",
                "personality_traits": ["冷静", "执拗"], "family_background": "单亲家庭", "voice": "克制冷峻",
                "boundaries": ["不伤及无辜"], "relationships": [{"target": "character_002", "type": "mentor"}], "arc": [{"beat": "beat_1", "goal": "追索真相"}]
            }
        })
        self.write_yaml(project_id, "cards/worldview_001.yaml", {"id": "worldview_001", "type": "world", "title": "临港城", "tags": [], "links": [], "payload": {"era": "近未来", "setting": "沿海巨型都市"}})
        self.write_yaml(project_id, "cards/style_001.yaml", {
            "id": "style_001", "type": "style", "title": "冷峻现实", "tags": [], "links": [],
            "payload": {
                "tone": "冷峻", "rules": ["短句为主"],
                "active_style_sample_asset_ids": ["style_sample_demo_001"],
                "style_guide": {"sentence_length": "短句优先", "dialogue_ratio": "中低", "punctuation": "少感叹号"},
                "injection_policy": {"max_examples": 4, "max_chars_per_example": 800},
                "locks": {"pov": True, "tense": True, "punctuation": True, "taboo_words": True},
            }
        })
        self.write_yaml(project_id, "cards/outline_001.yaml", {"id": "outline_001", "type": "outline", "title": "第一卷提纲", "tags": [], "links": ["character_001"], "payload": {"beats": [{"id": "beat_1", "summary": "匿名线索出现"}], "technique_prefs": [{"scope": "chapter", "ref": "chapter_001", "techniques": [{"technique_id": "technique_001", "intensity": "high", "notes": "本章冷笔触"}]}]}})
        self.write_yaml(project_id, "cards/story_001.yaml", {
            "id": "story_001", "type": "story", "title": "临港城主线", "tags": ["story-control"], "links": ["character_001", "outline_001"],
            "payload": {
                "logline": "调查记者林秋在雨夜匿名线索中追索父亲死亡真相。",
                "theme": "真相的代价与自我边界",
                "genre": "近未来悬疑",
                "keywords": ["调查记者", "封港", "旧案", "记忆篡改"],
                "target_reader": "喜欢近未来悬疑、人物秘密和连续伏笔的长篇读者。",
                "platform_style": "节奏紧、章节末保留问题，重视可追踪线索和强钩子。",
                "worldview": "沿海巨型都市临港城，灰色航运网络与封港法并存。",
                "main_conflict": "林秋追查真相时不断撞上黑潮同盟和城市封锁规则。",
                "banned_items": ["不要提前揭示发信人真实身份", "不要让主角无证据相信陌生人", "不要把蓝色车票解释成普通纪念品"],
                "important_scenes": [{"scene": "雨夜码头赴约", "purpose": "把主角推入旧案", "chapter": "chapter_001"}],
                "stages": [{"stage": "开局", "goal": "确认匿名线索可信度", "conflict": "线索引向封锁港区", "result": "林秋决定赴约", "turning_point": "短信提到父亲生前代号"}],
                "open_line": [{"chapter": "chapter_001", "event": "林秋收到匿名短信", "goal": "找到发信人", "conflict": "港区封锁", "result": "她前往码头"}],
                "hidden_line": [{"chapter": "chapter_001", "truth": "短信来自父亲旧案相关人", "visible_hint": "短信用词像旧档案编号", "hidden_meaning": "发信人知道父亲调查路线", "reveal_timing": "中段揭示"}],
                "foreshadowings": [{"id": "foreshadow_001", "content": "蓝色车票", "first_chapter": "chapter_001", "surface_signal": "林秋摸到口袋里的旧票根", "reader_feeling": "觉得它和雨夜赴约有关", "true_meaning": "她三天前已去过禁区车站", "payoff_chapter": "chapter_018", "payoff": "票根证明记忆被动过手脚", "emphasis": "反复出现但不解释", "status": "已埋"}],
                "chapter_plan": [{"chapter": "chapter_001", "chapter_id": "chapter_001", "title": "雨夜来信", "focus": "建立不安感与追索动机", "key_events": "匿名短信、封港、赴约", "stage_result": "主角进入案件", "conflict": "外部封锁与内部犹疑", "result": "林秋选择行动", "open_line": "找到发信人", "hidden_line": "发信人身份未明", "foreshadowing": "蓝色车票"}],
            },
        })

        categories = [
            ("technique_category_expression", "表达手法"),
            ("technique_category_rhetoric", "修辞手法"),
            ("technique_category_structure", "结构手法"),
            ("technique_category_description", "描写方法"),
            ("technique_category_performance", "表现手法"),
        ]
        for i, (cid, cname) in enumerate(categories, start=1):
            self.write_yaml(project_id, f"cards/{cid}.yaml", {
                "id": cid, "type": "technique_category", "title": cname, "tags": ["technique", "category"], "links": [],
                "payload": {"name": cname, "description": f"{cname}分类", "sort_order": i, "tags": ["技法", "分类"]},
            })
        seed_techniques = [
            {
                "id": "technique_001", "title": "悬念延迟", "category_id": "technique_category_structure",
                "description": "先给读者可见问题，再推迟关键答案，用行动和阻碍维持期待。",
                "signals": ["提出明确问题但暂不解释", "章节末保留未解信息", "人物行动被新阻碍打断"],
                "apply_steps": ["明确本段要悬置的问题", "给出局部证据而非答案", "用新的选择或阻碍收束段落"],
                "do": ["让延迟服务冲突升级", "每次延迟都给读者新信息"],
                "dont": ["只拖延不推进", "用作者旁白宣布神秘"],
            },
            {
                "id": "technique_002", "title": "误导", "category_id": "technique_category_structure",
                "description": "用真实但不完整的线索引导读者形成错误判断，后续再回收。",
                "signals": ["线索真实但解释方向可错", "角色根据有限信息做判断", "后文能重新解释前文细节"],
                "apply_steps": ["确定真实答案", "选择一个合理错误解释", "埋入可回查的双义细节"],
                "do": ["误导必须公平", "让误判来自人物视角限制"],
                "dont": ["靠作者隐瞒关键事实作弊", "回收时否定前文证据"],
            },
            {
                "id": "technique_003", "title": "反转", "category_id": "technique_category_structure",
                "description": "改变读者对事件性质、人物动机或局势胜负的判断。",
                "signals": ["同一事实出现新解释", "优势关系突然倒置", "人物选择暴露隐藏动机"],
                "apply_steps": ["建立读者默认判断", "保留能支撑反向解释的证据", "在动作或决定中揭示反向意义"],
                "do": ["反转后让前文更合理", "让反转带来新的冲突"],
                "dont": ["为了惊讶牺牲人设", "用随机新设定完成反转"],
            },
            {
                "id": "technique_004", "title": "对照", "category_id": "technique_category_performance",
                "description": "并置人物、场景、选择或价值观，让差异制造张力。",
                "signals": ["两种选择或态度并列", "环境冷暖/动静形成反差", "角色行为互为镜像"],
                "apply_steps": ["确定要凸显的差异", "选择可并置的对象", "让差异推动人物判断"],
                "do": ["让对照服务主题", "用具体动作呈现差异"],
                "dont": ["只写抽象评价", "对照双方没有剧情功能"],
            },
            {
                "id": "technique_005", "title": "对话潜台词", "category_id": "technique_category_expression",
                "description": "让角色嘴上谈一件事，真正争夺的是关系、秘密或立场。",
                "signals": ["台词回避核心问题", "停顿/动作承担真实情绪", "对话双方理解不同层含义"],
                "apply_steps": ["写出角色不能直说的真实目的", "设计表层话题", "用动作和反应露出潜台词"],
                "do": ["让潜台词来自人物关系", "保留读者可读懂的信号"],
                "dont": ["让角色替作者解释", "每句台词都过度隐喻"],
            },
            {
                "id": "technique_006", "title": "冲突升级", "category_id": "technique_category_structure",
                "description": "让阻碍从小到大、从外部到内部推进，迫使人物付出更高代价。",
                "signals": ["新阻碍比前一个更难", "人物选择代价上升", "外部冲突压到人物底线"],
                "apply_steps": ["列出当前目标", "增加更高代价或更短时限", "让角色必须做选择"],
                "do": ["每次升级改变局面", "把升级压到人物弱点"],
                "dont": ["只增加噪音或敌人数量", "升级后结果不影响后文"],
            },
            {
                "id": "technique_007", "title": "延迟满足", "category_id": "technique_category_performance",
                "description": "推迟读者期待的胜利、揭秘或情感释放，让回收更有重量。",
                "signals": ["目标接近但暂时失手", "回收前出现额外代价", "满足发生时解决多个积累问题"],
                "apply_steps": ["确认读者期待点", "安排合理阻断", "在回收时补偿更大情绪价值"],
                "do": ["延迟期间持续给小进展", "回收要兑现承诺"],
                "dont": ["无限拖延", "回收弱于铺垫"],
            },
        ]
        for tech in seed_techniques:
            self.write_yaml(project_id, f"cards/{tech['id']}.yaml", {
                "id": tech["id"], "type": "technique", "title": tech["title"], "tags": ["technique", "narrative"], "links": [tech["category_id"]],
                "payload": {
                    "name": tech["title"], "category_id": tech["category_id"], "aliases": [], "description": tech["description"],
                    "apply_steps": tech["apply_steps"],
                    "signals": tech["signals"],
                    "intensity_levels": {"low": "点缀", "med": "贯穿", "high": "主导"},
                    "metrics": {"dialogue_ratio_range": [0.2, 0.6], "punctuation_caps": 6, "metaphor_density": 0.06},
                    "do_dont": {"do": tech["do"], "dont": tech["dont"]},
                    "examples": [],
                },
            })
        tool_skills = [
            ("tool_skill_problem_checker", "小说问题检查工具", "checker", "reviewer", ["chapter", "story", "character", "canon"], "risk_report", ["人设一致性", "场景描述一致性", "时间线顺序", "伏笔埋设与回收"]),
            ("tool_skill_character_bio", "人物小传工具", "generator", "writer", ["character", "story"], "character_proposal", ["补全欲望/恐惧/伤口", "生成说话方式", "生成行为边界"]),
            ("tool_skill_outline_research", "小说大纲调研工具", "research", "researcher", ["story", "keywords"], "research_notes", ["题材读者期待", "同类结构观察", "套路风险", "差异化建议"]),
            ("tool_skill_timeline_check", "时间线检查", "checker", "reviewer", ["chapter_plan", "canon"], "timeline_risks", ["事件先后", "年龄/日期", "人物是否提前知道信息"]),
            ("tool_skill_scene_consistency", "场景一致性检查", "checker", "reviewer", ["world", "chapter"], "scene_risks", ["地点状态", "天气/时间", "物品位置", "空间连续性"]),
            ("tool_skill_foreshadow_tracker", "伏笔追踪", "tracker", "reviewer", ["story", "chapter"], "foreshadowing_marks", ["首次出现", "显示方式", "回收章节", "未证实命中"]),
        ]
        for tid, title, category, role, inputs, output, rules in tool_skills:
            self.write_yaml(project_id, f"cards/{tid}.yaml", {
                "id": tid,
                "type": "tool_skill",
                "title": title,
                "tags": ["tool_skill", category],
                "links": [],
                "payload": {
                    "name": title,
                    "category": category,
                    "description": f"{title}，输出进入待确认队列，不自动覆盖作者卡片。",
                    "input_types": inputs,
                    "output_type": output,
                    "agent_role": role,
                    "evidence_required": True,
                    "auto_apply_allowed": False,
                    "review_policy": "AI 只能生成 proposal；没有 quote/line 的判断不能显示为已命中。",
                    "check_rules": rules,
                    "proposal_fields": [],
                },
            })
        self.write_json(project_id, "cards/blueprint_001.json", {
            "id": "blueprint_001", "story_type_id": "longform_novel", "title": "第一章蓝图", "signals": ["@@BEAT:N@@", "@@NEXT_SCENE@@"],
            "scene_plan": [{"scene_id": "scene_1", "phase": "setup", "purpose": "引入线索", "situation": "雨夜收到匿名短信", "choice_points": ["是否赴约"], "cast": ["character_001"], "beats": ["beat_1"]}]
        })
        self.write_json(project_id, "volumes/volume_default.json", {
            "id": "volume_default",
            "title": "第一卷",
            "summary": "临港城主线开篇。",
            "order_index": 1,
            "chapter_ids": ["chapter_001"],
        })
        self.write_md(project_id, "drafts/.chapter_order", "chapter_001\n")
        self.write_md(project_id, "drafts/chapter_001.md", "# Chapter 001\n\n林秋在雨夜收到匿名短信。")
        self.write_json(project_id, "drafts/chapter_001.meta.json", {"chapter_id": "chapter_001", "title": "雨夜来信", "chapter_title": "雨夜来信", "chapter_status": "drafting", "volume_id": "volume_default", "order_index": 1, "chapter_summary": "", "scene_summaries": [], "open_questions": [], "canon_candidates": [], "pinned_techniques": [{"technique_id": "technique_001", "intensity": "high", "notes": "本章优先"}]})
        for rel in ["canon/facts.jsonl", "canon/issues.jsonl", "drafts/chapter_001.patch.jsonl", "sessions/session_001.jsonl"]:
            self._safe_path(project_id, rel).touch(exist_ok=True)
        self.write_json(project_id, "sessions/session_001.meta.json", {"id": "session_001", "undo_index": 0, "versions": [], "rolling_summary": "", "last_summarized_message_id": "", "messages": {}, "undo_stack": [], "redo_stack": []})
        style_text = "雨落在码头的铁皮棚上，像一串冷硬的算珠。林秋把风衣领口立起，没说话。她只看见光，和光后面的人影。"
        self.write_md(project_id, "assets/style_samples/style_sample_demo_001.txt", style_text)
        self.write_json(project_id, "meta/kb/kb_style/bm25.json", {"vocab": {}, "doc_freq": {}, "doc_len": {}, "avg_len": 0})
        self.write_json(project_id, "meta/kb/kb_docs/bm25.json", {"vocab": {}, "doc_freq": {}, "doc_len": {}, "avg_len": 0})
        self.write_json(project_id, "meta/kb/kb_manuscript/bm25.json", {"vocab": {}, "doc_freq": {}, "doc_len": {}, "avg_len": 0})
        self.write_json(project_id, "meta/kb/kb_world/bm25.json", {"vocab": {}, "doc_freq": {}, "doc_len": {}, "avg_len": 0})
        self.write_yaml(project_id, "cards/world_rule_001.yaml", {
            "id": "world_rule_001", "type": "world_rule", "title": "潮汐封港法", "tags": ["rule"], "links": [],
            "payload": {"rule": "风暴红色预警期间，临港城外港全面封锁。", "level": "hard"},
        })
        self.write_yaml(project_id, "cards/lore_001.yaml", {
            "id": "lore_001", "type": "lore", "title": "黑潮同盟", "tags": ["faction"], "links": [],
            "payload": {"summary": "控制临港城灰色航运网络的地下同盟。"},
        })
        self.append_jsonl(project_id, "canon/facts.jsonl", {
            "id": "fact_world_state_001",
            "scope": "world_state",
            "key": "harbor_lockdown",
            "value": "港区进入三级封锁，货运延迟。",
            "confidence": 0.9,
            "evidence": {"chapter_id": "chapter_001", "quote": "雨夜封港"},
            "sources": [{"path": "cards/world_rule_001.yaml"}],
        })
        sample_wiki = "<html><head><title>临港城</title></head><body><table class='infobox'><tr><th>别名</th><td>海雾之城</td></tr></table><h2>设定</h2><p>临港城由七个港区组成。</p></body></html>"
        self.write_md(project_id, "assets/wiki/wiki_demo_001.html", sample_wiki)
        self.write_json(project_id, "meta/wiki/wiki_demo_001.json", {
            "title": "临港城",
            "url": "",
            "infobox": {"别名": "海雾之城"},
            "sections": [{"h": "设定", "text": "临港城由七个港区组成。"}],
            "candidates": {"characters": [], "world": ["临港城"], "items": []},
        })


def apply_patch_ops(original: str, ops: list[dict[str, Any]]) -> tuple[str, str]:
    lines = original.splitlines()
    for op in ops:
        kind = op["op"]
        start = int(op.get("start", 0))
        end = int(op.get("end", start))
        value = op.get("value", "")
        if kind == "insert":
            lines[start:start] = value.splitlines()
        elif kind == "replace":
            lines[start:end] = value.splitlines()
        elif kind == "delete":
            del lines[start:end]
    updated = "\n".join(lines)
    diff = "\n".join(unified_diff(original.splitlines(), updated.splitlines(), fromfile="before", tofile="after", lineterm=""))
    return updated, diff
