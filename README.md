# novix.ai

WenShape-parity Context Engineering workbench for longform fiction: **World Facts + Multi-KB retrieval + Talk-style editing + provider fallback pipeline**.

[![Backend Tests](https://github.com/jingui020306-del/novix.ai/actions/workflows/backend.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/backend.yml)
[![Frontend Build](https://github.com/jingui020306-del/novix.ai/actions/workflows/frontend.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/frontend.yml)
[![Smoke](https://github.com/jingui020306-del/novix.ai/actions/workflows/smoke.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/smoke.yml)

---

## What this project is

`novix.ai` is an open, Git-native writing workbench that keeps WenShape-compatible storage semantics while providing:

- deterministic context assembly (`BudgetManager` + manifest),
- append-only canon/session/patch history,
- multi-knowledge-base retrieval (`kb_style`, `kb_docs`, `kb_manuscript`, `kb_world`),
- proposal-driven canon confirmation,
- and a talk-like editing workflow with patch accept/reject and rollback.

## Quickstart

### One-command startup

- Linux / macOS

  ```bash
  ./start.sh
  ```

- Windows

  ```bat
  start.bat
  ```

### Manual startup

- Backend (`:8000`)

  ```bash
  cd backend
  pip install -r requirements.txt
  uvicorn main:app --reload --port 8000
  ```

- Frontend (`:5173`)

  ```bash
  cd frontend
  npm install
  npm run dev
  ```

## Demo walkthrough

1. Create/select a project in UI (`demo_project_001` exists by default).
2. Upload style samples in **Style Studio** and run style analysis.
3. Import wiki content via **Wiki Import** (URL or HTML).
4. Run **Generate Chapter** in ChapterEditor.
5. Review patch ops, then apply selected ops.
6. Open **Canon / Proposals** and accept/reject proposals.
7. Inspect context evidence and world facts from Context/World panels.

### Example curl snippets

- Create project:

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects \
    -H 'content-type: application/json' \
    -d '{"title":"My Project"}'
  ```

- Multi-KB query:

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/kb/query_multi \
    -H 'content-type: application/json' \
    -d '{"query":"港区 封锁","top_k":12,"kb":[{"kb_id":"kb_style","weight":0.5},{"kb_id":"kb_docs","weight":1.0},{"kb_id":"kb_manuscript","weight":1.2},{"kb_id":"kb_world","weight":1.1}]}'
  ```

- Import wiki HTML:

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/wiki/import \
    -F kind=auto \
    -F file=@sample.html
  ```

## Features

| Capability | Status | Notes |
|---|---|---|
| WenShape parity storage | ✅ | `project.yaml + cards + canon + drafts + sessions` immutable semantics |
| BudgetManager | ✅ | proportional token buckets + budget report in manifest |
| Canon proposals | ✅ | append-only proposals + accept/reject flow |
| Wiki import | ✅ | URL/HTML -> parsed meta -> proposals |
| World facts | ✅ | world cards + world state query |
| Multi-KB retrieval | ✅ | BM25 + overlap + weighted merge |
| Evidence jump | ✅ | asset/chapter trace with source metadata |
| Providers | ✅ | mock / ollama / llama.cpp / openai-compat fallback |
| Talk-style editing | ✅ | patch accept/reject + versions + undo/redo |

## Ports

- Backend API: `127.0.0.1:8000`
- Frontend Vite dev server: `127.0.0.1:5173`

## Docs index

- [Architecture](docs/ARCHITECTURE.md)
- [WenShape Parity Matrix](docs/WENSHAPE_PARITY.md)
- [Frontend Debug Guide](docs/FRONTEND_DEBUG.md)
- [Repository agent constraints](AGENTS.md)

## FAQ

### npm install fails with E403

1. Check registry:

   ```bash
   npm config get registry
   ```

2. Override with environment variable:

   ```bash
   NPM_REGISTRY=https://registry.npmjs.org/ ./start.sh
   ```

3. In restricted environments, smoke script may return a policy SKIP instead of hard fail.

### Playwright/browser checks are flaky in restricted runtime

That does not block backend logic or pipeline correctness. Use smoke + pytest as baseline validation.

### Can this run without external LLM connectivity?

Yes. Provider failures are captured and pipeline falls back to Mock provider.

## Contributing & License

- See [CONTRIBUTING.md](CONTRIBUTING.md)
- See [LICENSE](LICENSE)
