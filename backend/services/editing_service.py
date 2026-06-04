from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any

from storage.fs_store import FSStore, apply_patch_ops


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


CHAPTER_REVIEW_STATUSES = {"pending_author_review", "accepted", "rejected", "superseded"}
PATCH_REVIEW_STATUSES = {"pending_author_review", "accepted", "rejected", "superseded"}


def _chapter_review_path(chapter_id: str) -> str:
    return f"meta/chapter_reviews/{chapter_id}.json"


def _patch_review_path(chapter_id: str) -> str:
    return f"meta/patch_reviews/{chapter_id}.json"


def _hash_content(content: str) -> str:
    return hashlib.sha1(content.encode("utf-8")).hexdigest()[:12]


def list_chapter_reviews(store: FSStore, project_id: str, chapter_id: str, status: str | None = None) -> list[dict[str, Any]]:
    rows = store.read_json(project_id, _chapter_review_path(chapter_id)) or []
    if not isinstance(rows, list):
        rows = []
    if status:
        rows = [row for row in rows if row.get("status") == status]
    return sorted(rows, key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)


def create_chapter_review(
    store: FSStore,
    project_id: str,
    chapter_id: str,
    content: str,
    *,
    job_id: str = "",
    source: str = "writer_agent",
    status: str = "pending_author_review",
) -> dict[str, Any]:
    if status not in CHAPTER_REVIEW_STATUSES:
        raise ValueError(f"Unsupported chapter review status: {status}")
    rows = list_chapter_reviews(store, project_id, chapter_id)
    for row in rows:
        if row.get("status") == "pending_author_review":
            row["status"] = "superseded"
            row["updated_at"] = now_iso()
            row["superseded_by_job_id"] = job_id
    review_id = f"review_{chapter_id}_{len(rows) + 1:04d}"
    rec = {
        "review_id": review_id,
        "chapter_id": chapter_id,
        "job_id": job_id,
        "source": source,
        "status": status,
        "content_hash": _hash_content(content),
        "preview": content[:320],
        "word_count": len(content),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "review_policy": "AI 草稿进入待审；作者确认、修改或拒绝后才视为作者确认稿。",
    }
    rows.append(rec)
    store.write_json(project_id, _chapter_review_path(chapter_id), rows)
    return rec


def update_chapter_review(store: FSStore, project_id: str, chapter_id: str, review_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    rows = list_chapter_reviews(store, project_id, chapter_id)
    if "status" in patch and patch["status"] not in CHAPTER_REVIEW_STATUSES:
        raise ValueError(f"Unsupported chapter review status: {patch['status']}")
    for row in rows:
        if row.get("review_id") != review_id:
            continue
        for key in ["status", "author_note"]:
            if key in patch:
                row[key] = patch[key]
        if row.get("status") in {"accepted", "rejected"}:
            row["confirmed_by"] = "author"
            row["confirmed_at"] = now_iso()
        row["updated_at"] = now_iso()
        store.write_json(project_id, _chapter_review_path(chapter_id), rows)
        return row
    raise FileNotFoundError(review_id)


def list_patch_reviews(store: FSStore, project_id: str, chapter_id: str, status: str | None = None) -> list[dict[str, Any]]:
    rows = store.read_json(project_id, _patch_review_path(chapter_id)) or []
    if not isinstance(rows, list):
        rows = []
    if status:
        rows = [row for row in rows if row.get("status") == status]
    return sorted(rows, key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)


def create_patch_review(
    store: FSStore,
    project_id: str,
    chapter_id: str,
    patch_id: str,
    ops: list[dict[str, Any]],
    *,
    job_id: str = "",
    source: str = "proofread_agent",
    selection_range: dict[str, Any] | None = None,
    provider: str = "",
    model: str = "",
    status: str = "pending_author_review",
) -> dict[str, Any]:
    if status not in PATCH_REVIEW_STATUSES:
        raise ValueError(f"Unsupported patch review status: {status}")
    rows = list_patch_reviews(store, project_id, chapter_id)
    for row in rows:
        if row.get("status") == "pending_author_review" and row.get("patch_id") == patch_id:
            row["status"] = "superseded"
            row["updated_at"] = now_iso()
            row["superseded_by_job_id"] = job_id
    norm = normalize_ops(ops)
    review_id = f"patch_review_{chapter_id}_{len(rows) + 1:04d}"
    preview = " / ".join([str(op.get("rationale") or op.get("after") or op.get("op_id"))[:80] for op in norm[:3]])
    rec = {
        "review_id": review_id,
        "patch_id": patch_id,
        "chapter_id": chapter_id,
        "job_id": job_id,
        "source": source,
        "status": status,
        "ops": norm,
        "op_count": len(norm),
        "selection_range": selection_range,
        "provider": provider,
        "model": model,
        "preview": preview,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "review_policy": "AI patch 默认待审；作者选择接受的 op 才能写入正文。",
    }
    rows.append(rec)
    store.write_json(project_id, _patch_review_path(chapter_id), rows)
    return rec


def update_patch_review(store: FSStore, project_id: str, chapter_id: str, review_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    rows = list_patch_reviews(store, project_id, chapter_id)
    if "status" in patch and patch["status"] not in PATCH_REVIEW_STATUSES:
        raise ValueError(f"Unsupported patch review status: {patch['status']}")
    if "accepted_op_ids" in patch and not (
        isinstance(patch["accepted_op_ids"], list) and all(isinstance(x, str) for x in patch["accepted_op_ids"])
    ):
        raise ValueError("accepted_op_ids must be a list of strings")
    for row in rows:
        if row.get("review_id") != review_id:
            continue
        for key in ["status", "accepted_op_ids", "rejected_op_ids", "author_note", "diff"]:
            if key in patch:
                row[key] = patch[key]
        if row.get("status") in {"accepted", "rejected"}:
            row["confirmed_by"] = "author"
            row["confirmed_at"] = now_iso()
        row["updated_at"] = now_iso()
        store.write_json(project_id, _patch_review_path(chapter_id), rows)
        return row
    raise FileNotFoundError(review_id)


def chapter_meta(store: FSStore, project_id: str, chapter_id: str) -> dict[str, Any]:
    meta = store.read_json(project_id, f'drafts/{chapter_id}.meta.json')
    meta.setdefault('versions', [])
    meta.setdefault('current_version', None)
    return meta


def save_snapshot(store: FSStore, project_id: str, chapter_id: str, content: str, reason: str, patch_id: str | None = None) -> dict[str, Any]:
    meta = chapter_meta(store, project_id, chapter_id)
    version_id = f"v{len(meta['versions']) + 1:04d}"
    store.write_md(project_id, f'drafts/versions/{chapter_id}/{version_id}.md', content)
    node = {'version_id': version_id, 'ts': now_iso(), 'reason': reason, 'patch_id': patch_id}
    meta['versions'].append(node)
    meta['current_version'] = version_id
    store.write_json(project_id, f'drafts/{chapter_id}.meta.json', meta)
    return node


def normalize_ops(patch_ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, op in enumerate(patch_ops):
        op_id = op.get('op_id', f'op_{i+1:03d}')
        op_type = op.get('type') or op.get('op', 'replace')
        tr = op.get('target_range', {})
        start = int(tr.get('start', op.get('start', 0)))
        end = int(tr.get('end', op.get('end', start)))
        before = op.get('before', '')
        after = op.get('after', op.get('value', ''))
        out.append({'op_id': op_id, 'type': op_type, 'target_range': {'start': start, 'end': end}, 'before': before, 'after': after, 'rationale': op.get('rationale', ''), 'raw': {'op': op_type, 'start': start, 'end': end, 'value': after}})
    return out


def apply_selected_patch(store: FSStore, project_id: str, chapter_id: str, patch_id: str | None, patch_ops: list[dict[str, Any]], accept_op_ids: list[str] | None = None) -> dict[str, Any]:
    original = store.read_md(project_id, f'drafts/{chapter_id}.md')
    norm = normalize_ops(patch_ops)
    accept = set(accept_op_ids or [o['op_id'] for o in norm])
    accepted = [o for o in norm if o['op_id'] in accept]
    rejected = [o for o in norm if o['op_id'] not in accept]
    save_snapshot(store, project_id, chapter_id, original, reason='before_apply_patch', patch_id=patch_id)
    updated, diff = apply_patch_ops(original, [o['raw'] for o in accepted])
    store.write_md(project_id, f'drafts/{chapter_id}.md', updated)
    rec = {'patch_id': patch_id, 'patch_ops': norm, 'accept_op_ids': list(accept), 'accepted_op_ids': [o['op_id'] for o in accepted], 'rejected_op_ids': [o['op_id'] for o in rejected], 'diff': diff}
    store.append_jsonl(project_id, f'drafts/{chapter_id}.patch.jsonl', rec)
    store.append_jsonl(project_id, 'sessions/session_001.jsonl', {'event': 'PATCH_APPLY_RESULT', 'data': {'chapter_id': chapter_id, 'accepted_op_ids': rec['accepted_op_ids'], 'rejected_op_ids': rec['rejected_op_ids']}})
    return {'content': updated, 'diff': diff, 'accepted_op_ids': rec['accepted_op_ids'], 'rejected_op_ids': rec['rejected_op_ids']}


def rollback_version(store: FSStore, project_id: str, chapter_id: str, version_id: str) -> dict[str, Any]:
    content = store.read_md(project_id, f'drafts/versions/{chapter_id}/{version_id}.md')
    if not content:
        raise FileNotFoundError(version_id)
    current = store.read_md(project_id, f'drafts/{chapter_id}.md')
    if current:
        save_snapshot(store, project_id, chapter_id, current, reason=f'rollback_backup:{version_id}')
    store.write_md(project_id, f'drafts/{chapter_id}.md', content)
    meta = chapter_meta(store, project_id, chapter_id)
    meta['current_version'] = version_id
    store.write_json(project_id, f'drafts/{chapter_id}.meta.json', meta)
    store.append_jsonl(project_id, 'sessions/session_001.jsonl', {'event': 'ROLLBACK', 'data': {'chapter_id': chapter_id, 'version_id': version_id}})
    return {'chapter_id': chapter_id, 'version_id': version_id, 'content': content}


def ensure_session_meta(store: FSStore, project_id: str, sid: str) -> dict[str, Any]:
    meta = store.read_json(project_id, f'sessions/{sid}.meta.json')
    meta.setdefault('messages', {})
    meta.setdefault('undo_stack', [])
    meta.setdefault('redo_stack', [])
    return meta


def add_message_version(store: FSStore, project_id: str, sid: str, message_id: str, content: str, meta_info: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = ensure_session_meta(store, project_id, sid)
    msg = meta['messages'].get(message_id, {'active_version': None, 'versions': []})
    version_id = f"mv{len(msg['versions']) + 1:04d}"
    msg['versions'].append({'version_id': version_id, 'ts': now_iso(), 'content': content, 'meta': meta_info or {}})
    prev = msg.get('active_version')
    msg['active_version'] = version_id
    meta['messages'][message_id] = msg
    meta['undo_stack'].append({'type': 'set_active_version', 'message_id': message_id, 'from': prev, 'to': version_id, 'ts': now_iso()})
    meta['redo_stack'] = []
    store.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    return {'message_id': message_id, 'active_version': version_id, 'versions': msg['versions']}


def activate_message_version(store: FSStore, project_id: str, sid: str, message_id: str, version_id: str) -> dict[str, Any]:
    meta = ensure_session_meta(store, project_id, sid)
    msg = meta['messages'][message_id]
    prev = msg.get('active_version')
    msg['active_version'] = version_id
    meta['messages'][message_id] = msg
    meta['undo_stack'].append({'type': 'set_active_version', 'message_id': message_id, 'from': prev, 'to': version_id, 'ts': now_iso()})
    meta['redo_stack'] = []
    store.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    return {'ok': True, 'message_id': message_id, 'active_version': version_id}


def undo(store: FSStore, project_id: str, sid: str) -> dict[str, Any]:
    meta = ensure_session_meta(store, project_id, sid)
    if not meta['undo_stack']:
        return {'ok': True, 'noop': True}
    op = meta['undo_stack'].pop()
    msg = meta['messages'].get(op['message_id'])
    if msg:
        msg['active_version'] = op.get('from')
        meta['messages'][op['message_id']] = msg
    meta['redo_stack'].append(op)
    store.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    return {'ok': True, 'op': op}


def redo(store: FSStore, project_id: str, sid: str) -> dict[str, Any]:
    meta = ensure_session_meta(store, project_id, sid)
    if not meta['redo_stack']:
        return {'ok': True, 'noop': True}
    op = meta['redo_stack'].pop()
    msg = meta['messages'].get(op['message_id'])
    if msg:
        msg['active_version'] = op.get('to')
        meta['messages'][op['message_id']] = msg
    meta['undo_stack'].append(op)
    store.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    return {'ok': True, 'op': op}
