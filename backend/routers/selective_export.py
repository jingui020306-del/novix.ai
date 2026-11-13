from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Literal

from routers.cards import get_store
from services.selective_export_service import SelectiveExportService


class ExportItem(BaseModel):
    id: str = Field(min_length=1, max_length=500)


class SelectiveExportRequest(BaseModel):
    items: list[ExportItem] = Field(min_length=1, max_length=100)
    detail: Literal['summary', 'full'] = 'summary'


router = APIRouter(prefix='/api/projects/{project_id}', tags=['selective-export'])


@router.post('/selective-export')
def selective_export(project_id: str, body: SelectiveExportRequest, store=Depends(get_store)):
    try:
        content = SelectiveExportService(store).export(project_id, [item.model_dump() for item in body.items], body.detail)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(content, media_type='text/markdown; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="selected-materials.md"', 'X-Content-Type-Options': 'nosniff'})
