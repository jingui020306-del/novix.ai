from pathlib import Path
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import FileResponse
from routers.author_data import _call
from routers.cards import get_store
from services.world_library_service import WorldLibraryService


router = APIRouter(tags=['world-library'])


def get_library(store=Depends(get_store)):
    return WorldLibraryService(store)


@router.get('/api/world-library')
def library(category: str = '', visibility: str = '', service=Depends(get_library)):
    return _call(service.list, category=category, visibility=visibility)


@router.post('/api/world-library')
def create(body: dict = Body(...), service=Depends(get_library)):
    return _call(service.create, body)


@router.get('/api/world-library/{pack_id}')
def get(pack_id: str, service=Depends(get_library)):
    return _call(service.get, pack_id)


@router.post('/api/world-library/{pack_id}/adopt')
def adopt(pack_id: str, body: dict = Body(...), service=Depends(get_library)):
    return _call(service.adopt, pack_id, body)


@router.post('/api/projects/{project_id}/world-library/save')
def save(project_id: str, body: dict = Body(...), service=Depends(get_library)):
    return _call(service.save, project_id, body)


@router.get('/api/projects/{project_id}/world-library/diff')
def compare(project_id: str, world_id: str, service=Depends(get_library)):
    return _call(service.diff, project_id, world_id)


@router.get('/api/projects/{project_id}/world-library/source')
def source(project_id: str, path: str, store=Depends(get_store)):
    if not path.startswith('assets/'):
        raise HTTPException(400, '请选择本作品保存的世界附件。')
    target = _call(store._safe_path, project_id, path)
    if not target.is_file():
        raise HTTPException(404, '附件不存在。')
    image = target.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
    return FileResponse(target, filename=target.name, content_disposition_type='inline' if image else 'attachment')
