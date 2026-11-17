#!/usr/bin/env python3
"""Unified launcher for Novix backend/frontend dev and prod modes."""

from __future__ import annotations

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"
sys.path.insert(0, str(BACKEND_DIR))
from services.local_model_service import model_spec, model_path, runtime_command, provision_profile


def find_available_port(start_port: int) -> int:
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
        port += 1


LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def is_ready(url: str, timeout: float) -> bool:
    try:
        with LOCAL_HTTP.open(url, timeout=timeout) as response:
            return response.status == 200
    except OSError:
        return False


def poll_backend_ready(base_url: str, timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    health_url = f"{base_url}/api/health"
    while time.time() < deadline:
        if is_ready(health_url, timeout=2):
            return True
        time.sleep(0.5)
    return False


@dataclass
class ManagedModel:
    name: str
    port: int
    log: Path
    command: list[str]
    process: subprocess.Popen | None = None


def terminate_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()


def has_static_bundle() -> bool:
    for candidate in (BACKEND_DIR / "static", BACKEND_DIR / "static_dist"):
        if (candidate / "index.html").exists():
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch Novix backend + frontend")
    parser.add_argument("--prod", action="store_true", help="Serve bundled frontend from backend if static bundle exists")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open browser")
    parser.add_argument("--no-local-model", action="store_true", help="Start the app using externally managed models")
    args = parser.parse_args()

    engine_setup = [sys.executable, str(BACKEND_DIR / "rehearsal_engines" / "install.py")]
    if args.no_local_model or os.environ.get("NOVIX_PACING_MODEL_URL") or model_path("pacing").is_file():
        engine_setup.append("--skip-pacing")
    setup = subprocess.run(engine_setup)
    if setup.returncode:
        print("[backend] Local analysis setup incomplete. See installer output.", file=sys.stderr)

    backend_port = find_available_port(8000)
    frontend_port = find_available_port(5173)
    backend_url = f"http://127.0.0.1:{backend_port}"

    env = os.environ.copy()
    env["NOVIX_BACKEND_PORT"] = str(backend_port)
    env["NOVIX_FRONTEND_PORT"] = str(frontend_port)
    env["NOVIX_SERVE_STATIC"] = "1" if args.prod else "0"

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(backend_port),
    ]
    backend_proc: subprocess.Popen | None = None
    frontend_proc: subprocess.Popen | None = None
    models: list[ManagedModel] = []
    loading: ManagedModel | None = None

    def handle_signal(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        for name, url_key, log_name in (
            ('default', 'NOVIX_LOCAL_MODEL_URL', 'llama-server.log'),
            ('pacing', 'NOVIX_PACING_MODEL_URL', 'pacing-server.log'),
        ):
            if args.no_local_model or not model_path(name).exists():
                continue
            if name == 'pacing' and env.get(url_key):
                continue
            spec = model_spec(name)
            port = find_available_port(max(spec['port'], models[-1].port + 1) if models else spec['port'])
            try:
                command = runtime_command(port, name)
                url = f'http://127.0.0.1:{port}'
                if name == 'default':
                    provision_profile(url)
                models.append(ManagedModel(spec['name'], port, model_path(name).parent / log_name, command))
                env[url_key] = url
            except (OSError, ValueError, RuntimeError) as error:
                print(f'[launcher] {error}', file=sys.stderr, flush=True)
        backend_proc = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR, env=env)
        if not poll_backend_ready(backend_url):
            print("[ERROR] backend did not become ready in time", file=sys.stderr)
            return 1

        use_static = args.prod and has_static_bundle()
        if use_static:
            print(f"[launcher] backend ready: {backend_url} (serving static bundle)")
            target_url = backend_url
        else:
            frontend_cmd = ["npm.cmd" if os.name == "nt" else "npm", "run", "dev", "--", "--port", str(frontend_port), "--strictPort"]
            frontend_proc = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR, env=env)
            print(f"[launcher] backend ready: {backend_url}")
            print(f"[launcher] frontend dev server: http://127.0.0.1:{frontend_port}")
            target_url = f"http://127.0.0.1:{frontend_port}"

        if not args.no_browser:
            webbrowser.open(target_url)

        # Each runtime sizes its GPU allocation using the memory left by the previous one.
        pending = iter(models)
        while True:
            if loading is None:
                model = next(pending, None)
                if model is not None:
                    try:
                        with model.log.open('w', encoding='utf-8') as log:
                            model.process = subprocess.Popen(model.command, stdout=log, stderr=subprocess.STDOUT)
                        loading = model
                        print(f'[launcher] 正在加载 {model.name}…', flush=True)
                    except OSError as error:
                        print(f'[launcher] {error}', file=sys.stderr, flush=True)
            for model in models:
                if model.process and model.process.poll() is not None:
                    print(f'[launcher] 模型进程已退出，请查看 {model.log}。', file=sys.stderr, flush=True)
                    model.process = None
                    if model is loading:
                        loading = None
                elif model is loading and is_ready(f'http://127.0.0.1:{model.port}/health', timeout=0.5):
                    print(f'[launcher] {model.name} 已就绪。', flush=True)
                    loading = None
            if backend_proc.poll() is not None:
                return backend_proc.returncode or 0
            if frontend_proc and frontend_proc.poll() is not None:
                return frontend_proc.returncode or 0
            time.sleep(0.5)
    except KeyboardInterrupt:
        return 0
    finally:
        if frontend_proc:
            terminate_process(frontend_proc)
        if backend_proc:
            terminate_process(backend_proc)
        for model in models:
            if model.process:
                terminate_process(model.process)


if __name__ == "__main__":
    raise SystemExit(main())
