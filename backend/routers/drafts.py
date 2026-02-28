from fastapi import APIRouter, Depends

from storage.fs_store import FSStore, apply_patch_ops


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix='/api/projects/{project_id}/drafts')


@router.get('')
def list_drafts(project_id: str, s: FSStore = Depends(get_store)):
    order = s.read_md(project_id, 'drafts/.chapter_order').splitlines()
    return [c for c in order if c]


@router.get('/{chapter_id}')
def get_draft(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    return {"chapter_id": chapter_id, "content": s.read_md(project_id, f'drafts/{chapter_id}.md')}


@router.put('/{chapter_id}')
def put_draft(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store)):
    s.write_md(project_id, f'drafts/{chapter_id}.md', body.get('content', ''))
    return {"ok": True}


@router.get('/{chapter_id}/meta')
def get_meta(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    return s.read_json(project_id, f'drafts/{chapter_id}.meta.json')


@router.put('/{chapter_id}/meta')
def put_meta(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store)):
    s.write_json(project_id, f'drafts/{chapter_id}.meta.json', body)
    return body


@router.post('/{chapter_id}/apply-patch')
def apply_patch(project_id: str, chapter_id: str, body: dict, s: FSStore = Depends(get_store)):
    original = s.read_md(project_id, f'drafts/{chapter_id}.md')
    updated, diff = apply_patch_ops(original, body.get('ops', []))
    s.write_md(project_id, f'drafts/{chapter_id}.md', updated)
    rec = {"ops": body.get('ops', []), "diff": diff}
    s.append_jsonl(project_id, f'drafts/{chapter_id}.patch.jsonl', rec)
    return {"content": updated, "diff": diff}
