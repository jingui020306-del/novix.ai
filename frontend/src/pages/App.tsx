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
}


type SchemaCache = {
  cardSchemas: Record<string, any>
  blueprint?: any
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
  const [sessionMessageId, setSessionMessageId] = useState('writer_msg_001')
  const [sessionMessageText, setSessionMessageText] = useState('')
  const [worldQuery, setWorldQuery] = useState('临港城 封锁')
  const [worldRows, setWorldRows] = useState<any[]>([])
  const [wikiHtml, setWikiHtml] = useState('<html><head><title>示例</title></head><body><table class="infobox"><tr><th>阵营</th><td>黑潮同盟</td></tr></table><h2>设定</h2><p>临港城由七港区组成。</p></body></html>')
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
  const { data: chars, mutate: mutateCards } = useSWR(project ? `/api/projects/${project}/cards?type=character` : null, api.get)
  const { data: styles, mutate: mutateStyles } = useSWR(project ? `/api/projects/${project}/cards?type=style` : null, api.get)
  const { data: draft, mutate: mutateDraft } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}` : null, api.get)
  const { data: versions, mutate: mutateVersions } = useSWR(project ? `/api/projects/${project}/drafts/${selectedChapter}/versions` : null, api.get)
  const { data: sessionMeta, mutate: mutateSessionMeta } = useSWR(project ? `/api/projects/${project}/sessions/session_001/meta` : null, api.get)
  const { data: proposals, mutate: mutateProposals } = useSWR(project ? `/api/projects/${project}/canon/proposals` : null, api.get)

  const [characterForm, setCharacterForm] = useState<any>({ id: 'character_new', type: 'character', title: '', tags: [], links: [], payload: {} })
  const currentManifest = events.filter((e) => e.event === 'CONTEXT_MANIFEST').slice(-1)[0]?.data
  const latestPatch = events.filter((e) => e.event === 'EDITOR_PATCH').slice(-1)[0]?.data

  const profiles = projectInfo?.llm_profiles || {}

  const lazyLoadPaletteData = async (force = false) => {
    const cache = paletteCacheRef.current
    if (!force && cache.loadedFor === project) return
    try {
      const [characters, worldview, worldRules, lore, styleCards, outlines, blueprints, chapters, proposalRows, charSchema, styleSchemaFromApi, blueprintSchema] = await Promise.all([
        api.get(`/api/projects/${project}/cards?type=character`),
        api.get(`/api/projects/${project}/cards?type=worldview`),
        api.get(`/api/projects/${project}/cards?type=world_rule`),
        api.get(`/api/projects/${project}/cards?type=lore`),
        api.get(`/api/projects/${project}/cards?type=style`),
        api.get(`/api/projects/${project}/cards?type=outline`),
        api.get(`/api/projects/${project}/blueprints`),
        api.get(`/api/projects/${project}/drafts`),
        api.get(`/api/projects/${project}/canon/proposals`),
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
    paletteCacheRef.current = { characters: [], worldCards: [], styleCards: [], outlines: [], blueprints: [], chapters: [], proposals: [] }
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
    }
    const cardType = typeMap[parsed.type] || parsed.type
    const card: any = {
      id: `${cardType}_${ts}`,
      type: cardType,
      title: parsed.title,
      tags: parsed.tags,
      links: [],
      payload: {},
    }

    if (parsed.type === 'character') {
      const schema = schemaCacheRef.current.cardSchemas.character
      const setMaybe = (k: string, path: string, value: any) => {
        if (value === undefined || value === null || value === '') return
        if (schemaHasPath(schema, path)) setByPath(card, path, value)
        else warnings.push(`Ignored --${k} (schema path ${path} missing)`)
      }
      setMaybe('age', 'payload.identity.age', parsed.opts.age)
      setMaybe('gender', 'payload.identity.gender', parsed.opts.gender)
      if (parsed.opts.alias) setMaybe('alias', 'payload.meta.aliases', [parsed.opts.alias])
      if (parsed.tags.length) setMaybe('tag', 'payload.meta.tags', parsed.tags)
      setMaybe('importance', 'payload.meta.importance', parsed.opts.importance)
      setMaybe('note', 'payload.meta.note', parsed.opts.note)
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
      }
      await lazyLoadPaletteData(true)
      return { ok: true, label: `${parsed.type}:${parsed.title}` }
    } catch {
      return { ok: false, message: 'Create request failed' }
    }
  }

  const resolveCreateCommand = (query: string): { item?: CommandItem; error?: string } | null => {
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

  const runJob = async (maxTokens = 2400) => {
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
          push('Job finished')
        }
      }
    } catch {
      push('Run job failed', 'error')
    }
  }

  const applySelectedPatch = async () => {
    if (!latestPatch?.ops?.length) return
    try {
      const accept = selectedOpIds.length ? selectedOpIds : latestPatch.ops.map((o: any) => o.op_id)
      await api.post(`/api/projects/${project}/drafts/${selectedChapter}/apply-patch`, { patch_id: latestPatch.patch_id, patch_ops: latestPatch.ops, accept_op_ids: accept })
      mutateDraft()
      mutateVersions()
      mutateSessionMeta()
      push('Patch applied')
    } catch {
      push('Patch apply failed', 'error')
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

  const commandItems = useMemo<CommandItem[]>(() => {
    const cache = paletteCacheRef.current

    const staticNav: CommandItem[] = [
      { id: 'nav-characters', title: 'Go to Characters', subtitle: 'Open characters panel', group: 'Navigate', icon: UserRound, run: () => setView('characters') },
      { id: 'nav-settings', title: 'Settings', subtitle: 'Open settings panel', group: 'Navigate', icon: Settings, run: () => setView('settings') },
      { id: 'nav-chapter', title: 'Go to Chapter Editor', group: 'Navigate', icon: FilePenLine, run: () => setView('chapter') },
      { id: 'nav-canon', title: 'Go to Canon / Proposals', group: 'Navigate', icon: Sparkles, run: () => setView('canon') },
      { id: 'nav-world', title: 'Go to World panel', group: 'Navigate', icon: Globe, run: () => setView('world') },
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
      return (
        <div className='space-y-3 density-space'>
          <SchemaForm schema={charSchema} value={characterForm} onChange={setCharacterForm} />
          <Button variant='primary' onClick={async () => { await api.post(`/api/projects/${project}/cards`, characterForm); mutateCards(); push('Character saved') }}>保存角色</Button>
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
            <div className='mt-3 flex gap-2'>
              <Button variant='primary' onClick={() => runJob(2400)}>生成本章</Button>
              <Button onClick={() => runJob(160)}>超预算模拟</Button>
            </div>
          </Card>

          <Card title={highlightRange ? `Evidence: ${selectedChapter} L${highlightRange.start}-L${highlightRange.end}` : 'Draft Preview'}>
            <pre className='editor-text mono whitespace-pre-wrap rounded-ui bg-surface-2 p-3'>{highlighted || '暂无正文'}</pre>
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
      )
    }

    const evidence = currentManifest?.evidence || []
    return (
      <div className='space-y-3 density-space'>
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
        <details key={group} open={group === 'Canon' || group === 'Patch'} className='rounded-ui border border-border bg-surface'>
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
