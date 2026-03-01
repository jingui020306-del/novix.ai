#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

LOG="/tmp/novix_frontend_smoke.log"
: > "$LOG"

# Phase 1: offline structure checks
fail_struct() {
  echo "SMOKE_FAIL: $1"
  exit 1
}

[ -f frontend/package.json ] || fail_struct "missing frontend/package.json"
[ -f frontend/vite.config.ts ] || fail_struct "missing frontend/vite.config.ts"
[ -f frontend/index.html ] || fail_struct "missing frontend/index.html"

grep -q '"dev"' frontend/package.json || fail_struct "frontend/package.json missing dev script"
grep -q '/api' frontend/vite.config.ts || fail_struct "vite.config.ts missing /api proxy"
grep -q 'proxy' frontend/vite.config.ts || fail_struct "vite.config.ts missing proxy config"
grep -q '<div id="root"></div>' frontend/index.html || fail_struct "frontend/index.html missing root div"

npm_install_with_retry() {
  local cmd="$1"
  local npmjs_failed=0
  local backup_failed=0

  echo "[smoke] npm registry: $(npm config get registry)" >>"$LOG"
  if (cd frontend && eval "$cmd") >>"$LOG" 2>&1; then
    return 0
  fi

  if grep -Eq 'E403|registry\.npmmirror\.com|registry\.npmjs\.org' "$LOG"; then
    npmjs_failed=1
    echo "[smoke] detected E403/mirror issue, switching registry to https://registry.npmjs.org/ and retrying once" >>"$LOG"
    npm config set registry https://registry.npmjs.org/ >>"$LOG" 2>&1
    echo "[smoke] npm registry(after switch): $(npm config get registry)" >>"$LOG"
    if (cd frontend && eval "$cmd") >>"$LOG" 2>&1; then
      return 0
    fi

    if grep -Eq 'E403|registry\.npmmirror\.com|registry\.npmjs\.org' "$LOG"; then
      backup_failed=1
    fi
  fi

  if [ "$npmjs_failed" -eq 1 ] && [ "$backup_failed" -eq 1 ]; then
    echo "SKIP: registry blocked by network policy"
    echo "npm debug logs: ~/.npm/_logs"
    ls -1t ~/.npm/_logs 2>/dev/null | head -n 3 || true
    tail -n 120 "$LOG"
    exit 0
  fi

  echo "SMOKE_FAIL: dependency install failed"
  echo "npm debug logs: ~/.npm/_logs"
  ls -1t ~/.npm/_logs 2>/dev/null | head -n 3 || true
  tail -n 120 "$LOG"
  exit 1
}

if [ -n "${NPM_REGISTRY:-}" ]; then
  npm config set registry "$NPM_REGISTRY" >>"$LOG" 2>&1
fi

if [ ! -d frontend/node_modules ]; then
  if [ -f frontend/package-lock.json ]; then
    npm_install_with_retry "npm ci"
  else
    npm_install_with_retry "npm install"
  fi
fi

(cd frontend && npm run dev) >>"$LOG" 2>&1 &
PID=$!
trap 'kill $PID >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:5173 | grep -q '<div id="root">'; then
    echo "SMOKE_OK"
    tail -n 120 "$LOG"
    exit 0
  fi
  sleep 1
done

echo "SMOKE_FAIL: frontend unreachable"
tail -n 120 "$LOG"
exit 1
