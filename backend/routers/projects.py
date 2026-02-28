import uuid

from fastapi import APIRouter, Depends, HTTPException

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix="/api/projects")


@router.post("")
def create_project(body: dict, s: FSStore = Depends(get_store)):
    pid = f"project_{uuid.uuid4().hex[:8]}"
    s.ensure_project(pid, body.get("title", pid))
    return {"project_id": pid}


@router.get("")
def list_projects(s: FSStore = Depends(get_store)):
    return s.list_projects()


@router.get('/{project_id}')
def get_project(project_id: str, s: FSStore = Depends(get_store)):
    data = s.read_yaml(project_id, 'project.yaml')
    if not data:
        raise HTTPException(status_code=404, detail='Not found')
    return data
