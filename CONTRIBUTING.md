# Contributing

Thanks for contributing to `novix.ai`.

## Development setup

### One-command startup

- Linux/macOS: `./start.sh`
- Windows: `start.bat`

### Manual startup

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

cd frontend
npm install
npm run dev
```

## Testing

### Backend tests

```bash
cd backend
python -m pytest -q
```

### Frontend smoke

```bash
./scripts/smoke_frontend.sh
```

## Pull Request process

1. Create a branch from `main`.
2. Keep changes scoped and include tests where applicable.
3. Ensure backend tests pass locally.
4. Run smoke checks if frontend/startup behavior changed.
5. Open PR with clear summary, motivation, and validation commands/results.
