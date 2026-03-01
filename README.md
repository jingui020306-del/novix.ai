# novix.ai

WenShape-parity context-engineering workbench for longform fiction.

[![Backend Tests](https://github.com/jingui020306-del/novix.ai/actions/workflows/backend.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/backend.yml)
[![Frontend Build](https://github.com/jingui020306-del/novix.ai/actions/workflows/frontend.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/frontend.yml)
[![Smoke](https://github.com/jingui020306-del/novix.ai/actions/workflows/smoke.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/smoke.yml)

---

## Why

长篇写作常见问题是：

- 前后设定漂移（人物、世界规则、时间线不一致）；
- 上下文过长导致提示词不可控；
- 编辑修改无法追踪，回退成本高。

`novix.ai` 的目标是把“长篇一致性”变成一个可验证的工程问题：

- 用 WenShape 兼容存储保证结构稳定；
- 用 Context Engine + BudgetManager 控制上下文预算；
- 用 Canon / Proposals / Patch History 保证可追溯与可回滚。

## Core design

### 5-stage pipeline

| Stage | Purpose | Primary output |
|---|---|---|
| `DIRECTOR_PLAN` | 章节计划与写作意图 | director plan |
| `TECHNIQUE_BRIEF` | 技法约束与检查清单 | technique checklist |
| `CONTEXT_MANIFEST` | 预算分配 + 检索证据 + 固定块注入 | context manifest |
| `WRITER_DRAFT` | 产出章节草稿 | chapter draft |
| `CRITIC_REVIEW` + `EDITOR_PATCH` | 审稿与最小补丁 | patch ops + diff + merge/canon updates |

### System pillars

- **BudgetManager**：按 bucket 分配 token 预算，记录裁剪与退化信息。
- **Canon / Proposals**：动态事实 append-only，提案可接受/拒绝。
- **KB Retrieval**：`kb_style / kb_docs / kb_manuscript / kb_world` 多源检索。
- **World Model**：世界卡 + 世界状态事实联合查询。
- **Techniques**：macro category + micro technique 双层挂载与继承。
- **Talk editing**：审稿问题 -> patch ops -> selective apply/rollback。

## Quickstart

### One-command startup

- Linux / macOS

  ```bash
  ./start.sh
  ```

- Windows

  ```bat
  start.bat
  ```

### Manual startup

- Backend (`:8000`)

  ```bash
  cd backend
  pip install -r requirements.txt
  uvicorn main:app --reload --port 8000
  ```

- Frontend (`:5173`)

  ```bash
  cd frontend
  npm install
  npm run dev
  ```

### Ports

- Backend API: `127.0.0.1:8000`
- Frontend Vite: `127.0.0.1:5173`

## Demo walkthrough

1. 打开 Workbench，选择 `demo_project_001`。
2. 在 **Style** 面板上传文风样本并分析。
3. 在 **Wiki** 导入 HTML/URL，生成候选事实。
4. 在 **Chapter** 触发写作任务并观察事件流。
5. 在 **Patch Review** 勾选并应用补丁。
6. 在 **Canon/Proposals** 接受或拒绝提案。
7. 在 **Context/World** 核对证据与世界状态。

### Example curl

- Create project

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects \
    -H 'content-type: application/json' \
    -d '{"title":"My Project"}'
  ```

- Run write job

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/jobs/write \
    -H 'content-type: application/json' \
    -d '{"chapter_id":"chapter_001","blueprint_id":"blueprint_001","scene_index":0}'
  ```

- Multi-KB query

  ```bash
  curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/kb/query_multi \
    -H 'content-type: application/json' \
    -d '{"query":"港区 封锁","top_k":12,"kb":[{"kb_id":"kb_style","weight":0.5},{"kb_id":"kb_docs","weight":1.0},{"kb_id":"kb_manuscript","weight":1.2},{"kb_id":"kb_world","weight":1.1}]}'
  ```

## Configuration

- **LLM profiles**：已支持 mock/ollama/llama.cpp/openai-compatible profiles。
- **Assignments（profile/agent 路由分配）**：即将补齐。

TODO:

- [ ] `docs/CONFIGURATION.md`（planned）
- [ ] profile assignment examples（planned）

## Verification

- Backend tests

  ```bash
  pytest -q
  ```

- Explicit backend run

  ```bash
  cd backend && pytest -q
  ```

- Frontend smoke

  ```bash
  ./scripts/smoke_frontend.sh
  ```

## FAQ

### npm install E403 / 离线环境怎么办？

1. 检查 registry：

   ```bash
   npm config get registry
   ```

2. 覆盖 registry：

   ```bash
   NPM_REGISTRY=https://registry.npmjs.org/ ./start.sh
   ```

3. 受限网络中，smoke 可能输出策略性 SKIP（不是业务逻辑失败）。

### Playwright / 浏览器检查不稳定怎么办？

受限运行环境下可能连接失败。建议以 `pytest + smoke` 作为基础验收，浏览器截图作为可选项。

## Docs index

- [Architecture](docs/ARCHITECTURE.md)
- [WenShape Parity Matrix](docs/WENSHAPE_PARITY.md)
- [Frontend Debug Guide](docs/FRONTEND_DEBUG.md)
- [Technique Guide](docs/TECHNIQUES.md)
- [Repository agent constraints](AGENTS.md)

## Contributing / License

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [LICENSE](LICENSE)
