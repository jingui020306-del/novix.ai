# WenShape Parity Matrix

Status: **Behavior-level parity implemented in this repository (without copying WenShape source code).**

## 1) Orchestration flow

- Implementation: `backend/jobs/manager.py`
- Event order:
  1. `DIRECTOR_PLAN`
  2. `TECHNIQUE_BRIEF`
  3. `CONTEXT_MANIFEST`
  4. `WRITER_TOKEN / WRITER_DRAFT`
  5. `CRITIC_REVIEW`
  6. `EDITOR_PATCH`
  7. `DIFF`
  8. `MERGE_RESULT`
  9. `CANON_UPDATES`

Acceptance endpoints:

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

## 3) Retrieval and selection

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

## 7) Traceability and fallback

- Provider failure emits `ERROR` and falls back to mock.
- `context_manifest.citation_map` keeps source traceability.

## 8) Validation entry points

- `pytest -q`
- `cd backend && pytest -q`
- `./scripts/smoke_frontend.sh`
