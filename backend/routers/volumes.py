from fastapi import APIRouter, Depends, HTTPException

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix="/api/projects/{project_id}/volumes")


DEFAULT_VOLUME = {
    "id": "volume_default",
    "title": "默认卷",
    "summary": "未分卷章节",
    "order_index": 0,
    "chapter_ids": [],
}


def _volume_path(volume_id: str) -> str:
    return f"volumes/{volume_id}.json"


def _chapter_order(s: FSStore, project_id: str) -> list[str]:
    return [x for x in s.read_md(project_id, "drafts/.chapter_order").splitlines() if x.strip()]


def _chapter_meta(s: FSStore, project_id: str, chapter_id: str, index: int = 0) -> dict:
    meta = s.read_json(project_id, f"drafts/{chapter_id}.meta.json")
    meta.setdefault("chapter_id", chapter_id)
    meta.setdefault("title", meta.get("chapter_title") or chapter_id)
    meta.setdefault("chapter_title", meta.get("title") or chapter_id)
    meta.setdefault("chapter_status", "drafting")
    meta.setdefault("volume_id", "volume_default")
    meta.setdefault("order_index", index + 1)
    return meta


def _list_raw_volumes(s: FSStore, project_id: str) -> list[dict]:
    volumes_dir = s._safe_path(project_id, "volumes")
    rows = []
    if volumes_dir.exists():
        for f in volumes_dir.glob("*.json"):
            row = s.read_json(project_id, f"volumes/{f.name}")
            if row:
                rows.append(row)
    if not any(x.get("id") == "volume_default" for x in rows):
        rows.append(dict(DEFAULT_VOLUME))
    return rows


def _compose_volumes(s: FSStore, project_id: str) -> list[dict]:
    chapters = _chapter_order(s, project_id)
    chapter_rows = [_chapter_meta(s, project_id, ch, i) for i, ch in enumerate(chapters)]
    by_volume: dict[str, list[dict]] = {}
    for row in chapter_rows:
        by_volume.setdefault(row.get("volume_id") or "volume_default", []).append(row)

    out = []
    for volume in _list_raw_volumes(s, project_id):
        vid = volume.get("id") or "volume_default"
        rows = sorted(by_volume.pop(vid, []), key=lambda x: (x.get("order_index", 0), x.get("chapter_id", "")))
        next_volume = {
            **DEFAULT_VOLUME,
            **volume,
            "chapter_ids": volume.get("chapter_ids") or [x["chapter_id"] for x in rows],
            "chapters": rows,
        }
        out.append(next_volume)

    for vid, rows in by_volume.items():
        rows = sorted(rows, key=lambda x: (x.get("order_index", 0), x.get("chapter_id", "")))
        out.append({
            **DEFAULT_VOLUME,
            "id": vid,
            "title": vid,
            "chapter_ids": [x["chapter_id"] for x in rows],
            "chapters": rows,
        })

    return sorted(out, key=lambda x: (x.get("order_index", 0), x.get("id", "")))


@router.get("")
def list_volumes(project_id: str, s: FSStore = Depends(get_store)):
    return _compose_volumes(s, project_id)


@router.post("")
def create_volume(project_id: str, body: dict, s: FSStore = Depends(get_store)):
    volume_id = str(body.get("id") or "").strip()
    if not volume_id:
        raise HTTPException(status_code=400, detail="id required")
    volume = {
        "id": volume_id,
        "title": body.get("title") or volume_id,
        "summary": body.get("summary", ""),
        "order_index": int(body.get("order_index", 0)),
        "chapter_ids": body.get("chapter_ids", []),
    }
    s.write_json(project_id, _volume_path(volume_id), volume)
    return volume


@router.put("/{volume_id}")
def update_volume(project_id: str, volume_id: str, body: dict, s: FSStore = Depends(get_store)):
    current = s.read_json(project_id, _volume_path(volume_id)) or {"id": volume_id}
    next_volume = {
        **current,
        **body,
        "id": volume_id,
        "title": body.get("title") or current.get("title") or volume_id,
    }
    s.write_json(project_id, _volume_path(volume_id), next_volume)
    return next_volume


@router.delete("/{volume_id}")
def delete_volume(project_id: str, volume_id: str, s: FSStore = Depends(get_store)):
    if volume_id == "volume_default":
        raise HTTPException(status_code=400, detail="volume_default cannot be deleted")
    path = s._safe_path(project_id, _volume_path(volume_id))
    if path.exists():
        path.unlink()
    return {"deleted": True}
