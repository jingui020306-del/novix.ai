from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException

from routers.cards import get_store, get_change_service
from services.author_data_service import AuthorDataService


router = APIRouter(prefix='/api/projects/{project_id}', tags=['author-data'])


def get_author_data(store=Depends(get_store)):
    return AuthorDataService(store)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _add_stage(project_id, kind, target_id, body, svc, changes, background_tasks):
    stage = _call(svc.add_stage, project_id, kind, target_id, body)
    if kind == 'character':
        from services.scene_rehearsal_service import SceneRehearsalService
        background_tasks.add_task(SceneRehearsalService(svc.store).warm_actor_scenes, project_id, target_id)
    try:
        queued = changes.enqueue_stage(project_id, kind, target_id, stage)
    except Exception:
        queued = {'queued_count': 0, 'task_ids': [], 'error': '阶段已保存，但正文建议暂未排队；原正文保持不变。'}
    if queued.get('task_ids'):
        background_tasks.add_task(changes.process, project_id, queued['task_ids'])
    return {**stage, 'change_suggestions': queued}


def _enqueue_saved(value, changes, background_tasks, fn, *args):
    try:
        queued = fn(*args)
    except Exception:
        queued = {'queued_count': 0, 'task_ids': [], 'error': '资料已保存，但正文建议暂未排队；原正文保持不变。'}
    if queued.get('task_ids'):
        background_tasks.add_task(changes.process, args[0], queued['task_ids'])
    return {**value, 'change_suggestions': queued}


@router.get('/relationships')
def relationships(project_id: str, svc=Depends(get_author_data)):
    return _call(svc.relationships, project_id)


@router.post('/relationships')
def create_relationship(project_id: str, background_tasks: BackgroundTasks, body: dict = Body(...), svc=Depends(get_author_data), changes=Depends(get_change_service)):
    with svc._lock(project_id):
        value = _call(svc.create_relationship, project_id, body)
        return _enqueue_saved(value, changes, background_tasks, changes.enqueue_relationship, project_id, value)


@router.get('/relationships/{relationship_id}')
def relationship(project_id: str, relationship_id: str, svc=Depends(get_author_data)):
    return _call(svc.relationship, project_id, relationship_id)


@router.put('/relationships/{relationship_id}')
def update_relationship(project_id: str, relationship_id: str, background_tasks: BackgroundTasks, body: dict = Body(...), svc=Depends(get_author_data), changes=Depends(get_change_service)):
    with svc._lock(project_id):
        before = _call(svc.relationship, project_id, relationship_id)
        value = _call(svc.update_relationship, project_id, relationship_id, body)
        return _enqueue_saved(value, changes, background_tasks, changes.enqueue_relationship, project_id, value, before)


@router.get('/relationships/{relationship_id}/stages')
def relationship_stages(project_id: str, relationship_id: str, svc=Depends(get_author_data)):
    return _call(svc.stages, project_id, 'relationship', relationship_id)


@router.post('/relationships/{relationship_id}/stages')
def add_relationship_stage(project_id: str, relationship_id: str, background_tasks: BackgroundTasks, body: dict = Body(...), svc=Depends(get_author_data), changes=Depends(get_change_service)):
    return _add_stage(project_id, 'relationship', relationship_id, body, svc, changes, background_tasks)


@router.get('/events')
def events(project_id: str, story_card_id: str | None = None, svc=Depends(get_author_data)):
    return _call(svc.events, project_id, story_card_id)


@router.put('/events/{owner_id}/{scene_id}')
def update_event(project_id: str, owner_id: str, scene_id: str, background_tasks: BackgroundTasks, body: dict = Body(...), svc=Depends(get_author_data), changes=Depends(get_change_service)):
    with svc._lock(project_id):
        canonical = _call(svc.world.event, project_id, {'owner_card_id': owner_id, 'scene_id': scene_id})[-1]
        source = f"cards/{canonical['owner_card_id']}.yaml"
        before = svc.store.read_yaml(project_id, source)
        value = _call(svc.update_event, project_id, owner_id, scene_id, body)
        after = svc.store.read_yaml(project_id, source)
        if before != after:
            from services.scene_rehearsal_service import SceneRehearsalService
            background_tasks.add_task(SceneRehearsalService(svc.store).warm, project_id, canonical['owner_card_id'], canonical['scene_id'])
        return _enqueue_saved(value, changes, background_tasks, changes.enqueue_event, project_id, canonical['owner_card_id'], canonical['scene_id'], before, after)


@router.get('/characters/{character_id}/state')
def character_state(project_id: str, character_id: str, story_card_id: str | None = None, chapter_id: str | None = None,
                    event_ref: str | None = None, branch_id: str | None = None, svc=Depends(get_author_data)):
    return _call(svc.character_state, project_id, character_id, story_card_id=story_card_id, chapter_id=chapter_id, event_ref=event_ref, branch_id=branch_id)


@router.get('/characters/{character_id}/stages')
def character_stages(project_id: str, character_id: str, svc=Depends(get_author_data)):
    return _call(svc.stages, project_id, 'character', character_id)


@router.post('/characters/{character_id}/stages')
def add_character_stage(project_id: str, character_id: str, background_tasks: BackgroundTasks, body: dict = Body(...), svc=Depends(get_author_data), changes=Depends(get_change_service)):
    return _add_stage(project_id, 'character', character_id, body, svc, changes, background_tasks)


@router.get('/worlds/{world_id}/stages')
def world_stages(project_id: str, world_id: str, svc=Depends(get_author_data)):
    return _call(svc.stages, project_id, 'world', world_id)


@router.get('/worlds/{world_id}/state')
def world_state(project_id: str, world_id: str, story_card_id: str | None = None, chapter_id: str | None = None,
                event_ref: str | None = None, branch_id: str | None = None, svc=Depends(get_author_data)):
    return _call(svc.world_state, project_id, world_id, story_card_id=story_card_id, chapter_id=chapter_id, event_ref=event_ref, branch_id=branch_id)


@router.post('/worlds/{world_id}/stages')
def add_world_stage(project_id: str, world_id: str, background_tasks: BackgroundTasks, body: dict = Body(...), svc=Depends(get_author_data), changes=Depends(get_change_service)):
    return _add_stage(project_id, 'world', world_id, body, svc, changes, background_tasks)


@router.get('/worlds/{world_id}/branches')
def branches(project_id: str, world_id: str, svc=Depends(get_author_data)):
    return _call(svc.branches, project_id, world_id)


@router.get('/worlds/{world_id}/context-options')
def context_options(project_id: str, world_id: str, svc=Depends(get_author_data)):
    return _call(svc.world.options, project_id, world_id)


@router.post('/worlds/{world_id}/snapshot')
def world_snapshot(project_id: str, world_id: str, body: dict = Body(...), svc=Depends(get_author_data)):
    return _call(svc.world_snapshot, project_id, world_id, body)


@router.put('/worlds/{world_id}/branches')
def put_branches(project_id: str, world_id: str, body: dict = Body(...), svc=Depends(get_author_data)):
    return _call(svc.put_branches, project_id, world_id, body)


@router.get('/author-state')
def author_state(project_id: str, story_card_id: str | None = None, chapter_id: str | None = None, event_ref: str | None = None,
                 branch_id: str | None = None, pov_character_id: str | None = None, svc=Depends(get_author_data)):
    return _call(svc.author_state, project_id, story_card_id=story_card_id, chapter_id=chapter_id, event_ref=event_ref, branch_id=branch_id, pov_character_id=pov_character_id)
