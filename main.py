"""Compatibility module for test runners importing `main` from repo root."""

from backend.main import (
    app,
    context_engine,
    job_manager,
    kb_service,
    llm_config_service,
    llm_gateway,
    store,
    style_service,
    wiki_import_service,
    world_facts_service,
)

__all__ = [
    "app",
    "store",
    "kb_service",
    "context_engine",
    "style_service",
    "llm_gateway",
    "world_facts_service",
    "wiki_import_service",
    "llm_config_service",
    "job_manager",
]
