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
- Narrative Canvas: build, character, world, thread, volume, beat, and ending nodes with author decisions.
- Chapter prewrite card: choose the chapter goal, structure nodes, techniques, and generation scope before writing.
- Skill Library: narrative technique cards and AI tool skill cards such as problem checking, character biography, outline research, timeline check, scene consistency, and foreshadowing tracking.
- Single write API: `POST /api/projects/{project_id}/jobs/write`.
- Three Agent workflow: reviewer, writer, proofreader, plus canon extraction support.
- Evidence marks and trust reports: AI claims must map back to quotes and line ranges before they can be treated as supported.
- Patch review: AI patches are pending by default and can be accepted, rejected, or rolled back.
- Local backup and export: project ZIP backup, backup restore as a new project, manuscript Markdown export.

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

## First Run Checklist

Open the app, go to **Projects**, and use the **首次启动检查** card.

Recommended order:

1. Configure an API profile in **Settings**.
2. Assign writer, critic, editor, and canon extractor profiles.
3. Fill the novel setup wizard in **Story**.
4. Add or edit character cards.
5. Create the first volume and chapter.
6. Open **Story -> Canvas** and confirm the main structure nodes.
7. Open **Chapter** and use the **开写前卡片** to choose this chapter's structure nodes.
8. Generate a chapter only after checking the generation confirmation panel.
9. Analyze evidence marks for the current chapter.

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

## Use The Narrative Canvas

Go to **Story -> Canvas**.

The canvas is a novel structure view, not a branching game editor. It focuses on:

- build,
- characters,
- world rules,
- main thread,
- open line,
- hidden line,
- foreshadowing,
- volumes,
- beats,
- ending.

Click a node to edit:

- what the node should accomplish,
- AI suggestion,
- author decision.

Canvas node actions:

- **确认** marks the node as author-confirmed.
- **生成草案** creates a pending setup draft linked to that node.
- **写回表格** writes the node into the matching Story field, such as open line, hidden line, foreshadowing, important scenes, worldview, main conflict, or logline.
- **标记风险** marks the node as structurally risky.

Accepted drafts keep their source:

- `source_draft_id`
- `source_node_id`
- `source_node_label`
- `source_node_type`

This makes it possible to trace a Story row back to the canvas node that produced it.

## Generate A Chapter

1. Go to **Chapter**.
2. Confirm the writing agreement at the top of the chapter page.
3. Use **开写前卡片** to choose the structure nodes this chapter must write.
4. Save the structure-node selection.
5. Select generation scope and optional material switches if needed.
6. Click **按共识生成**.
7. Review the generation confirmation panel.
8. Confirm generation.
9. Review the AI draft.
10. Edit the manuscript manually if needed.
11. Save.
12. Run **检查要求 / Analyze Marks** to verify evidence marks.

Generated chapters appear in:

- the volume/chapter tree,
- the Projects dashboard recent chapters,
- the Chapter editor.

Authors can edit generated text before saving.

## Structure Lighting

When a write job emits `MARK_EXTRACTION`, or when the author runs **Analyze Marks**, the UI checks selected canvas nodes against evidence marks.

Structure-node statuses include:

- `已写入正文`
- `待证据确认`
- `本章未写到`
- `作者已确认`
- `有结构风险`

A node is only treated as written when evidence marks include a supported quote or line range. Unsupported AI claims do not become trusted green hits.

## Author Mode And Maintainer Mode

Settings include **Experience Mode**:

- **Author** is the default. It hides provider, manifest, raw JSON, job event internals, and maintenance records.
- **Maintainer** shows runtime safety, provider/model routing, context manifests, trust report JSON, patch internals, and debugging records.

Use Author mode for normal writing. Use Maintainer mode when developing the open-source project or diagnosing model/provider behavior.

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

## Verification

Product closure audit:

```text
docs/PRODUCT_CLOSURE_AUDIT.md
```

Backend tests:

```bash
./.venv/bin/python -m pytest -q backend/tests/test_phase2_services.py
```

Frontend production build:

```bash
cd frontend
npm run build
```

Frontend smoke:

```bash
./scripts/smoke_frontend.sh
./scripts/smoke_author_closure.sh
```

Diff whitespace check:

```bash
git diff --check
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

### Browser automation is unstable

Use backend tests and frontend build as the baseline verification. Browser checks can be affected by local permissions or restricted environments.

## Docs Index

- [Architecture](docs/ARCHITECTURE.md)
- [WenShape Parity Matrix](docs/WENSHAPE_PARITY.md)
- [Frontend Debug Guide](docs/FRONTEND_DEBUG.md)
- [Technique Guide](docs/TECHNIQUES.md)
- [Release / Packaging Guide](docs/RELEASE.md)
- [Repository agent constraints](AGENTS.md)

## Contributing And License

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [LICENSE](LICENSE)
