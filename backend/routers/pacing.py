from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Literal
from routers.cards import get_store
from services.pacing_service import PacingService
from services.change_suggestion_service import ChangeSuggestionService

router = APIRouter(prefix='/api/projects/{project_id}/pacing')


@router.get('/{story_id}')
def graph(project_id: str, story_id: str, store=Depends(get_store)):
    if store.read_yaml(project_id, f'cards/{story_id}.yaml').get('type') != 'story':
        raise HTTPException(404, '故事不存在。')
    return PacingService(store).graph(project_id, story_id)


class Act(BaseModel):
    act: Literal['', '第一幕', '第二幕', '第三幕']


@router.put('/{story_id}/chapters/{chapter_id}/act')
def set_act(project_id: str, story_id: str, chapter_id: str, body: Act, store=Depends(get_store)):
    if chapter_id not in [c['id'] for c in graph(project_id, story_id, store)['chapters']]:
        raise HTTPException(404, '当前故事没有这一章。')
    with ChangeSuggestionService(store).lock(project_id):
        path = f'drafts/{chapter_id}.meta.json'
        meta = store.read_json(project_id, path)
        store.write_json(project_id, path, {**meta, 'pacing_act': body.act})
    return {'ok': True}
