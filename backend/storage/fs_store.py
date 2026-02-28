from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

try:
    from filelock import FileLock  # type: ignore
except Exception:
    class FileLock:  # fallback no-op lock
        def __init__(self, *_args, **_kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            return False

WENSHAPE_SUBDIRS = ["cards", "canon", "drafts", "sessions"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dump_yaml_like(data: Any) -> str:
    if yaml:
        return yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    return json.dumps(data, ensure_ascii=False, indent=2)


def _load_yaml_like(text: str) -> Any:
    if not text.strip():
        return {}
    if yaml:
        return yaml.safe_load(text) or {}
    return json.loads(text)


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
        for s in WENSHAPE_SUBDIRS:
            (pdir / s).mkdir(exist_ok=True)
        self.write_yaml(project_id, "project.yaml", {"id": project_id, "title": title, "created_at": now_iso()})
        return pdir

    def read_yaml(self, project_id: str, rel: str) -> dict[str, Any]:
        path = self._safe_path(project_id, rel)
        if not path.exists():
            return {}
        return _load_yaml_like(path.read_text(encoding="utf-8"))

    def write_yaml(self, project_id: str, rel: str, data: dict[str, Any]) -> None:
        path = self._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_dump_yaml_like(data), encoding="utf-8")

    def read_json(self, project_id: str, rel: str) -> dict[str, Any]:
        path = self._safe_path(project_id, rel)
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

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
        return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]

    def append_jsonl(self, project_id: str, rel: str, item: dict[str, Any]) -> None:
        path = self._safe_path(project_id, rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        with FileLock(str(path) + ".lock"):
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({**item, "ts": item.get("ts", now_iso())}, ensure_ascii=False) + "\n")

    def list_projects(self) -> list[dict[str, Any]]:
        out = []
        for p in self.data_dir.iterdir():
            if p.is_dir() and (p / "project.yaml").exists():
                out.append(_load_yaml_like((p / "project.yaml").read_text(encoding="utf-8")))
        return sorted(out, key=lambda x: x.get("id", ""))

    def init_demo_project(self, project_id: str = "demo_project_001") -> None:
        self.ensure_project(project_id, "Demo Novel Project")
        cards = {
            "character_001.yaml": {"id":"character_001","type":"character","title":"林秋","tags":["protagonist"],"links":["worldview_001","outline_001"],"payload":{"name":"林秋","identity":"调查记者","appearance":"短发、灰色风衣、左手虎口有旧伤","core_motivation":"查明父亲死亡真相","personality_traits":["冷静","执拗","共情力强"],"family_background":"单亲家庭，母亲长期卧病","voice":"克制、观察细腻、偶有尖锐讽刺","boundaries":["不伤及无辜","拒绝伪造证据"],"relationships":[{"target":"character_002","type":"mentor","status":"疏远"}],"arc":[{"beat":"beat_1","goal":"从逃避真相转向主动追索"}]}}
            ,"worldview_001.yaml":{"id":"worldview_001","type":"world","title":"临港城","tags":[],"links":[],"payload":{"era":"近未来","setting":"沿海巨型都市"}}
            ,"style_001.yaml":{"id":"style_001","type":"style","title":"冷峻现实","tags":[],"links":[],"payload":{"tone":"冷峻","rules":["短句为主","场景先行"]}}
            ,"outline_001.yaml":{"id":"outline_001","type":"outline","title":"第一卷提纲","tags":[],"links":["character_001"],"payload":{"beats":[{"id":"beat_1","summary":"匿名线索出现"}]}}
        }
        for name, content in cards.items():
            self.write_yaml(project_id, f"cards/{name}", content)
        self.write_json(project_id, "cards/blueprint_001.json", {"id":"blueprint_001","story_type_id":"longform_novel","title":"第一章蓝图","scene_plan":[{"scene_id":"scene_1","phase":"setup","purpose":"引入线索","situation":"雨夜收到匿名短信","choice_points":["是否立即赴约"],"cast":["character_001"],"beats":["beat_1"]}]})
        self.write_md(project_id, "drafts/chapter_001.md", "# Chapter 001\n\n林秋在雨夜收到一条匿名短信。")
        self.write_json(project_id, "drafts/chapter_001.meta.json", {"chapter_id": "chapter_001", "title": "雨夜来信"})
        self.write_md(project_id, "drafts/.chapter_order", "chapter_001\n")
        for rel in ["canon/facts.jsonl", "canon/issues.jsonl", "drafts/chapter_001.patch.jsonl", "sessions/session_001.jsonl"]:
            self._safe_path(project_id, rel).touch(exist_ok=True)
        self.write_json(project_id, "sessions/session_001.meta.json", {"id":"session_001","undo_index":0,"versions":[]})


def apply_patch_ops(original: str, ops: list[dict[str, Any]]) -> tuple[str, str]:
    lines = original.splitlines()
    for op in ops:
        kind = op["op"]
        start, end = int(op.get("start", 0)), int(op.get("end", start))
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
