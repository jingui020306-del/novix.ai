from fastapi import APIRouter, Depends, HTTPException

from services.style_service import StyleService


def get_style_service() -> StyleService:
    from main import style_service

    return style_service


router = APIRouter(prefix='/api/projects/{project_id}/style')


@router.post('/analyze')
def analyze_style(project_id: str, body: dict, svc: StyleService = Depends(get_style_service)):
    try:
        return svc.analyze(project_id, body.get('style_card_id', 'style_001'), body.get('asset_ids', []), body.get('mode', 'fast'), import_id=body.get('import_id'))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
