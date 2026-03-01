from __future__ import annotations

from typing import Any

from services.kb_service import KBService
from storage.fs_store import FSStore


class WorldFactsService:
    def __init__(self, store: FSStore, kb: KBService):
        self.store = store
        self.kb = kb

    def query(self, project_id: str, query: str, top_k: int = 8, include_global: bool = False) -> list[dict[str, Any]]:
        local_rows = self.kb.query(project_id, "kb_world", query, top_k=top_k)
        if not include_global:
            return local_rows
        global_rows = self.kb.query("_global", "kb_world", query, top_k=top_k)
        return (local_rows + global_rows)[:top_k]
