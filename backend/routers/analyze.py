from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from services.canon_extractor_service import CanonExtractorService
from services.summary_service import make_summaries
from storage.fs_store import FSStore


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_store() -> FSStore:
    from main import store

    return store


def get_canon_extractor() -> CanonExtractorService:
    from main import job_manager

    return job_manager.canon_extractor


router = APIRouter(prefix='/api/projects/{project_id}', tags=['analyze'])


def _heuristic_proposals(chapter_id: str, chapter_text: str) -> list[dict]:
    rows = []
    words = [w for w in chapter_text.replace('\n', ' ').split(' ') if len(w.strip()) >= 2]
    uniq = []
    seen = set()
    for w in words:
        k = w.strip('，。！？,.!?:;；')
        if len(k) < 2 or k in seen:
            continue
        seen.add(k)
        uniq.append(k)
        if len(uniq) >= 6:
            break
    for token in uniq:
        rows.append({
            'proposal_id': f"proposal_{uuid.uuid4().hex[:10]}",
            'status': 'pending',
            'entity_type': 'concept',
            'name': token,
            'confidence': 0.35,
            'evidence': {'chapter_id': chapter_id, 'quote': token},
            'source': 'analyze_heuristic',
            'ts': now_iso(),
        })
    return rows


@router.post('/analyze/{chapter_id}')
async def analyze_chapter(
    project_id: str,
    chapter_id: str,
    body: dict | None = None,
    s: FSStore = Depends(get_store),
    extractor: CanonExtractorService = Depends(get_canon_extractor),
):
    body = body or {}
    chapter_text = s.read_md(project_id, f'drafts/{chapter_id}.md')
    if not chapter_text:
        raise HTTPException(status_code=404, detail='chapter not found')

    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {
        'event': 'ANALYZE_TRIGGERED',
        'data': {'chapter_id': chapter_id, 'reason': body.get('reason', 'manual')},
    })

    summary = make_summaries(chapter_id, chapter_text)
    chapter_meta = s.read_json(project_id, f'drafts/{chapter_id}.meta.json')
    extraction = await extractor.extract(chapter_id, chapter_text, {
        'scene_index': body.get('scene_index', 0),
        'beats': body.get('beats', []),
        'cast': body.get('cast', []),
        'world_context': chapter_meta.get('world_context') or {},
    }, {'provider': 'mock', 'model': 'mock-writer-v1', 'stream': True})

    from services.change_suggestion_service import ChangeSuggestionService
    with ChangeSuggestionService(s).lock(project_id):
        if s.read_md(project_id, f'drafts/{chapter_id}.md') != chapter_text:
            raise HTTPException(409, '整理期间正文已有新编辑，旧结果未写入，请重新核对。')
        coverage = extraction.get('extraction_coverage', {})
        chapter_meta = s.read_json(project_id, f'drafts/{chapter_id}.meta.json')
        chapter_meta.update(summary, canon_extraction_coverage=coverage)
        s.write_json(project_id, f'drafts/{chapter_id}.meta.json', chapter_meta)
        s.write_md(project_id, f'meta/summaries/{chapter_id}.summary.md', summary.get('chapter_summary', ''))
        s.write_json(project_id, f'meta/summaries/{chapter_id}.scene_summaries.json', summary.get('scene_summaries', []))

        new_facts = extraction.get('facts', []) if isinstance(extraction, dict) else []
        new_props = extraction.get('new_entity_proposals', []) if isinstance(extraction, dict) else []
        heuristics = _heuristic_proposals(chapter_id, chapter_text)
        existing_facts = {row.get('id') for row in s.read_jsonl(project_id, 'canon/facts.jsonl')}
        new_facts = [fact for fact in new_facts if fact.get('id') not in existing_facts]
        existing_proposals = {(row.get('entity_type'), row.get('name'), (row.get('evidence') or {}).get('chapter_id')) for row in s.read_jsonl(project_id, 'canon/proposals.jsonl')}
        proposals = []
        for proposal in [*new_props, *heuristics]:
            key = (proposal.get('entity_type'), proposal.get('name'), (proposal.get('evidence') or {}).get('chapter_id'))
            if key not in existing_proposals:
                existing_proposals.add(key)
                proposals.append(proposal)

        for fact in new_facts:
            s.append_jsonl(project_id, 'canon/facts.jsonl', fact)
        for p in proposals:
            s.append_jsonl(project_id, 'canon/proposals.jsonl', p)

    result = {
        'chapter_id': chapter_id,
        'new_facts_count': len(new_facts),
        'new_proposals_count': len(proposals),
        'extraction_coverage': coverage,
        'summary': {
            'chapter_summary': summary.get('chapter_summary', ''),
            'scene_count': len(summary.get('scene_summaries', [])),
        },
    }
    s.append_jsonl(project_id, 'sessions/session_001.jsonl', {'event': 'ANALYZE_RESULT', 'data': result})
    return result
