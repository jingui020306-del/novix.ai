from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from routers.authoring import get_authoring
from routers.cards import get_change_service, get_store
from services.scene_rehearsal_service import SceneRehearsalService


class RehearsalRequest(BaseModel):
    draft: dict = Field(default_factory=dict)
    source_versions: dict[str, str]
    base_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    instructions: str = Field(default='', max_length=4000)
    llm_profile_id: str | None = None


router = APIRouter(prefix='/api/projects/{project_id}/scene-rehearsals', tags=['scene-rehearsals'])


def _error(exc):
    return HTTPException(409 if isinstance(exc, FileExistsError) else 404 if isinstance(exc, FileNotFoundError) else 400, str(exc))


@router.get('')
def list_rehearsals(project_id: str, chapter_id: str | None = None, story_card_id: str | None = None, store=Depends(get_store)):
    return SceneRehearsalService(store).list(project_id, chapter_id, story_card_id)


@router.get('/{owner_card_id}/{scene_id}')
def get_rehearsal(project_id: str, owner_card_id: str, scene_id: str, store=Depends(get_store)):
    try:
        return SceneRehearsalService(store).get(project_id, owner_card_id, scene_id)
    except (ValueError, FileNotFoundError, FileExistsError) as exc:
        raise _error(exc) from exc


@router.post('/{owner_card_id}/{scene_id}/preview')
def preview_rehearsal(project_id: str, owner_card_id: str, scene_id: str, body: RehearsalRequest, store=Depends(get_store)):
    try:
        service = SceneRehearsalService(store)
        with service_lock(service, project_id):
            return service.preview(project_id, owner_card_id, scene_id, body.model_dump(exclude_none=True))
    except (ValueError, FileNotFoundError, FileExistsError) as exc:
        raise _error(exc) from exc


def service_lock(service, project_id):
    from services.change_suggestion_service import ChangeSuggestionService
    return ChangeSuggestionService(service.store).lock(project_id)


@router.post('/{owner_card_id}/{scene_id}/propose')
async def propose_rehearsal(project_id: str, owner_card_id: str, scene_id: str, body: RehearsalRequest, authoring=Depends(get_authoring)):
    try:
        return await SceneRehearsalService(authoring.store, authoring).propose(project_id, owner_card_id, scene_id, body.model_dump(exclude_none=True))
    except (ValueError, FileNotFoundError, FileExistsError) as exc:
        raise _error(exc) from exc
    except Exception as exc:
        raise HTTPException(502, '模型调用失败，请检查故事构思模型配置后重试；原安排没有改变。') from exc


@router.post('/{owner_card_id}/{scene_id}/confirm')
def confirm_rehearsal(project_id: str, owner_card_id: str, scene_id: str, body: RehearsalRequest, background_tasks: BackgroundTasks, store=Depends(get_store), changes=Depends(get_change_service)):
    try:
        return SceneRehearsalService(store, changes.authoring).confirm(project_id, owner_card_id, scene_id, body.model_dump(exclude_none=True), background_tasks, changes)
    except (ValueError, FileNotFoundError, FileExistsError) as exc:
        raise _error(exc) from exc
