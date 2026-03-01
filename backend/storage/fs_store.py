from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path
from typing import Any


WENSHAPE_SUBDIRS = ["cards", "canon", "drafts", "sessions"]
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
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class FSStore:
    data_dir: Path

    def __post_init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _project_dir(self, project_id: str) -> Path:
        base = self.data_dir.resolve()
        target = (base / project_id).resolve()
        if not str(target).startswith(str(base)):
            raise ValueError("Invalid project path")
        return target

    def _safe_path(self, project_id: str, *parts: str) -> Path:
        pdir = self._project_dir(project_id)
        target = (pdir.joinpath(*parts)).resolve()
        if not str(target).startswith(str(pdir)):
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
        return json.loads(text)

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
                rows.append(json.loads((p / "project.yaml").read_text(encoding="utf-8")))
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
        for i in range(1, 21):
            cid = categories[(i - 1) % len(categories)][0]
            self.write_yaml(project_id, f"cards/technique_{i:03d}.yaml", {
                "id": f"technique_{i:03d}", "type": "technique", "title": f"示例技法{i:03d}", "tags": ["technique"], "links": [cid],
                "payload": {
                    "name": f"示例技法{i:03d}", "category_id": cid, "aliases": [], "description": "用于示例与测试",
                    "apply_steps": ["定义目标", "应用句法", "收束回看"],
                    "signals": ["出现显性语言信号", "段落节奏可观察"],
                    "intensity_levels": {"low": "点缀", "med": "贯穿", "high": "主导"},
                    "metrics": {"dialogue_ratio_range": [0.2, 0.6], "punctuation_caps": 6, "metaphor_density": 0.06},
                    "do_dont": {"do": ["服务目标"], "dont": ["过度堆叠"]},
                    "examples": ["示例：改写一句动作描述"],
                },
            })
        self.write_json(project_id, "cards/blueprint_001.json", {
            "id": "blueprint_001", "story_type_id": "longform_novel", "title": "第一章蓝图", "signals": ["@@BEAT:N@@", "@@NEXT_SCENE@@"],
            "scene_plan": [{"scene_id": "scene_1", "phase": "setup", "purpose": "引入线索", "situation": "雨夜收到匿名短信", "choice_points": ["是否赴约"], "cast": ["character_001"], "beats": ["beat_1"]}]
        })
        self.write_md(project_id, "drafts/.chapter_order", "chapter_001\n")
        self.write_md(project_id, "drafts/chapter_001.md", "# Chapter 001\n\n林秋在雨夜收到匿名短信。")
        self.write_json(project_id, "drafts/chapter_001.meta.json", {"chapter_id": "chapter_001", "title": "雨夜来信", "chapter_summary": "", "scene_summaries": [], "open_questions": [], "canon_candidates": [], "pinned_techniques": [{"technique_id": "technique_001", "intensity": "high", "notes": "本章优先"}]})
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
