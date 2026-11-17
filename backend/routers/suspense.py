from fastapi import APIRouter, Body, Depends, HTTPException

from routers.author_data import _call
from routers.cards import get_store
from routers.jobs import get_manager
from services.suspense_service import SuspenseService


router = APIRouter(prefix='/api/projects/{project_id}/suspense/{story_id}', tags=['suspense'])


def suspense(store=Depends(get_store)):
    return SuspenseService(store)


@router.get('')
def workspace(project_id: str, story_id: str, chapter_id: str | None = None, branch_id: str | None = None,
              svc=Depends(suspense)):
    return _call(svc.snapshot, project_id, story_id, chapter_id, branch_id)


@router.post('')
def plan(project_id: str, story_id: str, body: dict = Body(...), svc=Depends(suspense)):
    return _call(svc.change, project_id, story_id, body)


@router.post('/review')
async def review(project_id: str, story_id: str, body: dict = Body(...), manager=Depends(get_manager)):
    from services.suspense_review import SuspenseReviewService
    try:
        return await SuspenseReviewService(manager).review(project_id, story_id, body)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/{thread_id}/evidence')
def evidence(project_id: str, story_id: str, thread_id: str, body: dict = Body(...), svc=Depends(suspense)):
    return _call(svc.change, project_id, story_id, body, thread_id=thread_id, action='add')


@router.delete('/{thread_id}/evidence/{evidence_id}')
def remove_evidence(project_id: str, story_id: str, thread_id: str, evidence_id: str, _revision: str,
                    branch_id: str | None = None, svc=Depends(suspense)):
    return _call(svc.change, project_id, story_id, {'branch_id': branch_id, '_revision': _revision},
                 action='remove', thread_id=thread_id, evidence_id=evidence_id)


@router.delete('/{thread_id}')
def remove_thread(project_id: str, story_id: str, thread_id: str, _revision: str,
                  branch_id: str | None = None, svc=Depends(suspense)):
    return _call(svc.change, project_id, story_id, {'branch_id': branch_id, '_revision': _revision},
                 action='delete', thread_id=thread_id)
