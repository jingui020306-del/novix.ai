from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from services.kb_service import KBService


def get_kb() -> KBService:
    from main import kb_service

    return kb_service


router = APIRouter(prefix='/api/projects/{project_id}')


@router.post('/uploads')
async def upload(project_id: str, files: list[UploadFile] = File(default=[]), file: UploadFile | None = File(default=None), kind: str = Form(...), kb: KBService = Depends(get_kb)):
    if kind not in {"style_sample", "doc"}:
        raise HTTPException(status_code=400, detail="kind must be style_sample|doc")
    all_files = files or ([] if file is None else [file])
    if not all_files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    out = []
    for f in all_files:
        if not (f.filename or "").lower().endswith((".txt", ".md")):
            raise HTTPException(status_code=400, detail="Only txt/md supported")
        raw = (await f.read()).decode("utf-8", errors="ignore")
        out.append(kb.upload_text(project_id, kind, f.filename or "upload.txt", raw))
    return out[0] if len(out) == 1 else {"items": out}


@router.get('/assets/{asset_id}')
def get_asset(project_id: str, asset_id: str, kind: str, kb: KBService = Depends(get_kb)):
    if kind not in {"style_sample", "doc"}:
        raise HTTPException(status_code=400, detail="kind must be style_sample|doc")
    return kb.get_asset_text(project_id, asset_id, kind)
