import os
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from jobs.manager import JobManager
from routers import analyze, author_data, authoring, blueprints, build_drafts, canon, cards, chapters, character_images, config_llm, drafts, health, jobs, kb, material_imports, planning_export, projects, scene_rehearsals, schema, selective_export, sessions, style, uploads, volumes, wiki, world
from services.context_engine import ContextEngine
from services.kb_service import KBService
from services.style_service import StyleService
from services.llm_gateway import LLMGateway
from services.world_facts_service import WorldFactsService
from services.wiki_import_service import WikiImportService
from services.llm_config_service import LLMConfigService
from services.writing_run_service import WritingRunService
from storage.fs_store import FSStore
from routers import author_controls, information, trials

DATA_DIR = BACKEND_DIR.parents[0] / 'data'
store = FSStore(DATA_DIR)
try:
    if not store._safe_path('demo_project_001', 'project.yaml').exists():
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
writing_runs = WritingRunService(job_manager)

frontend_port = os.getenv('NOVIX_FRONTEND_PORT', '5173')
allowed_origins = [
    f'http://127.0.0.1:{frontend_port}',
    f'http://localhost:{frontend_port}',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
]

app = FastAPI(title='AI Longform Novel Workbench API')


@app.exception_handler(FileExistsError)
async def author_edit_conflict(request, exc):
    return JSONResponse({'detail': str(exc)}, status_code=409)


@app.exception_handler(OSError)
async def author_storage_failure(request, exc):
    return JSONResponse({'detail': '本次保存未完成。原资料或可重试工作稿已保留，请检查磁盘或连接后重试。'}, status_code=503)


@app.middleware('http')
async def recover_author_imports(request, call_next):
    # A restarted/interrupted multi-file import must finish before readers see it.
    import re
    from fastapi.responses import JSONResponse
    from services.material_import_service import MaterialImportService
    match = re.match(r'^/api/projects/([\w-]+)/', request.url.path)
    if match and '/material-imports/' not in request.url.path:
        try:
            MaterialImportService(store).recover_pending(match[1])
        except (ValueError, OSError):
            return JSONResponse({'detail': '有一份导入尚待恢复，请打开材料工作稿核对并重试；现有编辑不会被覆盖。'}, status_code=409)
    return await call_next(request)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(health.router)
app.include_router(authoring.router)
app.include_router(author_data.router)
app.include_router(author_controls.router)
app.include_router(information.router)
app.include_router(trials.router)
app.include_router(material_imports.router)
app.include_router(scene_rehearsals.router)
app.include_router(character_images.router)
app.include_router(selective_export.router)
app.include_router(planning_export.router)
app.include_router(schema.router)
app.include_router(projects.router)
app.include_router(analyze.router)
app.include_router(build_drafts.router)
app.include_router(cards.router)
app.include_router(chapters.router)
app.include_router(blueprints.router)
app.include_router(drafts.router)
app.include_router(canon.router)
app.include_router(sessions.router)
app.include_router(uploads.router)
app.include_router(volumes.router)
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
