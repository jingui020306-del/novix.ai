@echo off
cd /d %~dp0
python -m venv .venv
call .venv\Scripts\activate
pip install -r backend\requirements.txt
start cmd /k "cd backend && uvicorn main:app --host 0.0.0.0 --port 8000"
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
