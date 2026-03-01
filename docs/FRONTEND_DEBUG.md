# Frontend Debug Guide

## 1) Startup behavior

### `start.sh`

1. Create/activate `.venv`.
2. Install backend dependencies.
3. Install frontend dependencies (`npm ci` or `npm install` fallback).
4. Start backend (`uvicorn main:app --host 127.0.0.1 --port 8000`).
5. Start frontend (`npm run dev`).

### `start.bat`

Windows-equivalent sequence for backend + frontend startup.

## 2) Frontend runtime settings

- Command:

  ```bash
  cd frontend && npm run dev
  ```

- Address: `127.0.0.1:5173`
- Strict port: enabled (`--strictPort`)

## 3) Log locations

- Manual startup: terminal stdout/stderr.
- Smoke script: `/tmp/novix_frontend_smoke.log`

## 4) Common failure modes

1. Dependencies missing (`node_modules` missing + install failure).
2. Port conflict on `5173` (`strictPort` exits instead of auto-switching).
3. Registry/network policy issues (`npm E403`).
4. Backend not running (frontend boots, API calls fail).

## 5) Quick diagnosis checklist

```bash
npm config get registry
cd frontend && npm install
cd frontend && npm run dev
curl -I http://127.0.0.1:5173
./scripts/smoke_frontend.sh
```

## 6) Notes for restricted environments

- If registry access is restricted, smoke may return policy-level warnings.
- Treat backend `pytest` + frontend smoke as baseline verification when browser tooling is unstable.
