from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from services.wiki_import_service import WikiImportService


def get_wiki() -> WikiImportService:
    from main import wiki_import_service

    return wiki_import_service


router = APIRouter(prefix='/api/projects/{project_id}/wiki')


@router.post('/import')
async def wiki_import(project_id: str, url: str = Form(default=''), kind: str = Form(default='auto'), file: UploadFile | None = File(default=None), svc: WikiImportService = Depends(get_wiki)):
    if file is None:
        if not url:
            raise HTTPException(status_code=400, detail='url or html file required')
        html = f"<html><head><title>{url}</title></head><body><h2>Imported URL</h2><p>{url}</p></body></html>"
    else:
        html = (await file.read()).decode('utf-8', errors='ignore')
    return svc.import_html(project_id, html, url=url, kind=kind)
