# novix.ai

`novix.ai` is a local-first longform fiction workbench for writers who want an AI-assisted novel IDE without giving up control of structure, evidence, or revision decisions.

It keeps detailed literary planning assets such as story control, characters, world rules, open lines, hidden lines, foreshadowing, techniques, canon facts, volumes, and chapters. The writing API is a single action from the UI, while the backend can orchestrate reviewer, writer, proofreader, and canon extraction work with visible job events and evidence checks.

[![Backend Tests](https://github.com/jingui020306-del/novix.ai/actions/workflows/backend.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/backend.yml)
[![Frontend Build](https://github.com/jingui020306-del/novix.ai/actions/workflows/frontend.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/frontend.yml)
[![Smoke](https://github.com/jingui020306-del/novix.ai/actions/workflows/smoke.yml/badge.svg)](https://github.com/jingui020306-del/novix.ai/actions/workflows/smoke.yml)

## What It Does

- Three-column writing IDE: project explorer, manuscript/editor center, AI/context panel.
- Novel setup wizard: title, genre, keywords, small outline, character seeds, important scenes, main conflict, banned items.
- Volume and chapter tree: generated chapters appear in the workspace and can be edited before saving.
- Story planning views: stages, open line, hidden line, foreshadowing, chapter matrix.
- Skill Library: narrative technique cards and AI tool skill cards such as problem checking, character biography, outline research, timeline check, scene consistency, and foreshadowing tracking.
- Single write API: `POST /api/projects/{project_id}/jobs/write`.
- Three Agent workflow: reviewer, writer, proofreader, plus canon extraction support.
- Evidence marks and trust reports: AI claims must map back to quotes and line ranges before they can be treated as supported.
- Patch review: AI patches are pending by default and can be accepted, rejected, or rolled back.
- Local backup and export: project ZIP backup, backup restore as a new project, manuscript Markdown export.
- Reusable world library: five original genre examples, private material workspaces, partial selection with dependency previews, and independent work instances pinned to a source version.
- Character detail sections with scene/time applicability and an author-only setting; optional prose observation strategies are used by writing, revision, and review.

## World Materials

Open **作品设定 → 世界总览 → 世界资料库** to choose an original example or create a private library. Raw TXT/PDF/images/ZIP files remain source material until you review and apply extracted candidates. When several entries could be the world root, use the entry type **世界简介** to identify it explicitly. Adopting a world creates an independent instance; choose it under the story's world background before writing. Source updates are compared, never silently applied.

Canonical settings remain in `cards/*.yaml`, changes and facts in `canon/*.jsonl`, and original materials in attachment files. `meta/material_index.sqlite3` is a rebuildable query copy, with Chinese short-name and alias matching; losing it does not lose your settings. Search can fall back to saved files when rebuilding fails. ZIP backups include canonical data and sources, omit this index, and rebuild it after restoration.

ZIP and PDF uploads support up to 512 MB; other individual files support up to 12 MB. Packages are inventoried before bounded extraction. PDF text and visual pages report coverage separately; unrecognized pages stay unread. Vision/OCR and semantic extraction require a configured model and an explicit AI action. External world-building tools are links, with no automatic cross-site synchronization.

Use **浏览当前阶段的世界** to inspect the selected world's settings, people, and relationships at a particular time, region, and branch. This browsing view is separate from the chapter's **本次生成材料**, which records the material prepared or sent for that writing request.

Before generating, review why each item is included and whether it uses a summary, full text, or an expanded reference. Author-selected character details and applicable confirmed rules are reserved in full, including conditions and exceptions. Other details use saved summaries until the task calls for them or you select a linked passage. Following further references is optional and bounded; it still checks applicability, privacy, and the material budget. An oversized or unavailable required item blocks generation and is listed for review, rather than silently shortened.

Segmented imports extract the current passage before looking up matching names and aliases. Only a small set of ambiguous identity candidates is sent for further comparison; a model suggestion never merges records without author confirmation.

## 人物、家谱与场景推演

在世界资料中填写姓氏、名字和亲属规则。在人物卡随机取名，或在关系页选中心人物生成家族。预览可改名、锁定成员和保留空位，确认后写入作品。在章节页比较历史正文，或从分歧事件建立分支稿。

场景安排会根据本场有效人物自动准备候选：单人可推演取舍，两人可推演互动，多人可推演各自的回应。作者可修改、确认后采用。姓名和家族生成均可离线使用。

在 Debian 或 Ubuntu 上，读取文字 PDF 可安装 `poppler-utils`，读取旧版 Word（.doc）可安装 `libreoffice-writer`。扫描页和手绘图需在模型设置里配置视觉模型，再对选中的页面执行识别。

## Current Trust Model

The product is designed to avoid hiding AI uncertainty.

- AI generated drafts go to author review.
- Proofread patches are not silently applied unless the user enables auto apply.
- Canon facts and evidence marks require quote or line-range support.
- Unsupported or contradicted marks are shown as risks.
- Author feedback can confirm a mark, mark it as a false positive, or ignore it for the current chapter.
- API keys are stored in local profile files and are not returned by the status API.
- The UI shows whether the current LLM profile is ready, mock, incomplete, or missing before generation.

## Requirements

- Python 3.10 or newer.
- Node.js 18 or newer.
- npm.

No hosted API key is bundled with this repository. Users add their own API profile in Settings.

## Quickstart

### 1. Clone

```bash
git clone https://github.com/jingui020306-del/novix.ai.git
cd novix.ai
```

### 2. Install Dependencies

Backend:

```bash
cd backend
python -m venv ../.venv
../.venv/bin/pip install -r requirements.txt
cd ..
```

Frontend:

```bash
cd frontend
npm install
cd ..
```

On Windows, use `.venv\Scripts\pip` instead of `../.venv/bin/pip`.

### 3. Start The App

Recommended launcher:

```bash
./.venv/bin/python start.py
```

The launcher:

- Finds an available backend port starting at `8000`.
- Finds an available frontend port starting at `5173`.
- Starts the backend.
- Starts the Vite frontend dev server.
- Opens the browser unless `--no-browser` is passed.

Manual startup:

```bash
cd backend
../.venv/bin/python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
cd frontend
npm run dev
```

Then open:

```text
http://127.0.0.1:5173
```

### 4. Open The Demo Project

The demo project is `demo_project_001`. It includes:

- a story card,
- a main character,
- a world setup,
- one volume,
- one chapter,
- sample techniques,
- tool skills,
- canon and evidence examples.

## Local Scene Rehearsal

Save a scene that links at least two character cards. Novix prepares a candidate in the backend, even if the author never opens the rehearsal editor. The chapter shows the outcome. Open the scene to read each character’s choices, or expand **调整本场排演假设** to change the participants, actions, beliefs, or costs. Edits recalculate the candidate. Preview and confirm to use it in chapter planning.

The first version covers one action and one response. Novix reuses a saved scenario or the two actions from an authored interaction. For the latter, it assumes the partner can observe the first action. With only a cast, it starts from a generic conversation. Initial confidence is 70% and the default failure cost is 5. These are editable assumptions. Free-text goals provide context to the author. Action availability and payoffs use structured inputs.

Local rehearsal runs without a cloud model or API key. Install the Python dependencies on the FastAPI host. The three additional engines run on the same machine.

| Engine | What it contributes | Runtime |
| --- | --- | --- |
| [PsychSim](https://github.com/usc-psychsim/psychsim) | Chooses between acting and holding back given each character’s beliefs and costs | Installed with the backend Python requirements |
| [Praxish](https://github.com/mkremins/praxish) | Evaluates social conditions and which responses an action makes possible | Bundled MIT source, Node.js 20+ |
| [Sabre](https://github.com/sgware/sabre) | Searches for a path to the chosen outcome | Java 21+ |
| [FAtiMA Toolkit](https://github.com/GAIPS/FAtiMA-Toolkit) | Appraises an observed event and adjusts the partner’s risk estimate | .NET 8 SDK and Git |

From the repository root, run:

```bash
python -m pip install -r backend/requirements.txt
python backend/rehearsal_engines/install.py
```

The installer downloads the pinned Sabre JAR and builds the pinned FAtiMA bridge. Pass `sabre` or `fatima` to install one. The default location is `~/.novix/engines`; set `NOVIX_ENGINE_DIR` to use another directory readable by the backend. Ready engines are selected automatically for a new scene.

## First Run Checklist

Open the app, go to **Projects**, and use the **首次启动检查** card.

Recommended order:

1. Configure an API profile in **Settings**.
2. Assign writer, critic, editor, and canon extractor profiles.
3. Fill the novel setup wizard in **Story**.
4. Add or edit character cards.
5. Create the first volume and chapter.
6. Analyze evidence marks for the current chapter.
7. Generate a chapter only after checking the generation confirmation panel.

## Configure API Profiles

Go to **Settings -> LLM Profiles (Global)**.

1. Pick a preset.
2. Enter a profile id, such as `deepseek_writer`.
3. Fill model, base URL, API key, timeout, and stream.
4. Click **Save Profile**.
5. Check **Profile Health**.

Supported presets include:

| Preset | Provider | Example model | Base URL |
|---|---|---|---|
| Mock | `mock` | `mock-writer-v1` | empty |
| Ollama | `ollama` | `qwen2.5:7b` | `http://127.0.0.1:11434` |
| llama.cpp | `llama_cpp` | `gguf-model` | `http://127.0.0.1:8080` |
| DeepSeek | `openai_compat` | `deepseek-chat` | `https://api.deepseek.com` |
| Qwen | `openai_compat` | `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode` |
| Kimi | `openai_compat` | `moonshot-v1-8k` | `https://api.moonshot.cn` |
| GLM | `openai_compat` | `glm-4-flash` | `https://open.bigmodel.cn/api/paas/v4` |
| Gemini | `openai_compat` | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Grok | `openai_compat` | `grok-2-latest` | `https://api.x.ai` |
| Custom | `openai_compat` | user-defined | user-defined |

API keys are saved locally in:

```text
data/_global/llm_profiles.json
```

The runtime status API reports `api_key_configured`, but does not return the raw API key.

You can optionally enter the model's documented context capacity as `context_window`. Preflight reserves the requested output length and uses a conservative input estimate; it is not a provider token count. Without a declared capacity, the UI explicitly reports that model capacity is unverified and checks only the configured character budget.

## Assign Agent Profiles

Go to **Settings -> LLM Assignments (Global)**.

Assign profiles for:

- `writer`
- `critic`
- `editor`
- `canon_extractor`

Routing priority:

```text
request.llm_profile_id > assignment[module] > project.default_llm_profile_id > mock_default
```

If a provider call fails, the backend may fall back to `mock_default`, and the job event records the fallback.

## Create A Book

Go to **Story** and use the novel setup wizard.

The core fields include:

- title,
- genre,
- keywords,
- target reader,
- platform style,
- banned items,
- small story outline,
- theme,
- main conflict,
- important scenes,
- character seeds,
- open line,
- hidden line,
- foreshadowings,
- chapter plan.

AI generated setup drafts are pending by default. You can accept a full draft, accept parts of it, refresh it, edit it, or reject it.

## Generate A Chapter

1. Go to **Chapter**.
2. Select the chapter and model profile.
3. Confirm the profile is `ready`, or knowingly use `mock mode`.
4. Click **生成本章**.
5. Review the generation confirmation panel.
6. Confirm generation.
7. Review the AI draft.
8. Edit the manuscript manually if needed.
9. Save.
10. Run **Analyze Marks** to verify evidence marks.

Generated chapters appear in:

- the volume/chapter tree,
- the Projects dashboard recent chapters,
- the Chapter editor.

Authors can edit generated text before saving.

## Three Agent Workflow

The UI exposes one write action, while the backend emits staged events.

Typical write job events:

| Event | Purpose |
|---|---|
| `PRE_REVIEW_PLAN` | Reviewer prepares chapter constraints and risk checklist. |
| `CONTEXT_MANIFEST` | Records context used, evidence, budget, dropped material, and compression decisions. |
| `WRITER_DRAFT` | Writer produces chapter draft. |
| `MARK_EXTRACTION` | Extracts matched characters, techniques, open line, hidden line, foreshadowing, and canon evidence marks. |
| `CLAIM_VERIFICATION` | Verifies whether claims are supported by quote or line range. |
| `CRITIC_REVIEW` | Reviewer checks story requirements, character behavior, and technique adherence. |
| `PROOFREAD_PATCH` | Proofreader proposes language-level fixes only. |
| `TRUST_REPORT` | Summarizes supported, partial, unsupported, and contradicted marks. |

The proofreader should not add canon facts, new character settings, or hidden explanations.

## Evidence Marks And Trust Reports

Evidence marks are stored in:

```text
data/{project_id}/meta/evidence_marks/{chapter_id}.jsonl
```

Trust reports are stored in:

```text
data/{project_id}/meta/trust_reports/{chapter_id}.json
```

Every supported mark should include:

- `chapter_id`,
- target type,
- target id,
- line range,
- quote,
- confidence,
- support level,
- agent trace.

Support levels:

- `supported`
- `partial`
- `unsupported`
- `contradicted`

Author feedback options:

- confirm hit,
- mark as false positive,
- ask AI to revise the paragraph,
- ignore this mark for the current chapter.

If a mark has no real quote, it cannot be shown as a trusted supported hit.

## Backup, Restore, And Export

Project backup:

```text
GET /api/projects/{project_id}/export.zip
```

Manuscript Markdown:

```text
GET /api/projects/{project_id}/export.md
```

Backup restore:

```text
POST /api/projects/import.zip
```

Restore imports the backup as a new project. It does not overwrite the current project.

The UI exposes these actions in **Projects** and **Settings**.

## API Examples

Create a project:

```bash
curl -X POST http://127.0.0.1:8000/api/projects \
  -H 'content-type: application/json' \
  -d '{"title":"My Project"}'
```

Run a write job:

```bash
curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/jobs/write \
  -H 'content-type: application/json' \
  -d '{
    "chapter_id":"chapter_001",
    "blueprint_id":"blueprint_001",
    "scene_index":0,
    "agent_mode":"three_agent",
    "llm_profile_id":"mock_default",
    "auto_apply_patch":false,
    "word_checkpoint_chars":1500
  }'
```

Analyze evidence marks:

```bash
curl -X POST http://127.0.0.1:8000/api/projects/demo_project_001/chapters/chapter_001/analyze-marks \
  -H 'content-type: application/json' \
  -d '{}'
```

Read trust report:

```bash
curl "http://127.0.0.1:8000/api/projects/demo_project_001/trust-report?chapter_id=chapter_001"
```

## Troubleshooting

### The UI says `mock mode`

That means the selected profile or assigned agent is using `mock_default`. Configure a real profile in Settings and assign it to the agent modules.

### The UI says `incomplete`

Open Settings and check Profile Health. Common missing fields:

- `provider`
- `model`
- `base_url`
- `api_key`

### I saved a profile but cannot select it in Chapter

Refresh the page or revisit Settings. The Chapter profile selector merges global profiles and project-local profiles.

### npm install fails with E403

Check npm registry:

```bash
npm config get registry
```

Set the public registry if needed:

```bash
npm config set registry https://registry.npmjs.org/
```

## Docs Index

- [Architecture](docs/ARCHITECTURE.md)
- [WenShape Parity Matrix](docs/WENSHAPE_PARITY.md)
- [Technique Guide](docs/TECHNIQUES.md)
- [Command Palette Guide](docs/COMMAND_PALETTE.md)
- [Release / Packaging Guide](docs/RELEASE.md)

## Contributing And License

- [Contributing and development checks](docs/CONTRIBUTING.md)
- [Code of conduct](docs/CODE_OF_CONDUCT.md)
- [Security policy](docs/SECURITY.md)
- [LICENSE](LICENSE)
