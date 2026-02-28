from fastapi import APIRouter, Depends

from services.world_facts_service import WorldFactsService


def get_world() -> WorldFactsService:
    from main import world_facts_service

    return world_facts_service


router = APIRouter(prefix='/api/projects/{project_id}/world')


@router.post('/query')
def query_world(project_id: str, body: dict, svc: WorldFactsService = Depends(get_world)):
    return svc.query(project_id, body.get('query', ''), int(body.get('top_k', 8)), bool(body.get('include_global', False)))
