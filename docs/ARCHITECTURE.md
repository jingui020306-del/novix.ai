# Architecture (WenShape-aligned)

## Why this aligns to WenShape
The backend storage layer enforces immutable WenShape paths under `data/{project_id}` with fixed `project.yaml`, `cards/`, `canon/`, `drafts/`, `sessions/` semantics. Static setup is in cards, dynamic timeline/facts/issues are append-only JSONL in canon, and chapter modifications are tracked in patch logs.

## Directory responsibilities
- `backend/`: FastAPI API + storage + mock jobs pipeline.
- `frontend/`: React IDE (SidePanel / Editor / AgentConsole), schema-driven forms.
- `data/`: demo and runtime project data (single WenShape layout).
- `docs/`: audit and architecture specs.

## MVP flow (write-review-edit-merge-canon)
1. Director reads blueprint scene and outline beats.
2. Context Engine assembles style + scene + canon + evidence manifest.
3. Writer (MockProvider) drafts chapter text.
4. Critic produces issues with evidence pointers.
5. Editor creates patch ops + unified diff.
6. Merge applies patch and logs `chapter_*.patch.jsonl`.
7. Archivist appends facts into canon JSONL.
