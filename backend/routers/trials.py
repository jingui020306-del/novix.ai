from fastapi import APIRouter, Body, Depends, HTTPException

from routers.authoring import get_authoring
from routers.author_data import _call
from services.trial_service import TrialService


router = APIRouter(prefix='/api/projects/{project_id}', tags=['trials'])


def get_trials(authoring=Depends(get_authoring)):
    return TrialService(authoring.store, authoring)


@router.get('/chapters/{chapter_id}/trials')
def trials(project_id: str, chapter_id: str, svc=Depends(get_trials)):
    return _call(svc.list, project_id, chapter_id)


@router.post('/chapters/{chapter_id}/trials')
def create(project_id: str, chapter_id: str, body: dict = Body(...), svc=Depends(get_trials)):
    return _call(svc.create, project_id, chapter_id, body)


@router.get('/trials/{trial_id}')
def get(project_id: str, trial_id: str, svc=Depends(get_trials)):
    return _call(svc.get, project_id, trial_id)


@router.put('/trials/{trial_id}')
def update(project_id: str, trial_id: str, body: dict = Body(...), svc=Depends(get_trials)):
    return _call(svc.update, project_id, trial_id, body)


@router.post('/trials/{trial_id}/generate')
async def generate(project_id: str, trial_id: str, body: dict = Body(...), svc=Depends(get_trials)):
    try:
        return await svc.generate(project_id, trial_id, body)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '试写模型调用失败；正式资料和试写编辑均保留。') from exc


@router.post('/trials/{trial_id}/apply')
def apply(project_id: str, trial_id: str, body: dict = Body(...), svc=Depends(get_trials)):
    return _call(svc.apply, project_id, trial_id, body)


@router.post('/trials/{trial_id}/discard')
def discard(project_id: str, trial_id: str, body: dict = Body(...), svc=Depends(get_trials)):
    return _call(svc.discard, project_id, trial_id, body)
