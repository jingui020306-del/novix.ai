import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { OpenMaterial } from './MaterialReferences'
import { fieldLabel } from './SchemaForm'
import { MaterialText, materialSourceTarget } from './ContextMaterialSummary'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Fields'

export function WorldStageBrowser({ project, storyCard, worldId, onOpen }: { project: string; storyCard?: any; worldId?: string; onOpen: OpenMaterial }) {
  const initial = { ...(storyCard?.payload?.world_context || {}), world_id: storyCard?.payload?.world_context?.world_id || worldId }
  const ownerKey = `${project}:${storyCard?.id || ''}:${worldId || ''}`
  const [scope, setScope] = useState<any>(initial)
  const [snapshot, setSnapshot] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('worlds')
  const request = useRef(0)
  const active = useRef(ownerKey); active.current = ownerKey
  const { data: cards } = useSWR(`/api/projects/${project}/cards`, api.get)
  const { data: options } = useSWR(scope.world_id ? `/api/projects/${project}/worlds/${scope.world_id}/context-options` : null, api.get)
  const { data: events } = useSWR(`/api/projects/${project}/events${storyCard?.id ? `?story_card_id=${encodeURIComponent(storyCard.id)}` : ''}`, api.get)
  const rows = Array.isArray(cards) ? cards : []
  const worldCards = rows.filter((card: any) => ['world', 'worldview', 'world_rule', 'lore'].includes(card.type))
  const eventRows = (Array.isArray(events) ? events : []).filter((row: any) => {
    const world = row.effective_values?.world_context?.world_id || row.values?.world_context?.world_id || row.world_context?.world_id
    if (world) return world === scope.world_id
    return Boolean(scope.world_id && scope.world_id === storyCard?.payload?.world_context?.world_id && row.story_card_id === storyCard?.id)
  })
  const body = { story_card_id: storyCard?.id, world_context: scope }
  const queryKey = JSON.stringify(body)
  const load = async (context = scope) => {
    const number = ++request.current, held = ownerKey
    if (!context.world_id) { setSnapshot(null); setBusy(false); setError(''); return }
    setBusy(true); setError(''); setSnapshot(null)
    const payload = { story_card_id: storyCard?.id, world_context: context }
    try {
      const result = await api.post(`/api/projects/${project}/worlds/${context.world_id}/snapshot`, payload)
      if (number === request.current && active.current === held) setSnapshot({ key: JSON.stringify(payload), data: result })
    } catch (cause) { if (number === request.current && active.current === held) setError(cause instanceof Error ? cause.message : '这个阶段暂时无法读取，请重试。') }
    finally { if (number === request.current && active.current === held) setBusy(false) }
  }
  useEffect(() => { setScope(initial); setSnapshot(null); setKind('worlds'); void load(initial); return () => { request.current++ } }, [ownerKey])
  const data = snapshot?.key === queryKey ? snapshot.data : null
  const characters = data?.characters || []
  const names = Object.fromEntries([...rows.map((card: any) => [card.id, card.payload?.name || card.title]), ...characters.map((row: any) => [row.id, row.names?.current_name || row.state?.name || row.base?.title || row.base?.payload?.name])])
  const selected = kind === 'relationships' ? data?.relationships || data?.relations || [] : data?.[kind] || []
  const actualScope = data?.scope || {}
  const actualTime = actualScope.time || {}
  const actualEvent = eventRows.find((row: any) => row.owner_card_id === actualTime.event_ref?.owner_card_id && row.scene_id === actualTime.event_ref?.scene_id)
  const moment = [actualTime.date || (actualTime.year !== undefined && actualTime.year !== null ? `${actualTime.year} 年` : ''), actualTime.event_ref ? `${actualEvent?.effective_values?.scene || actualEvent?.values?.scene || actualEvent?.label || '已关联事件'}${({ before: '发生前', immediate_after: '刚结束', phase: '之后的明确阶段' } as Record<string, string>)[actualTime.position] || '（相对时点未定）'}${actualTime.phase ? `：${actualTime.phase}` : ''}` : ''].filter(Boolean).join('，') || '时点未知'
  const rangeName = (key: string, id: string) => (data?.[key] || []).find((row: any) => row.id === id)?.label || names[id]

  const notices = [...new Set<string>([...(data?.uncertainties || []), ...(data?.warnings || [])].map((notice: any) => typeof notice === 'string' ? notice : notice.reason || notice.message).filter(Boolean))]
  const sourceLinks = (item: any) => <details className='mt-2'><summary className='cursor-pointer text-xs text-brand-600'>查看原资料与阶段依据</summary><div className='mt-2 space-y-2'><Button className='text-xs' onClick={() => onOpen({ id: item.id, type: item.base?.type || (kind === 'characters' ? 'character' : kind === 'relationships' ? 'relationship' : 'world') })}>打开原资料</Button>{(item.sources || []).map((source: any, index: number) => <div key={index} className='space-y-1'><Button className='text-xs' variant='ghost' onClick={() => onOpen({ ...materialSourceTarget({ source: source.path || source.source, material_id: item.id, type: item.base?.type || (kind === 'characters' ? 'character' : kind === 'relationships' ? 'relationship' : 'world') }), stage_id: source.record_id })}>{source.record_id ? '查看这条阶段依据' : '查看这处原文'}</Button>{(source.evidence?.quote || source.quote) && <p className='whitespace-pre-wrap text-xs leading-6 text-muted'>{source.evidence?.quote || source.quote}</p>}</div>)}</div></details>
  const readable = (value: any): string => Array.isArray(value) ? value.map(readable).filter(Boolean).join('；') : typeof value === 'string' || typeof value === 'number' ? String(value) : value?.content || value?.summary || value?.value || ''
  return <section className='space-y-5' aria-label='浏览当前阶段的世界'>
    <div><h2 className='text-xl font-semibold'>浏览当前阶段的世界</h2><p className='mt-2 max-w-prose text-sm leading-7 text-muted'>查看同一份正式资料在所选时期、地区和分支中的有效状态。这里只供作者查阅；本次生成真正读取了什么，请到“本次生成材料”查看。</p></div>
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
      <div><label htmlFor='browse-world' className='mb-1 block text-sm'>世界</label><Select id='browse-world' value={scope.world_id || ''} onChange={(event) => setScope({ world_id: event.target.value })}><option value=''>先选择一个世界</option>{worldCards.filter((card: any) => card.id === scope.world_id || card.payload?.entry_type === 'world' || !card.payload?.parent_id && !card.payload?.direction).map((card: any) => <option key={card.id} value={card.id}>{card.title || '未命名世界'}</option>)}</Select></div>
      <div><label htmlFor='browse-branch' className='mb-1 block text-sm'>世界分支</label><Select id='browse-branch' disabled={!scope.world_id} value={scope.branch_id || 'main'} onChange={(event) => setScope({ ...scope, branch_id: event.target.value })}>{(options?.branches?.length ? options.branches : [{ id: 'main', label: '主世界' }]).map((branch: any) => <option key={branch.id} value={branch.id}>{branch.label || '原分支'}</option>)}</Select></div>
      <div><label htmlFor='browse-period' className='mb-1 block text-sm'>时期</label><Select id='browse-period' disabled={!scope.world_id} value={scope.period_id || ''} onChange={(event) => setScope({ ...scope, period_id: event.target.value || undefined, time: undefined })}><option value=''>未另选时期，按发生时间查看</option>{(options?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.label}</option>)}</Select></div>
      <fieldset><legend className='mb-2 text-sm'>地区</legend><div className='flex flex-wrap gap-3'>{(options?.regions || []).map((region: any) => <label key={region.id} className='flex items-start gap-2 text-xs leading-6'><input type='checkbox' checked={(scope.region_ids || []).includes(region.id)} onChange={(event) => setScope({ ...scope, region_ids: event.target.checked ? [...(scope.region_ids || []), region.id] : scope.region_ids.filter((id: string) => id !== region.id) })} />{region.label}</label>)}{!options?.regions?.length && <p className='text-xs text-muted'>没有单独划分地区，可直接查看。</p>}</div></fieldset>
    </div>
    <details><summary className='cursor-pointer text-sm text-brand-600'>按事件或年份查看</summary><div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'><div><label htmlFor='browse-year' className='mb-1 block text-xs text-muted'>发生年份</label><Input id='browse-year' type='number' step={1} value={scope.time?.year ?? ''} onChange={(event) => setScope({ ...scope, time: { ...scope.time, year: event.target.value === '' ? undefined : Number(event.target.value) } })} placeholder='未知时留空' /></div><div><label htmlFor='browse-event' className='mb-1 block text-xs text-muted'>事件时点</label><Select id='browse-event' value={scope.time?.event_ref ? `${scope.time.event_ref.owner_card_id}:${scope.time.event_ref.scene_id}` : ''} onChange={(event) => { const [owner_card_id, scene_id] = event.target.value.split(':'); setScope({ ...scope, time: { ...scope.time, event_ref: event.target.value ? { owner_card_id, scene_id } : undefined, position: event.target.value ? 'before' : undefined } }) }}><option value=''>不指定事件</option>{eventRows.map((row: any) => <option key={row.id} value={`${row.owner_card_id}:${row.scene_id}`}>{row.effective_values?.scene || row.values?.scene || row.label || '原事件'}（{row.owner_card_id === storyCard?.id ? '故事策划' : '情节工作表'}）</option>)}</Select>{!eventRows.length && <p className='mt-1 text-xs leading-6 text-muted'>当前故事没有可确定归属于这个世界的事件，可按时期或年份查看。</p>}</div>{scope.time?.event_ref && <div><label htmlFor='browse-position' className='mb-1 block text-xs text-muted'>在事件之前还是之后</label><Select id='browse-position' value={scope.time.position || 'before'} onChange={(event) => setScope({ ...scope, time: { ...scope.time, position: event.target.value } })}><option value='before'>事件发生前</option><option value='immediate_after'>事件刚结束</option></Select></div>}</div></details>
    <div className='flex flex-wrap items-center gap-3'><Button variant='primary' disabled={busy || !scope.world_id} onClick={() => load()}>{busy ? '正在读取这个阶段…' : '查看这个阶段'}</Button>{snapshot && !data && <p className='text-xs text-muted'>筛选已改变，点击查看后读取对应状态。</p>}</div>
    {error && <p role='alert' className='text-sm leading-7 text-red-700 dark:text-red-300'>{error} 当前资料未被修改，可重新读取。</p>}
    {!scope.world_id && <p className='text-sm text-muted'>故事还没有选用世界，可以先选择一个已有世界浏览。</p>}
    {data && <><p role='status' className='text-sm leading-7'>当前读取：{names[actualScope.world_id] || '世界未知'}；分支：{rangeName('branches', actualScope.branch_id) || (actualScope.branch_id === 'main' ? '主世界' : actualScope.branch_id ? '已关联分支（名称暂未读取）' : '未知')}；时期：{actualScope.period_id ? rangeName('periods', actualScope.period_id) || '已关联时期（名称暂未读取）' : '未另选时期'}；地区：{actualScope.region_ids?.length ? actualScope.region_ids.map((id: string) => rangeName('regions', id) || '已关联地区').join('、') : '未限定'}；时点：{moment}。</p><nav className='flex flex-wrap gap-2' aria-label='阶段资料类型'>{[['worlds', '设定与规则'], ['characters', '人物'], ['relationships', '人物关系']].map(([key, label]) => <Button key={key} aria-pressed={kind === key} variant={kind === key ? 'primary' : 'ghost'} onClick={() => setKind(key)}>{label}</Button>)}</nav>
      <ul className='divide-y divide-border'>{selected.map((item: any) => { const payload = item.state || item.base?.payload || {}; return <li key={item.id} className='py-5'><h3 className='text-base font-semibold'>{names[item.id] || payload.label || item.label || item.base?.title || '原资料'}</h3>{(payload.canon_status || payload.setting_status) && <p className='mt-2 text-xs leading-6 text-muted'>{payload.canon_status && `可信程度：${({ canon: '已确定', hypothesis: '推定，待确认', inspiration: '灵感' } as Record<string, string>)[payload.canon_status] || '待核对'}。`}{payload.setting_status && `采用情况：${({ set: '已采用', unset: '未设定', not_applicable: '不适用' } as Record<string, string>)[payload.setting_status] || '待核对'}。`}</p>}{kind === 'relationships' ? <><p className='mt-2 text-sm leading-7'>{(payload.participants || item.participants || []).map((participant: any) => `${names[participant.entity_id] || '原人物'}${participant.role ? `（${participant.role}）` : ''}`).join((payload.direction || item.direction) === 'directed' ? ' 对 ' : ' 与 ')}</p>{(payload.notes ?? item.notes) && <p className='mt-1 whitespace-pre-wrap text-sm leading-7 text-muted'>{payload.notes ?? item.notes}</p>}</> : <div className='mt-3 max-w-prose space-y-3'>{Object.entries(payload).filter(([key]) => ['summary', 'content', 'description', 'setting', 'rules', 'boundaries', 'causes', 'consequences', 'identity', 'core_motivation', 'voice', 'appearance', 'state', 'goal'].includes(key)).map(([key, value]) => readable(value) ? <div key={key}><p className='mb-1 text-sm font-medium'>{key === 'rules' ? '世界规则' : fieldLabel(key)}</p><MaterialText text={readable(value)} names={names} onOpen={onOpen} /></div> : null)}{kind === 'characters' && item.names?.base_name && item.names.base_name !== item.names.current_name && <p className='text-xs text-muted'>初始姓名：{item.names.base_name}；当前姓名：{item.names.current_name}</p>}</div>}{(item.uncertainties || []).map((notice: any, index: number) => <p key={index} className='mt-2 text-xs leading-6 text-muted'>{typeof notice === 'string' ? notice : notice.reason}</p>)}{sourceLinks(item)}</li> })}</ul>
      {!selected.length && <p className='text-sm leading-7 text-muted'>这个浏览范围暂时没有{kind === 'characters' ? '人物' : kind === 'relationships' ? '关系' : '设定'}记录。未确定的部分保留未知。</p>}{notices.map((notice, index) => <p key={index} className='text-xs leading-6 text-muted'>{notice}</p>)}</>}
  </section>
}
