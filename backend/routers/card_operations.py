from fastapi import APIRouter, Body, Depends
from routers.author_data import _call
from routers.cards import get_store
from services.card_operation_service import CardOperationService

router = APIRouter(prefix='/api/projects/{project_id}/card-operations', tags=['card-operations'])


def get_operations(store=Depends(get_store)):
    return CardOperationService(store)


@router.post('/preview')
def preview(project_id: str, body: dict = Body(...), service=Depends(get_operations)):
    return _call(service.preview, project_id, body)


@router.get('/{operation_id}')
def get(project_id: str, operation_id: str, service=Depends(get_operations)):
    return _call(service.get, project_id, operation_id)


@router.post('/{operation_id}/apply')
def apply(project_id: str, operation_id: str, body: dict = Body(...), service=Depends(get_operations)):
    return _call(service.apply, project_id, operation_id, body)


@router.post('/{operation_id}/undo')
def undo(project_id: str, operation_id: str, body: dict = Body(...), service=Depends(get_operations)):
    return _call(service.undo, project_id, operation_id, body)
