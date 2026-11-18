"""Download and verify the pinned model used by the Novix launcher."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def model_spec(name="default"):
    return json.loads((ROOT / f'models/{name}.json').read_text(encoding='utf-8'))


def model_directory():
    return Path(os.environ.get('NOVIX_MODEL_DIR', ROOT / 'models')).expanduser().resolve()


def file_hash(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def install_model(name="default"):
    spec = model_spec(name)
    for part in spec.get("files", [spec]):
        _install_file({**spec, **part})
    return model_path(name)


def _install_file(spec):
    directory = model_directory()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / spec['file']
    if target.is_file() and target.stat().st_size == spec['size'] and file_hash(target) == spec['sha256']:
        print('本地模型已校验：', target, flush=True)
        return target
    base = f"https://huggingface.co/{spec['repository']}/resolve/{spec['revision']}"
    print(f"正在下载 {spec['name']}，共 {spec['size'] / 1e9:.2f} GB。", flush=True)
    with tempfile.TemporaryDirectory(prefix='.novix-model-', dir=directory) as temp:
        partial = Path(temp) / spec['file']
        for attempt in range(3):
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {'Range': f'bytes={offset}-'} if offset else {}
            try:
                with urlopen(Request(f"{base}/{spec['file']}", headers=headers), timeout=120) as response:
                    resumed = response.status == 206 and response.headers.get('Content-Range', '').startswith(f'bytes {offset}-')
                    offset = offset if resumed else 0
                    with partial.open('ab' if resumed else 'wb') as file:
                        reported = offset // (100 * 1024 * 1024)
                        while chunk := response.read(4 * 1024 * 1024):
                            file.write(chunk)
                            offset += len(chunk)
                            progress = offset // (100 * 1024 * 1024)
                            if progress > reported:
                                print(f"模型下载 {min(100, offset * 100 // spec['size'])}%", flush=True)
                                reported = progress
                if offset != spec['size'] or file_hash(partial) != spec['sha256']:
                    partial.unlink()
                    raise ValueError('模型文件不完整或校验失败。')
                break
            except (OSError, ValueError) as error:
                if attempt == 2:
                    raise RuntimeError('模型下载未完成，请重新运行安装命令。') from error
                print('正在重试模型下载…', flush=True)
                time.sleep(2)
        license_path = Path(temp) / 'MODEL-LICENSE'
        with urlopen(f'{base}/LICENSE', timeout=60) as response:
            license_path.write_bytes(response.read())
        license_path.replace(directory / ('MODEL-LICENSE' if spec['id'] == 'novix_local' else spec['id'] + '-LICENSE'))
        partial.replace(target)
    print('本地模型已安装：', target, flush=True)
    return target


def model_path(name="default"):
    return model_directory() / model_spec(name)['file']


def runtime_command(port, name="default"):
    spec = model_spec(name)
    executable = shutil.which('llama-server')
    if not executable:
        raise RuntimeError('本地模型运行时尚未安装，请重新运行环境安装命令。')
    slots = os.getenv('NOVIX_LOCAL_SLOTS', '1') if name == 'default' else '1'
    if slots not in ('1', '2'):
        raise ValueError('NOVIX_LOCAL_SLOTS 支持 1 或 2。')
    directory = model_directory()
    for part in spec.get('files', [spec]):
        file = directory / part['file']
        if not file.is_file() or file.stat().st_size != part['size'] or file_hash(file) != part['sha256']:
            raise RuntimeError(f"本地模型文件缺失或校验失败：{file.name}。请重新运行环境安装命令。")
    available = len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else (os.cpu_count() or 4)
    threads = os.environ.get('LLAMA_ARG_THREADS') or str(min(8, available))
    path = directory / spec['file']
    # Draft repeated text from the input and verify it with the same pacing model.
    lookup = []
    if name == 'pacing' and not os.getenv('LLAMA_ARG_SPEC_TYPE'):
        lookup = ['--spec-type', 'ngram-simple', '--spec-ngram-simple-size-n', '3',
                  '--spec-ngram-simple-size-m', '6']
    return [executable, '--model', str(path), '--alias', spec['id'],
            '--host', '127.0.0.1', '--port', str(port),
            '--ctx-size', str(spec['context_window'] * int(slots)), '--parallel', slots,
            '--threads', threads, *lookup,
            '--jinja', '--reasoning', 'off', '--reasoning-format', 'deepseek',
            '--chat-template-kwargs', '{"enable_thinking":false}', '--no-warmup']


def provision_profile(base_url):
    from services.llm_config_service import LLMConfigService, TASK_AGENT_MODULES
    cfg = LLMConfigService(ROOT / 'data')
    spec = model_spec()
    profiles = cfg.read_profiles()
    previous = profiles.get(spec['id'], {})
    profile = {**previous, 'provider': 'llama_cpp', 'model': spec['id'],
               'base_url': base_url, 'local_only': True, 'stream': True, 'supports_vision': False,
               'context_window': spec['context_window'], 'display_name': spec['name'],
               'timeout_s': previous.get('timeout_s', 600), 'managed_by': 'novix'}
    if previous != profile:
        cfg.write_profiles({**profiles, spec['id']: profile})
    marker = cfg.global_dir / 'local_model.json'
    installed = json.loads(marker.read_text(encoding='utf-8')) if marker.exists() else {}
    if not installed.get('assignments_initialized'):
        assignments = cfg.read_assignments()
        for module in TASK_AGENT_MODULES:
            if assignments.get(module, 'mock_default') == 'mock_default':
                assignments[module] = spec['id']
        cfg.write_assignments(assignments)
        marker.write_text(json.dumps({'assignments_initialized': True}, ensure_ascii=False), encoding='utf-8')
