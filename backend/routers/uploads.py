from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from services.kb_service import KBService


def get_kb() -> KBService:
    from main import kb_service

    return kb_service


router = APIRouter(prefix='/api/projects/{project_id}')


@router.post('/uploads')
async def upload(project_id: str, file: UploadFile = File(...), kind: str = Form(...), kb: KBService = Depends(get_kb)):
    if kind not in {"style_sample", "doc"}:
        raise HTTPException(status_code=400, detail="kind must be style_sample|doc")
    if not (file.filename or "").lower().endswith((".txt", ".md")):
        raise HTTPException(status_code=400, detail="Only txt/md supported")
    raw = (await file.read()).decode("utf-8", errors="ignore")
    return kb.upload_text(project_id, kind, file.filename or "upload.txt", raw)
