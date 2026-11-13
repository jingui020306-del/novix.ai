import { useEffect, useId, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Select } from './ui/Fields'

const TYPES: Record<string, string> = { information: '关键信息', relationship: '共享关系', scene: '场景', beat: '节拍', character_intersection: '角色交集', character_storyline: '人物故事线', character_arc: '成长安排', character: '人物', world: '世界', style: '文风', chapter: '章节', fact: '事实', foreshadowing: '伏笔', story: '故事', technique: '技法', tool_skill: '写作工具', world_rule: '世界规则', lore: '背景设定', chapter_plan: '章节计划', open_line: '明线', hidden_line: '暗线', foreshadowings: '伏笔', outline: '大纲' }

export function KnowledgeGraph({ project, chapterId, onOpen, focusId, title = '人物与情节关系', showStages = false, defaultLayer = 'relationships' }: { project: string; chapterId?: string; onOpen: (node: any) => void; focusId?: string; title?: string; showStages?: boolean; defaultLayer?: 'relationships' | 'events' | 'all' }) {
  const [layer, setLayer] = useState(defaultLayer)
  const [layout, setLayout] = useState<Record<string, { x: number; y: number }>>({})
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const skipOpen = useRef(false)
  useEffect(() => { try { setLayout(JSON.parse(localStorage.getItem(`novix:graph-layout:${project}`) || '{}')) } catch { setLayout({}) } }, [project])
  useEffect(() => { const timer = window.setTimeout(() => { try { localStorage.setItem(`novix:graph-layout:${project}`, JSON.stringify(layout)) } catch {} }, 250); return () => window.clearTimeout(timer) }, [project, layout])
  const [eventRef, setEventRef] = useState('')
  const [stage, setStage] = useState('after')
  const [kind, setKind] = useState('all')
  const [selectedEdge, setSelectedEdge] = useState('')
  const query = new URLSearchParams()
  if (chapterId) query.set('chapter_id', chapterId)
  if (eventRef) { query.set('event_ref', eventRef); query.set('stage', stage) }
  const { data: fullGraph } = useSWR(showStages ? `/api/projects/${project}/knowledge-graph` : null, api.get)
  const { data, error, mutate } = useSWR(`/api/projects/${project}/knowledge-graph${query.size ? `?${query}` : ''}`, api.get)
  const [selected, setSelected] = useState('')
  const graphId = useId().replace(/:/g, '')
  useEffect(() => { setSelected(focusId || ''); setSelectedEdge(''); setEventRef(''); setKind('all'); setStage('after') }, [focusId, project])
  const rawNodes: any[] = Array.isArray(data?.nodes) ? data.nodes : []
  const rawEdges: any[] = Array.isArray(data?.edges) ? data.edges : []
  const relationEdge = (edge: any) => edge.layer === 'relationships' || edge.owner_path?.includes('relationships') || edge.owner_path?.includes('relationship_changes') || rawNodes.some((node) => node.type === 'relationship' && [edge.source, edge.target].includes(node.id))
  const edges = layer === 'all' ? rawEdges : layer === 'events' ? rawEdges.filter((edge) => ['承接前因', '事件先后'].includes(edge.label)) : rawEdges.filter(relationEdge)
  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  const nodes = rawNodes.filter((node) => layer === 'all' || node.id === focusId || nodeIds.has(node.id) || (layer === 'events' ? node.type === 'scene' && node.id.includes(':important_scenes:') : ['character', 'relationship'].includes(node.type)))
  const allNodes = Array.isArray(fullGraph?.nodes) ? fullGraph.nodes : nodes
  const options = nodes.filter((node: any) => kind === 'all' || node.type === kind)
  const focus = nodes.find((node: any) => node.id === selected) || nodes.find((node: any) => node.id === focusId) || nodes[0]
  const edgeId = (edge: any) => edge.id || `${edge.source}:${edge.target}:${edge.label}`
  const currentEdge = edges.find((edge: any) => edgeId(edge) === selectedEdge)
  const adjacent = focus ? edges.filter((edge: any) => edge.source === focus.id || edge.target === focus.id) : []
  const related = new Set(adjacent.flatMap((edge: any) => [edge.source, edge.target]))
  const visible = (currentEdge ? [nodes.find((node: any) => node.id === currentEdge.source), nodes.find((node: any) => node.id === currentEdge.target)] : [focus, ...nodes.filter((node: any) => node.id !== focus?.id && (layer === 'events' || related.has(node.id)))]).filter(Boolean).slice(0, 13)
  const positions = new Map(visible.map((node: any, index: number) => [node.id, !currentEdge && layout[node.id] ? layout[node.id] : currentEdge ? { x: index ? 440 : 160, y: 210 } : index === 0 ? { x: 300, y: 210 } : { x: 300 + 220 * Math.cos(2 * Math.PI * (index - 1) / Math.max(1, visible.length - 1)), y: 210 + 150 * Math.sin(2 * Math.PI * (index - 1) / Math.max(1, visible.length - 1)) }]))
  const name = (id: string) => allNodes.find((node: any) => node.id === id)?.label || '关联资料'
  const eventSource = (node: any) => {
    const owner = allNodes.find((item: any) => item.id === (node.owner_card_id || node.id.split(':')[0]))
    const kind = owner?.type === 'story' ? '故事策划' : owner?.type === 'outline' ? '情节工作表' : '原事件来源'
    return `${kind}${owner?.label ? `：${owner.label}` : ''}`
  }
  const duplicateRows = rawNodes.flatMap((node: any) => (node.duplicate_conflicts || []).map((conflict: any) => ({ node, conflict }))).filter((row: any, index: number, rows: any[]) => rows.findIndex((item: any) => [item.node.id, item.conflict.event_id || item.conflict.message].sort().join('|') === [row.node.id, row.conflict.event_id || row.conflict.message].sort().join('|')) === index)
  const editRelation = (edge: any) => {
    if (!edge.owner_card_id || !Array.isArray(edge.owner_path)) return
    onOpen({ id: edge.owner_card_id, editPath: edge.owner_path })
  }
  const moveNode = (event: any, id: string) => {
    if (drag.current?.id !== id || currentEdge) return
    const svg = event.currentTarget.ownerSVGElement as SVGSVGElement
    const rect = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) < 5 && !drag.current.moved) return
    drag.current.moved = true
    setLayout((current) => ({ ...current, [id]: { x: Math.max(35, Math.min(565, view.x + (event.clientX - rect.left) / rect.width * view.width)), y: Math.max(35, Math.min(370, view.y + (event.clientY - rect.top) / rect.height * view.height)) } }))
  }
  return <section className='space-y-3' aria-label='人物与情节关系'>
    <div className='flex items-center justify-between gap-2'><h3 className='font-semibold'>{title}</h3><Button className='text-xs' onClick={() => mutate()}>更新关系</Button></div>
    <div><label htmlFor={`${graphId}-layer`} className='mb-1 block text-xs text-muted'>图层</label><Select id={`${graphId}-layer`} value={layer} onChange={(e) => { setLayer(e.target.value as typeof layer); setKind('all'); setSelectedEdge(''); setSelected('') }}><option value='relationships'>人物联系与共享关系</option><option value='events'>事件与前因</option><option value='all'>全部资料与引用图层</option></Select></div>
    {rawNodes.length > 0 && <div className='graph-controls-grid'>
      <div><label htmlFor={`${graphId}-type`} className='mb-1 block text-xs text-muted'>资料类型</label><Select id={`${graphId}-type`} value={kind} onChange={(e) => { setKind(e.target.value); setSelectedEdge(''); setSelected('') }}><option value='all'>全部类型</option>{[...new Set<string>(nodes.map((node: any) => node.type))].map((type) => <option key={type} value={type}>{TYPES[type] || '资料'}</option>)}</Select></div>
      <div><label htmlFor={`${graphId}-focus`} className='mb-1 block text-sm text-muted'>查看谁的关系</label>
      <Select id={`${graphId}-focus`} value={focus?.id || ''} onChange={(e) => { setSelected(e.target.value); setSelectedEdge('') }}>
        {options.map((node: any) => <option key={node.id} value={node.id}>{node.label || '未命名资料'}（{TYPES[node.type] || '资料'}{node.type === 'scene' && rawNodes.some((other: any) => other.id !== node.id && other.label === node.label && other.type === 'scene') ? `，${eventSource(node)}` : ''}）</option>)}
      </Select></div>
      {showStages && <div><label htmlFor={`${graphId}-event`} className='mb-1 block text-xs text-muted'>关系阶段（按事件查看）</label><Select id={`${graphId}-event`} value={eventRef} onChange={(e) => { setEventRef(e.target.value); setSelectedEdge('') }}><option value=''>全书关系与全部阶段</option>{allNodes.filter((node: any) => node.type === 'scene' && node.id.includes(':important_scenes:')).map((node: any) => <option key={node.id} value={node.id}>{node.label || '未命名事件'}（{eventSource(node)}）</option>)}</Select>{eventRef && <div className='mt-3'><label htmlFor={`${graphId}-stage`} className='mb-1 block text-xs text-muted'>观察时点</label><Select id={`${graphId}-stage`} value={stage} onChange={(e) => { setStage(e.target.value); setSelectedEdge('') }}><option value='before'>这件事发生之前</option><option value='after'>这件事发生之后（作者安排）</option></Select><p className='mt-2 text-xs leading-6 text-muted'>按事件先后查看作者计划，不以章节位置推断人物知情；不代表正文已发生。</p></div>}</div>}
    </div>}
    {data?.event_stage && <p className='text-xs leading-6 text-muted'>正在查看“{data.event_stage.label}”发生{stage === 'before' ? '前' : '后'}的作者安排。尚未按事件锚定的资料仍保留未知，不替人物推断知情。</p>}
    <p className='text-xs text-muted'>点击节点打开原资料；拖动只整理本机布局。</p>
{duplicateRows.length > 0 && <details><summary className='cursor-pointer text-xs text-muted'>同名或重复来源需核对（{duplicateRows.length} 项）</summary><p className='mt-2 text-xs leading-6 text-muted'>原记录均保留。只有确认是同一事件时，才在工作表选择原来源。</p><ul className='mt-3 space-y-3'>{duplicateRows.map(({ node, conflict }: any, index: number) => { const other = rawNodes.find((item: any) => item.id === conflict.event_id); return <li key={index} className='text-xs leading-6'><button className='text-left text-brand-600 underline focus-ring' onClick={() => onOpen(node)}>{node.label || '原事件'}（{eventSource(node)}）</button>{other && <><span className='mx-2'>与</span><button className='text-left text-brand-600 underline focus-ring' onClick={() => onOpen(other)}>{other.label || '另一事件'}（{eventSource(other)}）</button></>}<p className='mt-1 text-muted'>{conflict.message || '来源身份尚未确认，请打开原记录核对。'}</p></li> })}</ul></details>}
    {error ? <p role='alert' className='text-sm text-muted'>关系暂时无法读取，可点击更新关系重试；不影响继续写作。</p> : data?.detail ? <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{typeof data.detail === 'string' ? data.detail : '关系暂时无法读取，请重试。'}</p> : !data ? <p className='text-sm text-muted'>正在整理关系…</p> : !nodes.length ? <p className='text-sm text-muted'>保存人物、故事和章节后，这里会显示它们的联系。</p> : <>
      {nodes.length > 13 && <p className='text-xs text-muted'>图中展示当前局部，其他资料可通过上方名称选择查看；没有删除或合并同名资料。</p>}

      <div className='overflow-x-auto rounded-ui border border-border bg-surface'>
        <svg viewBox={currentEdge ? '0 145 600 160' : '0 0 600 420'} className='w-full min-w-[400px]' role='img' aria-label='当前资料的关系图'>
          <defs><marker id={`${graphId}-arrow`} viewBox='0 0 10 10' refX='64' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'><path d='M 0 0 L 10 5 L 0 10 z' fill='currentColor' /></marker></defs>
          {(currentEdge ? [currentEdge] : adjacent).map((edge: any) => {
            const a = positions.get(edge.source), b = positions.get(edge.target)
            if (!a || !b) return null
            const parallel = currentEdge ? [edge] : adjacent.filter((item: any) => item.source === edge.source && item.target === edge.target || item.source === edge.target && item.target === edge.source)
            const lane = parallel.findIndex((item: any) => edgeId(item) === edgeId(edge)) - (parallel.length - 1) / 2
            const orientation = edge.source < edge.target ? 1 : -1
            const bend = lane * 44 * orientation
            const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
            const control = { x: (a.x + b.x) / 2 - (b.y - a.y) / length * bend, y: (a.y + b.y) / 2 + (b.x - a.x) / length * bend }
            const path = `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`
            const label = String(edge.label || '相关')
            const labelY = (a.y + 2 * control.y + b.y) / 4 - 5 + lane * 18 * (1 - Math.abs(b.x - a.x) / length) * ((b.x - a.x) * orientation < 0 ? -1 : 1)
            return <g key={edgeId(edge)} role='button' tabIndex={0} aria-label={`查看关系：${name(edge.source)}对${name(edge.target)}，${label}`} className='graph-node cursor-pointer text-muted' onClick={() => setSelectedEdge(edgeId(edge))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEdge(edgeId(edge)) } }}><title>{label}</title><path d={path} fill='none' stroke='transparent' strokeWidth='18' /><path d={path} fill='none' stroke='currentColor' strokeWidth='1' markerEnd={`url(#${graphId}-arrow)`} /><text x={(a.x + 2 * control.x + b.x) / 4} y={labelY} textAnchor='middle' fill='currentColor' fontSize='11'>{currentEdge || label.length <= 14 ? label : `${label.slice(0, 14)}…`}</text></g>
          })}
          {visible.map((node: any) => { const point = positions.get(node.id)!; return <g key={node.id} role='button' tabIndex={0} aria-label={`查看${node.label}`} className='graph-node cursor-pointer text-text' onPointerDown={(e) => { if (currentEdge) return; drag.current = { id: node.id, x: e.clientX, y: e.clientY, moved: false }; e.currentTarget.setPointerCapture(e.pointerId) }} onPointerMove={(e) => moveNode(e, node.id)} onPointerUp={() => { skipOpen.current = Boolean(drag.current?.moved); drag.current = null }} onClick={() => { if (skipOpen.current) { skipOpen.current = false; return }; onOpen(node) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(node) } }}>
            <circle cx={point.x} cy={point.y} r={node.id === focus?.id ? 31 : 25} className={node.id === focus?.id ? 'fill-surface-2 stroke-brand-500' : 'fill-panel stroke-border'} strokeWidth='1.5' />
            <text x={point.x} y={point.y + 4} textAnchor='middle' fill='currentColor' fontSize='12'>{String(node.label || '资料').slice(0, 7)}</text>
            <text x={point.x} y={point.y + 46} textAnchor='middle' fill='currentColor' fontSize='11'>{TYPES[node.type] || '资料'}</text>
          </g> })}
        </svg>
      </div>
      {currentEdge && <section className='space-y-3 border-y border-border py-4' aria-label='同一份关系与事件阶段'><h4 className='text-sm font-semibold'>{name(currentEdge.source)} 对 {name(currentEdge.target)}：{currentEdge.label || '相关'}</h4><p className='text-xs leading-6 text-muted'>{currentEdge.scope === 'author_plan' ? '此关系阶段来自作者计划，尚非正文事实。' : '此关系来自已保存的原资料。'}原记录归于{name(currentEdge.owner_card_id || currentEdge.source)}。箭头表示这条记录的方向。反向查看仍是同一份原记录，不代表对方持有相同态度。</p><div className='flex flex-wrap gap-2'>{currentEdge.owner_card_id && currentEdge.owner_path && <Button className='text-xs' onClick={() => editRelation(currentEdge)}>修改这份原关系</Button>}<Button variant='ghost' className='text-xs' onClick={() => setSelectedEdge('')}>返回关系全景</Button></div>{currentEdge.evidence?.quote && <blockquote className='text-sm leading-7 text-muted'>{currentEdge.evidence.quote}</blockquote>}<div className='overflow-x-auto'><table className='w-full text-left text-xs leading-6'><caption className='mb-2 text-left font-medium'>按事件记录的关系阶段</caption><thead><tr><th className='py-2 pr-4'>事件</th><th className='py-2 pr-4'>关系与变化</th><th className='py-2'>依据性质</th></tr></thead><tbody>{(currentEdge.history || []).map((item: any, index: number) => <tr key={index} className='border-t border-border'><td className='py-2 pr-4'><button className='text-left text-brand-600 hover:underline focus-ring' onClick={() => onOpen({ id: item.event_ref || item.event_id, type: 'scene' })}>{item.event_label || '相关事件'}</button></td><td className='py-2 pr-4'>{item.relation || item.label || currentEdge.label}{item.notes && <p className='text-muted'>{item.notes}</p>}</td><td className='py-2'>{item.scope === 'author_plan' ? '作者计划，尚非正文事实' : item.evidence?.quote ? '正文引用，需结合核验' : '已保存资料'}</td></tr>)}</tbody></table></div>{!currentEdge.history?.length && <p className='text-xs text-muted'>这条关系尚未记录事件阶段；不据此编造过去或未来的变化。</p>}{currentEdge.temporal_status === 'unknown' && <p className='text-xs leading-6 text-muted'>这份关系资料尚未锚定到明确事件，不能据此断定人物此时已经知道。</p>}{currentEdge.confirmed === false && <p className='text-xs text-muted'>此关系仍待核验，不作为已发生事实。</p>}</section>}
      {focus && <div className='space-y-2 border-t border-border pt-3'>
        <div className='flex flex-wrap items-center gap-3'><strong className='text-sm'>{focus.label}</strong><Button className='text-xs' onClick={() => onOpen(focus)}>打开原资料</Button></div>
        {focus.confirmed === false && <p className='text-xs text-amber-700 dark:text-amber-300'>这项内容尚待核验，不能作为确定事实。</p>}
        {(focus.evidence?.quote || focus.quote || focus.summary) && <p className='whitespace-pre-wrap text-sm text-muted'>{focus.evidence?.quote || focus.quote || focus.summary}</p>}
        {focus.source && <details className='text-xs text-muted'><summary className='cursor-pointer'>查看来源</summary><p className='mt-1 break-all'>{typeof focus.source === 'string' ? focus.source : focus.source.path || focus.source.chapter_id || '作品设定'}</p>{focus.source.start_line && <p>第 {focus.source.start_line} 行</p>}</details>}
        <ul className='space-y-2 text-sm'>{adjacent.map((edge: any, index: number) => <li key={index}><button className='text-left text-brand-600 hover:underline focus-ring' onClick={() => setSelectedEdge(edgeId(edge))}>{name(edge.source)} 对 {name(edge.target)}：{edge.label || '相关'}</button>{edge.scope === 'author_plan' && <span className='ml-2 text-xs text-muted'>作者计划</span>}<button className='ml-3 text-xs text-muted hover:underline focus-ring' onClick={() => { setSelected(edge.source === focus.id ? edge.target : edge.source); setSelectedEdge('') }}>以对方为中心</button>{edge.evidence?.quote && <blockquote className='mt-1 text-xs text-muted'>{edge.evidence.quote}</blockquote>}{edge.confirmed === false && <span className='ml-2 text-xs text-amber-700 dark:text-amber-300'>待核验</span>}</li>)}</ul>
        {!adjacent.length && <p className='text-sm text-muted'>暂未记录关系。人物仍可因同场目标与阻碍参与情节，不必先编造一段社会关系。</p>}
      </div>}
    </>}
  </section>
}
