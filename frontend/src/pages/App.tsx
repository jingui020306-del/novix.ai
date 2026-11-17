import type { ManuscriptPosition } from '../components/WritingTools'
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR, { mutate as mutateCache } from 'swr'
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
  Table2,
} from 'lucide-react'
import Layout from '../components/Layout'
import { SchemaForm, fieldLabel, profileLabel } from '../components/SchemaForm'
import { canonicalEvents, eventChoiceValue } from '../lib/materialScope'
import { CardEditor } from '../components/CardEditor'
import { KnowledgeGraph } from '../components/KnowledgeGraph'
import { ChapterBranchTools } from '../components/ChapterBranchTools'
import { ManuscriptEditor, TrialWritingTools, WritingRunPanel, TokenUsage, ProseStrategy } from '../components/WritingTools'
import { WritingReferenceNotice, WritingReferencePanel, WritingReferencePicker } from '../components/WritingReferencePicker'
import { StoryPlanningTables } from '../components/StoryPlanningTables'
import { MaterialReferences, OpenMaterial } from '../components/MaterialReferences'
import { BookOverview } from '../components/BookOverview'
import { SuspensePanel } from '../components/SuspensePanel'
import { WorldWiki } from '../components/WorldWiki'
import { NameReferences } from '../components/MaterialDiscovery'
import { CharacterDetails, CharacterDetailFocus } from '../components/CharacterDetails'
import { CharacterReferenceImage } from '../components/CharacterReferenceImage'
import { SelectiveExportPanel } from '../components/SelectiveExportPanel'
import { cardAfterSave, useDraftRecovery } from '../lib/editorDrafts'
import { FamilyWorkspace } from '../components/FamilyWorkspace'
import { SharedRelationships } from '../components/SharedRelationships'
import { AuthorControls, useAuthorControl, pointerLocked } from '../components/AuthorControls'
import { InformationPanel } from '../components/InformationPanel'
import { AuthorStatePanel } from '../components/AuthorStatePanel'
import { WorldContextFields } from '../components/WorldContextFields'
import { MaterialImportWorkspace } from '../components/MaterialImportWorkspace'
import { ChapterSceneRehearsals } from '../components/ChapterSceneRehearsals'
import { SceneRehearsalWorkspace } from '../components/SceneRehearsalWorkspace'
import { mergeConfirmedRehearsal } from '../lib/sceneRehearsal'
import { SettingChangeProposals } from '../components/SettingChangeProposals'
import { ContextMaterialSummary, GenerationMaterialItems, expansionKey } from '../components/ContextMaterialSummary'
import { chapterReferenceIds, isIncompleteReference, mergeReferenceSelection, referenceDescription, referenceLabel } from '../lib/writingReferences'
import { api } from '../api/client'
import { buildChapterBrief, chapterAgreement } from '../lib/chapterBrief'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select, Textarea } from '../components/ui/Fields'
import { Tabs } from '../components/ui/Tabs'
import { Skeleton } from '../components/ui/Skeleton'
import { useToast } from '../components/ui/Toast'
import { AppSettings, applySettingsToDom, DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from '../lib/settings'
import { CommandPalette } from '../components/CommandPalette/CommandPalette'
import { baseHelpCommands, CommandItem, iconForKind } from '../components/CommandPalette/commandIndex'
import { createHelpText, isCreateMode, parseCreateInput, ParsedCreate } from '../components/CommandPalette/cliParser'

const NAV_ITEMS = [
  { id: 'projects', label: '工作台', icon: FolderKanban },
  { id: 'story', label: '故事', icon: BookOpen },
  { id: 'planning', label: '情节工作表', icon: Table2 },
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
  { id: 'export', label: '导出资料', icon: List },
  { id: 'scene-rehearsal', label: '场景推演', icon: BookOpen },
]

const ACTIVITY_ITEMS = [
  { id: 'explorer', label: '目录', icon: FolderKanban },
  { id: 'story', label: '故事', icon: BookOpen },
  { id: 'cards', label: '卡片', icon: UserRound },
  { id: 'techniques', label: '技法', icon: Sparkles },
  { id: 'canon', label: '事实', icon: Waypoints },
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
  { id: 'confirm', label: '确认写入', draftKind: '', checks: ['局部接受', '保存故事卡', '拒绝草案'] },
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

const WRITE_ROUTE_MODULES = ['chapter_writer', 'chapter_reviewer', 'proofreader', 'canon_extractor']

const GENERATION_SCOPE_OPTIONS = [
  { id: 'chapter', label: '当前章节' },
  { id: 'chapters', label: '连续多章' },
  { id: 'beat', label: '一段到另一段' },
  { id: 'volume', label: '当前卷' },
  { id: 'book', label: '整本书草案' },
]

const GENERATION_STOP_OPTIONS = [
  { id: 'end', label: '完成所选范围' },
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

const cloneJson = (value: any) => JSON.parse(JSON.stringify(value))

const normalizeStoryCard = (card: any) => {
  const base = cloneJson(STORY_CARD_TEMPLATE)
  const payload = { ...cloneJson(STORY_PAYLOAD_TEMPLATE), ...(card?.payload || {}) }
  return { ...base, ...(card || {}), type: 'story', payload }
}

function chapterExtractionCoverage(project: string, chapterId: string, result: any, draft: any, editorText: string) {
  const currentResult = result?.project === project && result?.chapter_id === chapterId ? result : null
  const coverage = currentResult?.extraction_coverage || draft?.meta?.canon_extraction_coverage
  if (!coverage) return null
  const validRanges = (ranges: any) => (Array.isArray(ranges) ? ranges : []).filter((range: any) => Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start)
  return { ...coverage, read_ranges: validRanges(coverage.read_ranges), unread_ranges: validRanges(coverage.unread_ranges), current: Boolean(coverage.source_revision && coverage.source_revision === draft?.revision && editorText === draft?.content) }
}

export default function App() {
  const { push } = useToast()

  const [project, setProject] = useState('demo_project_001')
  const [view, setView] = useState('story')
  const [chapterPane, setChapterPane] = useState('正文')
  const [personPane, setPersonPane] = useState('概况')
  const [eventOrigin, setEventOrigin] = useState<any>(null)
  const [activeActivity, setActiveActivity] = useState('story')
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
  const [pendingWriteJob, setPendingWriteJob] = useState<{ maxTokens: number; range: { start: number; end: number } | null; label: string } | null>(null)
  const [materialPreview, setMaterialPreview] = useState<any>(null)
  const [materialPreviewBusy, setMaterialPreviewBusy] = useState(false)
  const [materialPreviewError, setMaterialPreviewError] = useState('')
  const [generationStarting, setGenerationStarting] = useState(false)
  const [materialExpansionSelection, setMaterialExpansionSelection] = useState<{ scope: string; items: any[] }>({ scope: '', items: [] })
  const previewSequence = useRef(0)
  const materialScopeRef = useRef('')
  const generationInFlight = useRef(false)
  const [generationScope, setGenerationScope] = useState('chapter')
  const [generationStopPoint, setGenerationStopPoint] = useState('chapter')
  const [generationCheckMode, setGenerationCheckMode] = useState('marks')
  const [generationUseCards, setGenerationUseCards] = useState(true)
  const [generationUseTechniques, setGenerationUseTechniques] = useState(true)
  const [generationUseLines, setGenerationUseLines] = useState(true)
  const [generationStartChapter, setGenerationStartChapter] = useState('')
  const [generationEndChapter, setGenerationEndChapter] = useState('')
  const [generationStartBeat, setGenerationStartBeat] = useState(0)
  const [generationEndBeat, setGenerationEndBeat] = useState('')
  const [characterInstructions, setCharacterInstructions] = useState('')
  const [styleCandidate, setStyleCandidate] = useState<any>(null)
  const styleAnalysisRequest = useRef(0)
  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<any>(null)
  const [factRevisionModal, setFactRevisionModal] = useState<{ open: boolean; fact: any | null; patch: string; reason: string }>({ open: false, fact: null, patch: '{}', reason: '' })
  const [sessionMessageId, setSessionMessageId] = useState('writer_msg_001')
  const [sessionMessageText, setSessionMessageText] = useState('')
  const [worldQuery, setWorldQuery] = useState('临港城 封锁')
  const [worldRows, setWorldRows] = useState<any[]>([])
  const [wikiHtml, setWikiHtml] = useState('<html><head><title>示例</title></head><body><table class="infobox"><tr><th>阵营</th><td>黑潮同盟</td></tr></table><h2>设定</h2><p>临港城由七港区组成。</p></body></html>')
  const [techniqueQuery, setTechniqueQuery] = useState('')
  const [selectedTechniqueCategoryId, setSelectedTechniqueCategoryId] = useState('')
  const [showIncompleteTechniques, setShowIncompleteTechniques] = useState(false)
  const [techniqueLibraryTab, setTechniqueLibraryTab] = useState('叙事技法')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [buildDraft, setBuildDraft] = useState<{ draft_id?: string; kind: string; title: string; body: string; revision: number; source?: string; status?: string; created_at?: string; accepted_scope?: string[]; accepted_target?: string; rejection_reason?: string; writing_reference_usage?: any } | null>(null)
  const [buildDraftBusy, setBuildDraftBusy] = useState(false)
  const [buildWizardStep, setBuildWizardStep] = useState('basics')
  const [buildDraftHistoryFilter, setBuildDraftHistoryFilter] = useState('all')
  const [selectedTimelineNodeId, setSelectedTimelineNodeId] = useState('build')

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
  const editorSnapshotRef = useRef({ key: '', content: '', title: '', revision: '', metaRevision: '' })

  useEffect(() => {
    const loaded = loadSettings()
    setSettings(loaded)
    setAutoApplyPatch(loaded.defaultAutoApplyPatch)
    setLlmProfileId(loaded.defaultLlmProfileId)
    applySettingsToDom(loaded)
  }, [])

  const applySettings = (next: AppSettings) => {
    setSettings(next)
    saveSettings(next)
    applySettingsToDom(next)
  }

  const { data: projects, mutate: mutateProjects } = useSWR('/api/projects', api.get)
  const { data: projectInfo } = useSWR(project ? `/api/projects/${project}` : null, api.get)
  const { data: localModelStatus } = useSWR(view === 'settings' ? '/api/config/llm/local-model' : null, api.get, { refreshInterval: 5000 })
  const { data: storySchema } = useSWR('/api/schema/cards/story', api.get)
  const { data: charSchema } = useSWR('/api/schema/cards/character', api.get)
  const { data: styleSchema } = useSWR('/api/schema/cards/style', api.get)
  const { data: techniqueSchema } = useSWR('/api/schema/cards/technique', api.get)
  const { data: techniqueCategorySchema } = useSWR('/api/schema/cards/technique_category', api.get)
  const { data: toolSkillSchema } = useSWR('/api/schema/cards/tool_skill', api.get)
  const { data: storyCards, mutate: mutateStoryCards } = useSWR(project ? `/api/projects/${project}/cards?type=story` : null, api.get)
  const { data: chars, mutate: mutateCards } = useSWR(project ? `/api/projects/${project}/cards?type=character` : null, api.get)
  const { data: styles, mutate: mutateStyles } = useSWR(project ? `/api/projects/${project}/cards?type=style` : null, api.get)
  const { data: allCards, mutate: mutateAllCards } = useSWR(project ? `/api/projects/${project}/cards` : null, api.get)
  const { data: savedWorldCards, mutate: mutateWorldCards } = useSWR(project ? `/api/projects/${project}/cards?type=world` : null, api.get)
  const { data: volumes, mutate: mutateVolumes } = useSWR(project ? `/api/projects/${project}/volumes` : null, api.get)
  const { data: draftDetails, mutate: mutateDraftDetails } = useSWR(project ? `/api/projects/${project}/drafts/details` : null, api.get)
  const { data: draft, error: draftReadError, mutate: mutateDraft } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}` : null, api.get)
  const { data: versions, mutate: mutateVersions } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/versions` : null, api.get)
  const { data: sessionMeta, mutate: mutateSessionMeta } = useSWR(project ? `/api/projects/${project}/sessions/session_001/meta` : null, api.get)
  const { data: proposals, mutate: mutateProposals } = useSWR(project ? `/api/projects/${project}/canon/proposals` : null, api.get)
  const { data: canonFacts, mutate: mutateCanonFacts } = useSWR(project ? `/api/projects/${project}/canon/facts?include_revisions=true` : null, api.get)
  const { data: techniqueCards, mutate: mutateTechniqueCards } = useSWR(project ? `/api/projects/${project}/cards?type=technique` : null, api.get)
  const { data: techniqueCategories, mutate: mutateTechniqueCategories } = useSWR(project ? `/api/projects/${project}/cards?type=technique_category` : null, api.get)
  const { data: toolSkillCards, mutate: mutateToolSkillCards } = useSWR(project ? `/api/projects/${project}/cards?type=tool_skill` : null, api.get)
  const { data: globalProfiles, mutate: mutateGlobalProfiles } = useSWR('/api/config/llm/profiles', api.get)
  useEffect(() => {
    if (!globalProfiles?.profiles?.novix_local || localStorage.getItem(SETTINGS_KEY)) return
    setSettings(current => ({ ...current, defaultLlmProfileId: 'novix_local' }))
    setLlmProfileId('novix_local')
  }, [Boolean(globalProfiles?.profiles?.novix_local)])

  const { data: globalAssignments, mutate: mutateGlobalAssignments } = useSWR('/api/config/llm/assignments', api.get)
  const { data: providersMeta } = useSWR('/api/config/llm/providers_meta', api.get)
  const { data: llmStatus, mutate: mutateLlmStatus } = useSWR('/api/config/llm/status', api.get)
  const { data: memoryPacks, mutate: mutateMemoryPacks } = useSWR(project ? `/api/projects/${project}/memory_packs?chapter_id=${selectedChapter}` : null, api.get)
  const { data: evidenceMarks, mutate: mutateEvidenceMarks } = useSWR(project ? `/api/projects/${project}/chapters/${selectedChapter}/evidence-marks` : null, api.get)
  const { data: trustReport, mutate: mutateTrustReport } = useSWR(project ? `/api/projects/${project}/trust-report?chapter_id=${selectedChapter}` : null, api.get)
  const { data: buildDraftRows, mutate: mutateBuildDraftRows } = useSWR(project ? `/api/projects/${project}/build-drafts` : null, api.get)
  const { data: jobRows, mutate: mutateJobs } = useSWR(project ? `/api/projects/${project}/jobs` : null, api.get)
  const { data: writingRuns, mutate: mutateWritingRuns } = useSWR(project ? `/api/projects/${project}/writing-runs` : null, api.get, { refreshInterval: 1200 })
  const { data: blueprints } = useSWR(project ? `/api/projects/${project}/blueprints` : null, api.get)
  const { data: selectedJobDetail, mutate: mutateSelectedJobDetail } = useSWR(project && selectedJobId ? `/api/projects/${project}/jobs/${selectedJobId}` : null, api.get)
  const { data: chapterReviewRows, mutate: mutateChapterReviews } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/reviews` : null, api.get)
  const { data: patchReviewRows, mutate: mutatePatchReviews } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/patch-reviews` : null, api.get)

  const [storyForm, setStoryForm] = useState<any>(normalizeStoryCard(null))
  const { data: overviewEvents } = useSWR(view === 'story' && storyForm?.id ? `/api/projects/${project}/events?story_card_id=${encodeURIComponent(storyForm.id)}` : null, api.get)

  const storyFormRef = useRef(storyForm)
  storyFormRef.current = storyForm
  const [characterForm, setCharacterForm] = useState<any>({ id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })
  const { lockedPaths: storyLockedPaths } = useAuthorControl(project, storyForm.id && storyForm.id !== 'story_new' ? `cards/${storyForm.id}.yaml` : undefined)
  const { lockedPaths: chapterLockedPaths } = useAuthorControl(project, selectedChapter ? `drafts/${selectedChapter}.md` : undefined)
  const { lockedPaths: characterLockedPaths } = useAuthorControl(project, characterForm.id && characterForm.id !== 'character_new' ? `cards/${characterForm.id}.yaml` : undefined)
  const [informationFocus, setInformationFocus] = useState('')
  const [sharedRelationshipFocus, setSharedRelationshipFocus] = useState('')
  const [sharedRelationshipStageFocus, setSharedRelationshipStageFocus] = useState('')
  const [characterEditorOpen, setCharacterEditorOpen] = useState(false)
  const [worldNavigationRequest, setWorldNavigationRequest] = useState<{ section: 'overview' | 'places' | 'stage'; requestId: number } | null>(null)
  const [cardSaveState, setCardSaveState] = useState<Record<string, string>>({})
  const [techniqueForm, setTechniqueForm] = useState<any>(null)
  const [categoryForm, setCategoryForm] = useState<any>(null)
  const [toolSkillForm, setToolSkillForm] = useState<any>(null)
  const cardDraftCache = useRef<Record<string, any>>({})
  const serverCardSnapshots = useRef<Record<string, string>>({})
  if (!cardDraftCache.current.__formProject) cardDraftCache.current.__formProject = project
  if (cardDraftCache.current.__formProject === project) {
    cardDraftCache.current[`${project}:character:${characterForm.id}`] = characterForm
    cardDraftCache.current[`${project}:story:${storyForm.id}`] = storyForm
    cardDraftCache.current[`${project}:characterSelection`] = characterForm.id
    cardDraftCache.current[`${project}:storySelection`] = storyForm.id
  }
  const [activeWorldCardId, setActiveWorldCardId] = useState('')
  const [activeStyleCardId, setActiveStyleCardId] = useState('')
  const [materialFocusRequest, setMaterialFocusRequest] = useState<{ id: string; requestId: number; table?: string; rowId?: string; rehearsal?: boolean; editPath?: string[]; stage_id?: string } | null>(null)
  const [selectedSceneAnchor, setSelectedSceneAnchor] = useState<{ key: string; owner_card_id: string; scene_id: string } | null>(null)
  const [directRehearsal, setDirectRehearsal] = useState<{ ownerCardId: string; sceneId: string; label: string } | null>(null)
  const [referenceTarget, setReferenceTarget] = useState('chapter')
  const [chapterReferencesOpen, setChapterReferencesOpen] = useState(false)
  const [chapterMaterialsOpen, setChapterMaterialsOpen] = useState(false)
  useEffect(() => { setChapterReferencesOpen(false); setChapterMaterialsOpen(false) }, [project, selectedChapter])
  const [cardReferenceRequest, setCardReferenceRequest] = useState<{ type: string; cardId: string; referenceId: string; requestId: number } | null>(null)
  const [chapterReferenceSelection, setChapterReferenceSelection] = useState<{ key: string; base: string[]; selected: string[] } | null>(null)
  const [chapterMaterialSelection, setChapterMaterialSelection] = useState<{ key: string; base: string[]; selected: string[] } | null>(null)
  const [profilesEditor, setProfilesEditor] = useState('')
  const [assignmentsEditor, setAssignmentsEditor] = useState('')
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string>>({})
  const [presetProfileId, setPresetProfileId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('openai_compat:deepseek')
  const [profileDraft, setProfileDraft] = useState<any>({})
  const [selectedMemoryPackId, setSelectedMemoryPackId] = useState('')
  const [versionCompareRequest, setVersionCompareRequest] = useState<{ project: string; chapterId: string; versionId: string; requestId: number } | null>(null)
  const [storyPlanningTab, setStoryPlanningTab] = useState('Overview')
  const [chapterEditorText, setChapterEditorText] = useState('')
  const [chapterTitleDraft, setChapterTitleDraft] = useState('')
  const [chapterContextDraft, setChapterContextDraft] = useState<any>(null)
  const writingPositions = useRef(new Map<string, ManuscriptPosition>())
  const recentWriting = useRef<{project: string; chapter: string} | null>(null)
  const chapterScopeKey = `${project}:${selectedChapter}`
  const analysisScope = useRef(chapterScopeKey); analysisScope.current = chapterScopeKey
  const analysisRequest = useRef(0)
  useEffect(() => { analysisRequest.current++; setAnalyzeResult(null); setAnalyzeBusy(false) }, [chapterScopeKey])
  const characterFocusKey = `${chapterScopeKey}:${storyForm.id}:${selectedSceneAnchor?.key === `${project}:${selectedChapter}:${storyForm.id}` ? `${selectedSceneAnchor.owner_card_id}:${selectedSceneAnchor.scene_id}` : ''}`
  const cachedChapterContext = cardDraftCache.current[`${chapterScopeKey}:contextDraft`]
  const hasChapterContextDraft = chapterContextDraft?.key === chapterScopeKey || Boolean(cachedChapterContext)
  const chapterContextSource = chapterContextDraft?.key === chapterScopeKey ? chapterContextDraft : cachedChapterContext || { key: chapterScopeKey, world_context: draft?.meta?.world_context, pov: draft?.meta?.pov || '', pov_character_id: draft?.meta?.pov_character_id || '', information_ids: draft?.meta?.information_ids || [], meta_revision: draft?.meta?._revision || '' }
  const chapterContext = { ...chapterContextSource, world_context: chapterContextSource.world_context || {} }
  const updateChapterContext = (patch: any) => { const next = { ...chapterContext, ...patch }; cardDraftCache.current[`${chapterScopeKey}:contextDraft`] = next; setChapterContextDraft(next) }
  const [chapterSaving, setChapterSaving] = useState(false)
  const [alignmentIdea, setAlignmentIdea] = useState('')
  const [characterDetailFocus, setCharacterDetailFocus] = useState<Record<string, Record<string, string[]>>>({})
  const [sceneDirection, setSceneDirection] = useState({ prose_strategy: '', shots: '', setting: '', motivation: '', performance: '', focus: '', atmosphere: '', perception: '', reader_feeling: '', dramatic_function: '' })
  const sceneDirectionSavedRef = useRef({ key: '', value: '' })
  const [alignmentUnderstanding, setAlignmentUnderstanding] = useState('')
  const [alignmentAgreedDraft, setAlignmentAgreedDraft] = useState('')
  const [alignmentConfirmed, setAlignmentConfirmed] = useState(false)
  const [agreementEditingKey, setAgreementEditingKey] = useState('')
  const alignmentSavedRef = useRef({ key: '', value: '', revision: '' })
  const [alignmentDiscussionInput, setAlignmentDiscussionInput] = useState('')
  const [alignmentMessages, setAlignmentMessages] = useState<any[]>([])
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
  useEffect(() => {
    if (view !== 'chapter' || chapterPane !== '正文' || (!Array.isArray(draftDetails) || !draftDetails.some((row: any) => row.chapter_id === selectedChapter))) return
    recentWriting.current = { project, chapter: selectedChapter }
    try { localStorage.setItem(`novix.lastChapter:${project}`, selectedChapter) } catch {}
  }, [view, chapterPane, project, selectedChapter, draftDetails])
  const resumeChapter = () => {
    let id = recentWriting.current?.project === project ? recentWriting.current.chapter : ''
    if (!id) { try { id = localStorage.getItem(`novix.lastChapter:${project}`) || '' } catch {} }
    return chapterRows.find((row: any) => row.chapter_id === id) || chapterRows.find((row: any) => row.chapter_id === selectedChapter) || chapterRows[0]
  }
  const openManuscript = (id: string) => {
    setSelectedChapter(id)
    setChapterPane('正文')
    setActiveActivity('explorer')
    setView('chapter')
  }
  const currentChapterMeta = (draft?.meta || chapterRows.find((x: any) => x.chapter_id === selectedChapter) || {}) as any
  const chapterReferenceKey = `${project}:${selectedChapter}`
  const savedChapterReferenceIds = chapterReferenceIds(currentChapterMeta)
  const pendingChapterReferences = chapterReferenceSelection?.key === chapterReferenceKey ? chapterReferenceSelection : null
  const selectedChapterReferenceIds = pendingChapterReferences ? mergeReferenceSelection(savedChapterReferenceIds, pendingChapterReferences.base, pendingChapterReferences.selected) : savedChapterReferenceIds
  const updateChapterReferences = (ids: string[]) => setChapterReferenceSelection({ key: chapterReferenceKey, base: pendingChapterReferences?.base || savedChapterReferenceIds, selected: ids })
  const savedChapterMaterials: string[] = Array.isArray(currentChapterMeta.material_ids) ? currentChapterMeta.material_ids : []
  const pendingChapterMaterials = chapterMaterialSelection?.key === chapterReferenceKey ? chapterMaterialSelection : null
  const selectedChapterMaterials = pendingChapterMaterials ? mergeReferenceSelection(savedChapterMaterials, pendingChapterMaterials.base, pendingChapterMaterials.selected) : savedChapterMaterials
  const updateChapterMaterials = (ids: string[]) => setChapterMaterialSelection({ key: chapterReferenceKey, base: pendingChapterMaterials?.base || savedChapterMaterials, selected: ids })
  const currentVolume = volumeRows.find((v: any) => v.id === (currentChapterMeta?.volume_id || 'volume_default')) || volumeRows[0]
  const activeStoryPayload = normalizeStoryCard(storyForm).payload || {}
  const writingChapterRows = [...chapterRows, ...(Array.isArray(activeStoryPayload.chapter_plan) ? activeStoryPayload.chapter_plan : []).filter((row: any) => (row.chapter_id || row.chapter) && !chapterRows.some((chapter: any) => chapter.chapter_id === (row.chapter_id || row.chapter))).map((row: any) => ({ ...row, chapter_id: row.chapter_id || row.chapter }))]
  const writingBlueprint = (Array.isArray(blueprints) ? blueprints : []).find((row: any) => row.id === selectedBlueprintId) || (Array.isArray(blueprints) ? blueprints[0] : null)
  const writingBeatRows = (writingBlueprint?.scene_plan || []).flatMap((scene: any) => (scene.beats?.length ? scene.beats : [scene.purpose || '当前场景']).map((beat: any) => typeof beat === 'string' ? beat : beat.summary || beat.title || '未命名桥段'))
  const activeWritingRun = (Array.isArray(writingRuns) ? writingRuns : []).find((run: any) => ['running', 'pausing'].includes(run.status))
  const isChapterGenerating = activeWritingRun?.units?.[activeWritingRun.next_index]?.chapter_id === selectedChapter
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
    const stages = Array.from(new Set(rows.map((mark: any) => mark?.agent_trace?.stage).filter(Boolean)))
    return `${supported}/${rows.length} 已证实${stages.length ? ` · ${stages.join('/')}` : ''}`
  }
  const meaningfulRows = (rows: any[] | undefined, keys: string[]) => (Array.isArray(rows) ? rows : []).filter((row: any) => keys.some((key) => String(row?.[key] || '').trim()))
  const importantSceneRows = meaningfulRows(activeStoryPayload.important_scenes, ['scene', 'purpose', 'chapter'])
  const openLineRows = meaningfulRows(activeStoryPayload.open_line, ['event', 'goal', 'conflict', 'result'])
  const hiddenLineRows = meaningfulRows(activeStoryPayload.hidden_line, ['truth', 'visible_hint', 'hidden_meaning', 'reveal_timing'])
  const foreshadowingRows = meaningfulRows(activeStoryPayload.foreshadowings, ['content', 'surface_signal', 'true_meaning', 'payoff'])
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
      push('Please input profile id before applying preset', 'error')
      return
    }
    if (!selectedPreset) {
      push('Preset metadata unavailable', 'error')
      return
    }
    try {
      const parsed = JSON.parse(profilesEditor || '{}')
      const next = {
        ...(parsed || {}),
        [profileId]: { ...(selectedPreset.defaults || {}) },
      }
      setProfilesEditor(JSON.stringify(next, null, 2))
      push(`Preset applied to profile: ${profileId}`)
    } catch {
      push('Profiles JSON is invalid, please fix editor first', 'error')
    }
  }

  const saveProfileDraft = async () => {
    const profileId = (presetProfileId || '').trim()
    if (!profileId) {
      push('请先填写这个模型的配置名称。', 'error')
      return
    }
    const required = selectedPreset?.required_fields || ['provider', 'model']
    const existing = globalProfiles?.profiles?.[profileId] || {}
    const contextWindow = profileDraft.context_window ?? profileDraft.context_window_tokens ?? profileDraft.max_context_tokens
    if (contextWindow !== undefined && contextWindow !== '' && (!Number.isSafeInteger(Number(contextWindow)) || Number(contextWindow) <= 0)) { push('模型上下文容量请填写正整数；不清楚时可以留空。', 'error'); return }
    const normalized = {
      provider: String(profileDraft.provider || selectedPreset?.defaults?.provider || '').trim(),
      model: String(profileDraft.model || '').trim(),
      base_url: String(profileDraft.base_url || '').trim(),
      api_key: String(profileDraft.api_key || existing.api_key || ''),
      timeout_s: Number(profileDraft.timeout_s || 60),
      stream: Boolean(profileDraft.stream ?? selectedPreset?.supports_stream ?? true),
      ...(contextWindow !== undefined && contextWindow !== '' ? { context_window: Number(contextWindow) } : {}),
    }
    const missing = required.filter((field) => !String((normalized as any)[field] || '').trim())
    if (missing.length) {
      push(`请补充：${missing.map(fieldLabel).join('、')}`, 'error')
      return
    }
    try {
      await api.post('/api/config/llm/profiles', { mode: 'upsert', id: profileId, profile: normalized })
      const next = { ...(globalProfiles?.profiles || {}), [profileId]: normalized }
      setProfilesEditor(JSON.stringify(next, null, 2))
      await mutateGlobalProfiles()
      await mutateLlmStatus()
      push(`模型已保存：${profileId}`)
    } catch {
      push('模型保存失败，请检查填写内容。', 'error')
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
    push(`Loaded profile: ${profileId}`)
  }

  const deleteProfileDraft = async (profileId: string) => {
    if (profileId === 'mock_default') {
      push('mock_default cannot be deleted', 'error')
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
      push(`Profile deleted: ${profileId}`)
    } catch {
      push('Profile delete failed', 'error')
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
      push(`${module} assigned to ${profileId}`)
    } catch {
      push('Agent assignment save failed', 'error')
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
    const cache = cardDraftCache.current
    const rows = Array.isArray(storyCards) ? storyCards : []
    if (cache.__formProject !== project) {
      const savedStory = cache[`${project}:story:${cache[`${project}:storySelection`]}`]
      const savedCharacter = cache[`${project}:character:${cache[`${project}:characterSelection`]}`]
      cache.__formProject = project
      setStoryForm(savedStory || normalizeStoryCard(rows[0]))
      setCharacterForm(savedCharacter || (Array.isArray(chars) && chars[0]) || { id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })
      cache.__characterLoadingFor = !savedCharacter && !Array.isArray(chars) ? project : undefined
      return
    }
    if (cache.__characterLoadingFor === project && Array.isArray(chars)) {
      cache.__characterLoadingFor = undefined
      if (chars.length && characterForm.id === 'character_new' && !characterForm.title && !Object.keys(characterForm.payload || {}).length) setCharacterForm(cache[`${project}:character:${chars[0].id}`] || chars[0])
    }
    if (!rows.length) return
    const currentId = storyForm?.id
    const newDraftHasContent = currentId === 'story_new' && JSON.stringify(storyForm) !== JSON.stringify(normalizeStoryCard(null))
    if (!newDraftHasContent && (!currentId || currentId === 'story_new' || !rows.some((x: any) => x.id === currentId))) {
      setStoryForm(cache[`${project}:story:${rows[0].id}`] || normalizeStoryCard(rows[0]))
    }
  }, [project, storyCards, chars])

  useEffect(() => {
    if (!Array.isArray(allCards)) return
    for (const card of allCards) {
      const key = `${project}:${card.type}:${card.id}`
      const incoming = card.type === 'story' ? normalizeStoryCard(card) : card
      const before = serverCardSnapshots.current[key]
      const cached = cardDraftCache.current[key]
      if (before && cached && JSON.stringify(cached) === before) {
        cardDraftCache.current[key] = incoming
        if (cardDraftCache.current.__formProject === project && card.type === 'story') setStoryForm((current: any) => current.id === card.id && JSON.stringify(current) === before ? incoming : current)
        if (cardDraftCache.current.__formProject === project && card.type === 'character') setCharacterForm((current: any) => current.id === card.id && JSON.stringify(current) === before ? incoming : current)
      }
      serverCardSnapshots.current[key] = JSON.stringify(incoming)
    }
  }, [allCards, project])

  if (editorSnapshotRef.current.key === chapterScopeKey) cardDraftCache.current[`${chapterScopeKey}:manuscriptDraft`] = { text: chapterEditorText, title: chapterTitleDraft, baseline: { ...editorSnapshotRef.current } }
  useEffect(() => {
    const key = `${project}:${selectedChapter}`
    const previous = editorSnapshotRef.current
    const content = draft?.content || ''
    const title = draft?.meta?.chapter_title || draft?.meta?.title || draft?.content?.match(/^#\s+(.+)$/m)?.[1] || chapterRows.find((row: any) => row.chapter_id === selectedChapter)?.chapter_title || '未命名章节'
    const cached = cardDraftCache.current[`${key}:manuscriptDraft`]
    if (previous.key !== key && cached) { setChapterEditorText(cached.text); setChapterTitleDraft(cached.title); editorSnapshotRef.current = cached.baseline; setChapterContextDraft(cardDraftCache.current[`${key}:contextDraft`] || null); return }
    const clean = previous.key !== key || chapterEditorText === previous.content && chapterTitleDraft === previous.title
    if (clean) { setChapterEditorText(content); setChapterTitleDraft(title); editorSnapshotRef.current = { key, content, title, revision: draft?.revision || '', metaRevision: draft?.meta?._revision || '' } }
  }, [draft, selectedChapter, project])

  useEffect(() => {
    setStyleCandidate(null); styleAnalysisRequest.current++; setCharacterEditorOpen(false); setWorldNavigationRequest(null); setSharedRelationshipFocus(''); setSharedRelationshipStageFocus('')
    setGenerationStartChapter('')
    setMaterialFocusRequest(null)
    setCardReferenceRequest(null)
    setSelectedTechniqueCategoryId('')
    setGenerationEndChapter('')
    setGenerationStartBeat(0)
    setGenerationEndBeat('')
  }, [project])

  useEffect(() => {
    const alignment = draft?.meta?.writing_alignment || {}
    const alignmentKey = `${project}:${selectedChapter}`
    const previousAlignment = alignmentSavedRef.current
    const nextAlignment = [alignment.idea || '', alignment.understanding || '', alignment.agreed_draft || '', Boolean(alignment.confirmed), Array.isArray(alignment.messages) ? alignment.messages : []]
    const localAlignment = [alignmentIdea, alignmentUnderstanding, alignmentAgreedDraft, alignmentConfirmed, alignmentMessages]
    if (alignmentKey !== previousAlignment.key || JSON.stringify(localAlignment) === previousAlignment.value) {
      setAlignmentIdea(nextAlignment[0] as string)
      setAlignmentUnderstanding(nextAlignment[1] as string)
      setAlignmentAgreedDraft(nextAlignment[2] as string)
      setAlignmentConfirmed(nextAlignment[3] as boolean)
      setAlignmentMessages(nextAlignment[4] as any[])
    }
    if (alignmentKey !== previousAlignment.key) { setAlignmentDiscussionInput(''); setAgreementEditingKey('') }
    alignmentSavedRef.current = { key: alignmentKey, value: JSON.stringify(nextAlignment), revision: alignmentKey !== previousAlignment.key || JSON.stringify(localAlignment) === previousAlignment.value ? draft?.meta?._revision || '' : previousAlignment.revision }
    const scene = { prose_strategy: '', shots: '', setting: '', motivation: '', performance: '', focus: '', atmosphere: '', perception: '', reader_feeling: '', dramatic_function: '', ...(alignment.scene_direction || {}) }
    const key = `${project}:${selectedChapter}`
    const previous = sceneDirectionSavedRef.current
    if (key !== previous.key || JSON.stringify(sceneDirection) === previous.value) setSceneDirection(scene)
    sceneDirectionSavedRef.current = { key, value: JSON.stringify(scene) }
  }, [draft, selectedChapter, project])

  const alignmentEditor = alignmentSavedRef.current.key === chapterScopeKey ? { idea: alignmentIdea, understanding: alignmentUnderstanding, agreed_draft: alignmentAgreedDraft, confirmed: alignmentConfirmed, messages: alignmentMessages, scene_direction: sceneDirection, base_revision: alignmentSavedRef.current.revision } : null
  const savedAlignment = draft?.meta?.writing_alignment || {}
  const alignmentLocal = useDraftRecovery(`${chapterScopeKey}:alignment`, alignmentEditor, JSON.stringify({ idea: savedAlignment.idea || '', understanding: savedAlignment.understanding || '', agreed_draft: savedAlignment.agreed_draft || '', confirmed: Boolean(savedAlignment.confirmed), messages: savedAlignment.messages || [], scene_direction: { prose_strategy: '', shots: '', setting: '', motivation: '', performance: '', focus: '', atmosphere: '', perception: '', reader_feeling: '', dramatic_function: '', ...(savedAlignment.scene_direction || {}) }, base_revision: draft?.meta?._revision || '' }), (value) => { setAlignmentIdea(value.idea || ''); setAlignmentUnderstanding(value.understanding || ''); setAlignmentAgreedDraft(value.agreed_draft || ''); setAlignmentConfirmed(Boolean(value.confirmed)); setAlignmentMessages(value.messages || []); if (value.scene_direction) setSceneDirection(value.scene_direction); alignmentSavedRef.current.revision = value.base_revision || ''; setAgreementEditingKey(chapterScopeKey) })

  const storyLocal = useDraftRecovery(`${project}:story:${storyForm.id}`, cardDraftCache.current.__formProject === project ? storyForm : null, JSON.stringify((Array.isArray(storyCards) ? storyCards : []).find((card: any) => card.id === storyForm.id) ? normalizeStoryCard((storyCards as any[]).find((card: any) => card.id === storyForm.id)) : normalizeStoryCard(null)), setStoryForm)
  const characterLocal = useDraftRecovery(`${project}:character:${characterForm.id}`, cardDraftCache.current.__formProject === project ? characterForm : null, JSON.stringify((Array.isArray(chars) ? chars : []).find((card: any) => card.id === characterForm.id) || { id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} }), setCharacterForm)
  const chapterLocal = useDraftRecovery(`${project}:chapter:${selectedChapter}`, editorSnapshotRef.current.key === `${project}:${selectedChapter}` ? { content: chapterEditorText, title: chapterTitleDraft, base_revision: editorSnapshotRef.current.revision, meta_revision: editorSnapshotRef.current.metaRevision, context: hasChapterContextDraft ? chapterContext : undefined } : null, JSON.stringify({ content: draft?.content || '', title: draft?.meta?.chapter_title || draft?.meta?.title || chapterTitleDraft, base_revision: draft?.revision || '', meta_revision: draft?.meta?._revision || '', ...(hasChapterContextDraft ? { context: { key: chapterScopeKey, world_context: draft?.meta?.world_context || {}, pov: draft?.meta?.pov || '', pov_character_id: draft?.meta?.pov_character_id || '', information_ids: draft?.meta?.information_ids || [], meta_revision: draft?.meta?._revision || '' } } : {}) }), (value) => { setChapterEditorText(value.content || ''); setChapterTitleDraft(value.title || ''); editorSnapshotRef.current.revision = value.base_revision || ''; editorSnapshotRef.current.metaRevision = value.meta_revision || ''; if (value.context) setChapterContextDraft({ ...value.context, key: chapterScopeKey }) })

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
      push('Command Palette data load failed, showing local commands only', 'error')
      paletteCacheRef.current.loadedFor = project
    }
  }

  const refreshPaletteData = async () => {
    paletteCacheRef.current = { storyCards: [], characters: [], worldCards: [], styleCards: [], outlines: [], blueprints: [], chapters: [], proposals: [], techniques: [], techniqueCategories: [], toolSkills: [] }
    await lazyLoadPaletteData(true)
    push('Palette data refreshed')
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
        else warnings.push(`Ignored --${k} (schema path ${path} missing)`)
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
        else warnings.push(`Ignored --lock ${lk}`)
      })
      const setMaybe = (k: string, path: string, value: any) => {
        if (value === undefined || value === null || value === '') return
        if (schemaHasPath(schema, path)) setByPath(card, path, value)
        else warnings.push(`Ignored --${k} (schema path ${path} missing)`)
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
    if (!parsed) return { ok: false, message: 'Not a create command' }
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
          _revision: put1.meta?._revision || '',
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
      return { ok: false, message: 'Create request failed' }
    }
  }


  const resolveTechniqueByQuery = (q: string) => {
    const rows = (paletteCacheRef.current.techniques || []).filter((card: any) => !isIncompleteReference(card)) as any[]
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
    if (!selectedChapter || !chapterRows.some((row: any) => row.chapter_id === selectedChapter)) return { ok: false, message: '请先打开或创建一个章节。' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    if (meta.detail) return { ok: false, message: '章节资料读取失败，请重试。' }
    const pinned = Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques : []
    const row: any = { technique_id: tech.id, intensity: intensity || 'med' }
    if (weight !== undefined) row.weight = weight
    if (notes) row.notes = notes
    const next = [row, ...pinned.filter((x: any) => x.technique_id !== tech.id)]
    const result = await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_techniques: next })
    if (result.detail) return { ok: false, message: '参考保存失败，请重试。' }
    mutateDraft()
    return { ok: true, message: `已为本章选用：${referenceLabel(tech)}` }
  }

  const unpinTechniqueFromChapter = async (tech: any) => {
    if (!selectedChapter || !chapterRows.some((row: any) => row.chapter_id === selectedChapter)) return { ok: false, message: '请先打开或创建一个章节。' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    if (meta.detail) return { ok: false, message: '章节资料读取失败，请重试。' }
    const pinned = Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques : []
    const next = pinned.filter((x: any) => x.technique_id !== tech.id)
    const result = await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_techniques: next })
    if (result.detail) return { ok: false, message: '参考保存失败，请重试。' }
    mutateDraft()
    return { ok: true, message: `已移除本章参考：${referenceLabel(tech)}` }
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
    return { ok: true, message: `Pinned category "${cat.title || cat.id}" (${row.intensity})` }
  }

  const unpinCategoryFromChapter = async (cat: any) => {
    if (!selectedChapter) return { ok: false, message: '请先打开一个章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_technique_categories) ? meta.pinned_technique_categories : []
    const next = pinned.filter((x: any) => x.category_id !== cat.id)
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_technique_categories: next })
    mutateDraft()
    return { ok: true, message: `Unpinned category "${cat.title || cat.id}"` }
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
    if (!headTokens.length) return { mode: isPin ? 'pin_cat' : 'unpin_cat', error: 'Missing category name' }
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
    if (!headTokens.length) return { mode: isPin ? 'pin' : 'unpin', error: 'Missing technique name' }
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
          title: 'List pinned categories',
          subtitle: selectedChapter || 'open chapter first',
          group: 'Actions',
          icon: List,
          run: async () => {
            if (!selectedChapter) {
              push('请先打开一个章节', 'error')
              return
            }
            const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
            push(`Pinned categories: ${JSON.stringify(meta?.pinned_technique_categories || [])}`)
          },
        },
      }
    }

    if (catParsed.mode === 'pin_cat' || catParsed.mode === 'unpin_cat') {
      if (catParsed.error) return { error: catParsed.error }
      const hit = resolveCategoryByQuery(catParsed.name || '')
      if (!hit) return { error: `Category not found: ${catParsed.name}` }
      const actionTitle = catParsed.mode === 'pin_cat' ? `Pin category ${hit.title} ${catParsed.intensity || 'med'}` : `Unpin category ${hit.title}`
      return {
        item: {
          id: `${catParsed.mode}-${hit.id}`,
          title: actionTitle,
          subtitle: selectedChapter || 'open chapter first',
          group: 'Actions',
          icon: Sparkles,
          run: async () => {
            const out = catParsed.mode === 'pin_cat'
              ? await pinCategoryToChapter(hit, catParsed.intensity || 'med', catParsed.weight, catParsed.note)
              : await unpinCategoryFromChapter(hit)
            if (out.ok) push(out.message)
            else push(out.message || 'Command failed', 'error')
          },
        },
      }
    }

    const pinParsed = parsePinCommand(query)
    if (pinParsed.mode === 'list') {
      return {
        item: {
          id: 'cmd-list-pinned-techniques',
          title: 'List pinned techniques',
          subtitle: selectedChapter || 'open chapter first',
          group: 'Actions',
          icon: List,
          run: async () => {
            if (!selectedChapter) {
              push('请先打开一个章节', 'error')
              return
            }
            const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
            push(`Pinned: ${JSON.stringify(meta?.pinned_techniques || [])}`)
          },
        },
      }
    }

    if (pinParsed.mode === 'pin' || pinParsed.mode === 'unpin') {
      if (pinParsed.error) return { error: pinParsed.error }
      const hit = resolveTechniqueByQuery(pinParsed.name || '')
      if (!hit) return { error: `Technique not found: ${pinParsed.name}` }
      const actionTitle = pinParsed.mode === 'pin' ? `Pin technique ${hit.title} ${pinParsed.intensity || 'med'}` : `Unpin technique ${hit.title}`
      return {
        item: {
          id: `${pinParsed.mode}-tech-${hit.id}`,
          title: actionTitle,
          subtitle: selectedChapter || 'open chapter first',
          group: 'Actions',
          icon: Sparkles,
          run: async () => {
            const out = pinParsed.mode === 'pin'
              ? await pinTechniqueToChapter(hit, pinParsed.intensity || 'med', pinParsed.weight, pinParsed.note)
              : await unpinTechniqueFromChapter(hit)
            if (out.ok) push(out.message)
            else push(out.message || 'Command failed', 'error')
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
        title: `Create ${parsed.type}: ${parsed.title || '(title required)'}`,
        subtitle: parsed.title ? 'Press Enter to create' : 'Missing title',
        group: 'Create',
        icon: Sparkles,
        keywords: [parsed.type, parsed.title, ...parsed.tags, ...parsed.locks, ...createHelpText()],
        payload: { kind: 'create', type: parsed.type },
        run: async () => {
          const out = await runCreate(query)
          if (!out.ok) {
            push(out.message || 'Create failed', 'error')
            return
          }
          push(`Created ${out.label}`)
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
      const r = await api.upload(`/api/projects/${project}/uploads`, fd)
      const assetId = r.asset_id || r?.items?.[0]?.asset_id
      if (assetId) setActiveStyleAssets((x) => [...x, assetId])
      push('作者原文样本已上传。')
    } catch (error) {
      push(error instanceof Error ? error.message : '样本上传未完成。', 'error')
    }
  }

  const analyzeStyle = async () => {
    const number = ++styleAnalysisRequest.current
    const styleId = cardDraftCache.current[`${project}:style:selected`] || (Array.isArray(styles) ? styles[0]?.id : '') || 'style_001'
    const held = cardDraftCache.current[`${project}:style:${styleId}`]
    const snapshot = held ? JSON.stringify(held) : ''
    try {
      const result = await api.post(`/api/projects/${project}/style/analyze`, { style_card_id: styleId, asset_ids: activeStyleAssets, mode: 'fast' })
      if (number !== styleAnalysisRequest.current || cardDraftCache.current.__formProject !== project) return
      setStyleCandidate({ ...result, formSnapshot: snapshot })
      push('样本分析候选已生成，请在文风卡中预览确认；原卡尚未改变。')
    } catch (error) { push(error instanceof Error ? error.message : '文风分析未完成，原文风保留。', 'error') }
  }

  const refreshWritingOutputs = () => {
    if (chapterEditorText === (draft?.content || '')) void mutateDraft()
    void mutateDraftDetails()
    void mutateVolumes()
    void mutateVersions()
    void mutateJobs()
    void mutateChapterReviews()
    void mutatePatchReviews()
    void mutateEvidenceMarks()
    void mutateTrustReport()
    void mutateMemoryPacks()
  }

  const generationMaterialScope = `${project}:${selectedChapter}:${storyForm.id}`
  materialScopeRef.current = generationMaterialScope
  useEffect(() => { previewSequence.current++; setPendingWriteJob(null); setMaterialPreview(null); setMaterialPreviewBusy(false); setMaterialPreviewError('') }, [generationMaterialScope])
  const materialExpansions = materialExpansionSelection.scope === generationMaterialScope ? materialExpansionSelection.items : []
  const buildGenerationRequest = (maxTokens: number) => ({
    chapter_id: selectedChapter,
    blueprint_id: writingBlueprint?.id || 'blueprint_001', scene_index: 0,
    scope: generationScope, stop_point: generationStopPoint,
    start_chapter: generationStartChapter || selectedChapter, end_chapter: generationEndChapter,
    start_beat: generationStartBeat, end_beat: generationEndBeat === '' ? undefined : Number(generationEndBeat),
    llm_profile_id: useAgentAssignments ? undefined : llmProfileId, auto_apply_patch: Boolean(autoApplyPatch),
    generation_control: {
      story_card_id: storyForm?.id,
      scene_ref: selectedSceneAnchor?.key === `${project}:${selectedChapter}:${storyForm?.id}` ? { owner_card_id: selectedSceneAnchor.owner_card_id, scene_id: selectedSceneAnchor.scene_id } : undefined,
      scope: generationScope, stop_point: generationStopPoint, check_mode: generationCheckMode,
      include_cards: generationUseCards, include_techniques: generationUseTechniques, include_lines: generationUseLines,
      writing_alignment: { ...buildWritingAlignmentPayload({ confirmed: alignmentConfirmed }), updated_at: undefined }, scene_direction: sceneDirection,
      character_detail_focus: characterDetailFocus[characterFocusKey] || {}, material_expansions: materialExpansions,
    },
    constraints: { max_tokens: maxTokens },
  })
  const generationProblem = () => !draft || draftReadError ? '请先重新读取当前正文，再开始生成。'
    : chapterEditorText !== (draft?.content || '') ? '请先保存正文，再开始生成。'
    : pendingChapterReferences || pendingChapterMaterials || hasChapterContextDraft && (JSON.stringify(chapterContext.world_context || {}) !== JSON.stringify(draft?.meta?.world_context || {}) || chapterContext.pov !== (draft?.meta?.pov || '') || chapterContext.pov_character_id !== (draft?.meta?.pov_character_id || '') || JSON.stringify(chapterContext.information_ids || []) !== JSON.stringify(draft?.meta?.information_ids || [])) ? '请先保存正文、世界 / 视角选择与关联参考，再核对生成材料。'
    : activeWritingRun ? '已有任务正在生成，可以先暂停或结束它。' : ''
  const previewGenerationMaterials = async (maxTokens: number) => {
    const number = ++previewSequence.current
    setMaterialPreviewBusy(true); setMaterialPreviewError('')
    try {
      const problem = generationProblem(); if (problem) throw new Error(problem)
      const body = buildGenerationRequest(maxTokens)
      const result = await api.post(`/api/projects/${project}/generation-materials/preview`, body)
      if (number === previewSequence.current) setMaterialPreview({ scope: generationMaterialScope, requestKey: JSON.stringify(body), data: result })
    } catch (cause) { if (number === previewSequence.current) { setMaterialPreview(null); setMaterialPreviewError(cause instanceof Error ? cause.message : '材料核对未完成，请重试。') } }
    finally { if (number === previewSequence.current) setMaterialPreviewBusy(false) }
  }
  const runJob = async (maxTokens = 2400, _range: { start: number; end: number } | null = null) => {
    const problem = generationProblem()
    if (problem) { setMaterialPreviewError(problem); return }
    const body = buildGenerationRequest(maxTokens)
    if (materialPreview?.scope !== generationMaterialScope || materialPreview?.requestKey !== JSON.stringify(body) || !materialPreview.data?.ready || materialPreview.invalidated) { setMaterialPreviewError('材料尚未核对，或生成范围与重点已改变。请重新核对材料后再生成。'); return }
    if (generationInFlight.current) return
    generationInFlight.current = true
    setGenerationStarting(true); setMaterialPreviewError('')
    try {
      const result = await api.post(`/api/projects/${project}/writing-runs`, { ...body, generation_control: { ...body.generation_control, material_preview_fingerprint: materialPreview.data.fingerprint } })
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '请检查生成范围和模型设置。')
      if (!result.run_id || result.status === 'failed') throw new Error(result.message || '生成未能开始，尚未创建有效任务。请核对材料后重试。')
      if (materialScopeRef.current !== generationMaterialScope) return
      setPendingWriteJob(null); setEvents([]); setSelectedOpIds([])
      await mutateWritingRuns(); await mutateJobs()
      push('已开始生成，可在生成进度中暂停或继续。')
    } catch (cause) {
      if (materialScopeRef.current !== generationMaterialScope) return
      setMaterialPreviewError(cause instanceof Error ? cause.message : '生成未能开始，请重试。')
      if ((cause as any)?.status === 409) setMaterialPreview((current: any) => current ? { ...current, invalidated: true } : current)
      if ((cause as any)?.detail?.overflow) setMaterialPreview((current: any) => current ? { ...current, data: { ...current.data, ...(cause as any).detail, ready: false } } : current)
    } finally { generationInFlight.current = false; setGenerationStarting(false) }
  }
  const requestRunJob = (maxTokens = 2400, range: { start: number; end: number } | null = null, label = '生成本章') => {
    setPendingWriteJob({ maxTokens, range, label }); setMaterialPreview(null)
    void previewGenerationMaterials(maxTokens)
  }

  const analyzeChapter = async () => {
    const heldScope = chapterScopeKey, number = ++analysisRequest.current
    try {
      setAnalyzeBusy(true); setAnalyzeResult(null)
      const res = await api.post(`/api/projects/${project}/analyze/${selectedChapter}`, { reason: 'ui_button' })
      if (analysisScope.current !== heldScope || number !== analysisRequest.current) return
      setAnalyzeResult({ ...res, project, chapter_id: selectedChapter })
      void mutateCanonFacts(); void mutateProposals()
      push(res.extraction_coverage?.message || `已整理 ${res.new_facts_count || 0} 条事实记录，请核对依据并确认。`)
    } catch (cause) {
      if (analysisScope.current === heldScope && number === analysisRequest.current) push(cause instanceof Error ? cause.message : '事实整理未完成，请重试。', 'error')
    } finally {
      if (analysisScope.current === heldScope && number === analysisRequest.current) setAnalyzeBusy(false)
    }
  }

  const analyzeMarks = async () => {
    try {
      if (!await saveChapterDraft()) return
      const res = await api.post(`/api/projects/${project}/chapters/${selectedChapter}/analyze-marks`, {})
      await mutateEvidenceMarks()
      await mutateTrustReport()
      push(`Marks analyzed: ${res?.marks?.length || 0}`)
    } catch {
      push('Analyze marks failed', 'error')
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
    push(`Volume created: ${volume.title}`)
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
    push(`Chapter created: ${title}`)
  }

  const saveChapterDraft = async () => {
    if (!selectedChapter) return false
    if (!draft || draftReadError) { push('正文尚未成功读取，当前编辑保留。请先重新读取。', 'error'); return false }
    const heldScope = chapterScopeKey
    const recoveryBefore = { content: chapterEditorText, title: chapterTitleDraft, base_revision: editorSnapshotRef.current.revision, meta_revision: editorSnapshotRef.current.metaRevision, context: hasChapterContextDraft ? chapterContext : undefined }
    try {
      setChapterSaving(true)
      const body = {
        base_revision: editorSnapshotRef.current.key === `${project}:${selectedChapter}` ? editorSnapshotRef.current.revision : '',
        meta_revision: hasChapterContextDraft ? chapterContext.meta_revision : editorSnapshotRef.current.key === `${project}:${selectedChapter}` ? editorSnapshotRef.current.metaRevision : '',
        ...(hasChapterContextDraft ? { world_context: chapterContext.world_context || {}, pov: chapterContext.pov || '', pov_character_id: chapterContext.pov_character_id || '', information_ids: chapterContext.information_ids || [] } : {}),
        content: chapterEditorText,
        title: chapterTitleDraft || selectedChapter,
        chapter_title: chapterTitleDraft || selectedChapter,
        chapter_status: currentChapterMeta?.chapter_status || 'draft',
        volume_id: currentChapterMeta?.volume_id || currentVolume?.id || 'volume_default',
        order_index: currentChapterMeta?.order_index ?? chapterRows.findIndex((x: any) => x.chapter_id === selectedChapter) + 1,
      }
      const saved = await api.put(`/api/projects/${project}/drafts/${selectedChapter}`, body)
      if (saved.detail) throw new Error('正文保存失败')
      if (editorSnapshotRef.current.key !== heldScope) return false
      if (editorSnapshotRef.current.key === `${project}:${selectedChapter}`) { editorSnapshotRef.current = { ...editorSnapshotRef.current, content: body.content, title: body.chapter_title, revision: saved.revision || '', metaRevision: saved.meta?._revision || '' }; alignmentSavedRef.current.revision = saved.meta?._revision || alignmentSavedRef.current.revision }
      if (hasChapterContextDraft) { cardDraftCache.current[`${heldScope}:contextDraft`] = { ...chapterContext, meta_revision: saved.meta?._revision || '' }; setChapterContextDraft((current: any) => current?.key === heldScope ? { ...current, meta_revision: saved.meta?._revision || '' } : current) }
      chapterLocal.markSaved(recoveryBefore, { ...recoveryBefore, base_revision: saved.revision || '', meta_revision: saved.meta?._revision || '', ...(hasChapterContextDraft ? { context: { ...chapterContext, meta_revision: saved.meta?._revision || '' } } : {}) })
      if (pendingChapterReferences || pendingChapterMaterials) {
        const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
        if (meta.detail) throw new Error('章节资料读取失败')
        const next = { ...meta }
        let referenceIds: string[] = []
        let materialIds: string[] = []
        if (pendingChapterReferences) {
          referenceIds = mergeReferenceSelection(chapterReferenceIds(meta), pendingChapterReferences.base, pendingChapterReferences.selected)
          const tools = new Set([...(Array.isArray(toolSkillCards) ? toolSkillCards.map((card: any) => card.id) : []), ...(meta.tool_skill_ids || [])])
          const pinned = Array.isArray(meta.pinned_techniques) ? meta.pinned_techniques : []
          next.pinned_techniques = referenceIds.filter((id) => !tools.has(id)).map((id) => pinned.find((row: any) => row.technique_id === id) || { technique_id: id, intensity: 'med' })
          next.tool_skill_ids = referenceIds.filter((id) => tools.has(id))
        }
        if (pendingChapterMaterials) {
          materialIds = mergeReferenceSelection(Array.isArray(meta.material_ids) ? meta.material_ids : [], pendingChapterMaterials.base, pendingChapterMaterials.selected)
          next.material_ids = materialIds
        }
        const result = await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, next)
        if (result.detail) throw new Error('关联资料保存失败')
        if (editorSnapshotRef.current.key !== heldScope) return false
        editorSnapshotRef.current.metaRevision = result._revision || editorSnapshotRef.current.metaRevision
        alignmentSavedRef.current.revision = result._revision || alignmentSavedRef.current.revision
        if (hasChapterContextDraft) { cardDraftCache.current[`${heldScope}:contextDraft`] = { ...chapterContext, meta_revision: result._revision || '' }; setChapterContextDraft((current: any) => current?.key === heldScope ? { ...current, meta_revision: result._revision || '' } : current) }
        if (pendingChapterReferences) {
          const selection = pendingChapterReferences
          setChapterReferenceSelection((latest) => latest === selection ? null : latest?.key === selection.key ? { key: latest.key, base: referenceIds, selected: mergeReferenceSelection(referenceIds, selection.selected, latest.selected) } : latest)
        }
        if (pendingChapterMaterials) {
          const selection = pendingChapterMaterials
          setChapterMaterialSelection((latest) => latest === selection ? null : latest?.key === selection.key ? { key: latest.key, base: materialIds, selected: mergeReferenceSelection(materialIds, selection.selected, latest.selected) } : latest)
        }
      }
      await mutateDraft()
      await mutateDraftDetails()
      await mutateVolumes()
      await mutateChapterReviews()
      refreshSharedMaterials()
      push('已保存提交时的正文与参考，之后的编辑请再次保存。')
      return true
    } catch (error) {
      push(error instanceof Error ? error.message : '保存未完成，编辑已保留。', 'error')
      return false
    } finally {
      if (editorSnapshotRef.current.key === heldScope) setChapterSaving(false)
    }
  }

  const techniqueTitleById = (techniqueId: string) => {
    const tech = (Array.isArray(techniqueCards) ? techniqueCards : []).find((x: any) => x.id === techniqueId)
    return referenceLabel(tech, techniqueId)
  }

  const buildWritingAlignmentPayload = (overrides: Record<string, any> = {}) => ({
    idea: overrides.idea ?? alignmentIdea,
    understanding: overrides.understanding ?? alignmentUnderstanding,
    agreed_draft: overrides.agreed_draft ?? alignmentAgreedDraft,
    confirmed: overrides.confirmed ?? alignmentConfirmed,
    messages: overrides.messages ?? alignmentMessages,
    scene_direction: overrides.scene_direction ?? sceneDirection,
    updated_at: new Date().toISOString(),
  })

  const saveWritingAlignment = async (overrides: Record<string, any> = {}) => {
    if (!selectedChapter) return false
    const heldScope = chapterScopeKey
    const submittedAlignment = alignmentEditor
    const submittedChapter = { content: chapterEditorText, title: chapterTitleDraft, base_revision: editorSnapshotRef.current.revision, meta_revision: editorSnapshotRef.current.metaRevision, context: hasChapterContextDraft ? chapterContext : undefined }
    const bodyWasSaved = chapterEditorText === editorSnapshotRef.current.content && chapterTitleDraft === editorSnapshotRef.current.title
    const submittedPayload = buildWritingAlignmentPayload(overrides)
    try {
      const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
      if (editorSnapshotRef.current.key !== heldScope) return false
      if (meta.detail) throw new Error('写法读取失败')
      const result = await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, {
        ...meta,
        _revision: hasChapterContextDraft ? chapterContext.meta_revision : alignmentSavedRef.current.revision,
        ...(hasChapterContextDraft ? { world_context: chapterContext.world_context || {}, pov: chapterContext.pov || '', pov_character_id: chapterContext.pov_character_id || '', information_ids: chapterContext.information_ids || [] } : {}),
        writing_alignment: submittedPayload,
      })
      if (result.detail) throw new Error('写法保存失败')
      if (editorSnapshotRef.current.key !== heldScope) return false
      const savedMetaRevision = result._revision || editorSnapshotRef.current.metaRevision
      if (bodyWasSaved) chapterLocal.markSaved(submittedChapter, { ...submittedChapter, meta_revision: savedMetaRevision, context: hasChapterContextDraft ? { ...chapterContext, meta_revision: savedMetaRevision } : undefined })
      const pendingContext = cardDraftCache.current[`${heldScope}:contextDraft`]
      if (hasChapterContextDraft || pendingContext?.key === heldScope) { cardDraftCache.current[`${heldScope}:contextDraft`] = { ...(pendingContext?.key === heldScope ? pendingContext : chapterContext), meta_revision: savedMetaRevision }; setChapterContextDraft((current: any) => current?.key === heldScope ? { ...current, meta_revision: savedMetaRevision } : current) }
      alignmentLocal.markSaved(submittedAlignment, { ...submittedAlignment, ...Object.fromEntries(Object.entries(submittedPayload).filter(([key]) => key !== 'updated_at')), base_revision: result._revision || '' })
      alignmentSavedRef.current.revision = result._revision || alignmentSavedRef.current.revision
      editorSnapshotRef.current.metaRevision = result._revision || editorSnapshotRef.current.metaRevision
      await mutateDraft()
      await mutateDraftDetails()
      push('本章写法已保存')
      return true
    } catch (error) {
      push(error instanceof Error ? error.message : '本章写法保存失败，编辑保留。', 'error')
      return false
    }
  }

  const currentChapterBrief = () => buildChapterBrief({
    cards: Array.isArray(allCards) ? allCards : [], storyId: storyForm?.id,
    chapterId: selectedChapter, chapterTitle: chapterTitleDraft || currentChapterMeta?.chapter_title || '当前章节',
    idea: alignmentIdea, direction: sceneDirection,
  })
  const effectiveChapterAgreement = () => chapterAgreement(alignmentAgreedDraft, alignmentUnderstanding, alignmentConfirmed, currentChapterBrief().text, agreementEditingKey === `${project}:${selectedChapter}`)
  const updateSceneDirection = (update: (previous: typeof sceneDirection) => typeof sceneDirection) => {
    setSceneDirection(update)
    setAlignmentConfirmed(false)
  }
  const showChapterMaterials = () => {
    const panel = document.getElementById('chapter-materials') as HTMLDetailsElement | null
    if (panel) { panel.open = true; panel.scrollIntoView({ block: 'start' }) }
  }
  const generateAlignmentUnderstanding = async () => {
    const brief = currentChapterBrief().text
    setAgreementEditingKey('')
    setAlignmentUnderstanding(brief)
    setAlignmentAgreedDraft(brief)
    setAlignmentConfirmed(false)
  }

  const sendAlignmentMessage = async () => {
    const text = alignmentDiscussionInput.trim()
    if (!text) return
    const authorMessage = { role: 'author', text, created_at: new Date().toISOString() }
    const aiMessage = {
      role: 'ai',
      text: `我会把这个修正纳入共识：${text}。如果这会改变人物动机、脉络或技法重点，请在中间的“作者同意这样写”里确认最终说法。`,
      created_at: new Date().toISOString(),
    }
    const nextMessages = [...alignmentMessages, authorMessage, aiMessage].slice(-12)
    setAlignmentMessages(nextMessages)
    setAlignmentDiscussionInput('')
    setAlignmentConfirmed(false)
    await saveWritingAlignment({ messages: nextMessages, confirmed: false })
  }

  const mergeDiscussionIntoAgreement = async () => {
    const recent = alignmentMessages.slice(-6).map((msg: any) => `${msg.role === 'author' ? '作者' : '整理记录'}：${msg.text}`).join('\n')
    const next = [
      effectiveChapterAgreement().trim(),
      recent ? `\n讨论补充：\n${recent}` : '',
    ].filter(Boolean).join('\n')
    setAlignmentAgreedDraft(next)
    setAlignmentConfirmed(false)
    await saveWritingAlignment({ agreed_draft: next, confirmed: false })
  }

  const confirmWritingAlignment = async () => {
    const agreed = effectiveChapterAgreement().trim()
    if (!agreed) { push('先安排本章情节，或补一句这章发生什么变化。', 'error'); return }
    const targetKey = `${project}:${selectedChapter}`
    const understanding = currentChapterBrief().text
    if (!await saveWritingAlignment({ understanding, agreed_draft: agreed, confirmed: true })) return
    if (editorSnapshotRef.current.key !== targetKey) return
    setAgreementEditingKey('')
    setAlignmentUnderstanding(understanding)
    setAlignmentAgreedDraft(agreed)
    setAlignmentConfirmed(true)
  }

  const requestRunJobWithAgreement = async () => {
    if (!alignmentConfirmed) { push('请先确认本章写法，再生成正文。', 'error'); return }
    if (await saveWritingAlignment({ confirmed: true })) requestRunJob(2400, null, '按确认写法生成正文')
  }

  const updateChapterReview = async (review: any, status: string) => {
    if (!review?.review_id) return
    try {
      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/reviews/${review.review_id}`, { status })
      await mutateChapterReviews()
      await mutateDraft()
      await mutateDraftDetails()
      push(status === 'accepted' ? 'AI 草稿已确认' : 'AI 草稿已拒绝')
    } catch {
      push('Review update failed', 'error')
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
      push('Patch applied')
    } catch {
      push('Patch apply failed', 'error')
    }
  }

  const rejectPatchReview = async () => {
    const reviewId = reviewPatch?.patch_review_id || reviewPatch?.review_id
    if (!reviewId) return
    try {
      await api.put(`/api/projects/${project}/drafts/${selectedChapter}/patch-reviews/${reviewId}`, { status: 'rejected', accepted_op_ids: [] })
      await mutatePatchReviews()
      push('Patch rejected')
    } catch {
      push('Patch reject failed', 'error')
    }
  }

  const toggleToolReference = async (toolId: string) => {
    if (!selectedChapter || !chapterRows.some((row: any) => row.chapter_id === selectedChapter)) { push('请先打开或创建一个章节。', 'error'); return }
    try {
      const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
      if (meta.detail) throw new Error('章节资料暂时无法读取，请重试。')
      const ids: string[] = Array.isArray(meta.tool_skill_ids) ? meta.tool_skill_ids : []
      const next = ids.includes(toolId) ? ids.filter((id) => id !== toolId) : [...ids, toolId]
      const result = await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, tool_skill_ids: next })
      if (result.detail) throw new Error('引用保存失败，请重试。')
      await mutateDraft()
      await mutateCache(`/api/projects/${project}/knowledge-graph?chapter_id=${encodeURIComponent(selectedChapter)}`)
      push(next.includes(toolId) ? '本章已引用这项写作工具。' : '已取消本章引用。')
    } catch (err) { push(err instanceof Error ? err.message : '引用保存失败，请重试。', 'error') }
  }

  const { data: currentStoryEvents } = useSWR(project && storyForm.id ? `/api/projects/${project}/events?story_card_id=${encodeURIComponent(storyForm.id)}` : null, api.get)
  useEffect(() => {
    if (!materialFocusRequest || view !== 'story' || materialFocusRequest.id !== storyForm.id || !materialFocusRequest.table || !materialFocusRequest.rowId) return
    const row = document.getElementById(`story-row-${storyForm.id}-${materialFocusRequest.table}-${materialFocusRequest.rowId}`)
    for (let parent = row?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
    row?.scrollIntoView({ block: 'center' }); (row?.querySelector('input,textarea,select') as HTMLElement | null)?.focus()
  }, [view, storyPlanningTab, storyForm.id, materialFocusRequest])
  const reviseCanonFact = async () => {
    if (!factRevisionModal.fact?.id) return
    if (!factRevisionModal.fact._revision) { push('请重新读取这条事实后再修订，当前编辑保留。', 'error'); void mutateCanonFacts(); return }
    try {
      const patch = JSON.parse(factRevisionModal.patch || '{}')
      const result = await api.post(`/api/projects/${project}/canon/facts/${factRevisionModal.fact.id}/revise`, { patch, reason: factRevisionModal.reason, base_revision: factRevisionModal.fact._revision })
      if (cardDraftCache.current.__formProject !== project) return
      mutateCanonFacts()
      push('事实修订已追加，原依据与历史保留。')
      setFactRevisionModal((current) => current.fact?.id !== factRevisionModal.fact.id ? current : current.patch === factRevisionModal.patch && current.reason === factRevisionModal.reason ? { open: false, fact: null, patch: '{}', reason: '' } : { ...current, fact: { ...current.fact, _revision: result._revision || current.fact._revision } })
    } catch (cause) {
      if (cardDraftCache.current.__formProject !== project) return
      push(cause instanceof Error ? cause.message : '事实未修订，请核对内容与当前版本；编辑保留。', 'error')
    }
  }

  const compareVersion = (versionId: string) => {
    setVersionCompareRequest({ project, chapterId: selectedChapter, versionId, requestId: Date.now() })
    adjustMaterialInput('chapter-branch-tools')
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

  const refreshSharedMaterials = () => {
    void mutateAllCards()
    void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /cards|materials|backlinks|knowledge-graph|change-suggestions|scene-rehearsals/.test(key))
  }
  const openMaterial: OpenMaterial = async (target) => {
    try {
    if (target.eventOrigin) setEventOrigin(target.eventOrigin)
    if (target.type === 'event-world') { setWorldNavigationRequest({section:'stage',requestId:Date.now()}); setActiveActivity('cards'); setView('world'); return }
    const id = target.id || target.source_id
    if (!id) return
    if (target.type === 'information' || String(id).startsWith('information_')) { setInformationFocus(id); setActiveActivity('canon'); setView('canon'); return }
    if (target.type === 'relationship') { setSharedRelationshipFocus(id); setSharedRelationshipStageFocus(target.stage_id || ''); setActiveActivity('cards'); setView('relationships'); return }
    if (target.type === 'chapter' || chapterRows.some((chapter: any) => chapter.chapter_id === id)) {
      if (Number.isFinite(target.start)) { const source = id === selectedChapter ? draft : await api.get(`/api/projects/${project}/drafts/${encodeURIComponent(id)}`); if (cardDraftCache.current.__formProject !== project) return; const chars = Array.from(String(source?.content || '')); const line = (offset: number) => chars.slice(0, offset).join('').split('\n').length; setHighlightRange({ start: line(target.start), end: line(target.end ?? target.start) }) }
      setSelectedChapter(id); setActiveActivity('explorer'); setView('chapter'); return
    }
    const parts = id.split(':')
    const cardId = target.card_id || parts[0]
    let card = (Array.isArray(allCards) ? allCards : []).find((row: any) => row.id === cardId)
    if (!card && typeof target.source === 'string' && /cards\/.+\.json/.test(target.source)) { setSelectedBlueprintId(target.source.match(/cards\/([^/.]+)\.json/)?.[1] || ''); setView('context'); return }
    if (!card && ['fact', 'canon'].includes(target.type || '')) { setActiveActivity('canon'); setView('canon'); return }
    if (!card) {
      const result = await api.get(`/api/projects/${project}/cards/${encodeURIComponent(cardId)}`)
      if (result.detail) { push('原资料暂时无法打开，请刷新资料后重试。', 'error'); return }
      if (cardDraftCache.current.__formProject !== project) return
      card = result
    }
    if (card.type === 'story') {
      setStoryForm(cardDraftCache.current[`${project}:story:${card.id}`] || normalizeStoryCard(card))
      setMaterialFocusRequest({ id: card.id, requestId: Date.now(), table: parts[1], rowId: parts[2], editPath: target.editPath })
      setStoryPlanningTab(parts[1] === 'foreshadowings' ? 'Foreshadowings' : ['open_line', 'hidden_line', 'important_scenes'].includes(parts[1]) ? 'Lines' : parts[1] === 'chapter_plan' ? 'Chapter Matrix' : 'Overview')
      setActiveActivity('story'); setView('story')
    } else if (card.type === 'character') {
      setPersonPane(target.stage_id || target.eventOrigin ? '经历' : '概况'); setMaterialFocusRequest({ id: card.id, requestId: Date.now(), editPath: target.editPath, stage_id: target.stage_id })
      setCharacterEditorOpen(true); setCharacterForm(cardDraftCache.current[`${project}:character:${card.id}`] || card); setActiveActivity('cards'); setView('characters')
    } else if (['world', 'world_rule', 'lore', 'worldview', 'style'].includes(card.type)) {
      setWorldNavigationRequest(null); setMaterialFocusRequest({ id: card.id, requestId: Date.now(), editPath: target.editPath, stage_id: target.stage_id }); setActiveActivity('cards'); setView(card.type === 'style' ? 'style' : 'world')
    } else if (card.type === 'outline' && card.payload?.planning_worksheet) {
      const story = (Array.isArray(allCards) ? allCards : []).find((row: any) => row.id === card.payload.story_card_id)
      if (story) setStoryForm(cardDraftCache.current[`${project}:story:${story.id}`] || normalizeStoryCard(story))
      const table = target.editPath?.[1] || parts[1]
      const index = target.editPath?.[2] || parts[2]
      const row = (card.payload[table] || []).find?.((entry: any) => entry.id === index) || card.payload[table]?.[Number(index)]
      setMaterialFocusRequest({ id: card.id, requestId: Date.now(), table, rowId: row?.id || (index && /^\d+$/.test(index) ? `${table}_${Number(index) + 1}` : index), editPath: target.editPath })
      setActiveActivity('planning'); setView('planning')
    } else if (card.type === 'technique' || card.type === 'tool_skill') {
      setTechniqueLibraryTab(card.type === 'technique' ? '叙事技法' : '写作工具')
      if (card.type === 'technique') setTechniqueForm(card); else setToolSkillForm(card)
      setActiveActivity('techniques'); setView('techniques')
    } else { setView('context') }
    } catch (cause) { push(cause instanceof Error ? cause.message : '原资料暂时无法打开，当前编辑仍保留。', 'error') }
  }
  const isSettingDirty = (id: string) => {
    const saved = (Array.isArray(allCards) ? allCards : []).find((card: any) => card.id === id)
    if (!saved) return false
    const cached = cardDraftCache.current[`${project}:${saved.type}:${id}`] || (saved.payload?.planning_worksheet ? cardDraftCache.current[`${project}:${saved.payload.story_card_id}:planningDraft`]?.card : null)
    if (!cached) return false
    const normalize = (card: any) => JSON.stringify({ ...(card.type === 'story' ? normalizeStoryCard(card) : card), updated_at: undefined })
    return normalize(cached) !== normalize(saved)
  }
  const openSceneRehearsal = async (entry: any) => {
    let owner = (Array.isArray(allCards) ? allCards : []).find((card: any) => card.id === entry.owner_card_id)
    if (!owner) {
      try { owner = await api.get(`/api/projects/${project}/cards/${encodeURIComponent(entry.owner_card_id)}`) } catch { push('原情节暂时无法读取，请稍后重试。', 'error'); return }
    }
    if (!owner?.id || owner.detail) { push('原情节暂时无法打开，请先核对来源。', 'error'); return }
    if (isSettingDirty(owner.id)) { push('原情节还有未保存修改。请先保存工作表或故事，再打开场景安排。', 'error'); return }
    setDirectRehearsal({ ownerCardId: owner.id, sceneId: entry.scene_id, label: entry.label || '本章场景' })
    setActiveActivity('explorer'); setView('scene-rehearsal')
  }
  const mergeDirectRehearsal = (result: any) => {
    if (!directRehearsal || !result.saved) return
    const canonicalOwner = result.owner_card_id || directRehearsal.ownerCardId
    const canonicalScene = result.scene_id || directRehearsal.sceneId
    const owner = (Array.isArray(allCards) ? allCards : []).find((card: any) => card.id === canonicalOwner)
    const cached = cardDraftCache.current[`${project}:story:${canonicalOwner}`] || owner
    const merge = (card: any) => mergeConfirmedRehearsal(card, canonicalScene, canonicalScene, result.saved, result.updated_at, result._revision)
    if (cached) cardDraftCache.current[`${project}:story:${canonicalOwner}`] = merge(cached)
    setStoryForm((current: any) => current.id === canonicalOwner ? merge(current) : current)
    if (owner?.payload?.planning_worksheet) { const key = `${project}:${owner.payload.story_card_id}:planningDraft`; const held = cardDraftCache.current[key]; if (held?.card) cardDraftCache.current[key] = { ...held, card: merge(held.card), savedSnapshot: JSON.stringify(merge(JSON.parse(held.savedSnapshot || JSON.stringify(held.card)))) } }
    refreshSharedMaterials()
  }

  const saveCurrentCharacter = async () => {
    const snapshot = JSON.stringify(characterForm)
    const id = characterForm.id && characterForm.id !== 'character_new' ? characterForm.id : `character_${Date.now()}`
    const key = `${project}:${characterForm.id}`
    const body = { ...characterForm, id, title: characterForm.payload?.name?.trim() || characterForm.payload?.identity?.trim() || characterForm.title || '未命名人物', type: 'character', payload: { name: '', identity: '', ...characterForm.payload } }
    setCardSaveState((value) => ({ ...value, [key]: '保存中…' }))
    try {
      const result = await api.put(`/api/projects/${project}/cards/${id}`, body)
      const saved = cardAfterSave(characterForm, body, result, snapshot)
      const reconcile = (current: any) => cardAfterSave(current, body, result, snapshot)
      const cacheKey = `${project}:character:${id}`
      cardDraftCache.current[cacheKey] = reconcile(cardDraftCache.current[cacheKey] || cardDraftCache.current[`${project}:character:${characterForm.id}`] || characterForm)
      if (cardDraftCache.current.__formProject === project) setCharacterForm(reconcile)
      characterLocal.markSaved(characterForm, saved)
      void mutateCards((rows: any) => Array.isArray(rows) && rows.some((card: any) => card.id === id) ? rows.map((card: any) => card.id === id ? saved : card) : [...(Array.isArray(rows) ? rows : []), saved], { revalidate: false })
      setCardSaveState((value) => ({ ...value, [key]: '已保存', [`${project}:${id}`]: '已保存' })); refreshSharedMaterials()
      push(result.change_suggestions?.error ? `人物已保存；${result.change_suggestions.error}` : '人物已保存，初始资料与共享引用保留。')
    } catch (error) { const message = error instanceof Error ? error.message : '保存未完成，编辑保留。'; setCardSaveState((value) => ({ ...value, [key]: `保存失败：${message}` })); push(message, 'error') }
  }

  const commandItems = useMemo<CommandItem[]>(() => {
    const cache = paletteCacheRef.current

    const staticNav: CommandItem[] = [
      { id: 'nav-story', title: 'Go to Story', subtitle: 'Open story control card', group: 'Navigate', icon: BookOpen, run: () => { setActiveActivity('story'); setView('story') } },
      { id: 'nav-characters', title: 'Go to Characters', subtitle: 'Open characters panel', group: 'Navigate', icon: UserRound, run: () => { setActiveActivity('cards'); setView('characters') } },
      { id: 'nav-settings', title: 'Settings', subtitle: 'Open settings panel', group: 'Navigate', icon: Settings, run: () => { setActiveActivity('settings'); setView('settings') } },
      { id: 'nav-chapter', title: 'Go to Chapter Editor', group: 'Navigate', icon: FilePenLine, run: () => { setActiveActivity('explorer'); setView('chapter') } },
      { id: 'nav-canon', title: 'Go to Canon / Proposals', group: 'Navigate', icon: Sparkles, run: () => { setActiveActivity('canon'); setView('canon') } },
      { id: 'nav-world', title: 'Go to World panel', group: 'Navigate', icon: Globe, run: () => { setActiveActivity('cards'); setView('world') } },
      { id: 'nav-techniques', title: '本章写法参考', group: 'Navigate', icon: Sparkles, run: () => { setActiveActivity('explorer'); setView('chapter'); setChapterReferencesOpen(true) } },
    ]

    const navData: CommandItem[] = [
      ...cache.storyCards.map((s: any) => ({
        id: `story-${s.id}`,
        title: `Open Story: ${s.title || s.id}`,
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
        title: `Open Character: ${c.title || c.id}`,
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
        title: `Open Blueprint: ${bp.title || bp.id}`,
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
        title: `Open Chapter: ${ch.chapter_title || ch.title || chapterId}`,
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
        title: `Open World Card: ${w.title || w.id}`,
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
      ...(cache.toolSkills || []).filter((card: any) => !isIncompleteReference(card)).map((t: any) => ({
        id: `tool-skill-${t.id}`,
        title: `Open Tool Skill: ${t.title || t.id}`,
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
        title: `Open Proposal: ${p.proposal_id || p.id}`,
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
        title: 'Toggle Theme: Light',
        group: 'Actions',
        icon: Sun,
        run: () => applySettings({ ...settings, theme: settings.theme === 'light' ? 'dark' : 'light' }),
      },
      {
        id: 'act-theme-system',
        title: 'Toggle Theme: System',
        group: 'Actions',
        icon: Monitor,
        run: () => applySettings({ ...settings, theme: 'system' }),
      },
      {
        id: 'act-density',
        title: `Toggle Density (${settings.density})`,
        group: 'Actions',
        icon: List,
        run: () => applySettings({ ...settings, density: settings.density === 'comfortable' ? 'compact' : 'comfortable' }),
      },
      {
        id: 'act-auto-apply',
        title: `Toggle Auto-Apply Patch (${autoApplyPatch ? 'On' : 'Off'})`,
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
        title: 'Refresh Data',
        subtitle: 'Clear palette cache and refetch',
        group: 'Actions',
        icon: RefreshCw,
        run: refreshPaletteData,
      },
      {
        id: 'act-save-chapter',
        title: 'Save Chapter',
        subtitle: selectedChapter,
        group: 'Actions',
        icon: FilePenLine,
        run: saveChapterDraft,
      },
      {
        id: 'act-analyze-chapter',
        title: 'Analyze Chapter',
        subtitle: selectedChapter,
        group: 'Actions',
        icon: Sparkles,
        run: analyzeChapter,
      },
    ]

    return [...staticNav, ...navData, ...actionItems, ...baseHelpCommands(() => {})]
  }, [project, settings, autoApplyPatch, selectedChapter, chapterEditorText, chapterTitleDraft, currentChapterMeta, currentVolume, volumeRows, chapterRows, analyzeBusy, chapterReferenceSelection, chapterMaterialSelection, toolSkillCards])

  const filteredChapterRows = chapterRows.filter((ch: any) => {
    const q = sideSearch.trim().toLowerCase()
    if (!q) return true
    return [ch.chapter_id, ch.chapter_title, ch.title, ch.volume_id].some((x) => String(x || '').toLowerCase().includes(q))
  })

  useEffect(() => { setChapterPane('正文') }, [project, selectedChapter])
  useEffect(() => { setEventOrigin(null); setPersonPane('概况') }, [project])
  const enterStoryEvent = (owner: string, scene: string) => {
    setEventOrigin(null)
    setMaterialFocusRequest({ id: owner, table: 'important_scenes', rowId: scene, requestId: Date.now() })
    setActiveActivity('planning')
    setView('planning')
  }
  const sidebarActivity = view === 'relationships' ? 'characters' : ['characters', 'world'].includes(view) ? view : activeActivity
  const left = (
    <div>
      <div className='sidebar-project'><label htmlFor='sidebar-project'>当前作品</label><Select id='sidebar-project' value={project} onChange={(e) => setProject(e.target.value)}>{(projects || []).map((row: any) => <option key={row.id} value={row.id}>{row.title || '未命名作品'}</option>)}</Select></div>
      <nav className='sidebar-nav' aria-label='写作工作区'>
        {[['story', '作品总览', BookOpen], ['planning', '故事安排', Table2], ['characters', '人物', UserRound], ['world', '世界', Globe], ['explorer', '卷与章', FilePenLine]].map(([id, label, Icon]: any) => <button key={id} className={`sidebar-nav-item ${sidebarActivity === id ? 'is-current' : ''}`} aria-current={sidebarActivity === id ? 'page' : undefined} onClick={async () => {
          setEventOrigin(null)
          if (id === 'story') setStoryPlanningTab('Overview')
          if (id === 'characters') { setPersonPane('概况'); setCharacterEditorOpen(false) }
          setActiveActivity(id)
          if (id === 'world') setWorldNavigationRequest({ section: 'overview', requestId: Date.now() })
          if (id === 'explorer') {
            const rows = Array.isArray(draftDetails) ? draftDetails : await api.get(`/api/projects/${project}/drafts/details`)
            if (!editorSnapshotRef.current.key.startsWith(`${project}:`)) return
            if (!Array.isArray(rows)) { push('章节读取失败，请重试。', 'error'); return }
            if (rows.length) { if (!rows.some((row: any) => row.chapter_id === selectedChapter)) setSelectedChapter(rows[0].chapter_id); setView('chapter') }
            else setView('projects')
          } else setView(({ story: 'story', planning: 'planning', characters: 'characters', world: 'world', techniques: 'techniques', canon: 'canon', settings: 'settings' } as Record<string, string>)[id])
        }}><Icon size={17} strokeWidth={1.7} /><span>{label}</span></button>)}
      </nav>
      {activeActivity === 'explorer' && <section className='sidebar-context' aria-label='章节目录'>
        <div className='sidebar-context-heading'><span>章节目录</span><button className='sidebar-context-link w-auto text-xs' onClick={() => createChapterInVolume(currentVolume?.id)}>新建章</button></div>
        <Input aria-label='查找章节' className='text-xs' placeholder='查找章节…' value={sideSearch} onChange={(e) => setSideSearch(e.target.value)} />
        {volumeRows.map((volume: any) => { const chapters = filteredChapterRows.filter((chapter: any) => (chapter.volume_id || 'volume_default') === volume.id).sort((a: any, b: any) => Number(a.order_index || 0) - Number(b.order_index || 0)); return <details key={volume.id} open className='sidebar-volume'><summary>{volume.title || '未命名卷'} <span className='ml-1 opacity-70'>{chapters.length}</span></summary><div>{chapters.map((chapter: any) => <button key={chapter.chapter_id} className={`sidebar-chapter ${selectedChapter === chapter.chapter_id && view === 'chapter' ? 'is-current' : ''}`} onClick={() => { setSelectedChapter(chapter.chapter_id); setView('chapter'); setActiveActivity('explorer') }}><FilePenLine size={13} className='mt-1 shrink-0 text-muted' strokeWidth={1.5} /><span><span className='sidebar-chapter-title'>{chapter.chapter_title || chapter.title || '未命名章节'}</span><span className='sidebar-chapter-status'>{chapter.chapter_status === 'done' ? '已完成' : chapter.chapter_status === 'revising' ? '修改中' : chapter.chapter_status === 'planned' ? '已规划' : '草稿'}</span></span></button>)}</div><button className='sidebar-context-link pl-5' onClick={() => createChapterInVolume(volume.id)}>在本卷新建章节</button></details> })}
        {!volumeRows.length && <p className='my-3 text-xs text-muted'>暂无章节</p>}
        <button className='sidebar-context-link' onClick={createVolume}>新建卷</button>
      </section>}
      <footer className='sidebar-footer'><details><summary>作品工具</summary><div className='sidebar-context-links'>{[['projects','项目管理'],['techniques','技法库'],['canon','事实与关系'],['wiki','素材库'],['context','生成材料'],['sessions','对话'],['export','导出'],['settings','模型设置']].map(([page,label]) => <button className='sidebar-context-link' key={page} onClick={() => setView(page)}>{label}</button>)}</div></details></footer>
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
    <div className='workspace-breadcrumb'>
      <span className='breadcrumb-title'>{projectInfo?.title || (Array.isArray(projects) ? projects : []).find((row: any) => row.id === project)?.title || '当前作品'}</span><span className='breadcrumb-separator'>/</span><span className='breadcrumb-section'>{view === 'story' ? '作品总览' : view === 'planning' ? '故事安排' : view === 'chapter' ? chapterTitleDraft || currentChapterMeta?.chapter_title || '当前章节' : NAV_ITEMS.find((row) => row.id === view)?.label || '工作区'}</span>
      <CommandPalette items={commandItems} onOpen={() => lazyLoadPaletteData(false)} resolveCreateCommand={resolveCreateCommand} />
    </div>
  )

  const center = useMemo(() => {
    const extractionCoverage = chapterExtractionCoverage(project, selectedChapter, analyzeResult, draft, chapterEditorText)
    let factPatch: any = null
    try { const parsed = JSON.parse(factRevisionModal.patch || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) factPatch = parsed } catch {}
    const factSubject = (Array.isArray(allCards) ? allCards : []).find((card: any) => card.id === factRevisionModal.fact?.entity_id)
    const updateFactPatch = (change: any) => setFactRevisionModal((current) => { try { return { ...current, patch: JSON.stringify({ ...JSON.parse(current.patch || '{}'), ...change }, null, 2) } } catch { return current } })
    if (cardDraftCache.current.__formProject !== project) return <p role='status' className='text-sm text-muted'>正在读取当前作品资料…</p>
    const updateStoryRoot = (key: string, value: any) => {
      if (pointerLocked(storyLockedPaths, `/${key}`)) { push('这项已锁定，请使用指定范围修改。', 'error'); return }
      setStoryForm((prev: any) => normalizeStoryCard({ ...prev, [key]: value, payload: { ...prev.payload, ...(key === 'title' && prev[key] !== value ? { framework_confirmed: false } : {}) } }))
    }

    const updateStoryPayload = (key: string, value: any) => {
      if (pointerLocked(storyLockedPaths, `/payload/${key}`)) { push('这项已锁定，请使用指定范围修改。', 'error'); return }
      setStoryForm((prev: any) => normalizeStoryCard({ ...prev, payload: { ...(prev?.payload || {}), [key]: value, framework_confirmed: false } }))
    }

    const updateStoryArrayItem = (section: string, index: number, key: string, value: any) => {
      const currentRow = storyForm.payload?.[section]?.[index]; if (pointerLocked(storyLockedPaths, `/payload/${section}/${currentRow?.id ? `@${currentRow.id}` : index}/${key}`)) { push('这项已锁定，请使用指定范围修改。', 'error'); return }
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        const rows = Array.isArray(payload[section]) ? [...payload[section]] : []
        rows[index] = { ...(rows[index] || {}), [key]: value, ...(section === 'foreshadowings' && !rows[index]?.id ? { id: `foreshadow_${crypto.randomUUID().slice(0, 8)}` } : {}) }
        return normalizeStoryCard({ ...prev, payload: { ...payload, [section]: rows } })
      })
    }

    const addStoryArrayItem = (section: string, template: any) => {
      setStoryForm((prev: any) => {
        const payload = { ...(prev?.payload || {}) }
        const next = { ...cloneJson(template), ...(section === 'foreshadowings' ? { id: `foreshadow_${crypto.randomUUID().slice(0, 8)}` } : {}) }
        const rows = Array.isArray(payload[section]) ? [...payload[section], next] : [next]
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
      const before = JSON.stringify(storyForm)
      const id = current.id && current.id !== 'story_new' ? current.id : `story_${Date.now()}`
      const body = { ...current, id, type: 'story' }
      setCardSaveState((current) => ({ ...current, [`${project}:${storyForm.id}`]: '保存中…', [`${project}:${id}`]: '保存中…' }))
      try {
        const result = await api.put(`/api/projects/${project}/cards/${id}`, body)
        if (result.detail) throw new Error('故事保存失败，请检查后重试。')
        const editedDuringSave = JSON.stringify(storyFormRef.current) !== before
        setStoryForm((current: any) => cardDraftCache.current.__formProject === project ? cardAfterSave(current, normalizeStoryCard(body), result, before) : current)
        storyLocal.markSaved(storyForm, cardAfterSave(storyForm, normalizeStoryCard(body), result, before))
        setCardSaveState((current) => ({ ...current, [`${project}:${id}`]: editedDuringSave ? '提交稿已保存，仍有后续编辑' : '已保存' }))
        mutateStoryCards()
        refreshSharedMaterials()
        await lazyLoadPaletteData(true)
        push(result.change_suggestions?.error ? `故事已保存；${result.change_suggestions.error}` : editedDuringSave ? '已保存提交时的故事，之后的编辑请再次保存。' : '故事设定与写作参考已保存')
      } catch (error) { const message = error instanceof Error ? error.message : '故事保存失败，编辑保留。'; setCardSaveState((current) => ({ ...current, [`${project}:${storyForm.id}`]: `保存失败：${message}`, [`${project}:${id}`]: `保存失败：${message}` })); push(message, 'error') }
    }

    const confirmStoryFramework = async () => {
      const current = normalizeStoryCard(storyForm)
      if (!current.title.trim() || !current.payload.logline.trim()) { push('先补充作品名和一句话故事，再确认框架。', 'error'); return }
      const before = JSON.stringify(storyForm)
      const id = current.id && current.id !== 'story_new' ? current.id : `story_${Date.now()}`
      const body = { ...current, id, payload: { ...current.payload, framework_confirmed: true, framework_confirmed_at: new Date().toISOString() } }
      try {
        const result = await api.put(`/api/projects/${project}/cards/${id}`, body)
        if (result.detail) throw new Error('框架保存失败，请重试。')
        if (JSON.stringify(storyFormRef.current) !== before) { push('你又修改了框架，已保留编辑。请确认最新内容后再继续。', 'error'); return }
        setStoryForm((current: any) => cardDraftCache.current.__formProject === project ? cardAfterSave(current, body, result, before) : current)
        await mutateStoryCards()
        refreshSharedMaterials()
        setStoryPlanningTab('Lines')
        push(result.change_suggestions?.error ? `框架已确认；${result.change_suggestions.error}` : '故事框架已确认，可以安排场景和章节。')
      } catch (err) { push(err instanceof Error ? err.message : '框架保存失败，请重试。', 'error') }
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
        writing_reference_usage: rec.writing_reference_usage,
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
      if (buildDraft && buildDraft.draft_id === rec.draft_id) setBuildDraft({ ...buildDraft, status: 'rejected' })
      mutateBuildDraftRows()
      push('草案已拒绝')
    }

    const restoreBuildDraft = async (rec: any) => {
      if (!rec?.draft_id) return
      await api.put(`/api/projects/${project}/build-drafts/${rec.draft_id}`, {
        status: 'pending',
        accepted_target: '',
        accepted_scope: [],
        rejection_reason: '',
      })
      if (buildDraft && buildDraft.draft_id === rec.draft_id) {
        setBuildDraft({ ...buildDraft, status: 'pending', accepted_target: '', accepted_scope: [], rejection_reason: '' })
      }
      mutateBuildDraftRows()
      push('草案已恢复为待确认')
    }

    const generateBuildDraft = async (kind: string) => {
      const nextRevision = (buildDraft?.kind === kind ? buildDraft.revision + 1 : 1)
      setBuildDraftBusy(true)
      try {
        const rec = await api.post(`/api/projects/${project}/build-drafts`, {
          kind,
          generate_with_ai: true,
          llm_profile_id: useAgentAssignments ? undefined : llmProfileId,
          instructions: kind === 'character_seed' ? characterInstructions : '',
          writing_references: kind === 'character_seed' ? characterForm?.payload?.writing_references || [] : storyForm?.payload?.writing_references || [],
          revision: nextRevision,
          selected_chapter: selectedChapter,
          story_card: normalizeStoryCard(storyForm),
        })
        if (cardDraftCache.current.__formProject !== project) return
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
          writing_reference_usage: rec.writing_reference_usage,
        })
        push(`草案已生成：${rec.title}`)
        mutateBuildDraftRows()
        return
      } catch (err) {
        push(err instanceof Error ? err.message : '生成失败，请检查模型配置后重试。', 'error')
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
      rows[index] = { ...(rows[index] || {}), [key]: value, ...(section === 'foreshadowings' && !rows[index]?.id ? { id: `foreshadow_${crypto.randomUUID().slice(0, 8)}` } : {}) }
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
        payload.framework_confirmed = false
        payload.source_draft_id = buildDraft.draft_id || payload.source_draft_id
        payload.source_step = buildDraft.kind
        payload.confirmation_status = 'partially_accepted'
        payload.confirmed_by = 'author'
        payload.author_modified = true
        return normalizeStoryCard({ ...prev, payload })
      })
      await markBuildDraftPartiallyAccepted(keys)
      push('已局部写入 Story 表单，请保存故事卡')
    }

    const acceptBuildDraft = async () => {
      if (!buildDraft) return
      let parsed: any
      try {
        parsed = JSON.parse(buildDraft.body || '{}')
      } catch {
        push('草案 JSON 无法解析，请先修正', 'error')
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
            confirmation_status: 'accepted',
            confirmed_by: 'author',
            author_modified: true,
          },
        }
        let result: any
        try { result = await api.put(`/api/projects/${project}/cards/${id}`, body) } catch (error) { push(error instanceof Error ? error.message : '人物未保存，候选保留。', 'error'); return }
        if (cardDraftCache.current.__formProject !== project) return
        if (buildDraft.draft_id) await api.put(`/api/projects/${project}/build-drafts/${buildDraft.draft_id}`, { body: buildDraft.body, status: 'accepted', accepted_target: id, accepted_scope: ['all'] })
        setBuildDraft({ ...buildDraft, status: 'accepted', accepted_scope: ['all'] })
        setCharacterForm({ ...body, _revision: result._revision || '', updated_at: result.updated_at })
        setCharacterEditorOpen(true)
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
          payload.open_line = [...(payload.open_line || []), ...(parsed.open_line || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
          payload.hidden_line = [...(payload.hidden_line || []), ...(parsed.hidden_line || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
        } else if (buildDraft.kind === 'foreshadowing') {
          payload.foreshadowings = [...(payload.foreshadowings || []), ...(parsed.foreshadowings || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
        }
        payload.framework_confirmed = false
        payload.source_draft_id = buildDraft.draft_id || payload.source_draft_id
        payload.source_step = buildDraft.kind
        payload.confirmation_status = 'accepted'
        payload.confirmed_by = 'author'
        payload.author_modified = true
        return normalizeStoryCard({ ...prev, payload })
      })
      if (buildDraft.draft_id) await api.put(`/api/projects/${project}/build-drafts/${buildDraft.draft_id}`, { body: buildDraft.body, status: 'accepted', accepted_target: storyForm?.id || 'story_new', accepted_scope: ['all'] })
      setBuildDraft({ ...buildDraft, status: 'accepted', accepted_scope: ['all'] })
      mutateBuildDraftRows()
      push('草案已确认写入 Story 表单，请保存故事卡')
    }

    const storyPayload = normalizeStoryCard(storyForm).payload
    const canonicalChoices = canonicalEvents(currentStoryEvents)
    const eventRefOptions = canonicalChoices.map((row: any) => ({ value: `${row.owner_card_id}:${row.scene_id}`, label: `${row.values?.scene || '未命名事件'}（${row.owner_card_id === storyForm.id ? '故事策划' : '情节工作表'}）` }))
    const renderStoryRows = (section: string, rows: any[], fields: Array<{ key: string; label: string; span?: string }>, template: any) => (
      <div className='space-y-2'>
        {rows.map((row: any, index: number) => (
          <div key={`${section}-${index}`} id={`story-row-${storyForm.id}-${section}-${row.id || index}`} className='story-row'>
            {section === 'foreshadowings' && <h4 className='mb-3 text-sm font-medium'>伏笔 {index + 1} · 作者计划</h4>}
            <div className='grid grid-cols-12 gap-2'>
              {fields.filter((field) => field.key !== 'id' && !(section === 'chapter_plan' && field.key === 'chapter')).map((field) => (
                <div key={field.key} className={`col-span-12 sm:col-span-6 ${(field.span || 'col-span-6').replace('col-span-', 'xl:col-span-')}`}>
                  <label className='text-xs text-muted'>{field.label}</label>
                  {['chapter', 'chapter_id', 'first_chapter', 'payoff_chapter'].includes(field.key) ? <Select value={row?.[field.key] || (section === 'chapter_plan' && field.key === 'chapter_id' ? row.chapter : '') || ''} onChange={(e) => updateStoryArrayItem(section, index, field.key, e.target.value)}><option value=''>暂不安排章节</option>{row?.[field.key] && !chapterRows.some((chapter: any) => chapter.chapter_id === row[field.key]) && <option value={row[field.key]}>原计划关联（尚未对应现有章节）</option>}{chapterRows.map((chapter: any) => <option key={chapter.chapter_id} value={chapter.chapter_id}>{chapter.chapter_title || chapter.title || '未命名章节'}</option>)}</Select> : <Input value={row?.[field.key] || ''} onChange={(e) => updateStoryArrayItem(section, index, field.key, e.target.value)} />}
                </div>
              ))}
            </div>
            {section === 'foreshadowings' && <div className='mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2'>{[['first_event_ref', '在哪件事埋设'], ['payoff_event_ref', '在哪件事回收']].map(([key, label]) => { const selected = eventChoiceValue(canonicalChoices, row[key]); return <div key={key}><label className='mb-1 block text-xs text-muted' htmlFor={`foreshadow-${index}-${key}`}>{label}</label><Select id={`foreshadow-${index}-${key}`} value={selected} onChange={(e) => { const [owner_card_id, scene_id] = e.target.value.split(':'); updateStoryArrayItem(section, index, key, e.target.value ? { owner_card_id, scene_id } : undefined) }}><option value=''>暂未安排事件</option>{selected && !eventRefOptions.some((item: any) => item.value === selected) && <option value={selected}>原关联事件暂不可用（保留）</option>}{eventRefOptions.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div> })}</div>}
            <InformationPanel key={`${project}:${storyForm.id}:${section}:${row.id || index}`} project={project} storyId={storyForm.id} value={row.information_ids || []} onChange={(ids) => updateStoryArrayItem(section, index, 'information_ids', ids)} eventRef={section === 'important_scenes' && row.id ? { owner_card_id: storyForm.id, scene_id: row.id } : row.first_event_ref} chapterId={row.chapter_id || row.chapter || row.first_chapter} title={section === 'foreshadowings' ? '线索涉及的信息与揭示' : section === 'chapter_plan' ? '本章计划展示的信息' : '关键透露、隐瞒与认知'} />
            <div className='mt-2 flex justify-end'>
              <Button className='text-xs' onClick={() => removeStoryArrayItem(section, index)}>删除</Button>
            </div>
          </div>
        ))}
        <Button onClick={() => addStoryArrayItem(section, template)}>新增</Button>
      </div>
    )

    const renderBuildDraftJsonDebug = () => (
      <details className='rounded-ui border border-border bg-surface-2 p-2'>
        <summary className='cursor-pointer text-xs text-muted'>JSON debug / 原始草案</summary>
        <Textarea className='mt-2 h-40 mono' value={buildDraft?.body || ''} onChange={(e) => buildDraft && setBuildDraft({ ...buildDraft, body: e.target.value })} />
      </details>
    )

    const renderBuildDraftEditor = () => {
      if (!buildDraft) {
        return (
          <div className='flex h-56 items-center justify-center rounded-ui border border-dashed border-border bg-surface-2 text-sm text-muted'>
            选择左侧环节生成待确认草案
          </div>
        )
      }
      if (!parsedBuildDraft) {
        return (
          <div className='space-y-2'>
            <div className='rounded-ui border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-200'>草案 JSON 暂时无法解析，修正后会恢复结构化编辑。</div>
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
          label: '准备项目 · 建书底座',
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
          label: '准备项目 · 故事核心',
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
          label: '准备项目 · 结构脉络',
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
          label: '准备项目 · 卡片资产',
          detail: '人物、风格、技法、工具 skill 会成为章节生成约束。',
          items: [
            { id: 'characters', label: '人物卡', done: Array.isArray(chars) && chars.length > 0, detail: `${Array.isArray(chars) ? chars.length : 0} 张`, run: () => { setActiveActivity('cards'); setView('characters') } },
            { id: 'style_cards', label: '文风卡', done: Array.isArray(styles) && styles.length > 0, detail: `${Array.isArray(styles) ? styles.length : 0} 张`, run: () => { setActiveActivity('cards'); setView('style') } },
            { id: 'technique_cards', label: '叙事技巧', done: Array.isArray(techniqueCards) && techniqueCards.length > 0, detail: `${Array.isArray(techniqueCards) ? techniqueCards.length : 0} 张`, run: () => { setActiveActivity('techniques'); setView('techniques') } },
            { id: 'tool_skills', label: '工具 skill', done: Array.isArray(toolSkillCards) && toolSkillCards.length > 0, detail: `${Array.isArray(toolSkillCards) ? toolSkillCards.length : 0} 个`, run: () => { setActiveActivity('techniques'); setView('techniques') } },
          ],
        },
        {
          id: 'chapter',
          label: '准备项目 · 当前章节',
          detail: '这一章是否能明确挂到卷、章节计划和要求节点。',
          items: [
            { id: 'volumes', label: '卷', done: volumeRows.length > 0, detail: `${volumeRows.length} 卷`, run: () => { if (volumeRows.length) setActiveActivity('explorer'); else void createVolume() } },
            { id: 'chapters', label: '章', done: chapterRows.length > 0, detail: `${chapterRows.length} 章`, run: () => { if (chapterRows.length) { setView('chapter'); setActiveActivity('explorer') } else void createChapterInVolume(volumeRows[0]?.id || 'volume_default') } },
            { id: 'chapter_title', label: '章节标题', done: hasText(chapterTitleDraft || currentChapterMeta?.chapter_title), detail: chapterTitleDraft || currentChapterMeta?.chapter_title || '未填写', run: () => { setView('chapter'); setActiveActivity('explorer') } },
            { id: 'linked_plan', label: '绑定章节计划', done: currentStoryLinks.chapterPlan.length > 0, detail: `${currentStoryLinks.chapterPlan.length} 行`, run: () => { setView('story'); setStoryPlanningTab('Chapter Matrix') } },
            { id: 'linked_lines', label: '本章明暗伏', done: currentStoryLinks.openLine.length + currentStoryLinks.hiddenLine.length + currentStoryLinks.foreshadowings.length > 0, detail: `明 ${currentStoryLinks.openLine.length} · 暗 ${currentStoryLinks.hiddenLine.length} · 伏 ${currentStoryLinks.foreshadowings.length}`, run: () => goStoryStep('lines') },

          ],
        },
        {
          id: 'trust',
          label: '准备项目 · 可信点亮',
          detail: 'AI 判断必须有正文 quote 和行号，不能只靠自述。',
          items: [
            { id: 'profile', label: '已连接的 AI 模型', done: realReadyProfiles.length > 0, detail: `${realReadyProfiles.length} 个已填写`, run: () => setView('settings') },
            { id: 'agents', label: '模型分工', done: agentAssignmentsReady, detail: agentModuleRows.length ? `${agentModuleRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length).length}/${agentModuleRows.length} 项已配置` : '正在读取设置', run: () => setView('settings') },
            { id: 'marks', label: '证据标记', done: hasQuotedMarks, detail: `${evidenceMarkRows.length} 条依据`, run: () => { setView('chapter'); void analyzeMarks() } },
            { id: 'supported', label: '已证实命中', done: supportedMarks.length > 0, detail: `${supportedMarks.length} 个`, run: () => setView('chapter') },
            { id: 'risks', label: '未证实风险', done: unsupportedMarks.length === 0 && evidenceMarkRows.length > 0, detail: `${unsupportedMarks.length} 个风险`, run: () => setView('chapter') },
            { id: 'pending_reviews', label: '待审稿件', done: pendingChapterReviews.length === 0 && pendingPatchCount === 0, detail: `稿 ${pendingChapterReviews.length} · patch ${pendingPatchCount}`, run: () => setView('chapter') },
          ],
        },
      ]
      const readinessItemCount = readinessGroups.reduce((sum, group) => sum + group.items.length, 0)
      const readinessDoneCount = readinessGroups.reduce((sum, group) => sum + group.items.filter((item) => item.done).length, 0)
      const readinessMajorDoneCount = readinessGroups.filter((group) => group.items.every((item) => item.done)).length
      const timelineToneClass = (status: string) => {
        if (status === 'confirmed') return 'border-emerald-400 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
        if (status === 'suggesting') return 'border-sky-400 bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200'
        if (status === 'pending') return 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
        if (status === 'risk') return 'border-red-400 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
        return 'border-border bg-surface-2 text-muted'
      }
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
      const selectedTimelineNode = timelineNodes.find((node) => node.id === selectedTimelineNodeId) || timelineNodes[0]
      const renderReadinessGroup = (group: any) => {
        const done = group.items.filter((item: any) => item.done).length
        const allDone = done === group.items.length
        return (
          <div key={group.id} className={`rounded-ui border p-3 ${allDone ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface'}`}>
            <div className='flex items-start justify-between gap-2'>
              <div>
                <div className='text-sm font-semibold'>{group.label}</div>
                <div className='mt-1 text-xs text-muted'>{group.detail}</div>
              </div>
              <Badge tone={allDone ? 'success' : 'warn'}>{done}/{group.items.length}</Badge>
            </div>
            <div className='mt-3 flex flex-wrap gap-1.5'>
              {group.items.map((item: any) => (
                <button
                  key={item.id}
                  className={`rounded-full border px-2 py-1 text-left text-xs transition ${item.done ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-border bg-surface-2 text-muted hover:bg-surface'}`}
                  onClick={item.run}
                  title={`${item.label}: ${item.detail}`}
                >
                  <span className='font-medium'>{item.label}</span>
                  <span className='ml-1 opacity-80'>{item.done ? '已亮' : '待补'}</span>
                </button>
              ))}
            </div>
            <div className='mt-2 text-[11px] text-muted'>
              {group.items.filter((item: any) => !item.done).slice(0, 3).map((item: any) => `${item.label}: ${item.detail}`).join(' · ') || '这一块已经可以支撑开写。'}
            </div>
          </div>
        )
      }
      const setupChecklist = [
        {
          id: 'api',
          label: '连接 AI 模型',
          done: realReadyProfiles.length > 0,
          detail: realReadyProfiles.length ? `${realReadyProfiles.length} 个已配置的模型` : '还没有配置真实模型',
          action: '去配置',
          run: () => setView('settings'),
        },
        {
          id: 'agents',
          label: '选择各任务使用的模型',
          done: agentAssignmentsReady,
          detail: agentModuleRows.length ? `${agentModuleRows.filter((row: any) => !row.is_mock && !row.profile_missing && !row.missing_fields?.length).length}/${agentModuleRows.length} 项已配置` : '正在读取模型设置',
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
          label: '建立证据标记',
          done: evidenceMarkRows.length > 0 || Boolean(trustReport?.updated_at),
          detail: evidenceMarkRows.length ? `${evidenceMarkRows.length} 条依据 · 风险 ${unsupportedMarks.length}` : '还没有分析当前章节',
          action: '分析当前章',
          run: () => { setView('chapter'); analyzeMarks() },
        },
      ]
      const setupDoneCount = setupChecklist.filter((step) => step.done).length
      return (
        <div className='space-y-3 density-space'>
          <Card
            title='写作工作台'
            extra={<Button variant='primary' onClick={() => { setView('chapter'); setActiveActivity('explorer') }}>打开当前章节</Button>}
          >
            <p className='text-sm text-muted'>{runningEvent || activeWritingRun ? '正在生成，随时可以查看当前章节。' : '继续写作，或查看已经完成的草稿。'}{pendingPatchCount + pendingChapterReviews.length + pendingBuildDrafts.length + unsupportedMarks.length > 0 ? ` 有 ${pendingPatchCount + pendingChapterReviews.length + pendingBuildDrafts.length + unsupportedMarks.length} 项内容待你处理。` : ''}</p>
            <details className='mt-4'><summary className='cursor-pointer text-sm font-medium'>草稿与检查状态</summary><div className='mt-3'>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-5'>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>生成状态</div>
                <div className='mt-1 text-lg font-semibold'>{runningEvent || activeWritingRun ? '生成中' : (({ queued: '等待生成', running: '生成中', failed: '已中断', completed: '已完成', awaiting_review: '待确认', finalizing: '正在收尾', cancelled: '已结束' } as Record<string, string>)[latestJob?.status] || (pendingPatchCount ? '待审稿' : '空闲'))}</div>
                <div className='text-xs text-muted'>{latestJob?.output_summary || (latestJob ? '可在正文中查看生成结果' : '尚未生成')}</div>
              </div>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>待确认修改</div>
                <div className='mt-1 text-lg font-semibold'>{pendingPatchCount}</div>
                <div className='text-xs text-muted'>AI 改动默认需确认</div>
              </div>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>待审 AI 草稿</div>
                <div className='mt-1 text-lg font-semibold'>{pendingChapterReviews.length}</div>
                <div className='text-xs text-muted'>确认后才视为作者稿</div>
              </div>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>待确认草案</div>
                <div className='mt-1 text-lg font-semibold'>{pendingBuildDrafts.length}</div>
                <div className='text-xs text-muted'>建书草案不会自动写入</div>
              </div>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>风险标记</div>
                <div className='mt-1 text-lg font-semibold'>{unsupportedMarks.length}</div>
                <div className='text-xs text-muted'>未证实或有矛盾</div>
              </div>
            </div>
            </div></details>
          </Card>

          <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>查看与补充作品准备情况</summary><div className='mt-3'>
          <Card
            title='作品准备情况'
            extra={<Badge tone={readinessDoneCount === readinessItemCount ? 'success' : 'warn'}>准备项目 {readinessMajorDoneCount}/{readinessGroups.length} · 已完成项 {readinessDoneCount}/{readinessItemCount}</Badge>}
          >
            <div className='flex flex-col gap-3 lg:flex-row'>
              <div className='lg:w-64'>
                <div className='rounded-ui border border-border bg-surface p-3'>
                  <div className='text-xs text-muted'>当前开写状态</div>
                  <div className='mt-1 text-2xl font-semibold'>{readinessMajorDoneCount}/{readinessGroups.length}</div>
                  <div className='text-xs text-muted'>项准备已完成</div>
                  <Button
                    className='mt-3 w-full'
                    variant={readinessMajorDoneCount >= 4 ? 'primary' : 'secondary'}
                    onClick={() => { setView('chapter'); setActiveActivity('explorer') }}
                  >
                    开始写当前章
                  </Button>
                  <div className='mt-2 text-xs text-muted'>
                    点击项目即可补充资料。绿色表示已准备，灰色表示还需要填写或检查。
                  </div>
                </div>
              </div>
              <div className='grid flex-1 grid-cols-1 gap-2 xl:grid-cols-2'>
                {readinessGroups.map(renderReadinessGroup)}
              </div>
            </div>
          </Card>

</div></details>
          <Card title='故事进展' extra={<Badge>结构线 · 非章节目录</Badge>}>
            <div className='overflow-x-auto pb-2'>
              <div className='flex min-w-max items-center gap-2'>
                {timelineNodes.map((node, index) => (
                  <div key={node.id} className='flex items-center gap-2'>
                    {index > 0 ? <div className='h-px w-8 bg-border' /> : null}
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs ${timelineToneClass(node.status)} ${selectedTimelineNode.id === node.id ? 'ring-2 ring-brand-500' : ''}`}
                      onClick={() => setSelectedTimelineNodeId(node.id)}
                    >
                      {node.label}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className='mt-3 rounded-ui border border-border bg-surface p-3'>
              <div className='grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.2fr_1fr]'>
                <div>
                  <div className='text-xs text-muted'>当前状态</div>
                  <div className='mt-1 flex items-center gap-2'>
                    <span className='text-sm font-semibold'>{selectedTimelineNode.label}</span>
                    <Badge tone={selectedTimelineNode.status === 'confirmed' ? 'success' : selectedTimelineNode.status === 'risk' || selectedTimelineNode.status === 'pending' ? 'warn' : 'default'}>
                      {selectedTimelineNode.status === 'confirmed' ? '作者已确认' : selectedTimelineNode.status === 'suggesting' ? 'AI 建议中' : selectedTimelineNode.status === 'pending' ? '待作者确认' : selectedTimelineNode.status === 'risk' ? '有结构风险' : '未开始'}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className='text-xs text-muted'>AI 建议</div>
                  <div className='mt-1 text-sm'>{selectedTimelineNode.suggestion}</div>
                </div>
                <div>
                  <div className='text-xs text-muted'>作者决策</div>
                  <div className='mt-1 flex flex-wrap gap-1.5'>
                    <Button className='text-xs' onClick={() => updateTimelineDecision(selectedTimelineNode, 'accepted')}>接受建议</Button>
                    <Button className='text-xs' onClick={selectedTimelineNode.run}>修改</Button>
                    <Button className='text-xs' onClick={() => updateTimelineDecision(selectedTimelineNode, 'skipped')}>跳过</Button>
                    <Button className='text-xs' onClick={() => selectedTimelineNode.draftKind ? generateBuildDraft(selectedTimelineNode.draftKind) : selectedTimelineNode.run()}>生成备选</Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card title='首次启动检查' extra={<Badge tone={setupDoneCount === setupChecklist.length ? 'success' : 'warn'}>{setupDoneCount}/{setupChecklist.length}</Badge>}>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
              {setupChecklist.map((step) => (
                <button
                  key={step.id}
                  className={`rounded-ui border px-3 py-2 text-left ${step.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
                  onClick={step.run}
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium'>{step.label}</span>
                    <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : step.action}</Badge>
                  </div>
                  <div className='mt-1 text-xs text-muted'>{step.detail}</div>
                </button>
              ))}
            </div>
            <p className='mt-2 text-xs text-muted'>建议按顺序完成：先配置 API 和 Agent，再建书、建人物、建卷章，最后用证据标记检查 AI 是否真的写到了要求。</p>
          </Card>

          <Card title='建书完成度' extra={<Badge tone={completedBuildSteps === storyBuildProgress.length ? 'success' : 'warn'}>{completedBuildSteps}/{storyBuildProgress.length}</Badge>}>
            <div className='grid grid-cols-3 gap-2'>
              {storyBuildProgress.map((step) => (
                <button
                  key={step.id}
                  className={`rounded-ui border px-3 py-2 text-left ${step.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
                  onClick={() => { setView('story'); setBuildWizardStep(step.id) }}
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium'>{step.label}</span>
                    <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : '待补'}</Badge>
                  </div>
                  <div className='mt-1 text-xs text-muted'>{step.detail}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title='最近章节'>
            <div className='grid grid-cols-2 gap-2'>
              {recentChapters.map((ch: any) => (
                <button
                  key={ch.chapter_id}
                  onClick={() => { setSelectedChapter(ch.chapter_id); setView('chapter'); setActiveActivity('explorer') }}
                  className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium'>{ch.chapter_title || ch.title || ch.chapter_id}</span>
                    <Badge>{ch.chapter_status || '未开始'}</Badge>
                  </div>
                  <div className='mt-1 text-xs text-muted'>{ch.chapter_id} · {ch.volume_id || 'volume_default'}</div>
                </button>
              ))}
              {!recentChapters.length && <p className='text-sm text-muted'>暂无章节。</p>}
            </div>
          </Card>

          <Card title='项目'>
            <div className='space-y-2'>
              {(projects || []).map((p: any) => (
                <button key={p.id} onClick={() => setProject(p.id)} className={`w-full rounded-ui border px-3 py-2 text-left ${project === p.id ? 'border-brand-500 bg-surface-2 dark:bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  <div className='text-sm font-medium'>{p.id}</div>
                  <div className='text-xs text-muted'>{p.title}</div>
                </button>
              ))}
              <div className='flex flex-wrap gap-2'>
                <Button variant='primary' onClick={async () => { const r = await api.post('/api/projects', { title: '新项目' }); setProject(r.project_id); mutateProjects() }}>Create</Button>
                <Button onClick={downloadProjectBackup}>导出备份</Button>
                <Button onClick={downloadManuscriptMarkdown}>导出正文</Button>
                <Button onClick={() => backupImportInputRef.current?.click()}>导入备份</Button>
              </div>
              <input ref={backupImportInputRef} className='hidden' type='file' accept='.zip,application/zip' onChange={importProjectBackup} />
              <div className='text-xs text-muted'>备份用于恢复全项目；正文 Markdown 用于投稿、迁移和直接阅读。</div>
            </div>
          </Card>

          <div className='grid grid-cols-3 gap-3'>
            <Card title='待确认建书草案'>
              <div className='space-y-1'>
                {pendingBuildDrafts.slice(0, 5).map((rec: any) => (
                  <div key={rec.draft_id} className='rounded-ui border border-border bg-surface px-2 py-1.5 text-xs'>
                    <button className='w-full text-left hover:underline' onClick={() => openBuildDraft(rec)}>
                      <span className='font-medium'>{rec.title || rec.kind}</span>
                      <span className='ml-2 text-muted'>rev {rec.revision || 1} · {rec.source || 'unknown'}</span>
                    </button>
                    <div className='mt-1 text-muted'>{rec.updated_at || rec.created_at || 'no timestamp'}</div>
                    <div className='mt-1 flex gap-2'>
                      <Button className='text-xs' onClick={() => openBuildDraft(rec)}>打开</Button>
                      <Button className='text-xs' onClick={() => rejectBuildDraft(rec)}>拒绝</Button>
                    </div>
                  </div>
                ))}
                {!pendingBuildDrafts.length && <p className='text-sm text-muted'>没有待确认建书草案。</p>}
              </div>
            </Card>
            <Card title='建书草案历史'>
              <div className='space-y-1'>
                <div className='flex flex-wrap gap-1 pb-1'>
                  {[
                    ['all', '全部'],
                    ['accepted', '已接受'],
                    ['partially_accepted', '局部'],
                    ['rejected', '已拒绝'],
                  ].map(([key, label]) => (
                    <Button key={key} className='text-xs' variant={buildDraftHistoryFilter === key ? 'primary' : 'secondary'} onClick={() => setBuildDraftHistoryFilter(key)}>
                      {label} {(buildDraftHistoryCounts as any)[key] || 0}
                    </Button>
                  ))}
                </div>
                {buildDraftHistoryRows.slice(0, 5).map((rec: any) => (
                  <div key={rec.draft_id} className='rounded-ui border border-border bg-surface px-2 py-1.5 text-xs'>
                    <button className='w-full text-left hover:underline' onClick={() => openBuildDraft(rec)}>
                      <span className='font-medium'>{rec.title || rec.kind}</span>
                      <span className='ml-2 text-muted'>{rec.status || 'processed'}</span>
                    </button>
                    <div className='mt-1 text-muted'>{rec.updated_at || rec.created_at || 'no timestamp'}</div>
                    <div className='mt-1 flex flex-wrap items-center gap-1 text-muted'>
                      {acceptedScopeLabels(rec).length ? <Badge tone='success'>{acceptedScopeLabels(rec).join(', ')}</Badge> : null}
                      {rec.rejection_reason ? <span>{rec.rejection_reason}</span> : null}
                    </div>
                    <div className='mt-1 flex gap-1'>
                      <Button className='text-xs' onClick={() => openBuildDraft(rec)}>打开</Button>
                      <Button className='text-xs' onClick={() => restoreBuildDraft(rec)}>恢复待确认</Button>
                    </div>
                  </div>
                ))}
                {!buildDraftHistoryRows.length && <p className='text-sm text-muted'>没有符合筛选的已处理草案。</p>}
              </div>
            </Card>
            <Card title='待确认 AI 修改'>
              <div className='space-y-1'>
                {(reviewPatch?.ops || []).slice(0, 5).map((op: any) => (
                  <button key={op.op_id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => setView('chapter')}>
                    {op.op_id} · {op.rationale || op.type}
                  </button>
                ))}
                {!reviewPatch?.ops?.length && <p className='text-sm text-muted'>没有待审 patch。</p>}
              </div>
            </Card>
          </div>

          <Card title='最近 AI 任务'>
            <div className='grid grid-cols-2 gap-2'>
              {jobList.slice(0, 6).map((job: any) => (
                <button
                  key={job.job_id}
                  className={`rounded-ui border px-3 py-2 text-left hover:bg-surface-2 ${selectedJobId === job.job_id ? 'border-brand-500 bg-surface-2' : 'border-border bg-surface'}`}
                  onClick={() => {
                    if (job.chapter_id) setSelectedChapter(job.chapter_id)
                    setSelectedJobId(job.job_id)
                  }}
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='truncate text-sm font-medium'>{job.chapter_id || job.job_id}</span>
                    <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' || job.status === 'awaiting_review' ? 'warn' : 'default'}>
                      {job.status || 'unknown'}
                    </Badge>
                  </div>
                  <div className='mt-1 text-xs text-muted'>{job.last_event || job.stage || 'no event'} · {job.model || 'model pending'}</div>
                  <div className='mt-1 text-xs text-muted'>{job.output_summary || job.input_summary || job.updated_at}</div>
                </button>
              ))}
              {!jobList.length && <p className='text-sm text-muted'>还没有生成任务。生成本章后，这里会保留任务状态。</p>}
            </div>
          </Card>

          {selectedJobSummary ? (
            <Card
              title='AI 任务详情'
              extra={<Badge tone={selectedJobSummary.status === 'completed' ? 'success' : selectedJobSummary.status === 'failed' ? 'warn' : 'default'}>{selectedJobSummary.status || 'unknown'}</Badge>}
            >
              <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
                <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
                  <div className='mb-2 font-medium'>{selectedJobSummary.job_id}</div>
                  <div>Chapter: {selectedJobSummary.chapter_id || '-'}</div>
                  <div>Stage: {selectedJobSummary.stage || selectedJobSummary.last_event || '-'}</div>
                  <div>Provider: {selectedJobSummary.provider || '-'}</div>
                  <div>Model: {selectedJobSummary.model || '-'}</div>
                  <div>Fallback: {selectedJobSummary.fallback ? 'yes' : 'no'}</div>
                  <div>Created: {selectedJobSummary.created_at || '-'}</div>
                  <div>Updated: {selectedJobSummary.updated_at || '-'}</div>
                  <div className='mt-2 flex flex-wrap gap-1'>
                    <Button className='text-xs' onClick={() => mutateSelectedJobDetail()}>刷新详情</Button>
                    <Button className='text-xs' onClick={() => { if (selectedJobSummary.chapter_id) setSelectedChapter(selectedJobSummary.chapter_id); setView('chapter'); setActiveActivity('explorer') }}>打开章节</Button>
                  </div>
                </div>
                <div className='rounded-ui border border-border bg-surface p-3 text-xs lg:col-span-2'>
                  <div className='mb-2 flex items-center justify-between gap-2'>
                    <span className='font-medium'>Stage 历史</span>
                    <Badge>{selectedJobEvents.length || selectedJobSummary.event_total || 0}</Badge>
                  </div>
                  <div className='max-h-72 space-y-1 overflow-auto'>
                    {selectedJobEvents.map((evt: any, index: number) => {
                      const data = evt.data || {}
                      return (
                        <div key={`${evt.event}-${index}`} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5'>
                          <div className='flex flex-wrap items-center justify-between gap-2'>
                            <span className='font-medium'>{evt.event}</span>
                            <Badge tone={data.fallback ? 'warn' : 'default'}>{data.stage || evt.event}</Badge>
                          </div>
                          <div className='mt-1 text-muted'>{data.provider || 'system'} / {data.model || '-'} {data.fallback ? '(fallback)' : ''}</div>
                          {data.input_summary ? <div className='mt-1'>Input: {data.input_summary}</div> : null}
                          {data.output_summary ? <div className='mt-1'>Output: {data.output_summary}</div> : null}
                        </div>
                      )
                    })}
                    {!selectedJobEvents.length ? <p className='text-muted'>选择任务后会显示每个 stage 的输入摘要、输出摘要、provider/model 和 fallback。</p> : null}
                  </div>
                </div>
              </div>
              <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-2'>
                <details className='rounded-ui border border-border bg-surface'>
                  <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>Context Manifest</summary>
                  <pre className='mono max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-3 text-xs'>{JSON.stringify(selectedJobManifest || {}, null, 2)}</pre>
                </details>
                <details className='rounded-ui border border-border bg-surface'>
                  <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>Trust Report</summary>
                  <pre className='mono max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-3 text-xs'>{JSON.stringify(selectedJobTrust || {}, null, 2)}</pre>
                </details>
              </div>
            </Card>
          ) : null}

          <div className='grid grid-cols-2 gap-3'>
            <Card title='待确认事实'>
              <div className='space-y-1'>
                {(proposals || []).filter((p: any) => (p.status || 'pending') === 'pending').slice(-5).reverse().map((p: any) => (
                  <button key={p.proposal_id || p.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setSelectedProposalId(p.proposal_id || p.id || ''); setView('canon') }}>
                    {p.name || p.proposal_id || p.id}
                  </button>
                ))}
                {!(proposals || []).filter((p: any) => (p.status || 'pending') === 'pending').length && <p className='text-sm text-muted'>目前没有待确认事实。</p>}
              </div>
            </Card>
            <Card title='可信风险'>
              <div className='space-y-1'>
                {unsupportedMarks.slice(0, 5).map((mark: any) => (
                  <button key={mark.mark_id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setSelectedMarkId(mark.mark_id); setView('chapter') }}>
                    {mark.target_type} · {referenceLabel({ title: mark.label || mark.target_id })}
                  </button>
                ))}
                {!unsupportedMarks.length && <p className='text-sm text-muted'>当前章节没有未证实风险。</p>}
              </div>
            </Card>
          </div>
        </div>
      )
    }

    if (view === 'scene-rehearsal' && directRehearsal) return <SceneRehearsalWorkspace key={`${project}:${directRehearsal.ownerCardId}:${directRehearsal.sceneId}`} project={project} ownerCardId={directRehearsal.ownerCardId} sceneId={directRehearsal.sceneId} sceneLabel={directRehearsal.label} profileId={useAgentAssignments ? undefined : llmProfileId} draftCache={cardDraftCache} onBack={() => { setActiveActivity('explorer'); setView('chapter') }} onConfirmed={mergeDirectRehearsal} onOpenMaterial={openMaterial} onOpenSettings={() => { setActiveActivity('settings'); setView('settings') }} backLabel='返回章节正文' />

    if (view === 'relationships') return <SharedRelationships key={`${project}:shared`} project={project} worldContext={storyForm.payload?.world_context} storyId={storyForm.id} focusId={sharedRelationshipFocus} focusStageId={sharedRelationshipStageFocus} onOpen={openMaterial} />

    if (view === 'export') return <SelectiveExportPanel project={project} projectTitle={projectInfo?.title || storyForm?.title || '作品'} />

    if (view === 'planning') {
      return <StoryPlanningTables onStorySection={tab => {
        setStoryPlanningTab(tab); setActiveActivity('story'); setView('story')
      }} isTargetDirty={isSettingDirty} project={project} storyCard={storyForm} characters={Array.isArray(chars) ? chars : []} chapters={chapterRows} profileId={useAgentAssignments ? undefined : llmProfileId} draftCache={cardDraftCache} onOpenStory={() => { setActiveActivity('story'); setView('story') }} onStoryCardChange={(card) => setStoryForm(normalizeStoryCard(card))} onSaveStory={saveStoryCard} onOpenMaterial={openMaterial} onSaved={refreshSharedMaterials} focusRequest={materialFocusRequest} onOpenSettings={() => { setActiveActivity('settings'); setView('settings') }} />
    }

    if (view === 'story') {
      const savedPlan = (Array.isArray(storyCards) ? storyCards : []).find((card: any) => card.id === storyForm.id)?.payload
      const storyTab = storyPlanningTab === 'Stages' ? 'Lines' : storyPlanningTab
      const resume = storyTab === 'Overview' ? resumeChapter() : null
      return (
        <div className='story-workspace'>
          {storyLocal.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>有未保存的故事草稿。</p><div className='flex gap-2'><Button onClick={storyLocal.restore}>恢复草稿</Button><Button variant='ghost' onClick={storyLocal.dismiss}>保留保存版</Button></div></div>}
          <header className='story-heading'>
            <div className='story-heading-copy'><input className='story-title' aria-label='作品名' value={storyForm?.title || ''} onChange={(e) => updateStoryRoot('title', e.target.value)} placeholder='作品名称' /></div>
            {(storyTab !== 'Overview' || !resume || storyLocal.dirty || storyForm.id === 'story_new' || cardSaveState[`${project}:${storyForm.id}`]) && <div className='space-y-2'><Button variant={resume ? 'secondary' : 'primary'} disabled={cardSaveState[`${project}:${storyForm.id}`] === '保存中…'} onClick={saveStoryCard}>保存故事设定</Button><p role='status' className='text-xs text-muted'>{cardSaveState[`${project}:${storyForm.id}`]?.startsWith('保存失败') || cardSaveState[`${project}:${storyForm.id}`] === '保存中…' ? cardSaveState[`${project}:${storyForm.id}`] : storyLocal.dirty ? '有未保存的修改' : cardSaveState[`${project}:${storyForm.id}`] || ''}</p></div>}
          </header>
          <nav className='story-task-nav' aria-label='作品总览'>{[['Overview','概览'],['Outline','全书构想'],['Preferences','作品设定']].map(([id,label]) => <button key={id} aria-current={storyTab === id ? 'page' : undefined} onClick={() => setStoryPlanningTab(id)}>{label}</button>)}</nav>
          {storyTab === 'Preferences' && <Button className='self-start' onClick={() => setView('style')}>文风与样文</Button>}
          {storyTab === 'Outline' && <label className='story-field-label'>全书构想<Textarea className='novix-outline' value={storyPayload.full_outline || ''} onChange={e => updateStoryPayload('full_outline', e.target.value)} /></label>}
          {storyTab === 'Outline' && <SuspensePanel key={`${project}:${storyForm.id}:${savedPlan?.world_context?.world_id || ''}:${savedPlan?.world_context?.branch_id || ''}`} project={project} storyId={storyForm.id} branch={savedPlan?.world_context?.branch_id} worldId={savedPlan?.world_context?.world_id} foreshadowings={savedPlan?.foreshadowings}
            openChapter={id => { setSelectedChapter(id); setChapterPane('本章安排'); setActiveActivity('explorer'); setView('chapter') }} />}
          {resume && <div className='resume-manuscript'>
            <div><span>章节正文</span><h2>{resume.chapter_title || resume.title || '未命名章节'}</h2></div>
            <Button variant='primary' onClick={() => openManuscript(resume.chapter_id)}>打开正文</Button>
          </div>}
          {storyTab === 'Overview' && <BookOverview project={project} cards={Array.isArray(allCards) ? allCards : []}
            events={Array.isArray(overviewEvents) ? overviewEvents : []} story={storyPayload}
            onPicture={key => updateStoryPayload('overview_picture', key)} onOpenMaterial={openMaterial}
            onOpenEvent={enterStoryEvent} onOutline={() => setStoryPlanningTab('Outline')}
            onTimeline={() => { setActiveActivity('planning'); setView('planning') }} />}

          {storyTab === 'Preferences' && <section className='story-section space-y-4'><h2 className='text-xl font-semibold'>故事摘要</h2><details><summary className='cursor-pointer text-sm text-brand-600'>导入摘要素材</summary><div className='mt-4'><MaterialImportWorkspace project={project} purpose='story' isTargetDirty={isSettingDirty} storyId={storyForm.id !== 'story_new' ? storyForm.id : undefined} worldContext={storyPayload.world_context} profileId={useAgentAssignments ? undefined : llmProfileId} onApplied={refreshSharedMaterials} /></div></details><details><summary className='cursor-pointer text-sm text-muted'>故事背景与时间</summary><div className='mt-4'><WorldContextFields project={project} storyId={storyForm.id} value={storyPayload.world_context} onChange={(world_context) => updateStoryPayload('world_context', world_context)} /></div></details></section>}
          {storyTab === 'Preferences' && <div className='story-overview-layout'>
            <section className='story-framework' aria-label='故事概要'>
              <div><label htmlFor='story-logline' className='story-field-label'>一句话故事</label><Textarea id='story-logline' className='story-logline' value={storyPayload.logline || ''} onChange={(e) => updateStoryPayload('logline', e.target.value)} placeholder='主角、目标与阻碍' /></div>
              <div><label htmlFor='story-main_conflict' className='story-field-label'>主要冲突</label><Textarea id='story-main_conflict' className='min-h-28' value={storyPayload.main_conflict || ''} onChange={(e) => updateStoryPayload('main_conflict', e.target.value)} /></div>
              <div className='story-secondary-grid'>{[['theme', '主题'], ['worldview', '世界与背景']].map(([key, label]) => <div key={key}><label htmlFor={`story-${key}`} className='story-field-label'>{label}</label><Textarea id={`story-${key}`} value={storyPayload[key] || ''} onChange={(e) => updateStoryPayload(key, e.target.value)} /></div>)}</div>
              {storyPayload.writing_references?.length > 0 && <details><summary className='cursor-pointer text-xs text-muted'>既有故事技法关联（兼容保留）</summary><WritingReferencePicker project={project} value={storyPayload.writing_references || []} onChange={(ids) => setStoryForm((current: any) => normalizeStoryCard({ ...current, payload: { ...current.payload, writing_references: ids } }))} saveHint='已有选择保留。日常技法入口在章节正文，修改旧关联后保存故事设定生效。' /></details>}
              <InformationPanel project={project} storyId={storyForm.id} value={storyPayload.information_ids || []} onChange={(information_ids) => updateStoryPayload('information_ids', information_ids)} title='故事中的关键信息' />
              <MaterialReferences project={project} sourceId={storyForm.id !== 'story_new' ? storyForm.id : undefined} value={storyForm.links || []} onChange={(links) => setStoryForm((current: any) => ({ ...current, links }))} onOpen={openMaterial} />
              <details className='border-t border-border pt-4'><summary className='cursor-pointer text-xs text-muted'>题材、读者与写作边界</summary><div className='mt-5 grid grid-cols-1 gap-5 md:grid-cols-2'>{[['genre', '题材'], ['target_reader', '目标读者'], ['platform_style', '平台风格']].map(([key, label]) => <div key={key}><label htmlFor={`story-pref-${key}`} className='story-field-label'>{label}</label><Input id={`story-pref-${key}`} value={storyPayload[key] || ''} onChange={(e) => updateStoryPayload(key, e.target.value)} /></div>)}<div><label htmlFor='story-keywords' className='story-field-label'>关键词</label><Input id='story-keywords' value={(storyPayload.keywords || []).join(',')} onChange={(e) => updateStoryPayload('keywords', e.target.value.split(','))} /></div><div><label htmlFor='story-tags' className='story-field-label'>故事标签</label><Input id='story-tags' value={(storyForm?.tags || []).join(',')} onChange={(e) => updateStoryRoot('tags', e.target.value.split(','))} /></div><div><label htmlFor='story-banned' className='story-field-label'>写作禁区</label><Textarea id='story-banned' value={(storyPayload.banned_items || []).join('\n')} onChange={(e) => updateStoryPayload('banned_items', e.target.value.split('\n'))} placeholder='每行一条' /></div></div></details>
              <div className='story-confirmation'><Button variant='primary' onClick={confirmStoryFramework}>保存框架并安排场景</Button>{storyPayload.framework_confirmed && <span>已确认当前框架</span>}</div>
            </section>

          </div>}
          {storyTab === 'Lines' && <section className='space-y-3 py-2'><h3 className='text-lg font-semibold'>重要场景</h3><p className='text-sm text-muted'>先安排发生的事，再梳理人物能看到的明线和暂时藏起的暗线。</p>{renderStoryRows('important_scenes', storyPayload.important_scenes || [], [{ key: 'scene', label: '场景', span: 'col-span-4' }, { key: 'purpose', label: '在故事中的作用', span: 'col-span-5' }, { key: 'chapter', label: '对应章节', span: 'col-span-3' }], STORY_PAYLOAD_TEMPLATE.important_scenes[0])}</section>}


          {(storyTab === 'Lines' || storyTab === 'Foreshadowings') && (
            <details className='border-b border-border pb-4'><summary className='cursor-pointer text-sm text-muted'>查看情节与正文的引用依据</summary><div className='mt-3'>            <Card title='脉络调用痕迹' extra={<Badge>{selectedChapter}</Badge>}>
              <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                {[...openLineRows.map((row: any) => ({ type: 'open_line', label: row.event || row.result || row.chapter || '明线节点', candidates: [row.id, row.chapter, row.event, row.result] })),
                  ...hiddenLineRows.map((row: any) => ({ type: 'hidden_line', label: row.visible_hint || row.truth || row.chapter || '暗线节点', candidates: [row.id, row.chapter, row.visible_hint, row.hidden_meaning, row.truth] })),
                  ...foreshadowingRows.map((row: any) => ({ type: 'foreshadowing', label: row.content || row.id || '伏笔节点', candidates: [row.id, row.content, row.surface_signal, row.true_meaning] })),
                ].map((item: any, index: number) => {
                  const traces = traceRowsFor(item.type, item.candidates)
                  return (
                    <div key={`${item.type}-${index}`} className='rounded-ui border border-border bg-surface p-2 text-xs'>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='font-medium'>{item.label}</span>
                        <Badge tone={traceBadgeTone(traces) as any}>{traceSummary(traces)}</Badge>
                      </div>
                      <div className='mt-1 text-muted'>{item.type} · 当前章节 evidence marks</div>
                    </div>
                  )
                })}
                {!openLineRows.length && !hiddenLineRows.length && !foreshadowingRows.length ? <p className='text-sm text-muted'>暂无明线、暗线或伏笔节点。</p> : null}
              </div>
            </Card></div></details>
          )}

          {(storyTab === 'Lines') && <section className='story-section space-y-4 border-t border-border pt-6'><h3 className='text-lg font-semibold'>阶段目标</h3>
            {renderStoryRows('stages', storyPayload.stages || [], [
              { key: 'stage', label: '阶段', span: 'col-span-2' },
              { key: 'goal', label: '阶段目标', span: 'col-span-3' },
              { key: 'conflict', label: '阶段冲突', span: 'col-span-3' },
              { key: 'result', label: '阶段结果', span: 'col-span-2' },
              { key: 'turning_point', label: '转折点', span: 'col-span-2' },
            ], STORY_PAYLOAD_TEMPLATE.stages[0])}
          </section>}

          {(storyTab === 'Lines') && (
            <>
              <section className='story-section space-y-4 border-t border-border pt-6'><h3 className='text-lg font-semibold'>明线</h3>
                {renderStoryRows('open_line', storyPayload.open_line || [], [
                  { key: 'chapter', label: '章节', span: 'col-span-2' },
                  { key: 'event', label: '表面事件', span: 'col-span-3' },
                  { key: 'goal', label: '角色目标', span: 'col-span-3' },
                  { key: 'conflict', label: '阻碍/冲突', span: 'col-span-2' },
                  { key: 'result', label: '结果', span: 'col-span-2' },
                ], STORY_PAYLOAD_TEMPLATE.open_line[0])}
              </section>

              <section className='story-section space-y-4 border-t border-border pt-6'><h3 className='text-lg font-semibold'>暗线</h3>
                {renderStoryRows('hidden_line', storyPayload.hidden_line || [], [
                  { key: 'chapter', label: '章节', span: 'col-span-2' },
                  { key: 'truth', label: '真实发生的事', span: 'col-span-3' },
                  { key: 'visible_hint', label: '可见提示', span: 'col-span-3' },
                  { key: 'hidden_meaning', label: '隐藏含义', span: 'col-span-2' },
                  { key: 'reveal_timing', label: '揭示时机', span: 'col-span-2' },
                ], STORY_PAYLOAD_TEMPLATE.hidden_line[0])}
              </section>
            </>
          )}

          {(storyTab === 'Foreshadowings') && <section className='story-section space-y-4 border-t border-border pt-6'><h3 className='text-lg font-semibold'>伏笔安排汇总</h3><p className='text-xs leading-6 text-muted'>这里是作者的埋设与回收计划，编号自动管理。计划进度不等于原文命中或事实确认；正文依据请到章节检查结果核对。</p>
            {renderStoryRows('foreshadowings', storyPayload.foreshadowings || [], [
              { key: 'id', label: '伏笔ID', span: 'col-span-2' },
              { key: 'status', label: '计划进度（作者标记）', span: 'col-span-2' },
              { key: 'content', label: '伏笔内容', span: 'col-span-4' },
              { key: 'first_chapter', label: '首次出现', span: 'col-span-2' },
              { key: 'surface_signal', label: '显示方式', span: 'col-span-3' },
              { key: 'reader_feeling', label: '读者感受', span: 'col-span-3' },
              { key: 'true_meaning', label: '真实意义', span: 'col-span-4' },
              { key: 'payoff_chapter', label: '回收章节', span: 'col-span-2' },
              { key: 'payoff', label: '回收方式', span: 'col-span-4' },
              { key: 'emphasis', label: '强调方式', span: 'col-span-6' },
            ], STORY_PAYLOAD_TEMPLATE.foreshadowings[0])}
          </section>}

          {(storyTab === 'Chapter Matrix') && <section className='story-section space-y-4 border-t border-border pt-6'><h3 className='text-lg font-semibold'>章节计划</h3>
            {renderStoryRows('chapter_plan', storyPayload.chapter_plan || [], [
              { key: 'chapter', label: '计划编号', span: 'col-span-2' },
              { key: 'chapter_id', label: '对应章节', span: 'col-span-2' },
              { key: 'title', label: '章节标题', span: 'col-span-2' },
              { key: 'focus', label: '本章重点', span: 'col-span-3' },
              { key: 'key_events', label: '发生的事', span: 'col-span-4' },
              { key: 'conflict', label: '冲突', span: 'col-span-3' },
              { key: 'result', label: '结果', span: 'col-span-3' },
              { key: 'stage_result', label: '阶段性结果', span: 'col-span-3' },
              { key: 'open_line', label: '明线推进', span: 'col-span-3' },
              { key: 'hidden_line', label: '暗线推进', span: 'col-span-3' },
              { key: 'foreshadowing', label: '伏笔/回收', span: 'col-span-3' },
            ], STORY_PAYLOAD_TEMPLATE.chapter_plan[0])}
          </section>}

          {storyForm.id !== 'story_new' && <AuthorControls key={`${project}:${storyForm.id}:lock`} project={project} target={`cards/${storyForm.id}.yaml`} label='故事设定' value={storyForm} revision={storyForm._revision} dirty={storyLocal.dirty} batch onChanged={(value, result) => { const next = normalizeStoryCard({ ...value, _revision: result.base_revision }); setStoryForm(next); storyLocal.markSaved(storyForm, next); refreshSharedMaterials() }} />}
          <details className='border-t border-border pt-5' open={Boolean(buildDraft)}><summary className='cursor-pointer text-sm font-medium'>AI 故事草案{pendingBuildDrafts.length ? `（${pendingBuildDrafts.length} 份待确认）` : ''}</summary><div className='mt-4'>
          <Card
            title='构思并确认草案'
          >
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-12 space-y-2 xl:col-span-5'>
                <div className='grid grid-cols-2 gap-2'>
                  {storyBuildProgress.map((step) => (
                    <button
                      key={step.id}
                      className={`rounded-ui border px-3 py-2 text-left ${buildWizardStep === step.id ? 'border-brand-500 bg-surface-2 dark:bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}
                      onClick={() => setBuildWizardStep(step.id)}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-sm font-medium'>{step.label}</span>
                        <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : '待补'}</Badge>
                      </div>
                      <div className='mt-1 text-xs text-muted'>{step.detail}</div>
                    </button>
                  ))}
                </div>
                <div className='rounded-ui border border-border bg-surface p-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <div>
                      <div className='text-xs font-medium'>{activeBuildWizardStep.label || '建设步骤'}</div>
                      <div className='mt-1 flex flex-wrap gap-1'>
                        {(activeBuildWizardStep.checks || []).map((check) => <Badge key={check}>{check}</Badge>)}
                      </div>
                    </div>
                    {activeBuildWizardStep.draftKind ? (
                      <div className='flex flex-col gap-1'>
                        <Button
                          className='text-xs'
                          disabled={buildDraftBusy}
                          onClick={() => generateBuildDraft(activeBuildWizardStep.draftKind || 'story_overview')}
                        >
                          {buildDraftBusy ? '生成中...' : '生成此步草案'}
                        </Button>
                        {buildWizardStep === 'lines' && <Button className='text-xs' disabled={buildDraftBusy} onClick={() => generateBuildDraft('foreshadowing')}>生成伏笔草案</Button>}
                      </div>
                    ) : (
                      <Button className='text-xs' onClick={saveStoryCard}>保存故事卡</Button>
                    )}
                  </div>
                </div>
                <div className='rounded-ui border border-border bg-surface-2 p-2 text-xs text-muted'>
                  草案不会自动覆盖卡片。你可以按步骤生成、在右侧结构化修改，也可以局部确认某几条内容。
                </div>
                <div className='space-y-1 rounded-ui border border-border bg-surface p-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-xs font-medium'>待确认队列</span>
                    <Badge>{pendingBuildDrafts.length}</Badge>
                  </div>
                  <div className='max-h-36 space-y-1 overflow-auto'>
                    {pendingBuildDrafts.slice(0, 6).map((rec: any) => (
                      <div key={rec.draft_id} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
                        <button className='w-full text-left hover:underline' onClick={() => openBuildDraft(rec)}>
                          <span className='font-medium'>{rec.title || rec.kind}</span>
                          <span className='ml-2 text-muted'>rev {rec.revision || 1}</span>
                        </button>
                        <div className='mt-1 text-muted'>{rec.updated_at || rec.created_at || 'no timestamp'}</div>
                        <div className='mt-1 flex items-center justify-between gap-2 text-muted'>
                          <span>{rec.source || 'unknown'} · {rec.selected_chapter || 'no chapter'}</span>
                          <div className='flex gap-1'>
                            <Button className='text-xs' onClick={() => openBuildDraft(rec)}>打开</Button>
                            <Button className='text-xs' onClick={() => rejectBuildDraft(rec)}>拒绝</Button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!pendingBuildDrafts.length && <div className='text-xs text-muted'>暂无待确认草案。</div>}
                  </div>
                </div>
                <div className='space-y-1 rounded-ui border border-border bg-surface p-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-xs font-medium'>已处理草案</span>
                    <Badge>{buildDraftHistoryRows.length}/{processedBuildDrafts.length}</Badge>
                  </div>
                  <div className='flex flex-wrap gap-1'>
                    {[
                      ['all', '全部'],
                      ['accepted', '已接受'],
                      ['partially_accepted', '局部'],
                      ['rejected', '已拒绝'],
                    ].map(([key, label]) => (
                      <Button key={key} className='text-xs' variant={buildDraftHistoryFilter === key ? 'primary' : 'secondary'} onClick={() => setBuildDraftHistoryFilter(key)}>
                        {label} {(buildDraftHistoryCounts as any)[key] || 0}
                      </Button>
                    ))}
                  </div>
                  <div className='max-h-36 space-y-1 overflow-auto'>
                    {buildDraftHistoryRows.slice(0, 6).map((rec: any) => (
                      <div key={rec.draft_id} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
                        <button className='w-full text-left hover:underline' onClick={() => openBuildDraft(rec)}>
                          <span className='font-medium'>{rec.title || rec.kind}</span>
                          <span className='ml-2 text-muted'>{rec.status || 'processed'}</span>
                        </button>
                        <div className='mt-1 text-muted'>{rec.updated_at || rec.created_at || 'no timestamp'}</div>
                        <div className='mt-1 flex flex-wrap items-center gap-1 text-muted'>
                          {acceptedScopeLabels(rec).length ? <Badge tone='success'>{acceptedScopeLabels(rec).join(', ')}</Badge> : null}
                          {rec.accepted_target ? <span>target: {rec.accepted_target}</span> : null}
                          {rec.rejection_reason ? <span>{rec.rejection_reason}</span> : null}
                        </div>
                        <div className='mt-1 flex gap-1'>
                          <Button className='text-xs' onClick={() => openBuildDraft(rec)}>打开</Button>
                          <Button className='text-xs' onClick={() => restoreBuildDraft(rec)}>恢复待确认</Button>
                        </div>
                      </div>
                    ))}
                    {!buildDraftHistoryRows.length && <div className='text-xs text-muted'>没有符合筛选的已处理草案。</div>}
                  </div>
                </div>
              </div>
              <div className='col-span-12 xl:col-span-7'>
                {buildDraft ? (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <div className='text-sm font-medium'>{buildDraft.title} <span className='text-xs text-muted'>rev {buildDraft.revision}</span></div>
                      <div className='flex gap-2'>
                        <Button className='text-xs' disabled={buildDraftBusy} onClick={() => generateBuildDraft(buildDraft.kind)}>{buildDraftBusy ? '生成中...' : '刷新这一环节'}</Button>
                        <Button className='text-xs' variant='primary' onClick={acceptBuildDraft}>确认写入</Button>
                      </div>
                    </div>
                    <div className='flex flex-wrap gap-2 text-xs text-muted'>
                      <Badge>{buildDraft.status || 'pending'}</Badge>
                      <Badge>{buildDraft.source || 'local'}</Badge>
                      {acceptedScopeLabels(buildDraft).length ? <Badge tone='success'>已接受: {acceptedScopeLabels(buildDraft).join(', ')}</Badge> : null}
                      {buildDraft.accepted_target ? <Badge>写入: {buildDraft.accepted_target}</Badge> : null}
                      {buildDraft.rejection_reason ? <Badge tone='warn'>拒绝: {buildDraft.rejection_reason}</Badge> : null}
                      {buildDraft.draft_id ? <span>{buildDraft.draft_id}</span> : <span>未落盘 fallback</span>}
                    </div>
                    {renderBuildDraftEditor()}
                    <WritingReferenceNotice usage={buildDraft.writing_reference_usage} />
                  </div>
                ) : (
                  renderBuildDraftEditor()
                )}
              </div>
            </div>
          </Card>
</div></details>
          <section className='border-t border-border pt-4'><details><summary className='cursor-pointer text-sm text-muted'>切换或新建故事</summary><div className='mt-3 flex flex-wrap gap-2'>{(storyCards || []).filter((card: any) => card.id !== storyForm.id).map((card: any) => <Button key={card.id} onClick={() => setStoryForm(cardDraftCache.current[`${project}:story:${card.id}`] || normalizeStoryCard(card))}>{card.title || '未命名故事'}</Button>)}<Button onClick={() => { if (storyForm.id === 'story_new' && storyLocal.dirty && !window.confirm('当前新故事尚未保存，确定另起一个空白故事？本地草稿仍保留。')) return; setStoryForm(normalizeStoryCard(null)) }}>新建故事</Button></div></details></section>
        </div>
      )
    }

    if (view === 'characters') {
      const payload = characterForm?.payload || {}
      const people = (Array.isArray(chars) ? chars : []).slice().sort((a: any, b: any) => Number(b.payload?.importance || 0) - Number(a.payload?.importance || 0))
      const createPerson = () => { if (characterForm.id === 'character_new' && (characterForm.payload?.name || characterForm.payload?.identity) && !window.confirm('当前新人物尚未保存，确定另起一张人物卡？')) return false; setCharacterForm({ id: 'character_new', type: 'character', title: '', tags: [], links: [], _revision: '', payload: { name: '', identity: '', detail_level: 'brief' } }); setCharacterEditorOpen(true); return true }
      const backgroundPeople = people.filter((card: any) => card.payload?.detail_level === 'brief' && !['protagonist', 'supporting', 'antagonist'].includes(card.payload?.role))
      const mainPeople = people.filter((card: any) => !backgroundPeople.includes(card))
      const personTable = (members: any[]) => <table className="index-table">
        <thead><tr><th scope="col">姓名</th><th scope="col">身份</th></tr></thead>
        <tbody>{members.map((card: any) => <tr key={card.id}>
          <td><button className="index-link focus-ring" onClick={() => {
            setCharacterForm(cardDraftCache.current[`${project}:character:${card.id}`] || card)
            setPersonPane('概况')
            setCharacterEditorOpen(true)
          }}>
            {card.payload?.reference_image?.asset_id && <img className="index-portrait" alt="" src={`/api/projects/${project}/character-images/${encodeURIComponent(card.payload.reference_image.asset_id)}`} />}
            {card.payload?.name || card.title || '未命名人物'}
          </button></td>
          <td>{card.payload?.identity || '—'}</td>
        </tr>)}</tbody>
      </table>
      if (!characterEditorOpen) return <div className="space-y-6">
        <header className='story-heading'><div><h1 className='page-title'>人物</h1></div><div className='flex flex-wrap gap-2'><Button onClick={createPerson}>创建人物</Button><Button onClick={() => { if (!createPerson()) return; setTimeout(() => { const field = document.getElementById('character-idea'); const panel = field?.closest('details'); if (panel) panel.open = true; field?.focus() }, 0) }}>AI 构思人物</Button></div></header>
        <div className="people-overview">
          <KnowledgeGraph project={project} overview title="人物关系" onOpen={openMaterial} showStages />
          <section aria-label="人物名册"><h2 className="index-heading">人物名册</h2>
            {people.length ? personTable(mainPeople.length ? mainPeople : backgroundPeople) : <p className="text-sm text-muted">暂无人物</p>}
            {mainPeople.length > 0 && backgroundPeople.length > 0 && <details className="mt-3"><summary>其他人物（{backgroundPeople.length}）</summary>{personTable(backgroundPeople)}</details>}
          </section>
        </div>
        <details><summary>管理关系</summary><SharedRelationships project={project} worldContext={storyForm.payload?.world_context} storyId={storyForm.id} onOpen={openMaterial} /></details>
      </div>
      return (
        <div className='space-y-3 density-space'>
          {characterLocal.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>有未保存的人物草稿。</p><div className='flex gap-2'><Button onClick={characterLocal.restore}>恢复草稿</Button><Button variant='ghost' onClick={characterLocal.dismiss}>保留保存版</Button></div></div>}
          <div className='flex flex-col items-start gap-3'><Button className='-ml-3 text-xs' disabled={cardSaveState[`${project}:${characterForm.id}`] === '保存中…'} variant='ghost' onClick={() => setCharacterEditorOpen(false)}>返回人物总览</Button><h1 className='page-title'>{payload.name || characterForm.title || '新人物'}</h1>{payload.detail_level === 'brief' && <Button onClick={() => setCharacterForm({ ...characterForm, payload: { ...payload, detail_level: 'detailed' } })}>展开完整人物卡</Button>}</div>
          <nav aria-label='人物详情' className='story-task-nav'>{['概况','关系','经历'].map(label => <button key={label} aria-current={personPane === label ? 'page' : undefined} onClick={() => setPersonPane(label)}>{label}</button>)}</nav>
          {personPane === '关系' && <><SharedRelationships project={project} entityId={characterForm.id} storyId={storyForm.id} onOpen={openMaterial} />
          {characterForm.id !== 'character_new' && <FamilyWorkspace key={`${project}:${characterForm.id}:family`} project={project} entityId={characterForm.id} storyId={storyForm.id} worldContext={payload.world_context || storyForm.payload?.world_context} disabled={characterLocal.dirty} onOpen={openMaterial} />}</>}
          {personPane === '经历' && characterForm.id !== 'character_new' && <AuthorStatePanel onOpenEvent={enterStoryEvent} project={project} entityId={characterForm.id} storyId={storyForm.id} eventRef={eventOrigin ? `${eventOrigin.ref.owner_card_id}:important_scenes:${eventOrigin.ref.scene_id}` : undefined} focusRequest={materialFocusRequest?.id === characterForm.id ? materialFocusRequest : null} />}
          {personPane === '概况' && <>

          <details className='py-2'><summary className='cursor-pointer text-sm font-medium'>创建或切换人物</summary><section className='mt-4 space-y-3' aria-label='生成人物'>
            <div className='flex flex-wrap items-end gap-2'>
              <div className='min-w-40 flex-1'><label htmlFor='character-select' className='text-sm text-muted'>选择人物</label>
                <Select disabled={cardSaveState[`${project}:${characterForm.id}`] === '保存中…'} id='character-select' value={characterForm?.id || 'character_new'} onChange={(e) => setCharacterForm(cardDraftCache.current[`${project}:character:${e.target.value}`] || (Array.isArray(chars) ? chars : []).find((card: any) => card.id === e.target.value) || { id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })}>
                  {characterForm?.id === 'character_new' && <option value='character_new'>新人物</option>}
                  {(Array.isArray(chars) ? chars : []).map((card: any) => <option key={card.id} value={card.id}>{card.payload?.name || card.title || '未命名人物'}</option>)}
                </Select>
              </div>
              <Button disabled={cardSaveState[`${project}:${characterForm.id}`] === '保存中…'} onClick={createPerson}>新建人物</Button>
            </div>
            <label htmlFor='character-idea' className='block text-sm font-medium'>让 AI 帮你设定一个新人物</label>
            <Textarea id='character-idea' value={characterInstructions} onChange={(e) => setCharacterInstructions(e.target.value)} placeholder='例如：一个嘴硬心软的医生，与主角有旧怨。留空可以随机构思。' />
            <div className='flex flex-wrap gap-2'><Button disabled={buildDraftBusy} onClick={() => generateBuildDraft('character_seed')}>{buildDraftBusy ? '构思中…' : 'AI 构思人物'}</Button><Button onClick={() => { setActiveActivity('settings'); setView('settings') }}>设置使用的模型</Button></div>
          </section>
          </details>
          {buildDraft?.kind === 'character_seed' && buildDraft.status === 'pending' && parsedBuildDraft && <section className='space-y-3 border-b border-border pb-4' aria-label='人物草案预览'>
            <h3 className='font-semibold'>新人物草案</h3><p className='text-sm text-muted'>可以继续编辑，确认保存后才成为作品的人物设定。</p>
            <WritingReferenceNotice usage={buildDraft.writing_reference_usage} />
            <SchemaForm schema={charSchema} value={parsedBuildDraft} onChange={writeBuildDraftBody} projectId={project} profileId={useAgentAssignments ? undefined : llmProfileId} references={Array.isArray(chars) ? chars : []} onOpenMaterial={openMaterial} />
            <div className='flex gap-2'><Button variant='primary' onClick={acceptBuildDraft}>确认保存人物</Button><Button onClick={() => setBuildDraft(null)}>暂不采用</Button></div>
          </section>}
          <details className='py-2'><summary className='cursor-pointer text-sm font-medium'>人物角色与年龄{payload.role ? `（${({protagonist:'主角',supporting:'配角',antagonist:'对手'} as Record<string,string>)[payload.role] || '其他'}${payload.initial_age !== undefined ? `，初始 ${payload.initial_age} 岁` : ''}）` : ''}</summary><section className='mt-4 space-y-4'><h2 className='sr-only'>人物在故事中的位置</h2><div className='grid grid-cols-1 gap-4 sm:grid-cols-2'><div><label className='mb-1 block text-sm text-muted' htmlFor='character-role'>人物角色</label><Select id='character-role' value={payload.role || 'other'} onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, role: e.target.value } })}><option value='protagonist'>主角</option><option value='supporting'>配角</option><option value='antagonist'>对手</option><option value='other'>其他人物</option></Select></div><div><label className='mb-1 block text-sm text-muted' htmlFor='character-initial-age'>初始年龄（可选）</label><Input id='character-initial-age' type='number' min={0} value={payload.initial_age ?? payload.age ?? ''} onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, initial_age: e.target.value === '' ? undefined : Number(e.target.value) } })} placeholder='未知时留空' /></div><div><label className='mb-1 block text-sm text-muted' htmlFor='character-initial-year'>这个年龄对应哪一年</label><Input id='character-initial-year' type='number' step={1} value={payload.initial_age_time?.year ?? ''} onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, initial_age_time: { ...payload.initial_age_time, year: e.target.value === '' ? undefined : Number(e.target.value) } } })} placeholder='不清楚时不推算过去 / 未来年龄' /></div><div><label className='mb-1 block text-sm text-muted' htmlFor='character-birth-date'>明确的出生日期（可选）</label><Input id='character-birth-date' type='date' value={payload.birth_date || ''} onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, birth_date: e.target.value || undefined } })} /></div></div></section>
          </details>
          <CharacterReferenceImage key={`${project}:${characterForm.id}`} project={project} characterId={characterForm.id} value={payload.reference_image} appearance={payload.appearance || ''} profileId={useAgentAssignments ? undefined : llmProfileId} onImageChange={(image) => setCharacterForm((current: any) => { if (current.id !== characterForm.id) return current; const next = { ...current.payload }; if (image) next.reference_image = image; else delete next.reference_image; return { ...current, payload: next } })} onApplyAppearance={(appearance) => setCharacterForm((current: any) => current.id === characterForm.id ? { ...current, payload: { ...current.payload, appearance, field_provenance: { ...current.payload?.field_provenance, appearance: 'ai_addition' } } } : current)} onOpenSettings={() => { setActiveActivity('settings'); setView('settings') }} />
          <SchemaForm storyId={storyForm.id} nameWorldContext={payload.world_context || storyForm.payload?.world_context} lockedPaths={characterLockedPaths} hiddenFields={['detail_sections', 'age', 'initial_age', 'initial_age_time', 'birth_date', 'role', 'relationships']} schema={charSchema} value={characterForm} focusRequest={materialFocusRequest?.id === characterForm.id ? materialFocusRequest : null} projectId={project} profileId={useAgentAssignments ? undefined : llmProfileId} references={Array.isArray(chars) ? chars : []} onOpenMaterial={openMaterial} onChange={(next) => setCharacterForm({ ...next, title: next.payload?.name || next.payload?.identity || '未命名人物' })} />
          <CharacterDetails key={`${project}:${characterForm.id}:details`} focusRequest={materialFocusRequest?.id === characterForm.id ? materialFocusRequest : null} project={project} characterId={characterForm.id} value={payload.detail_sections || []} lockedPaths={characterLockedPaths} onChange={(detail_sections) => setCharacterForm({ ...characterForm, payload: { ...payload, detail_sections, field_provenance: { ...payload.field_provenance, detail_sections: 'author_edit' } } })} />
          <div className='space-y-2'><Button variant='primary' disabled={cardSaveState[`${project}:${characterForm.id}`] === '保存中…'} onClick={saveCurrentCharacter}>保存人物</Button><p role='status' className='text-xs text-muted'>{cardSaveState[`${project}:${characterForm.id}`]?.startsWith('保存失败') || cardSaveState[`${project}:${characterForm.id}`] === '保存中…' ? cardSaveState[`${project}:${characterForm.id}`] : characterLocal.dirty ? '有未保存的修改' : cardSaveState[`${project}:${characterForm.id}`] || ''}</p></div>
          {characterForm.id !== 'character_new' && <><AuthorControls key={`${project}:${characterForm.id}:lock`} project={project} target={`cards/${characterForm.id}.yaml`} label='人物' value={characterForm} revision={characterForm._revision} dirty={characterLocal.dirty} onChanged={(value, result) => { const next = { ...value, _revision: result.base_revision }; setCharacterForm(next); characterLocal.markSaved(characterForm, next); refreshSharedMaterials() }} /><InformationPanel key={`${project}:${characterForm.id}:information`} project={project} characterId={characterForm.id} storyId={storyForm.id} title='经历中的关键信息与认知变化' value={payload.information_ids || []} onChange={(information_ids) => setCharacterForm({ ...characterForm, payload: { ...payload, information_ids } })} /></>}
          {characterForm.id && characterForm.id !== 'character_new' && <details open={materialFocusRequest?.id === characterForm.id && !materialFocusRequest?.editPath} className='py-3'><summary className='cursor-pointer text-sm font-medium'>人物关系与阶段变化</summary><div className='mt-4'><KnowledgeGraph project={project} focusId={characterForm.id} onOpen={openMaterial} showStages title={`${payload.name || characterForm.title || '此人'}的共享关系`} /></div></details>}

          <details><summary className='cursor-pointer text-xs text-muted'>旧章节引用与检查记录</summary><Card title='已有人物' extra={<Badge>{selectedChapter}</Badge>}>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
              {(Array.isArray(chars) ? chars : []).map((card: any) => {
                const traces = traceRowsFor('character', [card.id, card.title, card.payload?.name])
                return (
                  <button key={card.id} className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2' onClick={() => setCharacterForm(cardDraftCache.current[`${project}:character:${card.id}`] || card)}>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='text-sm font-medium'>{card.title || card.id}</span>
                      <Badge tone={traceBadgeTone(traces) as any}>{traceSummary(traces)}</Badge>
                    </div>
                    <div className='mt-1 text-xs text-muted'>用于章节: {traces.map((mark: any) => mark.chapter_id).filter(Boolean).join(', ') || '暂无'}</div>
                    <div className='mt-1 text-xs text-muted'>检查环节：{Array.from(new Set(traces.map((mark: any) => mark.agent_trace?.stage).filter(Boolean))).join(', ') || '暂无'}</div>
                  </button>
                )
              })}
              {(!Array.isArray(chars) || !chars.length) && <p className='text-sm text-muted'>暂无人物卡。</p>}
            </div>
          </Card></details>
          </>}
        </div>
      )
    }

    if (view === 'style') {
      return (
        <div className='space-y-3 density-space'>
          <CardEditor onActiveCardChange={setActiveStyleCardId} sampleIds={activeStyleAssets} key={`${project}:style`} project={project} type='style' pendingCandidate={styleCandidate} onCandidateCleared={() => setStyleCandidate(null)} profileId={useAgentAssignments ? undefined : llmProfileId} onSaved={() => { mutateStyles(); refreshSharedMaterials() }} draftCache={cardDraftCache} referenceRequest={cardReferenceRequest} onOpenMaterial={openMaterial} focusRequest={materialFocusRequest} />
          <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>导入文风参考：文字、文件、图片或链接</summary><div className='mt-4'><MaterialImportWorkspace project={project} purpose='style' isTargetDirty={isSettingDirty} storyId={storyForm.id} profileId={useAgentAssignments ? undefined : llmProfileId} onApplied={refreshSharedMaterials} /></div></details>
          <details><summary className='cursor-pointer text-sm font-medium'>从作者原样本文字分析文风</summary>
          <Card title='文风样本'>
            <div className='space-y-2'>
              <Textarea className='h-28' value={styleUploadText} onChange={(e) => setStyleUploadText(e.target.value)} placeholder='粘贴文风样本文本 txt/md' />
              <div className='flex gap-2'>
                <Button onClick={uploadStyleSample}>上传样本</Button>
                <Button variant='primary' onClick={analyzeStyle}>分析文风</Button>
              </div>
              <div className='text-xs text-muted'>已选原文样本：{activeStyleAssets.length} 份。只分析作者参考样本，不把 AI 短例混入样本。</div>
            </div>
          </Card>
          </details>
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
          label: '确认 AI 草稿',
          done: acceptedChapterReviews.length > 0 || (chapterReviewList.length > 0 && pendingChapterReviews.length === 0),
          detail: pendingChapterReviews.length ? `${pendingChapterReviews.length} 个 AI 草稿待确认` : chapterReviewList.length ? 'AI 草稿已处理' : '生成后这里会出现待审草稿',
          action: pendingChapterReviews.length ? '确认第一条' : '查看草稿',
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
          detail: evidenceMarkRows.length ? `${evidenceMarkRows.length} 个证据点` : '还没有检查正文',
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
      const chapterBrief = currentChapterBrief()
      const agreementText = effectiveChapterAgreement()
      const alignmentReady = Boolean(alignmentConfirmed && agreementText.trim())
      return (
        <div className='space-y-3 density-space'>
          <header className='chapter-heading'><input aria-label='章节标题' className='story-title' value={chapterTitleDraft} onChange={e => setChapterTitleDraft(e.target.value)} placeholder='章节标题' /><nav className='story-task-nav' aria-label='章节视图'>{['正文','本章安排'].map(label => <button key={label} aria-current={chapterPane === label ? 'page' : undefined} onClick={() => setChapterPane(label)}>{label}</button>)}</nav><Button className='text-xs' onClick={() => { setChapterReferencesOpen(false); setChapterMaterialsOpen(true) }}>本次生成材料</Button></header>
          {chapterLocal.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>有未保存的章节草稿，可恢复后对照。</p><div className='flex gap-2'><Button onClick={chapterLocal.restore}>恢复本地正文</Button><Button variant='ghost' onClick={chapterLocal.dismiss}>保留保存版</Button></div></div>}
          <div hidden={chapterPane !== '正文'}>
          <section className='manuscript-sheet space-y-3' aria-label='章节正文编辑'>{draftReadError && <div className='space-y-2'><p role='alert' className='text-sm text-red-700 dark:text-red-300'>正文暂时未能读取，当前编辑仍保留。重新读取成功后再保存或生成。</p><Button onClick={() => { void mutateDraft().catch(() => undefined) }}>重新读取正文</Button></div>}<ManuscriptEditor positions={writingPositions.current} sceneRef={selectedSceneAnchor?.key === `${project}:${selectedChapter}:${storyForm.id}` ? selectedSceneAnchor : undefined} baseRevision={editorSnapshotRef.current.revision} techniques={Array.isArray(techniqueCards) ? techniqueCards.filter((card: any) => !isIncompleteReference(card)) : []} key={chapterScopeKey} project={project} chapterId={selectedChapter} text={chapterEditorText} saved={chapterEditorText === draft?.content && chapterTitleDraft === editorSnapshotRef.current.title && !pendingChapterReferences && !pendingChapterMaterials} saving={chapterSaving} locked={!draft || isChapterGenerating || Boolean(draftReadError) || pointerLocked(chapterLockedPaths,'/')} onSave={saveChapterDraft} onChange={setChapterEditorText} onApplied={(content, revision) => {
              editorSnapshotRef.current = { ...editorSnapshotRef.current, content, revision }
              void mutateDraft()
              void mutateVersions()
              void mutateDraftDetails()
            }} sceneDirection={sceneDirection} profileId={useAgentAssignments ? undefined : llmProfileId} storyCardId={storyForm?.id} />
          </section></div>
          <div hidden={chapterPane !== '本章安排'}>
          <NameReferences key={`${chapterScopeKey}:names`} project={project} chapterId={selectedChapter} storyId={storyForm.id} target={`drafts/${selectedChapter}.md`} revision={draft?.revision} metaRevision={hasChapterContextDraft ? chapterContext.meta_revision : editorSnapshotRef.current.metaRevision} text={chapterEditorText} dirty={chapterEditorText !== (draft?.content || '')} worldContext={chapterContext.world_context} onOpen={openMaterial} onSaved={(result) => {
            if (editorSnapshotRef.current.key !== chapterScopeKey || !result.meta_revision) return
            const before = { content: chapterEditorText, title: chapterTitleDraft, base_revision: editorSnapshotRef.current.revision, meta_revision: editorSnapshotRef.current.metaRevision, context: hasChapterContextDraft ? chapterContext : undefined }
            if (chapterEditorText === editorSnapshotRef.current.content && chapterTitleDraft === editorSnapshotRef.current.title) chapterLocal.markSaved(before, { ...before, meta_revision: result.meta_revision, context: hasChapterContextDraft ? { ...chapterContext, meta_revision: result.meta_revision } : undefined })
            const pending = cardDraftCache.current[`${chapterScopeKey}:contextDraft`]
            if (pending) cardDraftCache.current[`${chapterScopeKey}:contextDraft`] = { ...pending, meta_revision: result.meta_revision }
            setChapterContextDraft((current: any) => current?.key === chapterScopeKey ? { ...current, meta_revision: result.meta_revision } : current)
            if (!alignmentLocal.dirty && alignmentEditor) alignmentLocal.markSaved(alignmentEditor, { ...alignmentEditor, base_revision: result.meta_revision })
            editorSnapshotRef.current.metaRevision = result.meta_revision; alignmentSavedRef.current.revision = result.meta_revision; void mutateDraft()
          }} />
            <AuthorControls key={`${project}:${selectedChapter}:bodylock`} project={project} target={`drafts/${selectedChapter}.md`} label='正文' value={chapterEditorText} revision={draft?.revision} dirty={chapterEditorText !== draft?.content} onChanged={(content, result) => { setChapterEditorText(content); editorSnapshotRef.current.revision = result.base_revision; void mutateDraft(); void mutateVersions() }} />
          <SuspensePanel key={`${chapterScopeKey}:${storyForm.id}:${currentChapterMeta.world_context?.branch_id || ''}`} project={project} storyId={storyForm.id}
            chapter={{ id: selectedChapter, revision: draft?.revision, dirty: chapterEditorText !== draft?.content, profileId: useAgentAssignments ? undefined : llmProfileId,
              openOutline: () => { setActiveActivity('story'); setView('story'); setStoryPlanningTab('Outline') } }} />
          <WritingRunPanel project={project} hasUnsavedChanges={chapterEditorText !== (draft?.content || '') || Boolean(pendingChapterReferences || pendingChapterMaterials)} onProgress={refreshWritingOutputs} />
          <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>本章准备、场景安排与写法</summary><div className='mt-4'>
          {alignmentLocal.recovery && <div className='mb-4 space-y-2'><p className='text-sm'>找到本章尚未保存的补充与写法。</p><div className='flex gap-2'><Button onClick={alignmentLocal.restore}>恢复本章写法</Button><Button variant='ghost' onClick={alignmentLocal.dismiss}>保留保存版</Button></div></div>}
          <Card title='本章准备' extra={<Badge tone={alignmentReady ? 'success' : 'default'}>{alignmentReady ? '写法已确认' : '确认后生成'}</Badge>}>
            <div className='space-y-2'>
              <label htmlFor='chapter-changes' className='story-field-label'>本章补充与变化（可选）</label>
              <Textarea id='chapter-changes' className='min-h-24 leading-7' value={alignmentIdea} onChange={(event) => { setAlignmentIdea(event.target.value); setAlignmentConfirmed(false) }} placeholder='例如：新增来客、隐瞒身份或调整结尾。' />
              <p className='text-xs leading-5 text-muted'>章节计划、情节工作表、人物和世界设定继续沿用保存版。没有新增变化时，这里可以留空。</p>
              <details className='border-y border-border py-3'><summary className='cursor-pointer text-sm text-muted'>本章世界、发生时间与视角（默认继承故事）</summary><div className='mt-3 space-y-3'><WorldContextFields project={project} storyId={storyForm.id} value={chapterContext.world_context} onChange={(world_context) => updateChapterContext({ world_context })} inherited='本章默认沿用故事背景；事件 / 场景可以进一步覆盖。讲述的先后不等于事情发生的先后。' /><label className='block text-xs text-muted' htmlFor='chapter-pov'>本章叙述视角</label><Input id='chapter-pov' value={chapterContext.pov} onChange={(e) => updateChapterContext({ pov: e.target.value })} placeholder='留空沿用文风默认；事件更具体的选择仍优先。' /><label className='block text-xs text-muted' htmlFor='chapter-pov-character'>谁的认知限制本章叙述</label><Select id='chapter-pov-character' value={chapterContext.pov_character_id} onChange={(e) => updateChapterContext({ pov_character_id: e.target.value })}><option value=''>未指定 / 继承</option>{(Array.isArray(chars) ? chars : []).map((person: any) => <option key={person.id} value={person.id}>{person.payload?.name || person.title || '未命名人物'}</option>)}</Select><p className='text-xs text-muted'>视角人物用于筛选其所知；不会从“第三人称”等文字猜测人物知道什么。与正文一起保存后生效。</p></div></details>
            </div>
            <InformationPanel key={`${project}:${selectedChapter}:info`} project={project} chapterId={selectedChapter} storyId={storyForm.id} text={chapterEditorText} revision={draft?.revision} dirty={chapterEditorText !== draft?.content} value={chapterContext.information_ids || []} onChange={(information_ids) => updateChapterContext({ information_ids })} title='本章透露的信息与读者已见' />
            <ChapterSceneRehearsals project={project} chapterId={selectedChapter} storyId={storyForm?.id} selectedScene={selectedSceneAnchor?.key === `${project}:${selectedChapter}:${storyForm?.id}` ? selectedSceneAnchor : undefined} onSelectScene={(row) => setSelectedSceneAnchor(row ? { key: `${project}:${selectedChapter}:${storyForm?.id}`, owner_card_id: row.owner_card_id, scene_id: row.scene_id } : null)} onOpen={openSceneRehearsal} onOpenPlanning={() => { setActiveActivity('planning'); setView('planning') }} />
            <details className='mt-5 border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>这一段怎么写（可选）</summary><section className='mt-4 space-y-4' aria-label='场景写法'>
              <div><p className='text-sm text-muted'>从人的感受出发，想清楚这段在故事中的作用。下面都可选，不必填满；最终仍写成小说正文。</p></div>
              <ProseStrategy value={sceneDirection.prose_strategy} onChange={(prose_strategy) => updateSceneDirection((current) => ({ ...current, prose_strategy }))} />
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div><label htmlFor='scene-perception' className='mb-1 block text-sm font-medium'>谁在感受？他此刻最在意什么？</label><Textarea id='scene-perception' value={sceneDirection.perception} onChange={(e) => updateSceneDirection((previous) => ({ ...previous, perception: e.target.value }))} placeholder='例如：林秋只在意信上的日期，暂时没注意门外的脚步。' /></div>
                <div><label htmlFor='scene-reader_feeling' className='mb-1 block text-sm font-medium'>希望读者感受到什么？</label><Textarea id='scene-reader_feeling' value={sceneDirection.reader_feeling} onChange={(e) => updateSceneDirection((previous) => ({ ...previous, reader_feeling: e.target.value }))} placeholder='例如：先松一口气，再慢慢感到不安。' /></div>
              </div>
              <div className='space-y-2'><label htmlFor='scene-function-choice' className='block text-sm font-medium'>这一段改变什么，或起什么作用？</label><Select id='scene-function-choice' value={['推进剧情', '表现人物', '埋伏笔', '回收伏笔', '转折', '蓄势'].find((label) => sceneDirection.dramatic_function.startsWith(label)) || ''} onChange={(e) => { const choice = e.target.value; updateSceneDirection((previous) => { const note = previous.dramatic_function.replace(/^(推进剧情|表现人物|埋伏笔|回收伏笔|转折|蓄势)[：:]?\s*/, ''); return { ...previous, dramatic_function: choice ? `${choice}${note ? `：${note}` : ''}` : note } }) }}><option value=''>可选一个作用，也可直接写下想法</option>{['推进剧情', '表现人物', '埋伏笔', '回收伏笔', '转折', '蓄势'].map((label) => <option key={label} value={label}>{label}</option>)}</Select><Textarea aria-label='补充这一段的作用' value={sceneDirection.dramatic_function} onChange={(e) => updateSceneDirection((previous) => ({ ...previous, dramatic_function: e.target.value }))} placeholder='例如：表现人物——她没有拆穿谎言，决定暂时继续合作。' /></div>
              <details><summary className='cursor-pointer text-sm text-muted'>补充画面素材（可选）</summary><p className='my-3 text-xs text-muted'>远景、特写和环境只是描写关注点的提示，不会生成机位标签或镜头脚本。</p>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                {[['shots', '参考画面或镜头', '例如：先看到被雨淋湿的信，再注意到门外的人。'], ['setting', '布景与氛围', '时间、光线、声音、物件，哪些值得保留？'], ['motivation', '人物此刻想做什么', '想得到什么，又在掩饰或害怕什么？'], ['performance', '无台词的动作与表情', '用动作、停顿和神态呈现人物，不必说出情绪。'], ['focus', '远景、特写与描写焦点', '先写整体环境，还是聚焦一个细节？读者此刻应注意什么？'], ['atmosphere', '用环境烘托情绪', '例如：空屋回声、忽明忽暗的灯、未喝完的茶，如何衬托人物心境？']].map(([key, label, placeholder]) => <div key={key}><label htmlFor={`scene-${key}`} className='mb-1 block text-sm text-muted'>{label}</label><Textarea id={`scene-${key}`} value={(sceneDirection as any)[key]} onChange={(e) => updateSceneDirection((previous) => ({ ...previous, [key]: e.target.value }))} placeholder={placeholder} /></div>)}
              </div>
              </details>

            </section></details>
            <CharacterDetailFocus chapterId={selectedChapter} storyId={storyForm.id} eventRef={selectedSceneAnchor?.key === `${project}:${selectedChapter}:${storyForm.id}` ? selectedSceneAnchor : undefined} project={project} value={characterDetailFocus[characterFocusKey] || {}} onChange={(value) => setCharacterDetailFocus((current) => ({ ...current, [characterFocusKey]: value }))} />
            <div className='my-4'><Button onClick={() => { setAlignmentConfirmed(false); void saveWritingAlignment({ confirmed: false }) }}>保存本章补充</Button></div>
            <ChapterBranchTools compareRequest={versionCompareRequest} profileId={useAgentAssignments ? undefined : llmProfileId} key={`${project}:${selectedChapter}:branch`} project={project} chapterId={selectedChapter} storyId={storyForm.id} revision={draft?.revision} dirty={chapterEditorText !== draft?.content || isChapterGenerating} onRestored={content => { setChapterEditorText(content); void mutateDraft(); void mutateVersions() }} />
            <TrialWritingTools sceneDirection={sceneDirection} key={`${project}:${selectedChapter}:trial`} storyId={storyForm.id} project={project} chapterId={selectedChapter} text={chapterEditorText} revision={draft?.revision} dirty={chapterEditorText !== draft?.content} isGenerating={isChapterGenerating} profileId={useAgentAssignments ? undefined : llmProfileId} onApplied={(content) => { setChapterEditorText(content); void mutateDraft(); void mutateVersions() }} />
            <section className='chapter-agreement' aria-label='本章写法预览'>
              <div className='flex flex-wrap items-baseline justify-between gap-2'><h3 className='text-base font-semibold'>本章写法</h3><span className='text-xs text-muted'>{alignmentAgreedDraft && alignmentAgreedDraft !== alignmentUnderstanding ? '保留你的修订' : '根据已保存策划整理'}</span></div>
              <p className='mt-2 text-xs leading-5 text-muted'>已有计划与上面的补充会自动整理在这里，不额外消耗模型额度。看过后确认即可，也可以修改这份写法。</p>
              {agreementText ? <div className='chapter-brief-text whitespace-pre-wrap'>{agreementText}</div> : <p className='py-5 text-sm text-muted'>还没有本章安排。可以先在情节工作表关联这一章，或在上面补一句这章发生什么变化。</p>}
              {chapterBrief.omitted > 0 && <p className='text-xs text-muted'>另有 {chapterBrief.omitted} 项规划未在预览展开，可在本章材料中回看；这份预览不替代生成时的按章取材。</p>}
              <details className='my-4'><summary className='cursor-pointer text-sm text-brand-600'>调整这份写法（可选）</summary><label htmlFor='chapter-agreement-edit' className='mt-3 block text-xs text-muted'>你的最终写法</label><Textarea id='chapter-agreement-edit' className='mt-2 min-h-40 leading-7' value={agreementText} onChange={(event) => { setAgreementEditingKey(`${project}:${selectedChapter}`); setAlignmentAgreedDraft(event.target.value); setAlignmentConfirmed(false) }} /><Button className='mt-3 text-xs' onClick={generateAlignmentUnderstanding}>从最新策划重建写法</Button><p className='mt-2 text-xs text-muted'>重建会替换这份预览中的修订，已有正文保持原样。</p></details>
              <div className='flex flex-wrap gap-2'><Button disabled={!agreementText.trim()} onClick={confirmWritingAlignment}>确认这份写法</Button><Button variant='primary' disabled={!alignmentReady} onClick={requestRunJobWithAgreement}>生成正文</Button></div>
            </section>
            <details id='chapter-materials' className='chapter-materials'>
              <summary className='cursor-pointer text-sm font-medium'>本章材料与写作参考</summary>
              <p className='mt-4 text-sm leading-7 text-muted'>作品设定会按本章需要检索。这里可以回看策划来源，或明确指定这一章特别要用的资料；无需重复抄写设定。</p>
              {chapterBrief.sources.length > 0 && <section className='my-4 space-y-2' aria-label='本章策划来源'><h3 className='text-sm font-medium'>本章策划来源</h3><ul className='flex flex-wrap gap-x-4 gap-y-2'>{chapterBrief.sources.map((source) => <li key={source.id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => openMaterial(source)}>{source.label}</button></li>)}</ul></section>}
              <div className='my-4 flex flex-wrap gap-2'><Button onClick={() => { setActiveActivity('planning'); setView('planning') }}>情节工作表</Button><Button onClick={() => { setActiveActivity('cards'); setView('characters') }}>人物设定</Button><Button onClick={() => { setActiveActivity('cards'); setView('world') }}>世界观与地图</Button></div>
              <Button className='my-4 text-xs' onClick={() => setChapterReferencesOpen(true)}>选择本章写法参考{selectedChapterReferenceIds.length ? `（${selectedChapterReferenceIds.length}）` : ''}</Button>
              <details className='my-4 border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>指定本章关联资料</summary><p className='mt-3 text-xs leading-5 text-muted'>只在需要特指某个人物、世界条目、往章或情节时添加。它们继续引用原资料，修改后会读取新版。</p><div className='mt-4'><MaterialReferences project={project} sourceId={selectedChapter} value={selectedChapterMaterials} onChange={updateChapterMaterials} onOpen={openMaterial} hint='关联在下方保存后生效，后续写作仍遵守章节时间与人物所知边界。' /></div></details>
              <Button onClick={saveChapterDraft} disabled={chapterSaving}>{chapterSaving ? '保存中…' : '保存本章参考与关联'}</Button>
              <p className='mt-2 text-xs text-muted'>同时保存当前正文；未提交的本章补充仍保留在表单中。</p>
            </details>
            <details className='mt-3 rounded-ui border border-border bg-surface-2'>
              <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>补充与修改共识 <span className='text-xs text-muted'>({alignmentMessages.length})</span></summary>
              <div className='grid grid-cols-1 gap-3 border-t border-border p-3 xl:grid-cols-2'>
                <div className='max-h-48 space-y-2 overflow-auto'>
                  {alignmentMessages.map((msg: any, idx: number) => (
                    <div key={`${msg.created_at || idx}:${idx}`} className={`rounded-ui border p-2 text-xs ${msg.role === 'author' ? 'border-brand-500 bg-surface' : 'border-border bg-panel'}`}>
                      <div className='mb-1 font-medium'>{msg.role === 'author' ? '作者' : '整理记录'}</div>
                      <div className='whitespace-pre-wrap text-muted'>{msg.text}</div>
                    </div>
                  ))}
                  {!alignmentMessages.length && <p className='text-xs text-muted'>可以记录补充意见，再确认最终写法。</p>}
                </div>
                <div>
                  <Textarea
                    className='min-h-[110px] resize-y'
                    value={alignmentDiscussionInput}
                    onChange={(e) => setAlignmentDiscussionInput(e.target.value)}
                    placeholder='例如：这一章不要急着揭露真相，让主角先做一次错误判断。'
                  />
                  <div className='mt-2 flex flex-wrap gap-2'>
                    <Button onClick={sendAlignmentMessage}>记录补充</Button>
                    <Button onClick={mergeDiscussionIntoAgreement} disabled={!alignmentMessages.length}>写入最终共识</Button>
                  </div>
                </div>
              </div>
            </details>
          </Card>
          </div></details>

          <details className='rounded-ui border border-border bg-surface'>
            <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>
              AI 草稿待确认 <span className='text-xs text-muted'>({pendingChapterReviews.length})</span>
            </summary>
            <div className='space-y-2 border-t border-border p-3'>
              {chapterReviewList.slice(0, 4).map((review: any) => (
                <div key={review.review_id} className='rounded-ui border border-border bg-surface p-2 text-xs'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <div className='font-medium'>AI 初稿</div>
                      <div className='text-muted'>{review.word_count || 0} 字</div>
                    </div>
                    <Badge tone={review.status === 'accepted' ? 'success' : review.status === 'pending_author_review' ? 'warn' : 'default'}>{review.status === 'accepted' ? '已确认' : review.status === 'pending_author_review' ? '待确认' : '已处理'}</Badge>
                  </div>
                  <div className='mt-2 text-muted'>{review.preview || '无预览'}</div>
                  {review.status === 'pending_author_review' ? (
                    <div className='mt-2 flex gap-2'>
                      <Button className='text-xs' onClick={() => updateChapterReview(review, 'accepted')}>确认草稿</Button>
                      <Button className='text-xs' onClick={() => updateChapterReview(review, 'rejected')}>拒绝草稿</Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {!chapterReviewList.length && <p className='text-sm text-muted'>生成本章后，AI 草稿会先进入这里等待作者确认。</p>}
            </div>
          </details>

          <details className='rounded-ui border border-border bg-surface'>
            <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>
              生成后的作者流程 <span className='text-xs text-muted'>({chapterWorkflowSteps.filter((step) => step.done).length}/{chapterWorkflowSteps.length})</span>
            </summary>
            <div className='grid grid-cols-1 gap-2 border-t border-border p-3 md:grid-cols-4'>
              {chapterWorkflowSteps.map((step) => (
                <div key={step.id} className={`rounded-ui border p-3 ${step.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface'}`}>
                  <div className='flex items-start justify-between gap-2'>
                    <div>
                      <div className='text-sm font-semibold'>{step.label}</div>
                      <div className='mt-1 text-xs text-muted'>{step.detail}</div>
                    </div>
                    <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : '待做'}</Badge>
                  </div>
                  <Button className='mt-3 w-full text-xs' onClick={step.run} disabled={step.id === 'review' && !pendingChapterReviews.length}>
                    {step.action}
                  </Button>
                </div>
              ))}
            </div>
          </details>

          <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>生成控制、检查与修改建议</summary><div className='mt-4'><Card
            title='生成、检查与修改建议'
            extra={
              <div className='flex flex-wrap gap-2'>
                <Button onClick={saveChapterDraft} disabled={chapterSaving}>{chapterSaving ? '保存中...' : '保存正文'}</Button>
                <Button onClick={async () => { if (await saveChapterDraft()) await analyzeChapter() }} disabled={chapterSaving || analyzeBusy}>{analyzeBusy ? '检查中...' : '保存并检查'}</Button>
                <Button onClick={analyzeMarks} disabled={chapterSaving}>检查要求</Button>
                <Button variant='primary' onClick={requestRunJobWithAgreement} disabled={!alignmentReady}>按共识生成</Button>
              </div>
            }
          >
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-4'><label className='text-xs text-muted'>当前章节</label><Select value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)}>{chapterRows.map((row: any) => <option key={row.chapter_id} value={row.chapter_id}>{row.title || row.chapter_title || row.chapter_id}</option>)}</Select></div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>章节名</label>
                <Input value={chapterTitleDraft} onChange={(e) => setChapterTitleDraft(e.target.value)} />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>所属卷</label>
                <Select
                  value={currentChapterMeta?.volume_id || currentVolume?.id || 'volume_default'}
                  onChange={async (e) => {
                    const meta = { ...(draft?.meta || currentChapterMeta || {}), volume_id: e.target.value }
                    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
                    mutateDraft()
                    mutateDraftDetails()
                    mutateVolumes()
                  }}
                >
                  {volumeRows.map((v: any) => <option key={v.id} value={v.id}>{v.title || v.id}</option>)}
                </Select>
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>状态</label>
                <Select
                  value={currentChapterMeta?.chapter_status || 'draft'}
                  onChange={async (e) => {
                    const meta = { ...(draft?.meta || currentChapterMeta || {}), chapter_status: e.target.value }
                    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
                    mutateDraft()
                    mutateDraftDetails()
                  }}
                >
                  <option value='draft'>草稿</option>
                  <option value='drafting'>写作中</option>
                  <option value='planned'>已规划</option>
                  <option value='revising'>修改中</option>
                  <option value='done'>已完成</option>
                </Select>
              </div>
              <details className='col-span-12 rounded-ui border border-border bg-surface-2 text-xs'>
                <summary className='cursor-pointer px-3 py-2 font-medium'>高级设置</summary>
                <div className='grid grid-cols-1 gap-3 border-t border-border p-3 md:grid-cols-2'>
                  <div>
                    <label className='text-xs text-muted'>模型选择</label>
                    <label className='mb-1 flex items-center gap-2 text-xs'>
                      <input type='checkbox' checked={useAgentAssignments} onChange={(e) => setUseAgentAssignments(e.target.checked)} />
                      使用设置里的分工模型
                    </label>
                    <Select value={llmProfileId} onChange={(e) => setLlmProfileId(e.target.value)} disabled={useAgentAssignments}>
                      {Object.entries(profiles).map(([k, v]: any) => (
                        <option key={k} value={k}>{k} ({v.provider}/{v.model})</option>
                      ))}
                    </Select>
                    <div className='mt-1 text-muted'>给开源维护和高级用户使用，作者默认不用改。</div>
                  </div>
                  <label className='flex items-center gap-2 text-sm'>
                    <input type='checkbox' checked={autoApplyPatch} onChange={(e) => setAutoApplyPatch(e.target.checked)} />
                    自动应用 AI 修改建议
                  </label>
                </div>
              </details>
            </div>
            <div className='mt-3 rounded-ui border border-border bg-surface-2 p-3'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='text-sm font-medium'>AI 生成控制</span>
                <Badge>{GENERATION_SCOPE_OPTIONS.find((x) => x.id === generationScope)?.label || generationScope}</Badge>
              </div>
              <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
                <div>
                  <label htmlFor='chapter-generation-scope' className='text-xs text-muted'>生成范围</label>
                  <Select id='chapter-generation-scope' value={generationScope} onChange={(e) => setGenerationScope(e.target.value)}>
                    {GENERATION_SCOPE_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className='text-xs text-muted'>停止点</label>
                  <Select value={generationStopPoint} onChange={(e) => setGenerationStopPoint(e.target.value)}>
                    {GENERATION_STOP_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className='text-xs text-muted'>检查方式</label>
                  <Select value={generationCheckMode} onChange={(e) => setGenerationCheckMode(e.target.value)}>
                    {GENERATION_CHECK_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </Select>
                </div>
              </div>
              {generationScope === 'chapters' && <div className='mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2'>
                <div><label htmlFor='generation-start-chapter' className='text-xs text-muted'>从哪一章开始</label><Select id='generation-start-chapter' value={generationStartChapter || selectedChapter} onChange={(e) => setGenerationStartChapter(e.target.value)}>{writingChapterRows.map((row: any) => <option key={row.chapter_id} value={row.chapter_id}>{row.title || row.chapter_title || row.chapter_id}</option>)}</Select></div>
                <div><label htmlFor='generation-end-chapter' className='text-xs text-muted'>写到哪一章</label><Select id='generation-end-chapter' value={generationEndChapter} onChange={(e) => setGenerationEndChapter(e.target.value)}><option value=''>最后一个已规划章节</option>{writingChapterRows.map((row: any) => <option key={row.chapter_id} value={row.chapter_id}>{row.title || row.chapter_title || row.chapter_id}</option>)}</Select></div>
              </div>}
              {generationScope === 'beat' && <div className='mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2'>
                <div><label htmlFor='generation-start-beat' className='text-xs text-muted'>从哪个桥段开始</label><Select id='generation-start-beat' value={generationStartBeat} onChange={(e) => setGenerationStartBeat(Number(e.target.value))}>{writingBeatRows.map((label: string, index: number) => <option key={index} value={index}>{index + 1}. {label}</option>)}</Select></div>
                <div><label htmlFor='generation-end-beat' className='text-xs text-muted'>写到哪个桥段</label><Select id='generation-end-beat' value={generationEndBeat} onChange={(e) => setGenerationEndBeat(e.target.value)}><option value=''>最后一个桥段</option>{writingBeatRows.map((label: string, index: number) => <option key={index} value={index}>{index + 1}. {label}</option>)}</Select></div>
                {!writingBeatRows.length && <p className='text-xs text-muted'>请先在故事计划中准备场景和桥段。</p>}
              </div>}
              {generationScope === 'book' && <p className='mt-2 text-xs text-muted'>按已创建或已规划的章节顺序逐章生成，不会一次性提交整本正文。</p>}
              <div className='mt-2 flex flex-wrap gap-3 text-xs'>
                <label className='flex items-center gap-2'><input type='checkbox' checked={generationUseCards} onChange={(e) => setGenerationUseCards(e.target.checked)} /> 使用人物/世界/文风卡</label>
                <label className='flex items-center gap-2'><input type='checkbox' checked={generationUseTechniques} onChange={(e) => setGenerationUseTechniques(e.target.checked)} /> 使用所选写作参考</label>
                <label className='flex items-center gap-2'><input type='checkbox' checked={generationUseLines} onChange={(e) => setGenerationUseLines(e.target.checked)} /> 使用脉络/明暗线</label>
              </div>
            </div>
            <section id='chapter-check-results' className='my-4 space-y-3 border-y border-border py-4' aria-label='检查结果'>
              <div className='flex flex-wrap items-center justify-between gap-2'><h3 className='text-base font-semibold'>检查结果</h3><Button disabled={analyzeBusy} onClick={analyzeMarks}>检查正文</Button></div>
              <p className='text-sm text-muted'>{!evidenceMarkRows.length ? '尚未检查当前正文。' : evidenceMarkRows.some((mark: any) => mark.detection?.support_level !== 'supported' && !['confirm_hit', 'false_positive', 'ignore_chapter'].includes(mark.author_feedback?.action)) ? '有内容需要核对。展开查看原句，再决定是否修改。' : '暂未发现待处理问题。'}</p>
              <details><summary className='cursor-pointer text-sm font-medium'>待处理问题与引用依据</summary><div className='mt-3 divide-y divide-border'>
                {evidenceMarkRows.map((mark: any) => <div key={mark.mark_id} className='space-y-2 py-3'><div className='text-sm font-medium'>{mark.label || '正文检查项'}</div><p className='text-sm text-muted'>{mark.detection?.note || (mark.detection?.support_level === 'supported' ? '已有正文依据。' : '还需要核对正文依据。')}</p>{mark.span?.quote ? <blockquote className='whitespace-pre-wrap border-l border-border pl-3 text-sm leading-6'>{mark.span.quote}</blockquote> : <p className='text-xs text-muted'>暂无可引用的正文原句。</p>}<div className='flex flex-wrap gap-2'>
                  <Button className='text-xs' onClick={() => { setSelectedMarkId(mark.mark_id); const start = Number(mark.span?.start_line || 0); if (start > 0) { setHighlightRange({ start, end: Number(mark.span?.end_line || start) }); document.getElementById('chapter-manuscript-editor')?.scrollIntoView({ block: 'center' }) } }}>查看引用位置</Button>
                  <Button className='text-xs' onClick={() => updateEvidenceFeedback(mark, 'confirm_hit')}>确认依据</Button><Button className='text-xs' onClick={() => updateEvidenceFeedback(mark, 'false_positive')}>标为误判</Button><Button className='text-xs' onClick={() => updateEvidenceFeedback(mark, 'ignore_chapter')}>忽略本章</Button>
                </div>{mark.author_feedback?.action && <p className='text-xs text-muted'>你已处理此项。</p>}</div>)}
                {!evidenceMarkRows.length && <p className='py-3 text-sm text-muted'>点击“检查正文”后，可在这里核对人物、情节和伏笔是否有正文依据。</p>}
              </div></details>
            </section>

            <SettingChangeProposals project={project} chapterId={selectedChapter} isChapterGenerating={isChapterGenerating} hasUnsavedManuscript={chapterEditorText !== (draft?.content || '')} isSettingDirty={isSettingDirty} onApplied={() => { void mutateDraft(); void mutateVersions(); void mutateDraftDetails() }} onOpenSettings={() => { setActiveActivity('settings'); setView('settings') }} />

            <details className='mt-3 rounded-ui border border-border bg-surface-2 text-xs'>
              <summary className='cursor-pointer px-3 py-2 font-medium'>只修改正文中的一小段</summary>
              <div className='grid grid-cols-12 gap-2 border-t border-border p-3'>
                <div className='col-span-3'>
                  <label className='text-xs text-muted'>选择方式</label>
                  <Select value={selectionMode} onChange={(e) => setSelectionMode(e.target.value as any)}>
                    <option value='line'>按行</option>
                    <option value='paragraph'>按段落</option>
                  </Select>
                </div>
                <div className='col-span-3'>
                  <label className='text-xs text-muted'>{selectionMode === 'line' ? '开始行' : '开始段'}</label>
                  <Input value={selectionStart} onChange={(e) => setSelectionStart(e.target.value)} placeholder='开始' />
                </div>
                <div className='col-span-3'>
                  <label className='text-xs text-muted'>{selectionMode === 'line' ? '结束行' : '结束段'}</label>
                  <Input value={selectionEnd} onChange={(e) => setSelectionEnd(e.target.value)} placeholder='结束' />
                </div>
                <div className='col-span-3 flex items-end gap-2'>
                  {selectionRange ? <Button onClick={() => { const editor = document.getElementById('chapter-manuscript-editor') as HTMLTextAreaElement | null; const lines = chapterEditorText.split('\n'); const start = lines.slice(0, selectionRange.start - 1).join('\n').length + (selectionRange.start > 1 ? 1 : 0); const end = lines.slice(0, selectionRange.end).join('\n').length; editor?.focus(); editor?.setSelectionRange(start, end); document.getElementById('revision-mode')?.scrollIntoView({ block: 'center' }) }}>选择这一段以润色</Button> : null}
                </div>
                {selectionRange ? <p className='col-span-12 text-xs text-muted'>已选择：L{selectionRange.start}-L{selectionRange.end}</p> : <p className='col-span-12 text-xs text-muted'>填写开始和结束位置后，可以只让 AI 修改这一小段。</p>}
              </div>
            </details>
            {extractionCoverage && <section className='mt-2 space-y-2 text-xs leading-6' aria-label='本章事实整理范围'>
              <p>{extractionCoverage.mode === 'local' ? '本地摘录，未运行 AI 语义提取。' : extractionCoverage.mode === 'model' ? 'AI 分段提取，条目仍待作者核对。' : '整理方式未记录，请核对来源。'}{extractionCoverage.message || ''}{extractionCoverage.unread_ranges.length > 0 ? '仍有未完成的原文范围。' : ''}</p>
              {!extractionCoverage.current && <p className='text-muted'>{extractionCoverage.source_revision ? '正文已有变化，这份旧版范围待重新核对，不能按旧位置定位。' : '这份记录未附正文版本，仅供回看；重新整理后再定位原文。'}</p>}
              <details><summary className='cursor-pointer text-brand-600'>查看原文整理范围{Number.isFinite(extractionCoverage.total_chars) ? `（原文共 ${extractionCoverage.total_chars} 字符）` : ''}</summary><div className='mt-2 space-y-3'>{[['read_ranges', extractionCoverage.mode === 'local' ? '本地摘录经过的范围' : '已提取范围'], ['unread_ranges', '未完成范围']].map(([key, label]) => extractionCoverage[key].length > 0 && <div key={key}><h5 className='font-medium'>{label}</h5><ul className='mt-1 space-y-2'>{extractionCoverage[key].map((range: any, index: number) => <li key={index}><p>原文第 {range.start + 1}–{range.end} 个字符（{range.end - range.start} 字符）{range.reason ? `：${range.reason}` : ''}</p><Button variant='ghost' className='text-xs' disabled={!extractionCoverage.current} onClick={() => { if (!extractionCoverage.current) return; const chars = Array.from(chapterEditorText), before = chars.slice(0, range.start).join(''), selected = chars.slice(range.start, range.end).join(''); setHighlightRange({ start: before.split('\n').length, end: `${before}${selected}`.split('\n').length }); const editor = document.getElementById('chapter-manuscript-editor') as HTMLTextAreaElement | null; editor?.focus(); editor?.setSelectionRange(before.length, before.length + selected.length); editor?.scrollIntoView({ block: 'center' }) }}>查看这段原文</Button></li>)}</ul></div>)}</div></details>
            </section>}

            {highlightRange ? (
              <div className='mt-3 rounded-ui border border-border bg-surface-2 p-2'>
                <div className='mb-1 text-xs font-medium'>Evidence: {selectedChapter} L{highlightRange.start}-L{highlightRange.end}</div>
                <pre className='editor-text mono max-h-40 overflow-auto whitespace-pre-wrap text-xs'>{highlighted || '暂无正文'}</pre>
              </div>
            ) : null}
            <div className='mt-3 grid grid-cols-12 gap-3'>
              <details className='col-span-12 rounded-ui border border-border bg-surface p-3'><summary className='cursor-pointer text-sm font-medium'>查看逐段依据</summary>
                <div className='mb-2 mt-3 flex items-center justify-between'>
                  <span className='text-xs font-medium'>段落标记</span>
                  <Badge>{evidenceMarkRows.length}</Badge>
                </div>
                <div className='max-h-[560px] space-y-2 overflow-auto'>
                  {Object.entries(marksByLine).map(([line, marks]) => (
                    <div key={line} className='rounded-ui border border-border bg-panel p-2'>
                      <div className='mb-1 text-[11px] text-muted'>{line === '未证实' ? '未证实' : `L${line}`}</div>
                      <div className='space-y-1'>
                        {(marks as any[]).map((mark: any) => {
                          const level = mark?.detection?.support_level || 'unsupported'
                          return (
                            <button
                              key={mark.mark_id}
                              className={`w-full rounded-ui border px-2 py-1 text-left text-[11px] ${supportClass(level)}`}
                              onClick={() => {
                                setSelectedMarkId(mark.mark_id)
                                const start = Number(mark?.span?.start_line || 0)
                                const end = Number(mark?.span?.end_line || start)
                                if (start > 0) setHighlightRange({ start, end })
                              }}
                            >
                              <div className='font-medium'>{mark.target_type} · {referenceLabel({ title: mark.label || mark.target_id })}</div>
                              <div>{level}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {!evidenceMarkRows.length && <p className='text-xs text-muted'>运行生成或 Analyze Marks 后显示人物、技法、明线、暗线、伏笔命中。</p>}
                </div>
              </details>

            </div>
          </Card></div></details>


          </div>
        </div>
      )
    }

    if (view === 'canon') {
      return (
        <div className='space-y-3 density-space'>
          <KnowledgeGraph project={project} onOpen={openMaterial} title='全书人物、事件与事实' showStages />
          <InformationPanel key={`${project}:fact-information`} project={project} storyId={storyForm.id} title='事实中的关键信息与不同说法' focusId={informationFocus} />
          <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>从材料整理关系</summary><div className='mt-4'><MaterialImportWorkspace project={project} purpose='relations' storyId={storyForm.id} profileId={useAgentAssignments ? undefined : llmProfileId} isTargetDirty={isSettingDirty} onApplied={refreshSharedMaterials} /></div></details>
          <Card title='作品事实'>
            <div className='space-y-2'>
              {(canonFacts || []).filter((f: any) => !['pending', 'unverified'].includes(f.status) && f.confirmation_status !== 'pending_author_review').slice(-20).reverse().map((f: any, i: number) => (
                <div key={`${f.id || 'fact'}:${i}`} className='rounded-ui border border-border bg-surface p-2'>
                  <div className='flex items-center gap-2 text-sm'>
                    <Badge>{({ world_state: '世界状态', chapter_summary: '章节梗概', scene_summary: '场景梗概', character: '人物', timeline: '时间线' } as Record<string, string>)[f.scope] || '作品事实'}</Badge>
                    <span className='font-medium'>{f.title || f.label || '已记录内容'}</span>
                    {f._revised ? <span className='text-xs text-muted'>（已更正 {(f._revisions || []).length} 次）</span> : null}
                  </div>
                  <div className='mt-1 text-xs text-muted'>
                    <div className='text-sm text-text'>{String(f.value || '')}</div>
                    {f.evidence?.quote && <blockquote className='mt-2'>正文依据：{f.evidence.quote}</blockquote>}
                    {f._revised && <details className='mt-1'><summary className='cursor-pointer'>查看更正前内容</summary>{String((f._original || f).value || '')}</details>}
                  </div>
                  <div className='mt-2'>
                    <Button className='text-xs' onClick={() => setFactRevisionModal({ open: true, fact: f, patch: JSON.stringify({ value: f.value || '' }, null, 2), reason: '' })}>编辑/修订</Button>
                  </div>
                </div>
              ))}
              {(!canonFacts || canonFacts.length === 0) && <p className='text-sm text-muted'>目前还没有已记录的作品事实。</p>}
            </div>
          </Card>

          <Card title='待确认的新事实'>
            <div className='space-y-2'>
              {(canonFacts || []).filter((fact: any) => ['pending', 'unverified'].includes(fact.status) || fact.confirmation_status === 'pending_author_review').map((fact: any) => <section key={fact.id} className='space-y-2 border-b border-border py-3'><p className='text-sm font-medium'>{fact.title || fact.label || '待核对事实'}</p><p className='whitespace-pre-wrap text-sm leading-7'>{String(fact.value || '')}</p>{fact.evidence?.quote && <blockquote className='text-xs leading-6 text-muted'>正文依据：{fact.evidence.quote}</blockquote>}<Button className='text-xs' disabled={!fact._revision || !fact.evidence?.quote?.trim()} onClick={async () => { try { await api.post(`/api/projects/${project}/canon/facts/${fact.id}/revise`, { base_revision: fact._revision, patch: { status: 'confirmed', confirmation_status: 'confirmed' }, reason: '作者核对正文依据后确认' }); void mutateCanonFacts(); push('此事实已确认，原记录与引用保留。') } catch (cause) { push(cause instanceof Error ? cause.message : '确认失败，请重新读取当前版本。', 'error') } }}>{fact.status === 'unverified' ? '核对依据并确认' : '确认此事实'}</Button>{(fact.status === 'unverified' || !fact.evidence?.quote?.trim()) && <p className='text-xs text-muted'>{fact.evidence?.quote?.trim() ? '依据尚未通过定位核验；确认时会重新校验正文原句，不能仅凭说法采用。' : '请先补充依据原句并保存修订，再确认此事实。'}</p>}<Button variant='ghost' className='text-xs' onClick={() => setFactRevisionModal({ open: true, fact, patch: JSON.stringify({ value: fact.value || '' }, null, 2), reason: '' })}>核对并修订</Button></section>)}

              {(proposals || []).slice(-20).reverse().map((p: any, i: number) => (
                <div key={i} className={`rounded-ui border bg-surface p-2 ${selectedProposalId && selectedProposalId === (p.proposal_id || p.id) ? 'border-brand-500' : 'border-border'}`}>
                  <div className='flex items-center gap-2 text-sm'>
                    <Badge>{({ character: '人物', world: '世界', relation: '关系', timeline: '时间', event: '事件' } as Record<string, string>)[p.entity_type] || '事实候选'}</Badge>
                    <span>{p.name || p.proposal_id}</span>
                    <span className='text-xs text-muted'>{p.status === 'accepted' ? '已确认' : p.status === 'rejected' ? '未采用' : '待确认'}</span>
                  </div>
                  <div className='mt-2 flex gap-2'>
                    <Button className='text-xs' onClick={async () => { await api.post(`/api/projects/${project}/canon/proposals/${p.proposal_id}/accept`, {}); mutateProposals(); push('新事实已确认') }}>确认采用</Button>
                    <Button className='text-xs' onClick={async () => { await api.post(`/api/projects/${project}/canon/proposals/${p.proposal_id}/reject`, {}); mutateProposals(); push('已暂不采用') }}>暂不采用</Button>
                  </div>
                </div>
              ))}
              {(!proposals || proposals.length === 0) && !(canonFacts || []).some((fact: any) => ['pending', 'unverified'].includes(fact.status) || fact.confirmation_status === 'pending_author_review') && <p className='text-sm text-muted'>目前没有待确认的新事实。</p>}
            </div>
          </Card>

          {factRevisionModal.open ? (
            <Card title='修订事实'>
              <div className='space-y-3'>
                <p className='text-sm font-medium'>{factRevisionModal.fact?.title || factRevisionModal.fact?.label || (factSubject ? `${referenceLabel(factSubject)}的事实` : '这条作品事实')}</p>
                {factSubject && <p className='text-xs text-muted'>涉及：{referenceLabel(factSubject)}</p>}
                <div><label htmlFor='fact-revision-value' className='mb-1 block text-sm'>事实内容</label><Textarea id='fact-revision-value' className='min-h-28 leading-7' disabled={!factPatch} value={String(factPatch?.value ?? factRevisionModal.fact?.value ?? '')} onChange={(e) => updateFactPatch({ value: e.target.value })} /></div>
                <div><label htmlFor='fact-revision-quote' className='mb-1 block text-sm'>依据原句</label><Textarea id='fact-revision-quote' className='min-h-20 leading-7' disabled={!factPatch} value={factPatch?.evidence?.quote ?? factRevisionModal.fact?.evidence?.quote ?? ''} onChange={(e) => updateFactPatch({ evidence: { ...factRevisionModal.fact?.evidence, ...factPatch?.evidence, quote: e.target.value } })} placeholder='填写正文中连续出现的原句；原章节和其他依据字段会保留。' /></div>
                <div><label htmlFor='fact-revision-reason' className='mb-1 block text-sm'>修订原因</label><Textarea id='fact-revision-reason' value={factRevisionModal.reason} onChange={(e) => setFactRevisionModal((current) => ({ ...current, reason: e.target.value }))} placeholder='例如：原内容遗漏了适用条件，按本章原句补正。' /></div>
                <p className='text-xs leading-6 text-muted'>只追加所改字段的修订，原依据与历史保留。待确认事实保存后仍待确认，请回列表核对采用。</p>
                <details><summary className='cursor-pointer text-xs text-muted'>其他事实字段（高级）</summary><div className='mt-3 space-y-2'><p className='text-xs leading-6 text-muted'>仅在需要修改其他字段时使用。原有字段不会因未填写而删除；内部编号保持不变。</p><label htmlFor='fact-revision-patch' className='sr-only'>高级事实字段修改</label><Textarea id='fact-revision-patch' className='h-28 mono' value={factRevisionModal.patch} onChange={(e) => setFactRevisionModal((current) => ({ ...current, patch: e.target.value }))} /></div></details>
                {!factPatch && <p role='alert' className='text-xs text-muted'>高级字段的格式尚未完整，请修正后保存；当前编辑保留。</p>}
                <div className='flex gap-2'>
                  <Button variant='primary' disabled={!factPatch || !factRevisionModal.reason.trim()} onClick={reviseCanonFact}>保存修订</Button>
                  <Button onClick={() => setFactRevisionModal({ open: false, fact: null, patch: '{}', reason: '' })}>取消</Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      )
    }

    if (view === 'world') {
      return <div className='space-y-5'>
        <WorldWiki onActiveCardChange={setActiveWorldCardId} onOpenEvent={enterStoryEvent} storyCard={storyForm} eventContext={eventOrigin?.context} project={project} navigationRequest={worldNavigationRequest} profileId={useAgentAssignments ? undefined : llmProfileId} onOpenSettings={() => { setActiveActivity('settings'); setView('settings') }} projectTitle={projectInfo?.title || storyForm?.title || '当前作品'} chapters={chapterRows} draftCache={cardDraftCache} onOpenMaterial={openMaterial} focusRequest={materialFocusRequest} referenceRequest={cardReferenceRequest} legacyEditor={<div className='space-y-5'>
          <CardEditor key={`${project}:world`} project={project} type='world' profileId={useAgentAssignments ? undefined : llmProfileId} onSaved={() => { mutateWorldCards(); refreshSharedMaterials() }} draftCache={cardDraftCache} onOpenMaterial={openMaterial} />
          <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>检索已有世界资料</summary>
            <div className='mt-3 flex gap-2'><Input aria-label='世界资料关键词' value={worldQuery} onChange={(event) => setWorldQuery(event.target.value)} /><Button onClick={async () => { const result = await api.post(`/api/projects/${project}/world/query`, { query: worldQuery, top_k: 10, include_global: false }); setWorldRows(result) }}>查找资料</Button></div>
            <pre className='mt-3 overflow-auto whitespace-pre-wrap text-xs'>{JSON.stringify(worldRows, null, 2)}</pre>
          </details>
        </div>} />
      </div>
    }

    if (view === 'techniques') {
      const applyReference = (reference: any) => {
        if (isIncompleteReference(reference)) { push('这项技法尚未完善，请先补充内容。', 'error'); return }
        if (referenceTarget === 'chapter') {
          if (!selectedChapter || !chapterRows.some((row: any) => row.chapter_id === selectedChapter)) { push('请先打开或创建一个章节。', 'error'); return }
          updateChapterReferences([...new Set([...selectedChapterReferenceIds, reference.id])])
          setActiveActivity('explorer')
          setView('chapter')
          push('已加入本章编辑内容，请点击“保存正文”。')
        } else if (referenceTarget === 'story') {
          setStoryForm((current: any) => normalizeStoryCard({ ...current, payload: { ...current.payload, writing_references: [...new Set([...(current.payload?.writing_references || []), reference.id])] } }))
          setStoryPlanningTab('Overview')
          setActiveActivity('story')
          setView('story')
          push('已加入故事表单，请点击“保存故事设定”。')
        } else {
          const [type, cardId] = referenceTarget.split(':')
          if (type === 'character') {
            const card = cardDraftCache.current[`${project}:character:${cardId}`] || (Array.isArray(chars) ? chars : []).find((row: any) => row.id === cardId)
            if (!card) { push('没有找到这个人物，请重新选择。', 'error'); return }
            setCharacterForm({ ...card, payload: { ...card.payload, writing_references: [...new Set([...(card.payload?.writing_references || []), reference.id])] } })
            setActiveActivity('cards')
            setView('characters')
          } else if (type === 'world' || type === 'style') {
            setCardReferenceRequest({ type, cardId, referenceId: reference.id, requestId: Date.now() })
            setActiveActivity('cards')
            setView(type)
          } else { push('请先选择使用位置。', 'error'); return }
          push('已加入目标卡片的编辑表单，请保存后使用。')
        }
      }
      const cats = Array.isArray(techniqueCategories) ? techniqueCategories : []
      const selectedCategory = cats.find((category: any) => category.id === selectedTechniqueCategoryId)
      const includedCategoryIds = new Set<string>(selectedCategory ? [selectedCategory.id] : [])
      let added = true
      while (added) {
        added = false
        for (const category of cats) if (includedCategoryIds.has(category.payload?.parent_id) && !includedCategoryIds.has(category.id)) { includedCategoryIds.add(category.id); added = true }
      }
      const chooseCategory = (category: any | null) => { setSelectedTechniqueCategoryId(category?.id || ''); setCategoryForm(category); setTechniqueForm(null) }
      const rows = (Array.isArray(techniqueCards) ? techniqueCards : []).filter((technique: any) => {
        if (!showIncompleteTechniques && isIncompleteReference(technique)) return false
        if (selectedCategory && !includedCategoryIds.has(technique.payload?.category_id) && ![...includedCategoryIds].some((id) => (cats.find((category: any) => category.id === id)?.payload?.core_techniques || []).includes(technique.id))) return false
        const query = techniqueQuery.trim().toLowerCase()
        if (!query) return true
        const categoryName = cats.find((category: any) => category.id === technique.payload?.category_id)?.title || ''
        return `${technique.title || ''} ${categoryName} ${JSON.stringify(technique.payload || {})}`.toLowerCase().includes(query)
      })
      const toolRows = (Array.isArray(toolSkillCards) ? toolSkillCards : []).filter((t: any) => {
        if (isIncompleteReference(t)) return false
        const q = techniqueQuery.trim().toLowerCase()
        if (!q) return true
        return String(t.title || '').toLowerCase().includes(q) || String(t.id || '').toLowerCase().includes(q) || JSON.stringify(t.payload || {}).toLowerCase().includes(q)
      })
      return (
        <div className='space-y-3 density-space'>
          <Tabs
            items={['叙事技法', '写作工具']}
            active={techniqueLibraryTab}
            onChange={setTechniqueLibraryTab}
          />
          <section className='space-y-2 border-b border-border pb-4' aria-label='写作参考的使用位置'>
            <label htmlFor='writing-reference-target' className='text-sm font-medium'>将参考用于</label>
            <Select id='writing-reference-target' value={referenceTarget} onChange={(event) => setReferenceTarget(event.target.value)}>
              <option value='chapter'>当前章节{currentChapterMeta?.chapter_title ? ` · ${currentChapterMeta.chapter_title}` : ''}</option>
              <option value='story'>当前故事 · {storyForm?.title || '未命名故事'}</option>
              <optgroup label='人物设定'>
                <option value={`character:${characterForm.id}`}>当前人物 · {characterForm.payload?.name || characterForm.title || '新人物'}</option>
                {(Array.isArray(chars) ? chars : []).filter((card: any) => card.id !== characterForm.id).map((card: any) => <option key={card.id} value={`character:${card.id}`}>{card.payload?.name || card.title || '未命名人物'}</option>)}
              </optgroup>
              {(Array.isArray(savedWorldCards) && savedWorldCards.length > 0) && <optgroup label='世界观'>{savedWorldCards.map((card: any) => <option key={card.id} value={`world:${card.id}`}>{card.title || '未命名世界观'}</option>)}</optgroup>}
              {(Array.isArray(styles) && styles.length > 0) && <optgroup label='文风'>{styles.map((card: any) => <option key={card.id} value={`style:${card.id}`}>{card.title || '未命名文风'}</option>)}</optgroup>}
            </Select>
            <p className='text-xs leading-5 text-muted'>点击条目的“用于此处”，会打开对应内容并加入编辑表单。仍需保存该内容，才用于后续写作。</p>
          </section>
          {techniqueLibraryTab === '叙事技法' ? (
            <>
              <section className='space-y-4' aria-label='技法分类'>
                <div><h2 className='text-xl font-semibold'>为这一段寻找合适的写法</h2><p className='mt-2 text-sm text-muted'>技法是可选的写作参考。不必选满分类，也不妨碍先把故事写出来。</p></div>
                <nav className='flex flex-wrap gap-2' aria-label='选择技法分类'>
                  <Button variant={!selectedCategory ? 'primary' : 'secondary'} aria-pressed={!selectedCategory} onClick={() => chooseCategory(null)}>全部技法</Button>
                  {cats.filter((category: any) => !category.payload?.parent_id).map((category: any) => {
                    const active = selectedCategory?.id === category.id || selectedCategory?.payload?.parent_id === category.id
                    return <Button key={category.id} variant={active ? 'primary' : 'secondary'} aria-pressed={active} onClick={() => chooseCategory(category)}>{category.title || '未命名分类'}</Button>
                  })}
                </nav>
                {selectedCategory && <div className='flex flex-wrap items-center gap-2 border-b border-border pb-4'>
                  <span className='mr-1 text-xs text-muted'>细分写法</span>
                  {cats.filter((category: any) => category.payload?.parent_id === (selectedCategory.payload?.parent_id || selectedCategory.id)).map((category: any) => <button key={category.id} aria-pressed={selectedCategory.id === category.id} onClick={() => chooseCategory(category)} className={`focus-ring rounded-ui px-3 py-2 text-sm ${selectedCategory.id === category.id ? 'bg-surface-2 font-semibold text-brand-600 dark:bg-surface-2' : 'text-muted hover:bg-surface-2'}`}>{category.title}</button>)}
                  {selectedCategory.payload?.parent_id && <Button className='text-xs' onClick={() => chooseCategory(cats.find((category: any) => category.id === selectedCategory.payload.parent_id))}>返回上级分类</Button>}
                </div>}
              </section>
              <Card title={selectedCategory?.title || '全部技法'} extra={<span className='text-xs text-muted'>{rows.length} 项可浏览</span>}>
                <div className='flex gap-2 mb-2'>
                  <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder={selectedCategory ? `在${selectedCategory.title}中搜索…` : '搜索技法名称、用途或例子…'} />
                  <Button onClick={async () => { mutateTechniqueCards(); mutateTechniqueCategories(); push('技法列表已刷新') }}>刷新</Button>
                </div>
                <details className='mb-3'><summary className='cursor-pointer text-xs text-muted'>更多浏览选项</summary><label className='mt-2 flex items-center gap-2 text-xs text-muted'><input type='checkbox' checked={showIncompleteTechniques} onChange={(e) => setShowIncompleteTechniques(e.target.checked)} />显示待完善条目</label></details>
                <div className='max-h-72 overflow-auto space-y-1'>
                  {rows.map((r: any) => {
                    const traces = traceRowsFor('technique', [r.id, r.title, r.payload?.name, ...(r.payload?.signals || [])])
                    return (
                      <div key={r.id} className={`flex flex-wrap items-start gap-3 border-b border-border py-3 ${techniqueForm?.id === r.id ? 'bg-surface-2' : ''}`}>
                      <button aria-pressed={techniqueForm?.id === r.id} className='min-w-0 flex-1 text-left text-sm focus-ring' onClick={() => setTechniqueForm(r)}>
                        <div className='flex items-center justify-between gap-2'>
                          <span>{referenceLabel(r)}</span>
                          <Badge tone={traceBadgeTone(traces) as any}>{traceSummary(traces)}</Badge>
                        </div>
                        {referenceDescription(r) && <p className='mt-2 text-sm leading-6 text-muted'>{referenceDescription(r)}</p>}

                      </button>
                      <Button className='shrink-0 text-xs' disabled={isIncompleteReference(r)} aria-label={`将${referenceLabel(r)}用于所选位置`} onClick={() => applyReference(r)}>用于此处</Button>
                      </div>
                    )
                  })}
                  {!rows.length && <p className='p-3 text-sm text-muted'>这个分类中没有匹配的技法。可以清空搜索，或返回全部技法。</p>}
                </div>
              </Card>
              {techniqueForm && (
                <div className='space-y-2'>
                  <SchemaForm schema={techniqueSchema} value={techniqueForm} onChange={setTechniqueForm} />
                  <Button variant='primary' onClick={async () => { try { const result = await api.put(`/api/projects/${project}/cards/${techniqueForm.id}`, techniqueForm); if (cardDraftCache.current.__formProject !== project) return; setTechniqueForm((current: any) => cardAfterSave(current, techniqueForm, result)); mutateTechniqueCards(); push('技法已保存') } catch (error) { push(error instanceof Error ? error.message : '保存失败，编辑保留。', 'error') } }}>保存技法</Button>
                </div>
              )}
              {categoryForm && (
                <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm text-muted'>编辑这个分类的资料</summary><div className='mt-3 space-y-2'>
                  <SchemaForm schema={techniqueCategorySchema} value={categoryForm} onChange={setCategoryForm} />
                  <Button variant='primary' onClick={async () => { try { const result = await api.put(`/api/projects/${project}/cards/${categoryForm.id}`, categoryForm); if (cardDraftCache.current.__formProject !== project) return; setCategoryForm((current: any) => cardAfterSave(current, categoryForm, result)); mutateTechniqueCategories(); push('分类已保存') } catch (error) { push(error instanceof Error ? error.message : '保存失败，编辑保留。', 'error') } }}>保存分类</Button>
                </div></details>
              )}
            </>
          ) : (
            <>
              <Card title='写作工具'>
                <div className='flex gap-2 mb-2'>
                  <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder='搜索检查、人物构思、大纲调研…' />
                  <Button onClick={async () => { mutateToolSkillCards(); push('写作工具已刷新') }}>刷新</Button>
                </div>
                <div className='divide-y divide-border'>
                  {toolRows.map((r: any) => (
                    <div key={r.id} className='flex flex-wrap items-start gap-3 py-3'>
                    <button className='min-w-0 flex-1 text-left text-sm focus-ring' onClick={() => setToolSkillForm(r)}>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-sm font-medium'>{referenceLabel(r)}</span>
                        <Badge>{({ checker: '检查', generator: '构思', research: '调研', tracker: '追踪', memory: '整理记忆' } as Record<string, string>)[r.payload?.category] || '写作工具'}</Badge>
                      </div>
                      {referenceDescription(r) && <div className='mt-1 text-xs leading-5 text-muted'>{referenceDescription(r)}</div>}
                    </button>
                    <Button className='shrink-0 text-xs' aria-label={`将${referenceLabel(r)}用于所选位置`} onClick={() => applyReference(r)}>用于此处</Button>
                    </div>
                  ))}
                  {!toolRows.length && <p className='text-sm text-muted'>暂时没有写作工具，可从快捷命令新建。</p>}
                </div>
              </Card>
              {toolSkillForm && (
                <div className='space-y-2'>
                  <SchemaForm schema={toolSkillSchema} value={toolSkillForm} onChange={setToolSkillForm} />
                  <Button variant='primary' onClick={async () => { try { const result = await api.put(`/api/projects/${project}/cards/${toolSkillForm.id}`, toolSkillForm); if (cardDraftCache.current.__formProject !== project) return; setToolSkillForm((current: any) => cardAfterSave(current, toolSkillForm, result)); mutateToolSkillCards(); push('写作工具已保存') } catch (error) { push(error instanceof Error ? error.message : '保存失败，编辑保留。', 'error') } }}>保存写作工具</Button>
                </div>
              )}
            </>
          )}
        </div>
      )
    }

    if (view === 'wiki') {
      return (
        <Card title='Wiki Import'>
          <Textarea className='h-40 mono' value={wikiHtml} onChange={(e) => setWikiHtml(e.target.value)} />
          <div className='mt-2'>
            <Button variant='primary' onClick={async () => { const fd = new FormData(); fd.append('kind', 'auto'); fd.append('file', new File([wikiHtml], 'wiki.html', { type: 'text/html' })); await fetch(`/api/projects/${project}/wiki/import`, { method: 'POST', body: fd }); mutateProposals(); push('Wiki imported') }}>导入HTML</Button>
          </div>
        </Card>
      )
    }

    if (view === 'sessions') {
      return (
        <div className='space-y-3 density-space'>
          <Card title='Session Message Versions'>
            <div className='space-y-2'>
              <Input value={sessionMessageId} onChange={(e) => setSessionMessageId(e.target.value)} placeholder='message_id' />
              <Textarea className='h-20' value={sessionMessageText} onChange={(e) => setSessionMessageText(e.target.value)} />
              <div className='flex gap-2'>
                <Button onClick={addMessageVersion}>新增消息版本</Button>
                <Button onClick={doUndo}>Undo</Button>
                <Button onClick={doRedo}>Redo</Button>
              </div>
            </div>
          </Card>
          <Card title='Session Meta'>
            <pre className='mono text-xs overflow-auto'>{JSON.stringify(sessionMeta, null, 2)}</pre>
          </Card>
          <Card title='Activate Message Version'>
            {Object.entries(sessionMeta?.messages || {}).map(([mid, m]: any) => (
              <div key={mid} className='mb-3 rounded-ui border border-border bg-surface p-2'>
                <div className='text-sm'><b>{mid}</b> active={m.active_version}</div>
                <div className='mt-1 flex flex-wrap gap-2'>
                  {(m.versions || []).map((v: any) => (
                    <Button key={v.version_id} className='text-xs' onClick={() => activateVersion(mid, v.version_id)}>{v.version_id}</Button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )
    }

    if (view === 'settings') {
      const taskModelControl = (task: typeof TASK_AI_MODULES[number]) => {
        const row = (llmStatus?.modules || []).find((item: any) => item.module === task.id)
        const current = assignmentDraft[task.id] || row?.profile_id || 'mock_default'
        return <div key={task.id} className='space-y-2'>
          <div className='flex items-center justify-between gap-2'><label htmlFor={`task-model-${task.id}`} className='text-sm font-medium'>{({ chapter_writer: '正文写作', chapter_reviewer: '正文审查', proofreader: '润色与改写' } as Record<string, string>)[task.id] || task.label}</label><span className='text-xs text-muted'>{row?.is_mock ? '模拟预览' : row?.missing_fields?.length || row?.profile_missing ? '待配置' : '已填写'}</span></div>
          <Select id={`task-model-${task.id}`} value={current} onChange={(e) => { const id = e.target.value; setAssignmentDraft((previous) => ({ ...previous, [task.id]: id })); saveAgentAssignment(task.id, id) }}>
            {Object.keys(globalProfiles?.profiles || {}).map((id) => <option key={id} value={id}>{profileLabel(id, profiles[id])}</option>)}
          </Select>
        </div>
      }
      return (
        <div className='space-y-3 density-space'>
          {localModelStatus && <Card title='本地模型'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <span>{localModelStatus.name}</span>
              <Badge tone={localModelStatus.ready ? 'success' : 'warn'}>
                {({ ready: '可用', loading: '正在加载', missing: '尚未下载', stopped: '未运行' } as Record<string, string>)[localModelStatus.state]}
              </Badge>
            </div>
            {['missing', 'stopped'].includes(localModelStatus.state) && <p className='mt-2 text-sm text-muted'>
              {localModelStatus.state === 'missing' ? '在仓库目录重新运行安装命令，完成模型下载。' : '使用 start.py 启动 App 时会同时启动本地模型。'}
            </p>}
            <details className='mt-3'><summary className='cursor-pointer text-xs text-muted'>权重位置</summary>
              <p className='mt-2 break-all text-xs'>{localModelStatus.path}</p>
              <p className='text-xs text-muted'>{(localModelStatus.size / 1e9).toFixed(2)} GB</p>
            </details>
          </Card>}
          <Card title='模型连接状态' extra={<Badge tone={llmStatus?.all_mock || llmStatus?.missing_count ? 'warn' : 'success'}>{!llmStatus ? '正在读取' : llmStatus.all_mock ? '尚未连接 AI' : llmStatus.missing_count ? '部分任务待配置' : '已配置'}</Badge>}>
            <p className='text-sm text-muted'>{llmStatus?.all_mock ? '当前只能模拟预览。请在下方添加模型和密钥，再选择哪些任务使用它。' : '在下方为人物设定、正文写作和校对选择模型。配置检查通过不代表已经连通服务。'}</p>
            <details className='mt-3 text-xs text-muted'>
              <summary className='cursor-pointer'>技术详情</summary>
              <pre className='mt-2 max-h-64 overflow-auto whitespace-pre-wrap'>{JSON.stringify(llmStatus, null, 2)}</pre>
            </details>
          </Card>

          <Card title='界面设置'>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <label className='text-xs text-muted'>主题</label>
                <Select value={settings.theme} onChange={(e) => applySettings({ ...settings, theme: e.target.value as any })}>
                  <option value='system'>跟随系统</option>
                  <option value='light'>浅色</option>
                  <option value='dark'>深色</option>
                </Select>
              </div>
              <div>
                <label className='text-xs text-muted'>界面间距</label>
                <Select value={settings.density} onChange={(e) => applySettings({ ...settings, density: e.target.value as any })}>
                  <option value='comfortable'>宽松</option>
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
              <div>
                <label className='text-xs text-muted'>默认模型</label>
                <Select value={settings.defaultLlmProfileId} onChange={(e) => { const val = e.target.value; applySettings({ ...settings, defaultLlmProfileId: val }); setLlmProfileId(val) }}>
                  {Object.keys(profiles).map((k) => <option key={k} value={k}>{profileLabel(k, profiles[k])}</option>)}
                </Select>
              </div>
            </div>
            <div className='mt-3 space-y-2'>
              <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={settings.defaultAutoApplyPatch} onChange={(e) => { const v = e.target.checked; applySettings({ ...settings, defaultAutoApplyPatch: v }); setAutoApplyPatch(v) }} /> 自动应用 AI 修改建议</label>
              <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={settings.evidenceWrap} onChange={(e) => applySettings({ ...settings, evidenceWrap: e.target.checked })} /> 参考材料自动换行</label>
            </div>
          </Card>

          <Card title='本地数据与安全'>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <div className='rounded-ui border border-border bg-surface-2 p-3 text-xs'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='font-medium'>API Key 存储</span>
                  <Badge tone={llmStatus?.storage?.api_keys_returned_in_status ? 'warn' : 'success'}>
                    {llmStatus?.storage?.api_keys_returned_in_status ? '请检查配置' : '保存在本机'}
                  </Badge>
                </div>
                <div className='space-y-1 text-muted'>
                  <div>密钥仅保存在本机，状态信息不展示密钥原文。</div>
                  <details><summary className='cursor-pointer'>查看保存位置</summary>
                    <div className='break-all'>{llmStatus?.storage?.profiles_path || '-'}</div>
                    <div className='break-all'>{llmStatus?.storage?.assignments_path || '-'}</div>
                  </details>
                </div>
              </div>
              <div className='rounded-ui border border-border bg-surface-2 p-3 text-xs'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='font-medium'>作者确认策略</span>
                  <Badge tone={autoApplyPatch ? 'warn' : 'success'}>{autoApplyPatch ? '自动应用' : '作者确认后应用'}</Badge>
                </div>
                <div className='space-y-1 text-muted'>
                  <div>AI 草稿默认进入待确认，作者确认后才视为作者稿。</div>
                  <div>校对建议由作者选择接受或拒绝。</div>
                  <div>检查结果需要有正文原句作为依据。</div>
                </div>
              </div>
              <div className='rounded-ui border border-border bg-surface-2 p-3 text-xs md:col-span-2'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='font-medium'>项目备份与导出</span>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={downloadProjectBackup}>导出项目备份</Button>
                  <Button onClick={downloadManuscriptMarkdown}>导出正文 Markdown</Button>
                  <Button onClick={() => backupImportInputRef.current?.click()}>导入备份</Button>
                </div>
                <div className='mt-2 text-muted'>备份包含项目资料；正文 Markdown 适合投稿、迁移和人工阅读。导入备份会作为新项目恢复，不覆盖当前项目。</div>
              </div>
            </div>
          </Card>

          <div id='model-setup' className='scroll-mt-14' />
          <Card title='添加与管理模型'>
            <p className='text-xs text-muted mb-2'>选择服务商，填写模型名称、服务地址和密钥。保存后，在下方分配给写作任务。</p>
            <div className='mb-3 rounded-ui border border-border bg-surface-2 p-3'>
              <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
                <div>
                  <label className='text-xs text-muted'>服务商</label>
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
                  <Input value={presetProfileId} onChange={(e) => setPresetProfileId(e.target.value)} placeholder='例如：我的写作模型' />
                </div>
                <details><summary className='cursor-pointer text-xs text-muted'>自定义接入方式</summary>                <div>
                  <label className='text-xs text-muted'>接入方式</label>
                  <Input value={profileDraft.provider || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, provider: e.target.value }))} placeholder='openai_compat' />
                </div></details>
              </div>
              <div className='mt-2 grid grid-cols-1 gap-2 md:grid-cols-2'>
                <div>
                  <label className='text-xs text-muted'>模型名称</label>
                  <Input value={profileDraft.model || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, model: e.target.value }))} placeholder='deepseek-chat' />
                </div>
                <div>
                  <label className='text-xs text-muted'>服务地址</label>
                  <Input value={profileDraft.base_url || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, base_url: e.target.value }))} placeholder='https://api.example.com' />
                </div>
                <div>
                  <label className='text-xs text-muted'>密钥</label>
                  <Input type='password' value={profileDraft.api_key || ''} onChange={(e) => setProfileDraft((x: any) => ({ ...x, api_key: e.target.value }))} placeholder='密钥仅保存在本机' />
                </div>
                <div className='grid grid-cols-[1fr_auto] gap-2'>
                  <div>
                    <label className='text-xs text-muted'>最长等待时间（秒）</label>
                    <Input type='number' min='1' value={profileDraft.timeout_s || 60} onChange={(e) => setProfileDraft((x: any) => ({ ...x, timeout_s: e.target.value }))} />
                  </div>
                  <label className='mt-6 flex items-center gap-2 text-sm'>
                    <input type='checkbox' checked={Boolean(profileDraft.stream ?? true)} onChange={(e) => setProfileDraft((x: any) => ({ ...x, stream: e.target.checked }))} />
                    逐步显示生成内容
                  </label>
                </div>
                <div className='md:col-span-2'><label htmlFor='profile-context-window' className='mb-1 block text-xs text-muted'>模型上下文容量（token，可选）</label><Input id='profile-context-window' type='number' min={1} step={1} value={profileDraft.context_window ?? profileDraft.context_window_tokens ?? profileDraft.max_context_tokens ?? ''} onChange={(event) => setProfileDraft((current: any) => ({ ...current, context_window: event.target.value }))} placeholder='按服务商声明填写；不清楚可留空' /><p className='mt-1 text-xs leading-6 text-muted'>不填表示模型上限未知，仅按本次字符范围核对；不会按型号猜测容量。</p></div>
              </div>
              <div className='mt-3 flex flex-wrap gap-2'>
                <Button variant='primary' onClick={saveProfileDraft}>保存模型</Button>
                <Button onClick={applyPresetToEditor}>填入高级配置</Button>
              </div>
              <div className='mt-3 text-xs text-muted'>
                <div><b>必填：</b> {selectedPreset?.required_fields?.map(fieldLabel).join('、') || '-'}</div>
                <div><b>选填：</b> {selectedPreset?.optional_fields?.map(fieldLabel).join('、') || '-'}</div>
                <div><b>逐步显示：</b> {selectedPreset?.supports_stream ? '支持' : '不支持'}</div>
                <div>编辑已有模型时，留空密钥会保留原密钥。</div>
              </div>
            </div>
            <div className='mb-3 rounded-ui border border-border bg-surface-2 p-3'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <div>
                  <h4 className='text-sm font-semibold'>配置检查</h4>
                  <p className='text-xs text-muted'>这里只检查是否填写完整，不会调用 AI，也不会展示密钥。</p>
                </div>
                <Badge tone={(llmStatus?.profile_missing_count || 0) ? 'warn' : 'success'}>{llmStatus?.profile_missing_count || 0} 项待补全</Badge>
              </div>
              <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                {profileHealthRows.map((row: any) => (
                  <div key={row.profile_id} className='rounded-ui border border-border bg-surface p-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='font-medium'>{profileLabel(row.profile_id, profiles[row.profile_id])}</span>
                      <Badge tone={row.is_mock ? 'warn' : row.missing_fields?.length ? 'warn' : 'success'}>{row.is_mock ? '模拟预览' : row.missing_fields?.length ? '待补全' : '已填写'}</Badge>
                    </div>
                    <div className='mt-1 text-xs text-muted'>{row.is_mock ? '用于预览，不会生成真实内容' : row.model || '未填写模型名称'}</div>
                    <div className='mt-1 text-xs'>密钥：{row.requires_api_key ? (row.api_key_configured ? '已保存' : '未填写') : '无需填写'}</div>
                    {row.missing_fields?.length ? <div className='mt-1 text-xs text-amber-700 dark:text-amber-300'>待填写：{row.missing_fields.map(fieldLabel).join('、')}</div> : null}
                    <div className='mt-2 flex flex-wrap gap-2'>
                      <Button className='text-xs' onClick={() => loadProfileDraft(row.profile_id)}>编辑</Button>
                      <Button className='text-xs' onClick={() => deleteProfileDraft(row.profile_id)} disabled={row.profile_id === 'mock_default'}>移除</Button>
                    </div>
                  </div>
                ))}
                {!profileHealthRows.length && <p className='text-sm text-muted'>还没有添加模型。</p>}
              </div>
            </div>
            <details><summary className='cursor-pointer text-sm text-muted'>高级配置</summary>
            <div className='mb-1 flex items-center justify-between gap-2'>
              <label className='text-xs text-muted'>原始配置</label>
              <Badge>{Object.keys(globalProfiles?.profiles || {}).length} 个模型</Badge>
            </div>
            <Textarea className='h-48 mono' value={profilesEditor} onChange={(e) => setProfilesEditor(e.target.value)} />
            <div className='mt-2 flex gap-2'>
              <Button variant='primary' onClick={async () => {
                try {
                  await api.post('/api/config/llm/profiles', { mode: 'replace', profiles: JSON.parse(profilesEditor || '{}') })
                  mutateGlobalProfiles()
                  mutateLlmStatus()
                  push('Global LLM profiles saved')
                } catch {
                  push('Invalid profiles JSON', 'error')
                }
              }}>保存高级配置</Button>
              <Button onClick={() => setProfilesEditor(JSON.stringify(globalProfiles?.profiles || {}, null, 2))}>恢复当前配置</Button>
            </div>
            </details>
          </Card>

          <Card title='任务使用哪个模型'>
            <p className='mb-4 text-sm text-muted'>写作、审查和润色可分别使用不同模型。选择“模拟预览”不会调用真实 AI。</p>
            <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>{TASK_AI_MODULES.filter((task) => ['chapter_writer', 'chapter_reviewer', 'proofreader'].includes(task.id)).map(taskModelControl)}</div>
            <details className='my-5 border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>人物、设定与其他辅助任务</summary><div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>{TASK_AI_MODULES.filter((task) => !['chapter_writer', 'chapter_reviewer', 'proofreader'].includes(task.id)).map(taskModelControl)}</div></details>
            <details><summary className='cursor-pointer text-sm text-muted'>高级配置</summary>
            <Textarea className='h-40 mono' value={assignmentsEditor} onChange={(e) => setAssignmentsEditor(e.target.value)} />
            <div className='mt-2 flex gap-2'>
              <Button variant='primary' onClick={async () => {
                try {
                  const next = JSON.parse(assignmentsEditor || '{}')
                  await api.post('/api/config/llm/assignments', { mode: 'replace', assignments: next })
                  setAssignmentDraft(next)
                  mutateGlobalAssignments()
                  mutateLlmStatus()
                  push('Global assignments saved')
                } catch {
                  push('Invalid assignments JSON', 'error')
                }
              }}>保存任务分配</Button>
              <Button onClick={() => setAssignmentsEditor(JSON.stringify(globalAssignments?.assignments || {}, null, 2))}>恢复当前配置</Button>
            </div>
            <pre className='mono text-xs overflow-auto rounded-ui bg-surface-2 p-3 mt-2'>{JSON.stringify(providersMeta?.providers || [], null, 2)}</pre>
            </details>
          </Card>
        </div>
      )
    }

    const evidence = currentManifest?.evidence || []
    const outlineCard = (paletteCacheRef.current.outlines || [])[0] || null
    return (
      <div className='space-y-3 density-space'>
        <Card title='Outline Technique Mount'>
          <div className='grid grid-cols-2 gap-2 mb-2'>
            <div className='rounded-ui border border-border bg-surface-2 p-2'>
              <div className='text-xs font-medium mb-1'>Macro categories</div>
              <pre className='mono text-[11px] whitespace-pre-wrap'>{JSON.stringify((outlineCard?.payload?.technique_prefs || []).map((x: any) => ({ scope: x.scope, ref: x.ref, categories: x.categories || [] })), null, 2)}</pre>
            </div>
            <div className='rounded-ui border border-border bg-surface-2 p-2'>
              <div className='text-xs font-medium mb-1'>Micro techniques</div>
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
                push('Outline technique_prefs saved')
              } catch {
                // keep typing tolerant
              }
            }}
          />
          <p className='text-xs text-muted'>支持 arc/chapter/beat 级 macro(categories) + micro(techniques) 挂载；chapter pinned_techniques 会覆盖同 technique_id。</p>
        </Card>
          <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>旧工具引用（兼容）</summary><p className='my-3 text-sm text-muted'>保留此前本章选择，可取消引用。检查正文请使用章节页的“检查正文”，伏笔请到故事策划的“伏笔安排”；工具说明本身不会执行这些任务。</p><div className='divide-y divide-border'>
            {(Array.isArray(toolSkillCards) ? toolSkillCards : []).filter((tool: any) => (currentChapterMeta.tool_skill_ids || []).includes(tool.id)).map((tool: any) => { const referenced = (Array.isArray(currentChapterMeta.tool_skill_ids) ? currentChapterMeta.tool_skill_ids : []).includes(tool.id); return <div key={tool.id} className='flex flex-wrap items-center justify-between gap-3 py-3'><div className='min-w-0 flex-1'><div className='text-sm font-medium'>{referenceLabel(tool)}</div><p className='mt-1 text-xs text-muted'>{tool.payload?.description || (tool.payload?.check_rules || []).join('；') || '为本章提供写作参考。'}</p></div><Button className='text-xs' aria-pressed={referenced} onClick={() => toggleToolReference(tool.id)}>{referenced ? '取消引用' : '本章引用'}</Button></div> })}
            {!(currentChapterMeta.tool_skill_ids || []).length && <p className='py-3 text-sm text-muted'>本章没有旧工具引用。</p>}
          </div></details>
          <details className='border-y border-border py-3'><summary className='cursor-pointer text-xs text-muted'>旧检索排序（兼容）</summary><div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'><div><label className='text-xs text-muted'>卡片星级</label><Input type='number' min={0} max={5} value={characterForm.stars ?? ''} onChange={(e) => setCharacterForm({ ...characterForm, stars: e.target.value === '' ? undefined : Number(e.target.value) })} /></div><div><label className='text-xs text-muted'>检索优先程度</label><Input type='number' min={1} max={5} value={characterForm.importance ?? ''} onChange={(e) => setCharacterForm({ ...characterForm, importance: e.target.value === '' ? undefined : Number(e.target.value) })} /></div></div></details>
        <Card title='Memory Packs'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2 max-h-64 overflow-auto'>
              {(Array.isArray(memoryPacks) ? memoryPacks : []).map((p: any) => (
                <button
                  key={p.pack_id}
                  className={`w-full rounded-ui border px-2 py-2 text-left text-xs ${selectedMemoryPackId === p.pack_id ? 'border-primary bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}
                  onClick={() => setSelectedMemoryPackId(p.pack_id)}
                >
                  <div className='font-medium'>{p.chapter_id} / {p.job_id}</div>
                  <div className='text-muted'>evidence={p.summary?.evidence_count || 0} compression={p.summary?.compression_steps || 0}</div>
                </button>
              ))}
              {!Array.isArray(memoryPacks) || !memoryPacks.length ? <p className='text-sm text-muted'>No memory packs yet. Run a job first.</p> : null}
            </div>
            <div className='rounded-ui border border-border bg-surface-2 p-3'>
              {selectedMemoryPack ? (
                <div className='space-y-2'>
                  <div className='text-xs'><b>Pack:</b> {selectedMemoryPack.pack_id}</div>
                  <div className='text-xs'><b>Budget report</b></div>
                  <pre className='mono text-[11px] overflow-auto max-h-36'>{JSON.stringify(selectedMemoryPack.budget_report || {}, null, 2)}</pre>
                  <div className='text-xs'><b>Evidence</b></div>
                  <div className='space-y-1 max-h-32 overflow-auto'>
                    {(selectedMemoryPack.evidence || []).map((e: any) => (
                      <button key={`${e.kb_id}:${e.chunk_id}`} className='w-full rounded-ui border border-border bg-surface px-2 py-1 text-left text-xs hover:bg-surface-2' onClick={() => openEvidence(e)}>
                        {e.kb_id}:{e.chunk_id}
                      </button>
                    ))}
                  </div>
                </div>
              ) : <p className='text-sm text-muted'>Select a memory pack.</p>}
            </div>
          </div>
        </Card>
        <Card title='Context Manifest' extra={selectedBlueprintId ? <Badge>Blueprint: {selectedBlueprintId}</Badge> : undefined}>
          {currentManifest ? (
            <pre className='mono text-xs overflow-auto rounded-ui bg-surface-2 p-3'>{JSON.stringify(currentManifest, null, 2)}</pre>
          ) : (
            <Skeleton className='h-20' />
          )}
        </Card>
        <Card title='Evidence Jump'>
          <div className='space-y-2'>
            {evidence.map((e: any) => (
              <button key={`${e.kb_id}:${e.chunk_id}`} className='w-full rounded-ui border border-border bg-surface px-2 py-2 text-left text-sm hover:bg-surface-2' onClick={() => openEvidence(e)}>
                <span className='font-medium'>{e.kb_id}:{e.chunk_id}</span>
                <span className='ml-2 text-xs text-muted'>{e.source?.path}</span>
              </button>
            ))}
            {!evidence.length && <p className='text-sm text-muted'>No evidence yet.</p>}
          </div>
        </Card>
      </div>
    )
  }, [
    view,
    projects,
    storyCards,
    storyForm, storyLockedPaths, characterLockedPaths, chapterLockedPaths, characterEditorOpen, worldNavigationRequest, cardSaveState, sharedRelationshipFocus, sharedRelationshipStageFocus, informationFocus, storyLocal.recovery, characterLocal.recovery, chapterLocal.recovery, alignmentLocal.recovery,
    charSchema,
    characterForm,
    chars,
    styleSchema,
    styles, styleCandidate, currentStoryEvents,
    draft, draftReadError,
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
    generationStartChapter, generationEndChapter, generationStartBeat, generationEndBeat,
    characterInstructions, writingChapterRows, writingBeatRows, writingRuns, writingBlueprint, isChapterGenerating,
    profiles,
    selectedProfileHealth,
    writeRouteRows,
    selectedChapter,
    currentChapterMeta,
    currentVolume,
    volumeRows,
    chapterRows,
    chapterEditorText,
    chapterTitleDraft, chapterContextDraft,
    chapterSaving,
    chapterReferenceSelection, chapterMaterialSelection,
    alignmentIdea, sceneDirection, characterDetailFocus,
    alignmentUnderstanding, agreementEditingKey,
    alignmentAgreedDraft,
    alignmentConfirmed,
    alignmentDiscussionInput,
    alignmentMessages,
    localModelStatus, storyPlanningTab, overviewEvents, chapterPane, personPane, eventOrigin,
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
    techniqueQuery, selectedTechniqueCategoryId, showIncompleteTechniques,
    techniqueLibraryTab,
    referenceTarget, cardReferenceRequest, savedWorldCards, allCards, materialFocusRequest, directRehearsal, selectedSceneAnchor,
    toolSkillCards,
    toolSkillSchema,
    toolSkillForm,
    buildDraft,
    buildDraftBusy,
    buildWizardStep,
    selectedTimelineNodeId,
    activeBuildWizardStep,
    pendingWriteJob, materialExpansionSelection,
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
    selectedMemoryPackId, versionCompareRequest,
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
    { name: '审查', event: 'PRE_REVIEW_PLAN', data: latestEvent('PRE_REVIEW_PLAN') },
    { name: '写作', event: 'WRITER_DRAFT', data: latestEvent('WRITER_DRAFT') },
    { name: '校对', event: 'PROOFREAD_PATCH', data: latestEvent('PROOFREAD_PATCH') },
  ]
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
      return { type: 'technique', label: referenceLabel(tech, row.technique_id), mark: findRequirementMark('technique', [row.technique_id, tech?.title, tech?.payload?.name, ...(tech?.payload?.signals || [])]) }
    }),
  ]
  const rightPinnedTechniqueRows = Array.isArray(currentChapterMeta?.pinned_techniques) ? currentChapterMeta.pinned_techniques : []
  const rightPinnedTechniqueIds = new Set(rightPinnedTechniqueRows.map((row: any) => row.technique_id))
  const rightQuickTechniqueRows = (Array.isArray(techniqueCards) ? techniqueCards : []).filter((tech: any) => !isIncompleteReference(tech) && !rightPinnedTechniqueIds.has(tech.id)).slice(0, 6)
  const rightAutoRecommendedTechniques = (latestTechniqueBriefForRight?.checklist || []).filter((x: any) => String(x?.source || '').startsWith('auto_from_category') && (techniqueCards || []).some((card: any) => card.id === x.technique_id && !isIncompleteReference(card)))
  const pinRightAutoTechnique = async (row: any) => {
    const tech = (techniqueCards || []).find((x: any) => x.id === row.technique_id)
    if (!tech) {
      push('没有找到该技法，请刷新资料后重试。', 'error')
      return
    }
    const out = await pinTechniqueToChapter(tech, row.intensity || 'med', row.weight, row.notes)
    push(out.message || (out.ok ? '已挂载技法' : '挂载失败'), out.ok ? 'info' : 'error')
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
    <div className='space-y-4 density-space'>
      <ContextMaterialSummary key={`${project}:${selectedChapter}:actual-materials`} project={project} chapterId={selectedChapter} pack={(draft?.meta || {}).context_manifest?.context_pack} onOpen={openMaterial} />
      <Button className='text-xs' onClick={() => { setWorldNavigationRequest({ section: 'stage', requestId: Date.now() }); setActiveActivity('cards'); setView('world') }}>浏览当前阶段的世界</Button>
      <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>本章准备与检查</summary><div className='mt-4 space-y-3'>
      <Button className='text-xs' onClick={() => setChapterReferencesOpen(true)}>本章写法参考（{selectedChapterReferenceIds.length}）</Button>
      <InformationPanel key={`${project}:${selectedChapter}:inspector-info`} project={project} chapterId={selectedChapter} storyId={storyForm.id} text={chapterEditorText} revision={draft?.revision} dirty={chapterEditorText !== draft?.content} title='人物所知与读者已见' />
      <Card title='本章上下文' extra={<Badge>{chapterTitleDraft || currentChapterMeta?.chapter_title || '当前章'}</Badge>}>
        <div className='space-y-2 text-xs'>
          <div className='rounded-ui border border-border bg-surface-2 p-2'>
            <div className='font-medium'>{currentVolume?.title || currentVolume?.id || 'volume_default'}</div>
            <div className='text-muted'>{chapterTitleDraft || currentChapterMeta?.chapter_title || selectedChapter}</div>
          </div>
          <div>
            <div className='mb-1 font-medium'>章节计划</div>
            {(currentStoryLinks.chapterPlan || []).map((row: any, idx: number) => (
              <div key={`plan-${idx}`} className='mb-1 rounded-ui border border-border bg-surface px-2 py-1'>
                {row.title || row.focus || row.chapter || row.chapter_id}
              </div>
            ))}
            {!currentStoryLinks.chapterPlan.length && <div className='text-muted'>还没有绑定章节计划。</div>}
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div className='rounded-ui border border-border bg-surface p-2'>
              <div className='font-medium'>明线</div>
              <div className='text-muted'>{currentStoryLinks.openLine.length ? currentStoryLinks.openLine.map((x: any) => x.event || x.result || x.chapter).join(' / ') : '未绑定'}</div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-2'>
              <div className='font-medium'>暗线</div>
              <div className='text-muted'>{currentStoryLinks.hiddenLine.length ? currentStoryLinks.hiddenLine.map((x: any) => x.truth || x.visible_hint || x.chapter).join(' / ') : '未绑定'}</div>
            </div>
          </div>
          <div>
            <div className='mb-1 font-medium'>伏笔</div>
            {currentStoryLinks.foreshadowings.map((x: any) => (
              <div key={x.id || x.content} className='mb-1 rounded-ui border border-border bg-surface px-2 py-1'>
                {x.content || x.id} <span className='text-muted'>({x.status || '未出现'})</span>
              </div>
            ))}
            {!currentStoryLinks.foreshadowings.length && <div className='text-muted'>还没有绑定伏笔。</div>}
          </div>
        </div>
      </Card>

      <section id='chapter-check-details' className='space-y-3 border-t border-border pt-4'>
        <div className='flex items-center justify-between gap-2'><h3 className='font-semibold'>检查结果</h3><Button className='text-xs' onClick={analyzeMarks}>检查正文</Button></div>
        <p className='text-sm text-muted'>{!evidenceMarkRows.length ? '尚未检查当前正文。' : evidenceMarkRows.some((mark: any) => mark.detection?.support_level !== 'supported' && !['confirm_hit', 'false_positive', 'ignore_chapter'].includes(mark.author_feedback?.action)) ? '有内容需要核对，展开后可查看原句并处理。' : '暂未发现待处理问题。'}</p>
        <details><summary className='cursor-pointer text-sm font-medium'>待处理问题与正文依据</summary><div className='mt-3 space-y-3'>      <Card title='逐项要求'>
        <div className='space-y-1'>
          {requirementLights.map((item: any, idx: number) => {
            const level = item.mark?.detection?.support_level || 'unsupported'
            return (
              <button
                key={`${item.type}:${item.label}:${idx}`}
                className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
                onClick={() => {
                  if (!item.mark) return
                  setSelectedMarkId(item.mark.mark_id)
                  const start = Number(item.mark?.span?.start_line || 0)
                  const end = Number(item.mark?.span?.end_line || start)
                  if (start > 0) setHighlightRange({ start, end })
                }}
              >
                <div className='flex items-center justify-between gap-2'>
                  <span>{requirementTypeLabel(item.type)} · {item.label || '未命名要求'}</span>
                  <Badge tone={markTone(level) as any}>{item.mark?.span?.quote ? supportLabel(level) : '未证实'}</Badge>
                </div>
                {item.mark?.span?.quote ? <div className='mt-1 truncate text-muted'>正文第 {item.mark.span.start_line} 行：{item.mark.span.quote}</div> : <div className='mt-1 text-muted'>没有正文原句，不能算写到了</div>}
              </button>
            )
          })}
          {!requirementLights.length && <p className='text-xs text-muted'>当前章节还没有绑定明线、暗线、伏笔或已选写作参考。</p>}
        </div>
      </Card>

      <Card title='证据详情' extra={selectedMark ? <Badge tone={selectedMark?.detection?.support_level === 'supported' ? 'success' : selectedMark?.detection?.support_level === 'partial' ? 'warn' : 'default'}>{supportLabel(selectedMark?.detection?.support_level)}</Badge> : undefined}>
        {selectedMark ? (
          <div className='space-y-2 text-xs'>
                <div className='font-medium'>{requirementTypeLabel(selectedMark.target_type)} · {referenceLabel({ title: selectedMark.label || selectedMark.target_id })}</div>
            <div className='text-muted'>{selectedMark.detection?.note || '可回查证据'}</div>
            {selectedMark.author_feedback ? (
              <div className='rounded-ui border border-border bg-surface-2 px-2 py-1 text-muted'>
                作者反馈: {selectedMark.author_feedback.action} · {selectedMark.author_feedback.ts || ''}
              </div>
            ) : null}
            <button
              className='w-full rounded-ui border border-border bg-surface-2 p-2 text-left hover:bg-surface'
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
              <Button className='text-xs' onClick={() => updateEvidenceFeedback(selectedMark, 'confirm_hit')}>确认命中</Button>
              <Button className='text-xs' onClick={() => updateEvidenceFeedback(selectedMark, 'false_positive')}>标为误判</Button>
              <Button
                className='text-xs'
                onClick={() => {
                  const start = Number(selectedMark?.span?.start_line || 0)
                  const end = Number(selectedMark?.span?.end_line || start)
                  if (start > 0) requestRunJob(1200, { start, end }, '让 AI 改段')
                  else push('这个标记没有可编辑行号', 'error')
                }}
              >
                让 AI 改段
              </Button>
              <Button className='text-xs' onClick={() => updateEvidenceFeedback(selectedMark, 'ignore_chapter')}>忽略本章</Button>
            </div>
          </div>
        ) : <p className='text-xs text-muted'>暂无证据标记。</p>}
      </Card>

</div></details>
      </section>

      </div></details>
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

  const scopedMaterialIds = new Set<string>()
  const materialRows = Array.isArray(allCards) ? allCards : []
  const currentObject = view === 'characters' && characterEditorOpen ? characterForm : view === 'world' ? materialRows.find((card: any) => card.id === activeWorldCardId) : view === 'style' ? materialRows.find((card: any) => card.id === activeStyleCardId) : null
  if (['world', 'style', 'characters'].includes(view)) {
    if (currentObject) for (const id of [currentObject.id, currentObject.payload?.parent_id, ...(currentObject.links || []), ...(currentObject.payload?.material_ids || []), ...(currentObject.payload?.relationships || []).map((row: any) => row.target)].filter(Boolean)) scopedMaterialIds.add(id)
  } else {
    for (const id of [storyForm.id, storyForm.payload?.world_context?.world_id, ...(storyForm.links || []), ...(storyForm.payload?.material_ids || [])].filter(Boolean)) scopedMaterialIds.add(id)
  }
  const scopedRightCards = (Array.isArray(allCards) ? allCards : []).filter((card: any) => scopedMaterialIds.has(card.id))
  const writingManuscript = view === 'chapter' && chapterPane === '正文'
  const chapterTechniqueIds = new Set([...selectedChapterReferenceIds, ...rightPinnedTechniqueRows.map((row: any) => row.technique_id)])
  const chapterTechniques = <section className='space-y-3'>
    {Array.from(chapterTechniqueIds).map(id => {
      const card = (Array.isArray(allCards) ? allCards : []).find(card => card.id === id)
      return card && <details key={id}>
        <summary className='cursor-pointer'>{referenceLabel(card)}</summary>
        <p className='mt-2 text-sm'>{card.payload?.description || card.payload?.summary}</p>
      </details>
    })}
    <Button onClick={() => { setChapterMaterialsOpen(false); setChapterReferencesOpen(true) }}>选择技法</Button>
  </section>
  const scopedMaterialPanel = <div className='space-y-4'><p className='text-xs leading-6 text-muted'>{currentObject ? `“${referenceLabel(currentObject)}”与明确关联的资料。` : '当前故事与明确关联的资料。'}查阅不会自动加入生成材料。</p><Button className='text-xs' onClick={() => { setWorldNavigationRequest({ section: 'stage', requestId: Date.now() }); setActiveActivity('cards'); setView('world') }}>浏览当前阶段的世界</Button><ul className='space-y-3'>{scopedRightCards.map((card: any) => <li key={card.id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => openMaterial(card)}>{referenceLabel(card)}</button></li>)}</ul>{!scopedRightCards.length && <p className='text-xs leading-6 text-muted'>暂无关联资料。</p>}</div>

  const technicalDetails = <div className='mt-6 space-y-4'>
      <details className='rounded-ui border border-border bg-surface'>
        <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>维护记录 <span className='text-xs text-muted'>开源维护 / 调试</span></summary>
        <div className='space-y-2 border-t border-border p-2'>
          <Card
            title='Runtime'
            extra={<Badge tone={providerInfo?.fallback ? 'warn' : 'success'}>{providerInfo?.provider || '-'} / {providerInfo?.model || '-'}</Badge>}
          >
            <div className='text-xs text-muted'>fallback: {providerInfo?.fallback ? 'yes' : 'no'}</div>
          </Card>

          <Card title='Pinned Techniques'>
            <pre className='mono text-xs max-h-40 overflow-auto rounded-ui bg-surface-2 p-2'>{JSON.stringify({
              techniques: currentChapterMeta?.pinned_techniques || [],
              categories: currentChapterMeta?.pinned_technique_categories || [],
            }, null, 2)}</pre>
          </Card>

      <details className='rounded-ui border border-border bg-surface'>
        <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>Patch Review <span className='text-xs text-muted'>({reviewPatch?.ops?.length || 0})</span></summary>
        <div className='space-y-2 border-t border-border p-2'>
          {reviewPatch ? (
            <div className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
              <div className='flex items-center justify-between gap-2'>
                <span>{reviewPatch.patch_review_id || reviewPatch.review_id || reviewPatch.patch_id}</span>
                <Badge tone={reviewPatch.status === 'pending_author_review' ? 'warn' : reviewPatch.status === 'accepted' ? 'success' : 'default'}>{reviewPatch.status || 'event_patch'}</Badge>
              </div>
              <div className='mt-1 text-muted'>{reviewPatch.source || 'proofread_agent'} · {reviewPatch.provider || '-'} / {reviewPatch.model || '-'}</div>
            </div>
          ) : null}
          {(reviewPatch?.ops || []).map((op: any) => (
            <div key={op.op_id} className='rounded-ui border border-border bg-surface-2 p-2'>
              <label className='flex items-center gap-2 text-xs'>
                <input type='checkbox' checked={selectedOpIds.includes(op.op_id)} onChange={(e) => setSelectedOpIds((x) => (e.target.checked ? [...x, op.op_id] : x.filter((id) => id !== op.op_id)))} />
                <span className='font-medium'>{op.op_id}</span>
                <Badge>{op.type}</Badge>
              </label>
              <pre className='mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-ui bg-red-50 p-2 text-[11px] dark:bg-red-950/20'>- {op.before || ''}</pre>
              <pre className='mono mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-ui bg-emerald-50 p-2 text-[11px] dark:bg-emerald-950/20'>+ {op.after || ''}</pre>
            </div>
          ))}
          {!reviewPatch?.ops?.length && <p className='text-xs text-muted'>No patch generated yet.</p>}
          <div className='flex gap-2'>
            <Button className='text-xs' onClick={() => setSelectedOpIds((reviewPatch?.ops || []).map((o: any) => o.op_id))}>全选</Button>
            <Button className='text-xs' onClick={applySelectedPatch}>应用</Button>
            <Button className='text-xs' onClick={rejectPatchReview}>拒绝</Button>
          </div>
        </div>
      </details>

      <details className='rounded-ui border border-border bg-surface'>
        <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>版本时间线 <span className='text-xs text-muted'>({versions?.versions?.length || 0})</span></summary>
        <div className='space-y-2 border-t border-border p-2'>
          <div className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-medium'>当前版本</span>
              <Badge>{versions?.current_version || '未记录'}</Badge>
            </div>
            <div className='mt-1 text-muted'>先比较与当前正文的差异，再确认恢复；当前正文会保留为快照。</div>
          </div>
          {(versions?.versions || []).map((v: any) => (
            <div key={v.version_id} className='rounded-ui border border-border bg-surface-2 px-2 py-2 text-xs'>
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-1'>
                    <span className='font-medium'>{v.label || v.reason || '版本快照'}</span>
                    <Badge tone={v.tone === 'warn' ? 'warn' : v.is_current ? 'success' : 'default'}>{v.is_current ? '当前' : v.version_id}</Badge>
                  </div>
                  <div className='mt-1 text-muted'>{v.ts || 'no timestamp'}</div>
                  {v.patch_id ? <div className='mt-1 truncate text-muted'>关联: {v.patch_id}</div> : null}
                </div>
                <Button className='shrink-0 text-xs' disabled={v.is_current} onClick={() => compareVersion(v.version_id)}>比较与恢复</Button>
              </div>
            </div>
          ))}
          {(!versions?.versions || versions.versions.length === 0) && <p className='text-xs text-muted'>No versions yet.</p>}
        </div>
      </details>

      <details className='rounded-ui border border-border bg-surface'>
        <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>Technique Brief</summary>
        <pre className='mono max-h-60 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-2 text-xs'>{JSON.stringify(latestTechniqueBriefForRight, null, 2)}</pre>
      </details>

      <details className='rounded-ui border border-border bg-surface'>
        <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>Memory Packs <span className='text-xs text-muted'>({Array.isArray(memoryPacks) ? memoryPacks.length : 0})</span></summary>
        <div className='space-y-1 border-t border-border p-2'>
          {(Array.isArray(memoryPacks) ? memoryPacks : []).slice(0, 6).map((p: any) => (
            <button key={p.pack_id} className='w-full rounded-ui border border-border bg-surface-2 px-2 py-1 text-left text-xs hover:bg-surface' onClick={() => { setSelectedMemoryPackId(p.pack_id); setView('context') }}>
              {p.chapter_id} / {p.job_id}
              {p.summary?.compression_reason ? <div className='text-[11px] text-muted'>{p.summary.compression_reason}</div> : null}
            </button>
          ))}
          {!Array.isArray(memoryPacks) || !memoryPacks.length ? <p className='text-xs text-muted'>No memory packs yet.</p> : null}
        </div>
      </details>

      <details className='rounded-ui border border-border bg-surface'>
        <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>Context Manifest</summary>
        <pre className='mono max-h-60 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-2 text-xs'>{JSON.stringify(currentManifest || {}, null, 2)}</pre>
      </details>

      {Object.entries(eventGroups).map(([group, rows]) => (
        <details key={group} className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>{group} <span className='text-xs text-muted'>({rows.length})</span></summary>
          <div className='border-t border-border p-2'>
            <pre className={`mono text-xs ${settings.evidenceWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'} overflow-auto max-h-60 rounded-ui bg-surface-2 p-2`}>
              {rows.map((e) => `${e.event}\n${JSON.stringify(e.data, null, 2)}`).join('\n\n') || 'No events'}
            </pre>
          </div>
        </details>
      ))}
        </div>
      </details>

  </div>

  const confirmRouteRiskCount = writeRouteRows.filter((row: any) => row.is_mock || row.profile_missing || row.missing_fields?.length).length
  const confirmPinnedTechniques = Array.isArray(currentChapterMeta?.pinned_techniques) ? currentChapterMeta.pinned_techniques : []
  const confirmPinnedCategories = Array.isArray(currentChapterMeta?.pinned_technique_categories) ? currentChapterMeta.pinned_technique_categories : []
  const confirmReadinessItems = [
    { label: '书名/题材', done: hasText(storyForm?.title) && hasText(activeStoryPayload.genre), detail: `${storyForm?.title || '缺书名'} · ${activeStoryPayload.genre || '缺题材'}` },
    { label: '小故事大纲', done: hasText(activeStoryPayload.logline), detail: activeStoryPayload.logline ? '已填写' : '缺一句话故事' },
    { label: '主冲突/禁写', done: hasText(activeStoryPayload.main_conflict) && hasArrayItems(activeStoryPayload.banned_items), detail: `${hasText(activeStoryPayload.main_conflict) ? '主冲突已填' : '缺主冲突'} · 禁写 ${(activeStoryPayload.banned_items || []).length || 0}` },
    { label: '人物卡', done: Array.isArray(chars) && chars.length > 0, detail: `${Array.isArray(chars) ? chars.length : 0} 张` },
    { label: '绑定章节计划', done: currentStoryLinks.chapterPlan.length > 0, detail: `${currentStoryLinks.chapterPlan.length} 行` },
    { label: '本章明暗伏', done: currentStoryLinks.openLine.length + currentStoryLinks.hiddenLine.length + currentStoryLinks.foreshadowings.length > 0, detail: `明 ${currentStoryLinks.openLine.length} · 暗 ${currentStoryLinks.hiddenLine.length} · 伏 ${currentStoryLinks.foreshadowings.length}` },

    { label: '写作共识', done: Boolean(alignmentConfirmed && alignmentAgreedDraft.trim()), detail: alignmentConfirmed ? '作者已确认' : '还没有确认写法' },
  ]
  const confirmReadyCount = confirmReadinessItems.filter((item) => item.done).length

  const pendingMaterialBody = pendingWriteJob ? buildGenerationRequest(pendingWriteJob.maxTokens) : null
  const materialPreviewCurrent = Boolean(pendingMaterialBody && materialPreview?.scope === generationMaterialScope && materialPreview?.requestKey === JSON.stringify(pendingMaterialBody) && !materialPreview.invalidated)
  const previewData = materialPreview?.data
  const openPreviewMaterial: OpenMaterial = (target) => { setPendingWriteJob(null); void openMaterial(target) }
  const adjustMaterialInput = (id: string) => {
    setPendingWriteJob(null); setChapterPane('本章安排'); setActiveActivity('explorer'); setView('chapter')
    window.setTimeout(() => {
      const element = document.getElementById(id)
      for (let parent = element; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
      element?.scrollIntoView({ block: 'center' })
      ;(element?.matches('input,select,textarea') ? element : element?.querySelector<HTMLElement>('summary,input,select,textarea'))?.focus()
    }, 0)
  }

  const writeConfirmOverlay = pendingWriteJob ? (
    <div className='fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-10 backdrop-blur-[1px]' onMouseDown={() => setPendingWriteJob(null)}>
      <div
        role='dialog'
        aria-modal='true'
        aria-label='生成前确认'
        className='flex max-h-[90dvh] w-[min(840px,96vw)] min-h-0 flex-col rounded-ui border border-border bg-panel shadow-soft'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className='border-b border-border px-4 py-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <h3 className='text-base font-semibold'>生成前确认</h3>
              <p className='text-xs text-muted'>核对将实际带入的原文与引用；这里不调用模型，确认后才开始生成。</p>
            </div>
            <Badge tone={materialPreviewCurrent && previewData?.ready ? 'success' : 'warn'}>{materialPreviewCurrent && previewData?.ready ? '材料已核对' : '待核对材料'}</Badge>
          </div>
        </div>
        <div className='min-h-0 overflow-auto p-4'>
          <section className='space-y-4' aria-label='生成前实际材料核对'>
            <div className='flex flex-wrap items-center justify-between gap-3'><div><h4 className='text-base font-semibold'>本次生成材料</h4><p className='mt-1 text-xs text-muted'>{chapterTitleDraft || '当前章节'} · {pendingWriteJob.label}</p></div><Button disabled={materialPreviewBusy || generationStarting} onClick={() => previewGenerationMaterials(pendingWriteJob.maxTokens)}>{materialPreviewBusy ? '正在核对材料…' : '重新核对材料'}</Button></div>
            {materialPreviewError && <p role='alert' className='whitespace-pre-wrap text-sm leading-7 text-red-700 dark:text-red-300'>{materialPreviewError}</p>}
            {materialPreviewBusy && <p role='status' className='text-sm text-muted'>正在按本次任务读取来源与预算，不调用模型…</p>}
            {previewData && !materialPreviewCurrent && !materialPreviewBusy && <p role='status' className='text-sm leading-7 text-muted'>范围、重点、引用或来源已改变，下面保留上次预览。请重新核对后再生成。</p>}
            {previewData && <>
              <p className='text-sm leading-7'>{previewData.ready ? '必用内容已完整纳入，以下文字将随本次任务带入。' : '这些材料尚不能完整带入，当前不能开始生成。请处理下方具体问题。'}</p>
              {previewData.budget && <div className='space-y-1 text-xs leading-6 text-muted'><p>材料文字 {previewData.budget.used_chars?.toLocaleString('zh-CN') || 0} / {previewData.budget.max_chars?.toLocaleString('zh-CN') || 0} 字符；必须完整保留 {previewData.budget.required_chars?.toLocaleString('zh-CN') || 0} 字符。</p><p>输入约 {previewData.budget.estimated_input_tokens?.toLocaleString('zh-CN') || 0} token（估算），另预留 {previewData.budget.output_reserved_tokens?.toLocaleString('zh-CN') || 0} token 输出。{!previewData.budget.context_limit_known && '当前模型的上下文上限未确认，请核对模型配置。'}</p>{(previewData.budget.warnings || []).map((notice: string, index: number) => <p key={index}>{notice}</p>)}</div>}
              {previewData.overflow?.length > 0 && <section className='space-y-2 border-y border-border py-3' aria-label='无法完整带入的材料'><h5 className='text-sm font-semibold'>需要调整的材料</h5><ul className='space-y-3'>{previewData.overflow.map((item: any, index: number) => <li key={item.id || index} className='text-sm leading-7'><strong className='font-medium'>{item.label || '一项材料'}</strong>{Number.isFinite(item.chars) ? `（${item.chars} 字符）` : ''}<p className='text-xs text-muted'>{item.reason}</p></li>)}</ul><p className='text-xs leading-6 text-muted'>可以分场景生成，减少本次重点或引用展开，或改用容量合适的模型。必用原文不会为凑预算被悄悄截断。</p><div className='flex flex-wrap gap-2'><Button disabled={generationStarting} onClick={() => adjustMaterialInput('chapter-character-detail-focus')}>调整重点</Button><Button disabled={generationStarting} onClick={() => adjustMaterialInput('chapter-generation-scope')}>调整生成范围</Button></div></section>}
              <GenerationMaterialItems preview names={Object.fromEntries([...(Array.isArray(allCards) ? allCards : []).map((card: any) => [card.id, card.payload?.name || card.title]), ...chapterRows.map((chapter: any) => [chapter.chapter_id, chapter.chapter_title || chapter.title])])} items={previewData.items || []} onOpen={openPreviewMaterial} expansions={materialExpansions} onExpansionsChange={(items) => setMaterialExpansionSelection({ scope: generationMaterialScope, items })} />
              {materialExpansions.length > 0 && <div className='space-y-2'><h5 className='text-sm font-medium'>本次另外展开的引用</h5>{materialExpansions.map((reference, index) => <div key={expansionKey(reference)} className='flex items-center justify-between gap-3'><span className='text-xs text-muted'>第 {index + 1} 处引用{reference.follow_refs ? '，并沿稳定引用继续取材' : '，仅该段原文'}</span><Button className='text-xs' onClick={() => setMaterialExpansionSelection({ scope: generationMaterialScope, items: materialExpansions.filter((entry) => expansionKey(entry) !== expansionKey(reference)) })}>移除本次展开</Button></div>)}</div>}
            </>}
          </section>
          <details className='mt-5 border-t border-border pt-4'><summary className='cursor-pointer text-sm text-muted'>写法、生成设置与其他准备</summary><div className='mt-4'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 font-medium'>本次写作</div>
              <div>动作：{pendingWriteJob.label}</div>
              <div>章节：{chapterTitleDraft || currentChapterMeta?.chapter_title || selectedChapter}</div>
              <div>所属卷：{currentVolume?.title || currentVolume?.id || '默认卷'}</div>
              <div>范围：{GENERATION_SCOPE_OPTIONS.find((item) => item.id === generationScope)?.label || '当前章节'}</div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='font-medium'>生成控制</span>
                <Badge>{GENERATION_SCOPE_OPTIONS.find((x) => x.id === generationScope)?.label || generationScope}</Badge>
              </div>
              <div>生成范围：{GENERATION_SCOPE_OPTIONS.find((x) => x.id === generationScope)?.label || generationScope}</div>
              <div>停止点：{GENERATION_STOP_OPTIONS.find((x) => x.id === generationStopPoint)?.label || generationStopPoint}</div>
              <div>检查方式：{GENERATION_CHECK_OPTIONS.find((x) => x.id === generationCheckMode)?.label || generationCheckMode}</div>
              <div className='mt-2 flex flex-wrap gap-1'>
                <Badge tone={generationUseCards ? 'success' : 'warn'}>{generationUseCards ? '使用卡片' : '不使用卡片'}</Badge>
                <Badge tone={generationUseTechniques ? 'success' : 'warn'}>{generationUseTechniques ? '使用所选参考' : '不使用参考'}</Badge>
                <Badge tone={generationUseLines ? 'success' : 'warn'}>{generationUseLines ? '使用脉络' : '不使用脉络'}</Badge>
              </div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs md:col-span-2'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='font-medium'>作者同意这样写</span>
                <Badge tone={alignmentConfirmed ? 'success' : 'warn'}>{alignmentConfirmed ? '已确认' : '待确认'}</Badge>
              </div>
              <div className='max-h-36 overflow-auto whitespace-pre-wrap rounded-ui border border-border bg-surface-2 p-2 text-muted'>
                {alignmentAgreedDraft || '还没有写作共识。请先在章节页上方确认“作者同意这样写”。'}
              </div>
            </div>
          </div>
          <div className='mt-3 rounded-ui border border-border bg-surface p-3 text-xs'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <span className='font-medium'>本章开写检查</span>
              <Badge tone={confirmReadyCount === confirmReadinessItems.length ? 'success' : 'warn'}>{confirmReadyCount}/{confirmReadinessItems.length}</Badge>
            </div>
            <div className='grid grid-cols-2 gap-1.5 md:grid-cols-4'>
              {confirmReadinessItems.map((item) => (
                <div key={item.label} className={`rounded-ui border px-2 py-1.5 ${item.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface-2'}`}>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='font-medium'>{item.label}</span>
                    <Badge tone={item.done ? 'success' : 'warn'}>{item.done ? '已亮' : '待补'}</Badge>
                  </div>
                  <div className='mt-1 truncate text-muted'>{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
          <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-3'>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>章节计划</span><Badge>{currentStoryLinks.chapterPlan.length}</Badge></div>
              {(currentStoryLinks.chapterPlan || []).slice(0, 4).map((row: any, idx: number) => (
                <div key={`confirm-plan-${idx}`} className='mb-1 truncate text-muted'>{row.title || row.focus || row.chapter || row.chapter_id}</div>
              ))}
              {!currentStoryLinks.chapterPlan.length && <div className='text-muted'>还没有绑定章节计划。</div>}
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>明线 / 暗线</span><Badge>{currentStoryLinks.openLine.length + currentStoryLinks.hiddenLine.length}</Badge></div>
              <div className='text-muted'>明线：{currentStoryLinks.openLine.length ? currentStoryLinks.openLine.map((x: any) => x.event || x.result || x.chapter).join(' / ') : '未绑定'}</div>
              <div className='mt-1 text-muted'>暗线：{currentStoryLinks.hiddenLine.length ? currentStoryLinks.hiddenLine.map((x: any) => x.visible_hint || x.truth || x.chapter).join(' / ') : '未绑定'}</div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>伏笔</span><Badge>{currentStoryLinks.foreshadowings.length}</Badge></div>
              {currentStoryLinks.foreshadowings.slice(0, 4).map((x: any) => (
                <div key={x.id || x.content} className='mb-1 truncate text-muted'>{x.content || x.id} ({x.status || '未出现'})</div>
              ))}
              {!currentStoryLinks.foreshadowings.length && <div className='text-muted'>还没有绑定伏笔。</div>}
            </div>
          </div>
          <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>本章技法</span><Badge>{(currentChapterMeta?.pinned_techniques || []).length}</Badge></div>
              {(currentChapterMeta?.pinned_techniques || []).slice(0, 6).map((row: any) => {
                const tech = (Array.isArray(techniqueCards) ? techniqueCards : []).find((x: any) => x.id === row.technique_id)
                return <div key={row.technique_id} className='mb-1 truncate text-muted'>{referenceLabel(tech, row.technique_id)} · {row.intensity || 'med'}</div>
              })}
              {!(currentChapterMeta?.pinned_techniques || []).length && <div className='text-muted'>还没有挂载技法。</div>}
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>安全规则</span><Badge>{autoApplyPatch ? '需注意' : '默认安全'}</Badge></div>
              <div className='text-muted'>生成新稿前会保存当前正文的备份，AI 草稿仍需作者检查。</div>
              <div className='mt-1 text-muted'>校对建议默认进入待确认，作者可以接受或拒绝。</div>
              <div className='mt-1 text-muted'>没有正文证据的判断不会显示为已命中。</div>
            </div>
          </div>
          <details className='mt-3 rounded-ui border border-border bg-surface-2 text-xs text-muted'>
            <summary className='cursor-pointer px-3 py-2 font-medium text-foreground'>维护信息</summary>
            <div className='space-y-2 border-t border-border p-3'>
              <div>路由：{useAgentAssignments ? 'Settings agent assignments' : `${llmProfileId} overrides all agents`}；auto apply patch：{autoApplyPatch ? 'on' : 'off'}；max tokens：{pendingWriteJob.maxTokens}</div>
              <div className='space-y-1'>
                {writeRouteRows.map((row: any) => (
                  <div key={row.module} className='rounded-ui border border-border bg-surface px-2 py-1'>
                    <span className='font-medium'>{row.module}</span>
                    <span className='ml-2'>{row.profile_id} · {row.provider || 'missing'} / {row.model || 'no model'}</span>
                    {row.is_mock || row.profile_missing || row.missing_fields?.length ? <span className='ml-2 text-amber-700 dark:text-amber-300'>需要检查</span> : null}
                  </div>
                ))}
                {!writeRouteRows.length ? <div>Runtime status not loaded yet.</div> : null}
              </div>
              <div>Memory packs：{Array.isArray(memoryPacks) ? memoryPacks.length : 0}</div>
            </div>
          </details>
          </div></details>
        </div>
        <div className='flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3'>
          <Button onClick={() => { setPendingWriteJob(null); setActiveActivity('settings'); setView('settings') }}>模型与设置</Button>
          <Button onClick={() => setPendingWriteJob(null)}>取消</Button>
          <Button
            variant='primary'
            disabled={generationStarting || materialPreviewBusy || !materialPreviewCurrent || !previewData?.ready || !previewData?.fingerprint}
            onClick={() => { if (pendingWriteJob) void runJob(pendingWriteJob.maxTokens, pendingWriteJob.range) }}
          >
            {generationStarting ? '正在开始生成…' : '确认这些材料并生成'}
          </Button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <Layout left={left} header={header} surface={view} navigationKey={`${project}:${view}:${selectedChapter}`}
        inspectorTitle={writingManuscript ? '本章技法' : view === 'settings' ? '模型说明' : ['chapter', 'scene-rehearsal'].includes(view) ? '本次生成材料' : ({ world: '世界资料', characters: '人物资料', style: '文风资料' } as Record<string, string>)[view] || '当前故事资料'}
        right={writingManuscript ? chapterTechniques : view === 'settings' ? <p className='text-sm leading-7 text-muted'>模型按任务分工；密钥只在本机保存。连接状态与配置在当前页面查看。</p> : ['chapter', 'scene-rehearsal'].includes(view) ? right : scopedMaterialPanel}
        center={<>
          {['characters', 'relationships', 'world'].includes(view) && <>
            {!eventOrigin && recentWriting.current?.project === project && chapterRows.some((row: any) => row.chapter_id === recentWriting.current?.chapter) &&
              <button className='return-manuscript focus-ring' onClick={() => openManuscript(recentWriting.current!.chapter)}>← 返回正文</button>}
            {eventOrigin && <button className='toolbar-control' onClick={() => enterStoryEvent(eventOrigin.owner, eventOrigin.scene)}>
              返回事件 · {eventOrigin.label}
            </button>}
          </>}
          {view === 'style' && <button className='toolbar-control' onClick={() => {
            setStoryPlanningTab('Preferences'); setActiveActivity('story'); setView('story')
          }}>返回作品设定</button>}
          {center}
          {view === 'context' && technicalDetails}
        </>}
      />
      <WritingReferencePanel open={chapterMaterialsOpen && view === 'chapter'} onClose={() => setChapterMaterialsOpen(false)} title='本次生成材料'><ContextMaterialSummary key={`${project}:${selectedChapter}:actual-material-panel`} project={project} chapterId={selectedChapter} pack={(draft?.meta || {}).context_manifest?.context_pack} onOpen={(target) => { setChapterMaterialsOpen(false); void openMaterial(target) }} /></WritingReferencePanel>
      <WritingReferencePanel open={chapterReferencesOpen && view === 'chapter'} onClose={() => setChapterReferencesOpen(false)} title='本章写法参考'>
        <p className='mb-4 text-xs leading-6 text-muted'>为“{chapterTitleDraft || '当前章节'}”选择需要的写法。选择和查阅不调用模型，保存后供本章写作使用。</p>
        <WritingReferencePicker project={project} value={selectedChapterReferenceIds} onChange={updateChapterReferences} onOpen={openMaterial} saveHint={pendingChapterReferences ? '参考有未保存的选择。关闭侧栏仍会保留，点击下方保存后生效。' : '已保存的参考用于本章生成与修改。'} />
        <Button className='mt-5' variant='primary' disabled={chapterSaving} onClick={saveChapterDraft}>{chapterSaving ? '保存中…' : '保存本章参考'}</Button>
        <p className='mt-2 text-xs leading-6 text-muted'>沿用本章保存，同时保存当前正文；不会调用模型或改写文字。</p>
      </WritingReferencePanel>
      {writeConfirmOverlay}
    </>
  )
}
