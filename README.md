# novix.ai - AI 长篇小说工作台（Phase 2）

[![CI](https://github.com/jingui020306-del/novix.ai/actions/workflows/ci.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/ci.yml)

## 端口约定

- backend: `8000`
- frontend: `5173`

## 一键启动

- Linux/macOS: `./start.sh`
- Windows: `start.bat`

## 手动启动（最短命令）

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000
cd frontend && npm install && npm run dev
```

## 真实 LLM 接入（可选，失败自动回退 Mock）

后端支持 `mock | ollama | llama_cpp | openai_compat`，统一经 `llm_gateway` 调用。外部 provider 不可达时会写入 sessions `ERROR` 事件并自动回退 mock，pipeline 不中断。

### 环境变量

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
LLAMA_CPP_BASE_URL=http://127.0.0.1:8080
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8001
OPENAI_COMPAT_API_KEY=
DEFAULT_LLM_PROVIDER=mock
DEFAULT_LLM_MODEL=mock-writer-v1
```

### 最小启动示例

- Ollama:

  ```bash
  ollama serve
  # 可选：ollama pull qwen2.5:7b
  ```

- llama.cpp（OpenAI 兼容模式）:

  ```bash
  ./server -m /path/to/model.gguf --host 127.0.0.1 --port 8080
  ```

`jobs/write` 可传 `llm_profile_id` 选择项目内 profile；前端 ChapterEditor 提供模型选择器。

## npm E403 排查

- 先检查当前源：`npm config get registry`
- 可通过环境变量覆盖：`NPM_REGISTRY=https://registry.npmjs.org/ ./start.sh`（Windows 可先 `set NPM_REGISTRY=https://registry.npmjs.org/`）
- 若安装报 `E403` 或出现 `registry.npmmirror.com`，脚本会自动切回 npmjs 并重试一次。

## 后端测试

```bash
cd backend
python -m pytest -q
```

## 前端 smoke 检查

```bash
./scripts/smoke_frontend.sh
```

## WenShape 主结构（不可变）

```text
data/{project_id}/
  project.yaml
  cards/
  canon/
  drafts/
  sessions/
```

## Phase2 新增（可重建扩展）

- `assets/style_samples`：上传文风样本 txt/md。
- `meta/kb/kb_style`：chunks + bm25 索引。
- `meta/summaries`：style profile、章节摘要副本。

## KB 扩展（Docs + Manuscript + 跨库检索）

- `kb_docs`: 上传参考资料 `kind=doc` 后入库。
- `kb_manuscript`: 保存章节/应用 patch 后自动增量重建（含 `chapter_id/start_line/end_line`）。
- 跨库检索 API:

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/kb/query_multi \
    -H 'content-type: application/json' \
    -d '{"query":"雨夜 抉择","top_k":12,"kb":[{"kb_id":"kb_style","weight":0.5},{"kb_id":"kb_docs","weight":1.0},{"kb_id":"kb_manuscript","weight":1.2}]}'
  ```

- 证据跳转 API:
  - `GET /api/projects/{id}/assets/{asset_id}?kind=style_sample|doc`
  - `GET /api/projects/{id}/drafts/{chapter_id}/lines?start=..&end=..`

## Talk 式编辑增强

- 章节版本树：
  - `GET /api/projects/{id}/drafts/{chapter_id}/versions`
  - `POST /api/projects/{id}/drafts/{chapter_id}/rollback`
- Patch 逐条 accept/reject：
  - `POST /api/projects/{id}/drafts/{chapter_id}/apply-patch`
  - body: `{patch_ops:[...], accept_op_ids:[...]}`
- Session message 版本与 Undo/Redo：
  - `POST /api/projects/{id}/sessions/{sid}/messages/{message_id}/versions`
  - `POST /api/projects/{id}/sessions/{sid}/messages/{message_id}/activate`
  - `POST /api/projects/{id}/sessions/{sid}/undo`
  - `POST /api/projects/{id}/sessions/{sid}/redo`
