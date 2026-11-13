from fastapi import APIRouter, Body, Depends

from routers.author_data import _call
from routers.cards import get_store
from services.information_service import InformationService


router = APIRouter(prefix='/api/projects/{project_id}', tags=['information'])


def get_information(store=Depends(get_store)):
    return InformationService(store)


@router.get('/information-items')
def items(project_id: str, svc=Depends(get_information)):
    return _call(svc.list, project_id)


@router.post('/information-items')
def create(project_id: str, body: dict = Body(...), svc=Depends(get_information)):
    return _call(svc.save, project_id, body)


@router.get('/information-items/{information_id}')
def item(project_id: str, information_id: str, svc=Depends(get_information)):
    return _call(svc.get, project_id, information_id)


@router.put('/information-items/{information_id}')
def update(project_id: str, information_id: str, body: dict = Body(...), svc=Depends(get_information)):
    return _call(svc.save, project_id, body, information_id)


@router.get('/information-items/{information_id}/records')
def records(project_id: str, information_id: str, svc=Depends(get_information)):
    return _call(svc.records, project_id, information_id)


@router.post('/information-items/{information_id}/records')
def add_record(project_id: str, information_id: str, body: dict = Body(...), svc=Depends(get_information)):
    return _call(svc.add_record, project_id, information_id, body)


@router.get('/information-items/{information_id}/review-decisions')
def decisions(project_id: str, information_id: str, chapter_id: str | None = None, svc=Depends(get_information)):
    return _call(svc.decisions, project_id, information_id, chapter_id)


@router.post('/information-items/{information_id}/review-decisions')
def add_decision(project_id: str, information_id: str, body: dict = Body(...), svc=Depends(get_information)):
    return _call(svc.add_decision, project_id, information_id, body)


@router.get('/information-state')
def state(project_id: str, story_card_id: str | None = None, chapter_id: str | None = None, event_ref: str | None = None,
          branch_id: str | None = None, pov_character_id: str | None = None, reader_chapter_id: str | None = None,
          reader_offset: int | None = None, svc=Depends(get_information)):
    return _call(svc.state, project_id, story_card_id=story_card_id, chapter_id=chapter_id, event_ref=event_ref,
                 branch_id=branch_id, pov_character_id=pov_character_id, reader_chapter_id=reader_chapter_id, reader_offset=reader_offset)
