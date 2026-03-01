# Repository Agent Rules

## WenShape-compatible storage layout (IMMUTABLE)

All project data **must** follow and preserve this exact structure:

```text
data/{project_id}/
  project.yaml
  cards/
  canon/
  drafts/
  sessions/
```

### Hard constraints

- Do not rename these paths.
- Do not alter these semantics.
- Do not introduce a second parallel storage layout.

## StoryMode / scenario-card-spec-v1 blueprint

Blueprints must be stored as:

```text
data/{project_id}/cards/blueprint_*.json
```

Blueprint JSON must remain compatible with scenario-card-spec-v1, including:

- Story → Scenes → Beats structure,
- `story_type_id`,
- `scene_plan`,
- `choice_points`.

Allowed optional control signals:

- `@@BEAT:N@@`
- `@@NEXT_SCENE@@`

## Cards vs Canon boundary

- `cards/*.yaml`: static setup cards (`character/world/style/outline`)
- `canon/*.jsonl`: dynamic facts, conflicts, timeline (**append-only**)

Dynamic state is forbidden from being written back into character cards.

## Patch / Diff invariants

- Chapter revision must produce patch ops + unified diff.
- Patch history must be written to `drafts/chapter_*.patch.jsonl`.

## Directory guardrails

### Allowed to change directly (non-destructive)

- `docs/`
- `.github/`
- Frontend UI code (`frontend/src/**`) as long as behavior changes are UI-level and non-destructive.
- Backend config/schema/extensibility surfaces:
  - `backend/schemas/**`
  - `backend/config*` (if present)
  - New router/service files can be added under `backend/routers/**` and `backend/services/**`.

### Protected (do not change existing behavior semantics)

- Job pipeline semantic order and phase meaning (`backend/jobs/**`).
- WenShape storage main structure and persistence semantics (`backend/storage/**` and `data/**` root layout).
- Append-only rules for canon/session/patch logs.

If a task requires changing protected semantics, explicitly document the reason and acceptance criteria first.

## Test collection guardrails

- E2E/Playwright tests are **opt-in** by default.
- Default local/CI `pytest` run should not collect e2e playwright scenarios.
- Only run e2e when explicitly enabled, e.g. `RUN_E2E=1`.

## Acceptance baseline

- `start.sh` and `start.bat` must work.
- Backend `pytest` must pass.
- `data/demo_project_001/` sample data must exist.


## Change-policy summary

- Prefer docs/UI/schema/config updates before touching protected runtime semantics.
- If protected semantics must change, record rationale + acceptance criteria before implementation.
