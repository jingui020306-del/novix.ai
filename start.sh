#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python3 -m venv .venv || true
source .venv/bin/activate
pip install -r backend/requirements.txt
(cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 &) 
(cd frontend && npm install && npm run dev -- --host 0.0.0.0 --port 5173)
