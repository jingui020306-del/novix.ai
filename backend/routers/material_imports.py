from contextlib import contextmanager

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from routers.authoring import get_authoring
from services.change_suggestion_service import ChangeSuggestionService
from services.material_import_service import MaterialImportService
from services.material_reader_service import MAX_BYTES

router = APIRouter(prefix='/api/projects/{project_id}/material-imports', tags=['material_imports'])


def get_imports(authoring=Depends(get_authoring)):
    return MaterialImportService(authoring.store, authoring)


@contextmanager
def user_errors():
    try:
        yield
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('')
def create(project_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return service.create(project_id, body)


@router.post('/upload')
async def upload(project_id: str, file: UploadFile = File(...), purpose: str = Form('story'), story_card_id: str = Form(''), world_context: str = Form('{}'), reference_scope: str = Form(''), service=Depends(get_imports)):
    with user_errors():
        import json
        try:
            context = json.loads(world_context)
        except ValueError as exc:
            raise ValueError('文件采用的世界背景格式不正确。') from exc
        import asyncio
        return await asyncio.to_thread(service.create_upload, project_id, {'purpose': purpose, 'story_card_id': story_card_id, 'world_context': context, 'reference_scope': reference_scope}, file.file, file.filename)


@router.get('/{batch_id}')
def get(project_id: str, batch_id: str, service=Depends(get_imports)):
    with user_errors():
        return service.get(project_id, batch_id)


@router.put('/{batch_id}')
def update(project_id: str, batch_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return service.update(project_id, batch_id, body)


@router.post('/{batch_id}/sources')
def add_source(project_id: str, batch_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return service.add_source(project_id, batch_id, body)


@router.post('/{batch_id}/sources/upload')
async def add_source_file(project_id: str, batch_id: str, file: UploadFile = File(...), base_revision: str = Form(...), reference_scope: str = Form(''), service=Depends(get_imports)):
    with user_errors():
        import asyncio
        return await asyncio.to_thread(service.create_upload, project_id, {'base_revision': base_revision, 'reference_scope': reference_scope}, file.file, file.filename, batch_id=batch_id)


@router.post('/{batch_id}/complete')
async def complete(project_id: str, batch_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return await service.complete(project_id, batch_id, body)


@router.post('/{batch_id}/extract')
async def extract(project_id: str, batch_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return await service.extract(project_id, batch_id, body)


@router.post('/{batch_id}/apply')
def apply(project_id: str, batch_id: str, body: dict, background_tasks: BackgroundTasks, service=Depends(get_imports)):
    with user_errors():
        result = service.apply(project_id, batch_id, body)
        suggestions = ChangeSuggestionService(service.store, service.authoring)
        with suggestions.lock(project_id):
            record = service._read(project_id, batch_id)
            if record.get('suggestions_queued') is not True:
                task_ids = []
                import json
                try:
                    for operation in record.get('operations', []):
                        if operation['kind'] == 'append':
                            for stage in operation['rows']:
                                task_ids.extend(suggestions.enqueue_stage(project_id, stage['entity_type'], stage['entity_id'], stage)['task_ids'])
                        elif operation['path'].startswith('cards/') and operation['after']:
                            before = operation.get('before_value') or {}
                            after = json.loads(operation['after'])
                            if after['id'] == 'outline_author_registry':
                                previous = {row['id']: row for row in before.get('payload', {}).get('relationship_registry', [])}
                                for row in after['payload'].get('relationship_registry', []):
                                    if row != previous.get(row['id']):
                                        task_ids.extend(suggestions.enqueue_relationship(project_id, row, previous.get(row['id']))['task_ids'])
                            else:
                                task_ids.extend(suggestions.enqueue(project_id, after['id'], before, after)['task_ids'])
                    record['suggestions_queued'] = True
                except Exception:
                    record['suggestions_error'] = '资料已分配，部分正文检查未能排队；可重试检查，已确认资料不会回退。'
                result = service._save(project_id, record)
                if task_ids:
                    background_tasks.add_task(suggestions.process, project_id, task_ids)
                result['change_suggestions'] = {'queued_count': len(task_ids), 'task_ids': task_ids, 'error': record.get('suggestions_error', '')}
        return result


@router.post('/{batch_id}/undo')
def undo(project_id: str, batch_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return service.undo(project_id, batch_id, body)


@router.post('/{batch_id}/rebase')
def rebase(project_id: str, batch_id: str, body: dict, service=Depends(get_imports)):
    with user_errors():
        return service.rebase(project_id, batch_id, body)


@router.post('/{batch_id}/cancel')
def cancel(project_id: str, batch_id: str, service=Depends(get_imports)):
    with user_errors():
        return service.cancel(project_id, batch_id)


@router.get('/{batch_id}/source')
def source(project_id: str, batch_id: str, source_id: str | None = None, page: int | None = None, view: str | None = None, service=Depends(get_imports)):
    with user_errors():
        record = service._read(project_id, batch_id)
        material = next((row for row in service._sources(record) if row['id'] == source_id), None) if source_id else record['source']
        if not material:
            raise FileNotFoundError('这份原材料不存在。')
        if view == 'text':
            if page is not None and not 1 <= page <= material.get('page_count', 0):
                raise ValueError('请选择原PDF中实际存在的页面。')
            selected_page = page or (1 if material.get('lazy_pdf') else None)
            return {'source_id': material['id'], **service.source_content(project_id, material, page_numbers={selected_page} if selected_page else None),
                'selected_page': selected_page, 'page_count': material.get('page_count'), 'coverage': material.get('coverage'), 'warnings': material.get('warnings', [])}
        if page is not None:
            return FileResponse(service.pdf_page_path(project_id, batch_id, material['id'], page), media_type='image/png')
        path = material.get('raw_path')
        if not path:
            raise FileNotFoundError('这份材料没有附加原文件，可在原文区查看文字。')
        return FileResponse(service.store._safe_path(project_id, path), media_type=material.get('mime_type', 'application/octet-stream'))
