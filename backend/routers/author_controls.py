from fastapi import APIRouter, BackgroundTasks, Depends

from routers.cards import get_store, get_change_service
from routers.author_data import _call
from services.author_control_service import AuthorControlService

router = APIRouter(prefix='/api/projects/{project_id}/author-controls', tags=['author-controls'])


def get_controls(store=Depends(get_store)):
    return AuthorControlService(store)


@router.get('')
def get(project_id: str, target: str, service=Depends(get_controls)):
    return _call(service.get, project_id, target)


@router.post('/lock')
def lock(project_id: str, body: dict, service=Depends(get_controls)):
    return _call(service.confirm, project_id, body)


@router.post('/amendments')
def start(project_id: str, body: dict, service=Depends(get_controls)):
    return _call(service.start, project_id, body)


@router.get('/amendments/{edit_id}')
def amendment(project_id: str, edit_id: str, service=Depends(get_controls)):
    return _call(service.amendment, project_id, edit_id)


@router.put('/amendments/{edit_id}')
def update(project_id: str, edit_id: str, body: dict, service=Depends(get_controls)):
    return _call(service.update, project_id, edit_id, body)


def _apply(project_id, edit_id, body, service, changes, background, restore=False):
    with service.lock(project_id):
        record = _call(service.amendment, project_id, edit_id)
        before = service.read(project_id, record['target'])
        result = _call(service.apply, project_id, edit_id, body, restore=restore)
        if record['target'].startswith('cards/') and before != result['value']:
            try:
                queued = changes.enqueue(project_id, result['value']['id'], before, result['value'])
                if queued.get('task_ids'):
                    background.add_task(changes.process, project_id, queued['task_ids'])
                result['change_suggestions'] = queued
            except Exception:
                result['warning'] = '资料已保存，关联正文建议暂未排队；原正文保留。'
        return result


@router.post('/amendments/{edit_id}/apply')
def apply(project_id: str, edit_id: str, body: dict, background: BackgroundTasks, service=Depends(get_controls), changes=Depends(get_change_service)):
    return _apply(project_id, edit_id, body, service, changes, background)


@router.post('/amendments/{edit_id}/restore')
def restore(project_id: str, edit_id: str, body: dict, background: BackgroundTasks, service=Depends(get_controls), changes=Depends(get_change_service)):
    return _apply(project_id, edit_id, body, service, changes, background, restore=True)
