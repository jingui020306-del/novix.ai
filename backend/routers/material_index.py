from fastapi import APIRouter, Body, Depends
from routers.author_data import _call
from routers.cards import get_store
from services.material_index_service import MaterialIndexService


router = APIRouter(prefix='/api/projects/{project_id}/material-index', tags=['material-index'])


def get_index(store=Depends(get_store)):
    return MaterialIndexService(store)


@router.get('/status')
def status(project_id: str, service=Depends(get_index)):
    return _call(service.status, project_id)


@router.post('/rebuild')
def rebuild(project_id: str, service=Depends(get_index)):
    return _call(service.rebuild, project_id)


@router.get('/search')
def search(project_id: str, q: str = '', type: str = '', tags: str = '', world_id: str = '', branch_id: str = '',
           year: int | None = None, region_id: str = '', period_id: str = '', chapter_id: str = '', story_card_id: str = '', service=Depends(get_index)):
    return _call(service.search, project_id, q=q, type=type, tags=tags, world_id=world_id, branch_id=branch_id, year=year,
                 region_id=region_id, period_id=period_id, chapter_id=chapter_id or None, story_card_id=story_card_id or None)


@router.get('/tags')
def tags(project_id: str, service=Depends(get_index)):
    return _call(service.tags, project_id)


@router.post('/mentions')
def mentions(project_id: str, body: dict = Body(...), service=Depends(get_index)):
    return _call(service.mentions, project_id, body)


@router.put('/mention-choices')
def choices(project_id: str, body: dict = Body(...), service=Depends(get_index)):
    return _call(service.save_choices, project_id, body)
