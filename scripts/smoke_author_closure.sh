#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "AUTHOR_CLOSURE_FAIL: $1"
  exit 1
}

require_file() {
  [ -f "$1" ] || fail "missing $1"
}

require_grep() {
  local pattern="$1"
  local file="$2"
  grep -Eq "$pattern" "$file" || fail "missing pattern '$pattern' in $file"
}

require_file README.md
require_file docs/PRODUCT_CLOSURE_AUDIT.md
require_file frontend/src/lib/settings.ts
require_file frontend/src/pages/App.tsx
require_file frontend/src/components/FirstRunChecklist.tsx
require_file frontend/src/components/WriteConfirmOverlay.tsx
require_file frontend/src/components/BookTimelinePanel.tsx
require_file frontend/src/components/BuildDraftReviewCards.tsx
require_file frontend/src/components/StoryBuildWizardPanel.tsx
require_file frontend/src/components/StoryControlCard.tsx
require_file frontend/src/components/StoryPlanningPanel.tsx
require_file frontend/src/components/ChapterStructureLights.tsx
require_file frontend/src/components/WorkspaceTrustCards.tsx
require_file frontend/src/components/RightTechniquePanel.tsx
require_file frontend/src/components/AiJobDetailCard.tsx
require_file frontend/src/components/ChapterMaintainerPanel.tsx
require_file backend/services/evidence_service.py
require_file backend/services/llm_config_service.py
require_file backend/tests/test_phase2_services.py

# Author mode must be the default, with maintainer/debug surfaces gated.
require_grep "experienceMode: 'author'" frontend/src/lib/settings.ts
require_grep "const isMaintainerMode = settings\\.experienceMode === 'maintainer'" frontend/src/pages/App.tsx
require_grep "isMaintainerMode \\? \\(" frontend/src/pages/App.tsx
require_grep "ChapterMaintainerPanel" frontend/src/pages/App.tsx
require_grep "AiJobDetailCard" frontend/src/pages/App.tsx
require_grep "Author mode" README.md
require_grep "Maintainer mode" README.md

# One write action should expose transparent pre-generation routing and readiness.
require_grep "生成前确认" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "AI 分工" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "写初稿" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "审故事" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "改错字" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "存事实" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "writeRouteRows" frontend/src/components/WriteConfirmOverlay.tsx
require_grep "writer|critic|editor|canon_extractor" README.md
require_grep "TASK_AI_MODULES" frontend/src/pages/App.tsx
require_grep "WRITE_ROUTE_MODULES" frontend/src/pages/App.tsx

# Author planning and structure controls should be fillable without raw JSON.
require_grep "FirstRunChecklist" frontend/src/pages/App.tsx
require_grep "BookTimelinePanel" frontend/src/pages/App.tsx
require_grep "StoryBuildWizardPanel" frontend/src/pages/App.tsx
require_grep "StoryControlCard" frontend/src/pages/App.tsx
require_grep "StoryPlanningPanel" frontend/src/pages/App.tsx
require_grep "showJsonPreview=\\{isMaintainerMode\\}" frontend/src/pages/App.tsx
require_grep "维护预览" frontend/src/components/StoryPlanningPanel.tsx

# AI output must remain pending until the author confirms it.
require_grep "待确认建书草案" frontend/src/components/BuildDraftReviewCards.tsx
require_grep "确认写入" frontend/src/components/StoryBuildWizardPanel.tsx
require_grep "pending by default" README.md
require_grep "test_build_drafts_api_roundtrip" backend/tests/test_phase2_services.py

# Evidence lighting and anti-deception checks must be backed by UI and backend tests.
require_grep "本章结构点亮" frontend/src/components/ChapterStructureLights.tsx
require_grep "unsupported|contradicted" frontend/src/components/WorkspaceTrustCards.tsx
require_grep "support_level" backend/services/evidence_service.py
require_grep "verify_quotes|unsupported quote|unsupported" backend/tests/test_phase2_services.py
require_grep "Evidence marks and trust reports" README.md

# The closure audit should show the 1-7 product closure items are complete.
require_grep "Status: \`Done\`" docs/PRODUCT_CLOSURE_AUDIT.md
require_grep "Current Verification Commands" docs/PRODUCT_CLOSURE_AUDIT.md
require_grep "Product Closure Status" docs/PRODUCT_CLOSURE_AUDIT.md

echo "AUTHOR_CLOSURE_OK"
