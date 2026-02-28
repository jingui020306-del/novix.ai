from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from jobs.manager import JobManager
from routers import blueprints, canon, cards, drafts, health, jobs, projects, schema, sessions
from storage.fs_store import FSStore

DATA_DIR = Path(__file__).resolve().parents[1] / 'data'
store = FSStore(DATA_DIR)
store.init_demo_project('demo_project_001')
job_manager = JobManager(store)

app = FastAPI(title='AI Longform Novel Workbench API')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

app.include_router(health.router)
app.include_router(schema.router)
app.include_router(projects.router)
app.include_router(cards.router)
app.include_router(blueprints.router)
app.include_router(drafts.router)
app.include_router(canon.router)
app.include_router(sessions.router)
app.include_router(jobs.router)
