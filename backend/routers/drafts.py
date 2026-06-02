from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from services.kb_service import KBService
from storage.fs_store import FSStore, apply_patch_ops


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_store() -> FSStore:
    from main import store

    return store


def get_kb() -> KBService:
    from main import kb_service

    return kb_service


router = APIRouter(prefix='/api/projects/{project_id}/drafts')


def _chapter_meta(s: FSStore, project_id: str, chapter_id: str) -> dict:
    meta = s.read_json(project_id, f'drafts/{chapter_id}.meta.json')
    meta.setdefault('chapter_id', chapter_id)
    meta.setdefault('title', meta.get('chapter_title') or chapter_id)
    meta.setdefault('chapter_title', meta.get('title') or chapter_id)
    meta.setdefault('chapter_status', 'drafting')
    meta.setdefault('volume_id', 'volume_default')
    meta.setdefault('order_index', 0)
    meta.setdefault('versions', [])
    meta.setdefault('current_version', None)
    return meta


def _chapter_order(s: FSStore, project_id: str) -> list[str]:
    return [c for c in s.read_md(project_id, 'drafts/.chapter_order').splitlines() if c.strip()]


def _write_chapter_order(s: FSStore, project_id: str, chapter_ids: list[str]) -> None:
    s.write_md(project_id, 'drafts/.chapter_order', "\n".join(chapter_ids) + ("\n" if chapter_ids else ""))


def _save_snapshot(s: FSStore, project_id: str, chapter_id: str, content: str, reason: str, patch_id: str | None = None) -> dict:
    meta = _chapter_meta(s, project_id, chapter_id)
    version_id = f"v{len(meta['versions']) + 1:04d}"
    rel = f"drafts/versions/{chapter_id}/{version_id}.md"
    s.write_md(project_id, rel, content)
    node = {"version_id": version_id, "ts": now_iso(), "reason": reason, "patch_id": patch_id}
    meta['versions'].append(node)
    meta['current_version'] = version_id
    s.write_json(project_id, f'drafts/{chapter_id}.meta.json', meta)
    return node




def _validate_selection_bounds(ops: list[dict], selection_range: dict | None) -> None:
    if not isinstance(selection_range, dict):
        return
    try:
        sel_start = int(selection_range.get('start', 0))
        sel_end = int(selection_range.get('end', 0))
    except Exception:
        raise HTTPException(status_code=400, detail='invalid selection_range')
    if sel_start < 1 or sel_end < sel_start:
        raise HTTPException(status_code=400, detail='invalid selection_range')
    for op in ops:
        tr = op.get('target_range', {})
        start = int(tr.get('start', 0))
        end = int(tr.get('end', start))
        if start < sel_start or end > sel_end:
            raise HTTPException(status_code=400, detail=f"op {op.get('op_id')} out of selection_range")

def _normalize_ops(patch_ops: list[dict]) -> list[dict]:
    out = []
    for i, op in enumerate(patch_ops):
        op_id = op.get('op_id', f'op_{i+1:03d}')
        op_type = op.get('type') or op.get('op', 'replace')
        tr = op.get('target_range', {})
        start = int(tr.get('start', op.get('start', 0)))
        end = int(tr.get('end', op.get('end', start)))
        before = op.get('before', '')
        after = op.get('after', op.get('value', ''))
        out.append({
            'op_id': op_id,
            'type': op_type,
            'target_range': {'start': start, 'end': end},
            'before': before,
            'after': after,
            'rationale': op.get('rationale', ''),
            'raw': {'op': op_type, 'start': start, 'end': end, 'value': after},
        })
    return out


@router.get('')
def list_drafts(project_id: str, s: FSStore = Depends(get_store)):
    return _chapter_order(s, project_id)


@router.get('/details')
def list_draft_details(project_id: str, s: FSStore = Depends(get_store)):
    rows = []
    for i, chapter_id in enumerate(_chapter_order(s, project_id)):
        meta = _chapter_meta(s, project_id, chapter_id)
        if not meta.get('order_index'):
            meta['order_index'] = i + 1
        rows.append({
            "chapter_id": chapter_id,
            "title": meta.get("title") or meta.get("chapter_title") or chapter_id,
            "chapter_title": meta.get("chapter_title") or meta.get("title") or chapter_id,
            "chapter_status": meta.get("chapter_status", "drafting"),
            "volume_id": meta.get("volume_id", "volume_default"),
            "order_index": meta.get("order_index", i + 1),
            "chapter_summary": meta.get("chapter_summary", ""),
            "word_count": len(s.read_md(project_id, f'drafts/{chapter_id}.md')),
        })
    return rows


@router.get('/{chapter_id}')
def get_draft(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    return {"chapter_id": chapter_id, "content": s.read_md(project_id, f'drafts/{chapter_id}.md'), "meta": _chapter_meta(s, project_id, chapter_id)}


@router.get('/{chapter_id}/lines')
def get_lines(project_id: str, chapter_id: str, start: int = 1, end: int = 20, s: FSStore = Depends(get_store)):
    lines = s.read_md(project_id, f'drafts/{chapter_id}.md').splitlines()
    seg = lines[max(0, start - 1): max(start - 1, end)]
    return {"chapter_id": chapter_id, "start": start, "end": end, "lines": seg}


@router.put('/{chapter_id}')
def put_draft(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store), kb: KBService = Depends(get_kb)):
    old = s.read_md(project_id, f'drafts/{chapter_id}.md')
    if old:
        _save_snapshot(s, project_id, chapter_id, old, reason='manual_save')
    s.write_md(project_id, f'drafts/{chapter_id}.md', body.get('content', ''))
    order = _chapter_order(s, project_id)
    if chapter_id not in order:
        order.append(chapter_id)
        _write_chapter_order(s, project_id, order)
    meta = _chapter_meta(s, project_id, chapter_id)
    for key in ['title', 'chapter_title', 'chapter_status', 'volume_id', 'order_index']:
        if key in body:
            meta[key] = body[key]
    if 'title' in body and 'chapter_title' not in body:
        meta['chapter_title'] = body['title']
    if 'chapter_title' in body and 'title' not in body:
        meta['title'] = body['chapter_title']
    if not meta.get('order_index'):
        meta['order_index'] = len(order)
    s.write_json(project_id, f'drafts/{chapter_id}.meta.json', meta)
    kb.reindex_manuscript_chapter(project_id, chapter_id)
    return {"ok": True, "meta": meta}


@router.get('/{chapter_id}/versions')
def get_versions(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    meta = _chapter_meta(s, project_id, chapter_id)
    return {"chapter_id": chapter_id, "current_version": meta.get('current_version'), "versions": meta.get('versions', [])}


@router.post('/{chapter_id}/rollback')
def rollback(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store), kb: KBService = Depends(get_kb)):
    version_id = body.get('version_id')
    if not version_id:
        raise HTTPException(status_code=400, detail='version_id required')
    content = s.read_md(project_id, f'drafts/versions/{chapter_id}/{version_id}.md')
    if not content:
        raise HTTPException(status_code=404, detail='version not found')
    current = s.read_md(project_id, f'drafts/{chapter_id}.md')
    if current:
        _save_snapshot(s, project_id, chapter_id, current, reason=f'rollback_backup:{version_id}')
    s.write_md(project_id, f'drafts/{chapter_id}.md', content)
    meta = _chapter_meta(s, project_id, chapter_id)
    meta['current_version'] = version_id
    s.write_json(project_id, f'drafts/{chapter_id}.meta.json', meta)
    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {"event": "ROLLBACK", "data": {"chapter_id": chapter_id, "version_id": version_id}})
    kb.reindex_manuscript_chapter(project_id, chapter_id)
    return {"chapter_id": chapter_id, "version_id": version_id, "content": content}


@router.get('/{chapter_id}/meta')
def get_meta(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    return s.read_json(project_id, f'drafts/{chapter_id}.meta.json')


@router.put('/{chapter_id}/meta')
def put_meta(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store)):
    s.write_json(project_id, f'drafts/{chapter_id}.meta.json', body)
    return body


@router.post('/{chapter_id}/apply-patch')
def apply_patch(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store), kb: KBService = Depends(get_kb)):
    original = s.read_md(project_id, f'drafts/{chapter_id}.md')
    patch_ops = body.get('patch_ops', body.get('ops', []))
    norm = _normalize_ops(patch_ops)
    accept_ids = set(body.get('accept_op_ids', [o['op_id'] for o in norm]))
    accepted = [o for o in norm if o['op_id'] in accept_ids]
    rejected = [o for o in norm if o['op_id'] not in accept_ids]

    _validate_selection_bounds(accepted, body.get('selection_range'))

    _save_snapshot(s, project_id, chapter_id, original, reason='before_apply_patch', patch_id=body.get('patch_id'))
    apply_ops = [o['raw'] for o in accepted]
    updated, diff = apply_patch_ops(original, apply_ops)
    s.write_md(project_id, f'drafts/{chapter_id}.md', updated)

    rec = {
        'patch_id': body.get('patch_id'),
        'patch_ops': norm,
        'accept_op_ids': list(accept_ids),
        'accepted_op_ids': [o['op_id'] for o in accepted],
        'rejected_op_ids': [o['op_id'] for o in rejected],
        'diff': diff,
    }
    s.append_jsonl(project_id, f'drafts/{chapter_id}.patch.jsonl', rec)
    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {"event": "PATCH_APPLY_RESULT", "data": {"chapter_id": chapter_id, "accepted_op_ids": rec['accepted_op_ids'], "rejected_op_ids": rec['rejected_op_ids']}})
    kb.reindex_manuscript_chapter(project_id, chapter_id)
    return {"content": updated, "diff": diff, "accepted_op_ids": rec['accepted_op_ids'], "rejected_op_ids": rec['rejected_op_ids']}
