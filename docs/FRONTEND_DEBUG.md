# Frontend Debug Guide

## 当前启动行为
- `start.sh`
  1. 创建并激活 `.venv`
  2. 安装 backend 依赖（失败时给出离线/镜像提示并退出）
  3. `frontend/node_modules` 不存在时执行 `npm ci`（有 lockfile）或 `npm install`
  4. 后台启动 backend：`uvicorn main:app --host 127.0.0.1 --port 8000`
  5. 前台启动 frontend：`npm run dev`（Vite 监听 `127.0.0.1:5173`）
- `start.bat` 同步上述逻辑（Windows 等价实现）。

## 前端启动命令与端口
- 命令：`cd frontend && npm run dev`
- 端口：`127.0.0.1:5173`（strictPort，端口占用会直接报错退出）。

## 失败日志位置
- 手动启动：终端标准输出（含 Vite `Local/Network` 行）。
- 自动化 smoke：`/tmp/novix_frontend_smoke.log`。

## 常见失败原因
1. 依赖未安装（`node_modules` 不存在，且 npm 安装失败）。
2. 端口冲突（`5173` 被占用且 `strictPort=true`）。
3. 监听地址不一致（此前使用 `0.0.0.0/localhost/IPv6` 与自动化访问地址不一致）。
4. 后端未起导致 API 报错（不影响首页 200，但影响联调功能）。
