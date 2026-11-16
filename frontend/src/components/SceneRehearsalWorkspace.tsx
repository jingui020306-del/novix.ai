import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate as mutateCache } from 'swr'
import { api } from '../api/client'
import { rehearsalDraft, rehearsalKey, rehearsalSourcesChanged, RehearsalDraft } from '../lib/sceneRehearsal'
import { useDraftRecovery } from '../lib/editorDrafts'
import { InformationPanel } from './InformationPanel'
import { AuthorControls } from './AuthorControls'
import { referenceLabel } from '../lib/writingReferences'
import { OpenMaterial } from './MaterialReferences'
import { WritingReferencePanel, WritingReferencePicker } from './WritingReferencePicker'
import { TokenUsage } from './WritingTools'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Fields'

type WorkingCopy = { draft: RehearsalDraft; baseline: RehearsalDraft; baseHash: string; remoteHash: string; versions: Record<string, string>; remoteVersions: Record<string, string>; origin?: string }
type Preview = { input: string; response: any }

export function SceneRehearsalWorkspace({ project, ownerCardId, sceneId, sceneLabel, profileId, draftCache, onBack, onConfirmed, onOpenMaterial, onOpenSettings, backLabel = '返回情节工作表' }: {
  project: string; ownerCardId: string; sceneId: string; sceneLabel: string; profileId?: string;
  draftCache: { current: Record<string, any> }; onBack: () => void; onConfirmed: (result: any) => void;
  onOpenMaterial?: OpenMaterial; onOpenSettings?: () => void;
  backLabel?: string;
}) {
  const endpoint = `/api/projects/${project}/scene-rehearsals/${encodeURIComponent(ownerCardId)}/${encodeURIComponent(sceneId)}`
  const { data, error: readError, mutate } = useSWR(endpoint, api.get, { refreshInterval: 8000 })
  const { data: techniqueCards } = useSWR(`/api/projects/${project}/cards?type=technique`, api.get)
  const cacheKey = `${project}:${ownerCardId}:${sceneId}:rehearsalDraft`
  const [working, setWorking] = useState<WorkingCopy | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [proposal, setProposal] = useState<any>(null)
  const [editing, setEditing] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [informationSelection, setInformationSelection] = useState<string[] | null>(null)
  const [instructions, setInstructions] = useState('')
  const [actorId, setActorId] = useState('')
  const [witnessId, setWitnessId] = useState('')
  const [priority, setPriority] = useState('goal')
  const [pressure, setPressure] = useState(0)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const requestNumber = useRef(0)
  const latest = useRef(working)
  latest.current = working
  if (working) draftCache.current[cacheKey] = { ...working, instructions }
  useEffect(() => {
    if (!data?.draft || working) return
    const cached = draftCache.current[cacheKey]
    setWorking(cached ? { ...cached, remoteVersions: cached.remoteVersions || cached.versions || {}, draft: rehearsalDraft(cached.draft), baseline: rehearsalDraft(cached.baseline) } : { draft: rehearsalDraft(data.draft), baseline: rehearsalDraft(data.baseline), baseHash: data.base_hash, remoteHash: data.base_hash, versions: data.source_versions || {}, remoteVersions: data.source_versions || {}, origin: data.origin })
    if (cached?.instructions) setInstructions(cached.instructions)
  }, [data, cacheKey, working])
  useEffect(() => () => { requestNumber.current++ }, [cacheKey])
  useEffect(() => { document.getElementById('scene-rehearsal-workspace')?.scrollIntoView({ block: 'start' }) }, [cacheKey])
  const localDraft = useDraftRecovery(cacheKey, working ? { ...working, instructions } : null, working ? JSON.stringify({ ...working, draft: working.baseline, instructions }) : '', (value) => { const { instructions: restoredInstructions, ...copy } = value; setWorking(copy); setInstructions(restoredInstructions || ''); setEditing(true) })
  const context = data?.context || {}
  const actors = (context.characters || []).filter((row: any) => (context.cast_ids || []).includes(row.id))
  const actor = actors.some((row: any) => row.id === actorId) ? actorId : actors[0]?.id || ''
  const witness = actors.some((row: any) => row.id === witnessId && row.id !== actor) ? witnessId : ''
  const rehearsalPointer = `/payload/important_scenes/${context.scene?.values?.id ? `@${context.scene.values.id}` : Number(String(data?.scene_id || sceneId).replace('index_', ''))}/rehearsal`
  const changedSources = Boolean(working && data?.base_hash && (data.base_hash !== working.remoteHash || rehearsalSourcesChanged(working.remoteVersions, data.source_versions)))
  const needsReview = conflict || changedSources
  const draft = working?.draft || rehearsalDraft()
  const edit = (patch: Partial<RehearsalDraft>) => setWorking((current) => current ? { ...current, draft: { ...current.draft, ...('text' in patch || 'outcome' in patch ? {choice_trace: undefined} : {}), ...patch }, origin: 'manual' } : current)
  const techniqueName = (id: string) => referenceLabel((Array.isArray(techniqueCards) ? techniqueCards : []).find((card: any) => card.id === id), id)
  const request = async (action: 'preview' | 'propose' | 'confirm' | 'local-choice') => {
    if (!working) return
    const number = ++requestNumber.current
    const before = rehearsalKey(working.draft)
    setBusy(action); setError(''); setMessage('')
    try {
      const response = await fetch(`${endpoint}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: working.draft, base_hash: working.baseHash, source_versions: working.versions, ...(action === 'local-choice' ? {actor_id: actor, witness_id: witness, priority, pressure, instructions} : {}), ...(action === 'propose' ? { instructions, llm_profile_id: profileId } : {}) }) })
      const result = await response.json()
      if (!response.ok || result.detail) {
        if (response.status === 409) { setConflict(true); void mutate().catch(() => undefined); throw new Error('来源资料或已采用安排发生了变化。你的手稿已保留，请先核对最新资料，再预览确认。') }
        throw new Error(typeof result.detail === 'string' ? result.detail : '本次操作未完成，请重试。')
      }
      if (number !== requestNumber.current) return
      if (action === 'confirm') onConfirmed(result)
      if (action !== 'confirm' && rehearsalKey(latest.current?.draft) !== before) { setMessage('你在等待期间修改了手稿，已保留当前编辑。请按最新选择重新预览或推演。'); return }
      if (action === 'propose' || action === 'local-choice') {
        setProposal({ response: result, input: before, draft: rehearsalDraft(result.draft) })
        setMessage('候选已生成，可编辑后采用。')
      } else if (action === 'preview') {
        setWorking((current) => current ? { ...current, baseHash: result.base_hash, versions: result.source_versions || current.versions } : current)
        setPreview({ input: before, response: result }); setConflict(false)
        setMessage('变化与已有引用范围已整理。这里没有新增模型调用，文学后果仍需作者判断。')
      } else {
        const refreshed = await mutate().catch(() => null)
        if (number !== requestNumber.current) return
        const saved = rehearsalDraft(result.saved || result.draft)
        const editedWhileSaving = rehearsalKey(latest.current?.draft) !== before
        setWorking((current) => ({ draft: editedWhileSaving && current ? current.draft : saved, baseline: saved, baseHash: result.base_hash, remoteHash: refreshed?.base_hash || result.base_hash, versions: result.source_versions || {}, remoteVersions: refreshed?.source_versions || result.source_versions || {}, origin: editedWhileSaving ? 'manual' : 'saved' }))
        localDraft.markSaved({ ...working, instructions }, { ...working, draft: saved, baseline: saved, instructions })
        setPreview(null); setProposal(null); setConflict(false); setEditing(editedWhileSaving)
        const queued = result.change_suggestions?.queued_count || 0
        const savedMessage = result.change_suggestions?.error ? `本场安排已保存；${result.change_suggestions.error}` : queued ? `本场安排已采用，已排队 ${queued} 项正文修改建议，仍需逐项确认。` : '本场安排已采用，章节会引用同一份摘要。已有正文保持原样。'
        setMessage(`${savedMessage}${editedWhileSaving ? ' 等待期间的新编辑仍在当前手稿中，尚未采用，请重新预览确认。' : ''}${!refreshed ? ' 最新资料暂时未能重读，可稍后重试。' : ''}`)
      }
    } catch (cause) { if (number === requestNumber.current) setError(cause instanceof Error ? cause.message : '操作失败，原手稿已保留。') }
    finally { if (number === requestNumber.current) setBusy('') }
  }
  const useLatestSources = async () => {
    setError(''); setMessage('')
    let fresh
    try { fresh = await mutate() } catch { setError('最新资料暂时无法读取，当前手稿保留。'); return }
    if (!fresh?.base_hash) { setError('最新资料暂时无法读取，当前手稿保留。'); return }
    setWorking((current) => current ? { ...current, baseline: rehearsalDraft(fresh.baseline), baseHash: fresh.base_hash, remoteHash: fresh.base_hash, versions: fresh.source_versions || {}, remoteVersions: fresh.source_versions || {} } : current)
    setPreview(null); setProposal(null); setConflict(false)
    setMessage('已读取最新依据，你写的手稿没有替换。请结合右侧资料核对，再预览变化。')
  }
  const acceptProposal = () => {
    if (!proposal || !working || proposal.input !== rehearsalKey(working.draft) || needsReview) return
    setWorking({ ...working, draft: rehearsalDraft(proposal.draft), baseHash: proposal.response.base_hash, versions: proposal.response.source_versions || working.versions, origin: proposal.response.basis === 'local_candidate' ? 'local' : 'ai' })
    setProposal(null); setPreview(null); setEditing(true)
    setMessage('候选已放入当前手稿，可继续修改。预览变化并确认后才保存本场安排。')
  }
  const applications = (draft.technique_applications || []).filter((row) => draft.technique_ids.includes(row.technique_id))
  const canConfirm = Boolean(preview && working && preview.input === rehearsalKey(draft) && !needsReview && draft.text.trim())
  const sourceLink = (id: string, label: string, type?: string) => onOpenMaterial ? <button className='text-left text-brand-600 hover:underline focus-ring' onClick={() => onOpenMaterial({ id, type })}>{label}</button> : <span>{label}</span>
  const compareTechniques = (value: any) => {
    const version = rehearsalDraft(value)
    return version.technique_ids.length ? <ul className='mt-3 space-y-2 text-xs leading-6 text-muted'>{version.technique_ids.map((id) => <li key={id}><strong className='font-medium text-text'>{techniqueName(id)}</strong><p>落点：{version.technique_applications.find((row) => row.technique_id === id)?.placement || '本版尚未说明具体落点'}</p></li>)}</ul> : <p className='mt-3 text-xs text-muted'>本版未指定技法。</p>
  }
  return <div id='scene-rehearsal-workspace' className='scene-rehearsal-workspace space-y-6'>
    <header className='rehearsal-heading'><div><div className='mb-3 flex flex-wrap items-center gap-3'><Button variant='ghost' className='text-xs' disabled={busy === 'confirm'} onClick={onBack}>{backLabel}</Button><Button variant='ghost' className='text-xs' aria-expanded={referencesOpen} onClick={() => setReferencesOpen(true)}>写法参考{draft.technique_ids.length ? `（${draft.technique_ids.length}）` : ''}</Button></div><h1>{context.scene?.label || sceneLabel || '推演这一场'}</h1><p>让这一场发生的事牵动人物选择，再把后果留给下一场。推演保存为创作安排，不直接改正文。</p></div></header>
    {(readError || data?.detail) && <div className='space-y-3'><p role='alert' className='text-sm text-red-700 dark:text-red-300'>{typeof data?.detail === 'string' ? data.detail : '场景资料读取失败，已有手稿保留。可以重试或返回原表。'}</p><Button onClick={() => { void mutate().catch(() => setError('资料仍无法读取，当前手稿保留。')) }}>重新读取</Button></div>}
    {!working ? !readError && !data?.detail && <p role='status' className='text-sm text-muted'>正在联动这场情节、人物和已有安排…</p> : <>
      {(needsReview || data?.stale) && <section className='space-y-3 border-y border-border py-4'><p className='text-sm leading-7 text-muted'>{needsReview ? '来源或采用版已有更新，当前手稿没有被覆盖。' : '这场已采用安排依据的资料有变化，请核对后重新预览并确认。'}</p>{needsReview && <Button className='text-xs' onClick={useLatestSources}>核对最新资料，保留手稿</Button>}</section>}
      <div className='rehearsal-layout'>
        <section className='rehearsal-manuscript space-y-5'>
          <p className='text-xs text-muted'>{working.origin === 'saved' ? '已采用的本场安排' : working.origin === 'local' ? '本地推演稿，尚未采用' : working.origin === 'ai' ? 'AI 候选已放入手稿，尚未确认采用' : working.origin === 'manual' ? '作者手动修订，尚未确认采用' : '根据已有资料整理的起点，尚未新增文学推演'}</p>
          <section className='space-y-3'><div className='flex flex-wrap items-center justify-between gap-3'><h2 className='text-base font-semibold'>这一场怎样发生</h2><Button className='text-xs' onClick={() => setEditing(!editing)}>{editing ? '阅读手稿' : '修改关键选择'}</Button></div><p className='text-xs leading-6 text-muted'>{data?.saved ? '预览时可与已采用的安排对照。' : data?.notice || '先整理已有明确材料；新的文学走法可手写或主动请 AI 推演。'}</p>{editing ? <Textarea aria-label='本场可读推演手稿' className='rehearsal-editor' value={draft.text} onChange={(event) => edit({ text: event.target.value })} placeholder='从一个人的选择写起：他怎样行动，别人因此失去了什么选择，局势如何继续变化？' /> : draft.text.trim() ? <div className='rehearsal-reading whitespace-pre-wrap'>{draft.text}</div> : <p className='py-7 text-sm leading-7 text-muted'>写下本场安排，或展开人物选择进行推演。</p>}</section>
          <section className='space-y-4 py-4'><div><label className='mb-2 block text-sm font-medium' htmlFor='rehearsal-outcome'>这一场结束后，什么改变了？</label><Textarea id='rehearsal-outcome' value={draft.outcome} onChange={(event) => edit({ outcome: event.target.value })} placeholder='可以先留空；写具体结果，而非再重复故事主题。' /></div><div><label className='mb-2 block text-sm font-medium' htmlFor='rehearsal-next'>这个后果给下一场留下什么问题？</label><Textarea id='rehearsal-next' value={draft.next_question} onChange={(event) => edit({ next_question: event.target.value })} placeholder='例如：谁必须追过去、隐瞒什么、兑现什么？没有确定时先留空。' /></div></section>
          <WritingReferencePanel open={referencesOpen} onClose={() => setReferencesOpen(false)} title='本场写法参考'><p className='mb-4 text-xs leading-6 text-muted'>为这一场选择写法，说明它怎样参与铺势或转折。回到场景预览并确认后保存。</p><div className='space-y-4'><WritingReferencePicker project={project} techniquesOnly value={draft.technique_ids} onOpen={onOpenMaterial} onChange={(ids) => { if (ids.length > 12) { setMessage('本场最多选 12 项技法，少选并说清落点更有帮助。'); return }; edit({ technique_ids: ids, technique_applications: ids.map((id) => applications.find((row) => row.technique_id === id) || { technique_id: id, placement: '', reason: '', effect: '' }) }) }} saveHint='选技法不调用模型，也不自动编剧情。需要文学推荐时再点“请 AI 推演”。' />{draft.technique_ids.map((id) => { const application = applications.find((row) => row.technique_id === id) || { technique_id: id, placement: '', reason: '', effect: '' }; return <section key={id} className='space-y-3 border-t border-border pt-4'><h3 className='text-sm font-medium'>{techniqueName(id)}</h3>{[['placement', '落在过程的哪一处'], ['reason', '为什么适合这里，需要什么条件'], ['effect', '预期让读者感到或理解什么']].map(([key, label]) => <div key={key}><label className='mb-1 block text-xs text-muted' htmlFor={`rehearsal-${id}-${key}`}>{label}</label><Input id={`rehearsal-${id}-${key}`} value={(application as any)[key]} onChange={(event) => edit({ technique_applications: draft.technique_ids.map((tid) => tid === id ? { ...application, [key]: event.target.value } : applications.find((row) => row.technique_id === tid) || { technique_id: tid, placement: '', reason: '', effect: '' }) })} placeholder='还未决定时可留空；AI 候选会说明具体用法，仍由作者选择。' /></div>)}</section> })}</div><Button className='mt-5 text-xs' onClick={() => setReferencesOpen(false)}>回到场景，预览确认</Button></WritingReferencePanel>
          <details><summary className='cursor-pointer text-sm font-medium'>推演人物选择</summary>
            <fieldset disabled={!!busy} className='mt-3 space-y-3'>
              <div className='flex flex-wrap gap-3'>
                <label>行动者 <select value={actor} onChange={e => setActorId(e.target.value)}>{actors.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label>在场的另一人 <select value={witness} onChange={e => setWitnessId(e.target.value)}><option value=''>未指定</option>{actors.filter((p: any) => p.id !== actor).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label>眼下更看重 <select value={priority} onChange={e => setPriority(e.target.value)}><option value='goal'>争取目标</option><option value='protect'>保护自己</option><option value='understand'>弄清情况</option></select></label>
                <label>此刻压力 <select value={pressure} onChange={e => setPressure(Number(e.target.value))}><option value={0}>平静</option><option value={1}>不安</option><option value={2}>紧张</option></select></label>
              </div>
              <label className='block' htmlFor='rehearsal-instructions'>本场目标（可选）</label>
              <Textarea id='rehearsal-instructions' value={instructions} onChange={e => setInstructions(e.target.value)} placeholder='留空时沿用此人的故事线目标。' />
              <div className='flex gap-2'><Button disabled={!actor || needsReview} onClick={() => request('local-choice')}>本地推演</Button><Button disabled={needsReview} onClick={() => request('propose')}>请 AI 推演</Button></div>
              {!actor && <p className='text-xs text-muted'>先在这场情节中关联一位人物。</p>}
            </fieldset>
          </details>
          {proposal && <section className='space-y-3 border-y border-border py-5' aria-label='场景推演候选'><h2 className='text-base font-semibold'>候选安排</h2><p className='text-xs leading-6 text-muted'>{proposal.response.basis === 'local_candidate' ? '本地规则推演' : 'AI 推演'}</p><Textarea aria-label='场景过程候选' className='rehearsal-editor' value={proposal.draft.text} onChange={(event) => setProposal({ ...proposal, draft: { ...proposal.draft, choice_trace: undefined, text: event.target.value } })} /><label className='block text-xs text-muted' htmlFor='proposal-outcome'>候选的本场结果</label><Textarea id='proposal-outcome' value={proposal.draft.outcome} onChange={(event) => setProposal({ ...proposal, draft: { ...proposal.draft, choice_trace: undefined, outcome: event.target.value } })} /><label className='block text-xs text-muted' htmlFor='proposal-next'>候选引出的下场问题</label><Textarea id='proposal-next' value={proposal.draft.next_question} onChange={(event) => setProposal({ ...proposal, draft: { ...proposal.draft, next_question: event.target.value } })} />{proposal.draft.technique_applications?.length > 0 && <ul className='space-y-3 text-sm'>{proposal.draft.technique_applications.map((row: any) => <li key={row.technique_id}><strong>{techniqueName(row.technique_id)}</strong><p className='mt-1 leading-7 text-muted'>落点：{row.placement || '尚未写明'}<br />理由：{row.reason || '尚未写明'}<br />预期效果：{row.effect || '尚未写明'}</p></li>)}</ul>}<TokenUsage usage={proposal.response.usage} />{proposal.input !== rehearsalKey(draft) && <p className='text-xs text-muted'>你又修改了原手稿，这份旧候选不会覆盖它；可重新请求。</p>}<div className='flex flex-wrap gap-2'><Button disabled={proposal.input !== rehearsalKey(draft) || needsReview || !proposal.draft.text.trim()} onClick={acceptProposal}>放入当前手稿</Button><Button variant='ghost' onClick={() => setProposal(null)}>保留原稿</Button></div></section>}
          <div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy) || !draft.text.trim() || needsReview} onClick={() => request('preview')}>{busy === 'preview' ? '正在整理变化…' : '预览变化'}</Button><Button variant='primary' disabled={Boolean(busy) || !canConfirm} onClick={() => request('confirm')}>{busy === 'confirm' ? '确认中…' : '采用本场安排'}</Button></div>
          <p className='text-xs leading-6 text-muted'>预览不调用模型。确认只保存这场创作安排；若已有受影响正文，会另排修改建议并产生独立模型用量，正文需再次确认才修改。</p>
          {preview && <section className='space-y-4 border-t border-border pt-4' aria-label='本次变化与影响'><h2 className='text-base font-semibold'>本次修改牵动哪里</h2>{preview.input !== rehearsalKey(draft) && <p className='text-xs text-muted'>你在预览后又修改了手稿，请重新预览再确认。</p>}<details open><summary className='cursor-pointer text-sm font-medium'>已有引用能够确定的关联范围</summary>{preview.response.impacts?.saved_links?.length ? <ul className='mt-3 space-y-2 text-sm'>{preview.response.impacts.saved_links.map((item: any) => <li key={item.id}>{sourceLink(item.id, item.label || '关联章节', item.type)}<p className='mt-1 text-xs text-muted'>{item.reason || '已有作者引用'}</p></li>)}</ul> : <p className='mt-3 text-sm text-muted'>没有定位到已保存的章节引用；不代表文学上没有影响。</p>}</details><details open><summary className='cursor-pointer text-sm font-medium'>仍需作者判断的文学后果</summary>{preview.response.impacts?.literary?.length ? <ul className='mt-3 space-y-2 text-sm leading-7 text-muted'>{preview.response.impacts.literary.map((item: any, index: number) => <li key={index}>{item.text}</li>)}</ul> : <p className='mt-3 text-sm text-muted'>本地预览只比较已有安排，没有替你编写新的反应与后果。</p>}</details><p className='text-xs leading-6 text-muted'>{preview.response.impacts?.notice}</p><details><summary className='cursor-pointer text-sm text-brand-600'>比较采用版与当前手稿</summary><div className='rehearsal-comparison mt-4'><section><h3 className='text-sm font-medium'>原采用版</h3><div className='mt-2 whitespace-pre-wrap text-sm leading-7 text-muted'>{rehearsalDraft(preview.response.baseline).text || '还没有已采用的推演。'}</div><p className='mt-3 text-xs leading-6 text-muted'>场景结果：{preview.response.baseline?.outcome || '未写明'}<br />下场问题：{preview.response.baseline?.next_question || '未写明'}</p>{compareTechniques(preview.response.baseline)}</section><section><h3 className='text-sm font-medium'>本次手稿</h3><div className='mt-2 whitespace-pre-wrap text-sm leading-7'>{draft.text}</div><p className='mt-3 text-xs leading-6 text-muted'>场景结果：{draft.outcome || '未写明'}<br />下场问题：{draft.next_question || '未写明'}</p>{compareTechniques(draft)}</section></div></details></section>}
        </section>
        <aside className='rehearsal-context space-y-5' aria-label='本场已有资料'>
          <InformationPanel key={`${cacheKey}:info`} project={project} storyId={context.story?.id} chapterId={context.scene?.values?.chapter} eventRef={{ owner_card_id: data.owner_card_id || ownerCardId, scene_id: data.scene_id || sceneId }} value={informationSelection || context.scene?.values?.information_ids || []} onChange={setInformationSelection} title='这场的透露、隐瞒与认知' />
          {informationSelection && <Button className='text-xs' disabled={Boolean(busy)} onClick={async () => { setBusy('info'); try { const owner = data.owner_card_id || ownerCardId, scene = data.scene_id || sceneId; await api.put(`/api/projects/${project}/events/${owner}/${scene}`, { values: { ...context.scene.values, information_ids: informationSelection }, base_revision: data._revision }); setInformationSelection(null); await mutate(); void mutateCache((key: any) => typeof key === 'string' && key.startsWith(`/api/projects/${project}/`) && /cards|events|information-state/.test(key)); setMessage('本场信息关联已保存。原场景安排仍保留，依据有变化时请重新预览确认。') } catch (cause) { setError(cause instanceof Error ? cause.message : '信息关联未保存，选择保留。') } finally { setBusy('') } }}>保存本场信息关联</Button>}
          {data.saved && <AuthorControls key={`${cacheKey}:control`} project={project} target={`cards/${data.owner_card_id || ownerCardId}.yaml`} pathPrefix={rehearsalPointer} label='已采用场景安排' value={data.saved || draft} revision={data._revision} dirty={false} suggestedChanges={{ [rehearsalPointer]: { ...(data.saved || {}), ...draft } }} onChanged={async (value, result) => { const row = value.payload?.important_scenes?.find((item: any) => item.id === (data.scene_id || sceneId)); if (row?.rehearsal) onConfirmed({ saved: row.rehearsal, owner_card_id: data.owner_card_id || ownerCardId, scene_id: data.scene_id || sceneId, _revision: result.base_revision }); await mutate() }} />}
          <section><h2 className='text-sm font-semibold'>这场已有的根据</h2><p className='mt-2 text-xs leading-6 text-muted'>这里只关联作者材料。资料能限定人物与世界，不能自动保证新的文学走法合理。</p>{context.scene?.values?.purpose && <p className='mt-3 text-sm leading-7'>{context.scene.values.purpose}</p>}</section>
          {context.previous_scene && <section className='border-t border-border pt-4'><h3 className='text-sm font-medium'>前场留下什么</h3><p className='mt-2 text-sm leading-7 text-muted'>{context.previous_scene.outcome || context.previous_scene.plot || context.previous_scene.label}</p>{context.previous_scene.next_question && <p className='mt-2 text-xs leading-6 text-muted'>留下的问题：{context.previous_scene.next_question}</p>}{context.previous_scene.stale && <p className='mt-2 text-xs text-muted'>前场采用版待核对，不能直接视为已确定后果。</p>}</section>}
          {Array.isArray(context.characters) && context.characters.length > 0 && <section className='space-y-3 border-t border-border pt-4'><h3 className='text-sm font-medium'>人物各自正在维护什么</h3>{context.characters.map((person: any) => { const line = (context.storylines || []).find((item: any) => item.values?.character_id === person.id)?.values || {}; return <div key={person.id}><h4 className='text-sm'>{sourceLink(person.id, person.label || '相关人物', 'character')}</h4><p className='mt-1 text-xs leading-6 text-muted'>{line.goal || person.payload?.core_motivation || person.payload?.identity || '资料尚未写明本场打算。'}</p>{line.choice && <p className='mt-1 text-xs leading-6 text-muted'>已有选择：{line.choice}</p>}{person.payload?.boundaries?.length > 0 && <details className='mt-2'><summary className='cursor-pointer text-xs text-muted'>人物底线</summary><ul className='mt-1 space-y-1 text-xs leading-6 text-muted'>{person.payload.boundaries.map((text: string, index: number) => <li key={index}>{text}</li>)}</ul></details>}</div> })}</section>}
          {context.next_scene && <section className='border-t border-border pt-4'><h3 className='text-sm font-medium'>下一场已有规划</h3><p className='mt-2 text-xs leading-6 text-muted'>{context.next_scene.label}{context.next_scene.plot ? `：${context.next_scene.plot}` : ''}</p><p className='mt-2 text-xs leading-6 text-muted'>这是作者规划，不代表人物已经知道。</p></section>}
          <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>已有情节与人物交锋的来源</summary><div className='mt-3 space-y-3'><p className='text-sm'>{sourceLink(`${ownerCardId}:important_scenes:${sceneId.startsWith('index_') ? sceneId.slice(6) : sceneId}`, context.scene?.label || sceneLabel || '原情节', 'scene')}</p>{context.story?.id && <p className='text-sm'>{sourceLink(context.story.id, context.story.title || '故事背景', 'story')}</p>}{(context.intersections || []).map((item: any, index: number) => <p key={`intersection:${index}`} className='text-xs leading-6 text-muted'>{[item.values?.goal, item.values?.protagonist_action, item.values?.opponent_action, item.values?.result].filter(Boolean).join('；') || '已有角色交集记录'}</p>)}{(context.beats || []).map((item: any, index: number) => <p key={`beat:${index}`} className='text-xs leading-6 text-muted'>{[item.values?.name, item.values?.summary, item.values?.structural_function].filter(Boolean).join('；')}</p>)}</div></details>
          <details className='border-t border-border pt-4'><summary className='cursor-pointer text-sm font-medium'>世界限制与其他依据</summary><div className='mt-3 space-y-3'>{(context.constraints || []).map((item: any) => <div key={item.id}><p className='text-sm'>{sourceLink(item.id, item.label || '世界设定', 'world')}</p><p className='mt-1 text-xs leading-6 text-muted'>{item.payload?.boundaries || item.payload?.summary || item.payload?.content || item.payload?.setting || item.payload?.rule || ''}</p></div>)}{(context.facts || []).map((item: any) => <blockquote key={item.id} className='text-xs leading-6 text-muted'>{typeof item.value === 'string' ? item.value : item.value?.text || item.value?.summary || item.evidence?.quote || '已有事实记录，可返回作品事实核对。'}</blockquote>)}{(context.notices || []).map((notice: string, index: number) => <p key={index} className='text-xs leading-6 text-muted'>{notice}</p>)}</div></details>
        </aside>
      </div>
    </>}
    {message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}
    {localDraft.recovery && <Button onClick={localDraft.restore}>恢复本场本地手稿</Button>}
    {error && <div role='alert' className='space-y-3'><p className='text-sm leading-7 text-red-700 dark:text-red-300'>{error}</p>{onOpenSettings && <Button variant='ghost' className='text-xs' onClick={onOpenSettings}>检查故事策划模型设置</Button>}</div>}
  </div>
}
