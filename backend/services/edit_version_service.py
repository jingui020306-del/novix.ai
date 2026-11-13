"""Opaque file versions used by author editors, without changing stored formats."""
import hashlib


def revision(store, project_id, path):
    file = store._safe_path(project_id, path)
    return hashlib.sha256(file.read_bytes()).hexdigest() if file.exists() else ''


def decorate(store, project_id, path, value):
    return {**value, '_revision': revision(store, project_id, path)}


def check_revision(store, project_id, path, expected):
    if expected is not None and (not isinstance(expected, str) or expected != revision(store, project_id, path)):
        raise FileExistsError('这份资料已在另一处更新。当前编辑已保留，请核对最新版本后再保存。')
