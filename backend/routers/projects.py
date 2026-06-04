from pathlib import Path, PurePosixPath
import io
import json
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix="/api/projects")


def _chapter_order(s: FSStore, project_id: str) -> list[str]:
    return [x for x in s.read_md(project_id, 'drafts/.chapter_order').splitlines() if x.strip()]


def _chapter_meta(s: FSStore, project_id: str, chapter_id: str, index: int = 0) -> dict:
    meta = s.read_json(project_id, f'drafts/{chapter_id}.meta.json')
    meta.setdefault('chapter_id', chapter_id)
    meta.setdefault('title', meta.get('chapter_title') or chapter_id)
    meta.setdefault('chapter_title', meta.get('title') or chapter_id)
    meta.setdefault('volume_id', 'volume_default')
    meta.setdefault('order_index', index + 1)
    return meta


def _volume_rows(s: FSStore, project_id: str) -> list[dict]:
    rows = []
    volumes_dir = s._safe_path(project_id, 'volumes')
    if volumes_dir.exists():
        for path in volumes_dir.glob('*.json'):
            row = s.read_json(project_id, f'volumes/{path.name}')
            if row:
                rows.append(row)
    if not any(x.get('id') == 'volume_default' for x in rows):
        rows.append({'id': 'volume_default', 'title': '默认卷', 'summary': '未分卷章节', 'order_index': 0})
    return sorted(rows, key=lambda x: (x.get('order_index', 0), x.get('id', '')))


def _strip_duplicate_heading(content: str, chapter_id: str, title: str) -> str:
    lines = content.strip().splitlines()
    if lines and lines[0].strip().startswith('# '):
        return '\n'.join(lines[1:]).strip()
    return content.strip()


def _safe_restore_member(project_dir: Path, rel: PurePosixPath) -> Path:
    if not rel.parts or any(part in {'', '.', '..'} for part in rel.parts):
        raise HTTPException(status_code=400, detail='invalid backup path')
    target = (project_dir / Path(*rel.parts)).resolve()
    root = project_dir.resolve()
    if target == root or root not in target.parents:
        raise HTTPException(status_code=400, detail='invalid backup path')
    return target


@router.post("")
def create_project(body: dict, s: FSStore = Depends(get_store)):
    pid = f"project_{uuid.uuid4().hex[:8]}"
    s.ensure_project(pid, body.get("title", pid))
    return {"project_id": pid}


@router.post('/import.zip')
async def import_project_zip(file: UploadFile = File(...), s: FSStore = Depends(get_store)):
    if not (file.filename or '').lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail='Only zip backups supported')
    raw = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail='Invalid zip file') from exc

    names = [name for name in zf.namelist() if not name.endswith('/')]
    manifest_name = next((name for name in names if name.endswith('/novix_backup_manifest.json')), '')
    if not manifest_name:
        raise HTTPException(status_code=400, detail='novix backup manifest missing')
    try:
        manifest = json.loads(zf.read(manifest_name).decode('utf-8'))
    except Exception as exc:
        raise HTTPException(status_code=400, detail='invalid backup manifest') from exc
    if manifest.get('format') != 'novix_project_backup':
        raise HTTPException(status_code=400, detail='unsupported backup format')

    root_prefix = manifest_name.rsplit('/', 1)[0]
    old_project_id = str(manifest.get('project_id') or root_prefix or 'project')
    new_project_id = f"restored_{old_project_id}_{uuid.uuid4().hex[:8]}".replace('-', '_')
    restore_members: list[tuple[str, PurePosixPath]] = []
    for name in names:
        if any(part in {'', '.', '..'} for part in name.split('/')):
            raise HTTPException(status_code=400, detail='invalid backup path')
        if not name.startswith(f'{root_prefix}/'):
            continue
        rel = PurePosixPath(name).relative_to(PurePosixPath(root_prefix))
        if rel.name == 'novix_backup_manifest.json':
            continue
        if any(part.startswith('.') for part in rel.parts):
            continue
        restore_members.append((name, rel))

    project_dir = s.ensure_project(new_project_id, f"{manifest.get('project_title') or old_project_id} (restored)")

    restored_files = 0
    for name, rel in restore_members:
        target = _safe_restore_member(project_dir, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(zf.read(name))
        restored_files += 1

    project = s.read_yaml(new_project_id, 'project.yaml')
    project['id'] = new_project_id
    project.setdefault('title', manifest.get('project_title') or new_project_id)
    project['restored_from_project_id'] = old_project_id
    project['restore_source_file'] = file.filename or ''
    s.write_yaml(new_project_id, 'project.yaml', project)
    return {
        'project_id': new_project_id,
        'restored_from_project_id': old_project_id,
        'restored_files': restored_files,
    }


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


@router.get('/{project_id}/export.md')
def export_project_markdown(project_id: str, s: FSStore = Depends(get_store)):
    project = s.read_yaml(project_id, 'project.yaml')
    if not project:
        raise HTTPException(status_code=404, detail='Not found')

    title = project.get('title') or project_id
    chapters = [_chapter_meta(s, project_id, chapter_id, i) for i, chapter_id in enumerate(_chapter_order(s, project_id))]
    by_volume: dict[str, list[dict]] = {}
    for chapter in chapters:
        by_volume.setdefault(chapter.get('volume_id') or 'volume_default', []).append(chapter)

    parts = [f'# {title}', '', f'> novix.ai manuscript export · project: {project_id}', '']
    exported_chapters = 0
    for volume in _volume_rows(s, project_id):
        volume_id = volume.get('id') or 'volume_default'
        rows = sorted(by_volume.pop(volume_id, []), key=lambda x: (x.get('order_index', 0), x.get('chapter_id', '')))
        if not rows:
            continue
        parts.extend([f'## {volume.get("title") or volume_id}', ''])
        if volume.get('summary'):
            parts.extend([str(volume.get('summary')), ''])
        for row in rows:
            chapter_id = row.get('chapter_id')
            chapter_title = row.get('chapter_title') or row.get('title') or chapter_id
            content = _strip_duplicate_heading(s.read_md(project_id, f'drafts/{chapter_id}.md'), chapter_id, chapter_title)
            parts.extend([f'### {chapter_title}', ''])
            if content:
                parts.extend([content, ''])
            exported_chapters += 1
    for volume_id, rows in sorted(by_volume.items()):
        parts.extend([f'## {volume_id}', ''])
        for row in sorted(rows, key=lambda x: (x.get('order_index', 0), x.get('chapter_id', ''))):
            chapter_id = row.get('chapter_id')
            chapter_title = row.get('chapter_title') or row.get('title') or chapter_id
            content = _strip_duplicate_heading(s.read_md(project_id, f'drafts/{chapter_id}.md'), chapter_id, chapter_title)
            parts.extend([f'### {chapter_title}', ''])
            if content:
                parts.extend([content, ''])
            exported_chapters += 1

    parts.extend([f'<!-- exported_chapters: {exported_chapters} -->', ''])
    body = '\n'.join(parts)
    filename = f'{project_id}-manuscript.md'
    return StreamingResponse(
        io.BytesIO(body.encode('utf-8')),
        media_type='text/markdown; charset=utf-8',
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
