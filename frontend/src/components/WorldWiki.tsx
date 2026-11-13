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
import { WorldExtras } from './WorldExtras'

const DIRECTIONS = [['geography', '地理'], ['biology', '生物'], ['physics_magic', '物理与魔法'], ['metaphysics', '形而上'], ['technology', '科技'], ['culture', '文化']]
const SETTING: Record<string, string> = { unset: '未设置', not_applicable: '不适用', set: '已采用' }
const CANON: Record<string, string> = { canon: '已确定', hypothesis: '推定', inspiration: '灵感' }
const CREATION: Record<string, string> = { new: '待起笔', draft: '草案', complete: '已完善' }
const ENTRY_TYPES = ['地点', '生物与族群', '人物与组织', '规则与能力', '历史事件', '科技', '文化', '原创设定']
const worldType = (card: any) => ['world', 'world_rule', 'lore', 'worldview'].includes(card.type)
const entryType = (card: any) => card.payload?.entry_type || (card.type === 'world_rule' ? '规则与能力' : '__legacy__')
const bodyKey = (card: any) => ['content', 'description', 'rule', 'text', 'setting'].find((key) => typeof card.payload?.[key] === 'string') || 'content'
const timestamp = (card: any) => Date.parse(card.updated_at || card.payload?.updated_at || '') || 0

export function WorldWiki({ project, projectTitle, chapters, draftCache, onOpenMaterial, focusRequest, referenceRequest, legacyEditor, profileId, onOpenSettings, navigationRequest }: {
  project: string; projectTitle: string; draftCache: { current: Record<string, any> }; onOpenMaterial: OpenMaterial;
  chapters: any[];
  focusRequest?: { id: string; requestId: number } | null;
  referenceRequest?: { type: string; cardId: string; referenceId: string; requestId: number } | null;
  legacyEditor: ReactNode;
  profileId?: string; onOpenSettings?: () => void; navigationRequest?: { section: 'overview' | 'places'; requestId: number } | null;
}) {
  const { data, error: readError, mutate } = useSWR(`/api/projects/${project}/cards`, api.get)
  const cards: any[] = (Array.isArray(data) ? data : []).filter(worldType)
  const root = cards.find((card) => card.payload?.entry_type === 'world') || cards.find((card) => card.type === 'world' && !card.payload?.parent_id && !card.payload?.direction) || cards.find((card) => !card.payload?.parent_id && !card.payload?.direction)
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
  if (form) {
    draftCache.current[`${project}:${form.type}:${form.id}`] = form
    if (form.type === 'world') draftCache.current[`${project}:world:selected`] = form.id
  }
  const open = (card: any) => {
    aiRequest.current++; setAIBusy(''); setAIError(''); setAICandidate(null)
    setExtrasRequest(0)
    setFormState({ project, card: draftCache.current[`${project}:${card.type}:${card.id}`] || card })
    setMessage('')
    setLegacyOpen(false)
    if (window.innerWidth < 1050) setDirectoryOpen(false)
  }
  useEffect(() => {
    if (initializedProject.current === project) return
    initializedProject.current = project
    processed.current = ''
    setView('世界首页'); setFormState(null); setMessage(''); setEntryTypeFilter(''); setQuery(''); setLegacyOpen(false)
  }, [project])
  useEffect(() => () => { aiRequest.current++ }, [project])
  useEffect(() => {
    if (!focusRequest || !Array.isArray(data) || processed.current === `focus:${focusRequest.requestId}`) return
    const card = cards.find((row) => row.id === focusRequest.id)
    if (card) { open(card); setView('全部条目'); setEntryTypeFilter(''); setQuery(''); processed.current = `focus:${focusRequest.requestId}` }
  }, [focusRequest, data, project])
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
    if (current?.project !== project) return current
    const next = { ...current.card.payload, [key]: value }
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
  const aiButton = (field: string, label: string) => form?.type === 'world' ? <Button variant='ghost' className='shrink-0 text-xs' aria-label={`AI 生成${label}`} disabled={Boolean(aiBusy)} onClick={() => generateField(field, label)}>{aiBusy === field ? '生成中…' : 'AI 建议'}</Button> : null
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
      localStorage.removeItem(`novix:draft:${draftKey}`)
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
  }).sort((a, b) => view === '最近更新' ? timestamp(b) - timestamp(a) : String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'))
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
  useEffect(() => { if (!navigationRequest || !Array.isArray(data)) return; if (navigationRequest.section === 'places') { open(rootDraft()); setView('全部条目'); setEntryTypeFilter('地点'); setExtrasRequest(navigationRequest.requestId) } else { setView('世界首页'); setEntryTypeFilter(''); setQuery(''); setFormState(null) } }, [navigationRequest?.requestId, Boolean(data)])
  const otherTypes = [...new Set(cards.map(entryType))].filter((type) => !ENTRY_TYPES.includes(type))
  const newType = entryTypeFilter && !['world', '__legacy__'].includes(entryTypeFilter) ? entryTypeFilter : '原创设定'
  const showTree = ['世界首页', '全部条目'].includes(view) && !query && !entryTypeFilter
  return <div className='world-wiki space-y-6'>
    <header className='world-heading'><div><h1>世界资料</h1><p>从一处地方、一条规则开始，慢慢看清人物生活的世界。</p></div><div className='flex flex-wrap gap-2'>{view !== '世界首页' && <Button onClick={() => { setView('世界首页'); setEntryTypeFilter(''); setQuery(''); setFormState(null) }}>世界总览</Button>}<Button onClick={() => { open(rootDraft()); setView('全部条目'); setExtrasRequest(Date.now()) }}>地图与原创设定</Button><Button variant='primary' onClick={() => create(newType)}>新建{entryTypeFilter && newType === entryTypeFilter ? newType : '条目'}</Button></div></header>
    {readError && <div className='space-y-2'><p role='alert' className='text-sm text-muted'>世界资料暂时未能读取，已有草稿仍保留。</p><Button onClick={() => { void mutate().catch(() => undefined) }}>重新读取世界资料</Button></div>}
    {localDraft.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>找到此条目的本地未保存稿。</p><div className='flex gap-2'><Button onClick={localDraft.restore}>恢复草稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留保存版</Button></div></div>}
    <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>导入世界材料：文字、文件、图片或链接</summary><div className='mt-4'><MaterialImportWorkspace project={project} purpose='world' isTargetDirty={(id) => { const saved = cards.find((card) => card.id === id); const local = draftCache.current[`${project}:world:${id}`]; return Boolean(saved && local && JSON.stringify(saved) !== JSON.stringify(local)) }} profileId={profileId} onApplied={() => { void mutate() }} /></div></details>
    {data?.detail ? <p role='alert' className='text-sm text-muted'>世界资料读取失败，请刷新后重试。</p> : !data ? <p role='status' className='text-sm text-muted'>正在读取世界资料…</p> : <>
      {view === '世界首页' && <section className='world-overview' aria-label='世界总览'>
        <div><div className='flex flex-wrap items-baseline justify-between gap-3'><h2>这个世界</h2><button className='text-xs text-brand-600 hover:underline focus-ring' onClick={() => { open(rootDraft()); setView('全部条目') }}>编辑世界简介</button></div><p className='mt-4 whitespace-pre-wrap text-sm leading-8'>{root?.payload?.summary || root?.payload?.[bodyKey(root)] || '还没有写下世界简介。也可以先在下方整理已有的地点、族群与规则。'}</p>{Array.isArray(root?.payload?.rules) && root.payload.rules.some(Boolean) && <ul className='mt-4 space-y-2 text-sm leading-7 text-muted'>{root.payload.rules.filter(Boolean).map((rule: string, index: number) => <li key={index}>{rule}</li>)}</ul>}</div>
        <div className='world-overview-important'><h2>重要设定</h2>{cards.some((card) => card.payload?.core) ? <ul className='mt-3 space-y-3'>{cards.filter((card) => card.payload?.core).slice(0, 5).map((card) => <li key={card.id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => { open(card); setView('全部条目') }}>{card.title || '未命名条目'}</button></li>)}</ul> : <p className='mt-3 text-xs leading-7 text-muted'>条目中标为重要的设定会出现在这里，方便随时回看。</p>}</div>
      </section>}
      <nav className='world-category-nav' aria-label='世界资料分类'><button className={`world-category ${!entryTypeFilter ? 'is-current' : ''}`} aria-pressed={!entryTypeFilter} onClick={() => browse('')}>全部</button>{ENTRY_TYPES.map((type) => <button key={type} className={`world-category ${entryTypeFilter === type ? 'is-current' : ''}`} aria-pressed={entryTypeFilter === type} onClick={() => browse(type)}>{type}</button>)}{otherTypes.length > 0 && <div className='world-other-types'><label className='sr-only' htmlFor='world-other-type'>其他世界分类</label><Select id='world-other-type' value={otherTypes.includes(entryTypeFilter) ? entryTypeFilter : ''} onChange={(event) => browse(event.target.value)}><option value=''>其他分类</option>{otherTypes.map((type) => <option key={type} value={type}>{type === '__legacy__' ? '原有设定' : type === 'world' ? '世界简介' : type}</option>)}</Select></div>}</nav>
      <div className='world-workspace-grid'>
        <aside className='world-entry-directory' aria-label='世界条目目录'>
          <details open={directoryOpen} onToggle={(event) => setDirectoryOpen(event.currentTarget.open)}><summary className='world-directory-summary'>{entryTypeFilter === '__legacy__' ? '原有设定' : entryTypeFilter === 'world' ? '世界简介' : entryTypeFilter || '设定目录'}</summary><div className='world-directory-content'>
          <label htmlFor='world-entry-query' className='sr-only'>查找世界条目</label><Input id='world-entry-query' value={query} onChange={(event) => setQuery(event.target.value)} placeholder='查找条目…' />
          <div className='mt-3'><label htmlFor='world-entry-filter' className='sr-only'>筛选世界条目</label><Select id='world-entry-filter' value={view === '世界首页' ? '全部条目' : view} onChange={(event) => setView(event.target.value)}><option value='全部条目'>全部条目</option><option value='待补内容'>待完善</option><option value='核心设定'>重要设定</option><option value='最近更新'>按最近修改排列</option></Select></div>
          <div className='mt-4 space-y-1'>{showTree ? tree('', treePool) : filtered.map((card) => <button key={card.id} className={`world-tree-entry ${form?.id === card.id ? 'is-current' : ''}`} onClick={() => open(card)}><span>{card.title || '未命名条目'}</span><small>{entryType(card) === 'world' ? '世界简介' : entryType(card) === '__legacy__' ? '原有设定' : entryType(card)}</small></button>)}{!filtered.length && <p className='py-4 text-xs leading-6 text-muted'>没有符合条件的条目。可以调整筛选，或新建一条已确定的设定。</p>}</div>
          </div></details>
        </aside>
        <div className='world-entry-sheet'>
          {legacyOpen ? <p className='text-sm text-muted'>正在编辑下方原有世界设定。关闭该入口后可继续使用条目编辑，避免同时维护两份表单。</p> : form ? <>
            <div className='world-entry-title-row'><input className='world-entry-title' aria-label='世界条目名称' placeholder='为这条设定命名' value={form.title || ''} onChange={(event) => setFormState({ project, card: { ...form, title: event.target.value } })} /><Button variant='primary' disabled={busy} onClick={save}>{busy ? '保存中…' : '保存条目'}</Button></div>
            {payload.parent_id && <p className='mb-3 text-xs text-muted'>上级条目：<button className='text-brand-600 hover:underline focus-ring' disabled={!cards.some((card) => card.id === payload.parent_id)} onClick={() => { const parent = cards.find((card) => card.id === payload.parent_id); if (parent) open(parent) }}>{cards.find((card) => card.id === payload.parent_id)?.title || '原上级条目暂时不可用'}</button></p>}
            <p className='text-xs leading-6 text-muted'>{payload.setting_status ? `采用情况：${SETTING[payload.setting_status] || '未标注'}。` : '已有作者设定，采用情况未标注。'}{payload.canon_status ? ` 可信程度：${CANON[payload.canon_status] || '未标注'}。` : ''}{payload.creation_status ? ` 编写进度：${CREATION[payload.creation_status] || '未标注'}。` : ''}</p>
            <div className='mt-5 space-y-2'><div className='flex items-center justify-between gap-3'><label htmlFor='world-entry-summary' className='story-field-label'>一句话说明这条设定</label>{aiButton('summary', '设定摘要')}</div><Textarea id='world-entry-summary' value={payload.summary || ''} onChange={(event) => update('summary', event.target.value)} placeholder='帮助以后回看的自己和 AI 快速理解，不必写成长文。' /></div>
            <details className='mt-5 border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>条目属性与采用情况</summary><div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2'><div><label className='text-xs text-muted' htmlFor='world-entry-type'>条目类型（可自定义）</label><Input id='world-entry-type' list='world-entry-types' value={payload.entry_type === 'world' ? '世界简介' : payload.entry_type || ''} onChange={(event) => update('entry_type', ['世界简介', '世界首页'].includes(event.target.value) ? 'world' : event.target.value)} /><datalist id='world-entry-types'>{ENTRY_TYPES.map((type) => <option key={type} value={type} />)}</datalist></div><div><label className='text-xs text-muted' htmlFor='world-entry-direction'>归属方向</label><Select id='world-entry-direction' value={payload.direction || ''} onChange={(event) => update('direction', event.target.value)}><option value=''>暂不归类</option>{DIRECTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div><div><label className='text-xs text-muted' htmlFor='world-entry-parent'>上级条目</label><Select id='world-entry-parent' value={payload.parent_id || ''} onChange={(event) => update('parent_id', event.target.value)}><option value=''>无上级条目</option>{cards.filter((card) => !descendants.has(card.id)).map((card) => <option key={card.id} value={card.id}>{card.title || '未命名条目'}</option>)}</Select></div><div><label className='text-xs text-muted' htmlFor='world-entry-introduced'>首次可用 / 揭示章节（可选）</label><Select id='world-entry-introduced' value={payload.introduced_chapter || ''} onChange={(event) => update('introduced_chapter', event.target.value)}><option value=''>暂未标注</option>{payload.introduced_chapter && !chapters.some((chapter) => chapter.chapter_id === payload.introduced_chapter) && <option value={payload.introduced_chapter}>原关联章节（待核对）</option>}{chapters.map((chapter) => <option key={chapter.chapter_id} value={chapter.chapter_id}>{chapter.chapter_title || chapter.title || '未命名章节'}</option>)}</Select><p className='mt-1 text-xs leading-5 text-muted'>未标注的知识边界仍需作者核对，不能自动推断人物此刻知道什么。</p></div>{[['setting_status', '采用情况', SETTING], ['canon_status', '可信程度', CANON], ['creation_status', '编写进度', CREATION]].map(([key, label, options]: any) => <div key={key}><label className='text-xs text-muted' htmlFor={`world-entry-${key}`}>{label}</label><Select id={`world-entry-${key}`} value={payload[key] || ''} onChange={(event) => update(key, event.target.value)}><option value=''>沿用作者原设定，暂未标注</option>{Object.entries(options).map(([value, name]: any) => <option key={value} value={value}>{name}</option>)}</Select></div>)}<label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={Boolean(payload.core)} onChange={(event) => update('core', event.target.checked)} />这是重要设定</label></div></details>
            <div className='world-entry-body space-y-2'><div className='flex items-center justify-between gap-3'><label className='story-field-label' htmlFor='world-entry-content'>设定正文</label>{aiButton(bodyKey(form), '设定正文')}</div><Textarea id='world-entry-content' className='min-h-64 leading-8' value={payload[bodyKey(form)] || ''} onChange={(event) => update(bodyKey(form), event.target.value)} placeholder='写下它是什么、如何存在，以及作者已经确定的内容。' /></div>
            <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>边界、原因与后果</summary><div className='mt-4 space-y-4'>{[['boundaries', '什么不能发生，有什么限制或代价'], ['causes', '为什么会这样'], ['consequences', '它会带来什么影响']].map(([key, label]) => <div key={key}><div className='flex items-center justify-between gap-3'><label className='story-field-label' htmlFor={`world-entry-${key}`}>{label}</label>{aiButton(key, label)}</div><Textarea id={`world-entry-${key}`} value={payload[key] || ''} onChange={(event) => update(key, event.target.value)} /></div>)}</div></details>
            {aiError && <div role='alert' className='space-y-2 border-t border-border py-3'><p className='text-sm text-red-700 dark:text-red-300'>{aiError}</p>{onOpenSettings && <Button variant='ghost' className='text-xs' onClick={onOpenSettings}>检查模型设置</Button>}</div>}
            {aiCandidate && <section id='world-ai-candidate' className='space-y-3 border-y border-border py-4' aria-label='世界设定局部候选'><label className='block text-sm font-medium' htmlFor='world-ai-value'>待确认：{aiCandidate.label}</label><Textarea id='world-ai-value' className='min-h-32' value={aiCandidate.value} onChange={(event) => setAICandidate({ ...aiCandidate, value: event.target.value })} /><details><summary className='cursor-pointer text-xs text-muted'>查看原字段内容</summary><p className='mt-2 whitespace-pre-wrap text-sm leading-7 text-muted'>{aiCandidate.original || '这一项原来留空。'}</p></details><TokenUsage usage={aiCandidate.usage} /><WritingReferenceNotice usage={aiCandidate.references} />{JSON.stringify(form) !== aiCandidate.before && <p className='text-xs text-muted'>条目已有新编辑，请重新生成；当前资料保留。</p>}<div className='flex flex-wrap gap-2'><Button variant='primary' disabled={JSON.stringify(form) !== aiCandidate.before || !aiCandidate.value.trim()} onClick={() => { if (JSON.stringify(latest.current) !== aiCandidate.before) { setAIError('条目已有新编辑，旧候选未填入。'); return }; update(aiCandidate.field, aiCandidate.value); setAICandidate(null); setMessage('建议已填入当前字段。可以继续修改，保存条目后生效。') }}>确认填入这一项</Button><Button onClick={() => setAICandidate(null)}>保留原文</Button></div></section>}
            {(form.id === root?.id || payload.entry_type === 'world') && <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>世界简介的原则与构思方向（可选）</summary><div className='mt-4 space-y-4'><div><label className='text-sm text-muted' htmlFor='world-root-rules'>核心原则，每行一条</label><Textarea id='world-root-rules' value={(payload.rules || []).join('\n')} onChange={(event) => update('rules', event.target.value.split('\n'))} /></div><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{DIRECTIONS.map(([key, label]) => <div key={key}><label className='text-xs text-muted' htmlFor={`domain-${key}`}>{label}</label><Select id={`domain-${key}`} value={payload.domain_status?.[key] || 'unset'} onChange={(event) => update('domain_status', { ...payload.domain_status, [key]: event.target.value })}>{Object.entries(SETTING).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></div>)}</div></div></details>}
            {form.type === 'world' && cards.some((card) => card.id === form.id) && <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>世界阶段与认知边界</summary><div className='mt-4'><AuthorStatePanel key={`${project}:${form.id}`} project={project} entityId={form.id} type='world' /></div></details>}
            <WorldExtras key={`${project}:${form.id}`} value={payload.extra_context} onChange={(extra) => update('extra_context', extra)} openRequest={extrasRequest} saveLabel='保存条目' />
            <div className='border-y border-border py-4'><div className='flex items-center justify-between gap-3'><h3 className='text-sm font-medium'>下级条目</h3><Button className='text-xs' disabled={!cards.some((card) => card.id === form.id)} title={cards.some((card) => card.id === form.id) ? '新建下级条目' : '请先保存当前条目'} onClick={() => create('原创设定', form.id, payload.direction || '')}>新建子项</Button></div><ul className='mt-2 space-y-2'>{cards.filter((card) => card.payload?.parent_id === form.id).map((card) => <li key={card.id}><button className='text-sm text-brand-600 hover:underline focus-ring' onClick={() => open(card)}>{card.title || '未命名条目'}</button></li>)}</ul>{!cards.some((card) => card.payload?.parent_id === form.id) && <p className='mt-2 text-xs text-muted'>还没有下级条目，不需要拆分时可以留空。</p>}</div>
            <MaterialReferences project={project} sourceId={cards.some((card) => card.id === form.id) ? form.id : undefined} value={form.links || []} onChange={(links) => setFormState({ project, card: { ...form, links } })} onOpen={onOpenMaterial} />
            <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>既有写作参考（兼容）</summary><div className='mt-3'><WritingReferencePicker project={project} value={payload.writing_references || []} onChange={(ids) => update('writing_references', ids)} /></div></details>
            {cards.some((card) => card.id === form.id) && <details className='border-t border-border py-4'><summary className='cursor-pointer text-sm font-medium'>这条设定的局部关系</summary><div className='mt-4'><KnowledgeGraph project={project} focusId={form.id} title='设定与相关资料' onOpen={(node) => onOpenMaterial(node)} /></div></details>}
          </> : <section className='world-empty-sheet'><h2>选择一条设定，继续构建世界</h2><p>打开目录里的已有条目继续编辑，也可以在当前分类新建一条设定。</p><Button onClick={() => create(newType)}>新建{entryTypeFilter && newType === entryTypeFilter ? newType : '一条设定'}</Button></section>}
        </div>
      </div>
    </>}
    {message && <p role='status' className='text-sm leading-6 text-muted'>{message}</p>}
    <details className='border-t border-border pt-5' onToggle={(event) => { const expanded = event.currentTarget.open; setLegacyOpen(expanded); if (!expanded && form) { const cached = draftCache.current[`${project}:${form.type}:${form.id}`]; if (cached) setFormState({ project, card: cached }) } }}><summary className='cursor-pointer text-sm text-muted'>编辑原有格式的世界资料</summary>{legacyOpen && <div className='mt-5'>{legacyEditor}</div>}</details>
  </div>
}
