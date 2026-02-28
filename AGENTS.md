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

Do not rename paths, alter semantics, or introduce a second parallel storage layout.

## StoryMode / scenario-card-spec-v1 Blueprint

Blueprints must be persisted as:

```text
data/{project_id}/cards/blueprint_*.json
```

Blueprint JSON must remain compatible with scenario-card-spec-v1, including Story → Scenes → Beats semantics and fields such as `story_type_id`, `scene_plan`, and `choice_points`.

Allowed optional control signals:

- `@@BEAT:N@@`
- `@@NEXT_SCENE@@`

## Cards vs Canon

- `cards/*.yaml`: static setup cards (`character/world/style/outline`).
- `canon/*.jsonl`: dynamic facts, conflicts, timeline, append-only.

Dynamic state is forbidden from being written back into character cards.

## Patch/Diff

- Chapter revision must produce patch ops + unified diff.
- Patch history must be written to `drafts/chapter_*.patch.jsonl`.

## Acceptance baseline

- `start.sh` and `start.bat` must work.
- Backend `pytest` must pass.
- Provide `data/demo_project_001/` sample data.
