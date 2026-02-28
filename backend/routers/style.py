from fastapi import APIRouter, Depends

from services.style_service import StyleService


def get_style_service() -> StyleService:
    from main import style_service

    return style_service


router = APIRouter(prefix='/api/projects/{project_id}/style')


@router.post('/analyze')
def analyze_style(project_id: str, body: dict, svc: StyleService = Depends(get_style_service)):
    return svc.analyze(project_id, body['style_card_id'], body.get('asset_ids', []), body.get('mode', 'fast'))
