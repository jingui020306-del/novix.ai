import os
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from jobs.manager import JobManager
from routers import analyze, blueprints, canon, cards, config_llm, drafts, health, jobs, kb, projects, schema, sessions, style, uploads, wiki, world
from services.context_engine import ContextEngine
from services.kb_service import KBService
from services.style_service import StyleService
from services.llm_gateway import LLMGateway
from services.world_facts_service import WorldFactsService
from services.wiki_import_service import WikiImportService
from services.llm_config_service import LLMConfigService
from storage.fs_store import FSStore

DATA_DIR = BACKEND_DIR.parents[0] / 'data'
store = FSStore(DATA_DIR)
try:
    store.init_demo_project('demo_project_001')
except Exception:
    # Keep app importable in test/CI environments where demo data is already seeded
    # with YAML content different from local bootstrap format.
    pass

kb_service = KBService(store)
context_engine = ContextEngine(store, kb_service)
style_service = StyleService(store, kb_service)
llm_gateway = LLMGateway()
world_facts_service = WorldFactsService(store, kb_service)
wiki_import_service = WikiImportService(store)
llm_config_service = LLMConfigService(DATA_DIR)
job_manager = JobManager(store, context_engine, llm_gateway)

frontend_port = os.getenv('NOVIX_FRONTEND_PORT', '5173')
allowed_origins = [
    f'http://127.0.0.1:{frontend_port}',
    f'http://localhost:{frontend_port}',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
]

app = FastAPI(title='AI Longform Novel Workbench API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(health.router)
app.include_router(schema.router)
app.include_router(projects.router)
app.include_router(analyze.router)
app.include_router(cards.router)
app.include_router(blueprints.router)
app.include_router(drafts.router)
app.include_router(canon.router)
app.include_router(sessions.router)
app.include_router(uploads.router)
app.include_router(kb.router)
app.include_router(style.router)
app.include_router(config_llm.router)
app.include_router(jobs.router)
app.include_router(world.router)
app.include_router(wiki.router)


def _resolve_static_root() -> Path | None:
    static_dist = BACKEND_DIR / 'static_dist'
    if static_dist.exists():
        return static_dist

    static = BACKEND_DIR / 'static'
    if static.exists():
        return static
    return None


STATIC_ROOT = _resolve_static_root()
if STATIC_ROOT is not None and (STATIC_ROOT / 'assets').exists():
    app.mount('/assets', StaticFiles(directory=STATIC_ROOT / 'assets'), name='frontend-assets')


def _serve_index() -> FileResponse:
    if STATIC_ROOT is None:
        raise HTTPException(status_code=404, detail='Frontend bundle not found')

    index_file = STATIC_ROOT / 'index.html'
    if not index_file.exists():
        raise HTTPException(status_code=404, detail='Frontend index.html missing')
    return FileResponse(index_file)


@app.get('/')
def serve_frontend_root() -> FileResponse:
    return _serve_index()


@app.get('/{full_path:path}')
def spa_fallback(full_path: str):
    if full_path.startswith('api'):
        raise HTTPException(status_code=404, detail='Not Found')

    if STATIC_ROOT is None:
        raise HTTPException(status_code=404, detail='Not Found')

    candidate = STATIC_ROOT / full_path
    if candidate.is_file():
        return FileResponse(candidate)
    return _serve_index()
