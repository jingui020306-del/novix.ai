from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix='/api/projects/{project_id}/canon')


def _apply_patch(base: dict, patch: dict) -> dict:
    out = dict(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            merged = dict(out.get(k) or {})
            merged.update(v)
            out[k] = merged
        else:
            out[k] = v
    return out


def _compose_facts_with_revisions(s: FSStore, project_id: str) -> list[dict]:
    rows = s.read_jsonl(project_id, 'canon/facts.jsonl')
    revs = s.read_jsonl(project_id, 'canon/revisions.jsonl')
    rev_map: dict[str, list[dict]] = {}
    for r in revs:
        tid = str(r.get('target_fact_id', ''))
        if not tid:
            continue
        rev_map.setdefault(tid, []).append(r)

    out = []
    for f in rows:
        fid = str(f.get('id', ''))
        if not fid:
            out.append(f)
            continue
        chain = rev_map.get(fid, [])
        current = dict(f)
        for r in chain:
            current = _apply_patch(current, r.get('patch', {}))
        if chain:
            current['_original'] = f
            current['_revised'] = True
            current['_revisions'] = chain
        out.append(current)
    return out


@router.get('/facts')
def facts(project_id: str, include_revisions: bool = False, s: FSStore = Depends(get_store)):
    if include_revisions:
        return _compose_facts_with_revisions(s, project_id)
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




@router.post('/facts/{fact_id}/revise')
def revise_fact(project_id: str, fact_id: str, body: dict, s: FSStore = Depends(get_store)):
    patch = body.get('patch')
    reason = str(body.get('reason', '')).strip()
    if not isinstance(patch, dict) or not patch:
        raise HTTPException(status_code=400, detail='patch(dict) required')
    if not reason:
        raise HTTPException(status_code=400, detail='reason required')

    facts_rows = s.read_jsonl(project_id, 'canon/facts.jsonl')
    if not any(str(x.get('id', '')) == fact_id for x in facts_rows):
        raise HTTPException(status_code=404, detail='fact not found')

    rec = {
        'target_fact_id': fact_id,
        'patch': patch,
        'reason': reason,
        'ts': body.get('ts') or datetime.now(timezone.utc).isoformat(),
    }
    s.append_jsonl(project_id, 'canon/revisions.jsonl', rec)
    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {'event': 'CANON_FACT_REVISED', 'data': {'fact_id': fact_id, 'reason': reason}})
    return {'ok': True, 'revision': rec}

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
