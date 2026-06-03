from pathlib import Path
import io
import json
import uuid
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

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


@router.get('/{project_id}/export.zip')
def export_project_zip(project_id: str, s: FSStore = Depends(get_store)):
    project_dir = s._project_dir(project_id)
    project = s.read_yaml(project_id, 'project.yaml')
    if not project or not project_dir.exists():
        raise HTTPException(status_code=404, detail='Not found')

    buf = io.BytesIO()
    file_count = 0
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(project_dir.rglob('*')):
            if not path.is_file():
                continue
            rel = path.relative_to(project_dir)
            if any(part.startswith('.') for part in rel.parts):
                continue
            zf.write(path, f'{project_id}/{rel.as_posix()}')
            file_count += 1
        manifest = {
            'format': 'novix_project_backup',
            'version': 1,
            'project_id': project_id,
            'project_title': project.get('title', project_id),
            'file_count': file_count,
            'includes': [
                'drafts',
                'cards',
                'canon',
                'volumes',
                'sessions',
                'meta/evidence_marks',
                'meta/trust_reports',
                'meta/chapter_reviews',
                'meta/patch_reviews',
                'meta/jobs',
                'meta/memory_packs',
            ],
        }
        zf.writestr(f'{project_id}/novix_backup_manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    buf.seek(0)
    filename = f'{project_id}-novix-backup.zip'
    return StreamingResponse(
        buf,
        media_type='application/zip',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


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
                    'source_mark_count': len(data.get('source_mark_ids', [])) if isinstance(data, dict) else 0,
                    'dropped_mark_count': len(data.get('dropped_mark_ids', [])) if isinstance(data, dict) else 0,
                    'compression_reason': data.get('compression_reason', '') if isinstance(data, dict) else '',
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
