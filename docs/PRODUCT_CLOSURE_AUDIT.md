# Product Closure Audit

This audit tracks the product work needed to make the author workspace and AI writing flow feel complete, verifiable, and safe for writers.

Status legend:

- `Done`: implemented and backed by code or tests.
- `Needs runtime review`: implemented in code but should still be checked in the browser before calling the whole product finished.
- `Open`: missing or not yet strong enough.

## 1. README / Install / First Book Flow

Status: `Done`

Evidence:

- `README.md` includes install steps for backend and frontend.
- `README.md` documents `start.py`, manual backend startup, and Vite frontend startup.
- `README.md` documents first-run order from API configuration through evidence analysis.
- UI component `frontend/src/components/FirstRunChecklist.tsx` gives the Projects page a first-run checklist.

Verification:

- `npm --prefix frontend run build`
- `./.venv/bin/python -m pytest backend/tests/test_phase2_services.py::test_build_drafts_api_roundtrip`

## 2. API Key Configuration And Provider Examples

Status: `Done`

Evidence:

- `README.md` documents DeepSeek, Qwen, Kimi, GLM, Gemini, Ollama, llama.cpp, mock, and custom OpenAI-compatible profiles.
- `frontend/src/pages/App.tsx` exposes provider presets, profile health, and module assignments in Settings.
- `backend/services/llm_config_service.py` keeps API keys local and status responses omit raw keys.
- `backend/tests/test_phase2_services.py` checks assignment status and verifies raw API keys are not returned.

Verification:

- Settings page can create a profile from presets.
- Backend tests cover assignment status and missing API key reporting.

## 3. Generation Confirmation And Agent Routing Transparency

Status: `Needs runtime review`

Evidence:

- `frontend/src/components/WriteConfirmOverlay.tsx` shows generation scope, route rows, model/profile readiness, selected structure nodes, and pinned techniques before generation.
- `frontend/src/pages/App.tsx` defines `TASK_AI_MODULES`, `WRITE_ROUTE_MODULES`, generation scope options, stop options, and check modes.
- `README.md` documents that authors should review the generation confirmation panel before writing.

Still to review:

- Browser-check that each route row is readable for non-technical authors.
- Confirm the panel clearly differentiates writer, reviewer, proofreader, and canon extraction when assignments are mixed across providers.

## 4. AI Job Event Details And Maintainer-Only Debugging

Status: `Done`

Evidence:

- `frontend/src/components/AiJobDetailCard.tsx` shows job summary, stage history, Context Manifest, and Trust Report in maintainer mode.
- `frontend/src/components/ChapterMaintainerPanel.tsx` keeps provider, patch internals, versions, memory packs, manifest, technique brief, and raw events behind a maintainer-only details panel.
- `frontend/src/lib/settings.ts` defaults `experienceMode` to `author`.
- `README.md` documents Author mode and Maintainer mode.

Verification:

- Author mode hides provider, manifest, raw JSON, job event internals, and maintenance records.
- Maintainer mode exposes debugging details without affecting the author writing surface.

## 5. Author-Facing Fillable Structure Nodes

Status: `Done`

Evidence:

- `frontend/src/components/StoryBuildWizardPanel.tsx` separates the build wizard and pending setup drafts.
- `frontend/src/components/StoryControlCard.tsx` handles core story card fields such as title, genre, keywords, target reader, platform style, banned items, and important scenes.
- `frontend/src/components/StoryPlanningPanel.tsx` separates stages, open line, hidden line, foreshadowing, and chapter matrix into the planning area.
- `frontend/src/components/StoryCanvasPanel.tsx` handles author decisions on structure nodes.

Verification:

- Authors can fill the big book-level nodes and smaller planning nodes without editing raw JSON in author mode.
- Story JSON preview is maintainer-only.

## 6. AI Suggestions Are Pending Until Author Confirmation

Status: `Done`

Evidence:

- `frontend/src/components/BuildDraftReviewCards.tsx` shows pending build drafts and processed draft history.
- `frontend/src/components/StoryBuildWizardPanel.tsx` lets authors open, reject, refresh, restore, and confirm setup drafts.
- `README.md` states AI generated setup drafts are pending by default and can be accepted, edited, refreshed, or rejected.
- `backend/services/build_draft_service.py` stores build drafts and source node metadata.
- `backend/tests/test_phase2_services.py::test_build_drafts_api_roundtrip` verifies build draft API roundtrip behavior.

Verification:

- AI setup output does not silently overwrite story cards.
- Confirmed drafts preserve source draft and source node metadata where applicable.

## 7. Evidence Lighting, Card Invocation Traces, And Anti-Deception Checks

Status: `Needs runtime review`

Evidence:

- `frontend/src/components/ChapterStructureLights.tsx` shows whether selected structure nodes were actually evidenced in chapter text.
- `frontend/src/components/WorkspaceTrustCards.tsx` shows pending canon proposals and current trust risks.
- `frontend/src/components/StoryPlanningPanel.tsx` shows line and foreshadowing invocation traces for the selected chapter.
- `frontend/src/components/RightTechniquePanel.tsx` shows pinned techniques, evidence marks, and quick technique actions.
- `backend/services/evidence_service.py` verifies quotes and line ranges and builds trust reports.
- `backend/tests/test_phase2_services.py` covers evidence marks, unsupported quote handling, author feedback, trust reports, three-agent events, and memory packs.

Still to review:

- Browser-check the color language for supported, partial, unsupported, and contradicted marks.
- Confirm unsupported marks never look like green trusted hits.
- Confirm card invocation traces are easy for writers to understand without reading debug terms.

## Current Verification Commands

Run after each product slice:

```bash
npm --prefix frontend run build
./.venv/bin/python -m pytest backend/tests/test_phase2_services.py::test_build_drafts_api_roundtrip
./scripts/smoke_author_closure.sh
git diff --check
```

Run for broader backend confidence:

```bash
./.venv/bin/python -m pytest -q backend/tests/test_phase2_services.py
```

## Remaining Product Closure Work

The goal should stay active until these checks are stronger:

- Browser review of generation confirmation with mixed model assignments.
- Browser review of evidence lighting and risk colors in author mode.
- Browser review of card invocation traces for characters, techniques, lines, foreshadowing, and canon.
- Browser review should follow the author-closure smoke so the static evidence stays aligned with the visible product.
