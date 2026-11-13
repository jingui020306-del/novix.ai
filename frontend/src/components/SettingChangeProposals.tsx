import { useRef, useState } from 'react'
import useSWR from 'swr'
import { useDraftRecovery } from '../lib/editorDrafts'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Textarea } from './ui/Fields'
import { TokenUsage } from './WritingTools'

const STATUS: Record<string, string> = { queued: '等待处理', running: '正在生成修改建议', ready: '待你确认', unchanged: '所检查范围无须调整', unconfigured: '模型尚未配置', failed: '生成失败', needs_retry: '需要重试', stale: '依据已变化，请重新生成', superseded: '已被更新的设定替代', applied: '已应用', dismissed: '暂不采用', cancelled: '已取消任务', undone: '已撤销应用' }

export function SettingChangeProposals({ project, chapterId, hasUnsavedManuscript, isChapterGenerating, isSettingDirty, onApplied, onOpenSettings }: {
  project: string; chapterId: string; hasUnsavedManuscript: boolean; isSettingDirty: (id: string) => boolean;
  isChapterGenerating: boolean;
  onApplied: () => void; onOpenSettings: () => void;
}) {
  const { data, error: readError, mutate } = useSWR(project ? `/api/projects/${project}/change-suggestions` : null, api.get, { refreshInterval: 1800 })
  const { data: materials } = useSWR(project ? `/api/projects/${project}/materials` : null, api.get)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [manual, setManual] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [editBases, setEditBases] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const scope = `${project}:${chapterId}`
  const activeScope = useRef(scope); activeScope.current = scope
  const taskKey = (id: string) => `${scope}:${id}`
  const selectScope = (values: any) => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(`${scope}:`)))
  const localDraft = useDraftRecovery(`${scope}:setting-candidates`, { edits: selectScope(edits), selections: selectScope(selections), manual: selectScope(manual), bases: selectScope(editBases) }, JSON.stringify({ edits: {}, selections: {}, manual: {}, bases: {} }), (value) => { setEdits((current) => ({ ...current, ...value.edits })); setSelections((current) => ({ ...current, ...value.selections })); setManual((current) => ({ ...current, ...value.manual })); setEditBases((current) => ({ ...current, ...value.bases })) })
  const candidateKey = (task: any) => JSON.stringify([task.base_hash, task.setting_hash, task.text, task.ops])
  const captureBase = (task: any) => setEditBases((current) => ({ ...current, [taskKey(task.id)]: current[taskKey(task.id)] || candidateKey(task) }))
  const rows = (Array.isArray(data) ? data : []).filter((row: any) => row.chapter_id === chapterId).sort((a: any, b: any) => String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)))
  const act = async (task: any, action: 'apply' | 'dismiss' | 'retry' | 'cancel' | 'undo', applyAll = false) => {
    if (action === 'apply' && editBases[taskKey(task.id)] && editBases[taskKey(task.id)] !== candidateKey(task)) { setMessages((current) => ({ ...current, [taskKey(task.id)]: '候选已经更新，旧编辑仍保留。请先核对最新候选，再决定采用。' })); return }
    if (['apply', 'undo'].includes(action) && isChapterGenerating) { setMessages((current) => ({ ...current, [taskKey(task.id)]: '请先暂停或等待当前生成结束，再应用修改建议。' })); return }
    if (['apply', 'undo'].includes(action) && (hasUnsavedManuscript || isSettingDirty(task.card_id))) { setMessages((current) => ({ ...current, [taskKey(task.id)]: '正文或来源设定还有未保存的编辑，请先保存，再检查这份建议。' })); return }
    const heldScope = scope
    setBusy(task.id)
    setMessages((current) => ({ ...current, [taskKey(task.id)]: '' }))
    try {
      const response = await fetch(`/api/projects/${project}/change-suggestions/${encodeURIComponent(task.id)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'apply' ? manual[taskKey(task.id)] || !task.ops?.length ? { text: edits[taskKey(task.id)] ?? task.text ?? '' } : { accept_op_ids: applyAll ? task.ops.map((op: any) => op.op_id) : selections[taskKey(task.id)] ?? task.ops.map((op: any) => op.op_id) } : {}) })
      const result = await response.json()
      if (!response.ok || result.detail) throw new Error(response.status === 409 ? '依据的设定或正文已经更新，这份旧建议未应用。请重新生成后确认。' : typeof result.detail === 'string' ? result.detail : '操作未完成，请重试。')
      if (activeScope.current !== heldScope) return
      await mutate()
      if (action === 'apply' || action === 'undo') onApplied()
      setMessages((current) => ({ ...current, [taskKey(task.id)]: action === 'apply' ? '已应用并保存，修改记录已保留。' : action === 'dismiss' ? '已标记暂不采用，原正文保留。' : action === 'undo' ? '已撤销本次应用，后续另改的内容仍受版本保护。' : action === 'cancel' ? '任务已取消，不再采用其晚到结果。' : '已提交重试，请查看最新进度。' }))
    } catch (cause) { if (activeScope.current !== heldScope) return; setMessages((current) => ({ ...current, [taskKey(task.id)]: cause instanceof Error ? cause.message : '操作失败，请重试。' })); await mutate().catch(() => undefined) }
    finally { if (activeScope.current === heldScope) setBusy('') }
  }
  return <section className='space-y-4 border-t border-border py-5' aria-label='设定变化带来的正文建议'>
    <div><h3 className='text-base font-semibold'>设定变化带来的正文建议</h3><p className='mt-2 text-sm leading-6 text-muted'>保存设定后，为受影响章节排队生成建议。先检查和编辑，再确认应用；原文不会自动改写。</p></div>
    {localDraft.recovery && <div className='flex flex-wrap gap-2'><p className='w-full text-sm'>找到本章未采用的候选编辑。</p><Button onClick={localDraft.restore}>恢复编辑</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留服务端候选</Button></div>}
    {readError || data?.detail ? <p role='alert' className='text-sm text-muted'>建议列表读取失败，请稍后重试。</p> : !data ? <p className='text-sm text-muted'>正在读取建议进度…</p> : !rows.length ? <p className='text-sm text-muted'>本章目前没有设定变更建议。保存实际变化的关联设定后，相关任务会显示在这里。</p> : <div className='divide-y divide-border'>{rows.map((task: any) => {
      const source = (Array.isArray(materials) ? materials : []).find((row: any) => row.id === task.card_id)
      const staleEdit = Boolean(editBases[taskKey(task.id)] && editBases[taskKey(task.id)] !== candidateKey(task))
      const dirty = hasUnsavedManuscript || isSettingDirty(task.card_id)
      return <article key={task.id} className='space-y-3 py-4'><div className='flex flex-wrap items-baseline justify-between gap-2'><h4 className='text-sm font-medium'>{source?.label || task.card_title || '来源设定'}的修改</h4><span className='text-xs text-muted'>{STATUS[task.status] || '正在读取状态'}</span></div>
        {(task.coverage?.partial || task.coverage?.setting_partial) && <p className='text-xs leading-5 text-muted'>本次只检查相关片段，非全章核验。{task.coverage.setting_partial ? '来源设定也有部分内容未纳入本次检查。' : ''}{Number(task.coverage.omitted_chars) > 0 ? ` 还有 ${task.coverage.omitted_chars} 字正文未检查。` : ''}</p>}
        {task.error && <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{task.error}</p>}
        <TokenUsage usage={task.usage} calls={Array.isArray(task.usage_calls) ? task.usage_calls : task.status === 'unconfigured' ? [] : undefined} />
        {['queued', 'running'].includes(task.status) && <Button className='text-xs' disabled={Boolean(busy)} onClick={() => act(task, 'cancel')}>取消此任务</Button>}
        {task.status === 'applied' && <Button className='text-xs' disabled={Boolean(busy) || dirty || staleEdit || isChapterGenerating} onClick={() => act(task, 'undo')}>撤销这次应用</Button>}
        {staleEdit && <div className='space-y-2'><p className='text-xs leading-6 text-muted'>服务端候选已更新，旧的手动编辑保留但暂不能采用。</p><Button className='text-xs' onClick={() => { const key = taskKey(task.id); setEditBases((current) => ({ ...current, [key]: candidateKey(task) })); setEdits((current) => { const next = { ...current }; delete next[key]; return next }); setSelections((current) => { const next = { ...current }; delete next[key]; return next }); setManual((current) => ({ ...current, [key]: false })) }}>改用最新候选，重新核对</Button></div>}
        {task.status === 'ready' && <><div className='space-y-3'>{(task.ops || []).map((op: any) => <article key={op.op_id} className='space-y-2 border-y border-border py-3'><label className='flex items-center gap-2 text-sm'><input type='checkbox' disabled={Boolean(busy) || manual[taskKey(task.id)]} checked={(selections[taskKey(task.id)] ?? task.ops.map((row: any) => row.op_id)).includes(op.op_id)} onChange={(e) => { captureBase(task); setSelections((current) => { const ids = current[taskKey(task.id)] ?? task.ops.map((row: any) => row.op_id); return { ...current, [taskKey(task.id)]: e.target.checked ? [...ids, op.op_id] : ids.filter((id: string) => id !== op.op_id) } }) }} />采用这一处修改</label><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'><div><p className='text-xs text-muted'>原文</p><p className='whitespace-pre-wrap text-sm leading-7'>{op.before}</p></div><div><p className='text-xs text-muted'>建议</p><p className='whitespace-pre-wrap text-sm leading-7'>{op.after}</p></div></div></article>)}</div><details className='my-3' onToggle={(event) => { if (event.currentTarget.open) { captureBase(task); setManual((current) => ({ ...current, [taskKey(task.id)]: true })) } }}><summary className='cursor-pointer text-sm text-brand-600'>自行编辑整章候选（替代按处勾选）</summary><label className='block text-sm text-muted' htmlFor={`setting-change-${task.id}`}>建议修改后的文字</label><Textarea id={`setting-change-${task.id}`} className='min-h-40 font-serif leading-7' disabled={busy === task.id} value={edits[taskKey(task.id)] ?? task.text ?? ''} onChange={(event) => { captureBase(task); setEdits((current) => ({ ...current, [taskKey(task.id)]: event.target.value })) }} /><p className='mt-2 text-xs text-muted'>此模式按你编辑的全文应用，不与上方片段勾选同时提交。</p><Button variant='ghost' className='mt-2 text-xs' onClick={() => setManual((current) => ({ ...current, [taskKey(task.id)]: false }))}>改回按处勾选</Button></details>{isChapterGenerating && <p className='text-xs text-muted'>请先暂停或等待当前生成结束，再应用修改建议。</p>}{dirty && <p className='text-xs text-muted'>正文或来源设定有未保存的编辑，请先保存，再确认建议。</p>}<div className='flex flex-wrap gap-2'><Button variant='primary' disabled={Boolean(busy) || dirty || staleEdit || isChapterGenerating || (!manual[taskKey(task.id)] && task.ops?.length ? !(selections[taskKey(task.id)] ?? task.ops.map((row: any) => row.op_id)).length : !(edits[taskKey(task.id)] ?? task.text ?? '').trim())} onClick={() => act(task, 'apply')}>{manual[taskKey(task.id)] ? '采用编辑后的全文' : '采用所选修改'}</Button>{!manual[taskKey(task.id)] && task.ops?.length > 0 && <Button disabled={Boolean(busy) || dirty || staleEdit || isChapterGenerating} onClick={() => act(task, 'apply', true)}>全部采用</Button>}<Button disabled={Boolean(busy)} onClick={() => act(task, 'dismiss')}>暂不采用</Button></div></>}
        {['failed', 'needs_retry', 'stale', 'unconfigured'].includes(task.status) && <div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy) || isSettingDirty(task.card_id)} onClick={() => act(task, 'retry')}>重新生成建议</Button>{task.status === 'unconfigured' && <Button onClick={onOpenSettings}>配置模型</Button>}<Button variant='ghost' disabled={Boolean(busy)} onClick={() => act(task, 'dismiss')}>暂不采用</Button></div>}
        {(task.source_text || task.diff) && <details><summary className='cursor-pointer text-xs text-muted'>查看原文与修改差异</summary>{task.source_text && <blockquote className='mt-3 whitespace-pre-wrap text-sm leading-7 text-muted'>{task.source_text}</blockquote>}{task.diff && <pre className='mt-3 overflow-auto whitespace-pre-wrap text-xs leading-6 text-muted'>{task.diff}</pre>}</details>}
        {messages[taskKey(task.id)] && <p role='status' className='text-sm text-muted'>{messages[taskKey(task.id)]}</p>}
      </article>
    })}</div>}
  </section>
}
