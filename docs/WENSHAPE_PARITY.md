# WenShape README Parity Matrix

Status: **Parity completed at behavior level (without copying WenShape source code).**

## 1) Orchestration flow

- Implementation: `backend/jobs/manager.py`
- Event order:
  - `DIRECTOR_PLAN`
  - `CONTEXT_MANIFEST`
  - `WRITER_TOKEN / WRITER_DRAFT`
  - `CRITIC_REVIEW`
  - `EDITOR_PATCH`
  - `DIFF`
  - `MERGE_RESULT`
  - `CANON_UPDATES`

Acceptance:

- `POST /api/projects/{id}/jobs/write`
- `WS /api/jobs/{job_id}/stream`

## 2) Budget allocation and degradation

- Implementation:
  - `backend/context_engine/budget_manager.py`
  - `backend/services/context_engine.py`
- Behavior:
  - proportional bucket calculation,
  - usage accounting,
  - dropped/compression records,
  - `context_manifest.budget` output.

## 3) Retrieval/selection engine

- Implementation: `backend/services/kb_service.py`
- Behavior:
  - BM25 + token overlap,
  - weighted merged retrieval (`query_multi`),
  - KB coverage: `kb_style`, `kb_docs`, `kb_manuscript`, `kb_world`.

## 4) Canon extraction and proposals

- Implementation:
  - `backend/services/canon_extractor_service.py`
  - `backend/routers/canon.py`
- Behavior:
  - LLM-first extraction,
  - fallback extraction when unavailable,
  - append-only facts/issues/proposals,
  - proposal accept/reject flow.

## 5) Wiki import

- Implementation:
  - `backend/services/wiki_import_service.py`
  - `backend/routers/wiki.py`
- Behavior:
  - URL/HTML input,
  - source persisted to `assets/wiki/*`,
  - parsed metadata persisted to `meta/wiki/*`,
  - proposals generated from parsed candidates.

## 6) World facts

- Implementation:
  - `backend/services/world_facts_service.py`
  - `backend/routers/world.py`
- Data model:
  - world cards (`world_rule_*`, `lore_*`),
  - world state/event facts in canon.

## 7) Degradation + traceability

- Degradation:
  - provider failure emits `ERROR` event and falls back to mock.
- Traceability:
  - `context_manifest.citation_map` points to source metadata.

## 8) Validation entry points

- Backend: `cd backend && pytest -q`
- Frontend smoke: `./scripts/smoke_frontend.sh`
- UI path: `frontend/src/pages/App.tsx`
