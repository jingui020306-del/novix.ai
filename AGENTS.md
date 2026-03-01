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

## Acceptance baseline

- `start.sh` and `start.bat` must work.
- Backend `pytest` must pass.
- `data/demo_project_001/` sample data must exist.
