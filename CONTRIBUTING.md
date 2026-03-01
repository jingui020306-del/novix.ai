# Contributing to novix.ai

Thank you for helping improve `novix.ai`.

## Local development

### One-command startup

- Linux/macOS: `./start.sh`
- Windows: `start.bat`

### Manual startup

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# frontend
cd frontend
npm install
npm run dev
```

## Tests and checks

### Backend tests

```bash
cd backend
pytest -q
```

### Frontend smoke

```bash
./scripts/smoke_frontend.sh
```

### Frontend build

```bash
cd frontend
npm run build
```

## Commit and PR expectations

- Keep changes small and focused.
- Prefer multiple clear commits over one giant commit.
- Describe motivation, scope, and validation commands in PR.
- Include regression checks for changed areas.

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
