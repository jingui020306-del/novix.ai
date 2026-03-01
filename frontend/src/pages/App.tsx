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

type PaletteCache = {
  loadedFor?: string
  characters: any[]
  worldCards: any[]
  styleCards: any[]
  outlines: any[]
  blueprints: any[]
  chapters: any[]
  proposals: any[]
  techniques?: any[]
  techniqueCategories?: any[]
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
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [mru, setMru] = useState<{ id: string; title: string; group: string; subtitle?: string }[]>([])

  const paletteCacheRef = useRef<PaletteCache>({
    characters: [],
    worldCards: [],
    styleCards: [],
    outlines: [],
    blueprints: [],
    chapters: [],
    proposals: [],
    techniques: [],
    techniqueCategories: [],
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
  const { data: charSchema } = useSWR('/api/schema/cards/character', api.get)
  const { data: styleSchema } = useSWR('/api/schema/cards/style', api.get)
  const { data: techniqueSchema } = useSWR('/api/schema/cards/technique', api.get)
  const { data: techniqueCategorySchema } = useSWR('/api/schema/cards/technique_category', api.get)
  const { data: chars, mutate: mutateCards } = useSWR(project ? `/api/projects/${project}/cards?type=character` : null, api.get)
  const { data: styles, mutate: mutateStyles } = useSWR(project ? `/api/projects/${project}/cards?type=style` : null, api.get)
  const { data: draft, mutate: mutateDraft } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}` : null, api.get)
  const { data: versions, mutate: mutateVersions } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/versions` : null, api.get)
  const { data: sessionMeta, mutate: mutateSessionMeta } = useSWR(project ? `/api/projects/${project}/sessions/session_001/meta` : null, api.get)
  const { data: proposals, mutate: mutateProposals } = useSWR(project ? `/api/projects/${project}/canon/proposals` : null, api.get)
  const { data: canonFacts, mutate: mutateCanonFacts } = useSWR(project ? `/api/projects/${project}/canon/facts?include_revisions=true` : null, api.get)
  const { data: techniqueCards, mutate: mutateTechniqueCards } = useSWR(project ? `/api/projects/${project}/cards?type=technique` : null, api.get)
  const { data: techniqueCategories, mutate: mutateTechniqueCategories } = useSWR(project ? `/api/projects/${project}/cards?type=technique_category` : null, api.get)
  const { data: globalProfiles, mutate: mutateGlobalProfiles } = useSWR('/api/config/llm/profiles', api.get)
  const { data: globalAssignments, mutate: mutateGlobalAssignments } = useSWR('/api/config/llm/assignments', api.get)
  const { data: providersMeta } = useSWR('/api/config/llm/providers_meta', api.get)
  const { data: memoryPacks, mutate: mutateMemoryPacks } = useSWR(project ? `/api/projects/${project}/memory_packs?chapter_id=${selectedChapter}` : null, api.get)

  const [characterForm, setCharacterForm] = useState<any>({ id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })
  const [techniqueForm, setTechniqueForm] = useState<any>(null)
  const [categoryForm, setCategoryForm] = useState<any>(null)
  const [profilesEditor, setProfilesEditor] = useState('')
  const [assignmentsEditor, setAssignmentsEditor] = useState('')
  const [presetProfileId, setPresetProfileId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('openai_compat:deepseek')
  const [selectedMemoryPackId, setSelectedMemoryPackId] = useState('')
  const currentManifest = events.filter((e) => e.event === 'CONTEXT_MANIFEST').slice(-1)[0]?.data
  const latestPatch = events.filter((e) => e.event === 'EDITOR_PATCH').slice(-1)[0]?.data

  const profiles = projectInfo?.llm_profiles || {}
  const providerPresets = ((providersMeta?.providers || []) as ProviderMeta[])
  const selectedPreset = providerPresets.find((x) => x.provider_id === selectedPresetId)
  const { data: selectedMemoryPack } = useSWR(
    project && selectedMemoryPackId ? `/api/projects/${project}/memory_packs/${encodeURIComponent(selectedMemoryPackId)}` : null,
    api.get,
  )

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

  const lazyLoadPaletteData = async (force = false) => {
    const cache = paletteCacheRef.current
    if (!force && cache.loadedFor === project) return
    try {
      const [characters, worldview, worldRules, lore, styleCards, outlines, blueprints, chapters, proposalRows, techniqueRows, categoryRows, charSchema, styleSchemaFromApi, blueprintSchema] = await Promise.all([
        api.get(`/api/projects/${project}/cards?type=character`),
        api.get(`/api/projects/${project}/cards?type=worldview`),
        api.get(`/api/projects/${project}/cards?type=world_rule`),
        api.get(`/api/projects/${project}/cards?type=lore`),
        api.get(`/api/projects/${project}/cards?type=style`),
        api.get(`/api/projects/${project}/cards?type=outline`),
        api.get(`/api/projects/${project}/blueprints`),
        api.get(`/api/projects/${project}/drafts`),
        api.get(`/api/projects/${project}/canon/proposals`),
        api.get(`/api/projects/${project}/cards?type=technique`),
        api.get(`/api/projects/${project}/cards?type=technique_category`),
        api.get(`/api/schema/cards/character`),
        api.get(`/api/schema/cards/style`),
        api.get(`/api/schema/blueprint`),
      ])
      paletteCacheRef.current = {
        loadedFor: project,
        characters: Array.isArray(characters) ? characters : [],
        worldCards: [...(Array.isArray(worldview) ? worldview : []), ...(Array.isArray(worldRules) ? worldRules : []), ...(Array.isArray(lore) ? lore : [])],
        styleCards: Array.isArray(styleCards) ? styleCards : [],
        outlines: Array.isArray(outlines) ? outlines : [],
        blueprints: Array.isArray(blueprints) ? blueprints : [],
        chapters: Array.isArray(chapters) ? chapters : [],
        proposals: Array.isArray(proposalRows) ? proposalRows : [],
        techniques: Array.isArray(techniqueRows) ? techniqueRows : [],
        techniqueCategories: Array.isArray(categoryRows) ? categoryRows : [],
      }

      schemaCacheRef.current = {
        cardSchemas: {
          character: charSchema || {},
          style: styleSchemaFromApi || {},
        },
        blueprint: blueprintSchema || {},
      }
    } catch {
      push('Command Palette data load failed, showing local commands only', 'error')
      paletteCacheRef.current.loadedFor = project
    }
  }

  const refreshPaletteData = async () => {
    paletteCacheRef.current = { characters: [], worldCards: [], styleCards: [], outlines: [], blueprints: [], chapters: [], proposals: [], techniques: [], techniqueCategories: [] }
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
      lore: 'lore',
      world_rule: 'world_rule',
      technique: 'technique',
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

      if (parsed.type === 'chapter') {
        const chapterId = `ch_${Date.now()}`
        const body = { content: `# ${parsed.title}

` }
        const put1 = await api.put(`/api/projects/${project}/drafts/${chapterId}`, body)
        if (put1?.detail) return { ok: false, message: String(put1.detail?.message || put1.detail) }
        const meta: any = {
          chapter_id: chapterId,
          title: parsed.title,
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
      } else if (parsed.type === 'world' || parsed.type === 'lore' || parsed.type === 'world_rule') {
        setView('world')
      } else if (parsed.type === 'outline') {
        setView('context')
      } else if (parsed.type === 'technique') {
        setView('techniques')
        mutateTechniqueCards()
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
      const j = await api.post(`/api/projects/${project}/jobs/write`, {
        chapter_id: selectedChapter,
        blueprint_id: 'blueprint_001',
        scene_index: 0,
        agents: ['director', 'writer'],
        llm_profile_id: llmProfileId,
        auto_apply_patch: autoApplyPatch,
        constraints: { max_tokens: maxTokens },
        selection_range: range || undefined,
      })
      const ws = new WebSocket(`ws://127.0.0.1:8000/api/jobs/${j.job_id}/stream`)
      ws.onmessage = (e) => {
        const evt = JSON.parse(e.data)
        setEvents((x) => [...x, evt])
        if (evt.event === 'DONE') {
          mutateDraft()
          mutateStyles()
          mutateVersions()
          mutateSessionMeta()
          mutateMemoryPacks()
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

  const applySelectedPatch = async () => {
    if (!latestPatch?.ops?.length) return
    try {
      const accept = selectedOpIds.length ? selectedOpIds : latestPatch.ops.map((o: any) => o.op_id)
      await api.post(`/api/projects/${project}/drafts/${selectedChapter}/apply-patch`, { patch_id: latestPatch.patch_id, patch_ops: latestPatch.ops, accept_op_ids: accept, selection_range: latestPatch.selection_range || undefined })
      mutateDraft()
      mutateVersions()
      mutateSessionMeta()
      push('Patch applied')
    } catch {
      push('Patch apply failed', 'error')
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
      mutateDraft()
      mutateVersions()
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
      { id: 'nav-characters', title: 'Go to Characters', subtitle: 'Open characters panel', group: 'Navigate', icon: UserRound, run: () => setView('characters') },
      { id: 'nav-settings', title: 'Settings', subtitle: 'Open settings panel', group: 'Navigate', icon: Settings, run: () => setView('settings') },
      { id: 'nav-chapter', title: 'Go to Chapter Editor', group: 'Navigate', icon: FilePenLine, run: () => setView('chapter') },
      { id: 'nav-canon', title: 'Go to Canon / Proposals', group: 'Navigate', icon: Sparkles, run: () => setView('canon') },
      { id: 'nav-world', title: 'Go to World panel', group: 'Navigate', icon: Globe, run: () => setView('world') },
      { id: 'nav-techniques', title: 'Go to Techniques', group: 'Navigate', icon: Sparkles, run: () => setView('techniques') },
    ]

    const navData: CommandItem[] = [
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
      ...cache.chapters.map((ch: string) => ({
        id: `chapter-${ch}`,
        title: `Open Chapter: ${ch}`,
        subtitle: 'Chapter editor',
        group: 'Navigate' as const,
        icon: iconForKind('chapter'),
        keywords: [ch, 'chapter'],
        payload: { kind: 'chapter', id: ch },
        run: () => {
          setSelectedChapter(ch)
          setView('chapter')
        },
      })),
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
    ]

    const mruItems: CommandItem[] = mru.map((x) => ({ id: `mru-${x.id}`, title: `[Recent] ${x.title}`, subtitle: x.subtitle, group: 'Navigate', icon: BookOpen, run: () => {} }))

    const all = [...staticNav, ...navData, ...actionItems, ...baseHelpCommands(() => {})]
    const resolvedMRU = mruItems.map((m) => {
      const target = all.find((x) => x.id === m.id.replace('mru-', ''))
      return target ? { ...target, title: `[Recent] ${target.title}` } : null
    }).filter(Boolean) as CommandItem[]

    return [...resolvedMRU, ...all]
  }, [mru, project, settings, autoApplyPatch])

  const filteredNav = NAV_ITEMS.filter((x) => x.label.toLowerCase().includes(sideSearch.toLowerCase()))

  const left = (
    <div className='space-y-3 density-space'>
      <Input placeholder='Filter panels...' value={sideSearch} onChange={(e) => setSideSearch(e.target.value)} />
      <div className='space-y-2'>
        {filteredNav.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => setView(item.id)}
              className={`w-full density-pad flex items-center gap-2 rounded-ui text-left text-sm border ${view === item.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-surface text-muted border-border hover:bg-surface-2'}`}
            >
              <Icon size={15} />
              {item.label}
            </button>
          )
        })}
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

    if (view === 'projects') {
      return (
        <Card title='Projects' extra={<Button variant='primary' onClick={async () => { const r = await api.post('/api/projects', { title: '新项目' }); setProject(r.project_id); mutateProjects() }}>Create</Button>}>
          <div className='space-y-2'>
            {(projects || []).map((p: any) => (
              <button key={p.id} onClick={() => setProject(p.id)} className={`w-full rounded-ui border px-3 py-2 text-left ${project === p.id ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}>
                <div className='text-sm font-medium'>{p.id}</div>
                <div className='text-xs text-muted'>{p.title}</div>
              </button>
            ))}
          </div>
        </Card>
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
      return (
        <div className='space-y-3 density-space'>
          <Card title='Chapter Editor'>
            <div className='grid grid-cols-12 gap-3'>
              <div className='col-span-4'>
                <label className='text-xs text-muted'>Chapter</label>
                <Input value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)} />
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
                <Button variant='primary' onClick={() => runJob(2400)}>生成本章</Button>
                <Button onClick={() => runJob(160)}>超预算模拟</Button>
                <Button onClick={analyzeChapter} disabled={analyzeBusy}>{analyzeBusy ? 'Analyzing...' : 'Analyze & Save'}</Button>
                {selectionRange ? <Button onClick={() => runJob(1200, selectionRange)}>Edit Selection</Button> : null}
              </div>
            </div>
            {selectionRange ? <p className='mt-2 text-xs text-muted'>Selection range: L{selectionRange.start}-L{selectionRange.end}</p> : <p className='mt-2 text-xs text-muted'>Set start/end to enable Edit Selection.</p>}
            {analyzeResult ? <p className='mt-1 text-xs text-muted'>Analyze result: +{analyzeResult.new_facts_count || 0} facts, +{analyzeResult.new_proposals_count || 0} proposals.</p> : null}
          </Card>

          <Card title={highlightRange ? `Evidence: ${selectedChapter} L${highlightRange.start}-L${highlightRange.end}` : 'Draft Preview'}>
            <pre className='editor-text mono whitespace-pre-wrap rounded-ui bg-surface-2 p-3'>{highlighted || '暂无正文'}</pre>
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

          <Card title='TECHNIQUE_BRIEF'>
            <pre className='mono text-xs whitespace-pre-wrap rounded-ui bg-surface-2 p-3'>{JSON.stringify(events.filter((e) => e.event === 'TECHNIQUE_BRIEF').slice(-1)[0]?.data || (draft?.meta || {}).technique_brief || {}, null, 2)}</pre>
          </Card>

          <Card
            title='Patch Review'
            extra={
              <div className='flex gap-1'>
                <Button className='text-xs' onClick={() => setSelectedOpIds((latestPatch?.ops || []).map((o: any) => o.op_id))}>全选</Button>
                <Button className='text-xs' onClick={() => setSelectedOpIds([])}>清空</Button>
              </div>
            }
          >
            <div className='space-y-3'>
              {(latestPatch?.ops || []).map((op: any) => (
                <div key={op.op_id} className='rounded-ui border border-border bg-surface p-2'>
                  <label className='flex items-center gap-2 text-sm'>
                    <input type='checkbox' checked={selectedOpIds.includes(op.op_id)} onChange={(e) => setSelectedOpIds((x) => (e.target.checked ? [...x, op.op_id] : x.filter((id) => id !== op.op_id)))} />
                    <span className='font-medium'>{op.op_id}</span>
                    <Badge>{op.type}</Badge>
                    <span className='text-xs text-muted'>{JSON.stringify(op.target_range)}</span>
                  </label>
                  <div className='mt-2 grid grid-cols-2 gap-2'>
                    <pre className='mono text-xs rounded-ui bg-red-50 p-2 dark:bg-red-950/20'>- {op.before || ''}</pre>
                    <pre className='mono text-xs rounded-ui bg-emerald-50 p-2 dark:bg-emerald-950/20'>+ {op.after || ''}</pre>
                  </div>
                  <p className='mt-1 text-xs text-muted'>rationale: {op.rationale || 'n/a'}</p>
                </div>
              ))}
              {!latestPatch?.ops?.length && <p className='text-sm text-muted'>No patch generated yet.</p>}
              <Button variant='primary' onClick={applySelectedPatch}>应用勾选改动</Button>
            </div>
          </Card>

          <Card title='Version Tree'>
            <div className='space-y-2'>
              {(versions?.versions || []).map((v: any) => (
                <div key={v.version_id} className='flex items-center justify-between rounded-ui border border-border px-2 py-1.5'>
                  <span className='text-sm'>{v.version_id} <span className='text-xs text-muted'>{v.reason}</span></span>
                  <Button className='text-xs' onClick={() => rollbackVersion(v.version_id)}>回滚</Button>
                </div>
              ))}
              {(!versions?.versions || versions.versions.length === 0) && <p className='text-sm text-muted'>No versions yet.</p>}
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
      return (
        <div className='space-y-3 density-space'>
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
          <Card title='Technique Library'>
            <div className='flex gap-2 mb-2'>
              <Input value={techniqueQuery} onChange={(e) => setTechniqueQuery(e.target.value)} placeholder='Search technique/category keywords...' />
              <Button onClick={async () => { mutateTechniqueCards(); mutateTechniqueCategories(); push('Technique list refreshed') }}>Refresh</Button>
            </div>
            <div className='max-h-72 overflow-auto space-y-1'>
              {rows.map((r: any) => (
                <button key={r.id} className='w-full rounded-ui border border-border bg-surface px-2 py-1 text-left text-xs hover:bg-surface-2' onClick={() => setTechniqueForm(r)}>{r.title} <span className='text-muted'>({r.id})</span></button>
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
    highlighted,
    latestPatch,
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
      {Object.entries(eventGroups).map(([group, rows]) => (
        <details key={group} open={group === 'Canon' || group === 'Patch' || group === 'Technique'} className='rounded-ui border border-border bg-surface'>
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
