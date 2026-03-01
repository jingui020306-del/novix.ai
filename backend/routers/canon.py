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


@router.get('/proposals')
def proposals(project_id: str, s: FSStore = Depends(get_store)):
    return s.read_jsonl(project_id, 'canon/proposals.jsonl')


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


@router.post('/proposals/{proposal_id}/accept')
def accept_proposal(project_id: str, proposal_id: str, body: dict | None = None, s: FSStore = Depends(get_store)):
    rows = s.read_jsonl(project_id, 'canon/proposals.jsonl')
    matched = next((r for r in reversed(rows) if r.get('proposal_id') == proposal_id and r.get('status', 'pending') == 'pending'), None)
    if not matched:
        raise HTTPException(status_code=404, detail='proposal not found')
    entity_type = matched.get('entity_type', 'lore')
    name = matched.get('name', proposal_id)
    card_id = f"{entity_type}_{proposal_id[-4:]}"
    ctype = 'world' if entity_type in {'location', 'faction', 'item', 'lore'} else 'character'
    s.write_yaml(project_id, f"cards/{card_id}.yaml", {"id": card_id, "type": ctype, "title": name, "tags": [entity_type], "links": [], "payload": {"name": name, "source": matched.get('source')}})
    s.append_jsonl(project_id, 'canon/proposals.jsonl', {"proposal_id": proposal_id, "status": 'accepted', "card_id": card_id, "event": 'PROPOSAL_ACCEPTED'})
    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {"event": 'PROPOSAL_ACCEPTED', "data": {"proposal_id": proposal_id, "card_id": card_id}})
    return {"ok": True, "card_id": card_id}


@router.post('/proposals/{proposal_id}/reject')
def reject_proposal(project_id: str, proposal_id: str, s: FSStore = Depends(get_store)):
    s.append_jsonl(project_id, 'canon/proposals.jsonl', {"proposal_id": proposal_id, "status": 'rejected', "event": 'PROPOSAL_REJECTED'})
    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {"event": 'PROPOSAL_REJECTED', "data": {"proposal_id": proposal_id}})
    return {"ok": True}
