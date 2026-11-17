import { WORLD_ENTRY_TYPES as ENTRY_TYPES, WORLD_ENTRY_LABELS as ENTRY_LABELS } from '../lib/materialScope'
import { ReactNode, useEffect, useRef, useState } from 'react'
import useSWR, { mutate as mutateCache } from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'
import { MaterialReferences, OpenMaterial } from './MaterialReferences'
import { KnowledgeGraph } from './KnowledgeGraph'
import { WritingReferenceNotice, WritingReferencePicker } from './WritingReferencePicker'
import { TokenUsage } from './WritingTools'
import { cardAfterSave, useDraftRecovery } from '../lib/editorDrafts'
import { MaterialImportWorkspace } from './MaterialImportWorkspace'
import { AuthorStatePanel } from './AuthorStatePanel'
import { AuthorControls, useAuthorControl, pointerLocked } from './AuthorControls'
import { MaterialSearch, NameReferences } from './MaterialDiscovery'
import { CardOperations } from './CardOperations'
import { FamilyRules } from './FamilyRules'
import { WorldMaps } from './WorldMaps'
import { WorldLibrary } from './WorldLibrary'
import { WorldStageBrowser } from './WorldStageBrowser'
import { WorldExtras } from './WorldExtras'

const DIRECTIONS = [['geography', '地理'], ['biology', '生物'], ['physics_magic', '物理与魔法'], ['metaphysics', '形而上'], ['technology', '科技'], ['culture', '文化']]
const SETTING: Record<string, string> = { unset: '未设置', not_applicable: '不适用', set: '已采用' }
const CANON: Record<string, string> = { canon: '已确定', hypothesis: '推定', inspiration: '灵感' }
const CREATION: Record<string, string> = { new: '待起笔', draft: '草案', complete: '已完善' }
const worldType = (card: any) => ['world', 'world_rule', 'lore', 'worldview'].includes(card.type)
const entryType = (card: any) => ENTRY_LABELS[card.payload?.entry_type] || card.payload?.entry_type || (card.type === 'world_rule' ? '规则与能力' : '__legacy__')
const bodyKey = (card: any) => ['content', 'description', 'rule', 'text', 'setting'].find((key) => typeof card.payload?.[key] === 'string') || 'content'
const timestamp = (card: any) => Date.parse(card.updated_at || card.payload?.updated_at || '') || 0

export function WorldWiki({ project, projectTitle, chapters, draftCache, onOpenMaterial, focusRequest, referenceRequest, legacyEditor, profileId, onOpenSettings, navigationRequest, storyCard, onActiveCardChange, eventContext, onOpenEvent }: {
  project: string; projectTitle: string; draftCache: { current: Record<string, any> }; onOpenMaterial: OpenMaterial;
  chapters: any[]; storyCard?: any; onActiveCardChange?: (id: string) => void; eventContext?: any; onOpenEvent?: (owner: string, scene: string) => void;
  focusRequest?: { id: string; requestId: number; editPath?: string[]; stage_id?: string } | null;
  referenceRequest?: { type: string; cardId: string; referenceId: string; requestId: number } | null;
  legacyEditor: ReactNode;
  profileId?: string; onOpenSettings?: () => void; navigationRequest?: { section: 'overview' | 'places' | 'stage'; requestId: number } | null;
}) {
  const { data, error: readError, mutate } = useSWR(`/api/projects/${project}/cards`, api.get)
  const cards: any[] = (Array.isArray(data) ? data : []).filter(worldType).sort((a: any, b: any) => Number(a.sort_order ?? a.payload?.sort_order ?? 1e9) - Number(b.sort_order ?? b.payload?.sort_order ?? 1e9) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'))
  const root = cards.find((card) => card.id === storyCard?.payload?.world_context?.world_id) || cards.find((card) => card.payload?.entry_type === 'world') || cards.find((card) => card.type === 'world' && !card.payload?.parent_id && !card.payload?.direction) || cards.find((card) => !card.payload?.parent_id && !card.payload?.direction)
  const overviewCards = cards.filter((card) => {
    const seen = new Set<string>()
    let current = card
    while (current && !seen.has(current.id)) {
      if (current.payload?.world_context?.world_id) return current.payload.world_context.world_id === root?.id
      if (current.id === root?.id) return true
      seen.add(current.id)
      current = cards.find((parent) => parent.id === current.payload?.parent_id)
    }
    return false
  })
  const startTime = storyCard?.payload?.world_context?.time || {}
  const startEvent = startTime.event_ref ? (Array.isArray(data) ? data : []).find((card: any) => card.id === startTime.event_ref.owner_card_id)?.payload?.important_scenes?.find((row: any, index: number) => (row.id || `index_${index}`) === startTime.event_ref.scene_id) : null
  const startMoment = [startTime.year !== undefined && startTime.year !== null ? `${startTime.year} 年` : '', startTime.date || '', startTime.event_ref ? `${startEvent?.scene || '已关联的事件'}${({ before: '发生前', immediate_after: '刚结束', phase: '之后的明确阶段' } as Record<string, string>)[startTime.position] || '（时点待明确）'}` : '', startTime.position === 'phase' ? startTime.phase : ''].filter(Boolean).join(' · ')

  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [view, setView] = useState('世界首页')
  const [query, setQuery] = useState('')
  const [entryTypeFilter, setEntryTypeFilter] = useState('')
  const [formState, setFormState] = useState<{ project: string; card: any } | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(() => window.innerWidth >= 1050)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAIBusy] = useState('')
  const [aiError, setAIError] = useState('')
  const [aiCandidate, setAICandidate] = useState<any>(null)
  const aiRequest = useRef(0)
  const [extrasRequest, setExtrasRequest] = useState(0)
  const form = formState?.project === project ? formState.card : null
  useEffect(() => { onActiveCardChange?.(form?.id || root?.id || '') }, [project, form?.id, root?.id])
  const draftKey = `${project}:world:${form?.id || 'new'}`
  const localDraft = useDraftRecovery(draftKey, form, JSON.stringify(cards.find((card) => card.id === form?.id) || {}), (card) => setFormState({ project, card }))
  const latest = useRef(form)
  latest.current = form
  const latestProject = useRef(project)
  latestProject.current = project
  const savedCards = useRef<Record<string, string>>({})
  useEffect(() => { for (const row of cards) { const key = `${project}:${row.id}`; const before = savedCards.current[key]; if (before) setFormState((current) => current?.project === project && current.card.id === row.id && JSON.stringify(current.card) === before ? { project, card: row } : current); savedCards.current[key] = JSON.stringify(row) } }, [data, project])
  const processed = useRef('')
  const initializedProject = useRef(project)
  const payload = form?.payload || {}
  let mapOwner = form; const ownerVisited = new Set<string>(); while (mapOwner?.payload?.parent_id && !ownerVisited.has(mapOwner.id)) { ownerVisited.add(mapOwner.id); const parent = cards.find((card) => card.id === mapOwner.payload.parent_id); if (!parent) break; mapOwner = parent }
  const formWorldId = form?.payload?.world_context?.world_id || (mapOwner?.payload?.entry_type === 'world' ? mapOwner.id : root?.id)
  const { lockedPaths } = useAuthorControl(project, form?.id ? `cards/${form.id}.yaml` : undefined)
  if (form) {
    draftCache.current[`${project}:${form.type}:${form.id}`] = form
    if (form.type === 'world') draftCache.current[`${project}:world:selected`] = form.id
  }
  const open = (card: any) => {
    aiRequest.current++; setAIBusy(''); setAIError(''); setAICandidate(null)
    setExtrasRequest(0); setResourcesOpen(false)
    setFormState({ project, card: draftCache.current[`${project}:${card.type}:${card.id}`] || card })
    setMessage('')
    setLegacyOpen(false)
    if (window.innerWidth < 1050) setDirectoryOpen(false)
  }
  useEffect(() => {
    if (initializedProject.current === project) return
    initializedProject.current = project
    processed.current = ''
    setResourcesOpen(false); setView('世界首页'); setFormState(null); setMessage(''); setEntryTypeFilter(''); setQuery(''); setLegacyOpen(false)
  }, [project])
  useEffect(() => () => { aiRequest.current++ }, [project])
  useEffect(() => {
    if (!focusRequest || !Array.isArray(data) || processed.current === `focus:${focusRequest.requestId}`) return
    const card = cards.find((row) => row.id === focusRequest.id)
    if (card) { open(card); setView('全部条目'); setEntryTypeFilter(''); setQuery(''); processed.current = `focus:${focusRequest.requestId}` }
  }, [focusRequest, data, project])
  useEffect(() => {
    if (form?.id !== focusRequest?.id || !focusRequest?.editPath?.length) return
    const field = focusRequest.editPath[1]
    const target = document.getElementById(field === 'rules' ? 'world-root-rules' : field === bodyKey(form) ? 'world-entry-content' : `world-entry-${field}`)
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
    target?.scrollIntoView({ block: 'center' }); target?.focus()
  }, [focusRequest?.requestId, form?.id, view])

  useEffect(() => {
    if (referenceRequest?.type !== 'world' || !Array.isArray(data) || draftCache.current[`${project}:wikiReferenceRequest`] === referenceRequest.requestId || draftCache.current[`${project}:world:appliedReferenceRequest`] === referenceRequest.requestId) return
    const card = cards.find((row) => row.id === referenceRequest.cardId)
    if (!card) return
    const current = draftCache.current[`${project}:${card.type}:${card.id}`] || card
    open({ ...current, payload: { ...current.payload, writing_references: [...new Set([...(current.payload?.writing_references || []), referenceRequest.referenceId])] } })
    setFormState({ project, card: { ...current, payload: { ...current.payload, writing_references: [...new Set([...(current.payload?.writing_references || []), referenceRequest.referenceId])] } } })
    setView('全部条目')
    setMessage('写作参考已加入当前表单，请保存条目。')
    draftCache.current[`${project}:wikiReferenceRequest`] = referenceRequest.requestId
    draftCache.current[`${project}:world:appliedReferenceRequest`] = referenceRequest.requestId
  }, [referenceRequest, data, project])
  const create = (entryType = '原创设定', parentId = '', selectedDirection = '') => {
    aiRequest.current++; setAIBusy(''); setAIError(''); setAICandidate(null)
    const card = { id: `world_${crypto.randomUUID().slice(0, 10)}`, type: 'world', title: '', tags: [], links: [], payload: { entry_type: entryType, ...(selectedDirection ? { direction: selectedDirection } : {}), ...(parentId ? { parent_id: parentId } : {}), summary: '', content: '', setting_status: 'unset', canon_status: 'inspiration', creation_status: 'new' } }
    setFormState({ project, card }); setView('全部条目'); setMessage('新条目尚未保存，可先写下你已确定的部分。'); setLegacyOpen(false); if (window.innerWidth < 1050) setDirectoryOpen(false)
  }
  const update = (key: string, value: any) => setFormState((current) => {
    if (current?.project !== project || pointerLocked(lockedPaths, `/payload/${key}`)) return current
    const next = { ...current.card.payload, [key]: value, field_provenance: { ...current.card.payload?.field_provenance, [key]: 'author_edit' } }
    if (value === '' && ['direction', 'parent_id', 'setting_status', 'canon_status', 'creation_status', 'introduced_chapter'].includes(key)) delete next[key]
    return { ...current, card: { ...current.card, payload: next } }
  })
  const rootDraft = () => root ? draftCache.current[`${project}:${root.type}:${root.id}`] || root : { id: `world_overview_${project}`, type: 'world', title: `${projectTitle || '作品'}的世界`, tags: [], links: [], payload: { entry_type: 'world', domain_status: {} } }
  const generateField = async (field: string, label: string) => {
    if (!form || form.type !== 'world') return
    const before = JSON.stringify(form)
    const request = ++aiRequest.current
    setAIBusy(field); setAIError(''); setAICandidate(null)
    try {
      const result = await api.post(`/api/projects/${project}/cards/generate-field`, { card: form, path: ['payload', field], llm_profile_id: profileId })
      if (request !== aiRequest.current || latestProject.current !== project) return
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '生成失败，请检查世界设定使用的模型。')
      if (JSON.stringify(latest.current) !== before) { setAIError('你在生成期间修改了条目，已保留编辑。请按最新内容重新生成。'); return }
      if (typeof result.value !== 'string') throw new Error('模型没有返回可用文字，请重试。')
      setAICandidate({ field, label, value: result.value, before, original: form.payload?.[field] || '', usage: result.usage, references: result.writing_reference_usage })
      setTimeout(() => document.getElementById('world-ai-candidate')?.scrollIntoView({ block: 'center' }), 0)
    } catch (cause) { if (request === aiRequest.current && latestProject.current === project) setAIError(cause instanceof Error ? cause.message : '生成失败，请重试。') }
    finally { if (request === aiRequest.current && latestProject.current === project) setAIBusy('') }
  }
  const aiButton = (field: string, label: string) => form?.type === 'world' ? <Button variant='ghost' className='shrink-0 text-xs' aria-label={`AI 生成${label}`} disabled={Boolean(aiBusy) || pointerLocked(lockedPaths, `/payload/${field}`, true)} onClick={() => generateField(field, label)}>{aiBusy === field ? '生成中…' : 'AI 建议'}</Button> : null
  const save = async () => {
    if (!form?.title?.trim()) { setMessage('请先为条目填写名称。'); return }
    const saved = cards.find((card) => card.id === form.id)
    if (saved && JSON.stringify(form) === JSON.stringify(saved)) { setMessage('内容没有变化，已有作者版已保留。'); return }
    const snapshot = JSON.stringify(form)
    const body = form
    setBusy(true); setMessage('')
    try {
      const result = await api.put(`/api/projects/${project}/cards/${encodeURIComponent(body.id)}`, body)
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '条目保存失败，请重试。')
      if (latestProject.current !== project) return
      const edited = JSON.stringify(latest.current) !== snapshot
      setFormState((current) => current?.project === project ? { project, card: cardAfterSave(current.card, body, result, snapshot) } : current)
      localDraft.markSaved(form, cardAfterSave(form, body, result, snapshot))
      await mutate()
      void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /cards|materials|backlinks|knowledge-graph|change-suggestions/.test(key))
      const queued = result.change_suggestions?.queued_count
      setMessage(result.change_suggestions?.error ? `条目已保存；${result.change_suggestions.error}` : edited ? '已保存提交时的条目，之后的编辑请再次保存。' : queued ? `条目已保存，已排队 ${queued} 项受影响正文建议；确认前不改正文。` : '条目已保存，各处引用会读取这份作者版。正文建议进度可到章节页查看。')
    } catch (cause) { if (latestProject.current === project) setMessage(cause instanceof Error ? cause.message : '条目保存失败，请重试。') }
    finally { if (latestProject.current === project) setBusy(false) }
  }
  const filtered = cards.filter((card) => {
    const p = card.payload || {}
    if (entryTypeFilter && entryType(card) !== entryTypeFilter) return false
    if (view === '待补内容' && !(p.setting_status !== 'not_applicable' && (p.creation_status === 'new' || p.creation_status === 'draft' || p.setting_status === 'unset' || !String(p.summary || p[bodyKey(card)] || '').trim()))) return false
    if (view === '核心设定' && !p.core) return false
    if (view === '最近更新' && !timestamp(card)) return false
    return `${card.title || ''} ${p.summary || ''} ${p.entry_type || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  }).sort((a, b) => view === '最近更新' ? timestamp(b) - timestamp(a) : Number(a.sort_order ?? a.payload?.sort_order ?? 1e9) - Number(b.sort_order ?? b.payload?.sort_order ?? 1e9) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'))
  const tree = (parent: string, pool: any[], seen = new Set<string>()): ReactNode => pool.filter((card) => (card.payload?.parent_id || '') === parent && !seen.has(card.id)).map((card) => {
    const next = new Set([...seen, card.id])
    const children = pool.some((item) => item.payload?.parent_id === card.id && !next.has(item.id))
    const button = <button className={`world-tree-entry ${form?.id === card.id ? 'is-current' : ''}`} onClick={() => { open(card); if (view === '世界首页') setView('全部条目') }}>{card.title || '未命名条目'}</button>
    return children ? <details key={card.id} open><summary>{button}</summary><div className='world-tree-children'>{tree(card.id, pool, next)}</div></details> : <div key={card.id}>{button}</div>
  })
  const treePool = cards.map((card) => cards.some((parent) => parent.id === card.payload?.parent_id) ? card : { ...card, payload: { ...card.payload, parent_id: '' } })
  const descendants = new Set<string>(form ? [form.id] : [])
  for (let step = 0; step < cards.length; step++) for (const card of cards) if (descendants.has(card.payload?.parent_id)) descendants.add(card.id)
  const browse = (type: string) => {
    setEntryTypeFilter(type); setView('全部条目'); setFormState(null); setDirectoryOpen(true); setMessage('')
  }
  useEffect(() => { if (!navigationRequest || !Array.isArray(data)) return; if (navigationRequest.section === 'places') { open(rootDraft()); setView('地图'); setResourcesOpen(false); setExtrasRequest(navigationRequest.requestId) } else { setView(navigationRequest.section === 'stage' ? '阶段浏览' : '世界首页'); setEntryTypeFilter(''); setQuery(''); setFormState(null); setResourcesOpen(false) } }, [navigationRequest?.requestId, Boolean(data)])
  const otherTypes = [...new Set(cards.map(entryType))].filter((type) => !ENTRY_TYPES.includes(type))
  const newType = entryTypeFilter && !['world', '__legacy__'].includes(entryTypeFilter) ? entryTypeFilter : '原创设定'
  const maps = form && <WorldMaps key={`${project}:${form.id}:maps`} openRequest={extrasRequest} project={project} cardId={form.id} worldId={formWorldId} value={payload.maps || []} onChange={(maps) => update('maps', maps)} onOpen={onOpenMaterial} profileId={profileId} lockedPaths={lockedPaths} saved={cards.some((card) => card.id === form.id)} />
  const historyWorldId = eventContext?.world_id || root?.id
  const showTree = ['世界首页', '全部条目'].includes(view) && !query && !entryTypeFilter
  return <div className='world-wiki space-y-6'>
    <header className='world-heading'><h1>世界</h1><div className='flex gap-2'><Button onClick={() => setResourcesOpen(!resourcesOpen)}>{resourcesOpen ? '返回当前世界' : '世界资料库'}</Button><Button onClick={() => create(newType)}>新建条目</Button></div></header>
    <nav className='story-task-nav' aria-label='世界详情'><button aria-current={view === '世界首页' ? 'page' : undefined} onClick={() => {setResourcesOpen(false);setView('世界首页');setFormState(null);setEntryTypeFilter('');setQuery('')}}>概况</button><button aria-current={view === '地图' ? 'page' : undefined} onClick={() => {
        setResourcesOpen(false)
        open(rootDraft())
        setView('地图')
        setExtrasRequest(Date.now())
      }}>地图</button><button aria-current={view === '阶段浏览' ? 'page' : undefined} onClick={() => {setResourcesOpen(false);setView('阶段浏览');setFormState(null)}}>沿革</button></nav>
    {readError && <div className='space-y-2'><p role='alert' className='text-sm text-muted'>世界资料暂时未能读取，已有草稿仍保留。</p><Button onClick={() => { void mutate().catch(() => undefined) }}>重新读取世界资料</Button></div>}
    {localDraft.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>找到此条目的本地未保存稿。</p><div className='flex gap-2'><Button onClick={localDraft.restore}>恢复草稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留保存版</Button></div></div>}
    {resourcesOpen && <WorldLibrary expanded project={project} worldId={root?.id} worldRevision={root?._revision} dirty={Boolean(root && draftCache.current[`${project}:${root.type}:${root.id}`] && JSON.stringify(draftCache.current[`${project}:${root.type}:${root.id}`]) !== JSON.stringify(root))} onChanged={() => { void mutate() }} onOpenWorld={(id) => { const card = cards.find((row) => row.id === id); if (card) { open(card); setView('全部条目') } else { void mutate().then((rows: any) => { const incoming = rows?.find?.((row: any) => row.id === id); if (incoming && latestProject.current === project) { open(incoming); setView('全部条目') } }) } }} />}
    {!resourcesOpen && view === '世界首页' && <details className='py-3'><summary className='cursor-pointer text-sm font-medium'>导入世界材料：文字、文件、图片或链接</summary><div className='mt-4'><MaterialImportWorkspace project={project} purpose='world' isTargetDirty={(id) => { const saved = cards.find((card) => card.id === id); const local = draftCache.current[`${project}:world:${id}`]; return Boolean(saved && local && JSON.stringify(saved) !== JSON.stringify(local)) }} profileId={profileId} onApplied={() => { void mutate() }} /></div></details>}
    {data?.detail ? <p role='alert' className='text-sm text-muted'>世界资料读取失败，请刷新后重试。</p> : !data ? <p role='status' className='text-sm text-muted'>正在读取世界资料…</p> : !resourcesOpen ? view === '阶段浏览' ? <>
      {historyWorldId && <AuthorStatePanel onOpenEvent={onOpenEvent} key={historyWorldId} project={project} entityId={historyWorldId} type='world' storyId={storyCard?.id} eventRef={eventContext?.time?.event_ref ? `${eventContext.time.event_ref.owner_card_id}:important_scenes:${eventContext.time.event_ref.scene_id}` : undefined} />}
      <details open={Boolean(eventContext)}><summary>按故事时点查看世界</summary>
        <WorldStageBrowser project={project} storyCard={storyCard} initialContext={eventContext} worldId={historyWorldId} onOpen={onOpenMaterial} />
      </details>
    </> : view === '地图' && form ? <section className='space-y-4' aria-label='世界地图'>
      {maps}
      <Button onClick={save} disabled={busy}>{busy ? '保存中…' : '保存地图'}</Button>
    </section> : <>
      {view === '世界首页' && <section className='world-overview' aria-label='世界总览'>
        <div><div className='flex flex-wrap items-baseline justify-between gap-3'><h2>这个世界</h2><button className='text-xs text-brand-600 hover:underline focus-ring' onClick={() => { open(rootDraft()); setView('全部条目') }}>编辑世界简介</button></div><p className='mt-4 whitespace-pre-wrap text-sm leading-8'>{root?.payload?.summary || root?.payload?.[bodyKey(root)] || '还没有写下世界简介。也可以先在下方整理已有的地点、族群与规则。'}</p>{Array.isArray(root?.payload?.rules) && root.payload.rules.some(Boolean) && <ul className='mt-4 space-y-2 text-sm leading-7 text-muted'>{root.payload.rules.filter(Boolean).map((rule: string, index: number) => <li key={index}>{rule}</li>)}</ul>}</div>
        <div className='world-overview-important'><h2>重要设定</h2>{overviewCards.some((card) => card.payload?.core) ? <ul className='mt-3 space-y-3'>{overviewCards.filter((card) => card.payload?.core).slice(0, 5).map((card) => <li key={card.id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => { open(card); setView('全部条目') }}>{card.title || '未命名条目'}</button></li>)}</ul> : <p className='mt-3 text-xs leading-7 text-muted'>条目中标为重要的设定会出现在这里，方便随时回看。</p>}</div>
      </section>}
      {view === '世界首页' && <section className='world-context-overview' aria-label='世界框架与本故事选用'><div><h2 className='text-base font-semibold'>本故事采用的背景</h2><p className='mt-2 text-sm leading-7'>{storyCard?.title || '当前故事'}：{cards.find((entry) => entry.id === storyCard?.payload?.world_context?.world_id)?.title || '尚未选择共享世界'}</p>{startMoment && <p className='text-xs leading-6 text-muted'>故事起点：{startMoment}</p>}{storyCard?.payload?.world_context?.period_id && <p className='text-xs leading-6 text-muted'>时期：{cards.find((entry) => entry.id === storyCard.payload.world_context.period_id)?.title || '已关联世界阶段'}</p>}{storyCard?.payload?.world_context?.region_ids?.length > 0 && <p className='text-xs leading-6 text-muted'>地区：{storyCard.payload.world_context.region_ids.map((id: string) => cards.find((entry) => entry.id === id)?.title || '原地区').join('、')}</p>}{storyCard?.payload?.world_context?.local_adjustments && <p className='text-xs leading-6 text-muted'>本故事差异：{storyCard.payload.world_context.local_adjustments}</p>}<button className='mt-2 text-sm text-brand-600 underline focus-ring' onClick={() => { if (storyCard?.id) onOpenMaterial({ id: storyCard.id, type: 'story' }) }}>到故事策划选用或调整</button></div>{[['主要地区与组织', ['地点', 'place', 'region', '人物与组织', 'organization', 'faction']], ['历史阶段与事件', ['period', 'history', '历史阶段', '历史事件']], ['待完善与核对', []]].map(([label, types]: any) => { const selected = overviewCards.filter((entry) => types.length ? types.includes(entry.payload?.entry_type) : entry.payload?.setting_status === 'unset' || ['new', 'draft'].includes(entry.payload?.creation_status) || entry.payload?.canon_status === 'hypothesis').slice(0, 5); return <div key={label}><h2 className='text-base font-semibold'>{label}</h2>{selected.length ? <ul className='mt-2 space-y-2'>{selected.map((entry) => <li key={entry.id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => { open(entry); setView('全部条目') }}>{entry.title}</button></li>)}</ul> : <p className='mt-2 text-xs leading-6 text-muted'>当前尚未整理，可按需要逐步补充。</p>}</div> })}</section>}
      <nav className='world-category-nav' aria-label='世界资料分类'><button className={`world-category ${!entryTypeFilter ? 'is-current' : ''}`} aria-pressed={!entryTypeFilter} onClick={() => browse('')}>全部</button>{ENTRY_TYPES.map((type) => <button key={type} className={`world-category ${entryTypeFilter === type ? 'is-current' : ''}`} aria-pressed={entryTypeFilter === type} onClick={() => browse(type)}>{type}</button>)}{otherTypes.length > 0 && <div className='world-other-types'><label className='sr-only' htmlFor='world-other-type'>其他世界分类</label><Select id='world-other-type' value={otherTypes.includes(entryTypeFilter) ? entryTypeFilter : ''} onChange={(event) => browse(event.target.value)}><option value=''>其他分类</option>{otherTypes.map((type) => <option key={type} value={type}>{type === '__legacy__' ? '原有设定' : type === 'world' ? '世界简介' : type}</option>)}</Select></div>}</nav>
      <div className='world-workspace-grid'>
        <aside className='world-entry-directory' aria-label='世界条目目录'>
          <details open={directoryOpen} onToggle={(event) => setDirectoryOpen(event.currentTarget.open)}><summary className='world-directory-summary'>{entryTypeFilter === '__legacy__' ? '原有设定' : entryTypeFilter === 'world' ? '世界简介' : entryTypeFilter || '设定目录'}</summary><div className='world-directory-content'>
          <label htmlFor='world-entry-query' className='sr-only'>查找世界条目</label><Input id='world-entry-query' value={query} onChange={(event) => setQuery(event.target.value)} placeholder='查找条目…' />
          <div className='mt-3'><label htmlFor='world-entry-filter' className='sr-only'>筛选世界条目</label><Select id='world-entry-filter' value={view === '世界首页' ? '全部条目' : view} onChange={(event) => setView(event.target.value)}><option value='全部条目'>全部条目</option><option value='待补内容'>待完善</option><option value='核心设定'>重要设定</option><option value='最近更新'>按最近修改排列</option></Select></div>
          <MaterialSearch project={project} worldId={root?.id} onOpen={onOpenMaterial} />
          <div className='mt-4 space-y-1'>{showTree ? tree('', treePool) : filtered.map((card) => <button key={card.id} className={`world-tree-entry ${form?.id === card.id ? 'is-current' : ''}`} onClick={() => open(card)}><span>{card.title || '未命名条目'}</span><small>{entryType(card) === 'world' ? '世界简介' : entryType(card) === '__legacy__' ? '原有设定' : entryType(card)}</small></button>)}{!filtered.length && <p className='py-4 text-xs leading-6 text-muted'>没有符合条件的条目。可以调整筛选，或新建一条已确定的设定。</p>}</div>
          </div></details>
        </aside>
        <div className='world-entry-sheet'>
          {legacyOpen ? <p className='text-sm text-muted'>正在编辑下方原有世界设定。关闭该入口后可继续使用条目编辑，避免同时维护两份表单。</p> : form ? <>
            <div className='world-entry-title-row'><input readOnly={pointerLocked(lockedPaths, '/title')} className='world-entry-title' aria-label='世界条目名称' placeholder='为这条设定命名' value={form.title || ''} onChange={(event) => setFormState({ project, card: { ...form, title: event.target.value } })} /><Button variant='primary' disabled={busy} onClick={save}>{busy ? '保存中…' : '保存条目'}</Button></div>
            {payload.parent_id && <p className='mb-3 text-xs text-muted'>上级条目：<button className='text-brand-600 hover:underline focus-ring' disabled={!cards.some((card) => card.id === payload.parent_id)} onClick={() => { const parent = cards.find((card) => card.id === payload.parent_id); if (parent) open(parent) }}>{cards.find((card) => card.id === payload.parent_id)?.title || '原上级条目暂时不可用'}</button></p>}
            <p className='text-xs leading-6 text-muted'>{payload.setting_status ? `采用情况：${SETTING[payload.setting_status] || '未标注'}。` : '已有作者设定，采用情况未标注。'}{payload.canon_status ? ` 可信程度：${CANON[payload.canon_status] || '未标注'}。` : ''}{payload.creation_status ? ` 编写进度：${CREATION[payload.creation_status] || '未标注'}。` : ''}</p>
            <div className='mt-5 space-y-2'><div className='flex items-center justify-between gap-3'><label htmlFor='world-entry-summary' className='story-field-label'>一句话说明这条设定</label>{aiButton('summary', '设定摘要')}</div><Textarea readOnly={pointerLocked(lockedPaths, '/payload/summary')} id='world-entry-summary' value={payload.summary || ''} onChange={(event) => update('summary', event.target.value)} placeholder='帮助以后回看的自己和 AI 快速理解，不必写成长文。' /></div>
            <NameReferences key={`${project}:${form.id}:names`} project={project} target={`cards/${form.id}.yaml`} field={`/payload/${bodyKey(form)}`} revision={form._revision} dirty={localDraft.dirty} text={payload[bodyKey(form)] || ''} storyId={storyCard?.id} worldContext={{ world_id: formWorldId }} onOpen={onOpenMaterial} onSaved={async () => { try { const saved = await api.get(`/api/projects/${project}/cards/${form.id}`); if (latestProject.current !== project) return; localDraft.markSaved(form, saved); setFormState((current) => current?.project === project && current.card.id === form.id ? { project, card: JSON.stringify(current.card) === JSON.stringify(form) ? saved : { ...current.card, _revision: saved._revision, reference_choices: saved.reference_choices } } : current); void mutate() } catch (cause) { setMessage(cause instanceof Error ? cause.message : '名称关联已保存，请重新读取这份资料的版本。') } }} />
            <details className='mt-5 border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>条目属性与采用情况</summary><div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2'><div><label className='text-xs text-muted' htmlFor='world-author-tags'>分类标签</label><Input id='world-author-tags' readOnly={pointerLocked(lockedPaths, '/tags')} value={(form.tags || []).join('、')} placeholder='自由分类，用逗号或顿号分隔' onChange={(event) => setFormState({ project, card: { ...form, tags: event.target.value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean) } })} /></div><div><label className='text-xs text-muted' htmlFor='world-entry-type'>条目类型（可自定义）</label><Input id='world-entry-type' list='world-entry-types' value={payload.entry_type === 'world' ? '世界简介' : ENTRY_LABELS[payload.entry_type] || payload.entry_type || ''} onChange={(event) => update('entry_type', ['世界简介', '世界首页'].includes(event.target.value) ? 'world' : event.target.value)} /><datalist id='world-entry-types'>{ENTRY_TYPES.map((type) => <option key={type} value={type} />)}</datalist></div><div><label className='text-xs text-muted' htmlFor='world-entry-direction'>归属方向</label><Select id='world-entry-direction' value={payload.direction || ''} onChange={(event) => update('direction', event.target.value)}><option value=''>暂不归类</option>{DIRECTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div><div><label className='text-xs text-muted' htmlFor='world-entry-parent'>上级条目</label><Select id='world-entry-parent' value={payload.parent_id || ''} onChange={(event) => update('parent_id', event.target.value)}><option value=''>无上级条目</option>{cards.filter((card) => !descendants.has(card.id)).map((card) => <option key={card.id} value={card.id}>{card.title || '未命名条目'}</option>)}</Select></div><div><label className='text-xs text-muted' htmlFor='world-entry-introduced'>首次可用 / 揭示章节（可选）</label><Select id='world-entry-introduced' value={payload.introduced_chapter || ''} onChange={(event) => update('introduced_chapter', event.target.value)}><option value=''>暂未标注</option>{payload.introduced_chapter && !chapters.some((chapter) => chapter.chapter_id === payload.introduced_chapter) && <option value={payload.introduced_chapter}>原关联章节（待核对）</option>}{chapters.map((chapter) => <option key={chapter.chapter_id} value={chapter.chapter_id}>{chapter.chapter_title || chapter.title || '未命名章节'}</option>)}</Select><p className='mt-1 text-xs leading-5 text-muted'>未标注的知识边界仍需作者核对，不能自动推断人物此刻知道什么。</p></div>{[['setting_status', '采用情况', SETTING], ['canon_status', '可信程度', CANON], ['creation_status', '编写进度', CREATION]].map(([key, label, options]: any) => <div key={key}><label className='text-xs text-muted' htmlFor={`world-entry-${key}`}>{label}</label><Select id={`world-entry-${key}`} value={payload[key] || ''} onChange={(event) => update(key, event.target.value)}><option value=''>沿用作者原设定，暂未标注</option>{Object.entries(options).map(([value, name]: any) => <option key={value} value={value}>{name}</option>)}</Select></div>)}<label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={Boolean(payload.core)} onChange={(event) => update('core', event.target.checked)} />这是重要设定</label></div></details>
            <AuthorControls key={`${project}:${form.id}:lock`} project={project} target={`cards/${form.id}.yaml`} label='世界条目' value={form} revision={form._revision} dirty={localDraft.dirty} batch onChanged={(value, result) => { const next = { ...value, _revision: result.base_revision }; setFormState({ project, card: next }); localDraft.markSaved(form, next); void mutate() }} />
            <div className='world-entry-body space-y-2'><div className='flex items-center justify-between gap-3'><label className='story-field-label' htmlFor='world-entry-content'>设定正文</label>{aiButton(bodyKey(form), '设定正文')}</div><Textarea readOnly={pointerLocked(lockedPaths, `/payload/${bodyKey(form)}`)} id='world-entry-content' className='min-h-64 leading-8' value={payload[bodyKey(form)] || ''} onChange={(event) => update(bodyKey(form), event.target.value)} placeholder='写下它是什么、如何存在，以及作者已经确定的内容。' /></div>
            <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>边界、原因与后果</summary><div className='mt-4 space-y-4'>{[['boundaries', '什么不能发生，有什么限制或代价'], ['causes', '为什么会这样'], ['consequences', '它会带来什么影响']].map(([key, label]) => <div key={key}><div className='flex items-center justify-between gap-3'><label className='story-field-label' htmlFor={`world-entry-${key}`}>{label}</label>{aiButton(key, label)}</div><Textarea readOnly={pointerLocked(lockedPaths, `/payload/${key}`)} id={`world-entry-${key}`} value={payload[key] || ''} onChange={(event) => update(key, event.target.value)} /></div>)}</div></details>
            {aiError && <div role='alert' className='space-y-2 border-t border-border py-3'><p className='text-sm text-red-700 dark:text-red-300'>{aiError}</p>{onOpenSettings && <Button variant='ghost' className='text-xs' onClick={onOpenSettings}>检查模型设置</Button>}</div>}
            {aiCandidate && <section id='world-ai-candidate' className='space-y-3 border-y border-border py-4' aria-label='世界设定局部候选'><label className='block text-sm font-medium' htmlFor='world-ai-value'>待确认：{aiCandidate.label}</label><Textarea id='world-ai-value' className='min-h-32' value={aiCandidate.value} onChange={(event) => setAICandidate({ ...aiCandidate, value: event.target.value })} /><details><summary className='cursor-pointer text-xs text-muted'>查看原字段内容</summary><p className='mt-2 whitespace-pre-wrap text-sm leading-7 text-muted'>{aiCandidate.original || '这一项原来留空。'}</p></details><TokenUsage usage={aiCandidate.usage} /><WritingReferenceNotice usage={aiCandidate.references} />{JSON.stringify(form) !== aiCandidate.before && <p className='text-xs text-muted'>条目已有新编辑，请重新生成；当前资料保留。</p>}<div className='flex flex-wrap gap-2'><Button variant='primary' disabled={JSON.stringify(form) !== aiCandidate.before || !aiCandidate.value.trim()} onClick={() => { if (JSON.stringify(latest.current) !== aiCandidate.before) { setAIError('条目已有新编辑，旧候选未填入。'); return }; setFormState({ project, card: { ...form, payload: { ...form.payload, [aiCandidate.field]: aiCandidate.value, field_provenance: { ...form.payload?.field_provenance, [aiCandidate.field]: 'ai_addition' } } } }); setAICandidate(null); setMessage('建议已填入当前字段。可以继续修改，保存条目后生效。') }}>确认填入这一项</Button><Button onClick={() => setAICandidate(null)}>保留原文</Button></div></section>}
            {(form.id === root?.id || payload.entry_type === 'world' || Array.isArray(payload.rules) && payload.rules.some((rule: string) => rule.trim())) && <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>世界规则</summary><div className='mt-4 space-y-4'><div><label className='text-sm text-muted' htmlFor='world-root-rules'>核心原则，每行一条</label><Textarea id='world-root-rules' value={(payload.rules || []).join('\n')} onChange={(event) => update('rules', event.target.value.split('\n'))} /></div><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{DIRECTIONS.map(([key, label]) => <div key={key}><label className='text-xs text-muted' htmlFor={`domain-${key}`}>{label}</label><Select id={`domain-${key}`} value={payload.domain_status?.[key] || 'unset'} onChange={(event) => update('domain_status', { ...payload.domain_status, [key]: event.target.value })}>{Object.entries(SETTING).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></div>)}</div></div></details>}
            {worldType(form) && cards.some((card) => card.id === form.id) && <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>世界阶段与认知边界</summary><div className='mt-4'><AuthorStatePanel key={`${project}:${form.id}`} focusRequest={focusRequest?.id === form.id ? focusRequest : null} project={project} entityId={form.id} type='world' /></div></details>}
            {form.id === formWorldId && <FamilyRules key={`${project}:${form.id}:family-rules`} project={project} value={payload.family_rules || []} onChange={rules => update('family_rules', rules)} disabled={pointerLocked(lockedPaths, '/payload/family_rules', true)} />}
            {maps}
            <WorldExtras section='map' key={`${project}:${form.id}:map`} value={payload.extra_context} onChange={(extra) => update('extra_context', extra)} saveLabel='保存条目' />
            <WorldExtras section='general' key={`${project}:${form.id}:general`} value={payload.extra_context} onChange={(extra) => update('extra_context', extra)} saveLabel='保存条目' />
            <div className='border-y border-border py-4'><div className='flex items-center justify-between gap-3'><h3 className='text-sm font-medium'>下级条目</h3><Button className='text-xs' disabled={!cards.some((card) => card.id === form.id)} title={cards.some((card) => card.id === form.id) ? '新建下级条目' : '请先保存当前条目'} onClick={() => create('原创设定', form.id, payload.direction || '')}>新建子项</Button></div><ul className='mt-2 space-y-2'>{cards.filter((card) => card.payload?.parent_id === form.id).map((card) => <li key={card.id}><button className='text-sm text-brand-600 hover:underline focus-ring' onClick={() => open(card)}>{card.title || '未命名条目'}</button></li>)}</ul>{!cards.some((card) => card.payload?.parent_id === form.id) && <p className='mt-2 text-xs text-muted'>还没有下级条目，不需要拆分时可以留空。</p>}</div>
            {cards.some((card) => card.id === form.id) && <CardOperations key={`${project}:${form.id}:organize`} project={project} storyId={storyCard?.id && storyCard.id !== 'story_new' ? storyCard.id : undefined} current={{ id: form.id, label: form.title || '当前条目', content: payload[bodyKey(form)] || payload.summary || '', parent_id: payload.parent_id }} entries={cards.map((card) => ({ id: card.id, label: card.title || '未命名条目', parent_id: card.payload?.parent_id, content: card.payload?.[bodyKey(card)] || card.payload?.summary || '' }))} isDirty={(id) => { const saved = cards.find((card) => card.id === id); const local = draftCache.current[`${project}:${saved?.type || 'world'}:${id}`]; return Boolean(saved && local && JSON.stringify(saved) !== JSON.stringify(local)) }} onApplied={async (result) => { const incoming: any = await mutate(); if (latestProject.current !== project) return; const updated = incoming?.find?.((card: any) => card.id === form.id); if (JSON.stringify(latest.current) === JSON.stringify(form)) { localDraft.markSaved(form, updated || null); if (updated) { draftCache.current[`${project}:${updated.type}:${updated.id}`] = updated; setFormState({ project, card: updated }) } else setFormState(null) }; void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /cards|materials|events|knowledge-graph|material-index/.test(key)); setMessage(result.status === 'applied' ? '整理已采用，各个视图继续引用原身份；原文未自动改写。' : '本次整理已按版本保护撤销。') }} />}
            <MaterialReferences project={project} sourceId={cards.some((card) => card.id === form.id) ? form.id : undefined} value={form.links || []} onChange={(links) => setFormState({ project, card: { ...form, links } })} onOpen={onOpenMaterial} />

            {cards.some((card) => card.id === form.id) && <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>这条设定的局部关系</summary><div className='mt-4'><KnowledgeGraph project={project} focusId={form.id} title='设定与相关资料' onOpen={(node) => onOpenMaterial(node)} /></div></details>}
          </> : <section className='world-empty-sheet'><h2>选择一条设定，继续构建世界</h2><p>打开目录里的已有条目继续编辑，也可以在当前分类新建一条设定。</p><Button onClick={() => create(newType)}>新建{entryTypeFilter && newType === entryTypeFilter ? newType : '一条设定'}</Button></section>}
        </div>
      </div>
    </> : null}
    {message && <p role='status' className='text-sm leading-6 text-muted'>{message}</p>}
    <details className='border-t border-border pt-5' onToggle={(event) => { const expanded = event.currentTarget.open; setLegacyOpen(expanded); if (!expanded && form) { const cached = draftCache.current[`${project}:${form.type}:${form.id}`]; if (cached) setFormState({ project, card: cached }) } }}><summary className='cursor-pointer text-sm text-muted'>编辑原有格式的世界资料</summary>{legacyOpen && <div className='mt-5'>{legacyEditor}</div>}</details>
  </div>
}
