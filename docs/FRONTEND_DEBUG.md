# Frontend Debug Guide

## Startup behavior

### `start.sh`

1. Create/activate `.venv`.
2. Install backend dependencies.
3. Install frontend dependencies (`npm ci` or `npm install` fallback).
4. Start backend: `uvicorn main:app --host 127.0.0.1 --port 8000`.
5. Start frontend: `npm run dev`.

### `start.bat`

Windows-equivalent steps for the same backend/frontend sequence.

## Frontend runtime settings

- Command:

  ```bash
  cd frontend && npm run dev
  ```

- Address: `127.0.0.1:5173`
- Strict port: enabled (`--strictPort`)

## Log locations

- Manual startup: terminal stdout/stderr (contains Vite Local/Network lines).
- Smoke script log: `/tmp/novix_frontend_smoke.log`

## Common failure modes

1. Dependencies missing (`node_modules` absent + install failure).
2. Port conflict on `5173` (`strictPort` exits instead of auto-switching).
3. Registry/network policy issues (`npm E403`).
4. Backend not running (frontend boots but API interactions fail).

## Quick diagnosis checklist

1. `npm config get registry`
2. `cd frontend && npm install`
3. `cd frontend && npm run dev`
4. `curl -I http://127.0.0.1:5173`
5. `./scripts/smoke_frontend.sh`
