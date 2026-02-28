# Phase 2 Plan

## Preconditions check
- Root `AGENTS.md` keeps immutable WenShape root layout (`project.yaml`, `cards/`, `canon/`, `drafts/`, `sessions/`).
- Phase-1 mock loop exists and is extended in this phase rather than replaced.

## New backend files/services
- `backend/services/kb_service.py`
  - uploads sanitize/chunk/index/query/reindex.
- `backend/services/style_service.py`
  - fast style-profile extraction and style-guide generation.
- `backend/services/context_engine.py`
  - deterministic context packing + token budget fallback + manifest.
- `backend/services/summary_service.py`
  - chapter/scene summaries + canon candidates/open questions.

## Updated routes
- `POST /api/projects/{id}/uploads`
- `POST /api/projects/{id}/kb/reindex`
- `POST /api/projects/{id}/kb/query`
- `POST /api/projects/{id}/style/analyze`
- Existing `/jobs/write` pipeline upgraded to include KB/context compression/summaries.

## Data format additions
- `data/{project_id}/assets/style_samples/*.txt`
- `data/{project_id}/assets/docs/*.txt`
- `data/{project_id}/meta/kb/kb_style/{chunks.jsonl,bm25.json}`
- `data/{project_id}/meta/kb/kb_docs/{chunks.jsonl,bm25.json}`
- `data/{project_id}/meta/summaries/*`
- `drafts/chapter_xxx.meta.json` gains `chapter_summary`, `scene_summaries`, `open_questions`, `canon_candidates`.

## Acceptance points
1. style sample upload -> assets saved + sanitized chunks indexed.
2. kb reindex/query works and returns traceable chunks.
3. style analyze updates `cards/style_*.yaml` style_guide and writes profile.
4. write job manifest includes style_guide and (if available) style examples.
5. tiny token budget triggers dropped items + compression steps in manifest.
6. merge creates chapter summary metadata and appends summary facts to canon jsonl.
