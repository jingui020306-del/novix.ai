from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from services.kb_service import KBService
from services.material_reader_service import MAX_BYTES, read_file


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
        try:
            material = read_file(await f.read(MAX_BYTES + 1), f.filename or 'upload.txt')
            if not material['text'].strip():
                raise ValueError('此材料尚需视觉识别，请通过“从材料整理”入口核对图片或扫描件。')
            uploaded = kb.upload_text(project_id, kind, f.filename or 'upload.txt', material['text'])
            kb.store.write_json(project_id, uploaded['saved_path'] + '.json', {'source_kind': 'author_reference', 'version': material['version'], 'filename': material['filename']})
            out.append({**uploaded, 'warnings': [*uploaded.get('warnings', []), *material['warnings']]})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return out[0] if len(out) == 1 else {"items": out}


@router.get('/assets/{asset_id}')
def get_asset(project_id: str, asset_id: str, kind: str, kb: KBService = Depends(get_kb)):
    if kind not in {"style_sample", "doc"}:
        raise HTTPException(status_code=400, detail="kind must be style_sample|doc")
    return kb.get_asset_text(project_id, asset_id, kind)
