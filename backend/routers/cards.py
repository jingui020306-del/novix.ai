from pathlib import Path
import copy
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from storage.fs_store import FSStore
from services.incremental_memory_service import IncrementalMemoryService
from services.shared_material_service import SharedMaterialService
from services.change_suggestion_service import ChangeSuggestionService
from services.authoring_service import AuthoringService
from storage.fs_store import now_iso
from services.edit_version_service import check_revision, decorate


def get_store() -> FSStore:
    from main import store

    return store


def get_change_service(s: FSStore = Depends(get_store)):
    from main import job_manager
    # Isolated stores must explicitly inject their own model gateway.
    return ChangeSuggestionService(s, AuthoringService(job_manager) if job_manager.store is s else None)


router = APIRouter(prefix="/api/projects/{project_id}")


def _card_path(card_id: str) -> str:
    return f"cards/{card_id}.yaml"


def _validate_references(card: dict) -> None:
    payload = card.get('payload')
    if not isinstance(payload, dict) or 'writing_references' not in payload:
        return
    refs = payload['writing_references']
    if not isinstance(refs, list) or any(not isinstance(rid, str) or not re.fullmatch(r'[\w-]+', rid) for rid in refs):
        raise HTTPException(status_code=400, detail='选用的写作参考格式不正确，请重新选择。')


@router.get('/cards')
def list_cards(project_id: str, type: str | None = None, s: FSStore = Depends(get_store)):
    cards_dir = s._safe_path(project_id, 'cards')
    out = []
    for f in cards_dir.glob('*.yaml'):
        c = s.read_yaml(project_id, str(Path('cards') / f.name))
        if not type or c.get('type') == type:
            out.append(decorate(s, project_id, str(Path('cards') / f.name), c))
    return out


def _save_card(project_id, card_id, card, s, background_tasks, change_service, *, suggestion_scope=None, queue_suggestions=True):
    if not isinstance(change_service, ChangeSuggestionService):
        change_service = ChangeSuggestionService(s)
    _validate_references(card)
    with change_service.lock(project_id):
        try:
            check_revision(s, project_id, _card_path(card_id), card.get('_revision'))
            if '_source_versions' in card:
                versions = card['_source_versions']
                if not isinstance(versions, dict) or len(versions) > 100:
                    raise ValueError('分析依据的版本格式不正确。')
                for source_path, expected in versions.items():
                    if not isinstance(source_path, str) or not source_path.startswith(('assets/style_samples/', 'sessions/material_imports/')):
                        raise ValueError('分析依据不属于可采用的参考材料。')
                    check_revision(s, project_id, source_path, expected)
        except FileExistsError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        before = s.read_yaml(project_id, _card_path(card_id))
        card = {key: value for key, value in card.items() if key not in {'change_suggestions', '_revision', '_source_versions'}}
        if suggestion_scope is None and isinstance(card.get('payload'), dict):
            old_payload = before.get('payload') if isinstance(before.get('payload'), dict) else {}
            old_rows = {str(row.get('id') or f'index_{index}'): row for index, row in enumerate(old_payload.get('important_scenes', []) or []) if isinstance(row, dict)}
            card = copy.deepcopy(card)
            for index, row in enumerate(card.get('payload', {}).get('important_scenes', []) or []):
                if not isinstance(row, dict):
                    continue
                current = old_rows.get(str(row.get('id') or f'index_{index}'), {}).get('rehearsal')
                if current:
                    if row.get('rehearsal') is not None and row['rehearsal'] != current:
                        raise HTTPException(409, '本场安排已在另一处更新，请重新载入后保存；不会覆盖已确认推演。')
                    row['rehearsal'] = copy.deepcopy(current)
        try:
            SharedMaterialService(s).validate_card(project_id, card_id, card, before)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        comparable = lambda value: {key: item for key, item in value.items() if key != 'updated_at'}
        if comparable(before) == comparable(card):
            return {**decorate(s, project_id, _card_path(card_id), before), 'change_suggestions': {'queued_count': 0, 'task_ids': []}}
        payload = card.get('payload', {})
        origins = payload.get('field_provenance', {})
        if not isinstance(origins, dict) or any(kind not in {'material_fact', 'character_statement', 'inference', 'ai_addition', 'author_edit'} for kind in origins.values()):
            raise HTTPException(400, '字段来源分类不正确。')
        previous = before.get('payload', {})
        changed_fields = {key for key, value in payload.items() if key not in {'field_provenance', 'sources', 'import_source_keys'} and previous.get(key) != value}
        if changed_fields:
            payload['field_provenance'] = {**previous.get('field_provenance', {}), **origins, **{key: 'ai_addition' if origins.get(key) == 'ai_addition' else 'author_edit' for key in changed_fields}}
        card['updated_at'] = now_iso()
        s.write_yaml(project_id, _card_path(card_id), card)
        IncrementalMemoryService(s).mark(project_id, _card_path(card_id))
        if not queue_suggestions:
            return {**decorate(s, project_id, _card_path(card_id), card), 'change_suggestions': {'queued_count': 0, 'task_ids': []}}
        try:
            queued = change_service.enqueue(project_id, card_id, before, card, suggestion_scope=suggestion_scope)
        except Exception:
            # The author version is already saved; suggestion preparation must not undo it.
            queued = {'queued_count': 0, 'task_ids': [], 'error': '设定已保存，但修改建议排队失败，请稍后重试。'}
    if queued['task_ids'] and background_tasks is not None:
        background_tasks.add_task(change_service.process, project_id, queued['task_ids'])
    return {**decorate(s, project_id, _card_path(card_id), card), 'change_suggestions': queued}


@router.post('/cards')
def create_card(project_id: str, card: dict, s: FSStore = Depends(get_store), background_tasks: BackgroundTasks = None, change_service=Depends(get_change_service)):
    return _save_card(project_id, card['id'], card, s, background_tasks, change_service)


@router.get('/cards/{card_id}')
def get_card(project_id: str, card_id: str, s: FSStore = Depends(get_store)):
    c = s.read_yaml(project_id, _card_path(card_id))
    if not c:
        raise HTTPException(status_code=404, detail='Not found')
    return decorate(s, project_id, _card_path(card_id), c)


@router.put('/cards/{card_id}')
def update_card(project_id: str, card_id: str, card: dict, s: FSStore = Depends(get_store), background_tasks: BackgroundTasks = None, change_service=Depends(get_change_service)):
    return _save_card(project_id, card_id, card, s, background_tasks, change_service)


@router.delete('/cards/{card_id}')
def delete_card(project_id: str, card_id: str, s: FSStore = Depends(get_store)):
    from services.author_control_service import AuthorControlService
    controls = AuthorControlService(s)
    with controls.lock(project_id):
        path = s._safe_path(project_id, _card_path(card_id))
        controls.assert_write(project_id, _card_path(card_id), s.read_yaml(project_id, _card_path(card_id)), None)
        if path.exists():
            path.unlink()
            IncrementalMemoryService(s).mark(project_id, _card_path(card_id))
    return {"deleted": True}
