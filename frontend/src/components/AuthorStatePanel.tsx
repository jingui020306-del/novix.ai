import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate as mutateCache } from 'swr'
import { api } from '../api/client'
import { canonicalEvents } from '../lib/materialScope'
import { useDraftRecovery } from '../lib/editorDrafts'
import { fieldLabel } from './SchemaForm'
import { CharacterDetails } from './CharacterDetails'
import { MaterialText } from './ContextMaterialSummary'
import { WorldContextFields } from './WorldContextFields'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'

export function AuthorStatePanel({ project, entityId, type = 'character', storyId, eventRef, onOpenEvent, focusRequest }: { project: string; entityId: string; type?: 'character' | 'world'; storyId?: string; eventRef?: string; onOpenEvent?: (owner: string, scene: string) => void; focusRequest?: { requestId: number; stage_id?: string } | null }) {
  const path = type === 'character' ? 'characters' : 'worlds'
  const query = new URLSearchParams()
  if (storyId) query.set('story_card_id',storyId)
  if (eventRef) query.set('event_ref',eventRef)
  const { data: baselineState, error, mutate } = useSWR(entityId ? `/api/projects/${project}/${path}/${entityId}/state?${query}` : null, api.get)
  const [viewScope, setViewScope] = useState<any>({})
  const [snapshot, setSnapshot] = useState<any>(null)
  const [viewBusy, setViewBusy] = useState(false)
  const [viewError, setViewError] = useState('')
  const viewRequest = useRef(0)
  const viewedContext = useRef<{ key: string; context: any } | null>(null)
  const viewKey = `${project}:${type}:${entityId}:${storyId || ''}:${eventRef || ''}`
  const currentViewKey = useRef(viewKey); currentViewKey.current = viewKey
  useEffect(() => { setViewScope({}); setSnapshot(null); setViewError(''); setViewBusy(false); viewedContext.current = null; viewRequest.current++ }, [viewKey])
  const state = snapshot?.key === viewKey ? snapshot.data : baselineState
  const viewSnapshot = async (context = viewScope, afterSave = false) => {
    const held = viewKey, number = ++viewRequest.current
    viewedContext.current = { key: held, context }
    setViewBusy(true); setViewError('')
    try {
      const result = await api.post(`/api/projects/${project}/${path}/${entityId}/snapshot`, { story_card_id: storyId, world_context: context })
      if (currentViewKey.current === held && number === viewRequest.current) setSnapshot({ key: held, data: result })
    } catch (cause) { if (currentViewKey.current === held && number === viewRequest.current) setViewError(`${afterSave ? '阶段已保存；此时点尚未重读，请重试。' : ''}${cause instanceof Error ? cause.message : '这个时点暂时无法读取。'}`) }
    finally { if (currentViewKey.current === held && number === viewRequest.current) setViewBusy(false) }
  }
  const { data: events } = useSWR(storyId ? `/api/projects/${project}/events?story_card_id=${encodeURIComponent(storyId)}` : null, api.get)
  const storyEvents = canonicalEvents(events)
  const stageEvent = (stage: any) => {
    const ref = stage.scope?.time?.event_ref
    return ref && storyEvents.find(event => event.choice_refs?.includes(`${ref.owner_card_id}:${ref.scene_id}`))
  }
  const { data: stages, mutate: refreshStages } = useSWR(entityId ? `/api/projects/${project}/${path}/${entityId}/stages` : null, api.get)
  const history: { stage: any; group: string; order: number; position: number }[] = []
  for (const stage of Array.isArray(stages) ? stages : []) {
    const event = stageEvent(stage)
    const time = stage.scope?.time || {}
    const position = ['before', 'immediate_after', 'phase'].indexOf(time.position)
    if (event) {
      history.push({ stage, group: event.owner_card_id === storyId ? '故事卡事件' : '工作表事件', order: storyEvents.indexOf(event), position })
    } else if (Number.isFinite(time.year)) {
      history.push({ stage, group: '按年份', order: time.year, position: 0 })
    } else {
      history.push({ stage, group: '其他阶段记录', order: 0, position: 0 })
    }
  }
  const groups = ['工作表事件', '故事卡事件', '按年份', '其他阶段记录']
  history.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.order - b.order || a.position - b.position)
  useEffect(() => {
    if (!focusRequest?.stage_id) return
    const element = document.getElementById(`author-stage-${focusRequest.stage_id}`)
    for (let parent = element?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
    element?.scrollIntoView({ block: 'center' })
  }, [focusRequest?.requestId, stages, state, error])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<any>({ label: '', status: 'planned', changes: {}, knowledge: [], scope: {} })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const currentEvent = storyEvents.find(event => event.id === eventRef || Boolean(eventRef && event.choice_refs?.includes(eventRef.replace(':important_scenes:', ':'))))
  const eventScope = currentEvent ? { ...currentEvent.values?.world_context, story_card_id: storyId,
    time: { event_ref: { owner_card_id: currentEvent.owner_card_id, scene_id: currentEvent.scene_id }, position: 'immediate_after' } } : {}
  const empty = { label: '', status: 'planned', changes: {}, knowledge: [], scope: eventScope }
  const scope = `${project}:${path}:${entityId}`
  const activeScope = useRef(scope); activeScope.current = scope
  const latestDraft = useRef(draft); latestDraft.current = draft
  const [baseline, setBaseline] = useState(JSON.stringify(empty))
  const localDraft = useDraftRecovery(`${scope}:stage`, editing ? draft : null, baseline, (value) => { setDraft(value); setEditing(true) })
  useEffect(() => { setDraft(empty); setBaseline(JSON.stringify(empty)); setEditing(false); setMessage(''); setBusy(false) }, [scope])
  const { data: branches, mutate: refreshBranches } = useSWR(type === 'world' && entityId ? `/api/projects/${project}/worlds/${entityId}/branches` : null, api.get)
  const [branchForm, setBranchForm] = useState<any>(null)
  const branchRecovery = useDraftRecovery(`${scope}:branches`, branchForm, branches ? JSON.stringify(branches) : '', setBranchForm)
  useEffect(() => { setBranchForm(null) }, [scope])
  const saveBranches = async () => {
    if (!branchForm) return
    const heldScope = scope; const before = JSON.stringify(branchForm)
    setBusy(true); setMessage('')
    try {
      const result = await api.put(`/api/projects/${project}/worlds/${entityId}/branches`, branchForm)
      if (activeScope.current !== heldScope) return
      setBranchForm((current: any) => JSON.stringify(current) === before ? result : { ...current, _revision: result._revision })
      branchRecovery.markSaved(branchForm, result); await refreshBranches(); setMessage('分支已保存；分歧前历史仍共享，之后按各自分支取用。')
    } catch (error) { if (activeScope.current === heldScope) setMessage(error instanceof Error ? error.message : '分支未保存，编辑保留。') }
    finally { if (activeScope.current === heldScope) setBusy(false) }
  }
  const save = async () => {
    const heldScope = scope
    const before = JSON.stringify(draft)
    setBusy(true); setMessage('')
    try { const result = await api.post(`/api/projects/${project}/${path}/${entityId}/stages`, { ...draft, source: { kind: 'author', note: '作者在阶段资料中手动确认或计划' } }); if (activeScope.current !== heldScope) return; await mutate(); await refreshStages(); if (activeScope.current !== heldScope) return; if (viewedContext.current?.key === viewKey) { const context = viewedContext.current.context; setSnapshot(null); await viewSnapshot(context, true); if (activeScope.current !== heldScope) return }; localDraft.markSaved(draft, draft); if (JSON.stringify(latestDraft.current) === before) setEditing(false); else setDraft((current: any) => ({ ...current, _revision: result._revision })); void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /author-state|state|knowledge-graph/.test(key)); setMessage(result.change_suggestions?.queued_count ? `阶段已追加，已排队 ${result.change_suggestions.queued_count} 项受影响正文建议，仍需确认。` : '阶段记录已追加，初始资料与既有历史保留。') }
    catch (error) { if (activeScope.current === heldScope) setMessage(error instanceof Error ? error.message : '阶段保存失败，编辑保留。') }
    finally { if (activeScope.current === heldScope) setBusy(false) }
  }
  return <section className='space-y-4 border-t border-border pt-4' aria-label='初始资料与阶段状态'>
    <h3 className='text-base font-semibold'>{type === 'world' ? '世界变化' : '人物经历'}</h3>
    {localDraft.recovery && <div className='flex flex-wrap gap-2'><p className='w-full text-sm'>找到本人物或世界的未保存阶段记录。</p><Button onClick={localDraft.restore}>恢复阶段草稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>放弃本地稿</Button></div>}
    <details><summary className='cursor-pointer text-sm text-brand-600'>按时点查看适用状态</summary><div className='mt-3 space-y-3'><WorldContextFields project={project} storyId={storyId} value={viewScope} onChange={setViewScope} inherited='这里只改变查看范围，不保存到故事或阶段记录。未知时间留空，不以章节号推断。' /><div className='flex flex-wrap gap-2'><Button disabled={viewBusy} onClick={() => viewSnapshot()}>{viewBusy ? '读取中…' : '查看这个时点'}</Button>{snapshot && <Button variant='ghost' onClick={() => { viewedContext.current = null; viewRequest.current++; setSnapshot(null); setViewBusy(false); setViewError('') }}>回到故事当前状态</Button>}</div>{viewError && <p role='alert' className='text-xs text-muted'>{viewError}</p>}{snapshot && <p className='text-xs leading-6 text-muted'>当前读取：{state?.scope?.time?.date || (state?.scope?.time?.year != null ? `${state.scope.time.year} 年` : state?.scope?.time?.event_ref ? '已关联事件的相对时点' : '时点未知')}。未指定或依据不足的状态保留未知。</p>}</div></details>
    {error ? <p role='alert' className='text-sm text-muted'>阶段资料暂时无法读取，初始设定仍保留。</p> : !state ? <p className='text-sm text-muted'>正在读取适用资料…</p> : <><details open={eventRef ? true : undefined}><summary className='cursor-pointer text-sm text-brand-600'>当前适用状态与来源</summary><div className='mt-3 space-y-3'>{type === 'character' && state.names && <p className='text-sm'>初始姓名：{state.names.base_name || state.base?.payload?.name || '未填'}；当前称呼：{state.names.current_name || '未另行更改'}{state.names.aliases?.length ? `；别名：${state.names.aliases.join('、')}` : ''}{state.names.period_address ? `；阶段称谓：${state.names.period_address}` : ''}</p>}<details><summary className='cursor-pointer text-xs text-muted'>回看初始资料</summary><div className='mt-2 space-y-2'>{Object.entries(state.base?.payload || {}).filter(([key, value]) => ['name', 'identity', 'voice', 'appearance', 'summary'].includes(key) && typeof value === 'string').map(([key, value]) => <p key={key} className='text-sm leading-7'>{fieldLabel(key)}：{String(value)}</p>)}</div></details>{type === 'character' && <p className='text-sm'>年龄：{state.age?.value ?? '未知'}{state.age?.reason ? `（${state.age.reason}）` : ''}</p>}<MaterialText text={JSON.stringify(Object.fromEntries(Object.entries(state.state || {}).filter(([key]) => ['identity', 'voice', 'appearance', 'core_motivation', 'personality_traits', 'beliefs', 'summary', 'goal', 'state', 'setting', 'content', 'rules', 'boundaries', 'causes', 'consequences'].includes(key))))} names={{ [entityId]: state.base?.title || state.base?.payload?.name || '原资料' }} />{(state.state?.detail_sections || []).filter((section: any) => !section.removed).map((section: any) => <blockquote key={section.id} className='whitespace-pre-wrap text-sm leading-7 text-muted'><strong className='font-medium'>{section.title || '人物细节'}：</strong>{section.content}{section.usage === 'author_only' ? '（仅供作者查看）' : ''}</blockquote>)}{(state.knowledge || []).map((item: any, index: number) => <blockquote key={index} className='text-sm leading-7 text-muted'>已知：{item.value}</blockquote>)}{(state.uncertainties || []).map((item: any, index: number) => <p key={index} className='text-xs text-muted'>{typeof item === 'string' ? item : item.reason}</p>)}{(state.sources || []).map((source: any, index: number) => <p key={index} className='break-all text-xs text-muted'>来源：{source.path || source.source || '作者记录'}</p>)}</div></details><ul className='divide-y divide-border'>{history.map(({ stage, group }, index) => <li key={stage.id} id={`author-stage-${stage.id}`} className='space-y-2 py-3'>
      {history[index - 1]?.group !== group && <h4 className='mb-3 text-xs text-muted'>{group}</h4>}
      {stage.scope?.time?.year != null && <time className='text-xs'>{stage.scope.time.year} 年 {stage.scope.time.date}</time>}
      <p className='text-sm font-medium'>{stage.label || '阶段记录'}<span className='ml-2 text-xs font-normal text-muted'>{stage.status === 'confirmed' ? '已确认' : '作者计划'}</span></p><p className='whitespace-pre-wrap text-sm leading-7 text-muted'>{stage.changes?.summary || stage.changes?.state || Object.values(stage.changes || {}).filter((v) => typeof v === 'string').join('；')}</p>{(stage.knowledge || []).map((item: any, index: number) => <p key={index} className='text-xs text-muted'>认知：{item.value}</p>)}{(stage.changes?.detail_sections || []).map((section: any) => <p key={section.id} className='whitespace-pre-wrap text-xs leading-6 text-muted'>{section.title || state?.base?.payload?.detail_sections?.find((row: any) => row.id === section.id)?.title || '人物细节'}：{section.removed ? '此阶段不再适用，之前记录保留。' : section.content}</p>)}{stage.scope?.time?.event_ref && onOpenEvent && <Button variant='ghost' onClick={() => onOpenEvent(stage.scope.time.event_ref.owner_card_id, stage.scope.time.event_ref.scene_id)}>
        {stageEvent(stage)?.values?.scene || '查看关联事件'}
        {{ before: ' · 发生前', immediate_after: ' · 发生后', phase: ' · 后续阶段' }[stage.scope.time.position as string]}
      </Button>}
      <details open={focusRequest?.stage_id === stage.id}><summary className='cursor-pointer text-xs text-brand-600'>查看这次变化与依据</summary><div className='mt-3'><MaterialText text={JSON.stringify({ 这次变化: stage.changes || {}, 适用范围: stage.scope || {}, 原始依据: stage.source || {} })} names={{ [entityId]: state?.names?.current_name || state?.base?.payload?.name || state?.base?.title || '原资料' }} /></div></details><Button variant='ghost' className='text-xs' onClick={() => { setDraft({ ...stage, id: undefined, supersedes: stage.id, label: `更正：${stage.label || '阶段记录'}` }); setBaseline(JSON.stringify(stage)); setEditing(true) }}>追加更正，不覆盖历史</Button></li>)}</ul></>}
    <Button onClick={() => { setDraft(empty); setBaseline(JSON.stringify(empty)); setEditing(true) }}>记录一个阶段变化</Button>
    {editing && <section className='space-y-3 border-y border-border py-4'><label className='block text-sm' htmlFor='author-stage-label'>阶段名称</label><Input id='author-stage-label' value={draft.label || ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /><WorldContextFields project={project} storyId={storyId} value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} inherited='指定这条变化适用的世界、事件或时间。不清楚时留空，并保留为计划。' /><label className='block text-sm' htmlFor='author-stage-changes'>此阶段发生了什么变化</label><Textarea id='author-stage-changes' value={draft.changes?.summary || ''} onChange={(e) => setDraft({ ...draft, changes: { ...draft.changes, summary: e.target.value } })} placeholder='只记录你决定的变化，不必预填每场情绪、衣着与说话方式。' /><fieldset className='space-y-3'><legend className='text-sm font-medium'>具体哪些设定发生了变化（可选）</legend><p className='text-xs leading-6 text-muted'>只选需要变化的部分；未选字段沿用此前状态，不回写初始卡。</p>{(type === 'character' ? ['identity', 'core_motivation', 'personality_traits', 'voice', 'appearance', 'beliefs'] : ['setting', 'content', 'rules', 'boundaries', 'causes', 'consequences']).map((key) => {
        const selected = Object.prototype.hasOwnProperty.call(draft.changes || {}, key)
        const initial = state?.state?.[key] ?? state?.base?.payload?.[key]
        const list = Array.isArray(draft.changes?.[key]) || Array.isArray(initial) || ['rules', 'personality_traits'].includes(key)
        return <div key={key} className='space-y-2'><label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={selected} onChange={(e) => setDraft((current: any) => { const changes = { ...current.changes }; if (e.target.checked) changes[key] = initial ?? (list ? [] : ''); else delete changes[key]; return { ...current, changes } })} />{key === 'rules' ? '世界规则' : fieldLabel(key)}</label>{selected && <Textarea aria-label={`此阶段的${key === 'rules' ? '世界规则' : fieldLabel(key)}`} value={Array.isArray(draft.changes[key]) ? draft.changes[key].join('\n') : String(draft.changes[key] ?? '')} onChange={(e) => setDraft({ ...draft, changes: { ...draft.changes, [key]: list ? e.target.value.split('\n') : e.target.value } })} placeholder={list ? '每行一项；可以完整写明条件与例外。' : '写这一阶段适用的内容；暂时的情绪与衣着无需固定为设定。'} />}</div>
      })}</fieldset><label className='block text-sm' htmlFor='author-stage-knowledge'>人物在此时知道什么（每行一项）</label><Textarea id='author-stage-knowledge' value={(draft.knowledge || []).map((item: any) => item.value).join('\n')} onChange={(e) => setDraft({ ...draft, knowledge: e.target.value.split('\n').filter(Boolean).map((value) => ({ value, known_by: type === 'character' ? [entityId] : [] })) })} />{type === 'character' && <CharacterDetails project={project} characterId={entityId} stage value={draft.changes?.detail_sections || []} baseSections={state?.state?.detail_sections || state?.base?.payload?.detail_sections || []} onChange={(detail_sections) => setDraft({ ...draft, changes: { ...draft.changes, detail_sections } })} />}{type === 'character' && <details><summary className='cursor-pointer text-xs text-brand-600'>在此阶段改名、添别名或改变称谓（可选）</summary><div className='mt-3 space-y-2'><p className='text-xs leading-6 text-muted'>初始姓名写错请改人物卡；这里记录故事中真实的名称变化，既有正文不会批量替换。</p><Select aria-label='名称变化类型' value={draft.changes?.name_change?.kind || ''} onChange={(e) => setDraft({ ...draft, changes: { ...draft.changes, name_change: e.target.value ? { ...draft.changes?.name_change, kind: e.target.value, name: draft.changes?.name_change?.name || '' } : undefined } })}><option value=''>不记录名称变化</option><option value='rename'>此阶段改名</option><option value='alias'>增加别名</option><option value='period_address'>阶段称谓</option></Select>{draft.changes?.name_change && <Input aria-label='新的名称或称谓' value={draft.changes.name_change.name || ''} onChange={(e) => setDraft({ ...draft, changes: { ...draft.changes, name_change: { ...draft.changes.name_change, name: e.target.value } } })} />}</div></details>}<Select aria-label='阶段是否已经确认' value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value='planned'>作者计划，尚未发生</option><option value='confirmed'>作者已确认适用的阶段</option></Select><div className='flex gap-2'><Button variant='primary' disabled={busy} onClick={save}>{busy ? '保存中…' : '保存阶段记录'}</Button><Button variant='ghost' disabled={busy} onClick={() => setEditing(false)}>收起，保留编辑</Button></div></section>}
    {type === 'world' && <details><summary className='cursor-pointer text-sm text-brand-600'>世界分支：另一种历史（可选）</summary><div className='mt-3 space-y-3'><p className='text-xs leading-6 text-muted'>同一世界的不同历史选择，不是并行故事线。分支从明确事件分开，之前的资料仍共享；未知时不猜测分歧点。</p>{branchRecovery.recovery && <Button onClick={branchRecovery.restore}>恢复分支草稿</Button>}{!branchForm ? <Button disabled={!branches} onClick={() => setBranchForm(structuredClone(branches))}>查看与编辑分支</Button> : <><div className='space-y-4'>{(branchForm.branches || []).map((branch: any, index: number) => <div key={branch.id} className='space-y-2 border-t border-border pt-3'><label className='block text-xs text-muted'>分支名称</label><Input value={branch.label || ''} onChange={(e) => setBranchForm({ ...branchForm, branches: branchForm.branches.map((row: any, i: number) => i === index ? { ...row, label: e.target.value } : row) })} />{branch.id !== 'main' && <><label className='block text-xs text-muted'>从哪一分支分开</label><Select value={branch.parent_branch_id || 'main'} onChange={(e) => setBranchForm({ ...branchForm, branches: branchForm.branches.map((row: any, i: number) => i === index ? { ...row, parent_branch_id: e.target.value } : row) })}>{branchForm.branches.filter((row: any) => row.id !== branch.id).map((row: any) => <option key={row.id} value={row.id}>{row.label}</option>)}</Select><WorldContextFields project={project} storyId={storyId} value={{ time: { event_ref: branch.fork_event_ref } }} onChange={(value) => setBranchForm({ ...branchForm, branches: branchForm.branches.map((row: any, i: number) => i === index ? { ...row, fork_event_ref: value.time?.event_ref || null } : row) })} inherited='只需指定分歧事件；不必在这里重复填写世界设定。' /></>}</div>)}</div><div className='flex flex-wrap gap-2'><Button onClick={() => setBranchForm({ ...branchForm, branches: [...(branchForm.branches || []), { id: `branch_${crypto.randomUUID().slice(0, 8)}`, label: '', parent_branch_id: 'main', fork_event_ref: null }] })}>增加另一种历史</Button><Button variant='primary' disabled={busy} onClick={saveBranches}>{busy ? '保存中…' : '保存分支'}</Button></div></>}</div></details>}
    {message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}
  </section>
}
