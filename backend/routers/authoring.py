from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from services.authoring_service import AuthoringService
from services.writing_run_service import WritingRunService
from services.knowledge_graph_service import KnowledgeGraphService
from services.story_planning_service import StoryPlanningService
from services.shared_material_service import SharedMaterialService
from services.change_suggestion_service import ChangeSuggestionService
from routers.cards import get_change_service


def get_authoring() -> AuthoringService:
    from main import job_manager
    return AuthoringService(job_manager)


def get_runs() -> WritingRunService:
    from main import writing_runs
    return writing_runs


class DialogueScene(BaseModel):
    owner_card_id: str = Field(pattern=r'^[\w-]+$', max_length=120)
    scene_id: str = Field(pattern=r'^[\w-]+$', max_length=120)


class RevisionRequest(BaseModel):
    source_text: str = Field(max_length=100000)
    start: int = Field(default=0, ge=0)
    end: int | None = Field(default=None, ge=0)
    scene_ref: DialogueScene | None = None
    editor_revision: str | None = Field(default=None, max_length=128)
    mode: Literal['polish', 'rewrite', 'cinematic', 'dialogue'] = 'polish'
    scene_direction: dict | None = None
    allow_plot_change: bool = False
    instructions: str = Field(default='', max_length=4000)
    llm_profile_id: str | None = None
    story_card_id: str | None = Field(default=None, pattern=r'^[\w-]+$', max_length=120)


class RevisionApply(RevisionRequest):
    dialogue_hash: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    text: str = Field(min_length=1, max_length=100000)
    base_hash: str = Field(pattern=r'^[a-f0-9]{64}$')


class RunRequest(BaseModel):
    chapter_id: str = Field(pattern=r'^[\w-]+$', max_length=120)
    blueprint_id: str = Field(default='blueprint_001', pattern=r'^[\w-]+$', max_length=120)
    scene_index: int = Field(default=0, ge=0)
    scope: Literal['chapter', 'chapters', 'beat', 'volume', 'book'] = 'chapter'
    stop_point: Literal['chapter', 'beat', 'volume', 'risk', 'end'] = 'chapter'
    start_chapter: str = ''
    end_chapter: str = ''
    start_beat: int = Field(default=0, ge=0)
    end_beat: int | None = Field(default=None, ge=0)
    llm_profile_id: str | None = None
    auto_apply_patch: bool = False
    constraints: dict = Field(default_factory=dict)
    generation_control: dict = Field(default_factory=dict)


class FieldRequest(BaseModel):
    card: dict
    path: list[str] = Field(min_length=1, max_length=12)
    llm_profile_id: str | None = None
    world_context: dict | None = None
    story_card_id: str | None = Field(default=None, pattern=r'^[\w-]+$', max_length=120)
    chapter_id: str | None = Field(default=None, pattern=r'^[\w-]+$', max_length=120)
    event_ref: str | None = None
    pov_character_id: str | None = Field(default=None, pattern=r'^[\w-]+$', max_length=120)


class PlanningRequest(BaseModel):
    story_card: dict
    planning_card: dict
    table: Literal['important_scenes', 'character_intersections', 'character_storylines', 'beat_sheet']
    row: dict | None = None
    field: str | None = None
    mode: Literal['extract', 'suggest'] = 'extract'
    llm_profile_id: str | None = None


class SuggestionApply(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=100000)
    accept_op_ids: list[str] | None = None


class SkeletonRequest(BaseModel):
    story_card: dict
    planning_card: dict
    source_text: str | None = Field(default=None, max_length=24000)
    skeleton: dict | None = None
    base_hash: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    source_versions: dict[str, str] = Field(default_factory=dict)
    llm_profile_id: str | None = None


router = APIRouter(prefix='/api/projects/{project_id}', tags=['authoring'])


@router.get('/writing-strategies')
def writing_strategies(project_id: str):
    from services.prose_strategy_service import STRATEGIES
    return {'items': STRATEGIES}


@router.post('/story-planning/skeleton/prepare')
def prepare_story_skeleton(project_id: str, body: SkeletonRequest, svc: AuthoringService = Depends(get_authoring)):
    try:
        return StoryPlanningService(svc.store, svc).prepare_skeleton(project_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/story-planning/skeleton/propose')
async def propose_story_skeleton(project_id: str, body: SkeletonRequest, svc: AuthoringService = Depends(get_authoring)):
    try:
        return await StoryPlanningService(svc.store, svc).propose_skeleton(project_id, body.model_dump(exclude_none=True))
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '故事骨架提取失败，请检查故事构思模型后重试；已有资料没有改变。') from exc


@router.post('/story-planning/skeleton/apply')
def apply_story_skeleton(project_id: str, body: SkeletonRequest, svc: AuthoringService = Depends(get_authoring)):
    try:
        return StoryPlanningService(svc.store, svc).apply_skeleton(project_id, body.model_dump(exclude_none=True))
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/materials')
def material_catalog(project_id: str, svc: AuthoringService = Depends(get_authoring)):
    return SharedMaterialService(svc.store).catalog(project_id)


@router.get('/backlinks/{target_id}')
def material_backlinks(project_id: str, target_id: str, svc: AuthoringService = Depends(get_authoring)):
    try:
        return SharedMaterialService(svc.store).backlinks(project_id, target_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/change-suggestions')
def change_suggestions(project_id: str, svc: ChangeSuggestionService = Depends(get_change_service)):
    return svc.list(project_id)


@router.post('/change-suggestions/{task_id}/apply')
def apply_change_suggestion(project_id: str, task_id: str, body: SuggestionApply, svc: ChangeSuggestionService = Depends(get_change_service)):
    try:
        return svc.apply(project_id, task_id, body.text, accept_op_ids=body.accept_op_ids)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/change-suggestions/{task_id}/dismiss')
def dismiss_change_suggestion(project_id: str, task_id: str, svc: ChangeSuggestionService = Depends(get_change_service)):
    try:
        return svc.dismiss(project_id, task_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post('/change-suggestions/{task_id}/retry')
def retry_change_suggestion(project_id: str, task_id: str, background_tasks: BackgroundTasks, svc: ChangeSuggestionService = Depends(get_change_service)):
    try:
        record = svc.retry(project_id, task_id)
        background_tasks.add_task(svc.process, project_id, [task_id])
        return record
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/change-suggestions/{task_id}/cancel')
def cancel_change_suggestion(project_id: str, task_id: str, svc: ChangeSuggestionService = Depends(get_change_service)):
    try:
        return svc.cancel(project_id, task_id)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/change-suggestions/{task_id}/undo')
def undo_change_suggestion(project_id: str, task_id: str, svc: ChangeSuggestionService = Depends(get_change_service)):
    try:
        return svc.undo(project_id, task_id)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/story-planning/propose')
async def propose_story_planning(project_id: str, body: PlanningRequest, svc: AuthoringService = Depends(get_authoring)):
    try:
        return await StoryPlanningService(svc.store, svc).propose(project_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '模型调用失败，请检查模型设置后重试。') from exc


@router.post('/cards/generate-field')
async def generate_field(project_id: str, body: FieldRequest, svc: AuthoringService = Depends(get_authoring)):
    try:
        return await svc.generate_field(project_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '模型调用失败，请检查服务地址、密钥和模型名称后重试。') from exc


@router.get('/knowledge-graph')
def knowledge_graph(project_id: str, chapter_id: str | None = None, event_ref: str | None = None, stage: str = 'after',
                    story_card_id: str | None = None, branch_id: str | None = None, pov_character_id: str | None = None, svc: AuthoringService = Depends(get_authoring)):
    try:
        return KnowledgeGraphService(svc.store).graph(project_id, chapter_id, event_ref=event_ref, stage=stage, story_card_id=story_card_id, branch_id=branch_id, pov_character_id=pov_character_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/chapters/{chapter_id}/revise')
async def revise(project_id: str, chapter_id: str, body: RevisionRequest, svc: AuthoringService = Depends(get_authoring)):
    data = body.model_dump(exclude_none=True)
    try:
        return await svc.revise(project_id, chapter_id, data)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '模型调用失败，请检查服务地址、密钥和模型名称后重试。') from exc


@router.post('/chapters/{chapter_id}/revise/apply')
async def apply_revision(project_id: str, chapter_id: str, body: RevisionApply, svc: AuthoringService = Depends(get_authoring)):
    try:
        result = svc.apply_revision(project_id, chapter_id, body.model_dump(exclude_none=True))
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result


@router.get('/writing-runs')
def list_runs(project_id: str, svc: WritingRunService = Depends(get_runs)):
    return svc.list(project_id)


@router.post('/writing-runs')
async def create_run(project_id: str, body: RunRequest, svc: WritingRunService = Depends(get_runs)):
    data = body.model_dump(exclude_none=True)
    tokens = data['constraints'].get('max_tokens', 2400)
    if isinstance(tokens, bool) or not isinstance(tokens, int) or not 128 <= tokens <= 16000:
        raise HTTPException(400, '每段生成长度必须在 128 到 16000 个输出单位之间。')
    try:
        return await svc.create(project_id, data)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        from services.context_pack_service import MaterialBudgetError
        if isinstance(exc, MaterialBudgetError):
            raise HTTPException(400, {'message': str(exc), **exc.report}) from exc
        raise HTTPException(400, str(exc)) from exc


@router.post('/generation-materials/preview')
def preview_generation_materials(project_id: str, body: RunRequest, svc: AuthoringService = Depends(get_authoring)):
    from services.generation_material_service import GenerationMaterialService
    try:
        return GenerationMaterialService(svc.manager).prepare(project_id, body.model_dump(exclude_none=True))
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/writing-runs/{run_id}/{action}')
async def control_run(project_id: str, run_id: str, action: Literal['pause', 'resume', 'stop'], svc: WritingRunService = Depends(get_runs)):
    try:
        return await svc.control(project_id, run_id, action)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
