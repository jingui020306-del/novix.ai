from fastapi import APIRouter, Depends, HTTPException

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix='/api/projects/{project_id}/canon')


@router.get('/facts')
def facts(project_id: str, s: FSStore = Depends(get_store)):
    return s.read_jsonl(project_id, 'canon/facts.jsonl')


@router.get('/issues')
def issues(project_id: str, s: FSStore = Depends(get_store)):
    return s.read_jsonl(project_id, 'canon/issues.jsonl')


@router.post('/append-fact')
def append_fact(project_id: str, body: dict, s: FSStore = Depends(get_store)):
    if not body.get('evidence') or not body['evidence'].get('chapter_id'):
        raise HTTPException(status_code=400, detail='Missing evidence.chapter_id')
    s.append_jsonl(project_id, 'canon/facts.jsonl', body)
    return {"ok": True}


@router.post('/append-issue')
def append_issue(project_id: str, body: dict, s: FSStore = Depends(get_store)):
    if not body.get('evidence') or not body['evidence'].get('chapter_id'):
        raise HTTPException(status_code=400, detail='Missing evidence.chapter_id')
    s.append_jsonl(project_id, 'canon/issues.jsonl', body)
    return {"ok": True}
