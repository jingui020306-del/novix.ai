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
import urllib.error
import urllib.request
import webbrowser
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


def poll_backend_ready(base_url: str, timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    health_url = f"{base_url}/api/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=2) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.5)
    return False


def stream_reader(process: subprocess.Popen) -> int:
    return process.wait()


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
    model_proc: subprocess.Popen | None = None
    model_log = None
    pacing_proc = None
    pacing_log = None

    def handle_signal(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        if not args.no_local_model and model_path().exists():
            port = find_available_port(model_spec()['port'])
            env['NOVIX_LOCAL_MODEL_URL'] = f'http://127.0.0.1:{port}'
            try:
                command = runtime_command(port)
                model_log = (model_path().parent / 'llama-server.log').open('w', encoding='utf-8')
                model_proc = subprocess.Popen(command, stdout=model_log, stderr=subprocess.STDOUT)
                provision_profile(env['NOVIX_LOCAL_MODEL_URL'])
                print('[launcher] 正在加载本地模型…', flush=True)
            except (OSError, ValueError, RuntimeError) as error:
                print(f'[launcher] {error}', file=sys.stderr, flush=True)
        if not args.no_local_model and model_path('pacing').exists():
            try:
                port = find_available_port(model_spec('pacing')['port'])
                env['NOVIX_PACING_MODEL_URL'] = f'http://127.0.0.1:{port}'
                pacing_log = (model_path('pacing').parent / 'pacing-server.log').open('w', encoding='utf-8')
                pacing_proc = subprocess.Popen(runtime_command(port, 'pacing'), stdout=pacing_log, stderr=subprocess.STDOUT)
                print('[launcher] 正在加载节奏分析模型…', flush=True)
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

        model_ready = False
        model_failed = False
        while True:
            if model_proc and not model_failed:
                if model_proc.poll() is not None:
                    model_failed = True
                    print('[launcher] 本地模型启动失败，请查看模型设置与 models/llama-server.log。', file=sys.stderr, flush=True)
                elif not model_ready:
                    try:
                        with urllib.request.urlopen(env['NOVIX_LOCAL_MODEL_URL'] + '/health', timeout=0.5) as response:
                            model_ready = response.status == 200
                        if model_ready:
                            print('[launcher] 本地模型已就绪。', flush=True)
                    except (OSError, TimeoutError):
                        pass
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
        if model_proc:
            terminate_process(model_proc)
        if model_log:
            model_log.close()
        if pacing_proc:
            terminate_process(pacing_proc)
        if pacing_log:
            pacing_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
