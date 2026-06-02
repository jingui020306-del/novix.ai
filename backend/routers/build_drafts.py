from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from services.build_draft_service import BuildDraftService
from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


def get_service(s: FSStore = Depends(get_store)) -> BuildDraftService:
    return BuildDraftService(s)


router = APIRouter(prefix="/api/projects/{project_id}/build-drafts", tags=["build-drafts"])


@router.get("")
def list_build_drafts(project_id: str, kind: str | None = None, status: str | None = None, svc: BuildDraftService = Depends(get_service)):
    return svc.list_drafts(project_id, kind=kind, status=status)


@router.post("")
def create_build_draft(project_id: str, body: dict, svc: BuildDraftService = Depends(get_service)):
    try:
        return svc.create_draft(project_id, body or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{draft_id}")
def get_build_draft(project_id: str, draft_id: str, svc: BuildDraftService = Depends(get_service)):
    rec = svc.get_draft(project_id, draft_id)
    if not rec:
        raise HTTPException(status_code=404, detail="build draft not found")
    return rec


@router.put("/{draft_id}")
def update_build_draft(project_id: str, draft_id: str, body: dict, svc: BuildDraftService = Depends(get_service)):
    try:
        return svc.update_draft(project_id, draft_id, body or {})
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="build draft not found") from exc
