import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate as mutateCache } from 'swr'
import { api } from '../api/client'
import { fieldLabel } from './SchemaForm'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'

export const pointerLocked = (paths: string[], pointer: string, includeChildren = false) => paths.some((path) => path === '/' || pointer === path || pointer.startsWith(`${path}/`) || includeChildren && path.startsWith(`${pointer}/`))
export function useAuthorControl(project: string, target?: string) {
  const result = useSWR(target ? `/api/projects/${project}/author-controls?target=${encodeURIComponent(target)}` : null, api.get)
  return { ...result, lockedPaths: (result.data?.locks || []).flatMap((lock: any) => lock.paths || []) as string[] }
}
const authorField = (key: string) => key === 'payload' || fieldLabel(key) !== '补充内容' && !['type', 'category_id', 'parent_id', 'importance', 'sort_order', 'active_style_sample_asset_ids', 'injection_policy'].includes(key) && !/(?:_id|_ids|_ref|_refs)$/.test(key) && !['target', 'source', 'sources', 'reference_image', 'characters', 'links', 'pinned_techniques'].includes(key)
const controlFieldLabel = (key: string, cardType: string, path: string) => ['world', 'worldview', 'world_rule', 'lore'].includes(cardType) && path === '/payload/rules' ? '世界规则' : fieldLabel(key)
export const safeFields = (value: any, prefix = '', label = '', cardType = value?.type || ''): { path: string; label: string }[] => {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).filter(([key]) => authorField(key)).flatMap(([key, item]) => {
    const path = `${prefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
    const name = key === 'payload' ? label : `${label ? `${label} / ` : ''}${controlFieldLabel(key, cardType, path)}`
    const rows = Array.isArray(item) ? item.flatMap((row: any, index) => row && typeof row === 'object' ? safeFields(row, `${path}/${row.id ? `@${row.id}` : index}`, `${name} / ${String(row.scene || row.title || row.name || row.stage || `第 ${index + 1} 项`).slice(0, 28)}`, cardType) : []) : typeof item === 'object' ? safeFields(item, path, name, cardType) : []
    return [...(key === 'payload' ? [] : [{ path, label: name }]), ...rows]
  })
}
function ValueEditor({ value, onChange, label, field = '', names = {}, cardType = '', path = '' }: { value: any; onChange: (value: any) => void; label: string; field?: string; names?: Record<string, string>; cardType?: string; path?: string }) {
  if (['characters', 'links', 'pinned_techniques', 'chapter', 'first_chapter', 'payoff_chapter', 'introduced_chapter'].includes(field)) return <p className='text-sm leading-7 text-muted'>{Array.isArray(value) ? value.map((item: any) => names[typeof item === 'string' ? item : item.technique_id] || '原关联资料').join('、') || '暂未关联' : names[value] || (value ? '原关联（保留，调整请回原编辑入口）' : '暂未关联')}</p>
  const options: Record<string, Record<string, string>> = { usage: { relevant: '按相关场景参考', focus: '优先参考，仍遵守范围', author_only: '仅供作者查看' }, truth_status: { undecided: '真相尚未决定', confirmed: '作者已确定真相' }, setting_status: { unset: '未设置', not_applicable: '不适用', set: '已采用' }, canon_status: { canon: '已确定', hypothesis: '推定', inspiration: '灵感' }, creation_status: { new: '待起笔', draft: '草案', complete: '已完善' } }
  if (options[field]) return <Select aria-label={label} value={value || ''} onChange={(e) => onChange(e.target.value)}>{!value && <option value=''>尚未标注</option>}{Object.entries(options[field]).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</Select>
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return <Textarea aria-label={label} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />
  if (Array.isArray(value)) return <div className='space-y-3'>{value.map((item, i) => <ValueEditor key={i} names={names} cardType={cardType} path={`${path}/${item?.id ? `@${item.id}` : i}`} field={field} label={`${label} / ${names[item?.entity_id || item?.character_id || item?.technique_id] || item?.scene || item?.title || item?.name || `第 ${i + 1} 项`}`} value={item} onChange={(next) => onChange(value.map((row, index) => i === index ? next : row))} />)}</div>
  if (value && typeof value === 'object') return <div className='space-y-3'>{Object.entries(value).filter(([key]) => authorField(key)).map(([key, item]) => <div key={key}><label className='mb-1 block text-xs text-muted'>{controlFieldLabel(key, cardType, `${path === '/' ? '' : path}/${key}`)}</label><ValueEditor names={names} cardType={cardType} path={`${path === '/' ? '' : path}/${key}`} field={key} label={`${label} ${controlFieldLabel(key, cardType, `${path === '/' ? '' : path}/${key}`)}`} value={item} onChange={(next) => onChange({ ...value, [key]: next, ...(key === 'truth_status' && next === 'undecided' ? { truth_value: null, fact_ref: null } : {}) })} /></div>)}</div>
  if (typeof value === 'boolean') return <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>
  return typeof value === 'number' ? <Input aria-label={label} type='number' value={value} onChange={(e) => onChange(Number(e.target.value))} /> : <Textarea aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
}
export function AuthorControls({ project, target, label, value, revision, dirty, onChanged, batch = false, pathPrefix = '', suggestedChanges }: { project: string; target: string; label: string; value: any; revision?: string; dirty: boolean; onChanged: (value: any, result: any) => void; batch?: boolean; pathPrefix?: string; suggestedChanges?: Record<string, any> }) {
  const { data, error, mutate, lockedPaths } = useAuthorControl(project, target)
  const { data: materials } = useSWR(`/api/projects/${project}/materials`, api.get)
  const names: Record<string, string> = Object.fromEntries((Array.isArray(materials) ? materials : []).map((item: any) => [item.id, item.label]))
  const { data: cards } = useSWR(batch ? `/api/projects/${project}/cards` : null, api.get)
  const [paths, setPaths] = useState<string[]>([pathPrefix || '/'])
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [fieldQuery, setFieldQuery] = useState('')
  const [reason, setReason] = useState('')
  const [amendmentState, setAmendmentState] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const scope = `${project}:${target}:${pathPrefix || '/'}`
  const amendment = amendmentState?.scope === scope ? amendmentState.value : null
  const setAmendment = (value: any) => setAmendmentState({ scope, value })
  const active = useRef(scope); active.current = scope
  const latest = useRef(amendment); latest.current = amendment
  const latestValue = useRef(value); latestValue.current = value
  const fields = [{ path: pathPrefix || '/', label: `整份${label}` }, ...safeFields(value, pathPrefix)]
  const topField = (path: string) => path === (pathPrefix || '/') || (pathPrefix ? path.slice(pathPrefix.length + 1).split('/').length === 1 : path.split('/').filter(Boolean).length === 1 || /^\/payload\/[^/]+$/.test(path))
  const fieldChoice = (field: { path: string; label: string }) => <label key={field.path} className='flex items-start gap-2 text-xs leading-6'><input type='checkbox' checked={paths.includes(field.path)} onChange={(e) => setPaths(e.target.checked ? field.path === (pathPrefix || '/') ? [pathPrefix || '/'] : [...paths.filter((p) => p !== (pathPrefix || '/')), field.path] : paths.filter((p) => p !== field.path))} />{field.label}{pointerLocked(lockedPaths, field.path) ? '（已锁定）' : ''}</label>
  useEffect(() => { setBatchIds([]); setFieldQuery(''); setPaths([pathPrefix || '/']); setReason(''); setMessage(''); setBusy(''); try { setAmendment(JSON.parse(localStorage.getItem(`novix:amendment:${scope}`) || 'null')) } catch { setAmendment(null) } }, [scope])
  useEffect(() => { if (amendment) localStorage.setItem(`novix:amendment:${scope}`, JSON.stringify(amendment)) }, [scope, amendment])
  const act = async (action: 'lock' | 'create' | 'save' | 'apply' | 'restore', batchLock = false) => {
    const before = JSON.stringify(latest.current); const valueBefore = JSON.stringify(value); const held = scope
    setBusy(action); setMessage('')
    try {
      if (['lock', 'create'].includes(action) && dirty) throw new Error('请先保存当前编辑，再确认锁定或指定修改。未保存稿仍保留。')
      let result: any
      if (action === 'lock') result = await api.post(`/api/projects/${project}/author-controls/lock`, { targets: batchLock ? (cards || []).filter((card: any) => card.id !== 'outline_author_registry' && batchIds.includes(card.id)).map((card: any) => ({ target: `cards/${card.id}.yaml`, paths: ['/'], base_revision: card._revision })) : [{ target, paths, base_revision: revision ?? data?.base_revision ?? '' }], control_revision: data?.revision, reason })
      else if (action === 'create') result = await api.post(`/api/projects/${project}/author-controls/amendments`, { target, paths, base_revision: revision ?? data?.base_revision ?? '', control_revision: data?.revision, reason })
      else {
        let heldDraft = latest.current
        if (action === 'save' || action === 'apply' && heldDraft.status === 'draft') heldDraft = await api.put(`/api/projects/${project}/author-controls/amendments/${heldDraft.id}`, { revision: heldDraft.revision, changes: heldDraft.changes })
        result = action === 'save' ? heldDraft : await api.post(`/api/projects/${project}/author-controls/amendments/${heldDraft.id}/${action}`, { revision: heldDraft.revision })
      }
      if (active.current !== held) return
      if (action !== 'lock' && before !== JSON.stringify(latest.current)) { setMessage('等待期间你又修改了工作稿，编辑已保留，请重新核对保存。'); return }
      if (action !== 'lock') setAmendment(action === 'create' && suggestedChanges ? { ...result, changes: { ...result.changes, ...Object.fromEntries(Object.entries(suggestedChanges).filter(([path]) => paths.includes(path))) } } : result)
      await mutate(); void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /cards|materials|author-controls/.test(key))
      if (active.current !== held) return
      if (action === 'apply' || action === 'restore') { if (JSON.stringify(latestValue.current) !== valueBefore) { setMessage('指定范围已保存，等待期间的新编辑仍保留在原表单，请先核对再保存。'); return }; await onChanged(result.value, result) }
      const followup = result.change_suggestions?.queued_count ? ` 已排 ${result.change_suggestions.queued_count} 份受影响正文建议，需另行核对。` : result.warning || result.change_suggestions?.error || ''; setMessage((action === 'lock' ? '所选保存版已确认锁定，后续导入与生成不能覆盖。' : action === 'create' ? '指定修改稿已建立。原锁仍有效，只会修改所选范围。' : action === 'save' ? '指定修改稿已保存，正式资料未变。' : action === 'apply' ? '指定范围已保存并继续锁定，其他资料保留。' : '本次修改已按范围恢复，后续无关编辑保留。') + followup)
    } catch (cause) { if (active.current === held) { setMessage(cause instanceof Error ? cause.message : '操作未完成，工作稿保留。'); if (latest.current?.id && ['apply', 'restore'].includes(action)) { try { const fresh = await api.get(`/api/projects/${project}/author-controls/amendments/${latest.current.id}`); if (active.current === held && before === JSON.stringify(latest.current)) setAmendment(fresh) } catch { /* Preserve the local amendment when recovery cannot be read. */ } } } }
    finally { if (active.current === held) setBusy('') }
  }
  return <details className='author-controls'><summary className='cursor-pointer text-sm text-brand-600'>{lockedPaths.length ? '已确认锁定 · 指定范围修改' : '确认与锁定保存版'}</summary><div className='mt-4 space-y-4'>
    <p className='text-xs leading-6 text-muted'>锁定保留正式设定；后续发展另记阶段。指定修改只改选定内容，确认后仍锁定。</p>
    {error && <p role='alert' className='text-sm text-muted'>锁定状态暂时无法读取，请重新打开或稍后重试。</p>}
    <fieldset className='space-y-2'><legend className='mb-2 text-sm font-medium'>选择范围</legend>{fields.filter((field) => topField(field.path)).map(fieldChoice)}{fields.some((field) => !topField(field.path)) && <details className='pt-2'><summary className='cursor-pointer text-xs text-muted'>具体条目与字段{paths.some((path) => !topField(path)) ? '（已选）' : ''}</summary><div className='mt-3 space-y-3'><Input aria-label='查找要锁定或修改的字段' placeholder='按场景、章节或字段名称查找' value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} /><div className='max-h-60 space-y-2 overflow-auto'>{fields.filter((field) => !topField(field.path) && (!fieldQuery || field.label.includes(fieldQuery))).map(fieldChoice)}</div></div></details>}</fieldset>
    <Input aria-label='确认或修改的原因' value={reason} onChange={(e) => setReason(e.target.value)} placeholder='可说明为何确认，或这次只准备修改什么。' />
    <div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy) || dirty || !paths.length || !data} onClick={() => act('lock')}>确认并锁定所选范围</Button><Button disabled={Boolean(busy) || dirty || !paths.length || !data} onClick={() => act('create')}>只修改所选范围</Button></div>{dirty && <p className='text-xs text-muted'>当前还有未保存编辑，请先保存；锁定只适用于保存版。</p>}
    {batch && <details><summary className='cursor-pointer text-xs text-muted'>批量确认整份资料</summary><div className='mt-3 max-h-44 space-y-2 overflow-auto'>{(Array.isArray(cards) ? cards : []).filter((card: any) => ['story', 'world', 'character', 'style', 'outline'].includes(card.type) && card.id !== 'outline_author_registry').map((card: any) => <label key={card.id} className='flex gap-2 text-xs'><input type='checkbox' checked={batchIds.includes(card.id)} onChange={(e) => setBatchIds(e.target.checked ? [...batchIds, card.id] : batchIds.filter((id) => id !== card.id))} />{card.payload?.name || card.title || '未命名资料'}</label>)}</div><Button className='mt-3 text-xs' disabled={Boolean(busy) || !batchIds.length} onClick={() => act('lock', true)}>锁定所选资料的保存版</Button></details>}
    {data?.history?.length > 0 && <details><summary className='cursor-pointer text-xs text-muted'>以往的指定修改与恢复</summary><div className='mt-2 space-y-2'>{Array.from(new Map<string, any>(data.history.slice().reverse().map((item: any) => [item.id, item])).values()).map((item: any) => <Button key={item.id} className='text-xs' disabled={Boolean(busy)} onClick={async () => { const held = scope; setBusy('history'); try { const previous = await api.get(`/api/projects/${project}/author-controls/amendments/${item.id}`); if (active.current === held) { setAmendment(previous); setMessage('已打开原指定修改记录，可查看前后内容与恢复条件。') } } catch (error) { if (active.current === held) setMessage(error instanceof Error ? error.message : '记录暂时无法读取。') } finally { if (active.current === held) setBusy('') } }}>{item.reason || '一次指定修改'}{item.created_at ? ` · ${new Date(item.created_at).toLocaleString()}` : ''}</Button>)}</div></details>}
    {amendment && <section className='space-y-3' aria-label='指定修改工作稿'><h4 className='text-sm font-semibold'>指定修改工作稿</h4><p className='text-xs leading-6 text-muted'>关联对象与来源保留原值；如需更换关联，请回原资料入口选择。</p>{Object.entries(amendment.changes || amendment.before || {}).map(([path, change]) => <div key={path} className='space-y-2'><h5 className='text-sm font-medium'>{fields.find((field) => field.path === path)?.label || '选定内容'}</h5><details><summary className='cursor-pointer text-xs text-muted'>修改前内容</summary><div className='mt-2'><fieldset disabled><ValueEditor names={names} cardType={value?.type} path={path} field={path.split('/').slice(-1)[0]} label='修改前内容' value={amendment.before?.[path]} onChange={() => {}} /></fieldset></div></details><fieldset disabled={amendment.status !== 'draft'}><ValueEditor names={names} cardType={value?.type} path={path} field={path.split('/').slice(-1)[0]} label='指定修改后的内容' value={change} onChange={(next) => setAmendment({ ...amendment, changes: { ...amendment.changes, [path]: next } })} /></fieldset></div>)}{amendment.impacts && <details><summary className='cursor-pointer text-xs text-muted'>查看关联影响</summary><p className='mt-2 text-xs leading-6 text-muted'>{Array.isArray(amendment.impacts) ? amendment.impacts.map((item: any) => item.label || item.reason || '有关联资料需核对').join('；') : amendment.impacts.notice || '确认后请核对关联人物、历史和正文，不会自动重写它们。'}</p></details>}<div className='flex flex-wrap gap-2'>{['draft', 'applying'].includes(amendment.status) && <>{amendment.status === 'draft' && <Button disabled={Boolean(busy)} onClick={() => act('save')}>保存修改稿</Button>}<Button variant='primary' disabled={Boolean(busy) || dirty} onClick={() => act('apply')}>{amendment.status === 'applying' ? '重试完成指定修改' : '确认指定修改并保持锁定'}</Button></>}{amendment.status === 'restored' && <p className='text-xs text-muted'>本次已恢复，正式锁仍保留；需要再改可新建指定修改。</p>}{['applied', 'restoring'].includes(amendment.status) && <Button disabled={Boolean(busy) || dirty} onClick={() => act('restore')}>{amendment.status === 'restoring' ? '重试完成恢复' : '恢复本次修改前的选定内容'}</Button>}</div></section>}
    {busy && <p className='text-xs text-muted'>正在处理…</p>}{message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}
  </div></details>
}
