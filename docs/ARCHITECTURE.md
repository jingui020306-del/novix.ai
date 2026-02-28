# Architecture (WenShape-aligned)

## Alignment goals

This repository keeps WenShape-compatible data semantics while providing a practical local workbench for authoring pipelines.

Core invariant:

```text
data/{project_id}/
  project.yaml
  cards/
  canon/
  drafts/
  sessions/
```

## High-level components

- **backend/**
  - FastAPI APIs
  - storage + context + KB + jobs pipeline
- **frontend/**
  - IDE-like React shell (left nav / editor / console)
- **data/**
  - demo + runtime project data
- **docs/**
  - architecture and parity documents

## Data semantics

- **Cards** (`cards/*.yaml`): static setup/config cards.
- **Canon** (`canon/*.jsonl`): append-only dynamic timeline/facts/issues/proposals.
- **Drafts** (`drafts/*.md` + patch logs): chapter content and revision history.
- **Sessions** (`sessions/*.jsonl` + meta): append-only event stream + UI pointers.

## Pipeline stages

1. `DIRECTOR_PLAN`
2. `CONTEXT_MANIFEST`
3. `WRITER_TOKEN / WRITER_DRAFT`
4. `CRITIC_REVIEW`
5. `EDITOR_PATCH`
6. `DIFF`
7. `MERGE_RESULT`
8. `CANON_UPDATES`

## Context assembly principles

- Deterministic packing order.
- Budget-aware bucket limits.
- Evidence traceability (`citation_map`).
- Degradation path when model/network is unavailable.

## Operational notes

- Backend default: `127.0.0.1:8000`
- Frontend default: `127.0.0.1:5173`
- Startup: `start.sh` / `start.bat`
