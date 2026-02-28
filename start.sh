#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv || true
source .venv/bin/activate

if ! pip install -r backend/requirements.txt; then
  echo "[ERROR] backend 依赖安装失败。请检查离线镜像/代理配置，例如："
  echo "  pip install -i https://pypi.org/simple -r backend/requirements.txt"
  exit 1
fi

npm_install_with_retry() {
  local cmd="$1"
  local log_file
  log_file="$(mktemp)"

  echo "[frontend] npm registry: $(npm config get registry)"
  if ! (cd frontend && eval "$cmd") >"$log_file" 2>&1; then
    if grep -Eq 'E403|registry\.npmmirror\.com' "$log_file"; then
      echo "[frontend] detected npm E403/mirror issue, switching registry to https://registry.npmjs.org/ and retrying once"
      npm config set registry https://registry.npmjs.org/
      echo "[frontend] npm registry(after switch): $(npm config get registry)"
      if ! (cd frontend && eval "$cmd") >>"$log_file" 2>&1; then
        cat "$log_file"
        echo "[ERROR] npm install retry failed. npm debug logs: ~/.npm/_logs"
        ls -1t ~/.npm/_logs 2>/dev/null | head -n 3 || true
        return 1
      fi
    else
      cat "$log_file"
      echo "[ERROR] npm install failed. npm debug logs: ~/.npm/_logs"
      ls -1t ~/.npm/_logs 2>/dev/null | head -n 3 || true
      return 1
    fi
  fi
}

if [ -n "${NPM_REGISTRY:-}" ]; then
  npm config set registry "$NPM_REGISTRY"
fi

if [ ! -d frontend/node_modules ]; then
  if [ -f frontend/package-lock.json ]; then
    npm_install_with_retry "npm ci"
  else
    npm_install_with_retry "npm install"
  fi
fi

(cd backend && uvicorn main:app --host 127.0.0.1 --port 8000 &) 
(cd frontend && npm run dev)
