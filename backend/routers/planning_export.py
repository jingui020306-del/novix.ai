from datetime import datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from routers.cards import get_store
from services.planning_export_service import export_planning_workbook


class PlanningExportRequest(BaseModel):
    planning_card: dict
    story_card: dict | None = None


router = APIRouter(prefix='/api/projects/{project_id}/story-planning', tags=['story-planning'])


@router.post('/export')
def export(project_id: str, body: PlanningExportRequest, store=Depends(get_store)):
    labels = {}
    for path in store._safe_path(project_id, 'cards').glob('*.yaml'):
        card = store.read_yaml(project_id, f'cards/{path.name}')
        if card.get('id'):
            labels[card['id']] = str(card.get('title') or card['id'])
    chapter_order = store.read_md(project_id, 'drafts/.chapter_order').splitlines()
    for chapter in chapter_order:
        meta = store.read_json(project_id, f'drafts/{chapter}.meta.json')
        labels[chapter] = str(meta.get('title') or meta.get('chapter_title') or chapter)
    try:
        content = export_planning_workbook(body.planning_card, labels, chapter_order)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    filename = '情节工作表-' + datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d-%H%M') + '.xlsx'
    return Response(content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(filename)}"})
