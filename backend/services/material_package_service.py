"""Bounded ZIP inventory and streamed source preservation, without executing contents."""
import hashlib
import json
import shutil
import stat
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath

from services.material_reader_service import MAX_BYTES, read_file
from storage.fs_store import now_iso

MAX_PACKAGE_BYTES = 512 * 1024 * 1024
MAX_PACKAGE_EXPANDED = 2 * 1024 * 1024 * 1024
MAX_PACKAGE_FILES = 10000


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_package(store, project_id, batch_id, path, filename, *, reference_scope=None):
    path = Path(path)
    if not 0 < path.stat().st_size <= MAX_PACKAGE_BYTES:
        raise ValueError('资料包须非空且不超过512 MB。')
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ValueError('资料包不是有效的ZIP文件。') from exc
    with archive:
        entries, names, total = [], set(), 0
        if len(archive.infolist()) > MAX_PACKAGE_FILES:
            raise ValueError('资料包目录与文件超过10000项，请拆包导入。')
        for info in archive.infolist():
            name = unicodedata.normalize('NFC', info.filename)
            parts = PurePosixPath(name)
            if not parts.parts or '\\' in name or '\x00' in name or parts.is_absolute() or '..' in parts.parts or re_drive(name) or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('资料包含有越界路径或符号链接，请移除后重新上传。')
            if info.is_dir():
                continue
            key = str(parts).casefold()
            if key in names:
                raise ValueError('资料包含有重复文件路径，请先明确版本或目录。')
            names.add(key)
            total += info.file_size
            if len(names) > MAX_PACKAGE_FILES or total > MAX_PACKAGE_EXPANDED:
                raise ValueError('资料包超过10000文件或解压后2 GB，请拆包导入。')
            if info.flag_bits & 1:
                raise ValueError('加密资料包暂不能读取，请解密后上传。')
            entries.append((info, str(parts)))
        version = file_hash(path)
        scoped_version = hashlib.sha256((version + json.dumps(reference_scope or {}, ensure_ascii=False, sort_keys=True)).encode()).hexdigest()
        root_id = 'source_' + scoped_version[:18]
        root_path = f'sessions/material_imports/{batch_id}/{root_id}.zip'
        destination = store._safe_path(project_id, root_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        members = []
        for info, original_path in entries:
            identity = 'source_' + hashlib.sha256((scoped_version + ':' + original_path).encode()).hexdigest()[:18]
            relative = f'sessions/material_imports/{batch_id}/files/{identity}/{PurePosixPath(original_path).name}'
            target = store._safe_path(project_id, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            error = None
            try:
                with archive.open(info) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
            except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
                error = str(exc)
                target.unlink(missing_ok=True)
            item = {'id': identity, 'filename': PurePosixPath(original_path).name, 'package_path': original_path,
                    'package_source_id': root_id, 'raw_path': relative if not error else None, 'version': file_hash(target) if not error else identity, 'kind': 'author_reference',
                    'mime_type': 'application/octet-stream', 'coverage': 'unread', 'warnings': [], 'text': '', 'original_text': '', 'bytes': info.file_size}
            try:
                if error:
                    raise ValueError('这个成员未成功解压；原包保留，须核对文件：' + error)
                if info.file_size > MAX_BYTES and item['filename'].lower().endswith('.pdf'):
                    from services.material_import_service import MaterialImportService
                    parsed = MaterialImportService(store).preserve_large_pdf(project_id, batch_id, target, item['filename'], reference_scope or {}, existing_relative=relative)
                    item.update(parsed, id=identity, package_path=original_path, package_source_id=root_id, bytes=info.file_size)
                    members.append(item)
                    continue
                if info.file_size > MAX_BYTES:
                    raise ValueError('原文件已保留，单文件超过12 MB，尚未读取；请按页或拆分后继续。')
                parsed = read_file(target.read_bytes(), item['filename'], allow_long=True)
                text_path = f'sessions/material_imports/{batch_id}/text/{identity}.json'
                text_file = store._safe_path(project_id, text_path)
                text_file.parent.mkdir(parents=True, exist_ok=True)
                text_file.write_text(json.dumps({key: parsed[key] for key in ['text', 'original_text', 'pages'] if key in parsed}, ensure_ascii=False), encoding='utf-8')
                item.update({key: value for key, value in parsed.items() if key not in {'text', 'original_text', 'pages'}})
                item.update(text_path=text_path, char_count=len(parsed.get('text', '')))
                if parsed.get('pages'):
                    item['pages'] = [{key: value for key, value in page.items() if key != 'text'} for page in parsed['pages']]
            except (ValueError, OSError, zipfile.BadZipFile) as exc:
                item['warnings'].append(str(exc))
            members.append(item)
        root = {'id': root_id, 'filename': Path(filename).name, 'version': version, 'raw_path': root_path, 'mime_type': 'application/zip',
                'kind': 'author_reference', 'is_package': True, 'coverage': 'package_inventory', 'text': '', 'original_text': '',
                'fetched_at': now_iso(), 'warnings': ['原包和目录已保留；各文件读取与视觉覆盖分别报告，目录已列出不代表内容已全部识别。'],
                'inventory': [{'source_id': item['id'], 'path': item['package_path'], 'bytes': item['bytes'], 'coverage': item['coverage']} for item in members]}
        return root, members


def re_drive(name):
    return len(name) > 1 and name[1] == ':'
