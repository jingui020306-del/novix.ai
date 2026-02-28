from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from jobs.manager import JobManager
from routers import blueprints, canon, cards, drafts, health, jobs, kb, projects, schema, sessions, style, uploads, wiki, world
from services.context_engine import ContextEngine
from services.kb_service import KBService
from services.style_service import StyleService
from services.llm_gateway import LLMGateway
from services.world_facts_service import WorldFactsService
from services.wiki_import_service import WikiImportService
from storage.fs_store import FSStore

DATA_DIR = Path(__file__).resolve().parents[1] / 'data'
store = FSStore(DATA_DIR)
store.init_demo_project('demo_project_001')
kb_service = KBService(store)
context_engine = ContextEngine(store, kb_service)
style_service = StyleService(store, kb_service)
llm_gateway = LLMGateway()
world_facts_service = WorldFactsService(store, kb_service)
wiki_import_service = WikiImportService(store)
job_manager = JobManager(store, context_engine, llm_gateway)

app = FastAPI(title='AI Longform Novel Workbench API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://127.0.0.1:5173', 'http://localhost:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(health.router)
app.include_router(schema.router)
app.include_router(projects.router)
app.include_router(cards.router)
app.include_router(blueprints.router)
app.include_router(drafts.router)
app.include_router(canon.router)
app.include_router(sessions.router)
app.include_router(uploads.router)
app.include_router(kb.router)
app.include_router(style.router)
app.include_router(jobs.router)

app.include_router(world.router)
app.include_router(wiki.router)
