import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Select } from './ui/Fields'

type Node = { id: string; label: string; chapter: string; quote: string; offset: number; basis: string; kind?: string; thread_ids: string[]; before?: string; after?: string }
type Edge = { from: string; to: string; basis: string }
type Chapter = { id: string; title: string; act: string; status: string; notice: string }
type Graph = { chapters: Chapter[]; nodes: Node[]; edges: Edge[]; threads: Record<string, string> }
type Scope = '全书' | '本幕' | '本章'

export function NarrativePacing({ project, story, draftCache }: { project: string; story: string; draftCache: { current: Record<string, any> } }) {
  const cacheKey = `pacing:${project}:${story}`
  const savedDraft = draftCache.current[cacheKey]
  const { data, error, mutate } = useSWR<Graph>(`/api/projects/${project}/pacing/${story}`, api.get, { refreshInterval: 4000 })
  const [scope, setScope] = useState<Scope>('全书')
  const [chapterId, setChapter] = useState(savedDraft?.chapterId || '')
  const [nodeId, setNode] = useState('')
  const [thread, setThread] = useState('')
  const [act, setAct] = useState('')
  const [page, setPage] = useState(0)
  const [showGraph, setShowGraph] = useState(true)
  const [editing, setEditing] = useState(Boolean(savedDraft?.editing))
  const [draft, setDraft] = useState(savedDraft?.draft || '')
  const [revision, setRevision] = useState(savedDraft?.revision || '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { draftCache.current[cacheKey] = { chapterId, draft, revision, editing } }, [cacheKey, chapterId, draft, revision, editing, draftCache])
  useEffect(() => {
    if (!editing) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [editing])
  const textRef = useRef<HTMLTextAreaElement>(null)
  const quoteRef = useRef<HTMLElement>(null)
  const lastSelected = useRef<Node | undefined>()
  const currentNode = data?.nodes.find(n => n.id === nodeId)
  if (currentNode) lastSelected.current = currentNode
  const selected = currentNode || (lastSelected.current?.id === nodeId ? lastSelected.current : undefined)
  const chapter = selected && !selected.chapter ? undefined : data?.chapters.find(c => c.id === chapterId) || (!editing ? data?.chapters[0] : undefined)
  const { data: manuscript, mutate: refreshText } = useSWR<{ content: string }>(chapter ? `/api/projects/${project}/drafts/${chapter.id}` : null, api.get, { refreshInterval: editing ? 0 : 4000 })
  const [columns, setColumns] = useState(3)
  const mapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = mapRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => setColumns(entries[0].contentRect.width < 520 ? 1 : 3))
    observer.observe(element)
    return () => observer.disconnect()
  }, [data, showGraph])
  const visible = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[], count: 0 }
    const chapters = scope === '本章' ? data.chapters.filter(c => c.id === chapter?.id)
      : scope === '本幕' ? data.chapters.filter(c => c.act === act) : data.chapters
    const ids = new Set(chapters.map(c => c.id))
    const source = data.nodes.filter(n => (!n.chapter && scope === '全书' || ids.has(n.chapter)) && (!thread || n.thread_ids.includes(thread)))
    const nodes: Node[] = scope === '本章' ? source : chapters.map(c => ({
      id: c.id, label: source.find(n => n.chapter === c.id)?.label || c.title,
      chapter: c.id, quote: '', offset: 0, basis: 'chapter', thread_ids: [],
    })).filter(c => !thread || source.some(n => n.chapter === c.id))
    if (scope === '全书') nodes.push(...source.filter(n => !n.chapter))
    const mapped = (id: string) => scope === '本章' ? id : data.nodes.find(n => n.id === id)?.chapter || id
    const edges = data.edges.map(e => ({ ...e, from: mapped(e.from), to: mapped(e.to) }))
      .filter((e, i, all) => e.from !== e.to && all.findIndex(v => v.from === e.from && v.to === e.to && v.basis === e.basis) === i)
    const start = page * 12
    return { nodes: nodes.slice(start, start + 12), edges, count: nodes.length }
  }, [data, scope, chapter?.id, thread, act, page])
  useEffect(() => { setPage(0) }, [scope, chapter?.id, act, thread])
  useEffect(() => { if (!editing) quoteRef.current?.scrollIntoView({ block: 'nearest' }) }, [nodeId, editing])

  function pick(node: Node) {
    if (editing) { setNotice('请先保存或取消当前正文修改。'); return }
    if (node.chapter) setChapter(node.chapter)
    setNode(node.basis === 'chapter' ? data?.nodes.find(n => n.chapter === node.chapter && (!thread || n.thread_ids.includes(thread)))?.id || '' : node.id)
    if (node.basis === 'chapter') setScope('本章')
  }
  async function edit() {
    if (!chapter) return
    setBusy(true)
    try {
      const saved = await api.get(`/api/projects/${project}/drafts/${chapter.id}`)
      setChapter(chapter.id); setRevision(saved.revision); setDraft(saved.content); setEditing(true); setNotice('')
      requestAnimationFrame(() => {
        textRef.current?.focus()
        if (selected?.quote && Array.from(saved.content).slice(selected.offset, selected.offset + Array.from(selected.quote).length).join('') === selected.quote) {
          const start = Array.from(saved.content).slice(0, selected.offset).join('').length
          textRef.current?.setSelectionRange(start, start + selected.quote.length)
        }
      })
    } catch (cause) { setNotice(String(cause)) } finally { setBusy(false) }
  }
  async function save() {
    if (!chapter) return
    setBusy(true)
    try {
      await api.put(`/api/projects/${project}/drafts/${chapter.id}`, { content: draft, base_revision: revision })
      setEditing(false); setNotice('正文已保存，后台正在更新线路。'); await mutate(); await refreshText()
    } catch (cause) { setNotice(String(cause)) } finally { setBusy(false) }
  }
  const point = (id: string) => {
    const i = visible.nodes.findIndex(n => n.id === id)
    return i < 0 ? null : { x: (i % columns) * (600 / columns) + 300 / columns, y: Math.floor(i / columns) * 110 + 35 }
  }
  const text = manuscript?.content || ''
  // Backend offsets count Unicode code points. Browser selection counts UTF-16 units.
  const raw = Array.from(text)
  const valid = selected?.chapter === chapter?.id && selected?.quote && raw.slice(selected.offset, selected.offset + Array.from(selected.quote).length).join('') === selected.quote
  const before = valid && selected ? raw.slice(0, selected.offset).join('') : ''
  const after = valid && selected ? raw.slice(selected.offset + Array.from(selected.quote).length).join('') : ''

  if (error) return <p role='status'>线路读取失败。<Button onClick={() => mutate()}>重试</Button></p>
  if (!data) return <p role='status'>正在读取故事线路…</p>
  return <section aria-label='叙事节奏' className='space-y-4 py-4'>
    <div className='flex flex-wrap items-center gap-2'>
      {(['全书', '本幕', '本章'] as Scope[]).map(value => <Button key={value} disabled={editing} aria-pressed={scope === value} onClick={() => { setScope(value); if (value === '本幕') setAct(chapter?.act || '') }}>{value}</Button>)}
      <Select aria-label='查看故事线' value={thread} onChange={e => setThread(e.target.value)}><option value=''>全部线路</option>{Object.entries(data.threads).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
      {scope === '本幕' && <Select aria-label='选择幕' value={act} onChange={e => setAct(e.target.value)}>{['', '第一幕', '第二幕', '第三幕'].map(a => <option key={a} value={a}>{a || '未分幕'}</option>)}</Select>}
      <Button variant='ghost' onClick={() => setShowGraph(v => !v)}>{showGraph ? '收起线路' : '展开线路'}</Button>
    </div>
    {showGraph && <div>
      <div className='overflow-x-auto'>
        <div ref={mapRef} className='relative w-full' style={{ height: Math.max(90, Math.ceil(visible.nodes.length / columns) * 110) }}>
          <svg aria-label='线路关系' className='absolute inset-0 h-full w-full' viewBox={`0 0 600 ${Math.max(90, Math.ceil(visible.nodes.length / columns) * 110)}`} preserveAspectRatio='none'>
            <defs><marker id='pacing-arrow' viewBox='0 0 8 8' refX='7' refY='4' markerWidth='6' markerHeight='6' orient='auto'><path d='M0 0 L8 4 L0 8' fill='currentColor' /></marker></defs>
            {visible.edges.map((edge, i) => {
              const a = point(edge.from), b = point(edge.to)
              if (!a || !b) return null
              const sameRow = a.y === b.y
              const direction = b.x > a.x ? 1 : -1
              const path = sameRow ? `M${a.x + direction * 72} ${a.y} L${b.x - direction * 74} ${b.y}` : `M${a.x} ${a.y + 23} C${a.x} ${a.y + 60},${b.x} ${b.y - 60},${b.x} ${b.y - 24}`
              return <path key={i} d={path} fill='none' stroke='currentColor' opacity='.45' strokeDasharray={edge.basis === 'candidate' ? '4 4' : undefined} markerEnd='url(#pacing-arrow)' />
            })}
          </svg>
          {visible.nodes.map((node, i) => <button key={node.id} className={`absolute -translate-x-1/2 rounded-lg border bg-panel px-3 py-2 text-left text-sm ${node.id === nodeId || node.basis === 'chapter' && node.chapter === chapter?.id ? 'border-brand-600' : 'border-border'}`} style={{ width: columns === 1 ? '76%' : '25%', left: `${(i % columns) * 100 / columns + 50 / columns}%`, top: Math.floor(i / columns) * 110 + 10 }} onClick={() => pick(node)}>
            <span className='block text-xs text-muted'>{data.chapters.find(c => c.id === node.chapter)?.title || '未分章'}{node.basis === 'planned' ? ' · 计划' : ''}</span><span className='line-clamp-2' title={node.label}>{node.label}</span>
          </button>)}
        </div>
      </div>
      {!visible.nodes.length && <p className='text-sm text-muted'>这里暂无线索节点。正文保存后由后台自动拆解。</p>}
      <div className='flex items-center gap-3 text-xs text-muted'><span>实线 · 作者因果　虚线 · 待核对承接</span>{visible.count > 12 && <><Button disabled={!page} onClick={() => setPage(p => p - 1)}>上一段</Button><span>{page + 1} / {Math.ceil(visible.count / 12)}</span><Button disabled={(page + 1) * 12 >= visible.count} onClick={() => setPage(p => p + 1)}>下一段</Button></>}</div>
    </div>}
    <div className='flex flex-wrap items-center gap-3 border-t border-border pt-4'>
      <Select aria-label='当前章节' disabled={editing} value={chapter?.id || ''} onChange={e => { setChapter(e.target.value); setNode('') }}>{data.chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
      {chapter && <Select aria-label='章节归属幕' disabled={editing} value={chapter.act} onChange={async e => { try { await api.put(`/api/projects/${project}/pacing/${story}/chapters/${chapter.id}/act`, { act: e.target.value }); await mutate() } catch (cause) { setNotice(String(cause)) } }}>{['', '第一幕', '第二幕', '第三幕'].map(a => <option key={a} value={a}>{a || '未分幕'}</option>)}</Select>}
      {chapter && !editing && <Button disabled={busy} onClick={edit}>编辑本章</Button>}
      {editing && <><Button disabled={busy} onClick={save}>保存正文</Button><Button disabled={busy} onClick={() => setEditing(false)}>取消</Button></>}
    </div>
    {notice && <p role='status' className='text-sm'>{notice}</p>}
    {selected?.basis === 'planned' && <p className='text-sm text-muted'>计划 · {selected.label}{!selected.chapter ? ' · 尚未分章' : ' · 正文待核对'}</p>}
    {chapter && chapter.status !== 'ready' && <p role='status' className='text-xs text-muted'>{chapter.notice || '正文拆解中，可继续写作。'}</p>}
    {selected?.before && <p className='text-sm'>{selected.before} → {selected.after || '待核对'}</p>}
    {editing ? <textarea ref={textRef} aria-label='本章正文' className='w-full rounded-lg border border-border bg-panel p-3 min-h-72' value={draft} onChange={e => setDraft(e.target.value)} />
      : <div className='max-w-prose whitespace-pre-wrap text-base leading-8'>{valid && selected ? <>{before}<mark ref={quoteRef} className='bg-brand-600/15 text-inherit'>{selected.quote}</mark>{after}</> : text || (chapter ? '本章还没有正文。' : '暂无章节，可先在故事表安排场景。')}</div>}
    {selected?.quote && !valid && <p className='text-xs text-muted'>原引句待核对 · {selected.quote}</p>}
    {selected && data.edges.filter(e => e.to === selected.id).map(edge => {
      const from = data.nodes.find(n => n.id === edge.from)
      return from?.quote ? <details key={edge.from} className='border-t border-border py-2'><summary className='text-sm'>跨章对照 · {edge.basis === 'candidate' ? '待核对承接' : '已关联前因'}</summary><p>{data.chapters.find(c => c.id === from.chapter)?.title} · {from.quote}</p><p>{chapter?.title} · {selected.quote}</p><Button disabled={editing} onClick={() => pick(from)}>查看前文</Button></details> : null
    })}
  </section>
}
