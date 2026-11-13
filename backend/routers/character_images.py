from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from routers.authoring import get_authoring
from routers.cards import get_store
from services.character_image_service import CharacterImageService, MAX_IMAGE_BYTES


class ImageAnalysisRequest(BaseModel):
    asset_id: str = Field(pattern=r'^img_[a-f0-9]{24}$')
    llm_profile_id: str | None = None
    instructions: str = Field(default='', max_length=4000)


router = APIRouter(prefix='/api/projects/{project_id}/character-images', tags=['character-images'])


@router.post('')
async def upload_character_image(project_id: str, file: UploadFile = File(...), store=Depends(get_store)):
    data = await file.read(MAX_IMAGE_BYTES + 1)
    try:
        return CharacterImageService(store).upload(project_id, data, file.filename)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/analyze')
async def analyze_character_image(project_id: str, body: ImageAnalysisRequest, authoring=Depends(get_authoring)):
    try:
        return await CharacterImageService(authoring.store, authoring).analyze(project_id, body.model_dump(exclude_none=True))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '该模型未能读取图片，请选择支持视觉的模型并检查服务配置后重试。') from exc


@router.get('/{asset_id}')
def get_character_image(project_id: str, asset_id: str, store=Depends(get_store)):
    try:
        record, path, _ = CharacterImageService(store).resolve(project_id, asset_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(path, media_type=record['mime_type'], headers={'X-Content-Type-Options': 'nosniff'})
