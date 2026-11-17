import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { SchemaForm } from './SchemaForm'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Fields'
import { AuthorControls, useAuthorControl, pointerLocked } from './AuthorControls'
import { WorldMaps } from './WorldMaps'
import { WorldExtras } from './WorldExtras'
import { cardAfterSave, useDraftRecovery } from '../lib/editorDrafts'
import { OpenMaterial } from './MaterialReferences'

export function CardEditor({ project, type, profileId, onSaved, draftCache, referenceRequest, onOpenMaterial, focusRequest, pendingCandidate, onCandidateCleared, sampleIds = [], onActiveCardChange }: { project: string; type: 'world' | 'style'; profileId?: string; onSaved?: () => void; draftCache?: { current: Record<string, any> }; referenceRequest?: { type: string; cardId: string; referenceId: string; requestId: number } | null; onOpenMaterial?: OpenMaterial; focusRequest?: { id: string; requestId: number } | null; pendingCandidate?: any; onCandidateCleared?: () => void; sampleIds?: string[]; onActiveCardChange?: (id: string) => void }) {
  const { data, error: readError, mutate } = useSWR(`/api/projects/${project}/cards?type=${type}`, api.get)
  const { data: schema } = useSWR(`/api/schema/cards/${type}`, api.get)
  const [sampleText, setSampleText] = useState('')
  const [candidate, setCandidate] = useState<any>(null)
  useEffect(() => { setCandidate(pendingCandidate?.candidate || null) }, [pendingCandidate])
  const [form, setForm] = useState<any>(null)
  useEffect(() => { onActiveCardChange?.(form?.id || '') }, [project, form?.id])
  const formScope = useRef(`${project}:${type}`)
  const latestForm = useRef(form)
  latestForm.current = form
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const appliedRequest = useRef(0)
  const openedRequest = useRef(0)
  const savedCards = useRef<Record<string, string>>({})
  const rows = Array.isArray(data) ? data : []
  const draftKey = `${project}:${type}:${form?.id || 'new'}`
  const localDraft = useDraftRecovery(draftKey, formScope.current === `${project}:${type}` ? form : null, JSON.stringify(rows.find((row: any) => row.id === form?.id) || {}), setForm)
  const { lockedPaths } = useAuthorControl(project, form?.id ? `cards/${form.id}.yaml` : undefined)
  let mapWorld = form; const mapVisited = new Set<string>(); while (mapWorld?.payload?.parent_id && !mapVisited.has(mapWorld.id)) { mapVisited.add(mapWorld.id); const parent = rows.find((row: any) => row.id === mapWorld.payload.parent_id); if (!parent) break; mapWorld = parent }
  const label = type === 'world' ? '世界观' : '文风'
  const newCard = () => ({ id: '', type, title: '', tags: [], links: [], payload: {} })
  useEffect(() => {
    for (const row of rows) {
      const key = `${project}:${type}:${row.id}`
      const before = savedCards.current[key]
      if (before) setForm((current: any) => current?.id === row.id && JSON.stringify(current) === before ? row : current)
      savedCards.current[key] = JSON.stringify(row)
    }
  }, [data, project, type])
  useEffect(() => { formScope.current = `${project}:${type}`; setForm(null); setMessage('') }, [project, type])
  if (form && draftCache && formScope.current === `${project}:${type}`) {
    draftCache.current[`${project}:${type}:${form.id || 'new'}`] = form
    draftCache.current[`${project}:${type}:selected`] = form.id || 'new'
  }
  useEffect(() => {
    if (!focusRequest || openedRequest.current === focusRequest.requestId || !Array.isArray(data)) return
    const card = draftCache?.current[`${project}:${type}:${focusRequest.id}`] || rows.find((row: any) => row.id === focusRequest.id)
    if (card) { setForm(card); openedRequest.current = focusRequest.requestId }
  }, [focusRequest, data, project, type])
  useEffect(() => {
    if (!form && Array.isArray(data)) {
      const selectedId = draftCache?.current[`${project}:${type}:selected`]
      setForm(draftCache?.current[`${project}:${type}:${selectedId}`] || data[0] || newCard())
    }
  }, [data, form, project, type])
  useEffect(() => {
    if (referenceRequest?.type !== type || appliedRequest.current === referenceRequest.requestId || draftCache?.current[`${project}:${type}:appliedReferenceRequest`] === referenceRequest.requestId || !Array.isArray(data)) return
    const card = draftCache?.current[`${project}:${type}:${referenceRequest.cardId}`] || rows.find((row: any) => row.id === referenceRequest.cardId)
    if (!card) { setMessage('没有找到目标卡片，请重新选择。'); return }
    const ids = Array.isArray(card.payload?.writing_references) ? card.payload.writing_references : []
    setForm({ ...card, payload: { ...card.payload, writing_references: [...new Set([...ids, referenceRequest.referenceId])] } })
    appliedRequest.current = referenceRequest.requestId
    if (draftCache) draftCache.current[`${project}:${type}:appliedReferenceRequest`] = referenceRequest.requestId
    setMessage('已加入当前表单，请保存这张卡片。')
  }, [referenceRequest, data, project, type])
  const save = async () => {
    if (!form?.title?.trim()) { setMessage('请先填写名称。'); return }
    const saveScope = `${project}:${type}`
    setBusy(true)
    setMessage('')
    try {
      const snapshot = JSON.stringify(form)
      const body = { ...form, id: form.id || `${type}_${crypto.randomUUID().slice(0, 10)}`, type }
      const result = await api.put(`/api/projects/${project}/cards/${body.id}`, body)
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '保存失败，请重试。')
      if (formScope.current !== saveScope) return
      const editedDuringSave = JSON.stringify(latestForm.current) !== snapshot
      setForm((current: any) => cardAfterSave(current, body, result, snapshot))
      localDraft.markSaved(form, cardAfterSave(form, body, result, snapshot))
      await mutate()
      onSaved?.()
      setMessage(result.change_suggestions?.error ? `设定已保存；${result.change_suggestions.error}` : editedDuringSave ? '已保存提交时的内容；之后的编辑请再次保存。' : '已保存，后续 AI 会读取这份最新设定。受影响正文的建议可到章节页查看。')
    } catch (err) { if (formScope.current === saveScope) setMessage(err instanceof Error ? err.message : '保存失败，请重试。') }
    finally { if (formScope.current === saveScope) setBusy(false) }
  }
  return <section className='space-y-3' aria-label={`${label}卡片`}>
    {localDraft.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>找到这张卡的本地未保存稿。</p><div className='flex gap-2'><Button onClick={localDraft.restore}>恢复草稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留保存版</Button></div></div>}
    <div className='flex flex-wrap items-end gap-2'>
      <div className='min-w-40 flex-1'>
        <label htmlFor={`${type}-card-select`} className='text-sm text-muted'>选择{label}</label>
        <Select disabled={busy} id={`${type}-card-select`} value={form?.id || ''} onChange={(e) => { setForm(draftCache?.current[`${project}:${type}:${e.target.value}`] || rows.find((row: any) => row.id === e.target.value) || newCard()); setMessage('') }}>
          {!form?.id && <option value=''>新{label}</option>}
          {rows.map((row: any) => <option key={row.id} value={row.id}>{row.title || `未命名${label}`}</option>)}
        </Select>
      </div>
      <Button disabled={busy} onClick={() => { setForm(newCard()); setMessage('') }}>新建{label}</Button>
    </div>
    {type === 'style' && form && <section className='space-y-4 border-y border-border py-4'><h2 className='text-lg font-semibold'>选择文风的基调</h2><div><label className='mb-1 block text-sm text-muted' htmlFor='style-tone-choice'>整体表达</label><Select disabled={pointerLocked(lockedPaths, '/payload/tone')} id='style-tone-choice' value={['清晰自然', '克制冷静', '轻快灵动', '温柔细腻', '紧张凌厉', '古典凝练'].includes(form.payload?.tone) ? form.payload.tone : ''} onChange={(e) => setForm({ ...form, payload: { ...form.payload, tone: e.target.value } })}><option value=''>自定义 / 暂未选择</option>{['清晰自然', '克制冷静', '轻快灵动', '温柔细腻', '紧张凌厉', '古典凝练'].map((tone) => <option key={tone} value={tone}>{tone}</option>)}</Select>{!['清晰自然', '克制冷静', '轻快灵动', '温柔细腻', '紧张凌厉', '古典凝练'].includes(form.payload?.tone) && <Input className='mt-2' aria-label='自定义文风表达' readOnly={pointerLocked(lockedPaths, '/payload/tone')} value={form.payload?.tone || ''} onChange={(e) => setForm({ ...form, payload: { ...form.payload, tone: e.target.value } })} placeholder='写下你希望的表达基调' />}<p className='mt-2 text-xs leading-6 text-muted'>{({ 清晰自然: '例：他放下信，等她把话说完。', 克制冷静: '例：信已拆开。他没有再问。', 轻快灵动: '例：信才拆了一半，她就笑出了声。', 温柔细腻: '例：他把信折回原处，指尖留住那一点余温。', 紧张凌厉: '例：纸页一响，他已回头。门外停了一双脚。', 古典凝练: '例：灯将尽，信未终，夜雨渐深。' } as Record<string, string>)[form.payload?.tone] || '可在下方自由写自己的文风，不必套用选项。'} 短例仅说明写法，不是作者样本。</p></div><div><label className='mb-1 block text-sm text-muted' htmlFor='style-pov'>默认叙述视角</label><Select disabled={pointerLocked(lockedPaths, '/payload/style_guide/pov')} id='style-pov' value={form.payload?.style_guide?.pov || ''} onChange={(e) => setForm({ ...form, payload: { ...form.payload, style_guide: { ...form.payload?.style_guide, pov: e.target.value } } })}><option value=''>未指定，可自定义</option><option value='第一人称'>第一人称</option><option value='第三人称有限视角'>第三人称有限视角</option><option value='第三人称全知视角'>第三人称全知视角</option><option value='多人物有限视角'>多人物有限视角</option></Select>{!['第一人称', '第三人称有限视角', '第三人称全知视角', '多人物有限视角'].includes(form.payload?.style_guide?.pov) && <Input readOnly={pointerLocked(lockedPaths, '/payload/style_guide/pov')} className='mt-2' aria-label='自定义默认视角' value={form.payload?.style_guide?.pov || ''} onChange={(e) => setForm({ ...form, payload: { ...form.payload, style_guide: { ...form.payload?.style_guide, pov: e.target.value } } })} placeholder='可写具体人物与视角限制；章节、场景可覆盖。' />}</div></section>}
    {candidate && <section className='space-y-4 border-y border-border py-4' aria-label='待确认的样本文风候选'><h3 className='font-semibold'>从原样本归纳的文风候选</h3><p className='text-xs leading-6 text-muted'>分析不会自动写卡。先编辑和确认，再保存；AI 自创短例与作者原文样本分开。</p><SchemaForm schema={schema} value={candidate} onChange={setCandidate} />{(pendingCandidate?.evidence || []).map((item: any, index: number) => <blockquote key={index} className='text-xs leading-6 text-muted'>{item.quote || item.text}</blockquote>)}{pendingCandidate?.formSnapshot && JSON.stringify(form) !== pendingCandidate.formSnapshot && <p className='text-xs text-muted'>分析开始后你又编辑了这张卡，旧候选不会覆盖当前表单。可以重新分析或先保存并核对。</p>}<div className='flex gap-2'><Button variant='primary' disabled={busy || Boolean(form?.id && candidate?.id !== form.id || pendingCandidate?.formSnapshot && JSON.stringify(form) !== pendingCandidate.formSnapshot)} onClick={() => { setForm({ ...candidate, _revision: pendingCandidate.base_revision ?? candidate._revision ?? '', _source_versions: pendingCandidate.source_versions }); setCandidate(null); onCandidateCleared?.(); setMessage('文风候选已放入表单，可继续修改；保存后才生效。') }}>采用到表单，再保存</Button><Button variant='ghost' onClick={() => { setCandidate(null); onCandidateCleared?.() }}>保留原文风</Button></div></section>}
    {readError ? <div className='space-y-2'><p role='alert' className='text-sm text-muted'>原资料暂时无法读取，已有编辑保留。</p><Button onClick={() => { void mutate().catch(() => undefined) }}>重新读取</Button></div> : schema && form ? <SchemaForm hiddenFields={type === 'style' ? ['tone', 'pov', 'active_style_sample_asset_ids', 'injection_policy'] : []} lockedPaths={lockedPaths} schema={schema} value={form} onChange={setForm} projectId={project} profileId={profileId} onOpenMaterial={onOpenMaterial} /> : <p className='text-sm text-muted'>正在读取{label}…</p>}
    {type === 'style' && form && <details><summary className='cursor-pointer text-sm text-muted'>原文样本与使用偏好</summary><div className='mt-3 space-y-3'><p className='text-xs leading-6 text-muted'>原样本来自作者提供的材料；示例句只说明写法，不充当原文依据。</p>{[...new Set([...(form.payload?.active_style_sample_asset_ids || []), ...sampleIds])].map((id: string, index) => <div key={id} className='flex flex-wrap items-center gap-2'><label className='flex gap-2 text-xs'><input type='checkbox' checked={(form.payload?.active_style_sample_asset_ids || []).includes(id)} onChange={(e) => setForm({ ...form, payload: { ...form.payload, active_style_sample_asset_ids: e.target.checked ? [...(form.payload?.active_style_sample_asset_ids || []), id] : form.payload.active_style_sample_asset_ids.filter((key: string) => key !== id) } })} />作者原文样本 {index + 1}</label><Button variant='ghost' className='text-xs' onClick={async () => { try { const result = await api.get(`/api/projects/${project}/assets/${id}?kind=style_sample`); setSampleText(result.content || '这个样本没有可读文字。') } catch (error) { setMessage(error instanceof Error ? error.message : '原文暂时未能读取。') } }}>回看原文</Button></div>)}{sampleText && <blockquote className='max-h-60 overflow-auto whitespace-pre-wrap text-xs leading-7 text-muted'>{sampleText}</blockquote>}{[['max_examples', '最多参考几段', 3], ['max_chars_per_example', '每段最多字数', 600]].map(([key, label, defaultValue]) => <div key={String(key)}><label className='mb-1 block text-xs text-muted'>{String(label)}</label><Input type='number' min={0} value={form.payload?.injection_policy?.[String(key)] ?? defaultValue} onChange={(e) => setForm({ ...form, payload: { ...form.payload, injection_policy: { ...form.payload.injection_policy, [String(key)]: Number(e.target.value) } } })} /></div>)}<p className='text-xs text-muted'>样本选择与偏好随文风保存。</p></div></details>}
    {type === 'world' && form && <WorldMaps project={project} cardId={form.id} worldId={mapWorld?.id} value={form.payload?.maps || []} onChange={(maps) => setForm({ ...form, payload: { ...form.payload, maps, field_provenance: { ...form.payload.field_provenance, maps: 'author_edit' } } })} lockedPaths={lockedPaths} saved={rows.some((row: any) => row.id === form.id)} onOpen={onOpenMaterial} profileId={profileId} />}
    {type === 'world' && form && <WorldExtras value={form.payload?.extra_context} onChange={(extra) => setForm({ ...form, payload: { ...form.payload, extra_context: extra } })} />}
    {form?.id && <AuthorControls key={`${project}:${form.id}:lock`} project={project} target={`cards/${form.id}.yaml`} label={label} value={form} revision={form._revision} dirty={localDraft.dirty} onChanged={(value, result) => { const next = { ...value, _revision: result.base_revision }; setForm(next); localDraft.markSaved(form, next); void mutate(); onSaved?.() }} />}
    <div className='flex flex-wrap items-center gap-3'>
      <Button variant='primary' disabled={busy || !form} onClick={save}>{busy ? '保存中…' : `保存${label}`}</Button>
      {!message && form && <p className='text-xs text-muted'>{localDraft.dirty ? '有尚未保存的编辑' : '已读取保存版'}</p>}
      {message && <p role='status' className='text-sm text-muted'>{message}</p>}
    </div>
  </section>
}
