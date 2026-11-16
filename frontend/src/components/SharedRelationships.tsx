import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate as mutateCache } from 'swr'
import { api } from '../api/client'
import { useDraftRecovery } from '../lib/editorDrafts'
import { AuthorControls } from './AuthorControls'
import { MaterialImportWorkspace } from './MaterialImportWorkspace'
import { MaterialText } from './ContextMaterialSummary'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'

export function SharedRelationships({ project, entityId, storyId, onOpen, focusId, focusStageId }: { project: string; entityId?: string; storyId?: string; onOpen?: (target: any) => void; focusId?: string; focusStageId?: string }) {
  const { data, error, mutate } = useSWR(`/api/projects/${project}/relationships`, api.get)
  const { data: materials } = useSWR(`/api/projects/${project}/materials`, api.get)
  const [form, setForm] = useState<any>(null)
  const { data: stages, error: stageError, mutate: refreshStages } = useSWR(form?.id && focusStageId ? `/api/projects/${project}/relationships/${encodeURIComponent(form.id)}/stages` : null, api.get)
  const stageRows = Array.isArray(stages) ? stages : form?.stages || []
  useEffect(() => {
    if (!focusStageId || !form) return
    const element = document.getElementById(`relationship-stage-${focusStageId}`)
    for (let parent = element?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
    element?.scrollIntoView({ block: 'center' })
  }, [focusStageId, form?.id, stageRows, stageError])
  const { data: ownerCard, mutate: refreshOwner } = useSWR(form?.owner_card_id ? `/api/projects/${project}/cards/${form.owner_card_id}` : null, api.get)
  const ownerValue = (form?.owner_path || []).reduce((value: any, key: string) => value?.[key], ownerCard)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [snapshot, setSnapshot] = useState('')
  useEffect(() => { setForm(null); setMessage(''); setSnapshot('') }, [project, entityId])
  const scope = `${project}:${entityId || ''}`
  const currentScope = useRef(scope); currentScope.current = scope
  const draftKey = `${project}:relationship:${form?.id || `new:${entityId || 'all'}`}`
  const localDraft = useDraftRecovery(draftKey, form, snapshot, setForm)
  const refresh = () => { void mutate(); void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /relationships|knowledge-graph|cards|materials/.test(key)) }
  const rows = (Array.isArray(data) ? data : []).filter((row: any) => !entityId || row.participants?.some((participant: any) => participant.entity_id === entityId))
  const entities = (Array.isArray(materials) ? materials : []).filter((row: any) => ['character', 'world', 'world_rule', 'lore', 'worldview'].includes(row.type))
  const name = (id: string) => entities.find((row: any) => row.id === id)?.label || '未找到的原资料'
  const open = (row: any) => { if (form && JSON.stringify(form) !== snapshot && !window.confirm('这份关系还有未保存修改。留在此处可继续编辑；确定切换关系？')) return; setForm(structuredClone(row)); setSnapshot(JSON.stringify(row)); setMessage('') }
  useEffect(() => { const row = (Array.isArray(data) ? data : []).find((item: any) => item.id === focusId); if (row) { setForm(structuredClone(row)); setSnapshot(JSON.stringify(row)) } }, [focusId, Boolean(data)])
  const changeParticipant = (index: number, patch: any) => setForm({ ...form, participants: form.participants.map((row: any, i: number) => i === index ? { ...row, ...patch } : row) })
  const save = async () => {
    if (!form?.label?.trim() || form.participants?.length < 2 || form.participants.some((row: any) => !row.entity_id)) { setMessage('请填写关系名称，并选择至少两位不同的参与者。'); return }
    setBusy(true); setMessage('')
    const heldScope = scope
    const before = JSON.stringify(form)
    try {
      const result = form.id ? await api.put(`/api/projects/${project}/relationships/${encodeURIComponent(form.id)}`, { ...form, _revision: form._revision ?? '' }) : await api.post(`/api/projects/${project}/relationships`, form)
      if (currentScope.current !== heldScope) return
      setForm((current: any) => JSON.stringify(current) === before ? result : { ...current, id: result.id, _revision: result._revision })
      setSnapshot(JSON.stringify(result)); localDraft.markSaved(form, result); refresh(); setMessage('共享关系已保存。各位参与者会打开这一份原记录，反向查看不会倒置态度或称呼。')
    } catch (error) { if (currentScope.current === heldScope) setMessage(error instanceof Error ? error.message : '保存失败，编辑保留。') }
    finally { if (currentScope.current === heldScope) setBusy(false) }
  }
  return <section className='space-y-4' aria-label='共享关系'>
    <div className='flex flex-wrap items-baseline justify-between gap-3'><div><h3 className='text-lg font-semibold'>{entityId ? '参与的共享关系' : '人物与实体的共享关系'}</h3><p className='mt-2 text-xs leading-6 text-muted'>两人或多人共用一份记录。关系空白不影响构思与写作，也不会按同场出场凭空建立社会关系。</p></div><Button onClick={() => open({ label: '', participants: [{ entity_id: entityId || '', role: '' }, { entity_id: '', role: '' }], direction: 'undirected', notes: '', scope: storyId ? { story_card_id: storyId } : {}, stages: [] })}>创建共享关系</Button></div>
    {error ? <p role='alert' className='text-sm text-muted'>共享关系暂时无法读取，请稍后重试。</p> : !data ? <p className='text-sm text-muted'>正在读取共享关系…</p> : !rows.length ? <p className='text-sm text-muted'>目前还没有记录，可直接继续安排事件。</p> : <ul className='divide-y divide-border'>{rows.map((row: any) => <li key={row.id} className='py-3'><button className='text-left text-sm font-medium text-brand-600 hover:underline focus-ring' onClick={() => open(row)}>{row.label || '未命名关系'}</button><p className='mt-1 text-xs leading-6 text-muted'>{row.participants?.map((participant: any) => `${name(participant.entity_id)}${participant.role ? `（${participant.role}）` : ''}`).join(row.direction === 'directed' ? ' → ' : '、')}{row.legacy ? ' · 来自原人物卡' : ''}</p></li>)}</ul>}
    {localDraft.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>找到这份关系的本地未保存稿。</p><div className='flex gap-2'><Button onClick={localDraft.restore}>恢复本地草稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留服务器版</Button></div></div>}
    {form && <section className='space-y-4 border-y border-border py-5'><div className='flex items-baseline justify-between gap-3'><h4 className='font-semibold'>编辑同一份关系</h4><span className='text-xs text-muted'>{busy ? '保存中…' : JSON.stringify(form) === snapshot ? '已保存 / 未改动' : '有尚未保存的编辑'}</span></div><label className='block text-sm text-muted' htmlFor='shared-relation-label'>关系名称</label><Input id='shared-relation-label' value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder='例如：同行者、师徒、四人共同约定' /><div><label className='mb-1 block text-xs text-muted'>方向</label><Select value={form.direction || 'undirected'} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value='undirected'>共同关系</option><option value='directed'>有方向：按下方参与者顺序理解</option></Select></div>
      {form.participants.map((participant: any, index: number) => <div key={index} className='space-y-3 border-t border-border pt-3'><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'><div><label className='mb-1 block text-xs text-muted' htmlFor={`shared-person-${index}`}>参与者 {index + 1}</label><Select id={`shared-person-${index}`} value={participant.entity_id || ''} onChange={(e) => changeParticipant(index, { entity_id: e.target.value })}><option value=''>选择人物或实体</option>{participant.entity_id && !entities.some((row: any) => row.id === participant.entity_id) && <option value={participant.entity_id}>原参与者暂不可用（保留）</option>}{entities.map((row: any) => <option key={row.id} value={row.id}>{row.label}</option>)}</Select></div><div><label className='mb-1 block text-xs text-muted' htmlFor={`shared-role-${index}`}>在这份关系中的角色</label><Input id={`shared-role-${index}`} value={participant.role || ''} onChange={(e) => changeParticipant(index, { role: e.target.value })} placeholder='例如：发起者、老师、同行者，可留空' /></div></div><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{form.participants.length > 2 && <div><label className='mb-1 block text-xs text-muted' htmlFor={`shared-address-target-${index}`}>这个称呼指向谁</label><Select id={`shared-address-target-${index}`} value={participant.address_target_id || ''} onChange={(e) => changeParticipant(index, { address_target_id: e.target.value || undefined })}><option value=''>暂不指定称呼对象</option>{form.participants.filter((row: any) => row.entity_id && row.entity_id !== participant.entity_id).map((row: any) => <option key={row.entity_id} value={row.entity_id}>{name(row.entity_id)}</option>)}</Select></div>}<div><label className='mb-1 block text-xs text-muted' htmlFor={`shared-address-${index}`}>{form.participants.length === 2 ? '此人怎样称呼另一人（可选）' : '此人对上方对象的称呼（可选）'}</label><Input id={`shared-address-${index}`} value={participant.address_as || ''} onChange={(e) => changeParticipant(index, { address_as: e.target.value })} /></div></div><div className='flex flex-wrap gap-2'>{participant.entity_id && onOpen && <Button variant='ghost' className='text-xs' onClick={() => onOpen({ id: participant.entity_id })}>打开{name(participant.entity_id)}的资料</Button>}{form.participants.length > 2 && <Button variant='ghost' className='text-xs' onClick={() => setForm({ ...form, participants: form.participants.filter((_: any, i: number) => i !== index) })}>移除此参与者</Button>}</div></div>)}
      {!form.legacy && <Button className='text-xs' onClick={() => setForm({ ...form, participants: [...form.participants, { entity_id: '', role: '' }] })}>再加一位参与者</Button>}<label className='block text-xs text-muted' htmlFor='shared-relation-notes'>关系说明、边界与例外</label><Textarea id='shared-relation-notes' value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />{stageError && <div className='space-y-2'><p role='alert' className='text-xs text-muted'>阶段记录暂时无法读取，原关系与编辑保留。</p><Button className='text-xs' onClick={() => refreshStages()}>重新读取阶段</Button></div>}{stageRows.length > 0 && <details><summary className='cursor-pointer text-sm text-brand-600'>查看事件中的阶段变化</summary><ul className='mt-3 space-y-3'>{stageRows.map((stage: any, index: number) => <li key={stage.id || index} id={`relationship-stage-${stage.id}`} className='text-xs leading-6 text-muted'>{stage.label || stage.relation || stage.notes || '已记录的阶段'}{(stage.changes?.notes || stage.changes?.summary) && <p className='whitespace-pre-wrap'>{stage.changes.notes || stage.changes.summary}</p>}{stage.event_label && <p>事件：{stage.event_label}</p>}<p>{stage.status === 'confirmed' ? '已确认的阶段，仍保留来源' : '作者计划 / 待确认'}</p><details open={focusStageId === stage.id}><summary className='cursor-pointer text-xs text-brand-600'>查看这次变化与依据</summary><div className='mt-3'><MaterialText text={JSON.stringify({ 这次变化: stage.changes || { relation: stage.relation, notes: stage.notes }, 适用范围: stage.scope || {}, 原始依据: stage.source || stage.sources || {} })} names={Object.fromEntries(entities.map((item: any) => [item.id, item.label]))} onOpen={onOpen} /></div></details></li>)}</ul></details>}<div className='flex flex-wrap gap-2'><Button variant='primary' disabled={busy} onClick={save}>{busy ? '保存中…' : '保存共享关系'}</Button><Button variant='ghost' disabled={busy} onClick={() => { if (JSON.stringify(form) === snapshot || window.confirm('尚未保存的修改会作为本地草稿保留。确定关闭编辑？')) setForm(null) }}>关闭编辑</Button></div>{form.owner_card_id && ownerValue && <AuthorControls key={`${project}:${form.id}:lock`} project={project} target={`cards/${form.owner_card_id}.yaml`} pathPrefix={`/${form.owner_path.join('/')}`} label='共享关系' value={ownerValue} revision={ownerCard?._revision || form._revision} dirty={JSON.stringify(form) !== snapshot} onChanged={async () => { const held = scope; const id = form.id; await refreshOwner(); const rows = await mutate(); if (currentScope.current !== held) return; const saved = Array.isArray(rows) ? rows.find((row: any) => row.id === id) : null; if (saved) { setForm(saved); setSnapshot(JSON.stringify(saved)) }; refresh() }} />}</section>}
    <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm text-muted'>从材料整理关系</summary><div className='mt-4'><MaterialImportWorkspace project={project} purpose='relations' isTargetDirty={(id) => id === form?.id && JSON.stringify(form) !== snapshot} storyId={storyId} onApplied={refresh} /></div></details>
    {message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}
  </section>
}
