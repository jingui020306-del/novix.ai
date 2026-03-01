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
    backend_proc = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR, env=env)
    frontend_proc: subprocess.Popen | None = None

    try:
        if not poll_backend_ready(backend_url):
            print("[ERROR] backend did not become ready in time", file=sys.stderr)
            return 1

        use_static = args.prod and has_static_bundle()
        if use_static:
            print(f"[launcher] backend ready: {backend_url} (serving static bundle)")
            target_url = backend_url
        else:
            frontend_cmd = ["npm", "run", "dev", "--", "--port", str(frontend_port), "--strictPort"]
            frontend_proc = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR, env=env)
            print(f"[launcher] backend ready: {backend_url}")
            print(f"[launcher] frontend dev server: http://127.0.0.1:{frontend_port}")
            target_url = f"http://127.0.0.1:{frontend_port}"

        if not args.no_browser:
            webbrowser.open(target_url)

        def handle_signal(_signum: int, _frame: object) -> None:
            raise KeyboardInterrupt

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        while True:
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
        terminate_process(backend_proc)


if __name__ == "__main__":
    raise SystemExit(main())
