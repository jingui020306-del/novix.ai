from fastapi import APIRouter, Depends

from services.kb_service import KBService


def get_kb() -> KBService:
    from main import kb_service

    return kb_service


router = APIRouter(prefix='/api/projects/{project_id}/kb')


@router.post('/reindex')
def reindex(project_id: str, body: dict, kb: KBService = Depends(get_kb)):
    return kb.reindex(project_id, body.get('kb_id', 'kb_style'))


@router.post('/query')
def query(project_id: str, body: dict, kb: KBService = Depends(get_kb)):
    return kb.query(project_id, body['kb_id'], body.get('query', ''), int(body.get('top_k', 5)), body.get('filters'))
