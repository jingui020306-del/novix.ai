# Repository Audit

## Current state snapshot
- Existing files at audit time were minimal: `.git/` and a lightweight `README.md`.
- No existing monorepo layout (`frontend/`, `backend/`, `docs/`, `data/`) was present.
- No backend framework, frontend build config, storage layout, or test suite existed.
- No existing project data directory structure was present.

## Integration strategy (minimal-intrusion)
Because the repository was effectively empty, integration is performed by adding new directories and files without removing any original key file.

Planned additions:
- `backend/`: FastAPI app, WenShape-aligned filesystem storage, schema APIs, CRUD APIs, mock write pipeline, tests.
- `frontend/`: React + Vite + TypeScript + Tailwind-based three-panel IDE shell using schema-driven forms.
- `docs/`: architecture and this audit.
- `data/demo_project_001/`: generated sample project data aligned to immutable WenShape layout.
- startup scripts + `.env.example`.

## Key risks and mitigations
1. **WenShape layout drift**
   - Risk: accidental alternate storage paths.
   - Mitigation: centralized `FSStore` path helpers with strict project-rooted resolution.
2. **Blueprint compatibility drift**
   - Risk: under-specified blueprint schema.
   - Mitigation: dedicated JSON schema endpoint + write-time schema validation.
3. **Patch history non-compliance**
   - Risk: chapter edits lacking diff/patch logging.
   - Mitigation: explicit apply-patch API producing unified diff and appending to `chapter_*.patch.jsonl`.
4. **Mock pipeline traceability**
   - Risk: non-observable phase outputs.
   - Mitigation: evented job manager with phase events and session append logs.

## Phase-1 objective
Deliver write → review → patch/edit → merge → canon append loop on MockProvider only (no real LLM), with complete file persistence aligned to WenShape.
