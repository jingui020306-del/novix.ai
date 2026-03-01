from pathlib import Path
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix="/api/projects")


@router.post("")
def create_project(body: dict, s: FSStore = Depends(get_store)):
    pid = f"project_{uuid.uuid4().hex[:8]}"
    s.ensure_project(pid, body.get("title", pid))
    return {"project_id": pid}


@router.get("")
def list_projects(s: FSStore = Depends(get_store)):
    return s.list_projects()


@router.get('/{project_id}')
def get_project(project_id: str, s: FSStore = Depends(get_store)):
    data = s.read_yaml(project_id, 'project.yaml')
    if not data:
        raise HTTPException(status_code=404, detail='Not found')
    return data


@router.get('/{project_id}/memory_packs')
def list_memory_packs(project_id: str, chapter_id: str | None = None, s: FSStore = Depends(get_store)):
    base = s._project_dir(project_id) / 'meta' / 'memory_packs'
    if chapter_id:
        roots = [base / chapter_id]
    else:
        roots = [p for p in base.iterdir() if p.is_dir()] if base.exists() else []

    rows = []
    for root in roots:
        if not root.exists():
            continue
        for fp in root.glob('*.json'):
            try:
                data = json.loads(fp.read_text(encoding='utf-8'))
            except Exception:
                data = {}
            ch = root.name
            job = fp.stem
            rows.append({
                'pack_id': f'{ch}:{job}',
                'chapter_id': ch,
                'job_id': job,
                'created_at': fp.stat().st_mtime,
                'summary': {
                    'evidence_count': len(data.get('evidence', [])) if isinstance(data, dict) else 0,
                    'compression_steps': len(data.get('compression_steps', [])) if isinstance(data, dict) else 0,
                },
            })
    rows.sort(key=lambda x: (x['chapter_id'], x['job_id']), reverse=True)
    return rows


@router.get('/{project_id}/memory_packs/{pack_id}')
def get_memory_pack(project_id: str, pack_id: str, s: FSStore = Depends(get_store)):
    if ':' not in pack_id:
        raise HTTPException(status_code=400, detail='pack_id must be chapter_id:job_id')
    chapter_id, job_id = pack_id.split(':', 1)
    if any(x in chapter_id for x in ['..', '/', '\\']) or any(x in job_id for x in ['..', '/', '\\']):
        raise HTTPException(status_code=400, detail='invalid pack_id')
    fp = s._project_dir(project_id) / 'meta' / 'memory_packs' / chapter_id / f'{job_id}.json'
    if not fp.exists():
        raise HTTPException(status_code=404, detail='Not found')
    return json.loads(fp.read_text(encoding='utf-8'))
