# Architecture (WenShape-aligned)

## 1. Goals

This repository keeps WenShape-compatible storage semantics while providing a practical, local authoring workbench with deterministic context engineering.

## 2. Core invariant

```text
data/{project_id}/
  project.yaml
  cards/
  canon/
  drafts/
  sessions/
```

## 3. System overview

- **Backend (`backend/`)**
  - FastAPI routers
  - storage, context engine, KB, jobs pipeline
- **Frontend (`frontend/`)**
  - React + Vite workbench UI (navigation, editor, event console)
- **Data (`data/`)**
  - demo + runtime project data
- **Docs (`docs/`)**
  - architecture, parity, debugging guides

## 4. Data semantics

- **Cards** (`cards/*.yaml`)  
  Static setup/config cards (character/world/style/outline/techniques).
- **Canon** (`canon/*.jsonl`)  
  Dynamic facts/issues/proposals, append-only.
- **Drafts** (`drafts/*.md`, `drafts/*.patch.jsonl`)  
  Chapter text, patch ops, unified diff history.
- **Sessions** (`sessions/*.jsonl`, meta)  
  Append-only event stream + UI state pointers.

## 5. Pipeline stages

1. `DIRECTOR_PLAN`
2. `TECHNIQUE_BRIEF`
3. `CONTEXT_MANIFEST`
4. `WRITER_DRAFT`
5. `CRITIC_REVIEW`
6. `EDITOR_PATCH`
7. `DIFF`
8. `MERGE_RESULT`
9. `CANON_UPDATES`

## 6. Context-engine principles

- Deterministic packing order.
- Budget-aware truncation/compression via `BudgetManager`.
- Evidence traceability (`citation_map`).
- Degradation path with mock fallback when provider/network is unavailable.

## 7. Runtime defaults

- Backend: `127.0.0.1:8000`
- Frontend: `127.0.0.1:5173`
- Startup scripts: `start.sh` / `start.bat`
