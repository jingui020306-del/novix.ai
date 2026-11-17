from fastapi import APIRouter, Body, Depends
from routers.author_data import _call
from routers.cards import get_store
from services.family_service import FamilyService

router = APIRouter(prefix="/api/projects/{project_id}/family", tags=["family"])


def get_service(store=Depends(get_store)):
    return FamilyService(store)


@router.post("/profile")
def profile(project_id: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.profile, project_id, body)


@router.post("/name")
def name(project_id: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.name, project_id, body)


@router.post("/tree")
def tree(project_id: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.tree, project_id, body)


@router.post("/preview")
def preview(project_id: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.preview, project_id, body)


@router.get("/{identity}")
def get(project_id: str, identity: str, svc=Depends(get_service)):
    return _call(svc.get, project_id, identity)


@router.put("/{identity}")
def update(project_id: str, identity: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.update, project_id, identity, body)


@router.post("/{identity}/apply")
def apply(project_id: str, identity: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.apply, project_id, identity, body)


@router.post("/{identity}/undo")
def undo(project_id: str, identity: str, body: dict = Body(...), svc=Depends(get_service)):
    return _call(svc.undo, project_id, identity, body)
