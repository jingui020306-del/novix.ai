from fastapi import APIRouter, Depends, WebSocket

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix='/api/projects/{project_id}/sessions')


@router.get('')
def list_sessions(project_id: str, s: FSStore = Depends(get_store)):
    sess = s._safe_path(project_id, 'sessions')
    return [f.stem for f in sess.glob('session_*.jsonl')]


@router.get('/{sid}')
def get_session(project_id: str, sid: str, s: FSStore = Depends(get_store)):
    return s.read_jsonl(project_id, f'sessions/{sid}.jsonl')


@router.put('/{sid}/meta')
def put_session_meta(project_id: str, sid: str, body: dict, s: FSStore = Depends(get_store)):
    s.write_json(project_id, f'sessions/{sid}.meta.json', body)
    return body


@router.websocket('/{sid}/stream')
async def stream_session(project_id: str, sid: str, websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"event": "noop", "project": project_id, "sid": sid})
    await websocket.close()
