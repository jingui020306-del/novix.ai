# Release / 打包指南

本项目提供两种启动体验：

- **开发模式**：后端 + Vite 前端热更新。
- **生产体验模式**：前端先打包到 `backend/static_dist`，再由 FastAPI 托管并提供 SPA fallback。

## 1) 构建前端并发布到后端静态目录

在仓库根目录执行：

```bash
cd frontend
npm install
npm run build:static
```

`build:static` 会执行：

1. `vite build` 产出 `frontend/dist`
2. 自动复制到 `backend/static_dist`

完成后，FastAPI 即可直接托管前端页面。

## 2) 使用 start.py 启动

仓库根目录：

```bash
python start.py
```

行为说明：

- 自动探测端口（默认从 `8000` / `5173` 开始，冲突时递增）。
- 先启动后端并轮询 `/api/health`，就绪后再启动前端 dev server（开发模式）。
- 自动打开浏览器（可用 `--no-browser` 关闭）。

生产体验模式（如果存在 `backend/static_dist/index.html`）：

```bash
python start.py --prod
```

- 仅启动后端。
- 前端由后端静态托管。
- 自动打开 `http://127.0.0.1:<backend_port>`。

## 3) 使用 PyInstaller 打包（示例）

> 当前给出可执行参考命令，便于后续 CI/CD 集成；不同平台请按实际依赖调整。

### 3.1 安装

```bash
pip install pyinstaller
```

### 3.2 打包 launcher

```bash
pyinstaller \
  --onefile \
  --name novix-launcher \
  --add-data "backend:backend" \
  --add-data "data:data" \
  start.py
```

Windows 可将 `--add-data` 分隔符改为 `;`：

```powershell
pyinstaller --onefile --name novix-launcher --add-data "backend;backend" --add-data "data;data" start.py
```

### 3.3 注意事项

- 打包前建议先执行 `npm run build:static`，确保 `backend/static_dist` 已就绪。
- 若目标环境无 Node.js，建议只使用 `--prod` 模式运行（后端托管已打包前端）。
- 若目标环境端口受限，可通过外层启动参数或环境变量进行端口映射。
