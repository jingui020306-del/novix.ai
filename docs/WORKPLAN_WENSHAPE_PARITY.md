# WenShape Parity Workplan (Guardrails Only)

> Scope note: This workplan documents constraints and execution order for parity work. It does **not** change current business logic by itself.

| Task | Goal | Expected output files | Acceptance command(s) | Main risks |
|---|---|---|---|---|
| 1 | Baseline and freeze invariants | `docs/WORKPLAN_WENSHAPE_PARITY.md`, `AGENTS.md` | `pytest -q` | Scope creep into logic changes |
| 2 | Storage layout parity checks | `scripts/*audit*` (if added), docs updates | `python -c "import pathlib; print((pathlib.Path('data/demo_project_001/project.yaml').exists()))"` | Breaking immutable WenShape paths |
| 3 | Blueprint/spec parity check | docs + schema notes | `pytest -q backend/tests` | Spec drift (`story_type_id`, `scene_plan`, `choice_points`) |
| 4 | Cards/Canon boundary hardening | docs + optional schema constraints | `pytest -q backend/tests` | Dynamic state leaking into static cards |
| 5 | Patch/diff append-only guarantees | docs + tests | `pytest -q backend/tests` | Patch history overwrite regression |
| 6 | Technique macro/micro mounting parity | docs + tests + UI-only touches | `pytest -q backend/tests` | Changing pipeline semantics unintentionally |
| 7 | Command Palette parity (non-breaking) | frontend UI files, docs | `cd backend && pytest -q` | Parser changes affecting existing commands |
| 8 | CI guardrails and collection safety | `.github/workflows/*`, `pytest.ini` | `pytest -q` | e2e collection failure in restricted CI |
| 9 | Final parity audit + README truthfulness | `README.md`, `docs/*` | `pytest -q && cd backend && pytest -q` | Over-claiming parity without evidence |

## Non-negotiable constraints during tasks 1~9

- Keep WenShape storage root immutable: `project.yaml`, `cards/`, `canon/`, `drafts/`, `sessions/`.
- Preserve append-only semantics for canon and patch history.
- Any UI or docs improvements must not alter existing pipeline behavior unless a dedicated task explicitly approves it.
- E2E/Playwright tests are opt-in only in CI/dev (`RUN_E2E=1`).
