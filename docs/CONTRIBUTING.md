# Contributing to novix.ai

Thank you for helping improve `novix.ai`.

## Local development

Follow the [quickstart](../README.md#quickstart) for dependencies and startup. Linux and macOS also support `./start.sh`, and Windows supports `start.bat`.

## Tests and checks

From the repository root, with the backend environment active:

```bash
(cd backend && python -m pytest -q)
(cd frontend && npm run build)
./scripts/smoke_frontend.sh
git diff --check
```

The smoke script writes to `/tmp/novix_frontend_smoke.log`. When starting Vite manually, check that port 5173 is available and the backend is running. For registry errors, see [npm troubleshooting](../README.md#npm-install-fails-with-e403).

## Commit and PR expectations

- Keep changes small and focused.
- Prefer multiple clear commits over one giant commit.
- Describe motivation, scope, and validation commands in PR.
- Keep new internal cases, screenshots and test data outside the worktree.
- Review staged and unstaged changes and untracked files before committing.
- Keep user instructions in the root README and other project documentation in `docs/`.

## Issue / PR workflow

1. Open an Issue (bug or feature) with reproduction/context.
2. Link related Issue(s) from your PR.
3. Fill the PR checklist completely.
4. Ensure no unrelated files are bundled.

## Acceptance baseline

- `start.sh` / `start.bat` still work.
- Backend `pytest` passes.
- Frontend smoke/build checks are addressed.
- WenShape core data semantics remain unchanged.
