import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  BookOpen,
  Bot,
  Brush,
  FilePenLine,
  FolderKanban,
  Globe,
  Settings,
  Sparkles,
  UserRound,
  Waypoints,
  RefreshCw,
  Moon,
  Sun,
  Monitor,
  List,
} from 'lucide-react'
import Layout from '../components/Layout'
import { AiJobDetailCard } from '../components/AiJobDetailCard'
import { BookTimelinePanel } from '../components/BookTimelinePanel'
import { BuildDraftReviewCards } from '../components/BuildDraftReviewCards'
import { BuildProgressCard } from '../components/BuildProgressCard'
import { ChapterMaintainerPanel } from '../components/ChapterMaintainerPanel'
import { ChapterAlignmentPanel } from '../components/ChapterAlignmentPanel'
import { ChapterDraftReviewQueue } from '../components/ChapterDraftReviewQueue'
import { ChapterEditorCard } from '../components/ChapterEditorCard'
import { ChapterPrewriteCard } from '../components/ChapterPrewriteCard'
import { ChapterStructureLights } from '../components/ChapterStructureLights'
import { ChapterWorkflowChecklist } from '../components/ChapterWorkflowChecklist'
import { FirstRunChecklist } from '../components/FirstRunChecklist'
import { PendingPatchCard } from '../components/PendingPatchCard'
import { ProjectSwitcherCard } from '../components/ProjectSwitcherCard'
import { RecentAiJobsCard } from '../components/RecentAiJobsCard'
import { RecentChaptersCard } from '../components/RecentChaptersCard'
import { RightAgentProgress } from '../components/RightAgentProgress'
import { RightChapterContextPanel } from '../components/RightChapterContextPanel'
import { RightTechniquePanel } from '../components/RightTechniquePanel'
import { StoryCanvasPanel, StoryCanvasNode } from '../components/StoryCanvasPanel'
import { StoryBuildWizardPanel } from '../components/StoryBuildWizardPanel'
import { StoryControlCard } from '../components/StoryControlCard'
import { StoryPlanningPanel } from '../components/StoryPlanningPanel'
import { WriteConfirmOverlay } from '../components/WriteConfirmOverlay'
import { WorkspaceTrustCards } from '../components/WorkspaceTrustCards'
import { WritingPrepMap } from '../components/WritingPrepMap'
import { SchemaForm } from '../components/SchemaForm'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select, Textarea } from '../components/ui/Fields'
import { Tabs } from '../components/ui/Tabs'
import { Skeleton } from '../components/ui/Skeleton'
import { useToast } from '../components/ui/Toast'
import { AppSettings, applySettingsToDom, DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings'
import { CommandPalette } from '../components/CommandPalette/CommandPalette'
import { baseHelpCommands, CommandItem, iconForKind } from '../components/CommandPalette/commandIndex'
import { createHelpText, isCreateMode, parseCreateInput, ParsedCreate } from '../components/CommandPalette/cliParser'

const NAV_ITEMS = [
  { id: 'projects', label: '工作台', icon: FolderKanban },
  { id: 'story', label: '故事', icon: BookOpen },
  { id: 'characters', label: '人物', icon: UserRound },
  { id: 'style', label: '文风', icon: Brush },
  { id: 'chapter', label: '正文', icon: FilePenLine },
  { id: 'context', label: '材料', icon: Waypoints },
  { id: 'canon', label: '事实', icon: Sparkles },
  { id: 'world', label: '世界', icon: Globe },
  { id: 'techniques', label: '技法', icon: Sparkles },
  { id: 'wiki', label: '资料', icon: BookOpen },
  { id: 'sessions', label: '对话', icon: Bot },
  { id: 'settings', label: '设置', icon: Settings },
]

const ACTIVITY_ITEMS = [
  { id: 'explorer', label: '目录', icon: FolderKanban },
  { id: 'story', label: '故事', icon: BookOpen },
  { id: 'cards', label: '卡片', icon: UserRound },
  { id: 'techniques', label: '技法', icon: Sparkles },
  { id: 'canon', label: '事实', icon: Waypoints },
  { id: 'wiki', label: '资料', icon: BookOpen },
  { id: 'settings', label: '设置', icon: Settings },
]

type PaletteCache = {
  loadedFor?: string
  storyCards: any[]
  characters: any[]
  worldCards: any[]
  styleCards: any[]
  outlines: any[]
  blueprints: any[]
  chapters: any[]
  proposals: any[]
  techniques?: any[]
  techniqueCategories?: any[]
  toolSkills?: any[]
}


type SchemaCache = {
  cardSchemas: Record<string, any>
  blueprint?: any
}

type ProviderMeta = {
  provider_id: string
  display_name: string
  required_fields: string[]
  optional_fields: string[]
  supports_stream: boolean
  defaults?: Record<string, any>
}

const MRU_KEY = 'novix.palette.mru.v1'

const STORY_PAYLOAD_TEMPLATE = {
  logline: '',
  theme: '',
  genre: '',
  keywords: [],
  target_reader: '',
  platform_style: '',
  worldview: '',
  main_conflict: '',
  banned_items: [],
  important_scenes: [{ scene: '', purpose: '', chapter: '' }],
  stages: [{ stage: '', goal: '', conflict: '', result: '', turning_point: '' }],
  open_line: [{ chapter: '', event: '', goal: '', conflict: '', result: '' }],
  hidden_line: [{ chapter: '', truth: '', visible_hint: '', hidden_meaning: '', reveal_timing: '' }],
  foreshadowings: [{ id: '', content: '', first_chapter: '', surface_signal: '', reader_feeling: '', true_meaning: '', payoff_chapter: '', payoff: '', emphasis: '', status: '未出现' }],
  chapter_plan: [{ chapter: '', chapter_id: '', title: '', focus: '', key_events: '', stage_result: '', conflict: '', result: '', open_line: '', hidden_line: '', foreshadowing: '' }],
}

const STORY_CARD_TEMPLATE = {
  id: 'story_new',
  type: 'story',
  title: '',
  tags: [],
  links: [],
  payload: STORY_PAYLOAD_TEMPLATE,
}

const BUILD_WIZARD_STEPS = [
  { id: 'basics', label: '基础信息', draftKind: 'story_overview', checks: ['书名', '题材', '关键词', '目标读者', '禁写事项'] },
  { id: 'outline', label: '小故事大纲', draftKind: 'story_overview', checks: ['一句话故事', '主题', '主冲突', '平台风格'] },
  { id: 'characters', label: '人物初设', draftKind: 'character_seed', checks: ['人物卡', '动机', '边界', '小传'] },
  { id: 'scenes', label: '重要场景', draftKind: 'story_overview', checks: ['开篇', '转折', '高潮', '回收'] },
  { id: 'lines', label: '明线暗线伏笔', draftKind: 'lines', checks: ['明线', '暗线', '伏笔'] },
  { id: 'confirm', label: '确认写入', draftKind: '', checks: ['部分接受', '保存故事卡', '先不用'] },
]

const TASK_AI_MODULES = [
  { id: 'setup_story', label: '建书/题材', group: '设定建设' },
  { id: 'setup_character', label: '人物初设/小传', group: '设定建设' },
  { id: 'setup_lines', label: '明暗线/脉络草案', group: '设定建设' },
  { id: 'outline_research', label: '大纲调研', group: '设定建设' },
  { id: 'chapter_writer', label: '章节正文生成', group: '章节生成' },
  { id: 'chapter_reviewer', label: '章节审查', group: '章节生成' },
  { id: 'proofreader', label: '基础校对', group: '章节生成' },
  { id: 'canon_extractor', label: '事实抽取', group: '可信检查' },
  { id: 'timeline_checker', label: '时间线检查', group: '可信检查' },
  { id: 'scene_checker', label: '场景一致性', group: '可信检查' },
  { id: 'foreshadow_tracker', label: '脉络/伏笔追踪', group: '可信检查' },
  { id: 'recap_reviewer', label: '风险检查', group: '可信检查' },
]

const AI_MODULE_LABELS = Object.fromEntries(TASK_AI_MODULES.map((item) => [item.id, item.label]))

const WRITE_ROUTE_MODULES = ['chapter_writer', 'chapter_reviewer', 'proofreader', 'canon_extractor']

const GENERATION_SCOPE_OPTIONS = [
  { id: 'chapter', label: '当前章节' },
  { id: 'beat', label: '当前爆点/情节点' },
  { id: 'volume', label: '当前卷' },
  { id: 'book', label: '整本书草案' },
]

const GENERATION_STOP_OPTIONS = [
  { id: 'chapter', label: '每章后停止' },
  { id: 'beat', label: '爆点后停止' },
  { id: 'volume', label: '每卷后停止' },
  { id: 'risk', label: '发现风险时停止' },
]

const GENERATION_CHECK_OPTIONS = [
  { id: 'marks', label: '生成后分析标记' },
  { id: 'risks', label: '生成后检查风险' },
  { id: 'manual', label: '只等待作者确认' },
]

const CANVAS_STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  ai_suggesting: 'AI 建议中',
  pending_author: '待作者确认',
  confirmed: '作者已确认',
  written_supported: '已写入正文',
  written_pending: '待正文确认',
  missing_in_chapter: '本章未写到',
  risk: '有结构风险',
  skipped: '已跳过',
}

const CANVAS_STATUS_TONE: Record<string, string> = {
  not_started: 'canvas-status-empty',
  ai_suggesting: 'canvas-status-blue',
  pending_author: 'canvas-status-amber',
  confirmed: 'canvas-status-green',
  written_supported: 'canvas-status-green',
  written_pending: 'canvas-status-amber',
  missing_in_chapter: 'canvas-status-muted',
  risk: 'canvas-status-red',
  skipped: 'canvas-status-muted',
}

const CANVAS_TYPE_LABELS: Record<string, string> = {
  foundation: '建书',
  character: '人物',
  world: '世界观',
  thread: '脉络',
  line: '明暗线',
  clue: '伏笔',
  volume: '卷',
  beat: '爆点',
  scene: '场景',
  ending: '结局',
}

const TECHNIQUE_LAYER_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'structure', label: '结构' },
  { id: 'scene', label: '场景' },
  { id: 'character', label: '人物' },
  { id: 'language', label: '语言' },
  { id: 'recipe', label: '配方' },
]

const cloneJson = (value: any) => JSON.parse(JSON.stringify(value))

const normalizeStoryCard = (card: any) => {
  const base = cloneJson(STORY_CARD_TEMPLATE)
  const payload = { ...cloneJson(STORY_PAYLOAD_TEMPLATE), ...(card?.payload || {}) }
  return { ...base, ...(card || {}), type: 'story', payload }
}

function loadMRU(): { id: string; title: string; group: string; subtitle?: string }[] {
  try {
    const raw = localStorage.getItem(MRU_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 20)
  } catch {
    return []
  }
}

function saveMRU(rows: { id: string; title: string; group: string; subtitle?: string }[]) {
  localStorage.setItem(MRU_KEY, JSON.stringify(rows.slice(0, 20)))
}

export default function App() {
  const { push } = useToast()

  const [project, setProject] = useState('demo_project_001')
  const [view, setView] = useState('projects')
  const [activeActivity, setActiveActivity] = useState('explorer')
  const [events, setEvents] = useState<any[]>([])
  const [sideSearch, setSideSearch] = useState('')

  const [styleUploadText, setStyleUploadText] = useState('')
  const [activeStyleAssets, setActiveStyleAssets] = useState<string[]>([])
  const [llmProfileId, setLlmProfileId] = useState('mock_default')
  const [useAgentAssignments, setUseAgentAssignments] = useState(true)
  const [selectedChapter, setSelectedChapter] = useState('chapter_001')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [selectedProposalId, setSelectedProposalId] = useState('')
  const [selectedBlueprintId, setSelectedBlueprintId] = useState('')
  const [highlightRange, setHighlightRange] = useState<{ start: number; end: number } | null>(null)
  const [assetViewer, setAssetViewer] = useState<{ open: boolean; title: string; content: string }>({ open: false, title: '', content: '' })
  const [assetFind, setAssetFind] = useState('')
  const [autoApplyPatch, setAutoApplyPatch] = useState(false)
  const [selectedOpIds, setSelectedOpIds] = useState<string[]>([])
  const [selectionMode, setSelectionMode] = useState<'line' | 'paragraph'>('line')
  const [selectionStart, setSelectionStart] = useState('')
  const [selectionEnd, setSelectionEnd] = useState('')
  const [pendingWriteJob, setPendingWriteJob] = useState<{ maxTokens: number; range: { start: number; end: number } | null; label: string; techniqueAction?: any } | null>(null)
  const [generationScope, setGenerationScope] = useState('chapter')
  const [generationStopPoint, setGenerationStopPoint] = useState('chapter')
  const [generationCheckMode, setGenerationCheckMode] = useState('marks')
  const [generationUseCards, setGenerationUseCards] = useState(true)
  const [generationUseTechniques, setGenerationUseTechniques] = useState(true)
  const [generationUseLines, setGenerationUseLines] = useState(true)
  const [selectedCanvasConstraintIds, setSelectedCanvasConstraintIds] = useState<string[]>([])
  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<any>(null)
  const [factRevisionModal, setFactRevisionModal] = useState<{ open: boolean; fact: any | null; patch: string; reason: string }>({ open: false, fact: null, patch: '{}', reason: '' })
  const [sessionMessageId, setSessionMessageId] = useState('writer_msg_001')
  const [sessionMessageText, setSessionMessageText] = useState('')
  const [worldQuery, setWorldQuery] = useState('临港城 封锁')
  const [worldRows, setWorldRows] = useState<any[]>([])
  const [wikiHtml, setWikiHtml] = useState('<html><head><title>示例</title></head><body><table class="infobox"><tr><th>阵营</th><td>黑潮同盟</td></tr></table><h2>设定</h2><p>临港城由七港区组成。</p></body></html>')
  const [techniqueQuery, setTechniqueQuery] = useState('')
  const [techniqueLibraryTab, setTechniqueLibraryTab] = useState('叙事技巧')
  const [techniqueLayerFilter, setTechniqueLayerFilter] = useState('all')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [mru, setMru] = useState<{ id: string; title: string; group: string; subtitle?: string }[]>([])
  const [buildDraft, setBuildDraft] = useState<{ draft_id?: string; kind: string; title: string; body: string; revision: number; source?: string; status?: string; created_at?: string; accepted_scope?: string[]; accepted_target?: string; rejection_reason?: string; source_node?: any; generation_reason?: string } | null>(null)
  const [buildDraftBusy, setBuildDraftBusy] = useState(false)
  const [buildWizardStep, setBuildWizardStep] = useState('basics')
  const [buildDraftHistoryFilter, setBuildDraftHistoryFilter] = useState('all')
  const [selectedTimelineNodeId, setSelectedTimelineNodeId] = useState('build')
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState('thread:main')

  const paletteCacheRef = useRef<PaletteCache>({
    storyCards: [],
    characters: [],
    worldCards: [],
    styleCards: [],
    outlines: [],
    blueprints: [],
    chapters: [],
    proposals: [],
    techniques: [],
    techniqueCategories: [],
    toolSkills: [],
  })

  const schemaCacheRef = useRef<SchemaCache>({ cardSchemas: {} })
  const backupImportInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const loaded = loadSettings()
    setSettings(loaded)
    setAutoApplyPatch(loaded.defaultAutoApplyPatch)
    setLlmProfileId(loaded.defaultLlmProfileId)
    applySettingsToDom(loaded)
    setMru(loadMRU())
  }, [])

  const applySettings = (next: AppSettings) => {
    setSettings(next)
    saveSettings(next)
    applySettingsToDom(next)
  }

  const trackMRU = (item: CommandItem) => {
    if (item.group !== 'Navigate') return
    const next = [{ id: item.id, title: item.title, subtitle: item.subtitle, group: item.group }, ...mru.filter((x) => x.id !== item.id)].slice(0, 20)
    setMru(next)
    saveMRU(next)
  }

  const { data: projects, mutate: mutateProjects } = useSWR('/api/projects', api.get)
  const { data: projectInfo } = useSWR(project ? `/api/projects/${project}` : null, api.get)
  const { data: storySchema } = useSWR('/api/schema/cards/story', api.get)
  const { data: charSchema } = useSWR('/api/schema/cards/character', api.get)
  const { data: styleSchema } = useSWR('/api/schema/cards/style', api.get)
  const { data: techniqueSchema } = useSWR('/api/schema/cards/technique', api.get)
  const { data: techniqueCategorySchema } = useSWR('/api/schema/cards/technique_category', api.get)
  const { data: toolSkillSchema } = useSWR('/api/schema/cards/tool_skill', api.get)
  const { data: storyCards, mutate: mutateStoryCards } = useSWR(project ? `/api/projects/${project}/cards?type=story` : null, api.get)
  const { data: chars, mutate: mutateCards } = useSWR(project ? `/api/projects/${project}/cards?type=character` : null, api.get)
  const { data: styles, mutate: mutateStyles } = useSWR(project ? `/api/projects/${project}/cards?type=style` : null, api.get)
  const { data: volumes, mutate: mutateVolumes } = useSWR(project ? `/api/projects/${project}/volumes` : null, api.get)
  const { data: draftDetails, mutate: mutateDraftDetails } = useSWR(project ? `/api/projects/${project}/drafts/details` : null, api.get)
  const { data: draft, mutate: mutateDraft } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}` : null, api.get)
  const { data: versions, mutate: mutateVersions } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/versions` : null, api.get)
  const { data: sessionMeta, mutate: mutateSessionMeta } = useSWR(project ? `/api/projects/${project}/sessions/session_001/meta` : null, api.get)
  const { data: proposals, mutate: mutateProposals } = useSWR(project ? `/api/projects/${project}/canon/proposals` : null, api.get)
  const { data: canonFacts, mutate: mutateCanonFacts } = useSWR(project ? `/api/projects/${project}/canon/facts?include_revisions=true` : null, api.get)
  const { data: techniqueCards, mutate: mutateTechniqueCards } = useSWR(project ? `/api/projects/${project}/cards?type=technique` : null, api.get)
  const { data: techniqueCategories, mutate: mutateTechniqueCategories } = useSWR(project ? `/api/projects/${project}/cards?type=technique_category` : null, api.get)
  const { data: toolSkillCards, mutate: mutateToolSkillCards } = useSWR(project ? `/api/projects/${project}/cards?type=tool_skill` : null, api.get)
  const { data: globalProfiles, mutate: mutateGlobalProfiles } = useSWR('/api/config/llm/profiles', api.get)
  const { data: globalAssignments, mutate: mutateGlobalAssignments } = useSWR('/api/config/llm/assignments', api.get)
  const { data: providersMeta } = useSWR('/api/config/llm/providers_meta', api.get)
  const { data: llmStatus, mutate: mutateLlmStatus } = useSWR('/api/config/llm/status', api.get)
  const { data: memoryPacks, mutate: mutateMemoryPacks } = useSWR(project ? `/api/projects/${project}/memory_packs?chapter_id=${selectedChapter}` : null, api.get)
  const { data: evidenceMarks, mutate: mutateEvidenceMarks } = useSWR(project ? `/api/projects/${project}/chapters/${selectedChapter}/evidence-marks` : null, api.get)
  const { data: trustReport, mutate: mutateTrustReport } = useSWR(project ? `/api/projects/${project}/trust-report?chapter_id=${selectedChapter}` : null, api.get)
  const { data: buildDraftRows, mutate: mutateBuildDraftRows } = useSWR(project ? `/api/projects/${project}/build-drafts` : null, api.get)
  const { data: jobRows, mutate: mutateJobs } = useSWR(project ? `/api/projects/${project}/jobs` : null, api.get)
  const { data: selectedJobDetail, mutate: mutateSelectedJobDetail } = useSWR(project && selectedJobId ? `/api/projects/${project}/jobs/${selectedJobId}` : null, api.get)
  const { data: chapterReviewRows, mutate: mutateChapterReviews } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/reviews` : null, api.get)
  const { data: patchReviewRows, mutate: mutatePatchReviews } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/patch-reviews` : null, api.get)

  const [storyForm, setStoryForm] = useState<any>(normalizeStoryCard(null))
  const [characterForm, setCharacterForm] = useState<any>({ id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })
  const [techniqueForm, setTechniqueForm] = useState<any>(null)
  const [categoryForm, setCategoryForm] = useState<any>(null)
  const [toolSkillForm, setToolSkillForm] = useState<any>(null)
  const [profilesEditor, setProfilesEditor] = useState('')
  const [assignmentsEditor, setAssignmentsEditor] = useState('')
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string>>({})
  const [presetProfileId, setPresetProfileId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('openai_compat:deepseek')
  const [profileDraft, setProfileDraft] = useState<any>({})
  const [selectedMemoryPackId, setSelectedMemoryPackId] = useState('')
  const [storyPlanningTab, setStoryPlanningTab] = useState('Overview')
  const [chapterEditorText, setChapterEditorText] = useState('')
  const [chapterTitleDraft, setChapterTitleDraft] = useState('')
  const [chapterSaving, setChapterSaving] = useState(false)
  const [alignmentIdea, setAlignmentIdea] = useState('')
  const [alignmentUnderstanding, setAlignmentUnderstanding] = useState('')
  const [alignmentUnderstandingVersions, setAlignmentUnderstandingVersions] = useState<any[]>([])
  const [alignmentAgreedDraft, setAlignmentAgreedDraft] = useState('')
  const [alignmentConfirmed, setAlignmentConfirmed] = useState(false)
  const [alignmentDiscussionInput, setAlignmentDiscussionInput] = useState('')
  const [alignmentMessages, setAlignmentMessages] = useState<any[]>([])
  const [chapterWorkMode, setChapterWorkMode] = useState<'alignment' | 'draft'>('alignment')
  const [selectedMarkId, setSelectedMarkId] = useState('')
  const currentManifest = events.filter((e) => e.event === 'CONTEXT_MANIFEST').slice(-1)[0]?.data
  const latestPatch = events.filter((e) => e.event === 'EDITOR_PATCH').slice(-1)[0]?.data

  const projectProfiles = projectInfo?.llm_profiles || {}
  const profiles = { ...(globalProfiles?.profiles || {}), ...projectProfiles }
  const providerPresets = ((providersMeta?.providers || []) as ProviderMeta[])
  const selectedPreset = providerPresets.find((x) => x.provider_id === selectedPresetId)
  const { data: selectedMemoryPack } = useSWR(
    project && selectedMemoryPackId ? `/api/projects/${project}/memory_packs/${encodeURIComponent(selectedMemoryPackId)}` : null,
    api.get,
  )
  const volumeRows = Array.isArray(volumes) ? volumes : []
  const chapterRows = Array.isArray(draftDetails) ? draftDetails : []
  const currentChapterMeta = (draft?.meta || chapterRows.find((x: any) => x.chapter_id === selectedChapter) || {}) as any
  const savedCanvasConstraintKey = JSON.stringify(currentChapterMeta?.narrative_canvas_node_ids || [])
  const currentVolume = volumeRows.find((v: any) => v.id === (currentChapterMeta?.volume_id || 'volume_default')) || volumeRows[0]
  const activeStoryPayload = normalizeStoryCard(storyForm).payload || {}
  const currentStoryLinks = {
    chapterPlan: (activeStoryPayload.chapter_plan || []).filter((x: any) => x.chapter_id === selectedChapter || x.chapter === selectedChapter),
    openLine: (activeStoryPayload.open_line || []).filter((x: any) => x.chapter === selectedChapter || x.chapter_id === selectedChapter),
    hiddenLine: (activeStoryPayload.hidden_line || []).filter((x: any) => x.chapter === selectedChapter || x.chapter_id === selectedChapter),
    foreshadowings: (activeStoryPayload.foreshadowings || []).filter((x: any) => x.first_chapter === selectedChapter || x.payoff_chapter === selectedChapter),
  }
  const evidenceMarkRows = Array.isArray(evidenceMarks) ? evidenceMarks : []
  const selectedMark = evidenceMarkRows.find((m: any) => m.mark_id === selectedMarkId) || evidenceMarkRows[0]
  const buildDraftList = Array.isArray(buildDraftRows) ? buildDraftRows : []
  const jobList = Array.isArray(jobRows) ? jobRows : []
  const latestJob = jobList[0]
  const selectedJobSummary = selectedJobDetail || jobList.find((job: any) => job.job_id === selectedJobId)
  const selectedJobEvents = Array.isArray(selectedJobDetail?.events) ? selectedJobDetail.events : []
  const selectedJobManifest = selectedJobDetail?.context_manifest || selectedJobEvents.filter((evt: any) => evt.event === 'CONTEXT_MANIFEST').slice(-1)[0]?.data
  const selectedJobTrust = selectedJobDetail?.trust_report_event || selectedJobEvents.filter((evt: any) => evt.event === 'TRUST_REPORT').slice(-1)[0]?.data
  const chapterReviewList = Array.isArray(chapterReviewRows) ? chapterReviewRows : []
  const pendingChapterReviews = chapterReviewList.filter((x: any) => x.status === 'pending_author_review')
  const patchReviewList = Array.isArray(patchReviewRows) ? patchReviewRows : []
  const pendingPatchReviews = patchReviewList.filter((x: any) => x.status === 'pending_author_review')
  const activePatchReview = pendingPatchReviews[0] || patchReviewList[0]
  const reviewPatch = latestPatch?.ops?.length ? latestPatch : activePatchReview ? { ...activePatchReview, patch_review_id: activePatchReview.review_id } : null
  const pendingBuildDrafts = buildDraftList.filter((x: any) => (x.status || 'pending') === 'pending')
  const processedBuildDrafts = buildDraftList.filter((x: any) => (x.status || 'pending') !== 'pending')
  const profileHealthRows = Array.isArray(llmStatus?.profiles) ? llmStatus.profiles : []
  const selectedProfileHealth = profileHealthRows.find((row: any) => row.profile_id === llmProfileId)
  const agentModuleRows = Array.isArray(llmStatus?.modules) ? llmStatus.modules : []
  const writeRouteRows = useAgentAssignments
    ? agentModuleRows.filter((row: any) => WRITE_ROUTE_MODULES.includes(row.module))
    : WRITE_ROUTE_MODULES.map((module) => ({
      module,
      profile_id: llmProfileId,
      provider: selectedProfileHealth?.provider || profiles[llmProfileId]?.provider || 'missing',
      model: selectedProfileHealth?.model || profiles[llmProfileId]?.model || '',
      is_mock: Boolean(selectedProfileHealth?.is_mock || profiles[llmProfileId]?.provider === 'mock'),
      missing_fields: selectedProfileHealth?.missing_fields || (!profiles[llmProfileId] ? ['profile'] : []),
      profile_missing: !profiles[llmProfileId],
      requires_api_key: selectedProfileHealth?.requires_api_key,
      api_key_configured: selectedProfileHealth?.api_key_configured,
    }))
  const buildDraftHistoryRows = buildDraftHistoryFilter === 'all' ? processedBuildDrafts : processedBuildDrafts.filter((x: any) => x.status === buildDraftHistoryFilter)
  const buildDraftHistoryCounts = {
    all: processedBuildDrafts.length,
    accepted: processedBuildDrafts.filter((x: any) => x.status === 'accepted').length,
    partially_accepted: processedBuildDrafts.filter((x: any) => x.status === 'partially_accepted').length,
    rejected: processedBuildDrafts.filter((x: any) => x.status === 'rejected').length,
  }
  const acceptedScopeLabels = (rec: any) => (Array.isArray(rec?.accepted_scope) ? rec.accepted_scope.filter((x: any) => typeof x === 'string' && x.trim()) : [])
  const hasText = (value: any) => String(value || '').trim().length > 0
  const hasArrayItems = (value: any) => Array.isArray(value) && value.some((item: any) => {
    if (typeof item === 'string') return hasText(item)
    if (!item || typeof item !== 'object') return Boolean(item)
    return Object.values(item).some((entry) => Array.isArray(entry) ? entry.length > 0 : hasText(entry))
  })
  const traceRowsFor = (targetType: string, candidates: any[]) => {
    const needles = candidates.map((x) => String(x || '').trim()).filter(Boolean)
    return evidenceMarkRows.filter((mark: any) => {
      if (mark.target_type !== targetType) return false
      const hay = [mark.target_id, mark.label, mark.span?.quote, ...(mark.detection?.matched_signals || [])].map((x) => String(x || ''))
      return needles.length === 0 || needles.some((needle) => hay.some((h) => h.includes(needle) || needle.includes(h)))
    })
  }
  const traceBadgeTone = (rows: any[]) => rows.some((mark: any) => mark?.detection?.support_level === 'supported' && mark?.span?.quote) ? 'success' : rows.length ? 'warn' : 'default'
  const traceSummary = (rows: any[]) => {
    if (!rows.length) return '未使用'
    const supported = rows.filter((mark: any) => mark?.detection?.support_level === 'supported' && mark?.span?.quote).length
    return supported ? `${supported}/${rows.length} 已证实` : `${rows.length} 条待确认`
  }
  const isMaintainerMode = settings.experienceMode === 'maintainer'
  const meaningfulRows = (rows: any[] | undefined, keys: string[]) => (Array.isArray(rows) ? rows : []).filter((row: any) => keys.some((key) => String(row?.[key] || '').trim()))
  const importantSceneRows = meaningfulRows(activeStoryPayload.important_scenes, ['scene', 'purpose', 'chapter'])
  const openLineRows = meaningfulRows(activeStoryPayload.open_line, ['event', 'goal', 'conflict', 'result'])
  const hiddenLineRows = meaningfulRows(activeStoryPayload.hidden_line, ['truth', 'visible_hint', 'hidden_meaning', 'reveal_timing'])
  const foreshadowingRows = meaningfulRows(activeStoryPayload.foreshadowings, ['content', 'surface_signal', 'true_meaning', 'payoff'])
  const storedNarrativeCanvasNodes = Array.isArray(activeStoryPayload.narrative_canvas?.nodes) ? activeStoryPayload.narrative_canvas.nodes : []
  const baseCanvasConstraintRows = [
    { id: 'thread:main', label: '脉络', type: 'thread', group: 'thread', description: activeStoryPayload.main_conflict || '本章需要遵守的主冲突和结构方向。' },
    { id: 'line:open', label: '明线', type: 'line', group: 'thread', description: openLineRows.length ? `${openLineRows.length} 个明线节点` : '表面事件推进。' },
    { id: 'line:hidden', label: '暗线', type: 'line', group: 'thread', description: hiddenLineRows.length ? `${hiddenLineRows.length} 个暗线节点` : '隐藏真相推进。' },
    { id: 'thread:foreshadowing', label: '伏笔', type: 'clue', group: 'thread', description: foreshadowingRows.length ? `${foreshadowingRows.length} 条伏笔` : '伏笔埋设/回收。' },
    ...volumeRows.map((volume: any, index: number) => ({ id: `volume:${volume.id}`, label: volume.title || `第${index + 1}卷`, type: 'volume', group: 'volume', description: volume.summary || '本卷结构目标。', ref_id: volume.id })),
    ...importantSceneRows.map((row: any, index: number) => ({
      id: `beat:${String(row.scene || row.chapter || index + 1).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48)}`,
      label: /爆点|爆发|高潮|转折|危机/.test(row.scene || '') ? row.scene : `爆点${index + 1}`,
      type: /结局|终局|收束/.test(`${row.scene || ''}${row.purpose || ''}`) ? 'ending' : 'beat',
      group: 'beat',
      description: row.purpose || row.scene || '强事件或结构转折。',
      ref_id: row.chapter || '',
    })),
    { id: 'ending:final', label: '结局', type: 'ending', group: 'ending', description: '结局方向和必须回收的承诺。' },
  ]
  const baseCanvasConstraintIds = new Set(baseCanvasConstraintRows.map((node: any) => node.id))
  const canvasConstraintRows = [
    ...baseCanvasConstraintRows,
    ...storedNarrativeCanvasNodes.filter((node: any) => node?.id && !baseCanvasConstraintIds.has(node.id)),
  ]
  const selectedCanvasConstraints = canvasConstraintRows.filter((node: any) => selectedCanvasConstraintIds.includes(node.id))
  const toggleCanvasConstraint = (nodeId: string) => {
    setSelectedCanvasConstraintIds((prev) => prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId])
  }
  const traceTypesForCanvasNode = (node: any) => {
    if (node.id === 'line:open') return ['open_line']
    if (node.id === 'line:hidden') return ['hidden_line']
    if (node.type === 'clue') return ['foreshadowing']
    if (node.type === 'character') return ['character']
    if (node.type === 'beat' || node.type === 'ending' || node.type === 'thread') return ['open_line', 'hidden_line', 'foreshadowing']
    return ['open_line', 'hidden_line', 'foreshadowing', 'canon_fact']
  }
  const traceMarksForCanvasNode = (node: any, marks: any[]) => {
    const targetTypes = traceTypesForCanvasNode(node)
    const candidates = [node.id, node.label, node.ref_id, node.description, node.author_decision].map((x) => String(x || '').trim()).filter(Boolean)
    return marks.filter((mark: any) => {
      if (!targetTypes.includes(mark.target_type)) return false
      const hay = [mark.target_id, mark.label, mark.span?.quote, ...(mark.detection?.matched_signals || [])].map((x) => String(x || ''))
      return candidates.length === 0 || candidates.some((needle) => hay.some((h) => h.includes(needle) || needle.includes(h)))
    })
  }
  const applyCanvasEvidenceStatuses = async (marks: any[] = evidenceMarkRows) => {
    if (!selectedCanvasConstraintIds.length) return
    const now = new Date().toISOString()
    const current = normalizeStoryCard(storyForm)
    const payload = { ...(current.payload || {}) }
    const stored = payload.narrative_canvas && typeof payload.narrative_canvas === 'object' ? payload.narrative_canvas : {}
    const storedNodes = Array.isArray(stored.nodes) ? stored.nodes : []
    const byId = new Map(storedNodes.map((node: any) => [node.id, node]))
    const nextNodes = canvasConstraintRows.map((node: any) => {
      const old = byId.get(node.id) || {}
      if (!selectedCanvasConstraintIds.includes(node.id)) return { ...node, ...old }
      const traces = traceMarksForCanvasNode({ ...node, ...old }, marks)
      const supported = traces.filter((mark: any) => mark?.detection?.support_level === 'supported' && mark?.span?.quote)
      const status = supported.length ? 'written_supported' : traces.length ? 'written_pending' : 'missing_in_chapter'
      return {
        ...node,
        ...old,
        status,
        chapter_status: status,
        chapter_id: selectedChapter,
        evidence_mark_ids: traces.map((mark: any) => mark.mark_id).filter(Boolean),
        evidence_supported_count: supported.length,
        evidence_total_count: traces.length,
        evidence_updated_at: now,
      }
    })
    for (const node of storedNodes) {
      if (!nextNodes.some((row: any) => row.id === node.id)) nextNodes.push(node)
    }
    const nextCard = normalizeStoryCard({
      ...current,
      payload: {
        ...payload,
        narrative_canvas: {
          ...stored,
          version: stored.version || 1,
          updated_at: now,
          nodes: nextNodes,
          edges: Array.isArray(stored.edges) ? stored.edges : [],
        },
      },
    })
    setStoryForm(nextCard)
    if (nextCard.id && nextCard.id !== 'story_new') {
      await api.put(`/api/projects/${project}/cards/${nextCard.id}`, nextCard)
      mutateStoryCards()
    }
  }

  useEffect(() => {
    const ids = Array.isArray(currentChapterMeta?.narrative_canvas_node_ids) ? currentChapterMeta.narrative_canvas_node_ids.filter(Boolean) : []
    setSelectedCanvasConstraintIds(ids)
  }, [selectedChapter, savedCanvasConstraintKey])

  const storyBuildProgress = [
    {
      id: 'basics',
      label: '基础信息',
      done: Boolean(storyForm?.title && activeStoryPayload.genre && (activeStoryPayload.keywords || []).length && activeStoryPayload.target_reader && (activeStoryPayload.banned_items || []).length),
      detail: `${(activeStoryPayload.keywords || []).length} 个关键词 · ${(activeStoryPayload.banned_items || []).length} 条禁写`,
    },
    {
      id: 'outline',
      label: '小故事大纲',
      done: Boolean(activeStoryPayload.logline && activeStoryPayload.theme && activeStoryPayload.main_conflict),
      detail: activeStoryPayload.logline ? '已有一句话故事' : '缺一句话故事',
    },
    {
      id: 'characters',
      label: '人物初设',
      done: Array.isArray(chars) && chars.length > 0,
      detail: `${Array.isArray(chars) ? chars.length : 0} 张人物卡`,
    },
    {
      id: 'scenes',
      label: '重要场景',
      done: importantSceneRows.length > 0,
      detail: `${importantSceneRows.length} 个场景`,
    },
    {
      id: 'lines',
      label: '明线暗线伏笔',
      done: openLineRows.length > 0 && hiddenLineRows.length > 0 && foreshadowingRows.length > 0,
      detail: `明线 ${openLineRows.length} · 暗线 ${hiddenLineRows.length} · 伏笔 ${foreshadowingRows.length}`,
    },
    {
      id: 'confirm',
      label: '确认写入',
      done: pendingBuildDrafts.length === 0,
      detail: `${pendingBuildDrafts.length} 个待确认草案`,
    },
  ]
  const completedBuildSteps = storyBuildProgress.filter((x) => x.done).length
  const activeBuildWizardStep = BUILD_WIZARD_STEPS.find((x) => x.id === buildWizardStep) || BUILD_WIZARD_STEPS[0]

  const applyPresetToEditor = () => {
    const profileId = (presetProfileId || '').trim()
    if (!profileId) {
      push('请先填写模型配置名称', 'error')
      return
    }
    if (!selectedPreset) {
      push('服务商模板还没加载完成', 'error')
      return
    }
    try {
      const parsed = JSON.parse(profilesEditor || '{}')
      const next = {
        ...(parsed || {}),
        [profileId]: { ...(selectedPreset.defaults || {}) },
      }
      setProfilesEditor(JSON.stringify(next, null, 2))
      push(`已填入模型配置：${profileId}`)
    } catch {
      push('模型配置 JSON 无法解析，请先修正', 'error')
    }
  }

  const saveProfileDraft = async () => {
    const profileId = (presetProfileId || '').trim()
    if (!profileId) {
      push('请先填写模型配置名称', 'error')
      return
    }
    const required = selectedPreset?.required_fields || ['provider', 'model']
    const existing = globalProfiles?.profiles?.[profileId] || {}
    const normalized = {
      provider: String(profileDraft.provider || selectedPreset?.defaults?.provider || '').trim(),
      model: String(profileDraft.model || '').trim(),
      base_url: String(profileDraft.base_url || '').trim(),
      api_key: String(profileDraft.api_key || existing.api_key || ''),
      timeout_s: Number(profileDraft.timeout_s || 60),
      stream: Boolean(profileDraft.stream ?? selectedPreset?.supports_stream ?? true),
    }
    const missing = required.filter((field) => !String((normalized as any)[field] || '').trim())
    if (missing.length) {
      push(`还有必填项未填：${missing.join(', ')}`, 'error')
      return
    }
    try {
      await api.post('/api/config/llm/profiles', { mode: 'upsert', id: profileId, profile: normalized })
      const next = { ...(globalProfiles?.profiles || {}), [profileId]: normalized }
      setProfilesEditor(JSON.stringify(next, null, 2))
      await mutateGlobalProfiles()
      await mutateLlmStatus()
      push(`模型配置已保存：${profileId}`)
    } catch {
      push('模型配置保存失败', 'error')
    }
  }

  const loadProfileDraft = (profileId: string) => {
    const profile = globalProfiles?.profiles?.[profileId] || {}
    const matchedPreset = providerPresets.find((preset) => {
      const defaults = preset.defaults || {}
      return defaults.provider === profile.provider && (!defaults.base_url || defaults.base_url === profile.base_url)
    }) || providerPresets.find((preset) => preset.defaults?.provider === profile.provider)
    if (matchedPreset) setSelectedPresetId(matchedPreset.provider_id)
    setPresetProfileId(profileId)
    setProfileDraft({ ...profile, api_key: '' })
    push(`已载入模型配置：${profileId}`)
  }

  const deleteProfileDraft = async (profileId: string) => {
    if (profileId === 'mock_default') {
      push('mock_default 是内置测试配置，不能删除', 'error')
      return
    }
    try {
      await api.post('/api/config/llm/profiles', { mode: 'delete', id: profileId })
      if (presetProfileId === profileId) {
        setPresetProfileId('')
        setProfileDraft({ ...(selectedPreset?.defaults || {}) })
      }
      await mutateGlobalProfiles()
      await mutateLlmStatus()
      push(`模型配置已删除：${profileId}`)
    } catch {
      push('模型配置删除失败', 'error')
    }
  }

  const saveAgentAssignment = async (module: string, profileId: string) => {
    try {
      await api.post('/api/config/llm/assignments', { mode: 'upsert', module, profile_id: profileId })
      const next = { ...assignmentDraft, [module]: profileId }
      setAssignmentDraft(next)
      setAssignmentsEditor(JSON.stringify(next, null, 2))
      await mutateGlobalAssignments()
      await mutateLlmStatus()
      push(`写作分工已更新：${AI_MODULE_LABELS[module] || module} -> ${profileId}`)
    } catch {
      push('写作分工保存失败', 'error')
    }
  }

  useEffect(() => {
    setProfilesEditor(JSON.stringify(globalProfiles?.profiles || {}, null, 2))
  }, [globalProfiles])

  useEffect(() => {
    const next = globalAssignments?.assignments || {}
    setAssignmentsEditor(JSON.stringify(next, null, 2))
    setAssignmentDraft(next)
  }, [globalAssignments])

  useEffect(() => {
    const preset = providerPresets.find((x) => x.provider_id === selectedPresetId)
    if (preset) setProfileDraft({ ...(preset.defaults || {}) })
  }, [providersMeta, selectedPresetId])

  useEffect(() => {
    const rows = Array.isArray(memoryPacks) ? memoryPacks : []
    if (!rows.length) {
      setSelectedMemoryPackId('')
      return
    }
    if (!selectedMemoryPackId || !rows.some((r: any) => r.pack_id === selectedMemoryPackId)) {
      setSelectedMemoryPackId(rows[0].pack_id)
    }
  }, [memoryPacks, selectedMemoryPackId])

  useEffect(() => {
    const rows = Array.isArray(storyCards) ? storyCards : []
    if (!rows.length) return
    const currentId = storyForm?.id
    if (!currentId || currentId === 'story_new' || !rows.some((x: any) => x.id === currentId)) {
      setStoryForm(normalizeStoryCard(rows[0]))
    }
  }, [storyCards])

  useEffect(() => {
    setChapterEditorText(draft?.content || '')
    setChapterTitleDraft(draft?.meta?.chapter_title || draft?.meta?.title || selectedChapter)
  }, [draft, selectedChapter])

  useEffect(() => {
    const alignment = draft?.meta?.writing_alignment || {}
    setAlignmentIdea(alignment.idea || '')
    setAlignmentUnderstanding(alignment.understanding || '')
    setAlignmentUnderstandingVersions(Array.isArray(alignment.understanding_versions) ? alignment.understanding_versions : (alignment.understanding ? [{ version_id: 'current', text: alignment.understanding, created_at: alignment.updated_at, source: 'current' }] : []))
    setAlignmentAgreedDraft(alignment.agreed_draft || '')
    setAlignmentConfirmed(Boolean(alignment.confirmed))
    setAlignmentMessages(Array.isArray(alignment.messages) ? alignment.messages : [])
    setAlignmentDiscussionInput('')
  }, [draft, selectedChapter])

  const lazyLoadPaletteData = async (force = false) => {
    const cache = paletteCacheRef.current
    if (!force && cache.loadedFor === project) return
    try {
      const [storyRows, characters, worldview, worldRules, lore, styleCards, outlines, blueprints, chapters, proposalRows, techniqueRows, categoryRows, toolSkillRows, storySchemaFromApi, charSchema, styleSchemaFromApi, toolSkillSchemaFromApi, blueprintSchema] = await Promise.all([
        api.get(`/api/projects/${project}/cards?type=story`),
        api.get(`/api/projects/${project}/cards?type=character`),
        api.get(`/api/projects/${project}/cards?type=worldview`),
        api.get(`/api/projects/${project}/cards?type=world_rule`),
        api.get(`/api/projects/${project}/cards?type=lore`),
        api.get(`/api/projects/${project}/cards?type=style`),
        api.get(`/api/projects/${project}/cards?type=outline`),
        api.get(`/api/projects/${project}/blueprints`),
        api.get(`/api/projects/${project}/drafts/details`),
        api.get(`/api/projects/${project}/canon/proposals`),
        api.get(`/api/projects/${project}/cards?type=technique`),
        api.get(`/api/projects/${project}/cards?type=technique_category`),
        api.get(`/api/projects/${project}/cards?type=tool_skill`),
        api.get(`/api/schema/cards/story`),
        api.get(`/api/schema/cards/character`),
        api.get(`/api/schema/cards/style`),
        api.get(`/api/schema/cards/tool_skill`),
        api.get(`/api/schema/blueprint`),
      ])
      paletteCacheRef.current = {
        loadedFor: project,
        storyCards: Array.isArray(storyRows) ? storyRows : [],
        characters: Array.isArray(characters) ? characters : [],
        worldCards: [...(Array.isArray(worldview) ? worldview : []), ...(Array.isArray(worldRules) ? worldRules : []), ...(Array.isArray(lore) ? lore : [])],
        styleCards: Array.isArray(styleCards) ? styleCards : [],
        outlines: Array.isArray(outlines) ? outlines : [],
        blueprints: Array.isArray(blueprints) ? blueprints : [],
        chapters: Array.isArray(chapters) ? chapters : [],
        proposals: Array.isArray(proposalRows) ? proposalRows : [],
        techniques: Array.isArray(techniqueRows) ? techniqueRows : [],
        techniqueCategories: Array.isArray(categoryRows) ? categoryRows : [],
        toolSkills: Array.isArray(toolSkillRows) ? toolSkillRows : [],
      }

      schemaCacheRef.current = {
        cardSchemas: {
          story: storySchemaFromApi || {},
          character: charSchema || {},
          style: styleSchemaFromApi || {},
          tool_skill: toolSkillSchemaFromApi || {},
        },
        blueprint: blueprintSchema || {},
      }
    } catch {
      push('快捷入口素材读取失败，暂时只显示本地命令', 'error')
      paletteCacheRef.current.loadedFor = project
    }
  }

  const refreshPaletteData = async () => {
    paletteCacheRef.current = { storyCards: [], characters: [], worldCards: [], styleCards: [], outlines: [], blueprints: [], chapters: [], proposals: [], techniques: [], techniqueCategories: [], toolSkills: [] }
    await lazyLoadPaletteData(true)
    push('快捷入口素材已刷新')
  }


  const schemaHasPath = (schema: any, path: string): boolean => {
    if (!schema || !schema.properties) return false
    const parts = path.split('.')
    let node: any = schema
    for (const part of parts) {
      if (!node?.properties?.[part]) return false
      node = node.properties[part]
    }
    return true
  }

  const setByPath = (target: any, path: string, value: any) => {
    const parts = path.split('.')
    let cur = target
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i]
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {}
      cur = cur[key]
    }
    cur[parts[parts.length - 1]] = value
  }

  const uniq = (arr: string[]) => {
    const out: string[] = []
    for (const x of arr) {
      if (!x || out.includes(x)) continue
      out.push(x)
    }
    return out
  }

  const createTypeLabel = (type: string) => ({
    project: '书',
    blueprint: '大纲蓝图',
    volume: '卷',
    chapter: '章节',
    character: '人物',
    world: '世界观',
    lore: '资料',
    world_rule: '世界规则',
    style: '文风',
    outline: '大纲',
    story: '故事卡',
    technique: '技法',
    tool_skill: '写作工具',
  } as Record<string, string>)[type] || type

  const mapCreateCard = (parsed: ParsedCreate): { card: any; warnings: string[] } => {
    const warnings: string[] = []
    const ts = Date.now()
    const typeMap: Record<string, string> = {
      character: 'character',
      world: 'world',
      style: 'style',
      outline: 'outline',
      story: 'story',
      lore: 'lore',
      world_rule: 'world_rule',
      technique: 'technique',
      tool_skill: 'tool_skill',
    }
    const cardType = typeMap[parsed.type] || parsed.type
    const card: any = {
      id: `${cardType}_${ts}`,
      type: cardType,
      title: parsed.title,
      tags: uniq(parsed.tags),
      links: [],
      payload: {},
    }

    if (parsed.type === 'character') {
      const schema = schemaCacheRef.current.cardSchemas.character
      const rawTags = uniq(parsed.tags)
      const canonical: string[] = []
      if (rawTags.includes('主角')) canonical.push('protagonist')
      if (rawTags.includes('配角')) canonical.push('supporting')
      if (rawTags.includes('反派')) canonical.push('antagonist')
      card.tags = uniq([...rawTags, ...canonical])

      const setMaybe = (k: string, path: string, value: any) => {
        if (value === undefined || value === null || value === '') return
        if (schemaHasPath(schema, path)) setByPath(card, path, value)
        else warnings.push(`已忽略 --${k}：当前卡片没有这个字段`)
      }
      setMaybe('name', 'payload.name', parsed.title)
      setMaybe('identity', 'payload.identity', parsed.opts.identity)
      setMaybe('appearance', 'payload.appearance', parsed.opts.appearance)
      setMaybe('motivation', 'payload.core_motivation', parsed.opts.motivation)
      setMaybe('family', 'payload.family_background', parsed.opts.family)
      setMaybe('voice', 'payload.voice', parsed.opts.voice)
      setMaybe('personality_traits', 'payload.personality_traits', uniq((parsed.opts.trait as string[]) || []))
      setMaybe('boundaries', 'payload.boundaries', uniq((parsed.opts.boundary as string[]) || []))

      const rel = ((parsed.opts.rel as any[]) || []).map((x: any) => ({ target: x?.map?.target, type: x?.map?.type })).filter((x: any) => x.target || x.type)
      const arc = ((parsed.opts.arc as any[]) || []).map((x: any) => ({ beat: x?.map?.beat, goal: x?.map?.goal })).filter((x: any) => x.beat || x.goal)
      setMaybe('rel', 'payload.relationships', rel)
      setMaybe('arc', 'payload.arc', arc)

      const explicitRole = typeof parsed.opts.role === 'string' ? String(parsed.opts.role) : ''
      const roleFromTag = canonical[0] || ''
      const resolvedRole = explicitRole || roleFromTag || undefined
      const explicitImportance = parsed.opts.importance as number | undefined
      const inferredImportance = roleFromTag === 'protagonist' ? 5 : roleFromTag === 'antagonist' ? 4 : roleFromTag === 'supporting' ? 3 : undefined
      setMaybe('role', 'payload.role', resolvedRole)
      setMaybe('importance', 'payload.importance', explicitImportance ?? inferredImportance)
      setMaybe('age', 'payload.age', parsed.opts.age)
    }

    if (parsed.type === 'technique') {
      const categories = (paletteCacheRef.current.techniqueCategories || []) as any[]
      const title = parsed.title
      const inferCategoryName = (name: string) => {
        if (/(蒙太奇|倒叙|插叙|剪辑|回环)/.test(name)) return '结构手法'
        if (/(冷笔触|白描|冰山)/.test(name)) return '表达手法'
        if (/(隐喻|象征|反讽)/.test(name)) return '修辞手法'
        if (/(环境|侧面|心理)/.test(name)) return '描写方法'
        if (/(节奏|反高潮|信息延迟)/.test(name)) return '表现手法'
        return '表达手法'
      }
      const categoryName = String(parsed.opts.category || inferCategoryName(title))
      const cat = categories.find((x: any) => x?.title === categoryName || x?.payload?.name === categoryName)
      const aliases = uniq(((parsed.opts.alias as string[]) || []).concat([title]))
      const signals = uniq((parsed.opts.signal as string[]) || ['出现可观察技法信号', '段落节奏与目标一致'])
      const steps = uniq((parsed.opts.step as string[]) || ['明确场景目标', '在关键句实施技法', '收束并复核过度使用'])
      card.tags = uniq(parsed.tags)
      card.payload = {
        name: title,
        category_id: cat?.id || categories[0]?.id || 'technique_category_expression',
        aliases,
        description: String(parsed.opts.desc || `${title}（命令面板创建的默认模板）`),
        apply_steps: steps,
        signals,
        intensity_levels: {
          low: '点状使用',
          med: '贯穿关键段',
          high: '作为本段主导技法',
        },
        metrics: {},
        do_dont: { do: ['服务场景目标'], dont: ['避免堆砌'] },
        examples: [],
      }
    }

    if (parsed.type === 'tool_skill') {
      const category = String(parsed.opts.category || 'checker')
      const agentRole = String(parsed.opts.agent_role || (category === 'research' ? 'researcher' : category === 'generator' ? 'writer' : 'reviewer'))
      card.tags = uniq([...parsed.tags, 'tool_skill', category])
      card.payload = {
        name: parsed.title,
        category,
        description: String(parsed.opts.desc || `${parsed.title}：输出进入待确认队列，不自动覆盖作者卡片。`),
        input_types: uniq((parsed.opts.input as string[]) || ['chapter']),
        output_type: String(parsed.opts.output || 'proposal'),
        agent_role: agentRole,
        evidence_required: !Boolean(parsed.opts['no-evidence']),
        auto_apply_allowed: Boolean(parsed.opts['auto-apply']) && false,
        review_policy: '默认生成 proposal；作者确认后才写入卡片或 canon。',
        check_rules: uniq((parsed.opts.rule as string[]) || []),
        proposal_fields: uniq((parsed.opts.proposal_field as string[]) || []),
      }
    }

    if (parsed.type === 'world' || parsed.type === 'lore' || parsed.type === 'world_rule') {
      const set = (path: string, value: any) => {
        if (value === undefined || value === null || value === '') return
        setByPath(card, path, value)
      }
      set('payload.type', parsed.opts.type || parsed.type)
      set('payload.description', parsed.opts.desc)
      set('payload.atmosphere', parsed.opts.atmosphere)
      if (parsed.tags.length) set('payload.meta.tags', parsed.tags)
    }

    if (parsed.type === 'style') {
      const schema = schemaCacheRef.current.cardSchemas.style
      const lockKeys = ['pov', 'tense', 'punctuation', 'taboo_words']
      const locks: Record<string, boolean> = {}
      parsed.locks.forEach((lk) => {
        if (lockKeys.includes(lk)) locks[lk] = true
        else warnings.push(`已忽略 --lock ${lk}：暂不支持这个锁定项`)
      })
      const setMaybe = (k: string, path: string, value: any) => {
        if (value === undefined || value === null || value === '') return
        if (schemaHasPath(schema, path)) setByPath(card, path, value)
        else warnings.push(`已忽略 --${k}：当前卡片没有这个字段`)
      }
      setMaybe('lock', 'payload.locks', locks)
      setMaybe('max_examples', 'payload.injection_policy.max_examples', parsed.opts.max_examples)
      setMaybe('max_chars', 'payload.injection_policy.max_chars_per_example', parsed.opts.max_chars)
    }

    if (parsed.type === 'outline' && parsed.opts.note) {
      setByPath(card, 'payload.note', parsed.opts.note)
    }

    if (parsed.type === 'story') {
      card.payload = {
        ...cloneJson(STORY_PAYLOAD_TEMPLATE),
        logline: String(parsed.opts.logline || parsed.opts.note || ''),
        theme: String(parsed.opts.theme || ''),
        genre: String(parsed.opts.genre || ''),
        keywords: uniq((parsed.opts.keyword as string[]) || []),
        target_reader: String(parsed.opts.target_reader || ''),
        platform_style: String(parsed.opts.platform_style || ''),
        banned_items: uniq((parsed.opts.banned as string[]) || []),
        important_scenes: parsed.opts.scene ? [{ scene: String(parsed.opts.scene), purpose: '', chapter: '' }] : [],
      }
    }

    return { card, warnings }
  }

  const runCreate = async (rawInput: string) => {
    const parsed = parseCreateInput(rawInput)
    if (!parsed) return { ok: false, message: '这不是创建命令' }
    if (parsed.errors.length) return { ok: false, message: parsed.errors[0] }

    try {
      if (parsed.type === 'project') {
        const res = await api.post('/api/projects', { title: parsed.title })
        if (res?.detail) return { ok: false, message: String(res.detail?.message || res.detail) }
        setProject(res.project_id)
        setView('projects')
        mutateProjects()
        return { ok: true, label: `project:${parsed.title}` }
      }

      if (parsed.type === 'blueprint') {
        const nScenes = Number(parsed.opts.scenes ?? 1)
        const blueprint = {
          id: `blueprint_${Date.now()}`,
          story_type_id: String(parsed.opts.story_type || 'longform_novel'),
          title: parsed.title,
          scene_plan: Array.from({ length: nScenes }).map((_, i) => ({
            scene_id: `scene_${i + 1}`,
            phase: 'setup',
            purpose: `Scene ${i + 1} purpose`,
            situation: `Scene ${i + 1} situation`,
            choice_points: ['待定'],
          })),
        }
        const res = await api.post(`/api/projects/${project}/blueprints`, blueprint)
        if (res?.detail) return { ok: false, message: String(res.detail?.message || res.detail) }
        setSelectedBlueprintId(blueprint.id)
        setView('context')
        await lazyLoadPaletteData(true)
        return { ok: true, label: `blueprint:${parsed.title}` }
      }

      if (parsed.type === 'volume') {
        const volume = {
          id: `volume_${Date.now()}`,
          title: parsed.title,
          summary: String(parsed.opts.summary || ''),
          order_index: Number(parsed.opts.order ?? (volumeRows.length + 1)),
          chapter_ids: [],
        }
        const res = await api.post(`/api/projects/${project}/volumes`, volume)
        if (res?.detail) return { ok: false, message: String(res.detail?.message || res.detail) }
        setActiveActivity('explorer')
        await mutateVolumes()
        await lazyLoadPaletteData(true)
        return { ok: true, label: `volume:${parsed.title}` }
      }

      if (parsed.type === 'chapter') {
        const chapterId = `ch_${Date.now()}`
        const volumeId = String(parsed.opts.volume || currentVolume?.id || 'volume_default')
        const body = {
          content: `# ${parsed.title}

`,
          chapter_title: parsed.title,
          title: parsed.title,
          chapter_status: String(parsed.opts.status || 'draft'),
          volume_id: volumeId,
          order_index: Number(parsed.opts.order ?? (chapterRows.length + 1)),
        }
        const put1 = await api.put(`/api/projects/${project}/drafts/${chapterId}`, body)
        if (put1?.detail) return { ok: false, message: String(put1.detail?.message || put1.detail) }
        const meta: any = {
          chapter_id: chapterId,
          title: parsed.title,
          chapter_title: parsed.title,
          chapter_status: String(parsed.opts.status || 'draft'),
          volume_id: volumeId,
          order_index: Number(parsed.opts.order ?? (chapterRows.length + 1)),
          chapter_summary: '',
          scene_summaries: [],
          open_questions: [],
          canon_candidates: [],
        }
        if (parsed.opts.bind) meta.blueprint_id = parsed.opts.bind
        if (parsed.opts.scene !== undefined) meta.scene_index = parsed.opts.scene
        if (parsed.flags.signals) meta.signals = true
        if (parsed.flags['no-signals']) meta.signals = false
        const put2 = await api.put(`/api/projects/${project}/drafts/${chapterId}/meta`, meta)
        if (put2?.detail) return { ok: false, message: String(put2.detail?.message || put2.detail) }
        setSelectedChapter(chapterId)
        setView('chapter')
        setActiveActivity('explorer')
        await mutateVolumes()
        await mutateDraftDetails()
        await lazyLoadPaletteData(true)
        return { ok: true, label: `chapter:${parsed.title}` }
      }

      const mapped = mapCreateCard(parsed)
      const res = await api.post(`/api/projects/${project}/cards`, mapped.card)
      if (res?.detail) return { ok: false, message: String(res.detail?.message || res.detail) }
      if (mapped.warnings.length) push(mapped.warnings[0], 'error')

      if (parsed.type === 'character') {
        setCharacterForm(mapped.card)
        setView('characters')
        mutateCards()
      } else if (parsed.type === 'style') {
        setView('style')
        mutateStyles()
      } else if (parsed.type === 'story') {
        setStoryForm(normalizeStoryCard(mapped.card))
        setView('story')
        mutateStoryCards()
      } else if (parsed.type === 'world' || parsed.type === 'lore' || parsed.type === 'world_rule') {
        setView('world')
      } else if (parsed.type === 'outline') {
        setView('context')
      } else if (parsed.type === 'technique') {
        setView('techniques')
        mutateTechniqueCards()
      } else if (parsed.type === 'tool_skill') {
        setView('techniques')
        setTechniqueLibraryTab('写作工具')
        setToolSkillForm(mapped.card)
        mutateToolSkillCards()
      }
      await lazyLoadPaletteData(true)
      return { ok: true, label: `${parsed.type}:${parsed.title}` }
    } catch {
      return { ok: false, message: '创建失败，请检查命令内容' }
    }
  }


  const resolveTechniqueByQuery = (q: string) => {
    const rows = (paletteCacheRef.current.techniques || []) as any[]
    const query = q.trim().toLowerCase()
    const matched = rows.filter((t: any) => {
      const id = String(t.id || '').toLowerCase()
      const title = String(t.title || '').toLowerCase()
      const name = String(t.payload?.name || '').toLowerCase()
      return id === query || title === query || name === query || id.includes(query) || title.includes(query) || name.includes(query)
    })
    if (!matched.length) return null
    return matched[0]
  }

  const pinTechniqueToChapter = async (tech: any, intensity: string, weight?: number, notes?: string) => {
    if (!selectedChapter) return { ok: false, message: '请先打开一个章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques : []
    const row: any = { technique_id: tech.id, intensity: intensity || 'med' }
    if (weight !== undefined) row.weight = weight
    if (notes) row.notes = notes
    const next = [row, ...pinned.filter((x: any) => x.technique_id !== tech.id)]
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_techniques: next })
    mutateDraft()
    return { ok: true, message: `已把技法挂到本章：${tech.title || tech.id} (${row.intensity})` }
  }

  const unpinTechniqueFromChapter = async (tech: any) => {
    if (!selectedChapter) return { ok: false, message: '请先打开一个章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques : []
    const next = pinned.filter((x: any) => x.technique_id !== tech.id)
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_techniques: next })
    mutateDraft()
    return { ok: true, message: `已从本章移除技法：${tech.title || tech.id}` }
  }


  const resolveCategoryByQuery = (q: string) => {
    const rows = (paletteCacheRef.current.techniqueCategories || []) as any[]
    const query = q.trim().toLowerCase()
    const byPath = (c: any) => {
      const parentId = c?.payload?.parent_id
      const parent = rows.find((r: any) => r.id === parentId)
      const parentName = parent ? String(parent.title || parent.payload?.name || '').trim() : ''
      const selfName = String(c.title || c.payload?.name || '').trim()
      return parentName ? `${parentName}/${selfName}` : selfName
    }
    const matched = rows.filter((c: any) => {
      const id = String(c.id || '').toLowerCase()
      const title = String(c.title || '').toLowerCase()
      const name = String(c.payload?.name || '').toLowerCase()
      const path = byPath(c).toLowerCase()
      return id === query || title === query || name === query || path === query || id.includes(query) || title.includes(query) || name.includes(query) || path.includes(query)
    })
    if (!matched.length) return null
    return matched[0]
  }

  const pinCategoryToChapter = async (cat: any, intensity: string, weight?: number, notes?: string) => {
    if (!selectedChapter) return { ok: false, message: '请先打开一个章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_technique_categories) ? meta.pinned_technique_categories : []
    const row: any = { category_id: cat.id, intensity: intensity || 'med' }
    if (weight !== undefined) row.weight = weight
    if (notes) row.notes = notes
    const next = [row, ...pinned.filter((x: any) => x.category_id !== cat.id)]
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_technique_categories: next })
    mutateDraft()
    return { ok: true, message: `已把技法分类挂到本章：${cat.title || cat.id} (${row.intensity})` }
  }

  const unpinCategoryFromChapter = async (cat: any) => {
    if (!selectedChapter) return { ok: false, message: '请先打开一个章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_technique_categories) ? meta.pinned_technique_categories : []
    const next = pinned.filter((x: any) => x.category_id !== cat.id)
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_technique_categories: next })
    mutateDraft()
    return { ok: true, message: `已从本章移除技法分类：${cat.title || cat.id}` }
  }

  const parseCategoryPinCommand = (query: string): { mode: 'pin_cat' | 'unpin_cat' | 'list_cat' | null; name?: string; intensity?: string; weight?: number; note?: string; error?: string } => {
    const q = query.trim()
    if (/^list\s+pinned\s+categories$/i.test(q)) return { mode: 'list_cat' }
    const tokens = q.split(/\s+/)
    const isPin = /^pin$/i.test(tokens[0] || '')
    const isUnpin = /^unpin$/i.test(tokens[0] || '')
    if (!isPin && !isUnpin) return { mode: null }
    if (!/^cat(egory)?$/i.test(tokens[1] || '')) return { mode: null }
    const rest = q.replace(/^\s*(pin|unpin)\s+cat(egory)?\s+/i, '')
    const parts = rest.split(/\s+--/)
    const head = parts[0].trim()
    const optsRaw = parts.slice(1)
    const headTokens = head.split(/\s+/).filter(Boolean)
    if (!headTokens.length) return { mode: isPin ? 'pin_cat' : 'unpin_cat', error: '请填写技法分类名称' }
    let intensity = 'med'
    if (isPin && ['low', 'med', 'high'].includes((headTokens[headTokens.length - 1] || '').toLowerCase())) {
      intensity = headTokens.pop()!.toLowerCase()
    }
    const name = headTokens.join(' ').replace(/^"|"$/g, '')
    let weight: number | undefined
    let note = ''
    for (const seg of optsRaw) {
      const s = seg.trim()
      if (s.startsWith('weight ')) {
        const v = Number(s.slice('weight '.length).trim())
        if (Number.isFinite(v)) weight = v
      }
      if (s.startsWith('note ')) {
        note = s.slice('note '.length).trim().replace(/^"|"$/g, '')
      }
    }
    return { mode: isPin ? 'pin_cat' : 'unpin_cat', name, intensity, weight, note }
  }

  const parsePinCommand = (query: string): { mode: 'pin' | 'unpin' | 'list' | null; name?: string; intensity?: string; weight?: number; note?: string; error?: string } => {
    const q = query.trim()
    if (/^list\s+pinned\s+techniques$/i.test(q)) return { mode: 'list' }
    const tokens = q.split(/\s+/)
    const isPin = /^pin$/i.test(tokens[0] || '')
    const isUnpin = /^unpin$/i.test(tokens[0] || '')
    if (!isPin && !isUnpin) return { mode: null }
    if (!/^tech(nique)?$/i.test(tokens[1] || '')) return { mode: null }
    const rest = q.replace(/^\s*(pin|unpin)\s+tech(nique)?\s+/i, '')
    const parts = rest.split(/\s+--/)
    const head = parts[0].trim()
    const optsRaw = parts.slice(1)
    const headTokens = head.split(/\s+/).filter(Boolean)
    if (!headTokens.length) return { mode: isPin ? 'pin' : 'unpin', error: '请填写技法名称' }
    let intensity = 'med'
    if (isPin && ['low', 'med', 'high'].includes((headTokens[headTokens.length - 1] || '').toLowerCase())) {
      intensity = headTokens.pop()!.toLowerCase()
    }
    const name = headTokens.join(' ').replace(/^"|"$/g, '')
    let weight: number | undefined
    let note = ''
    for (const seg of optsRaw) {
      const s = seg.trim()
      if (s.startsWith('weight ')) {
        const v = Number(s.slice('weight '.length).trim())
        if (Number.isFinite(v)) weight = v
      }
      if (s.startsWith('note ')) {
        note = s.slice('note '.length).trim().replace(/^"|"$/g, '')
      }
    }
    return { mode: isPin ? 'pin' : 'unpin', name, intensity, weight, note }
  }

  const resolveCreateCommand = (query: string): { item?: CommandItem; error?: string } | null => {
    const catParsed = parseCategoryPinCommand(query)
    if (catParsed.mode === 'list_cat') {
      return {
        item: {
          id: 'cmd-list-pinned-categories',
          title: '查看本章技法分类',
          subtitle: selectedChapter || '先打开章节',
          group: '写作动作',
          icon: List,
          run: async () => {
            if (!selectedChapter) {
              push('请先打开一个章节', 'error')
              return
            }
            const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
            push(`本章技法分类：${JSON.stringify(meta?.pinned_technique_categories || [])}`)
          },
        },
      }
    }

    if (catParsed.mode === 'pin_cat' || catParsed.mode === 'unpin_cat') {
      if (catParsed.error) return { error: catParsed.error }
      const hit = resolveCategoryByQuery(catParsed.name || '')
      if (!hit) return { error: `没有找到技法分类：${catParsed.name}` }
      const actionTitle = catParsed.mode === 'pin_cat' ? `挂载技法分类 ${hit.title} ${catParsed.intensity || 'med'}` : `取消技法分类 ${hit.title}`
      return {
        item: {
          id: `${catParsed.mode}-${hit.id}`,
          title: actionTitle,
          subtitle: selectedChapter || '先打开章节',
          group: '写作动作',
          icon: Sparkles,
          run: async () => {
            const out = catParsed.mode === 'pin_cat'
              ? await pinCategoryToChapter(hit, catParsed.intensity || 'med', catParsed.weight, catParsed.note)
              : await unpinCategoryFromChapter(hit)
            if (out.ok) push(out.message)
            else push(out.message || '命令执行失败', 'error')
          },
        },
      }
    }

    const pinParsed = parsePinCommand(query)
    if (pinParsed.mode === 'list') {
      return {
        item: {
          id: 'cmd-list-pinned-techniques',
          title: '查看本章技法',
          subtitle: selectedChapter || '先打开章节',
          group: '写作动作',
          icon: List,
          run: async () => {
            if (!selectedChapter) {
              push('请先打开一个章节', 'error')
              return
            }
            const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
            push(`本章技法：${JSON.stringify(meta?.pinned_techniques || [])}`)
          },
        },
      }
    }

    if (pinParsed.mode === 'pin' || pinParsed.mode === 'unpin') {
      if (pinParsed.error) return { error: pinParsed.error }
      const hit = resolveTechniqueByQuery(pinParsed.name || '')
      if (!hit) return { error: `没有找到技法：${pinParsed.name}` }
      const actionTitle = pinParsed.mode === 'pin' ? `挂载技法 ${hit.title} ${pinParsed.intensity || 'med'}` : `取消技法 ${hit.title}`
      return {
        item: {
          id: `${pinParsed.mode}-tech-${hit.id}`,
          title: actionTitle,
          subtitle: selectedChapter || '先打开章节',
          group: '写作动作',
          icon: Sparkles,
          run: async () => {
            const out = pinParsed.mode === 'pin'
              ? await pinTechniqueToChapter(hit, pinParsed.intensity || 'med', pinParsed.weight, pinParsed.note)
              : await unpinTechniqueFromChapter(hit)
            if (out.ok) push(out.message)
            else push(out.message || '命令执行失败', 'error')
          },
        },
      }
    }

    if (!isCreateMode(query)) return null
    const parsed = parseCreateInput(query)
    if (!parsed) return null

    if (parsed.errors.length) {
      return { error: parsed.errors[0] }
    }

    return {
      item: {
        id: `create-${parsed.type}-${parsed.title || 'untitled'}`,
        title: `新建${createTypeLabel(parsed.type)}：${parsed.title || '请先填写标题'}`,
        subtitle: parsed.title ? '按 Enter 创建' : '缺少标题',
        group: '新建',
        icon: Sparkles,
        keywords: [parsed.type, parsed.title, ...parsed.tags, ...parsed.locks, ...createHelpText()],
        payload: { kind: 'create', type: parsed.type },
        run: async () => {
          const out = await runCreate(query)
          if (!out.ok) {
            push(out.message || '创建失败', 'error')
            return
          }
          push(`已创建${createTypeLabel(parsed.type)}：${parsed.title || out.label}`)
        },
      },
    }
  }

  const uploadStyleSample = async () => {
    try {
      const fd = new FormData()
      const file = new File([styleUploadText], `style_${Date.now()}.txt`, { type: 'text/plain' })
      fd.append('file', file)
      fd.append('kind', 'style_sample')
      const r = await fetch(`/api/projects/${project}/uploads`, { method: 'POST', body: fd }).then((x) => x.json())
      const assetId = r.asset_id || r?.items?.[0]?.asset_id
      if (assetId) setActiveStyleAssets((x) => [...x, assetId])
      push('文风样本已上传')
    } catch {
      push('文风样本上传失败', 'error')
    }
  }

  const analyzeStyle = async () => {
    try {
      await api.post(`/api/projects/${project}/style/analyze`, { style_card_id: 'style_001', asset_ids: activeStyleAssets, mode: 'fast' })
      mutateStyles()
      push('文风分析完成')
    } catch {
      push('文风分析失败', 'error')
    }
  }

  const runJob = async (maxTokens = 2400, range: { start: number; end: number } | null = null, techniqueAction: any = null) => {
    try {
      const routeRisks = writeRouteRows.filter((row: any) => row.is_mock || row.profile_missing || row.missing_fields?.length)
      if (useAgentAssignments && !writeRouteRows.length) {
        push('模型分工还没有读取完成，请先刷新或去设置页检查', 'error')
        if (!isMaintainerMode) return
      } else if (useAgentAssignments && routeRisks.length) {
        push(`写作分工还有 ${routeRisks.length} 项待配置，请先补齐模型/API`, 'error')
        if (!isMaintainerMode) return
      } else if (!useAgentAssignments && selectedProfileHealth?.is_mock) {
        push(`当前模型配置 ${llmProfileId} 是模拟模式，请先换成真实 API`, 'error')
        if (!isMaintainerMode) return
      } else if (!useAgentAssignments && selectedProfileHealth?.missing_fields?.length) {
        push(`当前模型配置 ${llmProfileId} 还缺少字段：${selectedProfileHealth.missing_fields.join(', ')}`, 'error')
        if (!isMaintainerMode) return
      } else if (!useAgentAssignments && !profiles[llmProfileId]) {
        push(`当前模型配置 ${llmProfileId} 未找到，请先去设置页配置`, 'error')
        if (!isMaintainerMode) return
      }
      setSelectedOpIds([])
      setEvents([])
      const j = await api.post(`/api/projects/${project}/jobs/write`, {
        chapter_id: selectedChapter,
        blueprint_id: 'blueprint_001',
        scene_index: 0,
        agent_mode: 'three_agent',
        agents: ['reviewer', 'writer', 'proofreader'],
        llm_profile_id: useAgentAssignments ? undefined : llmProfileId,
        auto_apply_patch: Boolean(autoApplyPatch),
        word_checkpoint_chars: 1500,
        generation_control: {
          scope: generationScope,
          stop_point: generationStopPoint,
          check_mode: generationCheckMode,
          include_cards: generationUseCards,
          include_techniques: generationUseTechniques,
          include_lines: generationUseLines,
          narrative_canvas_node_ids: selectedCanvasConstraintIds,
          narrative_canvas_nodes: selectedCanvasConstraints.map((node: any) => ({
            node_id: node.id,
            label: node.label,
            type: node.type,
            group: node.group,
            description: node.description,
            status: node.status,
            author_decision: node.author_decision,
          })),
          writing_alignment: buildWritingAlignmentPayload({ confirmed: alignmentConfirmed, technique_action: techniqueAction || undefined }),
        },
        constraints: { max_tokens: maxTokens },
        selection_range: range || undefined,
      })
      mutateJobs()
      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${wsProto}://${window.location.host}/api/jobs/${j.job_id}/stream`)
      ws.onmessage = (e) => {
        const evt = JSON.parse(e.data)
        setEvents((x) => [...x, evt])
        if (evt.event === 'DONE') {
          mutateDraft()
          mutateDraftDetails()
          mutateVolumes()
          mutateStyles()
          mutateVersions()
          mutateSessionMeta()
          mutateMemoryPacks()
          mutateEvidenceMarks()
          mutateTrustReport()
          mutateProposals()
          mutateJobs()
          mutateChapterReviews()
          mutatePatchReviews()
          push('本章初稿已完成')
        }
        if (evt.event === 'MARK_EXTRACTION' && Array.isArray(evt.data?.marks)) {
          void applyCanvasEvidenceStatuses(evt.data.marks).then(() => push('本章结构点状态已根据正文依据更新'))
        }
      }
    } catch {
      push('本章起草失败', 'error')
    }
  }

  const requestRunJob = (maxTokens = 2400, range: { start: number; end: number } | null = null, label = '起草本章', techniqueAction: any = null) => {
    const missing = getWriteReadinessItems().filter((item) => !item.done)
    if (missing.length) {
      push(`请先补齐开写检查：${missing.slice(0, 3).map((item) => item.label).join('、')}`, 'error')
      return
    }
    setPendingWriteJob({ maxTokens, range, label, techniqueAction })
  }

  const analyzeChapter = async () => {
    try {
      setAnalyzeBusy(true)
      setAnalyzeResult(null)
      const res = await api.post(`/api/projects/${project}/analyze/${selectedChapter}`, { reason: 'ui_button' })
      setAnalyzeResult(res)
      mutateProposals()
      push(`分析完成：新增 ${res.new_facts_count || 0} 条事实，${res.new_proposals_count || 0} 条待确认建议`)
    } catch {
      push('分析失败', 'error')
    } finally {
      setAnalyzeBusy(false)
    }
  }

  const analyzeMarks = async () => {
    try {
      await saveChapterDraft()
      const res = await api.post(`/api/projects/${project}/chapters/${selectedChapter}/analyze-marks`, {})
      await mutateEvidenceMarks()
      await mutateTrustReport()
      await applyCanvasEvidenceStatuses(Array.isArray(res?.marks) ? res.marks : evidenceMarkRows)
      push(`检查完成：${res?.marks?.length || 0} 个正文依据`)
    } catch {
      push('正文依据检查失败', 'error')
    }
  }

  const updateEvidenceFeedback = async (mark: any, action: string) => {
    if (!mark?.mark_id) return
    try {
      await api.post(`/api/projects/${project}/chapters/${selectedChapter}/evidence-marks/${mark.mark_id}/feedback`, { action })
      await mutateEvidenceMarks()
      await mutateTrustReport()
      const labels: Record<string, string> = { confirm_hit: '已确认命中', false_positive: '已标为误判', ignore_chapter: '本章已忽略' }
      push(labels[action] || '反馈已保存')
    } catch {
      push('反馈保存失败', 'error')
    }
  }

  const createVolume = async () => {
    const idx = volumeRows.length + 1
    const volume = {
      id: `volume_${Date.now()}`,
      title: `第${idx}卷`,
      summary: '',
      order_index: idx,
      chapter_ids: [],
    }
    await api.post(`/api/projects/${project}/volumes`, volume)
    await mutateVolumes()
    await lazyLoadPaletteData(true)
    setActiveActivity('explorer')
    push(`已创建卷：${volume.title}`)
  }

  const createChapterInVolume = async (volumeId?: string) => {
    const idx = chapterRows.length + 1
    const chapterId = `ch_${Date.now()}`
    const title = `第${idx}章`
    await api.put(`/api/projects/${project}/drafts/${chapterId}`, {
      content: `# ${title}\n\n`,
      title,
      chapter_title: title,
      chapter_status: 'draft',
      volume_id: volumeId || currentVolume?.id || 'volume_default',
      order_index: idx,
    })
    setSelectedChapter(chapterId)
    setChapterEditorText(`# ${title}\n\n`)
    setChapterTitleDraft(title)
    setView('chapter')
    setActiveActivity('explorer')
    await mutateDraft()
    await mutateDraftDetails()
    await mutateVolumes()
    await lazyLoadPaletteData(true)
    push(`已创建章节：${title}`)
  }

  const saveChapterDraft = async () => {
    if (!selectedChapter) return
    try {
      setChapterSaving(true)
      const body = {
        content: chapterEditorText,
        title: chapterTitleDraft || selectedChapter,
        chapter_title: chapterTitleDraft || selectedChapter,
        chapter_status: currentChapterMeta?.chapter_status || 'draft',
        volume_id: currentChapterMeta?.volume_id || currentVolume?.id || 'volume_default',
        order_index: currentChapterMeta?.order_index ?? chapterRows.findIndex((x: any) => x.chapter_id === selectedChapter) + 1,
      }
      await api.put(`/api/projects/${project}/drafts/${selectedChapter}`, body)
      await mutateDraft()
      await mutateDraftDetails()
      await mutateVolumes()
      await mutateChapterReviews()
      push('正文已保存')
    } catch {
      push('正文保存失败', 'error')
    } finally {
      setChapterSaving(false)
    }
  }

  const saveChapterCanvasConstraints = async () => {
    if (!selectedChapter) return
    const meta = {
      ...(draft?.meta || currentChapterMeta || {}),
      narrative_canvas_node_ids: selectedCanvasConstraintIds,
      narrative_canvas_nodes: selectedCanvasConstraints.map((node: any) => ({
        node_id: node.id,
        label: node.label,
        type: node.type,
        group: node.group,
        description: node.description,
      })),
    }
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
    await mutateDraft()
    await mutateDraftDetails()
    push(`已保存 ${selectedCanvasConstraintIds.length} 个本章结构节点`)
  }

  const techniqueTitleById = (techniqueId: string) => {
    const tech = (Array.isArray(techniqueCards) ? techniqueCards : []).find((x: any) => x.id === techniqueId)
    return tech?.title || tech?.payload?.name || techniqueId
  }

  const techniqueLayerLabel = (layer?: string) => TECHNIQUE_LAYER_OPTIONS.find((x) => x.id === layer)?.label || '场景'

  const techniquePromptHints = (tech: any) => {
    const payload = tech?.payload || {}
    return {
      suitable: (payload.suitable_scenes || []).slice(0, 3).join('；'),
      unsuitable: (payload.unsuitable_scenes || []).slice(0, 3).join('；'),
      risks: (payload.overuse_risks || []).slice(0, 3).join('；'),
      steps: (payload.recipe_steps?.length ? payload.recipe_steps : payload.apply_steps || []).slice(0, 4).join('；'),
      signals: (payload.signals || []).slice(0, 4).join('；'),
      example: payload.rewrite_examples?.[0] || null,
    }
  }

  const requestTechniqueAction = (tech: any, mode: '试写一句' | '改写选区' | '强度变体', intensity = 'med', range: { start: number; end: number } | null = null) => {
    if (!tech) return
    const hints = techniquePromptHints(tech)
    const actualRange = mode === '改写选区' ? (range || selectionRange) : range
    if (mode === '改写选区' && !actualRange) {
      push('先在“只修改正文中的一小段”里填行号，再用技法改写。', 'error')
      return
    }
    const action = {
      mode,
      technique_id: tech.id,
      technique_title: tech.title || tech.payload?.name || tech.id,
      usage_layer: tech.payload?.usage_layer || 'scene',
      intensity,
      instruction: mode === '强度变体'
        ? '生成 low / med / high 三种版本，供作者比较，不自动覆盖正文。'
        : mode === '改写选区'
          ? '只改写所选行，让技法可观察但不要新增设定。'
          : '试写一句或一个很短段落，展示这个技法的实际效果。',
      suitable_scenes: hints.suitable,
      unsuitable_scenes: hints.unsuitable,
      overuse_risks: hints.risks,
      apply_steps: hints.steps,
      signals: hints.signals,
      rewrite_example: hints.example,
    }
    requestRunJob(mode === '强度变体' ? 1200 : 900, actualRange || null, `${mode}: ${action.technique_title}`, action)
  }

  const buildWritingAlignmentPayload = (overrides: Record<string, any> = {}) => ({
    idea: overrides.idea ?? alignmentIdea,
    understanding: overrides.understanding ?? alignmentUnderstanding,
    understanding_versions: overrides.understanding_versions ?? alignmentUnderstandingVersions,
    agreed_draft: overrides.agreed_draft ?? alignmentAgreedDraft,
    confirmed: overrides.confirmed ?? alignmentConfirmed,
    messages: overrides.messages ?? alignmentMessages,
    technique_action: overrides.technique_action ?? undefined,
    updated_at: new Date().toISOString(),
  })

  const saveWritingAlignment = async (overrides: Record<string, any> = {}) => {
    if (!selectedChapter) return
    try {
      const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, {
        ...meta,
        writing_alignment: buildWritingAlignmentPayload(overrides),
      })
      await mutateDraft()
      await mutateDraftDetails()
      push('写作共识已保存')
    } catch {
      push('写作共识保存失败', 'error')
    }
  }

  const generateAlignmentUnderstanding = async () => {
    const chapterPlan = currentStoryLinks.chapterPlan[0]
    const pinnedTechniques = Array.isArray(currentChapterMeta?.pinned_techniques) ? currentChapterMeta.pinned_techniques : []
    const techniqueLine = pinnedTechniques.length
      ? pinnedTechniques.map((row: any) => `${techniqueTitleById(row.technique_id)}(${row.intensity || 'med'}${row.notes ? `: ${row.notes}` : ''})`).join('；')
      : '本章还没有明确挂载技法，建议先从左侧选择 1-3 个。'
    const openLine = currentStoryLinks.openLine.map((row: any) => row.event || row.result || row.goal).filter(Boolean).join('；')
    const hiddenLine = currentStoryLinks.hiddenLine.map((row: any) => row.visible_hint || row.truth || row.hidden_meaning).filter(Boolean).join('；')
    const foreshadowings = currentStoryLinks.foreshadowings.map((row: any) => row.content || row.surface_signal || row.payoff).filter(Boolean).join('；')
    const bannedItems = (activeStoryPayload.banned_items || []).filter((x: any) => String(x || '').trim()).join('；')
    const importantScenes = (activeStoryPayload.important_scenes || [])
      .filter((row: any) => row?.chapter === selectedChapter || row?.chapter_id === selectedChapter || !row?.chapter)
      .map((row: any) => row.scene || row.purpose)
      .filter(Boolean)
      .slice(0, 3)
      .join('；')
    const understanding = [
      `我理解你这一章想写：${alignmentIdea.trim() || '作者还没有输入粗略想法，请先补一句这一章想发生什么。'}`,
      `本章位置：${currentVolume?.title || '未绑定卷'} / ${chapterTitleDraft || selectedChapter}。`,
      chapterPlan ? `章节计划：${chapterPlan.title || chapterPlan.chapter || selectedChapter}，重点是 ${chapterPlan.focus || chapterPlan.key_events || '待作者补充'}；冲突/结果：${chapterPlan.conflict || '未写冲突'} -> ${chapterPlan.result || chapterPlan.stage_result || '未写结果'}。` : '章节计划：还没有绑定到 Story 的 chapter_plan，建议先补一个本章计划行。',
      `这一章应当使用的技法：${techniqueLine}`,
      openLine ? `明线推进：${openLine}` : '明线推进：本章还没有明确明线节点。',
      hiddenLine ? `暗线提示：${hiddenLine}` : '暗线提示：本章还没有明确暗线节点。',
      foreshadowings ? `伏笔处理：${foreshadowings}` : '伏笔处理：本章没有绑定首次出现或回收的伏笔。',
      importantScenes ? `重要场景：${importantScenes}` : '',
      bannedItems ? `不要写：${bannedItems}` : '',
      '写作约定：先按这个理解扩展初稿；不新增作者未确认的人设、世界规则和主线决定；不确定的地方保留为待确认建议。',
    ].filter(Boolean).join('\n')
    const now = new Date().toISOString()
    const version = { version_id: `ai_${Date.now()}`, text: understanding, created_at: now, source: 'AI 整理' }
    const nextVersions = [version, ...alignmentUnderstandingVersions].slice(0, 6)
    const aiMessage = { role: 'ai', text: `我整理了一版新的理解，放在右侧缓存里。你可以继续修正我，也可以挑一版带入最终确认稿。`, created_at: now }
    const nextMessages = [...alignmentMessages, aiMessage].slice(-12)
    setAlignmentUnderstanding(understanding)
    setAlignmentUnderstandingVersions(nextVersions)
    setAlignmentConfirmed(false)
    setAlignmentMessages(nextMessages)
    await saveWritingAlignment({ understanding, understanding_versions: nextVersions, confirmed: false, messages: nextMessages })
  }

  const sendAlignmentMessage = async () => {
    const text = alignmentDiscussionInput.trim()
    if (!text) return
    const authorMessage = { role: 'author', text, created_at: new Date().toISOString() }
    const nextUnderstanding = [
      alignmentUnderstanding.trim() || 'AI 当前理解待整理。',
      `\n作者最新修正：${text}`,
    ].filter(Boolean).join('\n')
    const now = new Date().toISOString()
    const version = { version_id: `chat_${Date.now()}`, text: nextUnderstanding, created_at: now, source: '对话更新' }
    const nextVersions = [version, ...alignmentUnderstandingVersions].slice(0, 6)
    const aiMessage = {
      role: 'ai',
      text: `我会按这个修正更新理解。最终是否采用，以中间的确认稿为准。`,
      created_at: now,
    }
    const nextMessages = [...alignmentMessages, authorMessage, aiMessage].slice(-12)
    setAlignmentMessages(nextMessages)
    setAlignmentUnderstanding(nextUnderstanding)
    setAlignmentUnderstandingVersions(nextVersions)
    setAlignmentDiscussionInput('')
    setAlignmentConfirmed(false)
    await saveWritingAlignment({ messages: nextMessages, understanding: nextUnderstanding, understanding_versions: nextVersions, confirmed: false })
  }

  const mergeDiscussionIntoAgreement = async (text?: string) => {
    const recent = alignmentMessages.slice(-6).map((msg: any) => `${msg.role === 'author' ? '作者' : 'AI'}：${msg.text}`).join('\n')
    const next = [
      alignmentAgreedDraft.trim() || text?.trim() || alignmentUnderstanding.trim() || '确认稿待补充。',
      recent && !alignmentAgreedDraft.trim() ? `\n讨论补充：\n${recent}` : '',
    ].filter(Boolean).join('\n')
    setAlignmentAgreedDraft(next)
    setAlignmentConfirmed(false)
    await saveWritingAlignment({ agreed_draft: next, confirmed: false })
  }

  const confirmWritingAlignment = async () => {
    const agreed = alignmentAgreedDraft.trim() || alignmentUnderstanding.trim()
    if (!agreed) {
      push('请先生成或填写中间的写作共识', 'error')
      return
    }
    setAlignmentAgreedDraft(agreed)
    setAlignmentConfirmed(true)
    await saveWritingAlignment({ agreed_draft: agreed, confirmed: true })
  }

  const getWriteReadinessItems = () => {
    const pinnedTechniques = Array.isArray(currentChapterMeta?.pinned_techniques) ? currentChapterMeta.pinned_techniques : []
    const pinnedCategories = Array.isArray(currentChapterMeta?.pinned_technique_categories) ? currentChapterMeta.pinned_technique_categories : []
    const readyRoutes = writeRouteRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length)
    const modelReady = writeRouteRows.length > 0 && readyRoutes.length === writeRouteRows.length
    return [
      { label: '模型/API', done: isMaintainerMode || modelReady, detail: isMaintainerMode ? '维护者模式可测试' : writeRouteRows.length ? `${readyRoutes.length}/${writeRouteRows.length} 个分工可用` : '等待读取模型状态' },
      { label: '书名/题材', done: hasText(storyForm?.title) && hasText(activeStoryPayload.genre), detail: `${storyForm?.title || '缺书名'} · ${activeStoryPayload.genre || '缺题材'}` },
      { label: '小故事大纲', done: hasText(activeStoryPayload.logline), detail: activeStoryPayload.logline ? '已填写' : '缺一句话故事' },
      { label: '主冲突/禁写', done: hasText(activeStoryPayload.main_conflict) && hasArrayItems(activeStoryPayload.banned_items), detail: `${hasText(activeStoryPayload.main_conflict) ? '主冲突已填' : '缺主冲突'} · 禁写 ${(activeStoryPayload.banned_items || []).length || 0}` },
      { label: '人物卡', done: Array.isArray(chars) && chars.length > 0, detail: `${Array.isArray(chars) ? chars.length : 0} 张` },
      { label: '绑定章节计划', done: currentStoryLinks.chapterPlan.length > 0, detail: `${currentStoryLinks.chapterPlan.length} 行` },
      { label: '本章明暗伏', done: currentStoryLinks.openLine.length + currentStoryLinks.hiddenLine.length + currentStoryLinks.foreshadowings.length > 0, detail: `明 ${currentStoryLinks.openLine.length} · 暗 ${currentStoryLinks.hiddenLine.length} · 伏 ${currentStoryLinks.foreshadowings.length}` },
      { label: '本章技法', done: pinnedTechniques.length + pinnedCategories.length > 0, detail: `技法 ${pinnedTechniques.length} · 分类 ${pinnedCategories.length}` },
      { label: '写作共识', done: Boolean(alignmentConfirmed && alignmentAgreedDraft.trim()), detail: alignmentConfirmed ? '作者已确认' : '还没有确认写法' },
    ]
  }

  const canStartWriting = () => getWriteReadinessItems().every((item) => item.done)

  const requestRunJobWithAgreement = async () => {
    if (!alignmentConfirmed) {
      push('请先确认“作者同意这样写”，再按共识生成初稿', 'error')
      return
    }
    const missing = getWriteReadinessItems().filter((item) => !item.done)
    if (missing.length) {
      push(`请先补齐开写检查：${missing.slice(0, 3).map((item) => item.label).join('、')}`, 'error')
      return
    }
    await saveWritingAlignment({ confirmed: true })
    requestRunJob(2400, null, '按共识生成初稿')
  }

  const updateChapterReview = async (review: any, status: string) => {
    if (!review?.review_id) return
    try {
      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/reviews/${review.review_id}`, { status })
      await mutateChapterReviews()
      await mutateDraft()
      await mutateDraftDetails()
      push(status === 'accepted' ? 'AI 初稿已确认' : 'AI 初稿已标为先不用')
    } catch {
      push('AI 初稿状态更新失败', 'error')
    }
  }

  const applySelectedPatch = async () => {
    if (!reviewPatch?.ops?.length) return
    try {
      const accept = selectedOpIds.length ? selectedOpIds : reviewPatch.ops.map((o: any) => o.op_id)
      await api.post(`/api/projects/${project}/drafts/${selectedChapter}/apply-patch`, { patch_id: reviewPatch.patch_id, patch_review_id: reviewPatch.patch_review_id || reviewPatch.review_id, patch_ops: reviewPatch.ops, accept_op_ids: accept, selection_range: reviewPatch.selection_range || undefined })
      mutateDraft()
      mutateVersions()
      mutateSessionMeta()
      mutatePatchReviews()
      push('校对建议已应用')
    } catch {
      push('校对建议应用失败', 'error')
    }
  }

  const rejectPatchReview = async () => {
    const reviewId = reviewPatch?.patch_review_id || reviewPatch?.review_id
    if (!reviewId) return
    try {
      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/patch-reviews/${reviewId}`, { status: 'rejected', accepted_op_ids: [] })
      await mutatePatchReviews()
      push('校对建议已标为先不用')
    } catch {
      push('校对建议拒绝失败', 'error')
    }
  }

  const reviseCanonFact = async () => {
    if (!factRevisionModal.fact?.id) return
    try {
      const patch = JSON.parse(factRevisionModal.patch || '{}')
      await api.post(`/api/projects/${project}/canon/facts/${factRevisionModal.fact.id}/revise`, { patch, reason: factRevisionModal.reason })
      mutateCanonFacts()
      push('事实修订已保存')
      setFactRevisionModal({ open: false, fact: null, patch: '{}', reason: '' })
    } catch {
      push('事实修订失败，请检查内容和原因', 'error')
    }
  }

  const rollbackVersion = async (versionId: string) => {
    try {
      await api.post(`/api/projects/${project}/drafts/${selectedChapter}/rollback`, { version_id: versionId })
      await mutateDraft()
      await mutateVersions()
      await mutateDraftDetails()
      push(`已回到版本：${versionId}`)
    } catch {
      push('版本回滚失败', 'error')
    }
  }

  const downloadProjectBackup = () => {
    if (!project) return
    window.location.href = `/api/projects/${project}/export.zip`
  }

  const downloadManuscriptMarkdown = () => {
    if (!project) return
    window.location.href = `/api/projects/${project}/export.md`
  }

  const importProjectBackup = async (e: any) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/projects/import.zip', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const body = await res.json()
      await mutateProjects()
      setProject(body.project_id)
      setView('projects')
      push(`备份已导入: ${body.project_id}`)
    } catch {
      push('备份导入失败', 'error')
    } finally {
      e.target.value = ''
    }
  }

  const openEvidence = async (ev: any) => {
    const src = ev?.source || {}
    if (ev?.kb_id === 'kb_manuscript' || src.chapter_id) {
      const chapter = src.chapter_id || selectedChapter
      setSelectedChapter(chapter)
      setHighlightRange({ start: src.start_line || 1, end: src.end_line || 20 })
      setView('chapter')
      return
    }
    if (src.asset_id) {
      const kind = src.kind === 'style_sample' ? 'style_sample' : 'doc'
      const r = await api.get(`/api/projects/${project}/assets/${src.asset_id}?kind=${kind}`)
      setAssetViewer({ open: true, title: `${src.asset_id} (${kind})`, content: r.content || '' })
      setAssetFind('')
    }
  }

  const addMessageVersion = async () => {
    await api.post(`/api/projects/${project}/sessions/session_001/messages/${sessionMessageId}/versions`, { content: sessionMessageText, meta: { from: 'ui' } })
    mutateSessionMeta()
  }

  const activateVersion = async (messageId: string, versionId: string) => {
    await api.post(`/api/projects/${project}/sessions/session_001/messages/${messageId}/activate`, { version_id: versionId })
    mutateSessionMeta()
  }

  const doUndo = async () => {
    await api.post(`/api/projects/${project}/sessions/session_001/undo`, {})
    mutateSessionMeta()
  }

  const doRedo = async () => {
    await api.post(`/api/projects/${project}/sessions/session_001/redo`, {})
    mutateSessionMeta()
  }

  const inheritedTechniqueDefaults = useMemo(() => {
    const outline = (paletteCacheRef.current.outlines || [])[0]
    const prefs = outline?.payload?.technique_prefs || []
    const chapterRows = (prefs || []).filter((r: any) => r.scope === 'arc' || (r.scope === 'chapter' && r.ref === selectedChapter) || (r.scope === 'beat' && String(r.ref || '').startsWith(`${selectedChapter}.b`)))
    return chapterRows
  }, [selectedChapter, currentManifest])

  const commandItems = useMemo<CommandItem[]>(() => {
    const cache = paletteCacheRef.current

    const staticNav: CommandItem[] = [
      { id: 'nav-story', title: '打开故事总控', subtitle: '设定主题、冲突、明线暗线和章节计划', group: 'Navigate', icon: BookOpen, run: () => { setActiveActivity('story'); setView('story') } },
      { id: 'nav-story-canvas', title: '打开脉络画布', subtitle: '查看结构点、卷、爆点和结局位置', group: 'Navigate', icon: Waypoints, keywords: ['canvas', 'narrative canvas', '脉络画布', '结构线', '爆点'], run: () => { setActiveActivity('story'); setStoryPlanningTab('Canvas'); setView('story') } },
      { id: 'nav-characters', title: '打开人物卡', subtitle: '编辑人物设定和本章使用情况', group: 'Navigate', icon: UserRound, run: () => { setActiveActivity('cards'); setView('characters') } },
      { id: 'nav-settings', title: '打开设置', subtitle: '配置 API、模型分工和作者/维护模式', group: 'Navigate', icon: Settings, run: () => { setActiveActivity('settings'); setView('settings') } },
      { id: 'nav-chapter', title: '打开正文编辑器', group: 'Navigate', icon: FilePenLine, run: () => { setActiveActivity('explorer'); setView('chapter') } },
      { id: 'nav-canon', title: '打开作品事实', group: 'Navigate', icon: Sparkles, run: () => { setActiveActivity('canon'); setView('canon') } },
      { id: 'nav-world', title: '打开世界观查询', group: 'Navigate', icon: Globe, run: () => { setActiveActivity('cards'); setView('world') } },
      { id: 'nav-techniques', title: '打开技法库', group: 'Navigate', icon: Sparkles, run: () => { setActiveActivity('techniques'); setView('techniques') } },
    ]

    const navData: CommandItem[] = [
      ...cache.storyCards.map((s: any) => ({
        id: `story-${s.id}`,
        title: `打开故事：${s.title || s.id}`,
        subtitle: s.id,
        group: 'Navigate' as const,
        icon: BookOpen,
        keywords: [s.title || '', s.id || '', 'story', 'plot', 'foreshadowing'],
        payload: { kind: 'story', id: s.id },
        run: () => {
          setView('story')
          setStoryForm(normalizeStoryCard(s))
        },
      })),
      ...cache.characters.map((c: any) => ({
        id: `char-${c.id}`,
        title: `打开人物：${c.title || c.id}`,
        subtitle: c.id,
        group: 'Navigate' as const,
        icon: iconForKind('character'),
        keywords: [c.title || '', c.id || '', 'character'],
        payload: { kind: 'character', id: c.id },
        run: () => {
          setView('characters')
          setCharacterForm(c)
        },
      })),
      ...cache.blueprints.map((bp: any) => ({
        id: `bp-${bp.id}`,
        title: `打开上下文方案：${bp.title || bp.id}`,
        subtitle: bp.id,
        group: 'Navigate' as const,
        icon: iconForKind('style'),
        keywords: [bp.id || '', bp.title || '', 'blueprint'],
        payload: { kind: 'blueprint', id: bp.id },
        run: () => {
          setSelectedBlueprintId(bp.id)
          setView('context')
        },
      })),
      ...cache.chapters.map((ch: any) => {
        const chapterId = typeof ch === 'string' ? ch : ch.chapter_id
        return ({
        id: `chapter-${chapterId}`,
        title: `打开章节：${ch.chapter_title || ch.title || chapterId}`,
        subtitle: `${chapterId}${ch.volume_id ? ` · ${ch.volume_id}` : ''}`,
        group: 'Navigate' as const,
        icon: iconForKind('chapter'),
        keywords: [chapterId, ch.chapter_title || '', ch.title || '', ch.volume_id || '', 'chapter'],
        payload: { kind: 'chapter', id: chapterId },
        run: () => {
          setActiveActivity('explorer')
          setSelectedChapter(chapterId)
          setView('chapter')
        },
      })}),
      ...cache.worldCards.map((w: any) => ({
        id: `world-${w.id}`,
        title: `打开世界观：${w.title || w.id}`,
        subtitle: w.id,
        group: 'Navigate' as const,
        icon: iconForKind('world'),
        keywords: [w.id || '', w.title || '', 'world', 'lore', 'rule'],
        payload: { kind: 'world', id: w.id },
        run: () => {
          setView('world')
          setWorldQuery(w.title || w.id || '')
        },
      })),
      ...(cache.toolSkills || []).map((t: any) => ({
        id: `tool-skill-${t.id}`,
        title: `打开写作工具：${t.title || t.id}`,
        subtitle: t.payload?.category || t.id,
        group: 'Navigate' as const,
        icon: Sparkles,
        keywords: [t.id || '', t.title || '', t.payload?.name || '', t.payload?.category || '', 'tool', 'skill', 'checker', 'research'],
        payload: { kind: 'tool_skill', id: t.id },
        run: () => {
          setView('techniques')
          setTechniqueLibraryTab('写作工具')
          setToolSkillForm(t)
        },
      })),
      ...cache.proposals.map((p: any) => ({
        id: `proposal-${p.proposal_id || p.id}`,
        title: `打开待确认事实：${p.name || p.proposal_id || p.id}`,
        subtitle: p.status || 'pending',
        group: 'Navigate' as const,
        icon: Sparkles,
        keywords: [p.proposal_id || '', p.name || '', 'proposal', p.status || ''],
        payload: { kind: 'proposal', id: p.proposal_id || p.id },
        run: () => {
          setView('canon')
          setSelectedProposalId(p.proposal_id || p.id || '')
        },
      })),
    ]

    const actionItems: CommandItem[] = [
      {
        id: 'act-theme-light',
        title: '切换明亮主题',
        group: 'Actions',
        icon: Sun,
        run: () => applySettings({ ...settings, theme: settings.theme === 'light' ? 'dark' : 'light' }),
      },
      {
        id: 'act-theme-system',
        title: '跟随系统主题',
        group: 'Actions',
        icon: Monitor,
        run: () => applySettings({ ...settings, theme: 'system' }),
      },
      {
        id: 'act-density',
        title: `切换界面密度（${settings.density === 'comfortable' ? '舒适' : '紧凑'}）`,
        group: 'Actions',
        icon: List,
        run: () => applySettings({ ...settings, density: settings.density === 'comfortable' ? 'compact' : 'comfortable' }),
      },
      {
        id: 'act-auto-apply',
        title: `切换自动应用校对建议（${autoApplyPatch ? '开' : '关'}）`,
        group: 'Actions',
        icon: Moon,
        run: () => {
          const next = !autoApplyPatch
          setAutoApplyPatch(next)
          applySettings({ ...settings, defaultAutoApplyPatch: next })
        },
      },
      {
        id: 'act-refresh-data',
        title: '刷新素材',
        subtitle: '重新读取章节、卡片和技法',
        group: 'Actions',
        icon: RefreshCw,
        run: refreshPaletteData,
      },
      {
        id: 'act-save-chapter',
        title: '保存当前章节',
        subtitle: selectedChapter,
        group: 'Actions',
        icon: FilePenLine,
        run: saveChapterDraft,
      },
      {
        id: 'act-analyze-chapter',
        title: '分析当前章节',
        subtitle: selectedChapter,
        group: 'Actions',
        icon: Sparkles,
        run: analyzeChapter,
      },
    ]

    const mruItems: CommandItem[] = mru.map((x) => ({ id: `mru-${x.id}`, title: `最近：${x.title}`, subtitle: x.subtitle, group: 'Navigate', icon: BookOpen, run: () => {} }))

    const all = [...staticNav, ...navData, ...actionItems, ...baseHelpCommands(() => {})]
    const resolvedMRU = mruItems.map((m) => {
      const target = all.find((x) => x.id === m.id.replace('mru-', ''))
      return target ? { ...target, title: `最近：${target.title}` } : null
    }).filter(Boolean) as CommandItem[]

    return [...resolvedMRU, ...all]
  }, [mru, project, settings, autoApplyPatch, selectedChapter, chapterEditorText, chapterTitleDraft, currentChapterMeta, currentVolume, volumeRows, chapterRows, analyzeBusy])

  const markTone = (level?: string) => {
    if (level === 'supported') return 'success'
    if (level === 'partial') return 'warn'
    return 'default'
  }
  const requirementTypeLabel = (type: string) => {
    if (type === 'open_line') return '明线'
    if (type === 'hidden_line') return '暗线'
    if (type === 'foreshadowing') return '伏笔'
    if (type === 'technique') return '技法'
    if (type === 'character') return '人物'
    return '要求'
  }
  const supportLabel = (level?: string) => {
    if (level === 'supported') return '已写到'
    if (level === 'partial') return '部分写到'
    if (level === 'contradicted') return '有矛盾'
    return '未证实'
  }
  const findRequirementMark = (targetType: string, candidates: string[]) => {
    const normalized = candidates.map((x) => String(x || '').trim()).filter(Boolean)
    return evidenceMarkRows.find((m: any) => {
      if (m.target_type !== targetType) return false
      const hay = [m.target_id, m.label, m.span?.quote, ...(m.detection?.matched_signals || [])].map((x) => String(x || ''))
      return normalized.some((needle) => hay.some((h) => h.includes(needle) || needle.includes(h)))
    })
  }
  const requirementLights = [
    ...currentStoryLinks.openLine.map((row: any) => ({ type: 'open_line', label: row.event || row.result || row.chapter, mark: findRequirementMark('open_line', [row.id, row.chapter, row.event, row.result]) })),
    ...currentStoryLinks.hiddenLine.map((row: any) => ({ type: 'hidden_line', label: row.visible_hint || row.truth || row.chapter, mark: findRequirementMark('hidden_line', [row.id, row.chapter, row.visible_hint, row.hidden_meaning, row.truth]) })),
    ...currentStoryLinks.foreshadowings.map((row: any) => ({ type: 'foreshadowing', label: row.content || row.id, mark: findRequirementMark('foreshadowing', [row.id, row.content, row.surface_signal, row.true_meaning]) })),
    ...((currentChapterMeta?.pinned_techniques || []) as any[]).map((row: any) => {
      const tech = (Array.isArray(techniqueCards) ? techniqueCards : []).find((x: any) => x.id === row.technique_id)
      return { type: 'technique', label: tech?.title || row.technique_id, mark: findRequirementMark('technique', [row.technique_id, tech?.title, tech?.payload?.name, ...(tech?.payload?.signals || [])]) }
    }),
  ]
  const writtenRequirementCount = requirementLights.filter((item: any) => item.mark?.span?.quote && item.mark?.detection?.support_level === 'supported').length
  const riskyRequirementCount = requirementLights.filter((item: any) => {
    const level = item.mark?.detection?.support_level
    return !item.mark?.span?.quote || level === 'unsupported' || level === 'contradicted'
  }).length
  const trustStatusText = !requirementLights.length
    ? '还没有给本章绑定要求'
    : riskyRequirementCount
      ? `${riskyRequirementCount} 个要求还没有可靠正文依据`
      : `${writtenRequirementCount} 个要求已被正文点亮`
  const trustStatusTone = !requirementLights.length ? 'default' : riskyRequirementCount ? 'warn' : 'success'
  const riskPreviewItems = requirementLights.filter((item: any) => {
    const level = item.mark?.detection?.support_level
    return !item.mark?.span?.quote || level === 'unsupported' || level === 'contradicted'
  }).slice(0, 3)

  const filteredChapterRows = chapterRows.filter((ch: any) => {
    const q = sideSearch.trim().toLowerCase()
    if (!q) return true
    return [ch.chapter_id, ch.chapter_title, ch.title, ch.volume_id].some((x) => String(x || '').toLowerCase().includes(q))
  })

  const left = (
    <div className='-m-3 flex min-h-[calc(100vh-8rem)]'>
      <div className='flex w-12 flex-col items-center gap-2 border-r border-border bg-surface-2 py-2'>
        {ACTIVITY_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => {
                setActiveActivity(item.id)
                if (item.id === 'story') setView('story')
                if (item.id === 'cards') setView('characters')
                if (item.id === 'techniques') setView('techniques')
                if (item.id === 'canon') setView('canon')
                if (item.id === 'settings') setView('settings')
                if (item.id === 'wiki') setView('wiki')
              }}
              className={`focus-ring flex h-9 w-9 items-center justify-center rounded-ui ${activeActivity === item.id ? 'bg-brand-500 text-white' : 'text-muted hover:bg-surface'}`}
            >
              <Icon size={17} />
            </button>
          )
        })}
      </div>
      <div className='flex-1 p-3'>
        <Input placeholder='搜索卷、章节、卡片...' value={sideSearch} onChange={(e) => setSideSearch(e.target.value)} />

        {activeActivity === 'explorer' ? (
          <div className='mt-3 space-y-3'>
            <div>
              <div className='mb-1 text-xs font-semibold text-muted'>作品</div>
              <Select value={project} onChange={(e) => setProject(e.target.value)}>
                {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.title || p.id}</option>)}
              </Select>
            </div>
            <div className='flex gap-2'>
              <Button className='text-xs' onClick={createVolume}>新建卷</Button>
              <Button className='text-xs' onClick={() => createChapterInVolume(currentVolume?.id)}>新建章</Button>
            </div>
            <div className='space-y-2'>
              {volumeRows.map((vol: any) => {
                const chapters = filteredChapterRows
                  .filter((ch: any) => (ch.volume_id || 'volume_default') === vol.id)
                  .sort((a: any, b: any) => Number(a.order_index || 0) - Number(b.order_index || 0))
                return (
                  <details key={vol.id} open className='rounded-ui border border-border bg-surface'>
                    <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>
                      {vol.title || vol.id} <span className='text-xs text-muted'>({chapters.length})</span>
                    </summary>
                    <div className='border-t border-border p-1'>
                      {chapters.map((ch: any) => (
                        <button
                          key={ch.chapter_id}
                          onClick={() => { setSelectedChapter(ch.chapter_id); setView('chapter') }}
                          className={`w-full rounded-ui px-2 py-1.5 text-left text-xs hover:bg-surface-2 ${selectedChapter === ch.chapter_id && view === 'chapter' ? 'bg-indigo-50 text-brand-700 dark:bg-indigo-900/20' : ''}`}
                        >
                          <div className='font-medium'>{ch.chapter_title || ch.title || ch.chapter_id}</div>
                          <div className='text-[11px] text-muted'>{ch.chapter_status === 'done' ? '已完成' : ch.chapter_status === 'revising' ? '修改中' : ch.chapter_status === 'planned' ? '已规划' : '草稿中'}</div>
                        </button>
                      ))}
                      <Button className='mt-1 w-full text-xs' onClick={() => createChapterInVolume(vol.id)}>在本卷加一章</Button>
                    </div>
                  </details>
                )
              })}
              {!volumeRows.length && <p className='text-sm text-muted'>还没有分卷。</p>}
            </div>
          </div>
        ) : null}

        {activeActivity === 'story' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('story')}>故事总控</Button>
            {['Overview', 'Canvas', 'Stages', 'Lines', 'Foreshadowings', 'Chapter Matrix'].map((tab) => (
              <button
                key={tab}
                onClick={() => { setStoryPlanningTab(tab); setView('story') }}
                className={`w-full rounded-ui border px-2 py-1.5 text-left text-xs ${storyPlanningTab === tab && view === 'story' ? 'border-brand-500 bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}
              >
                {{ Overview: '总览', Canvas: '脉络画布', Stages: '阶段', Lines: '脉络', Foreshadowings: '伏笔', 'Chapter Matrix': '章节矩阵' }[tab] || tab}
              </button>
            ))}
            <div className='pt-2 text-xs text-muted'>
              明线 {(activeStoryPayload.open_line || []).length} · 暗线 {(activeStoryPayload.hidden_line || []).length} · 伏笔 {(activeStoryPayload.foreshadowings || []).length}
            </div>
          </div>
        ) : null}

        {activeActivity === 'cards' ? (
          <div className='mt-3 space-y-3'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('characters')}>人物卡</Button>
            <div className='max-h-52 space-y-1 overflow-auto'>
              {(chars || []).map((c: any) => (
                <button key={c.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setCharacterForm(c); setView('characters') }}>
                  {c.title || c.id}
                </button>
              ))}
            </div>
            <Button className='w-full justify-start text-xs' onClick={() => setView('world')}>世界观</Button>
            <Button className='w-full justify-start text-xs' onClick={() => setView('style')}>文风</Button>
          </div>
        ) : null}

        {activeActivity === 'techniques' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => { setTechniqueLibraryTab('叙事技巧'); setView('techniques') }}>叙事技巧</Button>
            <Button className='w-full justify-start text-xs' onClick={() => { setTechniqueLibraryTab('写作工具'); setView('techniques') }}>写作工具</Button>
            {(techniqueCategories || []).slice(0, 12).map((cat: any) => (
              <button key={cat.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setCategoryForm(cat); setView('techniques') }}>
                {cat.title || cat.id}
              </button>
            ))}
          </div>
        ) : null}

        {activeActivity === 'canon' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('canon')}>作品事实</Button>
            <Button className='w-full justify-start text-xs' onClick={() => setView('context')}>AI 使用材料</Button>
            <Button className='w-full justify-start text-xs' onClick={() => { setActiveActivity('wiki'); setView('wiki') }}>导入资料</Button>
            {(proposals || []).slice(-8).reverse().map((p: any) => (
              <button key={p.proposal_id || p.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setSelectedProposalId(p.proposal_id || p.id || ''); setView('canon') }}>
                {p.name || p.proposal_id || p.id} <span className='text-muted'>({p.status || 'pending'})</span>
              </button>
            ))}
          </div>
        ) : null}

        {activeActivity === 'wiki' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('wiki')}>资料导入</Button>
            <Button className='w-full justify-start text-xs' onClick={() => { setActiveActivity('canon'); setView('canon') }}>待确认事实</Button>
            <div className='rounded-ui border border-border bg-surface p-2 text-[11px] text-muted'>
              导入资料只会生成待确认内容，不会直接改写正式设定。
            </div>
          </div>
        ) : null}

        {activeActivity === 'settings' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('settings')}>设置</Button>
            <Button className='w-full justify-start text-xs' onClick={() => refreshPaletteData()}>刷新素材</Button>
            <div className='rounded-ui border border-border bg-surface p-2 text-[11px] text-muted'>
              快捷入口支持新建卷、章节、人物和挂载技法。
            </div>
          </div>
        ) : null}

        {view === 'chapter' ? (
          <div className='module-card module-trust mt-4 space-y-2 rounded-ui border bg-surface p-2 text-xs'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-medium'>可信检查</span>
              <Badge tone={trustStatusTone as any}>
                {trustReport?.support_rate ?? '--'}
              </Badge>
            </div>
            <div className='rounded-ui border border-border bg-surface-2 p-2'>
              <div className='font-medium'>{trustStatusText}</div>
              <div className='mt-1 text-muted'>只有有正文原句和行号的判断，才会算作已写到。</div>
            </div>
            <div className='grid grid-cols-4 gap-1 text-center'>
              {[
                ['supported', 'OK'],
                ['partial', 'Part'],
                ['unsupported', 'Miss'],
                ['contradicted', 'Risk'],
              ].map(([level, label]) => (
                <button
                  key={level}
                  className='rounded-ui border border-border bg-surface-2 p-1 hover:bg-surface'
                  onClick={() => setView('chapter')}
                  title={label}
                >
                  <div className='font-medium'>{trustReport?.support_counts?.[level] || 0}</div>
                  <div className='text-[10px] text-muted'>{label}</div>
                </button>
              ))}
            </div>
            <Button className='w-full text-xs' onClick={() => { setChapterWorkMode('draft'); analyzeMarks() }}>检查正文</Button>

            {riskPreviewItems.length ? (
              <div className='rounded-ui border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900/60 dark:bg-amber-950/20'>
                <div className='mb-1 font-medium text-amber-800 dark:text-amber-200'>需要作者留意</div>
                <div className='space-y-1'>
                  {riskPreviewItems.map((item: any, idx: number) => (
                    <button
                      key={`risk-preview-${item.type}:${item.label}:${idx}`}
                      className='w-full truncate rounded-ui bg-white/70 px-2 py-1 text-left text-[11px] text-amber-800 hover:bg-white dark:bg-slate-950/30 dark:text-amber-200'
                      onClick={() => setView('chapter')}
                    >
                      {requirementTypeLabel(item.type)} · {item.label || '未命名要求'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className='rounded-ui border border-border bg-surface-2 p-2'>
              <div className='mb-1 flex items-center justify-between gap-2'>
                <span className='font-medium'>要求点亮</span>
                <Badge>{requirementLights.length}</Badge>
              </div>
              <div className='max-h-52 space-y-1 overflow-auto'>
                {requirementLights.map((item: any, idx: number) => {
                  const level = item.mark?.detection?.support_level || 'unsupported'
                  return (
                    <button
                      key={`${item.type}:${item.label}:${idx}`}
                      className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left hover:bg-surface-2'
                      onClick={() => {
                        if (!item.mark) return
                        setChapterWorkMode('draft')
                        setSelectedMarkId(item.mark.mark_id)
                        const start = Number(item.mark?.span?.start_line || 0)
                        const end = Number(item.mark?.span?.end_line || start)
                        if (start > 0) setHighlightRange({ start, end })
                      }}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <span className='truncate'>{requirementTypeLabel(item.type)} · {item.label || '未命名要求'}</span>
                        <Badge tone={markTone(level) as any}>{item.mark?.span?.quote ? supportLabel(level) : '未证实'}</Badge>
                      </div>
                      {item.mark?.span?.quote ? (
                        <div className='mt-1 truncate text-muted'>第 {item.mark.span.start_line} 行：{item.mark.span.quote}</div>
                      ) : (
                        <div className='mt-1 text-muted'>没有正文原句，不能算写到了</div>
                      )}
                    </button>
                  )
                })}
                {!requirementLights.length && <p className='text-muted'>还没有绑定可点亮的要求。</p>}
              </div>
            </div>

            <details className='rounded-ui border border-border bg-surface-2'>
              <summary className='cursor-pointer px-2 py-1.5 font-medium'>正文依据详情</summary>
              {selectedMark ? (
                <div className='space-y-2 border-t border-border p-2'>
                  <div className='flex items-start justify-between gap-2'>
                    <div>
                      <div className='font-medium'>{requirementTypeLabel(selectedMark.target_type)} · {selectedMark.label || selectedMark.target_id}</div>
                      <div className='text-muted'>{selectedMark.detection?.note || '可回看正文依据'}</div>
                    </div>
                    <Badge tone={selectedMark?.detection?.support_level === 'supported' ? 'success' : selectedMark?.detection?.support_level === 'partial' ? 'warn' : 'default'}>
                      {supportLabel(selectedMark?.detection?.support_level)}
                    </Badge>
                  </div>
                  <button
                    className='w-full rounded-ui border border-border bg-surface p-2 text-left hover:bg-surface-2'
                    onClick={() => {
                      const start = Number(selectedMark?.span?.start_line || 0)
                      const end = Number(selectedMark?.span?.end_line || start)
                      if (start > 0) setHighlightRange({ start, end })
                    }}
                  >
                    <div>正文第 {selectedMark.span?.start_line || 0}-{selectedMark.span?.end_line || 0} 行</div>
                    <div className='mt-1 whitespace-pre-wrap'>{selectedMark.span?.quote || '没有正文原句，不能算写到了'}</div>
                  </button>
                  <div className='grid grid-cols-2 gap-1'>
                    <Button className='text-xs' onClick={() => updateEvidenceFeedback(selectedMark, 'confirm_hit')}>确认</Button>
                    <Button className='text-xs' onClick={() => updateEvidenceFeedback(selectedMark, 'false_positive')}>误判</Button>
                    <Button
                      className='text-xs'
                      disabled={!canStartWriting()}
                      onClick={() => {
                        const start = Number(selectedMark?.span?.start_line || 0)
                        const end = Number(selectedMark?.span?.end_line || start)
                        if (start > 0) requestRunJob(1200, { start, end }, '让 AI 改段')
                        else push('这个标记没有可编辑行号', 'error')
                      }}
                    >
                      改段
                    </Button>
                    <Button className='text-xs' onClick={() => updateEvidenceFeedback(selectedMark, 'ignore_chapter')}>忽略</Button>
                  </div>
                </div>
              ) : (
                <p className='border-t border-border p-2 text-muted'>暂无正文依据。</p>
              )}
            </details>
          </div>
        ) : (
        <div className='module-card module-trust mt-4 rounded-ui border bg-surface p-2 text-xs'>
          <div className='flex items-center justify-between gap-2'>
            <span className='font-medium'>可信检查</span>
            <Badge tone={trustStatusTone as any}>
              {trustReport?.support_rate ?? '--'}
            </Badge>
          </div>
          <div className='mt-2 rounded-ui border border-border bg-surface-2 p-2'>
            <div className='font-medium'>{trustStatusText}</div>
            <div className='mt-1 text-muted'>打开正文后可查看对应正文行。</div>
          </div>
          <div className='mt-2 grid grid-cols-4 gap-1 text-center'>
            {[
              ['supported', 'OK'],
              ['partial', 'Part'],
              ['unsupported', 'Miss'],
              ['contradicted', 'Risk'],
            ].map(([level, label]) => (
              <button
                key={level}
                className='rounded-ui border border-border bg-surface-2 p-1 hover:bg-surface'
                onClick={() => setView('chapter')}
                title={label}
              >
                <div className='font-medium'>{trustReport?.support_counts?.[level] || 0}</div>
                <div className='text-[10px] text-muted'>{label}</div>
              </button>
            ))}
          </div>
          <Button className='mt-2 w-full text-xs' onClick={analyzeMarks}>检查正文</Button>
        </div>
        )}
      </div>
    </div>
  )

  const paragraphRanges = useMemo(() => {
    const lines = (draft?.content || '').split('\n')
    const ranges: Array<{ idx: number; start: number; end: number }> = []
    let start = 1
    let idx = 1
    for (let i = 1; i <= lines.length; i += 1) {
      const isBreak = i === lines.length || lines[i].trim() === ''
      if (isBreak) {
        const end = i
        if (end >= start) ranges.push({ idx, start, end })
        start = i + 2
        idx += 1
      }
    }
    return ranges
  }, [draft])

  const selectionRange = useMemo(() => {
    if (!selectionStart || !selectionEnd) return null
    const s = Number(selectionStart)
    const e = Number(selectionEnd)
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null
    if (selectionMode === 'line') {
      if (s < 1 || e < s) return null
      return { start: s, end: e }
    }
    const p1 = paragraphRanges.find((p) => p.idx === s)
    const p2 = paragraphRanges.find((p) => p.idx === e)
    if (!p1 || !p2 || p2.idx < p1.idx) return null
    return { start: p1.start, end: p2.end }
  }, [selectionMode, selectionStart, selectionEnd, paragraphRanges])

  const highlighted = useMemo(() => {
    const lines = (draft?.content || '').split('\n')
    if (!highlightRange) return draft?.content
    return lines
      .map((l: string, i: number) => {
        const n = i + 1
        return n >= highlightRange.start && n <= highlightRange.end ? `>> ${n}: ${l}` : `${n}: ${l}`
      })
      .join('\n')
  }, [draft, highlightRange])

  const header = (
    <div className='flex items-center gap-2 text-sm'>
      <span className='text-muted'>作品</span>
      <Badge>{project}</Badge>
      <span className='text-muted'>/</span>
      <span className='font-medium'>{ACTIVITY_ITEMS.find((x) => x.id === activeActivity)?.label || activeActivity}</span>
      <span className='text-muted'>/</span>
      <span className='font-medium'>{NAV_ITEMS.find((x) => x.id === view)?.label || view}</span>
      <div className='ml-2'>
        <CommandPalette
          items={commandItems.map((it) => ({ ...it, run: () => { it.run(); trackMRU(it) } }))}
          onOpen={() => lazyLoadPaletteData(false)}
          resolveCreateCommand={resolveCreateCommand}
        />
      </div>
    </div>
  )

  const center = useMemo(() => {
    const latestTechniqueBrief = events.filter((e) => e.event === 'TECHNIQUE_BRIEF').slice(-1)[0]?.data || (draft?.meta || {}).technique_brief || {}
    const autoRecommendedTechniques = (latestTechniqueBrief?.checklist || []).filter((x: any) => String(x?.source || '').startsWith('auto_from_category'))
    const toPinnedFromAuto = async (row: any) => {
      const tech = (techniqueCards || []).find((x: any) => x.id === row.technique_id)
      if (!tech) {
        push(`没有找到技法：${row.technique_id}`, 'error')
        return
      }
      const out = await pinTechniqueToChapter(tech, row.intensity || 'med', row.weight, row.notes)
      if (out.ok) push(`已把推荐技法挂到本章：${tech.title || tech.id}`)
      else push(out.message || '推荐技法挂载失败', 'error')
    }

    const updateStoryRoot = (key: string, value: any) => {
      setStoryForm((prev: any) => normalizeStoryCard({ ...prev, [key]: value }))
    }

    const updateStoryPayload = (key: string, value: any) => {
      setStoryForm((prev: any) => normalizeStoryCard({ ...prev, payload: { ...(prev?.payload || {}), [key]: value } }))
    }

    const updateStoryArrayItem = (section: string, index: number, key: string, value: any) => {
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        const rows = Array.isArray(payload[section]) ? [...payload[section]] : []
        rows[index] = { ...(rows[index] || {}), [key]: value }
        return normalizeStoryCard({ ...prev, payload: { ...payload, [section]: rows } })
      })
    }

    const addStoryArrayItem = (section: string, template: any) => {
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        const rows = Array.isArray(payload[section]) ? [...payload[section], cloneJson(template)] : [cloneJson(template)]
        return normalizeStoryCard({ ...prev, payload: { ...payload, [section]: rows } })
      })
    }

    const removeStoryArrayItem = (section: string, index: number) => {
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        const rows = (Array.isArray(payload[section]) ? payload[section] : []).filter((_: any, i: number) => i !== index)
        return normalizeStoryCard({ ...prev, payload: { ...payload, [section]: rows } })
      })
    }

    const saveStoryCard = async () => {
      const current = normalizeStoryCard(storyForm)
      const id = current.id && current.id !== 'story_new' ? current.id : `story_${Date.now()}`
      const body = { ...current, id, type: 'story' }
      await api.put(`/api/projects/${project}/cards/${id}`, body)
      setStoryForm(normalizeStoryCard(body))
      mutateStoryCards()
      await lazyLoadPaletteData(true)
      push('故事卡已保存')
    }

    const localBuildDraftContent = (kind: string, revision: number) => {
      const payload = normalizeStoryCard(storyForm).payload || {}
      const title = storyForm?.title || '未命名小说'
      const chapterId = selectedChapter || 'chapter_001'
      const seed = `${revision}`
      const scenes = meaningfulRows(payload.important_scenes, ['scene', 'purpose', 'chapter'])
      const draftByKind: Record<string, any> = {
        story_overview: {
          logline: payload.logline || `${title}的主角在关键事件中被迫面对核心秘密。`,
          theme: payload.theme || '选择的代价与自我边界',
          genre: payload.genre || '长篇类型小说',
          worldview: payload.worldview || '请补充世界背景、关键规则和限制。',
          main_conflict: payload.main_conflict || '主角目标与外部压力、隐藏真相之间形成持续冲突。',
          keywords: payload.keywords?.length ? payload.keywords : ['主角秘密', '阶段冲突', `刷新${seed}`],
          target_reader: payload.target_reader || '喜欢人物动机清晰、伏笔可回查、章节钩子明确的长篇读者。',
          platform_style: payload.platform_style || '章节节奏紧，每章有明确推进和未解问题。',
          banned_items: payload.banned_items?.length ? payload.banned_items : ['不要提前揭示最终真相', '不要让角色违背硬设定'],
          important_scenes: scenes.length ? scenes : [{ scene: '开篇关键场景', purpose: '触发主冲突', chapter: chapterId }],
        },
        character_seed: {
          id: `character_${Date.now()}`,
          type: 'character',
          title: '待确认人物',
          tags: ['pending_ai_draft'],
          links: [],
          payload: {
            name: '待确认人物',
            identity: '请改写身份',
            appearance: '',
            core_motivation: payload.main_conflict ? `被卷入「${payload.main_conflict}」并寻找自己的答案。` : '请填写核心动机',
            personality_traits: ['克制', '警觉'],
            family_background: '',
            voice: '说话谨慎，避免一次性暴露真实想法。',
            boundaries: ['不能无证据相信陌生人'],
            relationships: [],
            arc: [{ beat: chapterId, goal: '在本章做出第一个主动选择' }],
            role: 'supporting',
            importance: 3,
          },
        },
        lines: {
          open_line: [{ chapter: chapterId, event: '表面事件待确认', goal: '角色本章可见目标', conflict: '阻碍/冲突', result: '本章结果' }],
          hidden_line: [{ chapter: chapterId, truth: '暗处真实信息待确认', visible_hint: '读者能看见的提示', hidden_meaning: '提示背后的真实意义', reveal_timing: '后续揭示' }],
        },
        foreshadowing: {
          foreshadowings: [{
            id: `foreshadow_${Date.now()}`,
            content: '待确认伏笔',
            first_chapter: chapterId,
            surface_signal: '正文中可看见的显示方式',
            reader_feeling: '读者当下感受',
            true_meaning: '真实意义',
            payoff_chapter: '',
            payoff: '',
            emphasis: '反复出现但暂不解释',
            status: '未出现',
          }],
        },
      }
      return draftByKind[kind]
    }

    const openBuildDraft = (rec: any) => {
      setBuildDraft({
        draft_id: rec.draft_id,
        kind: rec.kind,
        title: rec.title,
        body: rec.body,
        revision: rec.revision || 1,
        source: rec.source,
        status: rec.status,
        created_at: rec.created_at,
        accepted_scope: rec.accepted_scope,
        accepted_target: rec.accepted_target,
        rejection_reason: rec.rejection_reason,
        source_node: rec.source_node,
        generation_reason: rec.generation_reason,
      })
      setView('story')
      setStoryPlanningTab('Overview')
    }

    const rejectBuildDraft = async (rec: any) => {
      if (!rec?.draft_id) return
      await api.put(`/api/projects/${project}/build-drafts/${rec.draft_id}`, {
        status: 'rejected',
        rejection_reason: '作者在待确认队列中拒绝',
      })
      if (buildDraft?.draft_id === rec.draft_id) setBuildDraft({ ...buildDraft, status: 'rejected' })
      mutateBuildDraftRows()
      push('草案已标为先不用')
    }

    const restoreBuildDraft = async (rec: any) => {
      if (!rec?.draft_id) return
      await api.put(`/api/projects/${project}/build-drafts/${rec.draft_id}`, {
        status: 'pending',
        accepted_target: '',
        accepted_scope: [],
        rejection_reason: '',
      })
      if (buildDraft?.draft_id === rec.draft_id) {
        setBuildDraft({ ...buildDraft, status: 'pending', accepted_target: '', accepted_scope: [], rejection_reason: '' })
      }
      mutateBuildDraftRows()
      push('草案已恢复为待确认')
    }

    const generateBuildDraft = async (kind: string, sourceNode: any = null) => {
      const nextRevision = (buildDraft?.kind === kind ? buildDraft.revision + 1 : 1)
      setBuildDraftBusy(true)
      try {
        const rec = await api.post(`/api/projects/${project}/build-drafts`, {
          kind,
          revision: nextRevision,
          selected_chapter: selectedChapter,
          story_card: normalizeStoryCard(storyForm),
          source_node: sourceNode ? {
            id: sourceNode.id,
            label: sourceNode.label,
            type: sourceNode.type,
            group: sourceNode.group,
            description: sourceNode.description,
            author_decision: sourceNode.author_decision,
          } : undefined,
          generation_reason: sourceNode ? `画布节点「${sourceNode.label}」请求待确认草案` : '',
        })
        if (rec?.detail) throw new Error(String(rec.detail?.message || rec.detail))
        setBuildDraft({
          draft_id: rec.draft_id,
          kind: rec.kind,
          title: rec.title,
          body: rec.body,
          revision: rec.revision,
          source: rec.source,
          status: rec.status,
          created_at: rec.created_at,
          accepted_scope: rec.accepted_scope,
          accepted_target: rec.accepted_target,
          rejection_reason: rec.rejection_reason,
          source_node: rec.source_node,
          generation_reason: rec.generation_reason,
        })
        push(`草案已生成：${rec.title}`)
        mutateBuildDraftRows()
        return
      } catch {
        const fallback = localBuildDraftContent(kind, nextRevision)
        setBuildDraft({
          kind,
          title: kind === 'story_overview' ? '故事总控草案' : kind === 'character_seed' ? '人物初设草案' : kind === 'lines' ? '明线/暗线草案' : '伏笔草案',
          body: JSON.stringify(fallback, null, 2),
          revision: nextRevision,
          source: 'local_fallback',
          status: 'pending',
          accepted_scope: [],
          accepted_target: '',
          rejection_reason: '',
          source_node: sourceNode ? {
            id: sourceNode.id,
            label: sourceNode.label,
            type: sourceNode.type,
            group: sourceNode.group,
            description: sourceNode.description,
            author_decision: sourceNode.author_decision,
          } : undefined,
          generation_reason: sourceNode ? `画布节点「${sourceNode.label}」请求待确认草案` : '',
        })
        push('草案接口暂不可用，已先生成本地待确认草案', 'error')
      } finally {
        setBuildDraftBusy(false)
      }
    }

    const parsedBuildDraft = (() => {
      if (!buildDraft) return null
      try {
        return JSON.parse(buildDraft.body || '{}')
      } catch {
        return null
      }
    })()

    const writeBuildDraftBody = (next: any) => {
      if (!buildDraft) return
      setBuildDraft({ ...buildDraft, body: JSON.stringify(next, null, 2) })
    }

    const updateBuildDraftRoot = (key: string, value: any) => {
      if (!parsedBuildDraft) return
      writeBuildDraftBody({ ...parsedBuildDraft, [key]: value })
    }

    const updateBuildDraftPayload = (key: string, value: any) => {
      if (!parsedBuildDraft) return
      writeBuildDraftBody({ ...parsedBuildDraft, payload: { ...(parsedBuildDraft.payload || {}), [key]: value } })
    }

    const updateBuildDraftArrayItem = (section: string, index: number, key: string, value: any) => {
      if (!parsedBuildDraft) return
      const rows = Array.isArray(parsedBuildDraft[section]) ? [...parsedBuildDraft[section]] : []
      rows[index] = { ...(rows[index] || {}), [key]: value }
      writeBuildDraftBody({ ...parsedBuildDraft, [section]: rows })
    }

    const markBuildDraftPartiallyAccepted = async (scope: string[]) => {
      if (!buildDraft?.draft_id) return
      const acceptedScope = uniq([...(buildDraft.accepted_scope || []), ...scope])
      await api.put(`/api/projects/${project}/build-drafts/${buildDraft.draft_id}`, {
        body: buildDraft.body,
        status: 'partially_accepted',
        accepted_target: storyForm?.id || 'story_new',
        accepted_scope: acceptedScope,
      })
      setBuildDraft({ ...buildDraft, status: 'partially_accepted', accepted_scope: acceptedScope })
      mutateBuildDraftRows()
    }

    const appendDraftRowsToStory = async (section: string, rows: any[]) => {
      if (!buildDraft || !rows.length) return
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        const annotated = rows.map((row) => ({
          ...row,
          source_draft_id: buildDraft.draft_id || '',
          source_step: buildDraft.kind,
          source_node_id: buildDraft.source_node?.id || '',
          source_node_label: buildDraft.source_node?.label || '',
          source_node_type: buildDraft.source_node?.type || '',
          confirmation_status: 'accepted',
          confirmed_by: 'author',
          author_modified: true,
        }))
        payload[section] = [...(payload[section] || []), ...annotated]
        return normalizeStoryCard({ ...prev, payload })
      })
      await markBuildDraftPartiallyAccepted([section])
      push(`已局部写入 ${section}，请保存故事卡`)
    }

    const acceptDraftStoryFields = async (keys: string[]) => {
      if (!parsedBuildDraft || !buildDraft) return
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        for (const key of keys) {
          if (parsedBuildDraft[key] !== undefined) payload[key] = parsedBuildDraft[key]
        }
        payload.source_draft_id = buildDraft.draft_id || payload.source_draft_id
        payload.source_step = buildDraft.kind
        payload.confirmation_status = 'partially_accepted'
        payload.confirmed_by = 'author'
        payload.author_modified = true
        return normalizeStoryCard({ ...prev, payload })
      })
      await markBuildDraftPartiallyAccepted(keys)
      push('已局部写入故事卡表单，请保存故事卡')
    }

    const acceptBuildDraft = async () => {
      if (!buildDraft) return
      let parsed: any
      try {
        parsed = JSON.parse(buildDraft.body || '{}')
      } catch {
        push('草案原始内容无法解析，请先修正', 'error')
        return
      }
      if (buildDraft.kind === 'character_seed') {
        const id = parsed.id || `character_${Date.now()}`
        const body = {
          ...parsed,
          id,
          type: 'character',
          tags: uniq([...(parsed.tags || []), 'author_confirmed']),
          links: uniq([...(parsed.links || []), buildDraft.draft_id ? `build_draft:${buildDraft.draft_id}` : ''].filter(Boolean)),
          payload: {
            ...(parsed.payload || {}),
            source_draft_id: buildDraft.draft_id || '',
            source_step: buildDraft.kind,
            source_node_id: buildDraft.source_node?.id || '',
            source_node_label: buildDraft.source_node?.label || '',
            source_node_type: buildDraft.source_node?.type || '',
            confirmation_status: 'accepted',
            confirmed_by: 'author',
            author_modified: true,
          },
        }
        await api.put(`/api/projects/${project}/cards/${id}`, body)
        if (buildDraft.draft_id) await api.put(`/api/projects/${project}/build-drafts/${buildDraft.draft_id}`, { body: buildDraft.body, status: 'accepted', accepted_target: id, accepted_scope: ['all'] })
        setBuildDraft({ ...buildDraft, status: 'accepted', accepted_scope: ['all'] })
        setCharacterForm(body)
        mutateCards()
        setView('characters')
        mutateBuildDraftRows()
        push('人物草案已确认写入')
        return
      }
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        if (buildDraft.kind === 'story_overview') {
          Object.assign(payload, parsed)
        } else if (buildDraft.kind === 'lines') {
          payload.open_line = [...(payload.open_line || []), ...(parsed.open_line || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, source_node_id: buildDraft.source_node?.id || '', source_node_label: buildDraft.source_node?.label || '', source_node_type: buildDraft.source_node?.type || '', confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
          payload.hidden_line = [...(payload.hidden_line || []), ...(parsed.hidden_line || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, source_node_id: buildDraft.source_node?.id || '', source_node_label: buildDraft.source_node?.label || '', source_node_type: buildDraft.source_node?.type || '', confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
        } else if (buildDraft.kind === 'foreshadowing') {
          payload.foreshadowings = [...(payload.foreshadowings || []), ...(parsed.foreshadowings || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, source_node_id: buildDraft.source_node?.id || '', source_node_label: buildDraft.source_node?.label || '', source_node_type: buildDraft.source_node?.type || '', confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
        }
        payload.source_draft_id = buildDraft.draft_id || payload.source_draft_id
        payload.source_step = buildDraft.kind
        payload.source_node_id = buildDraft.source_node?.id || payload.source_node_id
        payload.source_node_label = buildDraft.source_node?.label || payload.source_node_label
        payload.source_node_type = buildDraft.source_node?.type || payload.source_node_type
        payload.confirmation_status = 'accepted'
        payload.confirmed_by = 'author'
        payload.author_modified = true
        return normalizeStoryCard({ ...prev, payload })
      })
      if (buildDraft.draft_id) await api.put(`/api/projects/${project}/build-drafts/${buildDraft.draft_id}`, { body: buildDraft.body, status: 'accepted', accepted_target: storyForm?.id || 'story_new', accepted_scope: ['all'] })
      setBuildDraft({ ...buildDraft, status: 'accepted', accepted_scope: ['all'] })
      mutateBuildDraftRows()
      push('草案已确认写入故事卡表单，请保存故事卡')
    }

    const storyPayload = normalizeStoryCard(storyForm).payload
    const canvasSafeId = (prefix: string, value: any, index: number) => {
      const raw = String(value || index + 1).trim() || `${index + 1}`
      return `${prefix}:${raw.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48)}`
    }
    const storedCanvas = storyPayload.narrative_canvas && typeof storyPayload.narrative_canvas === 'object' ? storyPayload.narrative_canvas : {}
    const storedCanvasNodes = Array.isArray(storedCanvas.nodes) ? storedCanvas.nodes : []
    const storedCanvasEdges = Array.isArray(storedCanvas.edges) ? storedCanvas.edges : []
    const storedCanvasNodeMap = new Map(storedCanvasNodes.map((node: any) => [node.id, node]))
    const canvasDraftPending = (kind: string) => pendingBuildDrafts.some((draft: any) => draft.kind === kind)
    const canvasStatusFor = (hasMaterial: boolean, draftKind?: string) => {
      if (draftKind && canvasDraftPending(draftKind)) return 'ai_suggesting'
      if (hasMaterial) return 'pending_author'
      return 'not_started'
    }
    const applyStoredCanvasNode = (node: any) => {
      const stored = storedCanvasNodeMap.get(node.id) || {}
      return {
        ...node,
        ...stored,
        status: stored.status || node.status || 'not_started',
        type: stored.type || node.type,
        group: stored.group || node.group,
        label: stored.label || node.label,
      }
    }
    const derivedCanvasNodes = [
      applyStoredCanvasNode({
        id: 'foundation:book',
        type: 'foundation',
        group: 'foundation',
        label: '建书',
        description: activeStoryPayload.logline || '确认这本小说写什么、给谁看、不能写什么。',
        ai_suggestion: '先锁定题材、关键词、目标读者和禁写事项，再让 AI 辅助扩展故事卡。',
        status: canvasStatusFor(hasText(storyForm?.title) || hasText(activeStoryPayload.genre), 'story_overview'),
      }),
      applyStoredCanvasNode({
        id: 'character:cast',
        type: 'character',
        group: 'foundation',
        label: '人物',
        description: Array.isArray(chars) && chars.length ? `${chars.length} 张人物卡可供章节调用。` : '先准备主角、反派、关键配角的人物初设。',
        ai_suggestion: '人物节点适合生成小传、动机、边界和说话方式，但正式人物卡需要作者确认。',
        status: canvasStatusFor(Array.isArray(chars) && chars.length > 0, 'character_seed'),
      }),
      applyStoredCanvasNode({
        id: 'world:rules',
        type: 'world',
        group: 'foundation',
        label: '世界观',
        description: activeStoryPayload.worldview || '写下世界规则、限制、重要地点和不能前后矛盾的设定。',
        ai_suggestion: '世界观节点可以约束场景一致性和时间线检查，建议先写硬规则。',
        status: canvasStatusFor(hasText(activeStoryPayload.worldview), 'story_overview'),
      }),
      applyStoredCanvasNode({
        id: 'thread:main',
        type: 'thread',
        group: 'thread',
        label: '脉络',
        description: activeStoryPayload.main_conflict || '明线、暗线、伏笔、爆点、转折和回收都收在这里。',
        ai_suggestion: '脉络不是章节目录。它负责决定事件因果、信息隐藏、爆点位置和卷末转折。',
        status: canvasStatusFor(openLineRows.length > 0 || hiddenLineRows.length > 0 || foreshadowingRows.length > 0, 'lines'),
      }),
      applyStoredCanvasNode({
        id: 'line:open',
        type: 'line',
        group: 'thread',
        label: '明线',
        description: openLineRows.length ? `${openLineRows.length} 个表面事件推进节点。` : '表面可见的事件推进。',
        ai_suggestion: '明线应该让读者知道角色正在争取什么、遇到什么阻碍、付出什么代价。',
        status: canvasStatusFor(openLineRows.length > 0, 'lines'),
      }),
      applyStoredCanvasNode({
        id: 'line:hidden',
        type: 'line',
        group: 'thread',
        label: '暗线',
        description: hiddenLineRows.length ? `${hiddenLineRows.length} 个隐藏真相或提示节点。` : '读者暂时看不全的真相推进。',
        ai_suggestion: '暗线负责控制“读者以为发生了什么”和“真实发生了什么”的差距。',
        status: canvasStatusFor(hiddenLineRows.length > 0, 'lines'),
      }),
      applyStoredCanvasNode({
        id: 'thread:foreshadowing',
        type: 'clue',
        group: 'thread',
        label: '伏笔',
        description: foreshadowingRows.length ? `${foreshadowingRows.length} 条伏笔埋设/回收。` : '伏笔归入脉络，不作为主线大节点。',
        ai_suggestion: '伏笔必须有显示方式、真实意义和回收位置。没有正文证据时不能点亮为已命中。',
        status: canvasStatusFor(foreshadowingRows.length > 0, 'foreshadowing'),
      }),
      ...(volumeRows.length ? volumeRows : [{ id: 'volume_default', title: '第一卷', summary: '' }]).map((volume: any, index: number) => applyStoredCanvasNode({
        id: `volume:${volume.id || `volume_${index + 1}`}`,
        type: 'volume',
        group: 'volume',
        label: volume.title || `第${index + 1}卷`,
        description: volume.summary || '本卷目标、卷内升级、卷末转折待确认。',
        ai_suggestion: '卷节点只决定阶段容器和卷末变化，普通章节不进入主画布。',
        status: canvasStatusFor(hasText(volume.summary) || (Array.isArray(volume.chapter_ids) && volume.chapter_ids.length > 0)),
        ref_id: volume.id,
      })),
      ...(importantSceneRows.length ? importantSceneRows : [{ scene: '爆点1', purpose: activeStoryPayload.main_conflict || '围绕主冲突设计第一个强事件', chapter: '' }]).map((row: any, index: number) => applyStoredCanvasNode({
        id: canvasSafeId('beat', row.scene || row.chapter, index),
        type: /结局|终局|收束/.test(`${row.scene || ''}${row.purpose || ''}`) ? 'ending' : 'beat',
        group: 'beat',
        label: /爆点|爆发|高潮|转折|危机/.test(row.scene || '') ? row.scene : `爆点${index + 1}`,
        description: row.purpose || row.scene || '强事件、误判、揭示或转折。',
        ai_suggestion: row.purpose || '爆点应该带来目标变化、关系变化或信息变化，作者决定是否采用。',
        status: canvasStatusFor(hasText(row.scene) || hasText(row.purpose)),
        ref_id: row.chapter || '',
      })),
      applyStoredCanvasNode({
        id: 'ending:final',
        type: 'ending',
        group: 'ending',
        label: '结局',
        description: /结局|终局|收束/.test(JSON.stringify(activeStoryPayload)) ? '已有结局/收束相关材料。' : '保留终局位置，先不让 AI 自动决定整本书结局。',
        ai_suggestion: '结局节点建议只记录方向和必须回收的承诺，最终收束由作者决定。',
        status: canvasStatusFor(/结局|终局|收束/.test(JSON.stringify(activeStoryPayload))),
      }),
    ]
    const derivedCanvasEdges = [
      { id: 'edge:book-characters', from: 'foundation:book', to: 'character:cast', type: '准备' },
      { id: 'edge:characters-world', from: 'character:cast', to: 'world:rules', type: '准备' },
      { id: 'edge:world-thread', from: 'world:rules', to: 'thread:main', type: '约束' },
      { id: 'edge:thread-open', from: 'thread:main', to: 'line:open', type: '包含' },
      { id: 'edge:thread-hidden', from: 'thread:main', to: 'line:hidden', type: '包含' },
      { id: 'edge:thread-clues', from: 'thread:main', to: 'thread:foreshadowing', type: '包含' },
      ...(volumeRows.length ? volumeRows : [{ id: 'volume_default' }]).map((volume: any) => ({ id: `edge:thread-${volume.id}`, from: 'thread:main', to: `volume:${volume.id}`, type: '阶段' })),
      ...derivedCanvasNodes.filter((node: any) => node.group === 'beat').map((node: any, index: number) => ({
        id: `edge:beat-${index}`,
        from: index === 0 ? 'thread:main' : derivedCanvasNodes.filter((n: any) => n.group === 'beat')[index - 1]?.id || 'thread:main',
        to: node.id,
        type: node.type === 'ending' ? '收束' : '推进',
      })),
      { id: 'edge:beats-ending', from: derivedCanvasNodes.filter((node: any) => node.group === 'beat').slice(-1)[0]?.id || 'thread:main', to: 'ending:final', type: '收束' },
    ]
    const derivedEdgeIds = new Set(derivedCanvasEdges.map((edge: any) => edge.id || `${edge.from}->${edge.to}:${edge.type}`))
    const narrativeCanvas = {
      nodes: [
        ...derivedCanvasNodes,
        ...storedCanvasNodes.filter((node: any) => !derivedCanvasNodes.some((derived: any) => derived.id === node.id)),
      ],
      edges: [
        ...derivedCanvasEdges,
        ...storedCanvasEdges.filter((edge: any) => !derivedEdgeIds.has(edge.id || `${edge.from}->${edge.to}:${edge.type}`)),
      ],
    }
    const updateNarrativeCanvas = (nodes: any[], edges = narrativeCanvas.edges) => {
      updateStoryPayload('narrative_canvas', {
        version: 1,
        updated_at: new Date().toISOString(),
        nodes,
        edges,
      })
    }
    const updateCanvasNode = (nodeId: string, patch: Record<string, any>) => {
      const nextNodes = narrativeCanvas.nodes.map((node: any) => node.id === nodeId ? { ...node, ...patch, updated_at: new Date().toISOString() } : node)
      updateNarrativeCanvas(nextNodes)
    }
    const setCanvasDecision = (node: any, status: string, decision: string) => {
      updateCanvasNode(node.id, {
        status,
        author_decision: decision,
        decided_by: 'author',
        decided_at: new Date().toISOString(),
      })
      push(`${node.label}：${CANVAS_STATUS_LABELS[status] || status}，请保存故事卡`)
    }
    const generateCanvasSuggestion = (node: any) => {
      const suggestionByType: Record<string, string> = {
        foundation: '建议先确认：题材边界、目标读者、禁写事项、平台节奏。AI 只能生成候选，作者确认后再写入正式故事卡。',
        character: '建议为核心人物补齐：欲望、恐惧、底线、说话方式、会被什么事件改变。',
        world: '建议把世界观拆成硬规则、场景限制、时间线限制和不能改写的事实。',
        thread: '建议先列明线目标，再列暗线真相，最后把伏笔放到爆点前后，避免伏笔独立漂浮。',
        line: '建议每个线索节点都写清：本章读者看见什么、角色误会什么、真实推进什么。',
        clue: '建议每条伏笔都必须有首次显示方式、读者当下感受、真实意义和回收位置。',
        volume: '建议本卷只确认三个东西：卷目标、卷内最大升级、卷末转折。',
        beat: '建议这个爆点造成一次不可逆变化：目标失败、关系翻面、真相露出一角或代价升级。',
        ending: '建议结局先锁定必须回收的承诺，不提前让 AI 决定全部收束细节。',
      }
      updateCanvasNode(node.id, {
        status: 'pending_author',
        ai_suggestion: suggestionByType[node.type] || node.ai_suggestion || '请让 AI 给出备选，作者再确认。',
        suggestion_source: 'local_canvas_assistant',
      })
      push(`${node.label} 已起草一条待确认建议`)
    }
    const canvasDraftKindFor = (node: any) => {
      if (node.type === 'character') return 'character_seed'
      if (node.type === 'clue') return 'foreshadowing'
      if (node.type === 'thread' || node.type === 'line' || node.group === 'thread') return 'lines'
      return 'story_overview'
    }
    const generateCanvasDraft = async (node: any) => {
      updateCanvasNode(node.id, {
        status: 'ai_suggesting',
        draft_kind: canvasDraftKindFor(node),
        draft_requested_at: new Date().toISOString(),
      })
      await generateBuildDraft(canvasDraftKindFor(node), node)
      setBuildWizardStep(node.type === 'character' ? 'characters' : node.type === 'clue' || node.group === 'thread' ? 'lines' : 'outline')
      push(`${node.label} 已进入待确认草案流程`)
    }
    const applyCanvasNodeToStory = (node: any) => {
      const text = node.author_decision || node.description || node.ai_suggestion || node.label
      if (node.id === 'line:open') {
        addStoryArrayItem('open_line', { ...STORY_PAYLOAD_TEMPLATE.open_line[0], chapter: selectedChapter, event: text })
        push('已写入一条明线草案，请保存故事卡')
        return
      }
      if (node.id === 'line:hidden') {
        addStoryArrayItem('hidden_line', { ...STORY_PAYLOAD_TEMPLATE.hidden_line[0], chapter: selectedChapter, truth: text, visible_hint: node.label })
        push('已写入一条暗线草案，请保存故事卡')
        return
      }
      if (node.type === 'clue') {
        addStoryArrayItem('foreshadowings', { ...STORY_PAYLOAD_TEMPLATE.foreshadowings[0], content: node.label, first_chapter: selectedChapter, surface_signal: text, status: '未出现' })
        push('已写入一条伏笔草案，请保存故事卡')
        return
      }
      if (node.type === 'beat' || node.type === 'ending') {
        addStoryArrayItem('important_scenes', { scene: node.label, purpose: text, chapter: selectedChapter })
        push('已写入重要场景/爆点，请保存故事卡')
        return
      }
      if (node.type === 'world') {
        updateStoryPayload('worldview', text)
        push('已写入世界观字段，请保存故事卡')
        return
      }
      if (node.type === 'thread') {
        updateStoryPayload('main_conflict', text)
        push('已写入主冲突/脉络字段，请保存故事卡')
        return
      }
      if (node.type === 'foundation') {
        updateStoryPayload('logline', text)
        push('已写入一句话故事字段，请保存故事卡')
        return
      }
      if (node.type === 'volume') {
        setActiveActivity('explorer')
        setView('projects')
        push('卷节点暂通过目录管理；可以在本卷继续创建章节')
        return
      }
      push('这个节点暂时没有可自动写回的表格')
    }
    const renderNarrativeCanvas = () => (
      <StoryCanvasPanel
        edges={narrativeCanvas.edges}
        nodes={narrativeCanvas.nodes}
        selectedNodeId={selectedCanvasNodeId}
        statusLabels={CANVAS_STATUS_LABELS}
        statusToneClasses={CANVAS_STATUS_TONE}
        typeLabels={CANVAS_TYPE_LABELS}
        onApplyToStory={(node: StoryCanvasNode) => applyCanvasNodeToStory(node)}
        onConfirmNode={(node: StoryCanvasNode) => setCanvasDecision(node, 'confirmed', node.author_decision || '作者确认采用')}
        onGenerateDraft={(node: StoryCanvasNode) => generateCanvasDraft(node)}
        onGenerateLocalSuggestion={(node: StoryCanvasNode) => generateCanvasSuggestion(node)}
        onMarkRisk={(node: StoryCanvasNode) => setCanvasDecision(node, 'risk', node.author_decision || '需要重想')}
        onSave={saveStoryCard}
        onSelectNode={setSelectedCanvasNodeId}
        onSkipNode={(node: StoryCanvasNode) => setCanvasDecision(node, 'skipped', node.author_decision || '本轮跳过')}
        onUpdateNode={updateCanvasNode}
      />
    )
    const renderBuildDraftJsonDebug = () => (
      <details className='rounded-ui border border-border bg-surface-2 p-2'>
        <summary className='cursor-pointer text-xs text-muted'>原始草案内容</summary>
        <Textarea className='mt-2 h-40 mono' value={buildDraft?.body || ''} onChange={(e) => buildDraft && setBuildDraft({ ...buildDraft, body: e.target.value })} />
      </details>
    )

    const renderBuildDraftEditor = () => {
      if (!buildDraft) {
        return (
          <div className='flex h-56 items-center justify-center rounded-ui border border-dashed border-border bg-surface-2 text-sm text-muted'>
            选择左侧环节起草待确认草案
          </div>
        )
      }
      if (!parsedBuildDraft) {
        return (
          <div className='space-y-2'>
            <div className='rounded-ui border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-200'>草案原始内容暂时无法解析，修正后会恢复结构化编辑。</div>
            {renderBuildDraftJsonDebug()}
          </div>
        )
      }
      if (buildDraft.kind === 'story_overview') {
        const scenes = Array.isArray(parsedBuildDraft.important_scenes) ? parsedBuildDraft.important_scenes : []
        return (
          <div className='space-y-3'>
            <div className='grid grid-cols-12 gap-2'>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>一句话故事</label>
                <Textarea className='h-16' value={parsedBuildDraft.logline || ''} onChange={(e) => updateBuildDraftRoot('logline', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>主题</label>
                <Textarea className='h-16' value={parsedBuildDraft.theme || ''} onChange={(e) => updateBuildDraftRoot('theme', e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>题材</label>
                <Input value={parsedBuildDraft.genre || ''} onChange={(e) => updateBuildDraftRoot('genre', e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>关键词</label>
                <Input value={(parsedBuildDraft.keywords || []).join(',')} onChange={(e) => updateBuildDraftRoot('keywords', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>目标读者</label>
                <Input value={parsedBuildDraft.target_reader || ''} onChange={(e) => updateBuildDraftRoot('target_reader', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>世界观</label>
                <Textarea className='h-16' value={parsedBuildDraft.worldview || ''} onChange={(e) => updateBuildDraftRoot('worldview', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>主冲突</label>
                <Textarea className='h-16' value={parsedBuildDraft.main_conflict || ''} onChange={(e) => updateBuildDraftRoot('main_conflict', e.target.value)} />
              </div>
              <div className='col-span-12'>
                <label className='text-xs text-muted'>平台风格</label>
                <Input value={parsedBuildDraft.platform_style || ''} onChange={(e) => updateBuildDraftRoot('platform_style', e.target.value)} />
              </div>
              <div className='col-span-12'>
                <label className='text-xs text-muted'>禁写事项</label>
                <Textarea className='h-16' value={(parsedBuildDraft.banned_items || []).join('\n')} onChange={(e) => updateBuildDraftRoot('banned_items', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
              </div>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button className='text-xs' onClick={() => acceptDraftStoryFields(['genre', 'keywords', 'target_reader', 'platform_style', 'banned_items'])}>只写入基础约束</Button>
              <Button className='text-xs' onClick={() => acceptDraftStoryFields(['logline', 'theme', 'worldview', 'main_conflict'])}>只写入大纲核心</Button>
              <Button className='text-xs' onClick={() => acceptDraftStoryFields(['important_scenes'])}>只写入重要场景</Button>
            </div>
            <div className='space-y-2'>
              <div className='text-xs font-medium'>重要场景</div>
              {scenes.map((row: any, index: number) => (
                <div key={`scene-${index}`} className='grid grid-cols-12 gap-2 rounded-ui border border-border bg-surface p-2'>
                  <div className='col-span-4'>
                    <label className='text-xs text-muted'>场景</label>
                    <Input value={row.scene || ''} onChange={(e) => updateBuildDraftArrayItem('important_scenes', index, 'scene', e.target.value)} />
                  </div>
                  <div className='col-span-5'>
                    <label className='text-xs text-muted'>作用</label>
                    <Input value={row.purpose || ''} onChange={(e) => updateBuildDraftArrayItem('important_scenes', index, 'purpose', e.target.value)} />
                  </div>
                  <div className='col-span-3'>
                    <label className='text-xs text-muted'>章节</label>
                    <Input value={row.chapter || ''} onChange={(e) => updateBuildDraftArrayItem('important_scenes', index, 'chapter', e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
            {renderBuildDraftJsonDebug()}
          </div>
        )
      }
      if (buildDraft.kind === 'character_seed') {
        const payload = parsedBuildDraft.payload || {}
        return (
          <div className='space-y-3'>
            <div className='grid grid-cols-12 gap-2'>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>人物 ID</label>
                <Input value={parsedBuildDraft.id || ''} onChange={(e) => updateBuildDraftRoot('id', e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>显示标题</label>
                <Input value={parsedBuildDraft.title || ''} onChange={(e) => updateBuildDraftRoot('title', e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>姓名</label>
                <Input value={payload.name || ''} onChange={(e) => updateBuildDraftPayload('name', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>身份</label>
                <Input value={payload.identity || ''} onChange={(e) => updateBuildDraftPayload('identity', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>说话方式</label>
                <Input value={payload.voice || ''} onChange={(e) => updateBuildDraftPayload('voice', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>核心动机</label>
                <Textarea className='h-20' value={payload.core_motivation || ''} onChange={(e) => updateBuildDraftPayload('core_motivation', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>人物边界</label>
                <Textarea className='h-20' value={(payload.boundaries || []).join('\n')} onChange={(e) => updateBuildDraftPayload('boundaries', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
              </div>
            </div>
            <Button className='text-xs' variant='primary' onClick={acceptBuildDraft}>写入为人物卡</Button>
            {renderBuildDraftJsonDebug()}
          </div>
        )
      }
      if (buildDraft.kind === 'lines') {
        const openRows = Array.isArray(parsedBuildDraft.open_line) ? parsedBuildDraft.open_line : []
        const hiddenRows = Array.isArray(parsedBuildDraft.hidden_line) ? parsedBuildDraft.hidden_line : []
        return (
          <div className='space-y-3'>
            <div className='flex flex-wrap gap-2'>
              <Button className='text-xs' onClick={() => appendDraftRowsToStory('open_line', openRows)}>只接受明线</Button>
              <Button className='text-xs' onClick={() => appendDraftRowsToStory('hidden_line', hiddenRows)}>只接受暗线</Button>
            </div>
            <div className='space-y-2'>
              <div className='text-xs font-medium'>明线草案</div>
              {openRows.map((row: any, index: number) => (
                <div key={`open-draft-${index}`} className='grid grid-cols-12 gap-2 rounded-ui border border-border bg-surface p-2'>
                  {['chapter', 'event', 'goal', 'conflict', 'result'].map((key) => (
                    <div key={key} className={key === 'event' || key === 'goal' ? 'col-span-3' : 'col-span-2'}>
                      <label className='text-xs text-muted'>{key}</label>
                      <Input value={row[key] || ''} onChange={(e) => updateBuildDraftArrayItem('open_line', index, key, e.target.value)} />
                    </div>
                  ))}
                </div>
              ))}
              <div className='text-xs font-medium'>暗线草案</div>
              {hiddenRows.map((row: any, index: number) => (
                <div key={`hidden-draft-${index}`} className='grid grid-cols-12 gap-2 rounded-ui border border-border bg-surface p-2'>
                  {['chapter', 'truth', 'visible_hint', 'hidden_meaning', 'reveal_timing'].map((key) => (
                    <div key={key} className={key === 'truth' || key === 'visible_hint' ? 'col-span-3' : 'col-span-2'}>
                      <label className='text-xs text-muted'>{key}</label>
                      <Input value={row[key] || ''} onChange={(e) => updateBuildDraftArrayItem('hidden_line', index, key, e.target.value)} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {renderBuildDraftJsonDebug()}
          </div>
        )
      }
      if (buildDraft.kind === 'foreshadowing') {
        const rows = Array.isArray(parsedBuildDraft.foreshadowings) ? parsedBuildDraft.foreshadowings : []
        return (
          <div className='space-y-3'>
            <Button className='text-xs' onClick={() => appendDraftRowsToStory('foreshadowings', rows)}>只接受伏笔</Button>
            {rows.map((row: any, index: number) => (
              <div key={`foreshadow-draft-${index}`} className='grid grid-cols-12 gap-2 rounded-ui border border-border bg-surface p-2'>
                {['id', 'status', 'content', 'first_chapter', 'surface_signal', 'true_meaning', 'payoff_chapter', 'payoff'].map((key) => (
                  <div key={key} className={key === 'content' || key === 'true_meaning' || key === 'payoff' ? 'col-span-4' : 'col-span-2'}>
                    <label className='text-xs text-muted'>{key}</label>
                    <Input value={row[key] || ''} onChange={(e) => updateBuildDraftArrayItem('foreshadowings', index, key, e.target.value)} />
                  </div>
                ))}
              </div>
            ))}
            {renderBuildDraftJsonDebug()}
          </div>
        )
      }
      return renderBuildDraftJsonDebug()
    }

    if (view === 'projects') {
      const recentChapters = [...chapterRows].sort((a: any, b: any) => Number(b.order_index || 0) - Number(a.order_index || 0)).slice(0, 6)
      const unsupportedMarks = evidenceMarkRows.filter((m: any) => m?.detection?.support_level === 'unsupported' || m?.detection?.support_level === 'contradicted')
      const runningEvent = events.length > 0 && events.slice(-1)[0]?.event !== 'DONE'
      const pendingPatchCount = pendingPatchReviews.length || latestPatch?.ops?.length || 0
      const authorJobStatus = (status?: string) => {
        if (runningEvent) return '起草中'
        if (status === 'completed') return '已完成'
        if (status === 'failed') return '有问题'
        if (status === 'awaiting_review') return '待确认'
        if (status === 'running') return '起草中'
        return pendingPatchCount ? '待确认' : '空闲'
      }
      const authorJobStep = (eventName?: string) => {
        const raw = eventName || ''
        if (!raw) return '暂无写作记录'
        if (raw.includes('PRE_REVIEW')) return '检查写作要求'
        if (raw.includes('WRITER') || raw.includes('DRAFT')) return '扩展正文'
        if (raw.includes('PROOFREAD') || raw.includes('PATCH')) return '校对建议'
        if (raw.includes('TRUST') || raw.includes('VERIFICATION') || raw.includes('MARK')) return '检查正文依据'
        if (raw.includes('DONE')) return '完成'
        return '准备下一步'
      }
      const realReadyProfiles = profileHealthRows.filter((row: any) => !row.is_mock && !row.missing_fields?.length)
      const agentModuleRows = Array.isArray(llmStatus?.modules) ? llmStatus.modules : []
      const agentAssignmentsReady = agentModuleRows.length > 0 && agentModuleRows.every((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length)
      const hasQuotedMarks = evidenceMarkRows.some((mark: any) => hasText(mark?.span?.quote) && Number(mark?.span?.start_line || 0) > 0)
      const supportedMarks = evidenceMarkRows.filter((mark: any) => mark?.detection?.support_level === 'supported' && hasText(mark?.span?.quote))
      const pinnedTechniqueCount = Array.isArray(currentChapterMeta?.pinned_techniques) ? currentChapterMeta.pinned_techniques.length : 0
      const pinnedCategoryCount = Array.isArray(currentChapterMeta?.pinned_technique_categories) ? currentChapterMeta.pinned_technique_categories.length : 0
      const goStoryStep = (step: string) => {
        setView('story')
        setBuildWizardStep(step)
      }
      const readinessGroups = [
        {
          id: 'foundation',
          label: '大重要 · 建书底座',
          detail: '决定这本书写什么、给谁看、不能写什么。',
          items: [
            { id: 'book_title', label: '书名', done: hasText(storyForm?.title), detail: storyForm?.title || '未填写', run: () => goStoryStep('basics') },
            { id: 'genre', label: '题材', done: hasText(activeStoryPayload.genre), detail: activeStoryPayload.genre || '未填写', run: () => goStoryStep('basics') },
            { id: 'keywords', label: '关键词', done: hasArrayItems(activeStoryPayload.keywords), detail: `${(activeStoryPayload.keywords || []).length || 0} 个`, run: () => goStoryStep('basics') },
            { id: 'reader', label: '目标读者', done: hasText(activeStoryPayload.target_reader), detail: activeStoryPayload.target_reader || '未填写', run: () => goStoryStep('basics') },
            { id: 'banned', label: '禁写事项', done: hasArrayItems(activeStoryPayload.banned_items), detail: `${(activeStoryPayload.banned_items || []).length || 0} 条`, run: () => goStoryStep('basics') },
          ],
        },
        {
          id: 'story_core',
          label: '大重要 · 故事核心',
          detail: '让 AI 和作者对主线、主题、冲突有同一份理解。',
          items: [
            { id: 'logline', label: '小故事大纲', done: hasText(activeStoryPayload.logline), detail: activeStoryPayload.logline ? '已填写' : '缺一句话故事', run: () => goStoryStep('outline') },
            { id: 'theme', label: '主题', done: hasText(activeStoryPayload.theme), detail: activeStoryPayload.theme || '未填写', run: () => goStoryStep('outline') },
            { id: 'worldview', label: '世界观', done: hasText(activeStoryPayload.worldview), detail: activeStoryPayload.worldview ? '已填写' : '未填写', run: () => goStoryStep('outline') },
            { id: 'main_conflict', label: '主冲突', done: hasText(activeStoryPayload.main_conflict), detail: activeStoryPayload.main_conflict ? '已填写' : '未填写', run: () => goStoryStep('outline') },
            { id: 'platform_style', label: '平台风格', done: hasText(activeStoryPayload.platform_style), detail: activeStoryPayload.platform_style || '未填写', run: () => goStoryStep('outline') },
          ],
        },
        {
          id: 'structure',
          label: '大重要 · 结构脉络',
          detail: '阶段、章节、明线、暗线、伏笔都在这里对齐。',
          items: [
            { id: 'stages', label: '阶段目标', done: hasArrayItems(activeStoryPayload.stages), detail: `${(activeStoryPayload.stages || []).filter((x: any) => hasText(x?.stage) || hasText(x?.goal)).length || 0} 个`, run: () => goStoryStep('scenes') },
            { id: 'scenes', label: '重要场景', done: importantSceneRows.length > 0, detail: `${importantSceneRows.length} 个`, run: () => goStoryStep('scenes') },
            { id: 'open_line', label: '明线节点', done: openLineRows.length > 0, detail: `${openLineRows.length} 个`, run: () => goStoryStep('lines') },
            { id: 'hidden_line', label: '暗线节点', done: hiddenLineRows.length > 0, detail: `${hiddenLineRows.length} 个`, run: () => goStoryStep('lines') },
            { id: 'foreshadowing', label: '伏笔节点', done: foreshadowingRows.length > 0, detail: `${foreshadowingRows.length} 个`, run: () => goStoryStep('lines') },
            { id: 'chapter_plan', label: '章节矩阵', done: hasArrayItems(activeStoryPayload.chapter_plan), detail: `${(activeStoryPayload.chapter_plan || []).filter((x: any) => hasText(x?.chapter) || hasText(x?.title) || hasText(x?.focus)).length || 0} 行`, run: () => { setView('story'); setStoryPlanningTab('Chapter Matrix') } },
          ],
        },
        {
          id: 'cards',
          label: '大重要 · 卡片资产',
          detail: '人物、风格、技法、工具 skill 会成为章节写作约束。',
            items: [
            { id: 'characters', label: '人物卡', done: Array.isArray(chars) && chars.length > 0, detail: `${Array.isArray(chars) ? chars.length : 0} 张`, run: () => { setActiveActivity('cards'); setView('characters') } },
            { id: 'style_cards', label: '文风卡', done: Array.isArray(styles) && styles.length > 0, detail: `${Array.isArray(styles) ? styles.length : 0} 张`, run: () => { setActiveActivity('cards'); setView('style') } },
            { id: 'technique_cards', label: '叙事技巧', done: Array.isArray(techniqueCards) && techniqueCards.length > 0, detail: `${Array.isArray(techniqueCards) ? techniqueCards.length : 0} 张`, run: () => { setActiveActivity('techniques'); setView('techniques') } },
            { id: 'tool_skills', label: '写作工具', done: Array.isArray(toolSkillCards) && toolSkillCards.length > 0, detail: `${Array.isArray(toolSkillCards) ? toolSkillCards.length : 0} 个`, run: () => { setActiveActivity('techniques'); setView('techniques') } },
          ],
        },
        {
          id: 'chapter',
          label: '大重要 · 当前章节',
          detail: '这一章是否能明确挂到卷、章节计划和要求节点。',
          items: [
            { id: 'volumes', label: '卷', done: volumeRows.length > 0, detail: `${volumeRows.length} 卷`, run: () => { if (volumeRows.length) setActiveActivity('explorer'); else void createVolume() } },
            { id: 'chapters', label: '章', done: chapterRows.length > 0, detail: `${chapterRows.length} 章`, run: () => { if (chapterRows.length) { setView('chapter'); setActiveActivity('explorer') } else void createChapterInVolume(volumeRows[0]?.id || 'volume_default') } },
            { id: 'chapter_title', label: '章节标题', done: hasText(chapterTitleDraft || currentChapterMeta?.chapter_title), detail: chapterTitleDraft || currentChapterMeta?.chapter_title || '未填写', run: () => { setView('chapter'); setActiveActivity('explorer') } },
            { id: 'linked_plan', label: '绑定章节计划', done: currentStoryLinks.chapterPlan.length > 0, detail: `${currentStoryLinks.chapterPlan.length} 行`, run: () => { setView('story'); setStoryPlanningTab('Chapter Matrix') } },
            { id: 'linked_lines', label: '本章明暗伏', done: currentStoryLinks.openLine.length + currentStoryLinks.hiddenLine.length + currentStoryLinks.foreshadowings.length > 0, detail: `明 ${currentStoryLinks.openLine.length} · 暗 ${currentStoryLinks.hiddenLine.length} · 伏 ${currentStoryLinks.foreshadowings.length}`, run: () => goStoryStep('lines') },
            { id: 'pinned_techniques', label: '本章技法挂载', done: pinnedTechniqueCount + pinnedCategoryCount > 0, detail: `技法 ${pinnedTechniqueCount} · 分类 ${pinnedCategoryCount}`, run: () => { setView('chapter'); setActiveActivity('explorer') } },
          ],
        },
        {
          id: 'trust',
          label: '大重要 · 可信点亮',
          detail: 'AI 判断必须有正文 quote 和行号，不能只靠自述。',
          items: [
            { id: 'profile', label: '真实模型配置', done: realReadyProfiles.length > 0, detail: `${realReadyProfiles.length} 个可用`, run: () => setView('settings') },
            { id: 'agents', label: '写作分工', done: agentAssignmentsReady, detail: agentModuleRows.length ? `${agentModuleRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length).length}/${agentModuleRows.length} 可用` : '等待读取', run: () => setView('settings') },
            { id: 'marks', label: '正文依据', done: hasQuotedMarks, detail: `${evidenceMarkRows.length} 个`, run: () => { setView('chapter'); void analyzeMarks() } },
            { id: 'supported', label: '已证实命中', done: supportedMarks.length > 0, detail: `${supportedMarks.length} 个`, run: () => setView('chapter') },
            { id: 'risks', label: '未证实风险', done: unsupportedMarks.length === 0 && evidenceMarkRows.length > 0, detail: `${unsupportedMarks.length} 个风险`, run: () => setView('chapter') },
            { id: 'pending_reviews', label: '待确认稿件', done: pendingChapterReviews.length === 0 && pendingPatchCount === 0, detail: `草稿 ${pendingChapterReviews.length} · 校对 ${pendingPatchCount}`, run: () => setView('chapter') },
          ],
        },
      ]
      const readinessItemCount = readinessGroups.reduce((sum, group) => sum + group.items.length, 0)
      const readinessDoneCount = readinessGroups.reduce((sum, group) => sum + group.items.filter((item) => item.done).length, 0)
      const readinessMajorDoneCount = readinessGroups.filter((group) => group.items.every((item) => item.done)).length
      const confirmedTimelineIds = new Set<string>(Array.isArray(activeStoryPayload.timeline_confirmed) ? activeStoryPayload.timeline_confirmed : [])
      const timelineDecisions = activeStoryPayload.timeline_decisions && typeof activeStoryPayload.timeline_decisions === 'object' ? activeStoryPayload.timeline_decisions : {}
      const chapterPlanRows = Array.isArray(activeStoryPayload.chapter_plan) ? activeStoryPayload.chapter_plan : []
      const blastRows = chapterPlanRows.filter((row: any) => /爆点|爆发|高潮|转折|危机/.test(`${row.title || ''}${row.focus || ''}${row.key_events || ''}${row.conflict || ''}`)).slice(0, 6)
      const pendingDraftKinds = new Set(pendingBuildDrafts.map((draft: any) => draft.kind))
      const timelineStatus = (id: string, hasMaterial: boolean, draftKind?: string) => {
        const decision = timelineDecisions[id]?.decision
        if (decision === 'accepted' || confirmedTimelineIds.has(id)) return 'confirmed'
        if (unsupportedMarks.length && id === 'context') return 'risk'
        if (draftKind && pendingDraftKinds.has(draftKind)) return 'suggesting'
        if (hasMaterial) return 'pending'
        return 'empty'
      }
      const updateTimelineDecision = (node: any, decision: string) => {
        setStoryForm((prev: any) => {
          const payload = { ...(prev?.payload || {}) }
          const currentConfirmed = Array.isArray(payload.timeline_confirmed) ? payload.timeline_confirmed : []
          const nextConfirmed = decision === 'accepted'
            ? Array.from(new Set([...currentConfirmed, node.id]))
            : currentConfirmed.filter((id: string) => id !== node.id)
          const nextDecisions = {
            ...(payload.timeline_decisions || {}),
            [node.id]: {
              node_id: node.id,
              label: node.label,
              decision,
              suggestion: node.suggestion,
              decided_by: 'author',
              decided_at: new Date().toISOString(),
            },
          }
          return normalizeStoryCard({ ...prev, payload: { ...payload, timeline_confirmed: nextConfirmed, timeline_decisions: nextDecisions } })
        })
        push(decision === 'accepted' ? `${node.label} 已由作者确认，请保存故事卡` : `${node.label} 已标记为${decision === 'skipped' ? '跳过' : '待修改'}`)
      }
      const timelineNodes = [
        { id: 'build', label: '建书', status: timelineStatus('build', hasText(storyForm?.title), 'story_overview'), suggestion: '确认这本书的创作目标，再让 AI 辅助拆分结构。', run: () => goStoryStep('basics'), draftKind: 'story_overview' },
        { id: 'genre_keywords', label: '题材/关键词', status: timelineStatus('genre_keywords', hasText(activeStoryPayload.genre) && hasArrayItems(activeStoryPayload.keywords), 'story_overview'), suggestion: '题材和关键词决定 AI 后续建议的边界，作者确认后才进入正式计划。', run: () => goStoryStep('basics'), draftKind: 'story_overview' },
        { id: 'characters', label: '人物初设', status: timelineStatus('characters', Array.isArray(chars) && chars.length > 0, 'character_seed'), suggestion: 'AI 可以建议人物小传，但正式人物卡由作者确认。', run: () => { setActiveActivity('cards'); setView('characters') }, draftKind: 'character_seed' },
        { id: 'world', label: '世界观', status: timelineStatus('world', hasText(activeStoryPayload.worldview), 'story_overview'), suggestion: '确认世界规则和重要场景，避免后续章节场景漂移。', run: () => goStoryStep('outline'), draftKind: 'story_overview' },
        { id: 'story_core', label: '故事核心', status: timelineStatus('story_core', hasText(activeStoryPayload.logline) && hasText(activeStoryPayload.main_conflict), 'story_overview'), suggestion: '故事核心包括小故事大纲、主题和主冲突，AI 只能给候选，作者决定正式方向。', run: () => goStoryStep('outline'), draftKind: 'story_overview' },
        { id: 'context', label: '脉络', status: timelineStatus('context', Boolean(openLineRows.length && hiddenLineRows.length), 'lines'), suggestion: '明线、暗线、伏笔、爆点、转折、回收都归在脉络里。伏笔不是主线大节点。', run: () => goStoryStep('lines'), draftKind: 'lines' },
        ...volumeRows.map((volume: any, index: number) => ({
          id: `volume:${volume.id}`,
          label: volume.title || `第${index + 1}卷`,
          status: timelineStatus(`volume:${volume.id}`, hasText(volume.summary) || Boolean((volume.chapter_ids || []).length)),
          suggestion: volume.summary || 'AI 可以建议本卷目标、卷末转折和风险点，作者确认后进入计划。',
          run: () => { setActiveActivity('explorer'); setView('projects') },
        })),
        ...(blastRows.length ? blastRows : [{ title: '爆点1', focus: activeStoryPayload.main_conflict || '围绕主冲突设计第一个强事件' }]).map((row: any, index: number) => ({
          id: `blast:${row.chapter_id || row.chapter || index}`,
          label: row.title && /爆点|爆发|高潮|转折|危机/.test(row.title) ? row.title : `爆点${index + 1}`,
          status: timelineStatus(`blast:${row.chapter_id || row.chapter || index}`, hasText(row.key_events || row.focus)),
          suggestion: row.focus || row.key_events || 'AI 可以给爆点建议，作者决定是否采用。',
          run: () => { setView('story'); setStoryPlanningTab('Chapter Matrix') },
        })),
        { id: 'ending', label: '结局', status: timelineStatus('ending', /结局|终局|收束/.test(JSON.stringify(activeStoryPayload))), suggestion: '结局只保留结构位置，具体收束由作者最终决策。', run: () => { setView('story'); setStoryPlanningTab('Chapter Matrix') } },
      ]
      const setupChecklist = [
        {
          id: 'api',
          label: '配置模型 API',
          done: realReadyProfiles.length > 0,
          detail: realReadyProfiles.length ? `${realReadyProfiles.length} 个可用配置` : '还没有可用配置',
          action: '去配置',
          run: () => setView('settings'),
        },
        {
          id: 'agents',
          label: '分配写作模型',
          done: agentAssignmentsReady,
          detail: agentModuleRows.length ? `${agentModuleRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length).length}/${agentModuleRows.length} 个分工可用` : '等待读取模型状态',
          action: '分配模型',
          run: () => setView('settings'),
        },
        {
          id: 'story',
          label: '填写建书核心',
          done: completedBuildSteps >= Math.min(4, storyBuildProgress.length),
          detail: `${completedBuildSteps}/${storyBuildProgress.length} 个建设步骤`,
          action: '打开向导',
          run: () => { setView('story'); setBuildWizardStep('basics') },
        },
        {
          id: 'characters',
          label: '准备人物卡',
          done: Array.isArray(chars) && chars.length > 0,
          detail: `${Array.isArray(chars) ? chars.length : 0} 张人物卡`,
          action: '去人物卡',
          run: () => { setActiveActivity('cards'); setView('characters') },
        },
        {
          id: 'chapters',
          label: '创建卷 / 章',
          done: volumeRows.length > 0 && chapterRows.length > 0,
          detail: `${volumeRows.length} 卷 · ${chapterRows.length} 章`,
          action: chapterRows.length ? '打开章节' : '新建章节',
          run: () => {
            if (chapterRows.length) {
              setView('chapter')
              setActiveActivity('explorer')
            } else {
              createChapterInVolume(volumeRows[0]?.id || 'volume_default')
            }
          },
        },
        {
          id: 'evidence',
          label: '建立正文依据',
          done: evidenceMarkRows.length > 0 || Boolean(trustReport?.updated_at),
          detail: evidenceMarkRows.length ? `${evidenceMarkRows.length} 个标记 · 风险 ${unsupportedMarks.length}` : '还没有分析当前章节',
          action: '分析当前章',
          run: () => { setView('chapter'); analyzeMarks() },
        },
      ]
      return (
        <div className='space-y-3 density-space'>
          <Card
            title='写作工作台'
            extra={<Button variant='primary' onClick={() => { setView('chapter'); setActiveActivity('explorer') }}>打开当前章节</Button>}
            className='module-card module-context'
          >
            <div className='grid grid-cols-1 gap-3 md:grid-cols-5'>
              <div className='metric-card metric-blue rounded-ui border p-3'>
                <div className='text-xs text-muted'>初稿状态</div>
                <div className='font-display mt-1 text-lg font-semibold'>{authorJobStatus(latestJob?.status)}</div>
                <div className='text-xs text-muted'>{authorJobStep(events.slice(-1)[0]?.event || latestJob?.last_event)}</div>
              </div>
              <div className='metric-card metric-purple rounded-ui border p-3'>
                <div className='text-xs text-muted'>待确认校对</div>
                <div className='font-display mt-1 text-lg font-semibold'>{pendingPatchCount}</div>
                <div className='text-xs text-muted'>AI 改动默认需确认</div>
              </div>
              <div className='metric-card metric-green rounded-ui border p-3'>
                <div className='text-xs text-muted'>待确认 AI 初稿</div>
                <div className='font-display mt-1 text-lg font-semibold'>{pendingChapterReviews.length}</div>
                <div className='text-xs text-muted'>确认后才视为作者稿</div>
              </div>
              <div className='metric-card metric-amber rounded-ui border p-3'>
                <div className='text-xs text-muted'>待确认草案</div>
                <div className='font-display mt-1 text-lg font-semibold'>{pendingBuildDrafts.length}</div>
                <div className='text-xs text-muted'>建书草案不会自动写入</div>
              </div>
              <div className='metric-card metric-rose rounded-ui border p-3'>
                <div className='text-xs text-muted'>风险标记</div>
                <div className='font-display mt-1 text-lg font-semibold'>{unsupportedMarks.length}</div>
                <div className='text-xs text-muted'>未证实 / 有矛盾</div>
              </div>
            </div>
          </Card>

          <WritingPrepMap
            groups={readinessGroups}
            itemCount={readinessItemCount}
            doneCount={readinessDoneCount}
            majorDoneCount={readinessMajorDoneCount}
            onStartChapter={() => { setView('chapter'); setActiveActivity('explorer') }}
          />

          <BookTimelinePanel
            nodes={timelineNodes}
            selectedNodeId={selectedTimelineNodeId}
            onAccept={(node) => updateTimelineDecision(node, 'accepted')}
            onGenerateAlternative={(node) => node.draftKind ? generateBuildDraft(node.draftKind) : node.run()}
            onSelectNode={setSelectedTimelineNodeId}
            onSkip={(node) => updateTimelineDecision(node, 'skipped')}
          />

          <FirstRunChecklist steps={setupChecklist} />

          <BuildProgressCard
            steps={storyBuildProgress}
            onOpenStep={(stepId) => { setView('story'); setBuildWizardStep(stepId) }}
          />

          <RecentChaptersCard
            chapters={recentChapters}
            onOpenChapter={(chapterId) => {
              setSelectedChapter(chapterId)
              setView('chapter')
              setActiveActivity('explorer')
            }}
          />

          <ProjectSwitcherCard
            projects={projects || []}
            selectedProjectId={project}
            importInputRef={backupImportInputRef}
            onSelectProject={setProject}
            onCreateProject={async () => {
              const response = await api.post('/api/projects', { title: '未命名新书' })
              setProject(response.project_id)
              mutateProjects()
            }}
            onDownloadBackup={downloadProjectBackup}
            onDownloadManuscript={downloadManuscriptMarkdown}
            onImportBackup={importProjectBackup}
          />

          <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
            <BuildDraftReviewCards
              pendingDrafts={pendingBuildDrafts}
              historyRows={buildDraftHistoryRows}
              historyFilter={buildDraftHistoryFilter}
              historyCounts={buildDraftHistoryCounts as Record<string, number>}
              onChangeHistoryFilter={setBuildDraftHistoryFilter}
              onOpenDraft={openBuildDraft}
              onRejectDraft={rejectBuildDraft}
              onRestoreDraft={restoreBuildDraft}
              getAcceptedScopeLabels={acceptedScopeLabels}
            />
            <PendingPatchCard operations={reviewPatch?.ops || []} onOpenPatchReview={() => setView('chapter')} />
          </div>

          <RecentAiJobsCard
            jobs={jobList}
            selectedJobId={selectedJobId}
            onSelectJob={(job) => {
              if (job.chapter_id) setSelectedChapter(job.chapter_id)
              setSelectedJobId(job.job_id)
            }}
          />

          {selectedJobSummary && isMaintainerMode ? (
            <AiJobDetailCard
              summary={selectedJobSummary}
              events={selectedJobEvents}
              manifest={selectedJobManifest}
              trustReport={selectedJobTrust}
              onRefresh={() => mutateSelectedJobDetail()}
              onOpenChapter={(chapterId) => {
                setSelectedChapter(chapterId)
                setView('chapter')
                setActiveActivity('explorer')
              }}
            />
          ) : null}

          <WorkspaceTrustCards
            proposals={proposals || []}
            unsupportedMarks={unsupportedMarks}
            onOpenProposal={(proposalId) => {
              setSelectedProposalId(proposalId)
              setView('canon')
            }}
            onOpenMark={(markId) => {
              setSelectedMarkId(markId)
              setView('chapter')
            }}
          />
        </div>
      )
    }

    if (view === 'story') {
      return (
        <div className='space-y-3 density-space'>
          <StoryBuildWizardPanel
            steps={storyBuildProgress}
            activeStepId={buildWizardStep}
            activeStep={activeBuildWizardStep}
            busy={buildDraftBusy}
            selectedDraft={buildDraft}
            pendingDrafts={pendingBuildDrafts}
            processedDrafts={processedBuildDrafts}
            historyRows={buildDraftHistoryRows}
            historyFilter={buildDraftHistoryFilter}
            historyCounts={buildDraftHistoryCounts as Record<string, number>}
            draftEditor={renderBuildDraftEditor()}
            onSelectStep={setBuildWizardStep}
            onGenerateDraft={generateBuildDraft}
            onSaveStory={saveStoryCard}
            onOpenDraft={openBuildDraft}
            onRejectDraft={rejectBuildDraft}
            onRestoreDraft={restoreBuildDraft}
            onChangeHistoryFilter={setBuildDraftHistoryFilter}
            onAcceptDraft={acceptBuildDraft}
            getAcceptedScopeLabels={acceptedScopeLabels}
          />
          <StoryControlCard
            storyForm={storyForm}
            storyPayload={storyPayload}
            storyCards={storyCards || []}
            onNewStory={() => setStoryForm(normalizeStoryCard(null))}
            onSaveStory={saveStoryCard}
            onSelectStory={(card) => setStoryForm(normalizeStoryCard(card))}
            onUpdateRoot={updateStoryRoot}
            onUpdatePayload={updateStoryPayload}
            onAddImportantScene={() => addStoryArrayItem('important_scenes', STORY_PAYLOAD_TEMPLATE.important_scenes[0])}
            onUpdateImportantScene={(index, key, value) => updateStoryArrayItem('important_scenes', index, key, value)}
            onRemoveImportantScene={(index) => removeStoryArrayItem('important_scenes', index)}
          />

          <StoryPlanningPanel
            activeTab={storyPlanningTab}
            payload={storyPayload}
            template={STORY_PAYLOAD_TEMPLATE}
            canvasPanel={renderNarrativeCanvas()}
            selectedChapter={selectedChapter}
            openLineRows={openLineRows}
            hiddenLineRows={hiddenLineRows}
            foreshadowingRows={foreshadowingRows}
            storyCardPreview={normalizeStoryCard(storyForm)}
            showJsonPreview={isMaintainerMode}
            onChangeTab={setStoryPlanningTab}
            onUpdateRow={updateStoryArrayItem}
            onAddRow={addStoryArrayItem}
            onRemoveRow={removeStoryArrayItem}
            getTraceRows={traceRowsFor}
            getTraceTone={traceBadgeTone}
            getTraceSummary={traceSummary}
          />
        </div>
      )
    }

    if (view === 'characters') {
      const payload = characterForm?.payload || {}
      const updateCharacterPayload = (key: string, value: any) => setCharacterForm({ ...characterForm, payload: { ...payload, [key]: value } })
      const updateCharacterArray = (key: string, value: string) => updateCharacterPayload(key, value.split(/[，,]/).map((x) => x.trim()).filter(Boolean))
      return (
        <div className='space-y-3 density-space'>
          <Card title='人物写作卡'>
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-12 md:col-span-3'>
                <label className='text-xs text-muted'>姓名</label>
                <Input
                  value={payload.name || characterForm?.title || ''}
                  onChange={(e) => {
                    const name = e.target.value
                    setCharacterForm({ ...characterForm, title: name, payload: { ...payload, name } })
                  }}
                />
              </div>
              <div className='col-span-12 md:col-span-3'>
                <label className='text-xs text-muted'>身份</label>
                <Input value={payload.identity || ''} onChange={(e) => updateCharacterPayload('identity', e.target.value)} placeholder='调查记者 / 皇子 / 医师' />
              </div>
              <div className='col-span-6 md:col-span-2'>
                <label className='text-xs text-muted'>角色位置</label>
                <Select
                  value={payload.role || 'other'}
                  onChange={(e) => updateCharacterPayload('role', e.target.value)}
                >
                  <option value='protagonist'>主角</option>
                  <option value='supporting'>配角</option>
                  <option value='antagonist'>反派</option>
                  <option value='other'>其他</option>
                </Select>
              </div>
              <div className='col-span-6 md:col-span-2'>
                <label className='text-xs text-muted'>重要度 1-5</label>
                <Input
                  type='number'
                  min={1}
                  max={5}
                  value={payload.importance ?? 3}
                  onChange={(e) => updateCharacterPayload('importance', Number(e.target.value || 3))}
                />
              </div>
              <div className='col-span-6 md:col-span-2'>
                <label className='text-xs text-muted'>年龄</label>
                <Input
                  type='number'
                  min={0}
                  max={200}
                  value={payload.age ?? ''}
                  onChange={(e) => updateCharacterPayload('age', e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </div>
              <div className='col-span-12 md:col-span-4'>
                <label className='text-xs text-muted'>外貌/第一印象</label>
                <Input value={payload.appearance || ''} onChange={(e) => updateCharacterPayload('appearance', e.target.value)} placeholder='短发、灰色风衣' />
              </div>
              <div className='col-span-12 md:col-span-4'>
                <label className='text-xs text-muted'>核心动机</label>
                <Input value={payload.core_motivation || ''} onChange={(e) => updateCharacterPayload('core_motivation', e.target.value)} placeholder='他真正想得到什么' />
              </div>
              <div className='col-span-12 md:col-span-4'>
                <label className='text-xs text-muted'>说话方式</label>
                <Input value={payload.voice || ''} onChange={(e) => updateCharacterPayload('voice', e.target.value)} placeholder='克制 / 犀利 / 温吞' />
              </div>
              <div className='col-span-12 md:col-span-6'>
                <label className='text-xs text-muted'>性格关键词</label>
                <Input value={(payload.personality_traits || []).join('，')} onChange={(e) => updateCharacterArray('personality_traits', e.target.value)} placeholder='冷静，执拗，敏感' />
              </div>
              <div className='col-span-12 md:col-span-6'>
                <label className='text-xs text-muted'>行为边界</label>
                <Input value={(payload.boundaries || []).join('，')} onChange={(e) => updateCharacterArray('boundaries', e.target.value)} placeholder='不会伤及无辜，不主动撒谎' />
              </div>
            </div>
          </Card>
          {isMaintainerMode ? <SchemaForm title='人物维护字段' schema={charSchema} value={characterForm} onChange={setCharacterForm} /> : null}
          <Button
            variant='primary'
            onClick={async () => {
              const id = characterForm?.id || `character_${Date.now()}`
              const body = { ...characterForm, id, type: 'character' }
              await api.put(`/api/projects/${project}/cards/${id}`, body)
              setCharacterForm(body)
              mutateCards()
              push('人物卡已保存')
            }}
          >
            保存角色
          </Button>
          <Card title='人物在本章的使用情况' extra={<Badge>{selectedChapter}</Badge>}>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
              {(Array.isArray(chars) ? chars : []).map((card: any) => {
                const traces = traceRowsFor('character', [card.id, card.title, card.payload?.name])
                const usedChapters = traces.map((mark: any) => mark.chapter_id).filter(Boolean)
                const traceStages = Array.from(new Set(traces.map((mark: any) => mark.agent_trace?.stage).filter(Boolean)))
                return (
                  <button key={card.id} className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2' onClick={() => setCharacterForm(card)}>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='text-sm font-medium'>{card.title || card.id}</span>
                      <Badge tone={traceBadgeTone(traces) as any}>{traceSummary(traces)}</Badge>
                    </div>
                    <div className='mt-1 text-xs text-muted'>出现章节：{usedChapters.join(', ') || '还没有证据'}</div>
                    {isMaintainerMode ? <div className='mt-1 text-xs text-muted'>Agent: {traceStages.join(', ') || 'none'}</div> : null}
                  </button>
                )
              })}
              {(!Array.isArray(chars) || !chars.length) && <p className='text-sm text-muted'>暂无人物卡。</p>}
            </div>
          </Card>
        </div>
      )
    }

    if (view === 'style') {
      return (
        <div className='space-y-3 density-space'>
          <Card title='文风样本与规则'>
            <div className='space-y-2'>
              <Textarea className='h-28' value={styleUploadText} onChange={(e) => setStyleUploadText(e.target.value)} placeholder='粘贴一段你喜欢的文风样本，AI 会学习节奏、句式和语气。' />
              <div className='flex gap-2'>
                <Button onClick={uploadStyleSample}>上传样本</Button>
                <Button variant='primary' onClick={analyzeStyle}>分析文风</Button>
              </div>
              <div className='text-xs text-muted'>已启用素材：{activeStyleAssets.join('，') || '暂无'}</div>
            </div>
          </Card>
          <Card title='文风卡'>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
              {(Array.isArray(styles) ? styles : []).map((row: any) => (
                <div key={row.id || row.title} className='rounded-ui border border-border bg-surface px-3 py-2 text-sm'>
                  <div className='font-medium'>{row.title || row.id || '文风样本'}</div>
                  <div className='mt-1 text-xs text-muted'>{row.payload?.summary || row.payload?.tone || row.payload?.description || '用于辅助 AI 保持文风一致。'}</div>
                </div>
              ))}
              {(!Array.isArray(styles) || !styles.length) && <p className='text-sm text-muted'>还没有文风卡。可以先上传一段样本文本。</p>}
            </div>
          </Card>
          {isMaintainerMode ? (
            <>
              <Card title='文风原始数据'>
                <pre className='mono text-xs overflow-auto'>{JSON.stringify(styles, null, 2)}</pre>
              </Card>
              <Card title='文风 Schema'>
                <pre className='mono text-xs overflow-auto'>{JSON.stringify(styleSchema, null, 2)}</pre>
              </Card>
            </>
          ) : null}
        </div>
      )
    }

    if (view === 'chapter') {
      const supportClass = (level: string) => {
        if (level === 'supported') return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200'
        if (level === 'partial') return 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200'
        if (level === 'contradicted') return 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200'
        return 'border-border bg-surface-2 text-muted'
      }
      const acceptedChapterReviews = chapterReviewList.filter((review: any) => review.status === 'accepted' || review.status === 'rejected')
      const savedManuscript = chapterEditorText === (draft?.content || '') && (chapterTitleDraft || selectedChapter) === (draft?.meta?.chapter_title || draft?.meta?.title || selectedChapter)
      const hasManuscriptBody = chapterEditorText.replace(/^# .+?\n+/, '').trim().length > 0
      const marksVerified = evidenceMarkRows.length > 0 || Boolean(trustReport?.updated_at)
      const chapterWorkflowSteps = [
        {
          id: 'review',
          label: '确认 AI 初稿',
          done: acceptedChapterReviews.length > 0 || (chapterReviewList.length > 0 && pendingChapterReviews.length === 0),
          detail: pendingChapterReviews.length ? `${pendingChapterReviews.length} 个 AI 初稿待确认` : chapterReviewList.length ? 'AI 初稿已处理' : '开始写初稿后这里会出现待确认草稿',
          action: pendingChapterReviews.length ? '确认第一条' : '查看初稿',
          disabled: !pendingChapterReviews.length,
          run: () => {
            if (pendingChapterReviews[0]) void updateChapterReview(pendingChapterReviews[0], 'accepted')
          },
        },
        {
          id: 'edit',
          label: '作者修改正文',
          done: hasManuscriptBody,
          detail: hasManuscriptBody ? `${chapterEditorText.trim().length} 字` : '正文还为空',
          action: '编辑正文',
          run: () => document.getElementById('chapter-manuscript-editor')?.focus(),
        },
        {
          id: 'save',
          label: '保存正文',
          done: savedManuscript && hasManuscriptBody,
          detail: savedManuscript ? '本地编辑已保存' : '有未保存改动',
          action: '保存',
          run: saveChapterDraft,
        },
        {
          id: 'analyze_marks',
          label: '检查写到没有',
          done: marksVerified,
          detail: evidenceMarkRows.length ? `${evidenceMarkRows.length} 个正文依据` : '还没有检查正文',
          action: '检查正文',
          run: analyzeMarks,
        },
      ]
      const marksByLine = evidenceMarkRows.reduce((acc: Record<string, any[]>, mark: any) => {
        const line = Number(mark?.span?.start_line || 0)
        const key = line > 0 ? String(line) : '未证实'
        acc[key] = [...(acc[key] || []), mark]
        return acc
      }, {})
      const alignmentReady = Boolean(alignmentConfirmed && alignmentAgreedDraft.trim())
      const generationReady = canStartWriting()
      const preWriteReadyItems = [
        { id: 'agreement', label: '写法', done: alignmentReady, detail: alignmentReady ? '作者已确认' : '先确认写作共识' },
        { id: 'structure', label: '结构点', done: selectedCanvasConstraints.length > 0, detail: selectedCanvasConstraints.length ? `${selectedCanvasConstraints.length} 个` : '未选择' },
        { id: 'lines', label: '脉络', done: generationUseLines, detail: generationUseLines ? '会使用' : '已关闭' },
        { id: 'techniques', label: '技法', done: generationUseTechniques, detail: generationUseTechniques ? '会使用' : '已关闭' },
      ]
      const traceTypesForCanvasNode = (node: any) => {
        if (node.id === 'line:open') return ['open_line']
        if (node.id === 'line:hidden') return ['hidden_line']
        if (node.type === 'clue') return ['foreshadowing']
        if (node.type === 'character') return ['character']
        if (node.type === 'beat' || node.type === 'ending' || node.type === 'thread') return ['open_line', 'hidden_line', 'foreshadowing']
        return ['open_line', 'hidden_line', 'foreshadowing', 'canon_fact']
      }
      const tracesForCanvasNode = (node: any) => {
        const candidates = [node.id, node.label, node.ref_id, node.description, node.author_decision].filter(Boolean)
        return traceTypesForCanvasNode(node).flatMap((type) => traceRowsFor(type, candidates))
      }
      return (
        <div className='space-y-3 density-space'>
          <ChapterAlignmentPanel
            agreedDraft={alignmentAgreedDraft}
            canGenerate={generationReady}
            confirmed={alignmentConfirmed}
            discussionInput={alignmentDiscussionInput}
            idea={alignmentIdea}
            messages={alignmentMessages}
            understanding={alignmentUnderstanding}
            versions={alignmentUnderstandingVersions}
            onConfirm={confirmWritingAlignment}
            onFocus={() => setChapterWorkMode('alignment')}
            onGenerateUnderstanding={generateAlignmentUnderstanding}
            onMergeIntoAgreement={() => mergeDiscussionIntoAgreement()}
            onRunWithAgreement={requestRunJobWithAgreement}
            onSaveAgreement={() => saveWritingAlignment({ agreed_draft: alignmentAgreedDraft, confirmed: alignmentConfirmed })}
            onSaveIdea={() => saveWritingAlignment({ idea: alignmentIdea, confirmed: false })}
            onSelectCurrentUnderstanding={(text) => {
              setAlignmentUnderstanding(text)
              saveWritingAlignment({ understanding: text, confirmed: false })
            }}
            onSendMessage={sendAlignmentMessage}
            onUseVersionAsAgreement={(text) => {
              setAlignmentUnderstanding(text)
              setAlignmentAgreedDraft(text)
              setAlignmentConfirmed(false)
              saveWritingAlignment({ understanding: text, agreed_draft: text, confirmed: false })
            }}
            setAgreedDraft={setAlignmentAgreedDraft}
            setConfirmed={setAlignmentConfirmed}
            setDiscussionInput={setAlignmentDiscussionInput}
            setIdea={setAlignmentIdea}
          />

          <ChapterPrewriteCard
            canGenerate={generationReady}
            canvasConstraintRows={canvasConstraintRows}
            generationScopeLabel={GENERATION_SCOPE_OPTIONS.find((x) => x.id === generationScope)?.label || generationScope}
            nodeTypeLabels={CANVAS_TYPE_LABELS}
            onGenerate={requestRunJobWithAgreement}
            onOpenCanvas={() => { setActiveActivity('story'); setStoryPlanningTab('Canvas'); setView('story') }}
            onSaveStructure={saveChapterCanvasConstraints}
            onToggleNode={toggleCanvasConstraint}
            readyItems={preWriteReadyItems}
            selectedNodeIds={selectedCanvasConstraintIds}
            targetText={alignmentAgreedDraft || currentStoryLinks.chapterPlan[0]?.focus || activeStoryPayload.main_conflict || '先写下本章想达成的效果，再让 AI 扩展。'}
          />

          <ChapterStructureLights
            nodes={selectedCanvasConstraints}
            getTracesForNode={tracesForCanvasNode}
            onSelectEvidence={(mark) => {
              if (!mark.mark_id || !mark.span) return
              setSelectedMarkId(mark.mark_id)
              setHighlightRange({ start: Number(mark.span.start_line), end: Number(mark.span.end_line || mark.span.start_line) })
            }}
          />

          <ChapterDraftReviewQueue
            pendingCount={pendingChapterReviews.length}
            reviews={chapterReviewList}
            onAccept={(review) => updateChapterReview(review, 'accepted')}
            onReject={(review) => updateChapterReview(review, 'rejected')}
          />

          <ChapterWorkflowChecklist steps={chapterWorkflowSteps} />

          <ChapterEditorCard
            analyzeBusy={analyzeBusy}
            analyzeResult={analyzeResult}
            autoApplyPatch={autoApplyPatch}
            canGenerate={generationReady}
            canvasConstraintRows={canvasConstraintRows}
            chapterEditorText={chapterEditorText}
            chapterSaving={chapterSaving}
            chapterStatus={currentChapterMeta?.chapter_status || 'draft'}
            chapterTitleDraft={chapterTitleDraft}
            evidenceMarkCount={evidenceMarkRows.length}
            generationCheckMode={generationCheckMode}
            generationCheckOptions={GENERATION_CHECK_OPTIONS}
            generationScope={generationScope}
            generationScopeOptions={GENERATION_SCOPE_OPTIONS}
            generationStopOptions={GENERATION_STOP_OPTIONS}
            generationStopPoint={generationStopPoint}
            generationUseCards={generationUseCards}
            generationUseLines={generationUseLines}
            generationUseTechniques={generationUseTechniques}
            highlighted={highlighted}
            highlightRange={highlightRange}
            llmProfileId={llmProfileId}
            marksByLine={marksByLine}
            nodeTypeLabels={CANVAS_TYPE_LABELS}
            profiles={profiles}
            selectedCanvasConstraintIds={selectedCanvasConstraintIds}
            selectedChapter={selectedChapter}
            selectionEnd={selectionEnd}
            selectionMode={selectionMode}
            selectionRange={selectionRange}
            selectionStart={selectionStart}
            useAgentAssignments={useAgentAssignments}
            volumeId={currentChapterMeta?.volume_id || currentVolume?.id || 'volume_default'}
            volumeRows={volumeRows}
            onAnalyze={() => { setChapterWorkMode('draft'); analyzeMarks() }}
            onEditorFocus={() => setChapterWorkMode('draft')}
            onGenerate={requestRunJobWithAgreement}
            onRewriteSelection={() => selectionRange && requestRunJob(1200, selectionRange, '修改选中段落')}
            onSave={saveChapterDraft}
            onSaveCanvasConstraints={saveChapterCanvasConstraints}
            onSelectMark={(mark) => {
              setChapterWorkMode('draft')
              setSelectedMarkId(mark.mark_id)
              const start = Number(mark?.span?.start_line || 0)
              const end = Number(mark?.span?.end_line || start)
              if (start > 0) setHighlightRange({ start, end })
            }}
            onStatusChange={async (value) => {
              const meta = { ...(draft?.meta || currentChapterMeta || {}), chapter_status: value }
              await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
              mutateDraft()
              mutateDraftDetails()
            }}
            onToggleCanvasConstraint={toggleCanvasConstraint}
            onVolumeChange={async (value) => {
              const meta = { ...(draft?.meta || currentChapterMeta || {}), volume_id: value }
              await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
              mutateDraft()
              mutateDraftDetails()
              mutateVolumes()
            }}
            setAutoApplyPatch={setAutoApplyPatch}
            setChapterEditorText={setChapterEditorText}
            setChapterTitleDraft={setChapterTitleDraft}
            setGenerationCheckMode={setGenerationCheckMode}
            setGenerationScope={setGenerationScope}
            setGenerationStopPoint={setGenerationStopPoint}
            setGenerationUseCards={setGenerationUseCards}
            setGenerationUseLines={setGenerationUseLines}
            setGenerationUseTechniques={setGenerationUseTechniques}
            setLlmProfileId={setLlmProfileId}
            setSelectedChapter={setSelectedChapter}
            setSelectionEnd={setSelectionEnd}
            setSelectionMode={setSelectionMode}
            setSelectionStart={setSelectionStart}
            setUseAgentAssignments={setUseAgentAssignments}
            supportClass={supportClass}
          />

          {isMaintainerMode ? <Card title='开发者技法数据' extra={<Badge>维护者模式</Badge>}>
            <details className='rounded-ui border border-border bg-surface-2 p-3'>
              <summary className='cursor-pointer text-sm font-medium'>查看本章技法 JSON / 继承信息</summary>
              <div className='mt-3 space-y-2'>
                <Textarea
                  className='h-24 mono'
                  value={JSON.stringify((draft?.meta || {}).pinned_techniques || [], null, 2)}
                  onChange={async (e) => {
                    try {
                      const meta = { ...(draft?.meta || {}), pinned_techniques: JSON.parse(e.target.value) }
                      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
                      mutateDraft()
                    } catch {
                      // keep typing tolerant
                    }
                  }}
                />
                <p className='text-xs text-muted'>pinned_techniques 优先于 outline technique_prefs，同 technique_id 会覆盖强度与备注。</p>
                <Textarea
                  className='h-24 mono'
                  value={JSON.stringify((draft?.meta || {}).pinned_technique_categories || [], null, 2)}
                  onChange={async (e) => {
                    try {
                      const meta = { ...(draft?.meta || {}), pinned_technique_categories: JSON.parse(e.target.value) }
                      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
                      mutateDraft()
                    } catch {
                      // keep typing tolerant
                    }
                  }}
                />
                <p className='text-xs text-muted'>pinned_technique_categories 为宏观分类覆盖层；可驱动 TechniqueDirector 自动推荐 micro 技法。</p>
                <div className='rounded-ui border border-border bg-surface p-2'>
                  <div className='text-xs font-medium mb-1'>Inherited from outline (read-only)</div>
                  <pre className='mono text-[11px] whitespace-pre-wrap'>{JSON.stringify(inheritedTechniqueDefaults, null, 2)}</pre>
                </div>
                <div className='rounded-ui border border-border bg-surface p-2'>
                  <div className='text-xs font-medium mb-1'>分类自动推荐的本章技法（只读）</div>
                  <div className='space-y-1'>
                    {autoRecommendedTechniques.length ? autoRecommendedTechniques.map((row: any) => (
                      <div key={`${row.technique_id}:${row.source}`} className='flex items-center justify-between gap-2 rounded-ui border border-border bg-panel px-2 py-1'>
                        <span className='text-xs'>{row.technique_id} <span className='text-muted'>({row.intensity || 'med'}, {row.source})</span></span>
                        <Button className='text-xs' onClick={() => toPinnedFromAuto(row)}>挂到本章</Button>
                      </div>
                    )) : <p className='text-xs text-muted'>暂无自动推荐（先挂载技法分类，再起草或检查）。</p>}
                  </div>
                </div>
              </div>
            </details>
          </Card> : null}

        </div>
      )
    }

    if (view === 'canon') {
      return (
        <div className='space-y-3 density-space'>
          <Card title='作品事实'>
            <div className='space-y-2'>
              {(canonFacts || []).slice(-20).reverse().map((f: any, i: number) => {
                const scopeLabel = f.scope === 'world_state' ? '世界状态' : f.scope === 'chapter' ? '章节事实' : f.scope === 'character' ? '人物事实' : f.scope === 'style' ? '文风规则' : f.scope || '事实'
                return (
                  <div key={`${f.id || 'fact'}:${i}`} className='rounded-ui border border-border bg-surface p-2'>
                    <div className='flex items-center gap-2 text-sm'>
                      <Badge>{scopeLabel}</Badge>
                      <span className='font-medium'>{String(f.value || (f._original || f).value || f.id || `事实 ${i + 1}`)}</span>
                      {f._revised ? <span className='text-xs text-muted'>已修订 {(f._revisions || []).length} 次</span> : null}
                    </div>
                    <div className='mt-1 text-xs text-muted'>
                      {f._revised ? <div>原内容：{String((f._original || f).value || '')}</div> : null}
                      {isMaintainerMode ? <div>fact_id: {f.id || `fact_${i}`}</div> : null}
                    </div>
                    <div className='mt-2'>
                      <Button className='text-xs' onClick={() => setFactRevisionModal({ open: true, fact: f, patch: JSON.stringify({ value: f.value || '' }, null, 2), reason: '' })}>编辑/修订</Button>
                    </div>
                  </div>
                )
              })}
              {(!canonFacts || canonFacts.length === 0) && <p className='text-sm text-muted'>还没有正式事实。AI 提取的内容会先进入待确认。</p>}
            </div>
          </Card>

          <Card title='待确认事实'>
            <div className='space-y-2'>
              {(proposals || []).slice(-20).reverse().map((p: any, i: number) => {
                const proposalType = p.entity_type === 'world_state' ? '世界状态' : p.entity_type === 'character' ? '人物' : p.entity_type === 'event' ? '事件' : p.event ? '事件' : '建议'
                return (
                  <div key={i} className={`rounded-ui border bg-surface p-2 ${selectedProposalId && selectedProposalId === (p.proposal_id || p.id) ? 'border-brand-500' : 'border-border'}`}>
                    <div className='flex items-center gap-2 text-sm'>
                      <Badge>{proposalType}</Badge>
                      <span>{p.name || p.value || p.proposal_id}</span>
                      <span className='text-xs text-muted'>{p.status === 'accepted' ? '已确认' : p.status === 'rejected' ? '先不用' : '待确认'}</span>
                    </div>
                    <div className='mt-2 flex gap-2'>
                      <Button className='text-xs' onClick={async () => { await api.post(`/api/projects/${project}/canon/proposals/${p.proposal_id}/accept`, {}); mutateProposals(); push('待确认事实已确认') }}>确认</Button>
                      <Button className='text-xs' onClick={async () => { await api.post(`/api/projects/${project}/canon/proposals/${p.proposal_id}/reject`, {}); mutateProposals(); push('待确认事实已标为先不用') }}>先不用</Button>
                    </div>
                  </div>
                )
              })}
              {(!proposals || proposals.length === 0) && <p className='text-sm text-muted'>还没有待确认事实。</p>}
            </div>
          </Card>

          {factRevisionModal.open ? (
            <Card title='修订事实'>
              <div className='space-y-2'>
                {isMaintainerMode ? <div className='text-xs text-muted'>fact_id: {factRevisionModal.fact?.id}</div> : null}
                <Textarea className='h-28 mono' value={factRevisionModal.patch} onChange={(e) => setFactRevisionModal((x) => ({ ...x, patch: e.target.value }))} placeholder='填写修订后的事实内容' />
                <Input value={factRevisionModal.reason} onChange={(e) => setFactRevisionModal((x) => ({ ...x, reason: e.target.value }))} placeholder='修订原因（必填）' />
                <div className='flex gap-2'>
                  <Button variant='primary' onClick={reviseCanonFact}>保存修订</Button>
                  <Button onClick={() => setFactRevisionModal({ open: false, fact: null, patch: '{}', reason: '' })}>取消</Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      )
    }

    if (view === 'world') {
      const worldResultRows = Array.isArray(worldRows) ? worldRows : []
      return (
        <Card title='世界观查询'>
          <div className='flex gap-2'>
            <Input value={worldQuery} onChange={(e) => setWorldQuery(e.target.value)} placeholder='查一个地点、规则、组织、物件...' />
            <Button variant='primary' onClick={async () => { const r = await api.post(`/api/projects/${project}/world/query`, { query: worldQuery, top_k: 10, include_global: false }); setWorldRows(r) }}>查找</Button>
          </div>
          <div className='mt-3 space-y-2'>
            {worldResultRows.map((row: any, idx: number) => {
              const title = row.title || row.name || row.id || row.chunk_id || `资料片段 ${idx + 1}`
              const body = row.text || row.content || row.summary || row.value || row.description || ''
              return (
                <div key={`${title}-${idx}`} className='rounded-ui border border-border bg-surface px-3 py-2 text-sm'>
                  <div className='font-medium'>{title}</div>
                  <div className='mt-1 text-xs text-muted'>{body || '已找到一条相关资料。'}</div>
                </div>
              )
            })}
            {!worldResultRows.length && <p className='text-sm text-muted'>输入关键词后，可以查找本书世界观里的地点、规则、组织和事实。</p>}
          </div>
          {isMaintainerMode ? <pre className='mono mt-3 text-xs rounded-ui bg-surface-2 p-3 overflow-auto'>{JSON.stringify(worldRows, null, 2)}</pre> : null}
        </Card>
      )
    }


    if (view === 'techniques') {
      const cats = Array.isArray(techniqueCategories) ? techniqueCategories : []
      const rows = (Array.isArray(techniqueCards) ? techniqueCards : []).filter((t: any) => {
        const q = techniqueQuery.trim().toLowerCase()
        const layer = t.payload?.usage_layer || 'scene'
        if (techniqueLayerFilter !== 'all' && layer !== techniqueLayerFilter) return false
        if (!q) return true
        return String(t.title || '').toLowerCase().includes(q) || String(t.id || '').toLowerCase().includes(q) || JSON.stringify(t.payload || {}).toLowerCase().includes(q)
      })
      const toolRows = (Array.isArray(toolSkillCards) ? toolSkillCards : []).filter((t: any) => {
        const q = techniqueQuery.trim().toLowerCase()
        if (!q) return true
        return String(t.title || '').toLowerCase().includes(q) || String(t.id || '').toLowerCase().includes(q) || JSON.stringify(t.payload || {}).toLowerCase().includes(q)
      })
      return (
        <div className='space-y-3 density-space'>
          <Tabs
            items={['叙事技巧', '写作工具']}
            active={techniqueLibraryTab}
            onChange={setTechniqueLibraryTab}
          />
          {techniqueLibraryTab === '叙事技巧' ? (
            <>
              <Card title='技法分类'>
                <div className='space-y-1'>
                  {cats.filter((c: any) => !(c.payload || {}).parent_id).map((c: any) => (
                    <div key={c.id} className='rounded-ui border border-border p-2'>
                      <button className='text-sm font-medium' onClick={() => setCategoryForm(c)}>{c.title}</button>
                      <div className='ml-3 mt-1 space-y-1'>
                        {cats.filter((x: any) => (x.payload || {}).parent_id === c.id).map((x: any) => (
                          <button key={x.id} className='block text-xs text-muted hover:underline' onClick={() => setCategoryForm(x)}>{x.title}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title='叙事技巧库'>
                <div className='flex gap-2 mb-2'>
                  <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder='搜索悬念、反转、潜台词、人物关系...' />
                  <Button onClick={async () => { mutateTechniqueCards(); mutateTechniqueCategories(); push('技法库已刷新') }}>刷新</Button>
                </div>
                <div className='mb-2 grid grid-cols-3 gap-1 text-xs md:grid-cols-6'>
                  {TECHNIQUE_LAYER_OPTIONS.map((layer) => (
                    <button
                      key={layer.id}
                      className={`rounded-ui border px-2 py-1 ${techniqueLayerFilter === layer.id ? 'border-brand-500 bg-surface-2 font-medium' : 'border-border bg-surface hover:bg-surface-2'}`}
                      onClick={() => setTechniqueLayerFilter(layer.id)}
                    >
                      {layer.label}
                    </button>
                  ))}
                </div>
                <div className='max-h-[30rem] overflow-auto space-y-2'>
                  {rows.map((r: any) => {
                    const traces = traceRowsFor('technique', [r.id, r.title, r.payload?.name, ...(r.payload?.signals || [])])
                    const payload = r.payload || {}
                    const firstExample = payload.rewrite_examples?.[0]
                    return (
                      <div key={r.id} className='rounded-ui border border-border bg-surface px-2 py-2 text-xs'>
                        <div className='flex items-center justify-between gap-2'>
                          <button className='text-left font-medium hover:underline' onClick={() => setTechniqueForm(r)}>
                            {r.title} {isMaintainerMode ? <span className='text-muted'>({r.id})</span> : null}
                          </button>
                          <Badge tone={traceBadgeTone(traces) as any}>{traceSummary(traces)}</Badge>
                        </div>
                        <div className='mt-1 flex flex-wrap gap-1'>
                          <Badge>{techniqueLayerLabel(payload.usage_layer)}</Badge>
                          {payload.recipe_steps?.length ? <Badge>步骤</Badge> : null}
                          {(payload.suitable_scenes || []).slice(0, 2).map((x: string) => <Badge key={x} tone='success'>{x}</Badge>)}
                        </div>
                        <div className='mt-1 text-muted'>{(payload.signals || []).slice(0, 2).join(' / ')}</div>
                        {(payload.overuse_risks || []).length ? <div className='mt-1 text-amber-700 dark:text-amber-300'>风险：{payload.overuse_risks.slice(0, 2).join(' / ')}</div> : null}
                        {firstExample ? <div className='mt-1 truncate text-muted'>示例：{firstExample.source} → {firstExample.med || firstExample.low}</div> : null}
                        <div className='mt-1 text-muted'>本章依据：{traceSummary(traces)}</div>
                        {isMaintainerMode ? <div className='mt-1 text-muted'>Agent: {Array.from(new Set(traces.map((mark: any) => mark.agent_trace?.stage).filter(Boolean))).join(', ') || 'none'}</div> : null}
                        <div className='mt-2 grid grid-cols-3 gap-1'>
                          <Button className='text-xs' onClick={() => requestTechniqueAction(r, '试写一句', 'med')} disabled={!canStartWriting()}>试写</Button>
                          <Button className='text-xs' onClick={() => requestTechniqueAction(r, '改写选区', 'med')} disabled={!canStartWriting()}>改写选区</Button>
                          <Button className='text-xs' onClick={() => requestTechniqueAction(r, '强度变体', 'high')} disabled={!canStartWriting()}>强度</Button>
                        </div>
                      </div>
                    )
                  })}
                  {!rows.length && <p className='text-sm text-muted'>没有匹配的技法。</p>}
                </div>
              </Card>
              {techniqueForm && (
                <div className='space-y-2'>
                  <SchemaForm title='技法维护字段' schema={techniqueSchema} value={techniqueForm} onChange={setTechniqueForm} />
                  <Button variant='primary' onClick={async () => { await api.put(`/api/projects/${project}/cards/${techniqueForm.id}`, techniqueForm); mutateTechniqueCards(); push('技法已保存') }}>保存技法</Button>
                </div>
              )}
              {categoryForm && (
                <div className='space-y-2'>
                  <SchemaForm title='分类维护字段' schema={techniqueCategorySchema} value={categoryForm} onChange={setCategoryForm} />
                  <Button variant='primary' onClick={async () => { await api.put(`/api/projects/${project}/cards/${categoryForm.id}`, categoryForm); mutateTechniqueCategories(); push('技法分类已保存') }}>保存分类</Button>
                </div>
              )}
            </>
          ) : (
            <>
              <Card title='写作工具库'>
                <div className='flex gap-2 mb-2'>
                  <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder='搜索问题检查、人物小传、大纲调研...' />
                  <Button onClick={async () => { mutateToolSkillCards(); push('写作工具已刷新') }}>刷新</Button>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  {toolRows.map((r: any) => (
                    <button key={r.id} className='rounded-ui border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-surface-2' onClick={() => setToolSkillForm(r)}>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-sm font-medium'>{r.title || r.id}</span>
                        <Badge>{r.payload?.category || '工具'}</Badge>
                      </div>
                      <div className='mt-1 text-muted'>{r.payload?.description || r.id}</div>
                      <div className='mt-1 text-muted'>自动写入：{r.payload?.auto_apply_allowed ? '允许' : '关闭'} · 正文依据：{r.payload?.evidence_required ? '必须' : '可选'}</div>
                    </button>
                  ))}
                  {!toolRows.length && <p className='text-sm text-muted'>暂无写作工具。可以用快捷入口创建：+ tool_skill 小说问题检查 --category checker</p>}
                </div>
              </Card>
              {toolSkillForm && (
                <div className='space-y-2'>
                  <SchemaForm title='工具维护字段' schema={toolSkillSchema} value={toolSkillForm} onChange={setToolSkillForm} />
                  <Button variant='primary' onClick={async () => { await api.put(`/api/projects/${project}/cards/${toolSkillForm.id}`, toolSkillForm); mutateToolSkillCards(); push('写作工具已保存') }}>保存工具</Button>
                </div>
              )}
            </>
          )}
        </div>
      )
    }

    if (view === 'wiki') {
      return (
        <Card title='资料导入'>
          <Textarea className='h-40 mono' value={wikiHtml} onChange={(e) => setWikiHtml(e.target.value)} placeholder='粘贴百科、设定资料或 HTML 片段，导入后会进入待确认事实。' />
          <p className='mt-2 text-xs text-muted'>导入内容不会直接变成可信设定，需要作者确认后才进入正式事实库。</p>
          <div className='mt-2'>
            <Button variant='primary' onClick={async () => { const fd = new FormData(); fd.append('kind', 'auto'); fd.append('file', new File([wikiHtml], 'wiki.html', { type: 'text/html' })); await fetch(`/api/projects/${project}/wiki/import`, { method: 'POST', body: fd }); mutateProposals(); push('资料已导入') }}>导入资料</Button>
          </div>
        </Card>
      )
    }

    if (view === 'sessions') {
      return (
        <div className='space-y-3 density-space'>
          <Card title='对话草稿版本'>
            <div className='space-y-2'>
              <Input value={sessionMessageId} onChange={(e) => setSessionMessageId(e.target.value)} placeholder='消息编号，例如 writer_msg_001' />
              <Textarea className='h-20' value={sessionMessageText} onChange={(e) => setSessionMessageText(e.target.value)} placeholder='记录这轮对话中想保留的版本。' />
              <div className='flex gap-2'>
                <Button onClick={addMessageVersion}>新增消息版本</Button>
                <Button onClick={doUndo}>撤销</Button>
                <Button onClick={doRedo}>恢复</Button>
              </div>
            </div>
          </Card>
          {isMaintainerMode ? (
            <Card title='对话原始数据'>
              <pre className='mono text-xs overflow-auto'>{JSON.stringify(sessionMeta, null, 2)}</pre>
            </Card>
          ) : null}
          <Card title='切换消息版本'>
            {Object.entries(sessionMeta?.messages || {}).map(([mid, m]: any) => (
              <div key={mid} className='mb-3 rounded-ui border border-border bg-surface p-2'>
                <div className='text-sm'><b>{mid}</b> <span className='text-xs text-muted'>当前版本：{m.active_version}</span></div>
                <div className='mt-1 flex flex-wrap gap-2'>
                  {(m.versions || []).map((v: any) => (
                    <Button key={v.version_id} className='text-xs' onClick={() => activateVersion(mid, v.version_id)}>{v.version_id}</Button>
                  ))}
                </div>
              </div>
            ))}
            {!Object.keys(sessionMeta?.messages || {}).length ? <p className='text-sm text-muted'>还没有保存过对话版本。</p> : null}
          </Card>
        </div>
      )
    }

    if (view === 'settings') {
      const readyProfileCount = profileHealthRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length).length
      const readyModuleCount = agentModuleRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length).length
      const generationReady = readyProfileCount > 0 && readyModuleCount > 0
      return (
        <div className='space-y-3 density-space'>
          {!isMaintainerMode ? (
            <Card title='开写准备状态' extra={<Badge tone={generationReady ? 'success' : 'warn'}>{generationReady ? '可以开写' : '先补 API'}</Badge>} className='module-card module-context'>
              <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                <div className='rounded-ui border border-border bg-surface p-3'>
                  <div className='text-xs text-muted'>模型配置</div>
                  <div className='mt-1 text-lg font-semibold'>{readyProfileCount}</div>
                  <div className='text-xs text-muted'>{readyProfileCount ? '已有可用模型配置' : '还没有可用 API'}</div>
                </div>
                <div className='rounded-ui border border-border bg-surface p-3'>
                  <div className='text-xs text-muted'>写作分工</div>
                  <div className='mt-1 text-lg font-semibold'>{readyModuleCount}/{agentModuleRows.length || 0}</div>
                  <div className='text-xs text-muted'>{readyModuleCount ? '已有写作分工' : '等待配置写作/审查/校对'}</div>
                </div>
                <div className='rounded-ui border border-border bg-surface p-3'>
                  <div className='text-xs text-muted'>当前模式</div>
                  <div className='mt-1 text-lg font-semibold'>作者</div>
                  <div className='text-xs text-muted'>隐藏维护信息，只保留作者需要的状态。</div>
                </div>
              </div>
              <div className='mt-3 flex flex-wrap gap-2'>
                <Button onClick={() => mutateLlmStatus()}>刷新状态</Button>
              </div>
              <details className='mt-3 rounded-ui border border-border bg-surface-2 text-xs text-muted'>
                <summary className='cursor-pointer px-3 py-2 font-medium text-foreground'>维护者入口</summary>
                <div className='space-y-2 border-t border-border p-3'>
                  <p>普通写作不需要进入这里。只有调试模型路由、原始 JSON、运行记录或开源维护时才切换。</p>
                  <Button onClick={() => applySettings({ ...settings, experienceMode: 'maintainer' })}>进入维护者模式</Button>
                </div>
              </details>
            </Card>
          ) : null}

          {isMaintainerMode ? <Card title='模型运行安全' extra={<Badge tone={llmStatus?.all_mock ? 'warn' : (llmStatus?.missing_count || 0) ? 'warn' : 'success'}>{llmStatus?.all_mock ? '模拟模式' : `${llmStatus?.missing_count || 0} 项待补`}</Badge>}>
            <div className='grid grid-cols-1 gap-2 text-xs md:grid-cols-4'>
              {(llmStatus?.modules || []).map((row: any) => (
                <div key={row.module} className='rounded-ui border border-border bg-surface-2 p-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='font-medium'>{row.module}</span>
                    <Badge tone={row.is_mock ? 'warn' : row.missing_fields?.length ? 'warn' : 'success'}>{row.is_mock ? '模拟' : row.provider}</Badge>
                  </div>
                  <div className='mt-1 text-muted'>{row.profile_id}</div>
                  <div className='mt-1 text-muted'>{row.model || '未填写模型'}</div>
                  <div className='mt-1'>API Key：{row.requires_api_key ? (row.api_key_configured ? '已填写' : '未填写') : '不需要'}</div>
                  {row.missing_fields?.length ? <div className='mt-1 text-amber-700 dark:text-amber-300'>缺少字段：{row.missing_fields.join(', ')}</div> : null}
                  {row.profile_missing ? <div className='mt-1 text-amber-700 dark:text-amber-300'>模型配置未找到</div> : null}
                </div>
              ))}
            </div>
            <div className='mt-3 space-y-1 text-xs text-muted'>
              <div>API key 不会在状态卡里显示原文；当前全局配置文件：{llmStatus?.storage?.profiles_path || '-'}</div>
              <div>{llmStatus?.fallback_policy || '备用策略读取中...'}</div>
            </div>
          </Card> : null}

          <Card title='界面设置'>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <label className='text-xs text-muted'>主题</label>
                <Select value={settings.theme} onChange={(e) => applySettings({ ...settings, theme: e.target.value as any })}>
                  <option value='system'>跟随系统</option>
                  <option value='light'>明亮</option>
                  <option value='dark'>深色</option>
                </Select>
              </div>
              <div>
                <label className='text-xs text-muted'>界面密度</label>
                <Select value={settings.density} onChange={(e) => applySettings({ ...settings, density: e.target.value as any })}>
                  <option value='comfortable'>舒适</option>
                  <option value='compact'>紧凑</option>
                </Select>
              </div>
              <div>
                <label className='text-xs text-muted'>正文字号</label>
                <Select value={settings.editorSize} onChange={(e) => applySettings({ ...settings, editorSize: e.target.value as any })}>
                  <option value='small'>小</option>
                  <option value='medium'>中</option>
                  <option value='large'>大</option>
                </Select>
              </div>
              {isMaintainerMode ? (
                <div>
                  <label className='text-xs text-muted'>使用模式</label>
                  <Select value={settings.experienceMode} onChange={(e) => applySettings({ ...settings, experienceMode: e.target.value as any })}>
                    <option value='author'>作者</option>
                    <option value='maintainer'>维护者</option>
                  </Select>
                  <div className='mt-1 text-xs text-muted'>作者模式隐藏维护信息；维护者模式显示运行记录和原始配置。</div>
                </div>
              ) : (
                <div className='rounded-ui border border-border bg-surface-2 p-3'>
                  <div className='text-xs text-muted'>使用模式</div>
                  <div className='mt-1 text-sm font-medium'>作者模式</div>
                  <div className='mt-1 text-xs text-muted'>维护信息已折叠，写作时不用处理。</div>
                </div>
              )}
              <div>
                <label className='text-xs text-muted'>默认模型配置</label>
                <Select value={settings.defaultLlmProfileId} onChange={(e) => { const val = e.target.value; applySettings({ ...settings, defaultLlmProfileId: val }); setLlmProfileId(val) }}>
                  {Object.keys(profiles).map((k) => <option key={k} value={k}>{k}</option>)}
                </Select>
              </div>
            </div>
            <div className='mt-3 space-y-2'>
              <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={settings.defaultAutoApplyPatch} onChange={(e) => { const v = e.target.checked; applySettings({ ...settings, defaultAutoApplyPatch: v }); setAutoApplyPatch(v) }} /> 校对建议默认直接写入正文</label>
              <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={settings.evidenceWrap} onChange={(e) => applySettings({ ...settings, evidenceWrap: e.target.checked })} /> 回看依据自动换行</label>
            </div>
          </Card>

          <Card title='本地数据与安全'>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <div className='rounded-ui border border-border bg-surface-2 p-3 text-xs'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='font-medium'>API Key 安全</span>
                  <Badge tone={llmStatus?.storage?.api_keys_returned_in_status ? 'warn' : 'success'}>
                    {llmStatus?.storage?.api_keys_returned_in_status ? '可见' : '不会返回'}
                  </Badge>
                </div>
                <div className='space-y-1 text-muted'>
                  <div>模型配置文件: {llmStatus?.storage?.profiles_path || '-'}</div>
                  <div>写作分工文件: {llmStatus?.storage?.assignments_path || '-'}</div>
                  <div>界面只显示是否已填写，不显示 API Key 原文。</div>
                </div>
              </div>
              <div className='rounded-ui border border-border bg-surface-2 p-3 text-xs'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='font-medium'>作者确认策略</span>
                  <Badge tone={autoApplyPatch ? 'warn' : 'success'}>{autoApplyPatch ? '直接写入' : '手动确认'}</Badge>
                </div>
                <div className='space-y-1 text-muted'>
                  <div>AI 初稿默认进入待确认，作者确认后才视为作者稿。</div>
                  <div>校对建议默认应由作者确认或标为先不用。</div>
                  <div>没有正文原句的位置，不能显示为已命中。</div>
                </div>
              </div>
              <div className='rounded-ui border border-border bg-surface-2 p-3 text-xs md:col-span-2'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='font-medium'>项目备份与导出</span>
                  <Badge>{project}</Badge>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={downloadProjectBackup}>导出项目备份</Button>
                  <Button onClick={downloadManuscriptMarkdown}>导出正文</Button>
                  <Button onClick={() => backupImportInputRef.current?.click()}>导入备份</Button>
                </div>
                <div className='mt-2 text-muted'>备份包含项目资料；导出的正文适合投稿、迁移和人工阅读。导入备份会作为新项目恢复，不覆盖当前项目。</div>
              </div>
            </div>
          </Card>

          <Card title='模型配置'>
            <p className='text-xs text-muted mb-2'>先添加一个模型配置，再在下面分配给写作、审查、校对和事实抽取。</p>
            <div className='mb-3 rounded-ui border border-border bg-surface-2 p-3'>
              <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
                <div>
                  <label className='text-xs text-muted'>服务商模板</label>
                  <Select
                    value={selectedPresetId}
                    onChange={(e) => {
                      const nextId = e.target.value
                      const preset = providerPresets.find((p) => p.provider_id === nextId)
                      setSelectedPresetId(nextId)
                      setProfileDraft({ ...(preset?.defaults || {}) })
                    }}
                  >
                    {providerPresets.map((p) => <option key={p.provider_id} value={p.provider_id}>{p.display_name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className='text-xs text-muted'>配置名称</label>
                  <Input value={presetProfileId} onChange={(e) => setPresetProfileId(e.target.value)} placeholder='e.g. deepseek_writer' />
                </div>
                <div>
                  <label className='text-xs text-muted'>服务商</label>
                  <Input value={profileDraft.provider || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, provider: e.target.value }))} placeholder='openai_compat' />
                </div>
              </div>
              <div className='mt-2 grid grid-cols-1 gap-2 md:grid-cols-2'>
                <div>
                  <label className='text-xs text-muted'>模型</label>
                  <Input value={profileDraft.model || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, model: e.target.value }))} placeholder='deepseek-chat' />
                </div>
                <div>
                  <label className='text-xs text-muted'>接口地址</label>
                  <Input value={profileDraft.base_url || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, base_url: e.target.value }))} placeholder='https://api.example.com' />
                </div>
                <div>
                  <label className='text-xs text-muted'>API Key</label>
                  <Input type='password' value={profileDraft.api_key || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, api_key: e.target.value }))} placeholder='只保存在本地 data/_global' />
                </div>
                <div className='grid grid-cols-[1fr_auto] gap-2'>
                  <div>
                    <label className='text-xs text-muted'>超时秒数</label>
                    <Input type='number' min='1' value={profileDraft.timeout_s || 60} onChange={(e) => setProfileDraft((x: any) => ({ ...x, timeout_s: e.target.value }))} />
                  </div>
                  <label className='mt-6 flex items-center gap-2 text-sm'>
                    <input type='checkbox' checked={Boolean(profileDraft.stream ?? true)} onChange={(e) => setProfileDraft((x: any) => ({ ...x, stream: e.target.checked }))} />
                    流式输出
                  </label>
                </div>
              </div>
              <div className='mt-3 flex flex-wrap gap-2'>
                <Button variant='primary' onClick={saveProfileDraft}>保存配置</Button>
                {isMaintainerMode ? <Button onClick={applyPresetToEditor}>填入原始配置</Button> : null}
              </div>
              {isMaintainerMode ? <div className='mt-3 text-xs text-muted'>
                <div><b>Required:</b> {selectedPreset?.required_fields?.join(', ') || '-'}</div>
                <div><b>Optional:</b> {selectedPreset?.optional_fields?.join(', ') || '-'}</div>
                <div><b>Stream:</b> {selectedPreset?.supports_stream ? 'supported' : 'not supported'}</div>
                <div>编辑已有配置时，API Key 留空会保留原来的密钥。</div>
              </div> : null}
            </div>
            <div className='mb-3 rounded-ui border border-border bg-surface-2 p-3'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <div>
                  <h4 className='text-sm font-semibold'>配置检查</h4>
                  <p className='text-xs text-muted'>只检查本地字段，不会调用服务商，也不会显示 API Key 原文。</p>
                </div>
                <Badge tone={(llmStatus?.profile_missing_count || 0) ? 'warn' : 'success'}>{llmStatus?.profile_missing_count || 0} 个待补</Badge>
              </div>
              <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                {profileHealthRows.map((row: any) => (
                  <div key={row.profile_id} className='rounded-ui border border-border bg-surface p-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='font-medium'>{row.profile_id}</span>
                      <Badge tone={row.is_mock ? 'warn' : row.missing_fields?.length ? 'warn' : 'success'}>{row.is_mock ? '模拟' : row.missing_fields?.length ? '待补' : '可用'}</Badge>
                    </div>
                    <div className='mt-1 text-xs text-muted'>{row.provider} · {row.model || '未填写模型'}</div>
                    <div className='mt-1 text-xs'>API Key：{row.requires_api_key ? (row.api_key_configured ? '已填写' : '未填写') : '不需要'}</div>
                    {row.missing_fields?.length ? <div className='mt-1 text-xs text-amber-700 dark:text-amber-300'>待补字段：{row.missing_fields.join(', ')}</div> : null}
                    <div className='mt-2 flex flex-wrap gap-2'>
                      <Button className='text-xs' onClick={() => loadProfileDraft(row.profile_id)}>编辑</Button>
                      <Button className='text-xs' onClick={() => deleteProfileDraft(row.profile_id)} disabled={row.profile_id === 'mock_default'}>删除</Button>
                    </div>
                  </div>
                ))}
                {!profileHealthRows.length && <p className='text-sm text-muted'>还没有模型配置。</p>}
              </div>
            </div>
            {isMaintainerMode ? (
              <>
                <div className='mb-1 flex items-center justify-between gap-2'>
                  <label className='text-xs text-muted'>原始配置 JSON</label>
                  <Badge>{Object.keys(globalProfiles?.profiles || {}).length} profiles</Badge>
                </div>
                <Textarea className='h-48 mono' value={profilesEditor} onChange={(e) => setProfilesEditor(e.target.value)} />
                <div className='mt-2 flex gap-2'>
                  <Button variant='primary' onClick={async () => {
                    try {
                      await api.post('/api/config/llm/profiles', { mode: 'replace', profiles: JSON.parse(profilesEditor || '{}') })
                      mutateGlobalProfiles()
                      mutateLlmStatus()
                      push('模型配置 JSON 已保存')
                    } catch {
                      push('模型配置 JSON 无法解析', 'error')
                    }
                  }}>保存原始配置</Button>
                  <Button onClick={() => setProfilesEditor(JSON.stringify(globalProfiles?.profiles || {}, null, 2))}>重置</Button>
                </div>
              </>
            ) : null}
          </Card>

          <Card title='写作分工'>
            <p className='text-xs text-muted mb-2'>建书、人物、脉络、章节正文、审查、校对、事实抽取可以分别使用不同模型。</p>
            <div className='mb-3 space-y-3'>
              {['设定建设', '章节生成', '可信检查'].map((group) => (
                <div key={group} className='rounded-ui border border-border bg-surface-2 p-3'>
                  <div className='mb-2 flex items-center justify-between gap-2'>
                    <h4 className='text-sm font-semibold'>{group}</h4>
                    <Badge>{TASK_AI_MODULES.filter((x) => x.group === group).length}</Badge>
                  </div>
                  <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                    {TASK_AI_MODULES.filter((x) => x.group === group).map((task) => {
                      const row = (llmStatus?.modules || []).find((x: any) => x.module === task.id)
                      const current = assignmentDraft[task.id] || row?.profile_id || 'mock_default'
                      return (
                        <div key={task.id} className='rounded-ui border border-border bg-surface p-2'>
                          <div className='mb-1 flex items-center justify-between gap-2'>
                            <label className='text-sm font-medium'>{task.label}</label>
                            <Badge tone={row?.is_mock ? 'warn' : row?.missing_fields?.length || row?.profile_missing ? 'warn' : 'success'}>{row?.is_mock ? '模拟' : row?.provider || '待配置'}</Badge>
                          </div>
                          {isMaintainerMode ? <div className='mb-1 text-[11px] text-muted'>{task.id}</div> : null}
                          <Select
                            value={current}
                            onChange={(e) => {
                              const profileId = e.target.value
                              setAssignmentDraft((x) => ({ ...x, [task.id]: profileId }))
                              saveAgentAssignment(task.id, profileId)
                            }}
                          >
                            {Object.keys(globalProfiles?.profiles || {}).map((profileId) => (
                              <option key={profileId} value={profileId}>{profileId}</option>
                            ))}
                          </Select>
                          <div className='mt-1 text-xs text-muted'>{row?.model || '未填写模型'} · API Key {row?.requires_api_key ? (row?.api_key_configured ? '已填写' : '未填写') : '不需要'}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {isMaintainerMode ? (
              <>
                <Textarea className='h-40 mono' value={assignmentsEditor} onChange={(e) => setAssignmentsEditor(e.target.value)} />
                <div className='mt-2 flex gap-2'>
                  <Button variant='primary' onClick={async () => {
                    try {
                      const next = JSON.parse(assignmentsEditor || '{}')
                      await api.post('/api/config/llm/assignments', { mode: 'replace', assignments: next })
                      setAssignmentDraft(next)
                      mutateGlobalAssignments()
                      mutateLlmStatus()
                      push('写作分工 JSON 已保存')
                    } catch {
                      push('写作分工 JSON 无法解析', 'error')
                    }
                  }}>保存分工 JSON</Button>
                  <Button onClick={() => setAssignmentsEditor(JSON.stringify(globalAssignments?.assignments || {}, null, 2))}>重置</Button>
                </div>
                <pre className='mono text-xs overflow-auto rounded-ui bg-surface-2 p-3 mt-2'>{JSON.stringify(providersMeta?.providers || [], null, 2)}</pre>
              </>
            ) : null}
          </Card>
        </div>
      )
    }

    const evidence = currentManifest?.evidence || []
    const outlineCard = (paletteCacheRef.current.outlines || [])[0] || null
    return (
      <div className='space-y-3 density-space'>
        <Card title='大纲技法挂载'>
          <div className='grid grid-cols-2 gap-2 mb-2'>
            <div className='rounded-ui border border-border bg-surface-2 p-2'>
              <div className='text-xs font-medium mb-1'>大类技法</div>
              <pre className='mono text-[11px] whitespace-pre-wrap'>{JSON.stringify((outlineCard?.payload?.technique_prefs || []).map((x: any) => ({ scope: x.scope, ref: x.ref, categories: x.categories || [] })), null, 2)}</pre>
            </div>
            <div className='rounded-ui border border-border bg-surface-2 p-2'>
              <div className='text-xs font-medium mb-1'>具体技法</div>
              <pre className='mono text-[11px] whitespace-pre-wrap'>{JSON.stringify((outlineCard?.payload?.technique_prefs || []).map((x: any) => ({ scope: x.scope, ref: x.ref, techniques: x.techniques || [] })), null, 2)}</pre>
            </div>
          </div>
          <Textarea
            className='h-28 mono'
            value={JSON.stringify(outlineCard?.payload?.technique_prefs || [], null, 2)}
            onChange={async (e) => {
              if (!outlineCard) return
              try {
                const next = { ...outlineCard, payload: { ...(outlineCard.payload || {}), technique_prefs: JSON.parse(e.target.value) } }
                await api.put(`/api/projects/${project}/cards/${outlineCard.id}`, next)
                await lazyLoadPaletteData(true)
                push('大纲技法偏好已保存')
              } catch {
                // keep typing tolerant
              }
            }}
          />
          <p className='text-xs text-muted'>支持按脉络、章节和情节点挂载大类技法与具体技法；本章单独挂载的技法会优先使用。</p>
        </Card>
        <Card title='本章记忆'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2 max-h-64 overflow-auto'>
              {(Array.isArray(memoryPacks) ? memoryPacks : []).map((p: any) => (
                <button
                  key={p.pack_id}
                  className={`w-full rounded-ui border px-2 py-2 text-left text-xs ${selectedMemoryPackId === p.pack_id ? 'border-primary bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}
                  onClick={() => setSelectedMemoryPackId(p.pack_id)}
                >
                  <div className='font-medium'>{p.chapter_id} / {p.job_id}</div>
                  <div className='text-muted'>依据 {p.summary?.evidence_count || 0} · 压缩 {p.summary?.compression_steps || 0}</div>
                </button>
              ))}
              {!Array.isArray(memoryPacks) || !memoryPacks.length ? <p className='text-sm text-muted'>还没有本章记忆。起草或检查章节后会出现。</p> : null}
            </div>
            <div className='rounded-ui border border-border bg-surface-2 p-3'>
              {selectedMemoryPack ? (
                <div className='space-y-2'>
                  <div className='text-xs'><b>记忆包：</b>{selectedMemoryPack.pack_id}</div>
                  <div className='text-xs'><b>材料取舍记录</b></div>
                  <pre className='mono text-[11px] overflow-auto max-h-36'>{JSON.stringify(selectedMemoryPack.budget_report || {}, null, 2)}</pre>
                  <div className='text-xs'><b>依据来源</b></div>
                  <div className='space-y-1 max-h-32 overflow-auto'>
                    {(selectedMemoryPack.evidence || []).map((e: any) => (
                      <button key={`${e.kb_id}:${e.chunk_id}`} className='w-full rounded-ui border border-border bg-surface px-2 py-1 text-left text-xs hover:bg-surface-2' onClick={() => openEvidence(e)}>
                        {e.kb_id}:{e.chunk_id}
                      </button>
                    ))}
                  </div>
                </div>
              ) : <p className='text-sm text-muted'>选择一个记忆包查看 AI 本章记住了什么。</p>}
            </div>
          </div>
        </Card>
        <Card title='上下文记录' extra={selectedBlueprintId ? <Badge>蓝图：{selectedBlueprintId}</Badge> : undefined}>
          {currentManifest ? (
            <details className='rounded-ui border border-border bg-surface-2 text-xs'>
              <summary className='cursor-pointer px-3 py-2 font-medium'>查看本次 AI 使用和舍弃的材料</summary>
              <pre className='mono overflow-auto border-t border-border p-3'>{JSON.stringify(currentManifest, null, 2)}</pre>
            </details>
          ) : (
            <Skeleton className='h-20' />
          )}
        </Card>
        <Card title='依据跳转'>
          <div className='space-y-2'>
            {evidence.map((e: any) => (
              <button key={`${e.kb_id}:${e.chunk_id}`} className='w-full rounded-ui border border-border bg-surface px-2 py-2 text-left text-sm hover:bg-surface-2' onClick={() => openEvidence(e)}>
                <span className='font-medium'>{e.kb_id}:{e.chunk_id}</span>
                <span className='ml-2 text-xs text-muted'>{e.source?.path}</span>
              </button>
            ))}
            {!evidence.length && <p className='text-sm text-muted'>还没有正文依据。起草或检查章节后会出现。</p>}
          </div>
        </Card>
      </div>
    )
  }, [
    view,
    projects,
    storyCards,
    storyForm,
    charSchema,
    characterForm,
    chars,
    styleSchema,
    styles,
    draft,
    project,
    activeStyleAssets,
    currentManifest,
    llmProfileId,
    useAgentAssignments,
    generationScope,
    generationStopPoint,
    generationCheckMode,
    generationUseCards,
    generationUseTechniques,
    generationUseLines,
    profiles,
    selectedProfileHealth,
    writeRouteRows,
    selectedChapter,
    currentChapterMeta,
    currentVolume,
    volumeRows,
    chapterRows,
    chapterEditorText,
    chapterTitleDraft,
    chapterSaving,
    alignmentIdea,
    alignmentUnderstanding,
    alignmentUnderstandingVersions,
    alignmentAgreedDraft,
    alignmentConfirmed,
    alignmentDiscussionInput,
    alignmentMessages,
    storyPlanningTab,
    evidenceMarkRows,
    trustReport,
    selectedMarkId,
    highlighted,
    latestPatch,
    reviewPatch,
    patchReviewList,
    pendingPatchReviews,
    selectedOpIds,
    versions,
    autoApplyPatch,
    sessionMessageId,
    sessionMessageText,
    sessionMeta,
    proposals,
    worldQuery,
    worldRows,
    sideSearch,
    settings,
    llmStatus,
    globalProfiles,
    globalAssignments,
    providerPresets,
    selectedPreset,
    selectedPresetId,
    presetProfileId,
    profileDraft,
    profilesEditor,
    assignmentsEditor,
    assignmentDraft,
    selectedProposalId,
    selectedBlueprintId,
    techniqueCards,
    techniqueCategories,
    techniqueQuery,
    techniqueLibraryTab,
    techniqueLayerFilter,
    toolSkillCards,
    toolSkillSchema,
    toolSkillForm,
    buildDraft,
    buildDraftBusy,
    buildWizardStep,
    selectedTimelineNodeId,
    selectedCanvasNodeId,
    selectedCanvasConstraintIds,
    activeBuildWizardStep,
    pendingWriteJob,
    storyBuildProgress,
    completedBuildSteps,
    pendingBuildDrafts,
    processedBuildDrafts,
    buildDraftHistoryRows,
    buildDraftHistoryCounts,
    buildDraftHistoryFilter,
    acceptedScopeLabels,
    jobList,
    latestJob,
    selectedJobId,
    selectedJobDetail,
    selectedJobSummary,
    selectedJobEvents,
    selectedJobManifest,
    selectedJobTrust,
    mutateSelectedJobDetail,
    chapterReviewList,
    pendingChapterReviews,
    memoryPacks,
    selectedMemoryPackId,
    selectedMemoryPack,
    selectionMode,
    selectionStart,
    selectionEnd,
    selectionRange,
    analyzeBusy,
    analyzeResult,
    canonFacts,
    factRevisionModal,
  ])

  const providerInfo = events.filter((e) => e.event === 'WRITER_DRAFT').slice(-1)[0]?.data
  const latestTechniqueBriefForRight = events.filter((e) => e.event === 'TECHNIQUE_BRIEF').slice(-1)[0]?.data || (draft?.meta || {}).technique_brief || {}
  const latestEvent = (name: string) => events.filter((e) => e.event === name).slice(-1)[0]?.data
  const agentSteps = [
    { name: 'A 审查', event: 'PRE_REVIEW_PLAN', data: latestEvent('PRE_REVIEW_PLAN') },
    { name: 'B 初稿', event: 'WRITER_DRAFT', data: latestEvent('WRITER_DRAFT') },
    { name: 'C 校对', event: 'PROOFREAD_PATCH', data: latestEvent('PROOFREAD_PATCH') },
  ]
  const rightPinnedTechniqueRows = Array.isArray(currentChapterMeta?.pinned_techniques) ? currentChapterMeta.pinned_techniques : []
  const rightPinnedTechniqueIds = new Set(rightPinnedTechniqueRows.map((row: any) => row.technique_id))
  const rightQuickTechniqueRows = (Array.isArray(techniqueCards) ? techniqueCards : []).filter((tech: any) => !rightPinnedTechniqueIds.has(tech.id)).slice(0, 6)
  const rightAutoRecommendedTechniques = (latestTechniqueBriefForRight?.checklist || []).filter((x: any) => String(x?.source || '').startsWith('auto_from_category'))
  const pinRightAutoTechnique = async (row: any) => {
    const tech = (techniqueCards || []).find((x: any) => x.id === row.technique_id)
    if (!tech) {
      push(`没有找到技法：${row.technique_id}`, 'error')
      return
    }
    const out = await pinTechniqueToChapter(tech, row.intensity || 'med', row.weight, row.notes)
    push(out.message || (out.ok ? '已挂载技法' : '挂载失败'), out.ok ? 'success' : 'error')
  }

  const eventGroups = useMemo(() => {
    const map: Record<string, any[]> = {
      Plan: [],
      Manifest: [],
      Draft: [],
      Review: [],
      Patch: [],
      Diff: [],
      Canon: [],
      Technique: [],
      Other: [],
    }
    for (const e of events) {
      if (e.event.includes('PLAN')) map.Plan.push(e)
      else if (e.event.includes('MANIFEST')) map.Manifest.push(e)
      else if (e.event.includes('WRITER')) map.Draft.push(e)
      else if (e.event.includes('CRITIC')) map.Review.push(e)
      else if (e.event.includes('PATCH')) map.Patch.push(e)
      else if (e.event === 'DIFF') map.Diff.push(e)
      else if (e.event.includes('CANON')) map.Canon.push(e)
      else if (e.event.includes('TECHNIQUE')) map.Technique.push(e)
      else map.Other.push(e)
    }
    return map
  }, [events])

  const right = (
    <div className='space-y-3 density-space'>
      <RightAgentProgress mode={chapterWorkMode} steps={agentSteps} onModeChange={setChapterWorkMode} />

      <RightTechniquePanel
        autoRecommendedTechniques={rightAutoRecommendedTechniques}
        canGenerate={canStartWriting()}
        findRequirementMark={findRequirementMark}
        markTone={markTone}
        onPinAutoTechnique={pinRightAutoTechnique}
        onPinQuickTechnique={(row) => pinTechniqueToChapter(row, 'med').then((out) => push(out.message || '已挂载技法'))}
        onRequestTechniqueAction={requestTechniqueAction}
        onSelectMark={(mark) => {
          setChapterWorkMode('draft')
          setSelectedMarkId(mark.mark_id)
          const start = Number(mark?.span?.start_line || 0)
          const end = Number(mark?.span?.end_line || start)
          if (start > 0) setHighlightRange({ start, end })
        }}
        onUnpinTechnique={(row, title) => unpinTechniqueFromChapter({ id: row.technique_id, title })}
        pinnedTechniqueRows={rightPinnedTechniqueRows}
        quickTechniqueRows={rightQuickTechniqueRows}
        supportLabel={supportLabel}
        techniqueCards={techniqueCards}
        techniqueLayerLabel={techniqueLayerLabel}
        techniqueTitleById={techniqueTitleById}
      />

      {chapterWorkMode === 'alignment' ? (
        <RightChapterContextPanel
          chapterLabel={chapterTitleDraft || currentChapterMeta?.chapter_title || selectedChapter}
          storyLinks={currentStoryLinks}
          volumeLabel={currentVolume?.title || currentVolume?.id || 'volume_default'}
        />
      ) : null}

      {isMaintainerMode ? (
        <ChapterMaintainerPanel
          currentManifest={currentManifest || {}}
          eventGroups={eventGroups}
          evidenceWrap={settings.evidenceWrap}
          memoryPacks={Array.isArray(memoryPacks) ? memoryPacks : []}
          pinnedTechniqueCategories={currentChapterMeta?.pinned_technique_categories || []}
          pinnedTechniques={currentChapterMeta?.pinned_techniques || []}
          providerInfo={providerInfo}
          reviewPatch={reviewPatch}
          selectedOpIds={selectedOpIds}
          techniqueBrief={latestTechniqueBriefForRight}
          versions={versions}
          onApplyPatch={applySelectedPatch}
          onOpenMemoryPack={(packId) => {
            setSelectedMemoryPackId(packId)
            setView('context')
          }}
          onRejectPatch={rejectPatchReview}
          onRollbackVersion={rollbackVersion}
          onSelectAllPatchOps={setSelectedOpIds}
          onTogglePatchOp={(opId, checked) => setSelectedOpIds((ids) => (checked ? [...ids, opId] : ids.filter((id) => id !== opId)))}
        />
      ) : null}

      {assetViewer.open && (
        <Card title={`Asset Viewer: ${assetViewer.title}`} extra={<Button className='text-xs' onClick={() => navigator.clipboard.writeText(assetViewer.content)}>复制片段</Button>}>
          <Input value={assetFind} onChange={(e) => setAssetFind(e.target.value)} placeholder='Find in asset...' />
          <pre className={`mono mt-2 text-xs overflow-auto rounded-ui bg-surface-2 p-3 ${settings.evidenceWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'}`}>
            {assetViewer.content
              .split('\n')
              .map((line, idx) => `${idx + 1}: ${line}`)
              .filter((line) => !assetFind || line.includes(assetFind))
              .join('\n')}
          </pre>
          <Button className='mt-2 text-xs' onClick={() => setAssetViewer({ open: false, title: '', content: '' })}>关闭</Button>
        </Card>
      )}
    </div>
  )

  const confirmReadinessItems = getWriteReadinessItems()
  const writeConfirmOverlay = pendingWriteJob ? (
    <WriteConfirmOverlay
      agreedDraft={alignmentAgreedDraft}
      alignmentConfirmed={alignmentConfirmed}
      autoApplyPatch={autoApplyPatch}
      chapterLabel={chapterTitleDraft || currentChapterMeta?.chapter_title || selectedChapter}
      currentStoryLinks={currentStoryLinks}
      generationCheckLabel={GENERATION_CHECK_OPTIONS.find((x) => x.id === generationCheckMode)?.label || generationCheckMode}
      generationScopeLabel={GENERATION_SCOPE_OPTIONS.find((x) => x.id === generationScope)?.label || generationScope}
      generationStopLabel={GENERATION_STOP_OPTIONS.find((x) => x.id === generationStopPoint)?.label || generationStopPoint}
      generationUseCards={generationUseCards}
      generationUseLines={generationUseLines}
      generationUseTechniques={generationUseTechniques}
      llmProfileId={llmProfileId}
      memoryPackCount={Array.isArray(memoryPacks) ? memoryPacks.length : 0}
      pendingWriteJob={pendingWriteJob}
      pinnedTechniques={currentChapterMeta?.pinned_techniques || []}
      readinessItems={confirmReadinessItems}
      selectedCanvasConstraints={selectedCanvasConstraints}
      techniqueCards={techniqueCards}
      useAgentAssignments={useAgentAssignments}
      volumeLabel={currentVolume?.title || currentVolume?.id || '默认卷'}
      writeRouteRows={writeRouteRows}
      onCancel={() => setPendingWriteJob(null)}
      onConfirm={() => {
        const missing = getWriteReadinessItems().filter((item) => !item.done)
        if (missing.length) {
          push(`请先补齐开写检查：${missing.slice(0, 3).map((item) => item.label).join('、')}`, 'error')
          return
        }
        const job = pendingWriteJob
        setPendingWriteJob(null)
        if (job) runJob(job.maxTokens, job.range, job.techniqueAction || null)
      }}
      onGoSettings={() => { setPendingWriteJob(null); setView('settings') }}
    />
  ) : null

  return (
    <>
      <Layout left={left} center={center} right={right} header={header} />
      {writeConfirmOverlay}
    </>
  )
}
