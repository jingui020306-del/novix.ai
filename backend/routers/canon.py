from datetime import datetime, timezone
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException

from services.evidence_service import EvidenceService
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


def _fact_versions(s: FSStore, project_id: str) -> dict[str, str]:
    originals, revisions = {}, {}
    for row in s.read_jsonl(project_id, 'canon/facts.jsonl'):
        originals.setdefault(str(row.get('id', '')), []).append(row)
    for row in s.read_jsonl(project_id, 'canon/revisions.jsonl'):
        revisions.setdefault(str(row.get('target_fact_id', '')), []).append(row)
    return {identity: hashlib.sha256(json.dumps([rows, revisions.get(identity, [])], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            for identity, rows in originals.items()}


def _fact_revision(s: FSStore, project_id: str, fact_id: str) -> str:
    return _fact_versions(s, project_id).get(fact_id, '')


@router.get('/facts')
def facts(project_id: str, include_revisions: bool = False, s: FSStore = Depends(get_store)):
    if include_revisions:
        from services.change_suggestion_service import ChangeSuggestionService
        with ChangeSuggestionService(s).lock(project_id):
            versions = _fact_versions(s, project_id)
            return [{**row, '_revision': versions.get(str(row.get('_original', row).get('id', '')), '')} for row in _compose_facts_with_revisions(s, project_id)]
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
    verification = EvidenceService(s).verify_fact_evidence(project_id, body)
    next_body = {**body, 'evidence_verification': verification}
    if verification.get('support_level') == 'unsupported':
        next_body['confidence'] = min(float(next_body.get('confidence', 0.4) or 0.4), 0.2)
        next_body['status'] = next_body.get('status') or 'unverified'
    s.append_jsonl(project_id, 'canon/facts.jsonl', next_body)
    return {"ok": True, "evidence_verification": verification}


@router.post('/append-issue')
def append_issue(project_id: str, body: dict, s: FSStore = Depends(get_store)):
    if not body.get('evidence') or not body['evidence'].get('chapter_id'):
        raise HTTPException(status_code=400, detail='Missing evidence.chapter_id')
    verification = EvidenceService(s).verify_fact_evidence(project_id, body)
    s.append_jsonl(project_id, 'canon/issues.jsonl', {**body, 'evidence_verification': verification})
    return {"ok": True, "evidence_verification": verification}




@router.post('/facts/{fact_id}/revise')
def revise_fact(project_id: str, fact_id: str, body: dict, s: FSStore = Depends(get_store)):
    patch = body.get('patch')
    reason = str(body.get('reason', '')).strip()
    if not isinstance(patch, dict) or not patch:
        raise HTTPException(status_code=400, detail='请填写需要修订的事实字段。')
    if not reason:
        raise HTTPException(status_code=400, detail='请填写本次修订原因。')

    from services.change_suggestion_service import ChangeSuggestionService
    from services.incremental_memory_service import IncrementalMemoryService
    with ChangeSuggestionService(s).lock(project_id):
        if not any(str(row.get('id', '')) == fact_id for row in s.read_jsonl(project_id, 'canon/facts.jsonl')):
            raise HTTPException(status_code=404, detail='这条作品事实已不存在，请重新读取。')
        if body.get('base_revision') != _fact_revision(s, project_id, fact_id):
            raise HTTPException(status_code=409, detail='事实或它的修订记录已经更新，请重新读取后再修改。')
        if 'id' in patch and patch['id'] != fact_id:
            raise HTTPException(status_code=400, detail='事实编号保持不变，请只修订事实内容。')
        current = next(row for row in _compose_facts_with_revisions(s, project_id) if str(row.get('_original', row).get('id', '')) == fact_id)
        pending = current.get('status') in {'pending', 'planned', 'unverified'} or current.get('confirmation_status') in {'pending_author_review', 'pending'}
        if pending and (patch.get('status') == 'confirmed' or patch.get('confirmation_status') == 'confirmed'):
            verification = EvidenceService(s).verify_fact_evidence(project_id, _apply_patch(current, patch))
            if verification.get('support_level') != 'supported':
                raise HTTPException(400, '这条事实的依据尚不能在已保存正文中定位。请先修正事实内容和依据原句，再确认；没有依据的说法不能标成已核实事实。')
            patch = {**patch, 'evidence_verification': verification}
        rec = {'target_fact_id': fact_id, 'patch': patch, 'reason': reason,
               'ts': body.get('ts') or datetime.now(timezone.utc).isoformat()}
        try:
            s.append_jsonl(project_id, 'canon/revisions.jsonl', rec)
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        s.append_jsonl(project_id, 'sessions/session_001.jsonl', {'event': 'CANON_FACT_REVISED', 'data': {'fact_id': fact_id, 'reason': reason}})
        IncrementalMemoryService(s).mark(project_id, 'canon/revisions.jsonl')
        return {'ok': True, 'revision': rec, '_revision': _fact_revision(s, project_id, fact_id)}

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
