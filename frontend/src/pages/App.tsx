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
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'characters', label: 'Characters', icon: UserRound },
  { id: 'style', label: 'Style', icon: Brush },
  { id: 'chapter', label: 'Chapter', icon: FilePenLine },
  { id: 'context', label: 'Context', icon: Waypoints },
  { id: 'canon', label: 'Canon', icon: Sparkles },
  { id: 'world', label: 'World', icon: Globe },
  { id: 'techniques', label: 'Techniques', icon: Sparkles },
  { id: 'wiki', label: 'Wiki', icon: BookOpen },
  { id: 'sessions', label: 'Sessions', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const ACTIVITY_ITEMS = [
  { id: 'explorer', label: 'Explorer', icon: FolderKanban },
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'cards', label: 'Cards', icon: UserRound },
  { id: 'techniques', label: 'Techniques', icon: Sparkles },
  { id: 'canon', label: 'Canon', icon: Waypoints },
  { id: 'settings', label: 'Settings', icon: Settings },
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
  { id: 'confirm', label: '确认写入', draftKind: '', checks: ['局部接受', '保存故事卡', '拒绝草案'] },
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
  const [selectedChapter, setSelectedChapter] = useState('chapter_001')
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
  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<any>(null)
  const [factRevisionModal, setFactRevisionModal] = useState<{ open: boolean; fact: any | null; patch: string; reason: string }>({ open: false, fact: null, patch: '{}', reason: '' })
  const [sessionMessageId, setSessionMessageId] = useState('writer_msg_001')
  const [sessionMessageText, setSessionMessageText] = useState('')
  const [worldQuery, setWorldQuery] = useState('临港城 封锁')
  const [worldRows, setWorldRows] = useState<any[]>([])
  const [wikiHtml, setWikiHtml] = useState('<html><head><title>示例</title></head><body><table class="infobox"><tr><th>阵营</th><td>黑潮同盟</td></tr></table><h2>设定</h2><p>临港城由七港区组成。</p></body></html>')
  const [techniqueQuery, setTechniqueQuery] = useState('')
  const [techniqueLibraryTab, setTechniqueLibraryTab] = useState('Narrative Techniques')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [mru, setMru] = useState<{ id: string; title: string; group: string; subtitle?: string }[]>([])
  const [buildDraft, setBuildDraft] = useState<{ draft_id?: string; kind: string; title: string; body: string; revision: number; source?: string; status?: string; created_at?: string; accepted_scope?: string[]; accepted_target?: string; rejection_reason?: string } | null>(null)
  const [buildDraftBusy, setBuildDraftBusy] = useState(false)
  const [buildWizardStep, setBuildWizardStep] = useState('basics')
  const [buildDraftHistoryFilter, setBuildDraftHistoryFilter] = useState('all')

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
  const { data: memoryPacks, mutate: mutateMemoryPacks } = useSWR(project ? `/api/projects/${project}/memory_packs?chapter_id=${selectedChapter}` : null, api.get)
  const { data: evidenceMarks, mutate: mutateEvidenceMarks } = useSWR(project ? `/api/projects/${project}/chapters/${selectedChapter}/evidence-marks` : null, api.get)
  const { data: trustReport, mutate: mutateTrustReport } = useSWR(project ? `/api/projects/${project}/trust-report?chapter_id=${selectedChapter}` : null, api.get)
  const { data: buildDraftRows, mutate: mutateBuildDraftRows } = useSWR(project ? `/api/projects/${project}/build-drafts` : null, api.get)
  const { data: jobRows, mutate: mutateJobs } = useSWR(project ? `/api/projects/${project}/jobs` : null, api.get)
  const { data: chapterReviewRows, mutate: mutateChapterReviews } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/reviews` : null, api.get)
  const { data: patchReviewRows, mutate: mutatePatchReviews } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/patch-reviews` : null, api.get)

  const [storyForm, setStoryForm] = useState<any>(normalizeStoryCard(null))
  const [characterForm, setCharacterForm] = useState<any>({ id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })
  const [techniqueForm, setTechniqueForm] = useState<any>(null)
  const [categoryForm, setCategoryForm] = useState<any>(null)
  const [toolSkillForm, setToolSkillForm] = useState<any>(null)
  const [profilesEditor, setProfilesEditor] = useState('')
  const [assignmentsEditor, setAssignmentsEditor] = useState('')
  const [presetProfileId, setPresetProfileId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('openai_compat:deepseek')
  const [selectedMemoryPackId, setSelectedMemoryPackId] = useState('')
  const [storyPlanningTab, setStoryPlanningTab] = useState('Overview')
  const [chapterEditorText, setChapterEditorText] = useState('')
  const [chapterTitleDraft, setChapterTitleDraft] = useState('')
  const [chapterSaving, setChapterSaving] = useState(false)
  const [selectedMarkId, setSelectedMarkId] = useState('')
  const currentManifest = events.filter((e) => e.event === 'CONTEXT_MANIFEST').slice(-1)[0]?.data
  const latestPatch = events.filter((e) => e.event === 'EDITOR_PATCH').slice(-1)[0]?.data

  const profiles = projectInfo?.llm_profiles || {}
  const providerPresets = ((providersMeta?.providers || []) as ProviderMeta[])
  const selectedPreset = providerPresets.find((x) => x.provider_id === selectedPresetId)
  const { data: selectedMemoryPack } = useSWR(
    project && selectedMemoryPackId ? `/api/projects/${project}/memory_packs/${encodeURIComponent(selectedMemoryPackId)}` : null,
    api.get,
  )
  const volumeRows = Array.isArray(volumes) ? volumes : []
  const chapterRows = Array.isArray(draftDetails) ? draftDetails : []
  const currentChapterMeta = (draft?.meta || chapterRows.find((x: any) => x.chapter_id === selectedChapter) || {}) as any
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
  const chapterReviewList = Array.isArray(chapterReviewRows) ? chapterReviewRows : []
  const pendingChapterReviews = chapterReviewList.filter((x: any) => x.status === 'pending_author_review')
  const patchReviewList = Array.isArray(patchReviewRows) ? patchReviewRows : []
  const pendingPatchReviews = patchReviewList.filter((x: any) => x.status === 'pending_author_review')
  const activePatchReview = pendingPatchReviews[0] || patchReviewList[0]
  const reviewPatch = latestPatch?.ops?.length ? latestPatch : activePatchReview ? { ...activePatchReview, patch_review_id: activePatchReview.review_id } : null
  const pendingBuildDrafts = buildDraftList.filter((x: any) => (x.status || 'pending') === 'pending')
  const processedBuildDrafts = buildDraftList.filter((x: any) => (x.status || 'pending') !== 'pending')
  const buildDraftHistoryRows = buildDraftHistoryFilter === 'all' ? processedBuildDrafts : processedBuildDrafts.filter((x: any) => x.status === buildDraftHistoryFilter)
  const buildDraftHistoryCounts = {
    all: processedBuildDrafts.length,
    accepted: processedBuildDrafts.filter((x: any) => x.status === 'accepted').length,
    partially_accepted: processedBuildDrafts.filter((x: any) => x.status === 'partially_accepted').length,
    rejected: processedBuildDrafts.filter((x: any) => x.status === 'rejected').length,
  }
  const acceptedScopeLabels = (rec: any) => (Array.isArray(rec?.accepted_scope) ? rec.accepted_scope.filter((x: any) => typeof x === 'string' && x.trim()) : [])
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

  useEffect(() => {
    setProfilesEditor(JSON.stringify(globalProfiles?.profiles || {}, null, 2))
  }, [globalProfiles])

  useEffect(() => {
    setAssignmentsEditor(JSON.stringify(globalAssignments?.assignments || {}, null, 2))
  }, [globalAssignments])

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
        setTechniqueLibraryTab('AI Tool Skills')
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
    if (!selectedChapter) return { ok: false, message: '请先在 ChapterEditor 打开章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques : []
    const row: any = { technique_id: tech.id, intensity: intensity || 'med' }
    if (weight !== undefined) row.weight = weight
    if (notes) row.notes = notes
    const next = [row, ...pinned.filter((x: any) => x.technique_id !== tech.id)]
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_techniques: next })
    mutateDraft()
    return { ok: true, message: `Pinned "${tech.title || tech.id}" (${row.intensity})` }
  }

  const unpinTechniqueFromChapter = async (tech: any) => {
    if (!selectedChapter) return { ok: false, message: '请先在 ChapterEditor 打开章节' }
    const meta = await api.get(`/api/projects/${project}/drafts/${selectedChapter}/meta`)
    const pinned = Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques : []
    const next = pinned.filter((x: any) => x.technique_id !== tech.id)
    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, { ...meta, pinned_techniques: next })
    mutateDraft()
    return { ok: true, message: `Unpinned "${tech.title || tech.id}"` }
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
    if (!selectedChapter) return { ok: false, message: '请先在 ChapterEditor 打开章节' }
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
    if (!selectedChapter) return { ok: false, message: '请先在 ChapterEditor 打开章节' }
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
              push('请先在 ChapterEditor 打开章节', 'error')
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
              push('请先在 ChapterEditor 打开章节', 'error')
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
      const r = await fetch(`/api/projects/${project}/uploads`, { method: 'POST', body: fd }).then((x) => x.json())
      const assetId = r.asset_id || r?.items?.[0]?.asset_id
      if (assetId) setActiveStyleAssets((x) => [...x, assetId])
      push('Style sample uploaded')
    } catch {
      push('Style sample upload failed', 'error')
    }
  }

  const analyzeStyle = async () => {
    try {
      await api.post(`/api/projects/${project}/style/analyze`, { style_card_id: 'style_001', asset_ids: activeStyleAssets, mode: 'fast' })
      mutateStyles()
      push('Style analysis completed')
    } catch {
      push('Style analysis failed', 'error')
    }
  }

  const runJob = async (maxTokens = 2400, range: { start: number; end: number } | null = null) => {
    try {
      setSelectedOpIds([])
      setEvents([])
      const j = await api.post(`/api/projects/${project}/jobs/write`, {
        chapter_id: selectedChapter,
        blueprint_id: 'blueprint_001',
        scene_index: 0,
        agent_mode: 'three_agent',
        agents: ['reviewer', 'writer', 'proofreader'],
        llm_profile_id: llmProfileId,
        auto_apply_patch: Boolean(autoApplyPatch),
        word_checkpoint_chars: 1500,
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
          push('Job finished')
        }
      }
    } catch {
      push('Run job failed', 'error')
    }
  }

  const analyzeChapter = async () => {
    try {
      setAnalyzeBusy(true)
      setAnalyzeResult(null)
      const res = await api.post(`/api/projects/${project}/analyze/${selectedChapter}`, { reason: 'ui_button' })
      setAnalyzeResult(res)
      mutateProposals()
      push(`Analyze done: +${res.new_facts_count || 0} facts, +${res.new_proposals_count || 0} proposals`)
    } catch {
      push('Analyze failed', 'error')
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
      push(`Marks analyzed: ${res?.marks?.length || 0}`)
    } catch {
      push('Analyze marks failed', 'error')
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
      push('Chapter saved')
    } catch {
      push('Chapter save failed', 'error')
    } finally {
      setChapterSaving(false)
    }
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

  const reviseCanonFact = async () => {
    if (!factRevisionModal.fact?.id) return
    try {
      const patch = JSON.parse(factRevisionModal.patch || '{}')
      await api.post(`/api/projects/${project}/canon/facts/${factRevisionModal.fact.id}/revise`, { patch, reason: factRevisionModal.reason })
      mutateCanonFacts()
      push('Fact revision appended')
      setFactRevisionModal({ open: false, fact: null, patch: '{}', reason: '' })
    } catch {
      push('Revise fact failed (check patch/reason)', 'error')
    }
  }

  const rollbackVersion = async (versionId: string) => {
    try {
      await api.post(`/api/projects/${project}/drafts/${selectedChapter}/rollback`, { version_id: versionId })
      await mutateDraft()
      await mutateVersions()
      await mutateDraftDetails()
      push(`Rolled back to ${versionId}`)
    } catch {
      push('Rollback failed', 'error')
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
      { id: 'nav-story', title: 'Go to Story', subtitle: 'Open story control card', group: 'Navigate', icon: BookOpen, run: () => { setActiveActivity('story'); setView('story') } },
      { id: 'nav-characters', title: 'Go to Characters', subtitle: 'Open characters panel', group: 'Navigate', icon: UserRound, run: () => { setActiveActivity('cards'); setView('characters') } },
      { id: 'nav-settings', title: 'Settings', subtitle: 'Open settings panel', group: 'Navigate', icon: Settings, run: () => { setActiveActivity('settings'); setView('settings') } },
      { id: 'nav-chapter', title: 'Go to Chapter Editor', group: 'Navigate', icon: FilePenLine, run: () => { setActiveActivity('explorer'); setView('chapter') } },
      { id: 'nav-canon', title: 'Go to Canon / Proposals', group: 'Navigate', icon: Sparkles, run: () => { setActiveActivity('canon'); setView('canon') } },
      { id: 'nav-world', title: 'Go to World panel', group: 'Navigate', icon: Globe, run: () => { setActiveActivity('cards'); setView('world') } },
      { id: 'nav-techniques', title: 'Go to Techniques', group: 'Navigate', icon: Sparkles, run: () => { setActiveActivity('techniques'); setView('techniques') } },
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
      ...(cache.toolSkills || []).map((t: any) => ({
        id: `tool-skill-${t.id}`,
        title: `Open Tool Skill: ${t.title || t.id}`,
        subtitle: t.payload?.category || t.id,
        group: 'Navigate' as const,
        icon: Sparkles,
        keywords: [t.id || '', t.title || '', t.payload?.name || '', t.payload?.category || '', 'tool', 'skill', 'checker', 'research'],
        payload: { kind: 'tool_skill', id: t.id },
        run: () => {
          setView('techniques')
          setTechniqueLibraryTab('AI Tool Skills')
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

    const mruItems: CommandItem[] = mru.map((x) => ({ id: `mru-${x.id}`, title: `[Recent] ${x.title}`, subtitle: x.subtitle, group: 'Navigate', icon: BookOpen, run: () => {} }))

    const all = [...staticNav, ...navData, ...actionItems, ...baseHelpCommands(() => {})]
    const resolvedMRU = mruItems.map((m) => {
      const target = all.find((x) => x.id === m.id.replace('mru-', ''))
      return target ? { ...target, title: `[Recent] ${target.title}` } : null
    }).filter(Boolean) as CommandItem[]

    return [...resolvedMRU, ...all]
  }, [mru, project, settings, autoApplyPatch, selectedChapter, chapterEditorText, chapterTitleDraft, currentChapterMeta, currentVolume, volumeRows, chapterRows, analyzeBusy])

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
                if (item.id === 'settings') setView('settings')
              }}
              className={`focus-ring flex h-9 w-9 items-center justify-center rounded-ui ${activeActivity === item.id ? 'bg-brand-500 text-white' : 'text-muted hover:bg-surface'}`}
            >
              <Icon size={17} />
            </button>
          )
        })}
      </div>
      <div className='flex-1 p-3'>
        <Input placeholder='Search resources...' value={sideSearch} onChange={(e) => setSideSearch(e.target.value)} />

        {activeActivity === 'explorer' ? (
          <div className='mt-3 space-y-3'>
            <div>
              <div className='mb-1 text-xs font-semibold uppercase text-muted'>Project</div>
              <Select value={project} onChange={(e) => setProject(e.target.value)}>
                {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.title || p.id}</option>)}
              </Select>
            </div>
            <div className='flex gap-2'>
              <Button className='text-xs' onClick={createVolume}>+ Volume</Button>
              <Button className='text-xs' onClick={() => createChapterInVolume(currentVolume?.id)}>+ Chapter</Button>
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
                          <div className='text-[11px] text-muted'>{ch.chapter_id} · {ch.chapter_status || 'draft'}</div>
                        </button>
                      ))}
                      <Button className='mt-1 w-full text-xs' onClick={() => createChapterInVolume(vol.id)}>+ Chapter in Volume</Button>
                    </div>
                  </details>
                )
              })}
              {!volumeRows.length && <p className='text-sm text-muted'>No volumes yet.</p>}
            </div>
          </div>
        ) : null}

        {activeActivity === 'story' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('story')}>Story Control</Button>
            {['Overview', 'Stages', 'Lines', 'Foreshadowings', 'Chapter Matrix'].map((tab) => (
              <button
                key={tab}
                onClick={() => { setStoryPlanningTab(tab); setView('story') }}
                className={`w-full rounded-ui border px-2 py-1.5 text-left text-xs ${storyPlanningTab === tab && view === 'story' ? 'border-brand-500 bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}
              >
                {tab}
              </button>
            ))}
            <div className='pt-2 text-xs text-muted'>
              明线 {(activeStoryPayload.open_line || []).length} · 暗线 {(activeStoryPayload.hidden_line || []).length} · 伏笔 {(activeStoryPayload.foreshadowings || []).length}
            </div>
          </div>
        ) : null}

        {activeActivity === 'cards' ? (
          <div className='mt-3 space-y-3'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('characters')}>Characters</Button>
            <div className='max-h-52 space-y-1 overflow-auto'>
              {(chars || []).map((c: any) => (
                <button key={c.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setCharacterForm(c); setView('characters') }}>
                  {c.title || c.id}
                </button>
              ))}
            </div>
            <Button className='w-full justify-start text-xs' onClick={() => setView('world')}>World</Button>
            <Button className='w-full justify-start text-xs' onClick={() => setView('style')}>Style</Button>
          </div>
        ) : null}

        {activeActivity === 'techniques' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => { setTechniqueLibraryTab('Narrative Techniques'); setView('techniques') }}>Narrative Techniques</Button>
            <Button className='w-full justify-start text-xs' onClick={() => { setTechniqueLibraryTab('AI Tool Skills'); setView('techniques') }}>AI Tool Skills</Button>
            {(techniqueCategories || []).slice(0, 12).map((cat: any) => (
              <button key={cat.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setCategoryForm(cat); setView('techniques') }}>
                {cat.title || cat.id}
              </button>
            ))}
          </div>
        ) : null}

        {activeActivity === 'canon' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('canon')}>Canon Facts</Button>
            <Button className='w-full justify-start text-xs' onClick={() => setView('context')}>Context Manifest</Button>
            {(proposals || []).slice(-8).reverse().map((p: any) => (
              <button key={p.proposal_id || p.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setSelectedProposalId(p.proposal_id || p.id || ''); setView('canon') }}>
                {p.name || p.proposal_id || p.id} <span className='text-muted'>({p.status || 'pending'})</span>
              </button>
            ))}
          </div>
        ) : null}

        {activeActivity === 'settings' ? (
          <div className='mt-3 space-y-2'>
            <Button className='w-full justify-start text-xs' onClick={() => setView('settings')}>Settings</Button>
            <Button className='w-full justify-start text-xs' onClick={() => refreshPaletteData()}>Refresh Palette Data</Button>
            <div className='rounded-ui border border-border bg-surface p-2 text-[11px] text-muted'>
              Command Palette keeps create/search flows: + volume, + chapter, + character, pin technique.
            </div>
          </div>
        ) : null}
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
      <span className='text-muted'>Project</span>
      <Badge>{project}</Badge>
      <span className='text-muted'>/</span>
      <span className='font-medium capitalize'>{activeActivity}</span>
      <span className='text-muted'>/</span>
      <span className='font-medium capitalize'>{view}</span>
      <span className='ml-4 text-xs text-muted'>provider:</span>
      <Badge>{llmProfileId}</Badge>
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
        push(`Technique not found: ${row.technique_id}`, 'error')
        return
      }
      const out = await pinTechniqueToChapter(tech, row.intensity || 'med', row.weight, row.notes)
      if (out.ok) push(`Converted auto recommendation to pinned micro: ${tech.title || tech.id}`)
      else push(out.message || 'Convert failed', 'error')
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
      push('Story card saved')
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
      if (buildDraft?.draft_id === rec.draft_id) {
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
          revision: nextRevision,
          selected_chapter: selectedChapter,
          story_card: normalizeStoryCard(storyForm),
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
        })
        push('后端草案接口不可用，已使用本地 fallback', 'error')
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
          payload.open_line = [...(payload.open_line || []), ...(parsed.open_line || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
          payload.hidden_line = [...(payload.hidden_line || []), ...(parsed.hidden_line || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
        } else if (buildDraft.kind === 'foreshadowing') {
          payload.foreshadowings = [...(payload.foreshadowings || []), ...(parsed.foreshadowings || []).map((row: any) => ({ ...row, source_draft_id: buildDraft.draft_id || '', source_step: buildDraft.kind, confirmation_status: 'accepted', confirmed_by: 'author', author_modified: true }))]
        }
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
    const renderStoryRows = (section: string, rows: any[], fields: Array<{ key: string; label: string; span?: string }>, template: any) => (
      <div className='space-y-2'>
        {rows.map((row: any, index: number) => (
          <div key={`${section}-${index}`} className='rounded-ui border border-border bg-surface p-3'>
            <div className='grid grid-cols-12 gap-2'>
              {fields.map((field) => (
                <div key={field.key} className={field.span || 'col-span-6'}>
                  <label className='text-xs text-muted'>{field.label}</label>
                  <Input
                    value={row?.[field.key] || ''}
                    onChange={(e) => updateStoryArrayItem(section, index, field.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
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
      return (
        <div className='space-y-3 density-space'>
          <Card
            title='写作工作台'
            extra={<Button variant='primary' onClick={() => { setView('chapter'); setActiveActivity('explorer') }}>打开当前章节</Button>}
          >
            <div className='grid grid-cols-1 gap-3 md:grid-cols-5'>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>生成状态</div>
                <div className='mt-1 text-lg font-semibold'>{runningEvent ? '生成中' : (latestJob?.status || (pendingPatchCount ? '待审稿' : '空闲'))}</div>
                <div className='text-xs text-muted'>{events.slice(-1)[0]?.event || latestJob?.last_event || 'no job event'}</div>
              </div>
              <div className='rounded-ui border border-border bg-surface p-3'>
                <div className='text-xs text-muted'>待审 Patch</div>
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
                <div className='text-xs text-muted'>unsupported / contradicted</div>
              </div>
            </div>
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
                <button key={p.id} onClick={() => setProject(p.id)} className={`w-full rounded-ui border px-3 py-2 text-left ${project === p.id ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  <div className='text-sm font-medium'>{p.id}</div>
                  <div className='text-xs text-muted'>{p.title}</div>
                </button>
              ))}
              <Button variant='primary' onClick={async () => { const r = await api.post('/api/projects', { title: '新项目' }); setProject(r.project_id); mutateProjects() }}>Create</Button>
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
            <Card title='待审 AI Patch'>
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
                  className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2'
                  onClick={() => {
                    if (job.chapter_id) setSelectedChapter(job.chapter_id)
                    setView('chapter')
                    setActiveActivity('explorer')
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

          <div className='grid grid-cols-2 gap-3'>
            <Card title='待确认 Canon'>
              <div className='space-y-1'>
                {(proposals || []).filter((p: any) => (p.status || 'pending') === 'pending').slice(-5).reverse().map((p: any) => (
                  <button key={p.proposal_id || p.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setSelectedProposalId(p.proposal_id || p.id || ''); setView('canon') }}>
                    {p.name || p.proposal_id || p.id}
                  </button>
                ))}
                {!(proposals || []).filter((p: any) => (p.status || 'pending') === 'pending').length && <p className='text-sm text-muted'>没有待确认 canon proposal。</p>}
              </div>
            </Card>
            <Card title='可信风险'>
              <div className='space-y-1'>
                {unsupportedMarks.slice(0, 5).map((mark: any) => (
                  <button key={mark.mark_id} className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2' onClick={() => { setSelectedMarkId(mark.mark_id); setView('chapter') }}>
                    {mark.target_type} · {mark.label || mark.target_id}
                  </button>
                ))}
                {!unsupportedMarks.length && <p className='text-sm text-muted'>当前章节没有未证实风险。</p>}
              </div>
            </Card>
          </div>
        </div>
      )
    }

    if (view === 'story') {
      return (
        <div className='space-y-3 density-space'>
          <Card
            title='小说建设向导 / 待确认草案'
            extra={<Badge>单环节生成 · 可刷新 · 可编辑 · 确认后写入</Badge>}
          >
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-5 space-y-2'>
                <div className='grid grid-cols-2 gap-2'>
                  {storyBuildProgress.map((step) => (
                    <button
                      key={step.id}
                      className={`rounded-ui border px-3 py-2 text-left ${buildWizardStep === step.id ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
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
              <div className='col-span-7'>
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
                  </div>
                ) : (
                  renderBuildDraftEditor()
                )}
              </div>
            </div>
          </Card>
          <Card
            title='故事卡 / Story Control'
            extra={
              <div className='flex gap-2'>
                <Button onClick={() => setStoryForm(normalizeStoryCard(null))}>新建故事卡</Button>
                <Button variant='primary' onClick={saveStoryCard}>保存故事卡</Button>
              </div>
            }
          >
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-3'>
                <label className='text-xs text-muted'>ID</label>
                <Input value={storyForm?.id || ''} onChange={(e) => updateStoryRoot('id', e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>标题</label>
                <Input value={storyForm?.title || ''} onChange={(e) => updateStoryRoot('title', e.target.value)} />
              </div>
              <div className='col-span-3'>
                <label className='text-xs text-muted'>类型/题材</label>
                <Input value={storyPayload.genre || ''} onChange={(e) => updateStoryPayload('genre', e.target.value)} />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>Tags</label>
                <Input value={(storyForm?.tags || []).join(',')} onChange={(e) => updateStoryRoot('tags', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>关键词</label>
                <Input value={(storyPayload.keywords || []).join(',')} onChange={(e) => updateStoryPayload('keywords', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>目标读者</label>
                <Input value={storyPayload.target_reader || ''} onChange={(e) => updateStoryPayload('target_reader', e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>平台风格</label>
                <Input value={storyPayload.platform_style || ''} onChange={(e) => updateStoryPayload('platform_style', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>一句话故事</label>
                <Textarea className='h-20' value={storyPayload.logline || ''} onChange={(e) => updateStoryPayload('logline', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>主题</label>
                <Textarea className='h-20' value={storyPayload.theme || ''} onChange={(e) => updateStoryPayload('theme', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>世界/背景</label>
                <Textarea className='h-24' value={storyPayload.worldview || ''} onChange={(e) => updateStoryPayload('worldview', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>总冲突</label>
                <Textarea className='h-24' value={storyPayload.main_conflict || ''} onChange={(e) => updateStoryPayload('main_conflict', e.target.value)} />
              </div>
              <div className='col-span-6'>
                <label className='text-xs text-muted'>禁写事项</label>
                <Textarea className='h-24' value={(storyPayload.banned_items || []).join('\n')} onChange={(e) => updateStoryPayload('banned_items', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
              </div>
              <div className='col-span-6 space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <label className='text-xs text-muted'>重要场景</label>
                  <Button className='text-xs' onClick={() => addStoryArrayItem('important_scenes', STORY_PAYLOAD_TEMPLATE.important_scenes[0])}>新增场景</Button>
                </div>
                {(storyPayload.important_scenes || []).map((row: any, index: number) => (
                  <div key={`story-scene-${index}`} className='rounded-ui border border-border bg-surface p-2'>
                    <div className='grid grid-cols-12 gap-2'>
                      <div className='col-span-4'>
                        <label className='text-xs text-muted'>场景</label>
                        <Input value={row.scene || ''} onChange={(e) => updateStoryArrayItem('important_scenes', index, 'scene', e.target.value)} />
                      </div>
                      <div className='col-span-5'>
                        <label className='text-xs text-muted'>作用</label>
                        <Input value={row.purpose || ''} onChange={(e) => updateStoryArrayItem('important_scenes', index, 'purpose', e.target.value)} />
                      </div>
                      <div className='col-span-3'>
                        <label className='text-xs text-muted'>章节</label>
                        <Input value={row.chapter || ''} onChange={(e) => updateStoryArrayItem('important_scenes', index, 'chapter', e.target.value)} />
                      </div>
                    </div>
                    <div className='mt-2 flex justify-end'>
                      <Button className='text-xs' onClick={() => removeStoryArrayItem('important_scenes', index)}>删除</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title='已有故事卡'>
            <div className='flex flex-wrap gap-2'>
              {(storyCards || []).map((card: any) => (
                <Button key={card.id} onClick={() => setStoryForm(normalizeStoryCard(card))}>{card.title || card.id}</Button>
              ))}
              {(!storyCards || storyCards.length === 0) && <p className='text-sm text-muted'>暂无故事卡，保存后会出现在这里。</p>}
            </div>
          </Card>

          <Tabs
            items={['Overview', 'Stages', 'Lines', 'Foreshadowings', 'Chapter Matrix']}
            active={storyPlanningTab}
            onChange={setStoryPlanningTab}
          />

          {(storyPlanningTab === 'Overview' || storyPlanningTab === 'Stages') && <Card title='阶段性目标 / 冲突 / 结果'>
            {renderStoryRows('stages', storyPayload.stages || [], [
              { key: 'stage', label: '阶段', span: 'col-span-2' },
              { key: 'goal', label: '阶段目标', span: 'col-span-3' },
              { key: 'conflict', label: '阶段冲突', span: 'col-span-3' },
              { key: 'result', label: '阶段结果', span: 'col-span-2' },
              { key: 'turning_point', label: '转折点', span: 'col-span-2' },
            ], STORY_PAYLOAD_TEMPLATE.stages[0])}
          </Card>}

          {(storyPlanningTab === 'Overview' || storyPlanningTab === 'Lines') && (
            <>
              <Card title='明线'>
                {renderStoryRows('open_line', storyPayload.open_line || [], [
                  { key: 'chapter', label: '章节', span: 'col-span-2' },
                  { key: 'event', label: '表面事件', span: 'col-span-3' },
                  { key: 'goal', label: '角色目标', span: 'col-span-3' },
                  { key: 'conflict', label: '阻碍/冲突', span: 'col-span-2' },
                  { key: 'result', label: '结果', span: 'col-span-2' },
                ], STORY_PAYLOAD_TEMPLATE.open_line[0])}
              </Card>

              <Card title='暗线'>
                {renderStoryRows('hidden_line', storyPayload.hidden_line || [], [
                  { key: 'chapter', label: '章节', span: 'col-span-2' },
                  { key: 'truth', label: '真实发生的事', span: 'col-span-3' },
                  { key: 'visible_hint', label: '可见提示', span: 'col-span-3' },
                  { key: 'hidden_meaning', label: '隐藏含义', span: 'col-span-2' },
                  { key: 'reveal_timing', label: '揭示时机', span: 'col-span-2' },
                ], STORY_PAYLOAD_TEMPLATE.hidden_line[0])}
              </Card>
            </>
          )}

          {(storyPlanningTab === 'Overview' || storyPlanningTab === 'Foreshadowings') && <Card title='伏笔追踪表'>
            {renderStoryRows('foreshadowings', storyPayload.foreshadowings || [], [
              { key: 'id', label: '伏笔ID', span: 'col-span-2' },
              { key: 'status', label: '状态', span: 'col-span-2' },
              { key: 'content', label: '伏笔内容', span: 'col-span-4' },
              { key: 'first_chapter', label: '首次出现', span: 'col-span-2' },
              { key: 'surface_signal', label: '显示方式', span: 'col-span-3' },
              { key: 'reader_feeling', label: '读者感受', span: 'col-span-3' },
              { key: 'true_meaning', label: '真实意义', span: 'col-span-4' },
              { key: 'payoff_chapter', label: '回收章节', span: 'col-span-2' },
              { key: 'payoff', label: '回收方式', span: 'col-span-4' },
              { key: 'emphasis', label: '强调方式', span: 'col-span-6' },
            ], STORY_PAYLOAD_TEMPLATE.foreshadowings[0])}
          </Card>}

          {(storyPlanningTab === 'Overview' || storyPlanningTab === 'Chapter Matrix') && <Card title='章节矩阵'>
            {renderStoryRows('chapter_plan', storyPayload.chapter_plan || [], [
              { key: 'chapter', label: '计划编号', span: 'col-span-2' },
              { key: 'chapter_id', label: '绑定章节', span: 'col-span-2' },
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
          </Card>}

          <Card title='JSON Preview'>
            <pre className='mono text-xs overflow-auto rounded-ui bg-surface-2 p-3'>{JSON.stringify(normalizeStoryCard(storyForm), null, 2)}</pre>
          </Card>
        </div>
      )
    }

    if (view === 'characters') {
      const payload = characterForm?.payload || {}
      return (
        <div className='space-y-3 density-space'>
          <Card title='Profile / Importance'>
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-3'>
                <label className='text-xs text-muted'>Role</label>
                <Select
                  value={payload.role || 'other'}
                  onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, role: e.target.value } })}
                >
                  <option value='protagonist'>protagonist</option>
                  <option value='supporting'>supporting</option>
                  <option value='antagonist'>antagonist</option>
                  <option value='other'>other</option>
                </Select>
              </div>
              <div className='col-span-3'>
                <label className='text-xs text-muted'>Character Importance (1-5)</label>
                <Input
                  type='number'
                  min={1}
                  max={5}
                  value={payload.importance ?? 3}
                  onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, importance: Number(e.target.value || 3) } })}
                />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>Age</label>
                <Input
                  type='number'
                  min={0}
                  max={200}
                  value={payload.age ?? ''}
                  onChange={(e) => setCharacterForm({ ...characterForm, payload: { ...payload, age: e.target.value === '' ? undefined : Number(e.target.value) } })}
                />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>Card Stars</label>
                <Input
                  type='number'
                  min={0}
                  max={5}
                  value={characterForm?.stars ?? ''}
                  onChange={(e) => setCharacterForm({ ...characterForm, stars: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>Card Importance</label>
                <Input
                  type='number'
                  min={1}
                  max={5}
                  value={characterForm?.importance ?? ''}
                  onChange={(e) => setCharacterForm({ ...characterForm, importance: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
            </div>
          </Card>
          <SchemaForm schema={charSchema} value={characterForm} onChange={setCharacterForm} />
          <Button
            variant='primary'
            onClick={async () => {
              const id = characterForm?.id || `character_${Date.now()}`
              const body = { ...characterForm, id, type: 'character' }
              await api.put(`/api/projects/${project}/cards/${id}`, body)
              setCharacterForm(body)
              mutateCards()
              push('Character saved')
            }}
          >
            保存角色
          </Button>
          <Card title='Character Cards'>
            <pre className='mono text-xs overflow-auto'>{JSON.stringify(chars, null, 2)}</pre>
          </Card>
        </div>
      )
    }

    if (view === 'style') {
      return (
        <div className='space-y-3 density-space'>
          <Card title='Style Studio'>
            <div className='space-y-2'>
              <Textarea className='h-28' value={styleUploadText} onChange={(e) => setStyleUploadText(e.target.value)} placeholder='粘贴文风样本文本 txt/md' />
              <div className='flex gap-2'>
                <Button onClick={uploadStyleSample}>上传样本</Button>
                <Button variant='primary' onClick={analyzeStyle}>分析文风</Button>
              </div>
              <div className='text-xs text-muted'>Active Assets: {activeStyleAssets.join(', ') || 'none'}</div>
            </div>
          </Card>
          <Tabs items={['Style Card', 'Schema']} active='Style Card' onChange={() => {}} />
          <Card title='Style data'>
            <pre className='mono text-xs overflow-auto'>{JSON.stringify(styles, null, 2)}</pre>
          </Card>
          <Card title='Style schema'>
            <pre className='mono text-xs overflow-auto'>{JSON.stringify(styleSchema, null, 2)}</pre>
          </Card>
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
      const marksByLine = evidenceMarkRows.reduce((acc: Record<string, any[]>, mark: any) => {
        const line = Number(mark?.span?.start_line || 0)
        const key = line > 0 ? String(line) : '未证实'
        acc[key] = [...(acc[key] || []), mark]
        return acc
      }, {})
      return (
        <div className='space-y-3 density-space'>
          <Card title='AI 草稿审阅' extra={<Badge tone={pendingChapterReviews.length ? 'warn' : 'success'}>{pendingChapterReviews.length ? '待确认' : '无待审'}</Badge>}>
            <div className='space-y-2'>
              {chapterReviewList.slice(0, 4).map((review: any) => (
                <div key={review.review_id} className='rounded-ui border border-border bg-surface p-2 text-xs'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <div className='font-medium'>{review.review_id}</div>
                      <div className='text-muted'>{review.source || 'writer_agent'} · {review.job_id || 'no job'} · {review.word_count || 0} 字</div>
                    </div>
                    <Badge tone={review.status === 'accepted' ? 'success' : review.status === 'pending_author_review' ? 'warn' : 'default'}>{review.status || 'unknown'}</Badge>
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
          </Card>

          <Card
            title='Chapter Manuscript'
            extra={
              <div className='flex flex-wrap gap-2'>
                <Button onClick={saveChapterDraft} disabled={chapterSaving}>{chapterSaving ? 'Saving...' : 'Save'}</Button>
                <Button onClick={async () => { await saveChapterDraft(); await analyzeChapter() }} disabled={chapterSaving || analyzeBusy}>{analyzeBusy ? 'Analyzing...' : 'Analyze & Save'}</Button>
                <Button onClick={analyzeMarks} disabled={chapterSaving}>Analyze Marks</Button>
                <Button variant='primary' onClick={() => runJob(2400)}>生成本章</Button>
              </div>
            }
          >
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>Chapter ID</label>
                <Input value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)} />
              </div>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>Title</label>
                <Input value={chapterTitleDraft} onChange={(e) => setChapterTitleDraft(e.target.value)} />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>Volume</label>
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
                <label className='text-xs text-muted'>Status</label>
                <Select
                  value={currentChapterMeta?.chapter_status || 'draft'}
                  onChange={async (e) => {
                    const meta = { ...(draft?.meta || currentChapterMeta || {}), chapter_status: e.target.value }
                    await api.put(`/api/projects/${project}/drafts/${selectedChapter}/meta`, meta)
                    mutateDraft()
                    mutateDraftDetails()
                  }}
                >
                  <option value='draft'>draft</option>
                  <option value='drafting'>drafting</option>
                  <option value='planned'>planned</option>
                  <option value='revising'>revising</option>
                  <option value='done'>done</option>
                </Select>
              </div>
              <div className='col-span-5'>
                <label className='text-xs text-muted'>Model profile</label>
                <Select value={llmProfileId} onChange={(e) => setLlmProfileId(e.target.value)}>
                  {Object.entries(profiles).map(([k, v]: any) => (
                    <option key={k} value={k}>{k} ({v.provider}/{v.model})</option>
                  ))}
                </Select>
              </div>
              <div className='col-span-3 flex items-end'>
                <label className='flex items-center gap-2 text-sm'>
                  <input type='checkbox' checked={autoApplyPatch} onChange={(e) => setAutoApplyPatch(e.target.checked)} />
                  auto apply
                </label>
              </div>
            </div>
            <div className='mt-3 grid grid-cols-12 gap-2'>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>Selection Mode</label>
                <Select value={selectionMode} onChange={(e) => setSelectionMode(e.target.value as any)}>
                  <option value='line'>By Line</option>
                  <option value='paragraph'>By Paragraph</option>
                </Select>
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>{selectionMode === 'line' ? 'Start Line' : 'Start Paragraph'}</label>
                <Input value={selectionStart} onChange={(e) => setSelectionStart(e.target.value)} placeholder='start' />
              </div>
              <div className='col-span-2'>
                <label className='text-xs text-muted'>{selectionMode === 'line' ? 'End Line' : 'End Paragraph'}</label>
                <Input value={selectionEnd} onChange={(e) => setSelectionEnd(e.target.value)} placeholder='end' />
              </div>
              <div className='col-span-6 flex items-end gap-2'>
                <Button onClick={() => runJob(160)}>超预算模拟</Button>
                {selectionRange ? <Button onClick={() => runJob(1200, selectionRange)}>Edit Selection</Button> : null}
              </div>
            </div>
            {selectionRange ? <p className='mt-2 text-xs text-muted'>Selection range: L{selectionRange.start}-L{selectionRange.end}</p> : <p className='mt-2 text-xs text-muted'>Set start/end to enable Edit Selection.</p>}
            {analyzeResult ? <p className='mt-1 text-xs text-muted'>Analyze result: +{analyzeResult.new_facts_count || 0} facts, +{analyzeResult.new_proposals_count || 0} proposals.</p> : null}
            {highlightRange ? (
              <div className='mt-3 rounded-ui border border-border bg-surface-2 p-2'>
                <div className='mb-1 text-xs font-medium'>Evidence: {selectedChapter} L{highlightRange.start}-L{highlightRange.end}</div>
                <pre className='editor-text mono max-h-40 overflow-auto whitespace-pre-wrap text-xs'>{highlighted || '暂无正文'}</pre>
              </div>
            ) : null}
            <div className='mt-3 grid grid-cols-12 gap-3'>
              <div className='col-span-3 rounded-ui border border-border bg-surface p-2'>
                <div className='mb-2 flex items-center justify-between'>
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
                              <div className='font-medium'>{mark.target_type} · {mark.label || mark.target_id}</div>
                              <div>{level}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {!evidenceMarkRows.length && <p className='text-xs text-muted'>运行生成或 Analyze Marks 后显示人物、技法、明线、暗线、伏笔命中。</p>}
                </div>
              </div>
              <Textarea
                className='editor-text col-span-9 min-h-[560px] resize-y whitespace-pre-wrap font-serif leading-7'
                value={chapterEditorText}
                onChange={(e) => setChapterEditorText(e.target.value)}
                placeholder='开始写这一章...'
              />
            </div>
          </Card>

          <Card title='Chapter Techniques'>
            <div className='space-y-2'>
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
              <div className='rounded-ui border border-border bg-surface-2 p-2'>
                <div className='text-xs font-medium mb-1'>Inherited from outline (read-only)</div>
                <pre className='mono text-[11px] whitespace-pre-wrap'>{JSON.stringify(inheritedTechniqueDefaults, null, 2)}</pre>
              </div>
              <div className='rounded-ui border border-border bg-surface-2 p-2'>
                <div className='text-xs font-medium mb-1'>Auto-recommended micro from pinned categories (read-only)</div>
                <div className='space-y-1'>
                  {autoRecommendedTechniques.length ? autoRecommendedTechniques.map((row: any) => (
                    <div key={`${row.technique_id}:${row.source}`} className='flex items-center justify-between gap-2 rounded-ui border border-border bg-surface px-2 py-1'>
                      <span className='text-xs'>{row.technique_id} <span className='text-muted'>({row.intensity || 'med'}, {row.source})</span></span>
                      <Button className='text-xs' onClick={() => toPinnedFromAuto(row)}>转为 pinned micro</Button>
                    </div>
                  )) : <p className='text-xs text-muted'>暂无自动推荐（先 pin category 并运行生成）。</p>}
                </div>
              </div>
            </div>
          </Card>

        </div>
      )
    }

    if (view === 'canon') {
      return (
        <div className='space-y-3 density-space'>
          <Card title='Canon Facts (Revisions)'>
            <div className='space-y-2'>
              {(canonFacts || []).slice(-20).reverse().map((f: any, i: number) => (
                <div key={`${f.id || 'fact'}:${i}`} className='rounded-ui border border-border bg-surface p-2'>
                  <div className='flex items-center gap-2 text-sm'>
                    <Badge>{f.scope || 'fact'}</Badge>
                    <span className='font-medium'>{f.id || `fact_${i}`}</span>
                    {f._revised ? <span className='text-xs text-muted'>(revised x{(f._revisions || []).length})</span> : null}
                  </div>
                  <div className='mt-1 text-xs text-muted'>
                    <div>Original: {String((f._original || f).value || '')}</div>
                    <div>Revised: {String(f.value || '')}</div>
                  </div>
                  <div className='mt-2'>
                    <Button className='text-xs' onClick={() => setFactRevisionModal({ open: true, fact: f, patch: JSON.stringify({ value: f.value || '' }, null, 2), reason: '' })}>编辑/修订</Button>
                  </div>
                </div>
              ))}
              {(!canonFacts || canonFacts.length === 0) && <p className='text-sm text-muted'>No facts yet.</p>}
            </div>
          </Card>

          <Card title='Canon / Proposals'>
            <div className='space-y-2'>
              {(proposals || []).slice(-20).reverse().map((p: any, i: number) => (
                <div key={i} className={`rounded-ui border bg-surface p-2 ${selectedProposalId && selectedProposalId === (p.proposal_id || p.id) ? 'border-brand-500' : 'border-border'}`}>
                  <div className='flex items-center gap-2 text-sm'>
                    <Badge>{p.entity_type || p.event || 'proposal'}</Badge>
                    <span>{p.name || p.proposal_id}</span>
                    <span className='text-xs text-muted'>({p.status || 'pending'})</span>
                  </div>
                  <div className='mt-2 flex gap-2'>
                    <Button className='text-xs' onClick={async () => { await api.post(`/api/projects/${project}/canon/proposals/${p.proposal_id}/accept`, {}); mutateProposals(); push('Proposal accepted') }}>Accept</Button>
                    <Button className='text-xs' onClick={async () => { await api.post(`/api/projects/${project}/canon/proposals/${p.proposal_id}/reject`, {}); mutateProposals(); push('Proposal rejected') }}>Reject</Button>
                  </div>
                </div>
              ))}
              {(!proposals || proposals.length === 0) && <p className='text-sm text-muted'>No proposals yet.</p>}
            </div>
          </Card>

          {factRevisionModal.open ? (
            <Card title='Revise Fact (Append-only)'>
              <div className='space-y-2'>
                <div className='text-xs text-muted'>fact_id: {factRevisionModal.fact?.id}</div>
                <Textarea className='h-28 mono' value={factRevisionModal.patch} onChange={(e) => setFactRevisionModal((x) => ({ ...x, patch: e.target.value }))} />
                <Input value={factRevisionModal.reason} onChange={(e) => setFactRevisionModal((x) => ({ ...x, reason: e.target.value }))} placeholder='reason (required)' />
                <div className='flex gap-2'>
                  <Button variant='primary' onClick={reviseCanonFact}>Save Revision</Button>
                  <Button onClick={() => setFactRevisionModal({ open: false, fact: null, patch: '{}', reason: '' })}>Cancel</Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      )
    }

    if (view === 'world') {
      return (
        <Card title='World Lore / World State'>
          <div className='flex gap-2'>
            <Input value={worldQuery} onChange={(e) => setWorldQuery(e.target.value)} />
            <Button variant='primary' onClick={async () => { const r = await api.post(`/api/projects/${project}/world/query`, { query: worldQuery, top_k: 10, include_global: false }); setWorldRows(r) }}>Search</Button>
          </div>
          <pre className='mono mt-3 text-xs rounded-ui bg-surface-2 p-3 overflow-auto'>{JSON.stringify(worldRows, null, 2)}</pre>
        </Card>
      )
    }


    if (view === 'techniques') {
      const cats = Array.isArray(techniqueCategories) ? techniqueCategories : []
      const rows = (Array.isArray(techniqueCards) ? techniqueCards : []).filter((t: any) => {
        const q = techniqueQuery.trim().toLowerCase()
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
            items={['Narrative Techniques', 'AI Tool Skills']}
            active={techniqueLibraryTab}
            onChange={setTechniqueLibraryTab}
          />
          {techniqueLibraryTab === 'Narrative Techniques' ? (
            <>
              <Card title='Technique Categories (Tree)'>
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
              <Card title='Narrative Technique Library'>
                <div className='flex gap-2 mb-2'>
                  <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder='Search technique/category keywords...' />
                  <Button onClick={async () => { mutateTechniqueCards(); mutateTechniqueCategories(); push('Technique list refreshed') }}>Refresh</Button>
                </div>
                <div className='max-h-72 overflow-auto space-y-1'>
                  {rows.map((r: any) => (
                    <button key={r.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1 text-left text-xs hover:bg-surface-2' onClick={() => setTechniqueForm(r)}>
                      {r.title} <span className='text-muted'>({r.id})</span>
                      <span className='ml-2 text-muted'>{(r.payload?.signals || []).slice(0, 2).join(' / ')}</span>
                    </button>
                  ))}
                </div>
              </Card>
              {techniqueForm && (
                <div className='space-y-2'>
                  <SchemaForm schema={techniqueSchema} value={techniqueForm} onChange={setTechniqueForm} />
                  <Button variant='primary' onClick={async () => { await api.put(`/api/projects/${project}/cards/${techniqueForm.id}`, techniqueForm); mutateTechniqueCards(); push('Technique saved') }}>Save Technique</Button>
                </div>
              )}
              {categoryForm && (
                <div className='space-y-2'>
                  <SchemaForm schema={techniqueCategorySchema} value={categoryForm} onChange={setCategoryForm} />
                  <Button variant='primary' onClick={async () => { await api.put(`/api/projects/${project}/cards/${categoryForm.id}`, categoryForm); mutateTechniqueCategories(); push('Category saved') }}>Save Category</Button>
                </div>
              )}
            </>
          ) : (
            <>
              <Card title='AI Tool Skills'>
                <div className='flex gap-2 mb-2'>
                  <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder='Search problem checker, bio generator, outline research...' />
                  <Button onClick={async () => { mutateToolSkillCards(); push('Tool skill list refreshed') }}>Refresh</Button>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  {toolRows.map((r: any) => (
                    <button key={r.id} className='rounded-ui border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-surface-2' onClick={() => setToolSkillForm(r)}>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-sm font-medium'>{r.title || r.id}</span>
                        <Badge>{r.payload?.category || 'tool'}</Badge>
                      </div>
                      <div className='mt-1 text-muted'>{r.payload?.description || r.id}</div>
                      <div className='mt-1 text-muted'>auto apply: {r.payload?.auto_apply_allowed ? 'allowed' : 'off'} · evidence: {r.payload?.evidence_required ? 'required' : 'optional'}</div>
                    </button>
                  ))}
                  {!toolRows.length && <p className='text-sm text-muted'>暂无工具 skill，可用 Command Palette 创建：+ tool_skill 小说问题检查 --category checker</p>}
                </div>
              </Card>
              {toolSkillForm && (
                <div className='space-y-2'>
                  <SchemaForm schema={toolSkillSchema} value={toolSkillForm} onChange={setToolSkillForm} />
                  <Button variant='primary' onClick={async () => { await api.put(`/api/projects/${project}/cards/${toolSkillForm.id}`, toolSkillForm); mutateToolSkillCards(); push('Tool skill saved') }}>Save Tool Skill</Button>
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
      return (
        <div className='space-y-3 density-space'>
          <Card title='Settings'>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <label className='text-xs text-muted'>Theme</label>
                <Select value={settings.theme} onChange={(e) => applySettings({ ...settings, theme: e.target.value as any })}>
                  <option value='system'>System</option>
                  <option value='light'>Light</option>
                  <option value='dark'>Dark</option>
                </Select>
              </div>
              <div>
                <label className='text-xs text-muted'>Density</label>
                <Select value={settings.density} onChange={(e) => applySettings({ ...settings, density: e.target.value as any })}>
                  <option value='comfortable'>Comfortable</option>
                  <option value='compact'>Compact</option>
                </Select>
              </div>
              <div>
                <label className='text-xs text-muted'>Editor Font Size</label>
                <Select value={settings.editorSize} onChange={(e) => applySettings({ ...settings, editorSize: e.target.value as any })}>
                  <option value='small'>Small</option>
                  <option value='medium'>Medium</option>
                  <option value='large'>Large</option>
                </Select>
              </div>
              <div>
                <label className='text-xs text-muted'>Default LLM profile</label>
                <Select value={settings.defaultLlmProfileId} onChange={(e) => { const val = e.target.value; applySettings({ ...settings, defaultLlmProfileId: val }); setLlmProfileId(val) }}>
                  {Object.keys(profiles).map((k) => <option key={k} value={k}>{k}</option>)}
                </Select>
              </div>
            </div>
            <div className='mt-3 space-y-2'>
              <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={settings.defaultAutoApplyPatch} onChange={(e) => { const v = e.target.checked; applySettings({ ...settings, defaultAutoApplyPatch: v }); setAutoApplyPatch(v) }} /> Default auto apply patch</label>
              <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={settings.evidenceWrap} onChange={(e) => applySettings({ ...settings, evidenceWrap: e.target.checked })} /> Evidence viewer soft wrap</label>
            </div>
          </Card>

          <Card title='LLM Profiles (Global)'>
            <p className='text-xs text-muted mb-2'>Edit global profiles at `data/_global/llm_profiles.json` via config API.</p>
            <div className='mb-3 rounded-ui border border-border bg-surface-2 p-3'>
              <div className='grid grid-cols-3 gap-2'>
                <div>
                  <label className='text-xs text-muted'>Preset</label>
                  <Select value={selectedPresetId} onChange={(e) => setSelectedPresetId(e.target.value)}>
                    {providerPresets.map((p) => <option key={p.provider_id} value={p.provider_id}>{p.display_name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className='text-xs text-muted'>Profile ID</label>
                  <Input value={presetProfileId} onChange={(e) => setPresetProfileId(e.target.value)} placeholder='e.g. deepseek_writer' />
                </div>
                <div className='flex items-end'>
                  <Button onClick={applyPresetToEditor}>Apply Preset</Button>
                </div>
              </div>
              <div className='mt-2 text-xs text-muted'>
                <div><b>Required:</b> {selectedPreset?.required_fields?.join(', ') || '-'}</div>
                <div><b>Optional:</b> {selectedPreset?.optional_fields?.join(', ') || '-'}</div>
                <div><b>Stream:</b> {selectedPreset?.supports_stream ? 'supported' : 'not supported'}</div>
              </div>
            </div>
            <Textarea className='h-48 mono' value={profilesEditor} onChange={(e) => setProfilesEditor(e.target.value)} />
            <div className='mt-2 flex gap-2'>
              <Button variant='primary' onClick={async () => {
                try {
                  await api.post('/api/config/llm/profiles', { mode: 'replace', profiles: JSON.parse(profilesEditor || '{}') })
                  mutateGlobalProfiles()
                  push('Global LLM profiles saved')
                } catch {
                  push('Invalid profiles JSON', 'error')
                }
              }}>Save Profiles</Button>
              <Button onClick={() => setProfilesEditor(JSON.stringify(globalProfiles?.profiles || {}, null, 2))}>Reset</Button>
            </div>
          </Card>

          <Card title='LLM Assignments (Global)'>
            <p className='text-xs text-muted mb-2'>Module {'->'} profile_id mapping. Priority: request.llm_profile_id {'>'} assignment[module] {'>'} project default.</p>
            <Textarea className='h-40 mono' value={assignmentsEditor} onChange={(e) => setAssignmentsEditor(e.target.value)} />
            <div className='mt-2 flex gap-2'>
              <Button variant='primary' onClick={async () => {
                try {
                  await api.post('/api/config/llm/assignments', { mode: 'replace', assignments: JSON.parse(assignmentsEditor || '{}') })
                  mutateGlobalAssignments()
                  push('Global assignments saved')
                } catch {
                  push('Invalid assignments JSON', 'error')
                }
              }}>Save Assignments</Button>
              <Button onClick={() => setAssignmentsEditor(JSON.stringify(globalAssignments?.assignments || {}, null, 2))}>Reset</Button>
            </div>
            <pre className='mono text-xs overflow-auto rounded-ui bg-surface-2 p-3 mt-2'>{JSON.stringify(providersMeta?.providers || [], null, 2)}</pre>
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
    profiles,
    selectedChapter,
    currentChapterMeta,
    currentVolume,
    volumeRows,
    chapterRows,
    chapterEditorText,
    chapterTitleDraft,
    chapterSaving,
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
    selectedProposalId,
    selectedBlueprintId,
    techniqueCards,
    techniqueCategories,
    techniqueQuery,
    techniqueLibraryTab,
    toolSkillCards,
    toolSkillSchema,
    toolSkillForm,
    buildDraft,
    buildDraftBusy,
    buildWizardStep,
    activeBuildWizardStep,
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
    { name: '审查 Agent', event: 'PRE_REVIEW_PLAN', data: latestEvent('PRE_REVIEW_PLAN'), desc: '人设 / 明线 / 暗线 / 伏笔 / 技法' },
    { name: '撰写 Agent', event: 'WRITER_DRAFT', data: latestEvent('WRITER_DRAFT'), desc: '正文生成 / 模型 / fallback / 字数进度' },
    { name: '校对 Agent', event: 'PROOFREAD_PATCH', data: latestEvent('PROOFREAD_PATCH'), desc: '错字 / 标点 / 病句 / 基础 patch' },
  ]
  const markTone = (level?: string) => {
    if (level === 'supported') return 'success'
    if (level === 'partial') return 'warn'
    return 'default'
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
      <Card
        title='Runtime'
        extra={<Badge tone={providerInfo?.fallback ? 'warn' : 'success'}>{providerInfo?.provider || '-'} / {providerInfo?.model || '-'}</Badge>}
      >
        <div className='text-xs text-muted'>fallback: {providerInfo?.fallback ? 'yes' : 'no'}</div>
      </Card>

      <Card title='Three Agent Progress'>
        <div className='space-y-2'>
          {agentSteps.map((step) => {
            const done = Boolean(step.data)
            return (
              <div key={step.event} className={`rounded-ui border px-2 py-2 ${done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface'}`}>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-sm font-medium'>{step.name}</span>
                  <Badge tone={done ? 'success' : 'default'}>{done ? 'done' : 'waiting'}</Badge>
                </div>
                <div className='mt-1 text-xs text-muted'>{step.desc}</div>
                <div className='mt-1 text-xs'>{step.data?.output_summary || '等待本次 job 事件'}</div>
                {step.data?.provider ? <div className='mt-1 text-[11px] text-muted'>{step.data.provider}/{step.data.model || '-'} {step.data.fallback ? '(fallback)' : ''}</div> : null}
              </div>
            )
          })}
        </div>
      </Card>

      <Card title='Trust Report' extra={<Badge tone={(trustReport?.unsupported_count || 0) ? 'warn' : 'success'}>{trustReport?.support_rate ?? '-'}</Badge>}>
        <div className='grid grid-cols-4 gap-1 text-center text-xs'>
          {['supported', 'partial', 'unsupported', 'contradicted'].map((level) => (
            <div key={level} className='rounded-ui border border-border bg-surface p-1'>
              <div className='font-medium'>{trustReport?.support_counts?.[level] || 0}</div>
              <div className='text-[10px] text-muted'>{level}</div>
            </div>
          ))}
        </div>
        <Button className='mt-2 w-full text-xs' onClick={analyzeMarks}>重新分析证据标记</Button>
      </Card>

      <Card title='Current Context' extra={<Badge>{selectedChapter}</Badge>}>
        <div className='space-y-2 text-xs'>
          <div className='rounded-ui border border-border bg-surface-2 p-2'>
            <div className='font-medium'>{currentVolume?.title || currentVolume?.id || 'volume_default'}</div>
            <div className='text-muted'>{chapterTitleDraft || currentChapterMeta?.chapter_title || selectedChapter}</div>
          </div>
          <div>
            <div className='mb-1 font-medium'>Chapter Plan</div>
            {(currentStoryLinks.chapterPlan || []).map((row: any, idx: number) => (
              <div key={`plan-${idx}`} className='mb-1 rounded-ui border border-border bg-surface px-2 py-1'>
                {row.title || row.focus || row.chapter || row.chapter_id}
              </div>
            ))}
            {!currentStoryLinks.chapterPlan.length && <div className='text-muted'>No linked plan row.</div>}
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div className='rounded-ui border border-border bg-surface p-2'>
              <div className='font-medium'>明线</div>
              <div className='text-muted'>{currentStoryLinks.openLine.length ? currentStoryLinks.openLine.map((x: any) => x.event || x.result || x.chapter).join(' / ') : 'none'}</div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-2'>
              <div className='font-medium'>暗线</div>
              <div className='text-muted'>{currentStoryLinks.hiddenLine.length ? currentStoryLinks.hiddenLine.map((x: any) => x.truth || x.visible_hint || x.chapter).join(' / ') : 'none'}</div>
            </div>
          </div>
          <div>
            <div className='mb-1 font-medium'>伏笔</div>
            {currentStoryLinks.foreshadowings.map((x: any) => (
              <div key={x.id || x.content} className='mb-1 rounded-ui border border-border bg-surface px-2 py-1'>
                {x.content || x.id} <span className='text-muted'>({x.status || '未出现'})</span>
              </div>
            ))}
            {!currentStoryLinks.foreshadowings.length && <div className='text-muted'>No linked foreshadowing.</div>}
          </div>
        </div>
      </Card>

      <Card title='本章要求点亮'>
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
                  <span>{item.type} · {item.label || '未命名要求'}</span>
                  <Badge tone={markTone(level) as any}>{item.mark?.span?.quote ? level : '未证实'}</Badge>
                </div>
                {item.mark?.span?.quote ? <div className='mt-1 truncate text-muted'>L{item.mark.span.start_line}: {item.mark.span.quote}</div> : <div className='mt-1 text-muted'>没有真实 quote，不能显示为已命中</div>}
              </button>
            )
          })}
          {!requirementLights.length && <p className='text-xs text-muted'>当前章节还没有绑定明线、暗线、伏笔或 pinned 技法。</p>}
        </div>
      </Card>

      <Card title='Evidence Mark' extra={selectedMark ? <Badge tone={selectedMark?.detection?.support_level === 'supported' ? 'success' : selectedMark?.detection?.support_level === 'partial' ? 'warn' : 'default'}>{selectedMark?.detection?.support_level || '-'}</Badge> : undefined}>
        {selectedMark ? (
          <div className='space-y-2 text-xs'>
            <div className='font-medium'>{selectedMark.target_type} · {selectedMark.label || selectedMark.target_id}</div>
            <div className='text-muted'>{selectedMark.detection?.note || '可回查证据'}</div>
            <button
              className='w-full rounded-ui border border-border bg-surface-2 p-2 text-left hover:bg-surface'
              onClick={() => {
                const start = Number(selectedMark?.span?.start_line || 0)
                const end = Number(selectedMark?.span?.end_line || start)
                if (start > 0) setHighlightRange({ start, end })
              }}
            >
              <div>L{selectedMark.span?.start_line || 0}-L{selectedMark.span?.end_line || 0}</div>
              <div className='mt-1 whitespace-pre-wrap'>{selectedMark.span?.quote || '无真实 quote，不能视为已命中'}</div>
            </button>
            <div className='grid grid-cols-2 gap-1'>
              <Button className='text-xs'>确认命中</Button>
              <Button className='text-xs'>标为误判</Button>
              <Button className='text-xs'>让 AI 改段</Button>
              <Button className='text-xs'>忽略本章</Button>
            </div>
          </div>
        ) : <p className='text-xs text-muted'>暂无证据标记。</p>}
      </Card>

      <Card title='Pinned Techniques'>
        <pre className='mono text-xs max-h-40 overflow-auto rounded-ui bg-surface-2 p-2'>{JSON.stringify({
          techniques: currentChapterMeta?.pinned_techniques || [],
          categories: currentChapterMeta?.pinned_technique_categories || [],
        }, null, 2)}</pre>
      </Card>

      <details open className='rounded-ui border border-border bg-surface'>
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
            <div className='mt-1 text-muted'>回滚会先保存“回滚前备份”，不会直接丢掉当前正文。</div>
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
                <Button className='shrink-0 text-xs' disabled={v.is_current} onClick={() => rollbackVersion(v.version_id)}>回滚</Button>
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

  return <Layout left={left} center={center} right={right} header={header} />
}
