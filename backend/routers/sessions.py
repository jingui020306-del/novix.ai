from datetime import datetime, timezone

from fastapi import APIRouter, Depends, WebSocket, HTTPException

from storage.fs_store import FSStore


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix='/api/projects/{project_id}/sessions')


def _meta(s: FSStore, project_id: str, sid: str) -> dict:
    meta = s.read_json(project_id, f'sessions/{sid}.meta.json')
    meta.setdefault('messages', {})
    meta.setdefault('undo_stack', [])
    meta.setdefault('redo_stack', [])
    return meta


@router.get('')
def list_sessions(project_id: str, s: FSStore = Depends(get_store)):
    sess = s._safe_path(project_id, 'sessions')
    return [f.stem for f in sess.glob('session_*.jsonl')]


@router.get('/{sid}')
def get_session(project_id: str, sid: str, s: FSStore = Depends(get_store)):
    return s.read_jsonl(project_id, f'sessions/{sid}.jsonl')


@router.get('/{sid}/meta')
def get_session_meta(project_id: str, sid: str, s: FSStore = Depends(get_store)):
    return _meta(s, project_id, sid)


@router.put('/{sid}/meta')
def put_session_meta(project_id: str, sid: str, body: dict, s: FSStore = Depends(get_store)):
    s.write_json(project_id, f'sessions/{sid}.meta.json', body)
    return body


@router.post('/{sid}/messages/{message_id}/versions')
def add_message_version(project_id: str, sid: str, message_id: str, body: dict, s: FSStore = Depends(get_store)):
    meta = _meta(s, project_id, sid)
    msg = meta['messages'].get(message_id, {'active_version': None, 'versions': []})
    version_id = f"mv{len(msg['versions']) + 1:04d}"
    msg['versions'].append({'version_id': version_id, 'ts': now_iso(), 'content': body.get('content', ''), 'meta': body.get('meta', {})})
    prev = msg.get('active_version')
    msg['active_version'] = version_id
    meta['messages'][message_id] = msg
    meta['undo_stack'].append({'type': 'set_active_version', 'message_id': message_id, 'from': prev, 'to': version_id, 'ts': now_iso()})
    meta['redo_stack'] = []
    s.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    s.append_jsonl(project_id, f'sessions/{sid}.jsonl', {'event': 'MESSAGE_VERSION_ADD', 'data': {'message_id': message_id, 'version_id': version_id}})
    return {'message_id': message_id, 'active_version': version_id, 'versions': msg['versions']}


@router.post('/{sid}/messages/{message_id}/activate')
def activate_message_version(project_id: str, sid: str, message_id: str, body: dict, s: FSStore = Depends(get_store)):
    meta = _meta(s, project_id, sid)
    msg = meta['messages'].get(message_id)
    if not msg:
        raise HTTPException(status_code=404, detail='message not found')
    version_id = body.get('version_id')
    if version_id not in [v['version_id'] for v in msg.get('versions', [])]:
        raise HTTPException(status_code=404, detail='version not found')
    prev = msg.get('active_version')
    msg['active_version'] = version_id
    meta['messages'][message_id] = msg
    meta['undo_stack'].append({'type': 'set_active_version', 'message_id': message_id, 'from': prev, 'to': version_id, 'ts': now_iso()})
    meta['redo_stack'] = []
    s.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    s.append_jsonl(project_id, f'sessions/{sid}.jsonl', {'event': 'MESSAGE_VERSION_ACTIVATE', 'data': {'message_id': message_id, 'version_id': version_id}})
    return {'ok': True, 'message_id': message_id, 'active_version': version_id}


@router.post('/{sid}/undo')
def undo(project_id: str, sid: str, s: FSStore = Depends(get_store)):
    meta = _meta(s, project_id, sid)
    if not meta['undo_stack']:
        return {'ok': True, 'noop': True}
    op = meta['undo_stack'].pop()
    msg = meta['messages'].get(op['message_id'])
    if msg:
        msg['active_version'] = op.get('from')
        meta['messages'][op['message_id']] = msg
    meta['redo_stack'].append(op)
    s.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    s.append_jsonl(project_id, f'sessions/{sid}.jsonl', {'event': 'UNDO', 'data': op})
    return {'ok': True, 'op': op}


@router.post('/{sid}/redo')
def redo(project_id: str, sid: str, s: FSStore = Depends(get_store)):
    meta = _meta(s, project_id, sid)
    if not meta['redo_stack']:
        return {'ok': True, 'noop': True}
    op = meta['redo_stack'].pop()
    msg = meta['messages'].get(op['message_id'])
    if msg:
        msg['active_version'] = op.get('to')
        meta['messages'][op['message_id']] = msg
    meta['undo_stack'].append(op)
    s.write_json(project_id, f'sessions/{sid}.meta.json', meta)
    s.append_jsonl(project_id, f'sessions/{sid}.jsonl', {'event': 'REDO', 'data': op})
    return {'ok': True, 'op': op}


@router.websocket('/{sid}/stream')
async def stream_session(project_id: str, sid: str, websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"event": "noop", "project": project_id, "sid": sid})
    await websocket.close()
