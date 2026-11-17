import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Select, Textarea } from './ui/Fields'
import { AuthorControls } from './AuthorControls'
import { useDraftRecovery } from '../lib/editorDrafts'
import { WritingReferenceNotice } from './WritingReferencePicker'

export const PROSE_STRATEGIES = [
  ['wide_to_detail', '从整体到细节', '先交代处境，再停在关键对象。', '雨笼住整条街。她只看见门缝下那张干燥的纸。'],
  ['detail_to_setting', '从细节到环境', '由一个细节展开空间与处境。', '杯沿有一圈盐。窗外的船，已经停满了港口。'],
  ['spatial_flow', '按空间顺序移动', '沿人物能感知的位置组织行动。', '她绕过桌角，扶住门框，才看见台阶下的人。'],
  ['sensory_follow', '跟随人物感官', '让一个感知带出下一步注意。', '门轴轻响。他停笔，先看向灯下那只伸进来的手。'],
  ['action_reaction', '动作与反应衔接', '写清动作怎样引起回应与变化。', '她把信推过去。他没接，只将杯子挪开了一点。'],
  ['delayed_reveal', '暂缓揭示', '先写迹象或反应，稍后揭示原因。', '他忽然收住笑。她顺着他的目光，回头看见了门外的人。'],
  ['focus_closure', '聚焦与收束', '在关键选择停留，减少无关铺陈。', '她的手停在封口上。最后，只把信放回了抽屉。'],
] as const
export function ProseStrategy({ value = '', onChange }: { value?: string; onChange: (value: string) => void }) {
  const current = PROSE_STRATEGIES.find(([id]) => id === value)
  return <div className='space-y-2'><label className='block text-sm font-medium'>读者怎样逐步看到这一场</label><Select aria-label='描写顺序与观察方式' value={value} onChange={(event) => onChange(event.target.value)}><option value=''>由情节与视角决定，也可在下方自由说明</option>{PROSE_STRATEGIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>{current && <><p className='text-xs leading-6 text-muted'>{current[2]} 最终生成小说文字，保持人物意图与已确认事实。</p><details><summary className='cursor-pointer text-xs text-muted'>看一个短例</summary><p className='mt-2 text-sm leading-7'>{current[3]}</p><p className='mt-2 text-xs leading-6 text-muted'>只是写法示例，不加入作品设定。避免把每个动作都写成特写，或用人物此时不可能感知的内容制造效果。</p></details></>}</div>
}

function selectedRevisionText(revision: any, ids: string[]) {
  const original = Array.from(String(revision.source_text || '')).slice(revision.start, revision.end)
  const selected = (revision.ops || []).filter((op: any) => ids.includes(op.op_id)).sort((left: any, right: any) => left.start - right.start || left.end - right.end)
  let previousEnd = 0
  for (const op of selected) {
    if (!Number.isInteger(op.start) || !Number.isInteger(op.end) || op.start < previousEnd || op.end < op.start || op.end > original.length || original.slice(op.start, op.end).join('') !== op.before) throw new Error('候选范围与原文不一致，请重新生成；没有应用修改。')
    previousEnd = op.end
  }
  const result = [...original]
  for (const op of [...selected].reverse()) result.splice(op.start, op.end - op.start, ...Array.from(String(op.after)))
  return result.join('')
}

export function ManuscriptEditor({ project, chapterId, text, profileId, storyCardId, sceneDirection, sceneRef, techniques, baseRevision, onChange, onApplied, saved, saving, locked, onSave }: {
  project: string; chapterId: string; text: string; profileId?: string; storyCardId?: string;
  saved: boolean; saving: boolean; locked: boolean; onSave: () => void;
  sceneRef?: {owner_card_id: string; scene_id: string}; baseRevision?: string; techniques: { id: string; title: string }[]; sceneDirection?: any; onChange: (text: string) => void; onApplied: (content: string, revision: string) => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [range, setRange] = useState({start: 0, end: 0})
  const controlsRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{left: number; top: number} | null>(null)
  const [focused, setFocused] = useState(false)
  const [technique, setTechnique] = useState('')
  const [scope, setScope] = useState<'chapter' | 'selection' | null>(null)
  const [mode, setMode] = useState('polish')
  const [strategy, setStrategy] = useState('')
  const [instructions, setInstructions] = useState('')
  const [expressionStyle, setExpressionStyle] = useState('')
  const [emotionalAtmosphere, setEmotionalAtmosphere] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState<any>(null)
  const [selectedChanges, setSelectedChanges] = useState<string[]>([])
  const [manual, setManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const [notice, setNotice] = useState('')
  const [receipt, setReceipt] = useState<{ scope: string; before: string; after: string; revision: string } | null>(null)

  const activeScope = useRef(`${project}:${chapterId}`); activeScope.current = `${project}:${chapterId}`
  const latestText = useRef(text); latestText.current = text
  const requestNumber = useRef(0)
  useEffect(() => { activeScope.current = `${project}:${chapterId}`; setRevision(null); setSelectedChanges([]); setManual(false); setManualText(''); setReceipt(null); setNotice(''); setError(''); setBusy(false); return () => { requestNumber.current++; activeScope.current = '' } }, [project, chapterId])

  useEffect(() => {
    if (scope) controlsRef.current?.scrollIntoView({ block: 'nearest' })
  }, [scope])

  const revise = async () => {
    if (!scope || locked) return
    const start = scope === 'chapter' ? (text.match(/^# [^\n]*\n+/)?.[0].length || 0) : range.start
    const end = scope === 'chapter' ? text.length : range.end
    const number = ++requestNumber.current
    setBusy(true)
    setError('')
    setRevision(null); setNotice('')
    try {
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise`, {
        source_text: text, base_revision: baseRevision, mode, instructions, writing_references: technique ? [technique] : [], llm_profile_id: profileId,
        allow_plot_change: false, scene_direction: { ...sceneDirection, ...(strategy ? { prose_strategy: strategy } : {}) },
        story_card_id: storyCardId, ...(mode === 'dialogue' ? {scene_ref: sceneRef} : {}),
        ...(mode !== 'polish' ? { expression_style: expressionStyle, emotional_atmosphere: emotionalAtmosphere } : {}),
        start: Array.from(text.slice(0, start)).length,
        end: Array.from(text.slice(0, end)).length,
      })
      if (number !== requestNumber.current) return
      if (result.detail) throw new Error(String(result.detail))
      setRevision({ ...result, project, chapterId }); setSelectedChanges((result.ops || []).map((op: any) => op.op_id)); setManual(!Array.isArray(result.ops)); setManualText(result.text)
    } catch (err) { if (number === requestNumber.current) setError(err instanceof Error ? err.message : '修改未完成，请重试。') }
    finally { if (number === requestNumber.current) setBusy(false) }
  }

  const apply = async (all = false) => {
    if (locked) { setError('请先结束当前生成或核对正文锁定状态。'); return }
    if (text !== revision.source_text || project !== revision.project || chapterId !== revision.chapterId) {
      setError('正文已经修改，请重新处理后再应用。')
      return
    }
    const held = `${project}:${chapterId}`
    setBusy(true)
    setError('')
    try {
      const candidateText = manual ? manualText : selectedRevisionText(revision, all ? revision.ops.map((op: any) => op.op_id) : selectedChanges)
      if (candidateText === Array.from(String(revision.source_text)).slice(revision.start, revision.end).join('')) throw new Error('候选与原文相同，无须再次保存。')
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise/apply`, { source_text: revision.source_text, start: revision.start, end: revision.end, base_hash: revision.base_hash, mode: revision.mode, text: candidateText, ...(revision.mode === 'dialogue' ? {scene_ref: revision.scene_ref, dialogue_hash: revision.dialogue_hash, story_card_id: revision.story_card_id, instructions: revision.instructions} : {}) })
      if (activeScope.current !== held) return
      if (result.detail) throw new Error(String(result.detail))
      const appliedRevision = result.applied_revision || result.revision
      if (appliedRevision) setReceipt({ scope: held, before: revision.source_text, after: result.content, revision: appliedRevision })
      onApplied(result.content, appliedRevision)
      if (latestText.current !== revision.source_text) throw new Error('提交时的修改已保存，等待期间的新编辑保留，请核对后再保存。')
      setScope(null)
      onChange(result.content)
      if (!appliedRevision) setNotice('修改已保存，可在章节版本历史中回看。')
      setRevision(null)
    } catch (err) { if (activeScope.current === held) setError(err instanceof Error ? err.message : '应用失败，请重试。') }
    finally { if (activeScope.current === held) setBusy(false) }
  }

  const undo = async () => {
    const held = `${project}:${chapterId}`
    if (!receipt || receipt.scope !== held || !receipt.revision) return
    if (locked) { setError('请先结束当前生成或核对正文锁定状态，再撤销。'); return }
    if (text !== receipt.after) { setError('正文已有新编辑，不能直接撤销本次修改；请先核对当前正文。'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise/apply`, { source_text: receipt.after, start: 0, end: Array.from(receipt.after).length, text: receipt.before, base_hash: receipt.revision, mode: 'polish' })
      if (activeScope.current !== held) return
      if (result.detail) throw new Error(String(result.detail))
      setReceipt(null); setRevision(null); onApplied(result.content, result.applied_revision || result.revision)
      if (latestText.current !== receipt.after) throw new Error('本次修改已撤销并保存；等待期间的新编辑保留，请核对后再保存。')
      onChange(result.content); setScope(null); setNotice('已撤销本次修改，应用前的正文已恢复并保存。')
    } catch (cause) { if (activeScope.current === held) setError(cause instanceof Error ? cause.message : '未能撤销，当前正文保留。') }
    finally { if (activeScope.current === held) setBusy(false) }
  }
  const ops: any[] = Array.isArray(revision?.ops) ? revision.ops : []
  let previewText = manualText, selectionError = ''
  if (revision && !manual) {
    try { previewText = selectedRevisionText(revision, selectedChanges) }
    catch (cause) { selectionError = cause instanceof Error ? cause.message : '候选范围需重新核对。' }
  }
  return (
    <section aria-label='章节稿纸'>
      <div className='manuscript-actions'>
        <button disabled={saving || saved || locked} onClick={onSave}>{saving ? '保存中…' : saved ? '已保存' : '保存正文'}</button>
        <button disabled={locked || busy || !text.trim() || Boolean(scope)} onClick={() => {setScope('chapter'); setRevision(null); setError('')}}>处理本章</button>
      </div>
      <div className='relative'>
      <textarea id='chapter-manuscript-editor' aria-label='章节正文' className='editor-text' ref={editorRef} readOnly={locked} value={text} placeholder='开始写这一章…'
        onChange={e => {onChange(e.target.value); setScope(null); setRevision(null); requestNumber.current++; setBusy(false)}}
        onFocus={() => setFocused(true)}
        onKeyDown={() => setAnchor(null)}
        onScroll={() => setAnchor(null)}
        onMouseUp={e => {
          const el = e.currentTarget
          const rect = el.getBoundingClientRect()
          setAnchor(el.selectionStart === el.selectionEnd ? null : {
            left: Math.max(0, Math.min(e.clientX - rect.left, rect.width - 120)),
            top: Math.min(e.clientY - rect.top + 16, rect.height - 36),
          })
        }}
        onSelect={e => {
          if (!scope) setRange({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })
        }} />
      {focused && !scope && !locked && <button className='toolbar-control selection-action' style={anchor && range.start !== range.end ? {position: 'absolute', ...anchor} : undefined} onMouseDown={e => e.preventDefault()} onClick={() => {setMode(range.start === range.end ? 'expand' : 'polish'); setScope('selection'); setError('')}}>{range.start === range.end ? '在光标处补写' : 'AI · 处理选文'}</button>}
      </div>
      {scope && <div ref={controlsRef} className='revision-controls'>
      <div className='manuscript-actions'><strong>{scope === 'chapter' ? '本章全文' : range.start === range.end ? '光标位置' : `已选 ${Array.from(text.slice(range.start,range.end)).length} 字`}</strong>
      <button disabled={busy} onClick={() => {setScope(null);setRevision(null);editorRef.current?.focus()}}>关闭</button></div>
      <div className='flex flex-wrap gap-2'>
        <Select aria-label='修改方式' value={mode} onChange={e => {setMode(e.target.value);setRevision(null)}} disabled={busy}>
          <option value='dialogue'>按人物写对话</option><option value='polish' disabled={scope === 'selection' && range.start === range.end}>润色</option><option value='expand'>补充</option><option value='construct'>构建</option><option value='rewrite' disabled={scope === 'selection' && range.start === range.end}>改写</option><option value='cinematic' disabled={scope === 'selection' && range.start === range.end}>调整画面承接</option>
        </Select>
        <Button onClick={revise} disabled={busy || locked}>{busy ? '处理中…' : '预览候选'}</Button>
      </div>
      {techniques.length > 0 && <Select aria-label='本次技法' value={technique} disabled={busy} onChange={e => { setTechnique(e.target.value); setRevision(null) }}>
        <option value=''>沿用本章技法</option>
        {techniques.filter(card => card.title).map(card => <option key={card.id} value={card.id}>{card.title}</option>)}
      </Select>}
      {mode === 'cinematic' && <ProseStrategy value={strategy || sceneDirection?.prose_strategy || ''} onChange={setStrategy} />}
      {mode !== 'polish' && <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{[['expression-style', '表达风格', expressionStyle, setExpressionStyle, ['清晰自然', '简洁克制', '细腻抒情', '凝练含蓄']], ['emotional-atmosphere', '情绪氛围', emotionalAtmosphere, setEmotionalAtmosphere, ['平静', '温暖', '紧张', '压抑', '悲凉']]].map(([id, label, value, change, choices]: any) => <div key={id} className='space-y-2'><label htmlFor={id} className='block text-sm'>{label}（可自定义）</label><Select aria-label={`选择${label}`} value={choices.includes(value) ? value : ''} onChange={(e) => change(e.target.value)}><option value=''>沿用原文 / 自定义</option>{choices.map((choice: string) => <option key={choice} value={choice}>{choice}</option>)}</Select><Textarea id={id} value={value} maxLength={1000} onChange={(e) => change(e.target.value)} placeholder={`可选，也可直接写希望的${label}`} /></div>)}</div>}
      <div>
        <label htmlFor='rewrite-instructions' className='text-sm text-muted'>本次要求（可选）</label>
        <Textarea id='rewrite-instructions' value={instructions} disabled={busy} onChange={e => { setInstructions(e.target.value); setRevision(null) }} maxLength={3500} placeholder={mode === 'dialogue' ? '每人一行，例如：林秋：想问清来意，暂不提那封信。' : '例如：对话更自然；场景描写加入少量贴切的比喻，保留原意。'} />
      </div>
      {revision && <div className='space-y-2'>{revision.candidate_kind === 'plot_change' && <p role='alert' className='text-sm leading-7 text-muted'>这一候选涉及剧情变化，请先逐项核对事件与人物意图；不是单纯语言润色。</p>}
        {ops.length > 0 ? <section className='space-y-3' aria-label='逐处核对润色与改写'><h4 className='text-sm font-medium'>核对每一处变化</h4>{ops.map((op: any, index: number) => <article key={op.op_id} className='space-y-2 border-b border-border py-3'><label className='flex items-center gap-2 text-sm'><input type='checkbox' disabled={busy || manual} checked={selectedChanges.includes(op.op_id)} onChange={(event) => setSelectedChanges((current) => event.target.checked ? [...current, op.op_id] : current.filter((id) => id !== op.op_id))} />采用第 {index + 1} 处修改</label><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'><div><p className='text-xs text-muted'>原文</p><p className='whitespace-pre-wrap text-sm leading-7'>{op.before || '此处没有原文（新增）'}</p></div><div><p className='text-xs text-muted'>建议</p><p className='whitespace-pre-wrap text-sm leading-7'>{op.after || '删除此处文字'}</p></div></div></article>)}</section> : Array.isArray(revision.ops) && <p className='text-xs text-muted'>候选与原文一致，暂无要采用的修改；仍可自行编辑下方文字。</p>}
        <div className='space-y-2'><label htmlFor='revision-result' className='text-sm font-medium'>{manual ? '自行编辑的候选' : '所选修改的结果预览（可手改）'}</label>
        <Textarea id='revision-result' disabled={busy} className='min-h-40 font-serif leading-7' value={previewText} onChange={(event) => { setManual(true); setManualText(event.target.value) }} />
        {manual ? <p className='text-xs leading-6 text-muted'>采用时以这份手改稿为准，不同时叠加上方勾选。{ops.length > 0 && <button className='ml-2 text-brand-600 underline focus-ring' disabled={busy} onClick={() => setManual(false)}>改回按处勾选</button>}</p> : manualText !== revision.text && <button className='text-xs text-brand-600 underline focus-ring' disabled={busy} onClick={() => setManual(true)}>恢复我的手改稿</button>}
        {selectionError && <p role='alert' className='text-xs text-red-700 dark:text-red-300'>{selectionError}</p>}</div>
        <TokenUsage usage={revision.usage} />
        <WritingReferenceNotice usage={revision.writing_reference_usage} />
        <div className='flex flex-wrap gap-2'>
          <Button variant='primary' disabled={busy || locked || Boolean(selectionError) || previewText === Array.from(String(revision.source_text)).slice(revision.start, revision.end).join('') || !manual && !selectedChanges.length} onClick={() => apply()}>{manual ? '采用手改稿并保存' : '采用所选修改并保存'}</Button>
          {!manual && ops.length > 0 && <Button disabled={busy || locked} onClick={() => apply(true)}>全部采用</Button>}
          <Button disabled={busy} onClick={() => setRevision(null)}>保留原文</Button>
        </div>
      </div>}
      </div>}
      {error && <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{error}</p>}
      {notice && <p role='status' className='text-xs leading-6 text-muted'>{notice}</p>}
      {receipt?.scope === `${project}:${chapterId}` && <div className='space-y-2 border-t border-border pt-3'><p className='text-xs leading-6 text-muted'>本次修改已保存，快照与修改历史仍保留。撤销仅针对这次应用；后续正文另有修改时不会覆盖。</p><Button disabled={busy || locked || text !== receipt.after} onClick={undo}>撤销本次修改</Button>{text !== receipt.after && <p className='text-xs text-muted'>当前正文已有新编辑，请先核对，不能直接撤销。</p>}</div>}
    </section>
  )
}

const RUN_STATUS: Record<string, string> = { running: '正在生成', pausing: '完成当前段后暂停', paused: '已暂停', failed: '已中断', completed: '已完成', cancelled: '已结束' }

export function WritingRunPanel({ project, hasUnsavedChanges, onProgress }: { project: string; hasUnsavedChanges: boolean; onProgress: () => void }) {
  const { data, mutate } = useSWR(`/api/projects/${project}/writing-runs`, api.get, { refreshInterval: 1200 })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = Array.isArray(data) ? data[0] : null
  useEffect(() => { onProgress() }, [run?.run_id, run?.next_index, run?.status])

  const control = async (action: string) => {
    if (action === 'resume' && hasUnsavedChanges) { setError('请先保存正文，再继续生成。'); return }
    setBusy(true)
    setError('')
    try {
      const result = await api.post(`/api/projects/${project}/writing-runs/${run.run_id}/${action}`, {})
      if (result.detail) throw new Error(String(result.detail))
      await mutate()
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败，请重试。') }
    finally { setBusy(false) }
  }
  if (!run) return null
  return (
    <section className='mt-3 space-y-2 border-t border-border pt-3' aria-label='生成进度'>
      <div className='flex flex-wrap justify-between gap-2 text-sm'><strong>{RUN_STATUS[run.status] || '正在读取'}</strong><span>已完成 {run.next_index} / {run.units.length} 段</span></div>
      <progress className='h-2 w-full accent-indigo-600' value={run.next_index} max={run.units.length} aria-label='生成进度' />
      <p className='text-xs text-muted' aria-live='polite'>{run.message}</p>
      <TokenUsage usage={run.usage} />
      <div className='flex gap-2'>
        {run.status === 'running' && <Button disabled={busy} onClick={() => control('pause')}>暂停</Button>}
        {['paused', 'failed'].includes(run.status) && <Button disabled={busy} variant='primary' onClick={() => control('resume')}>从断点继续</Button>}
        {['running', 'pausing', 'paused', 'failed'].includes(run.status) && <Button disabled={busy} onClick={() => control('stop')}>结束任务</Button>}
      </div>
      {error && <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{error}</p>}
    </section>
  )
}


const MODULE_LABELS: Record<string, string> = { writer: '写作', chapter_writer: '写作', critic: '审查', chapter_reviewer: '审查', editor: '润色', proofreader: '润色', canon_extractor: '事实整理', setup_character: '人物设定', setup_story: '故事构思', setup_lines: '情节构思', timeline_checker: '时间线检查', scene_checker: '场景检查', foreshadow_tracker: '伏笔检查', recap_reviewer: '前文回顾', outline_research: '大纲调研', setting_change: '设定变更建议' }

export function TokenUsage({ usage, calls, title = '本次用量' }: { usage?: any; calls?: any[]; title?: string }) {
  if (Array.isArray(calls) && !calls.length && !(Number(usage?.total_tokens) > 0)) return <p className='text-xs text-muted'>尚未调用模型</p>
  if (!usage || !Number.isFinite(usage.total_tokens)) return null
  const rows = Array.isArray(usage.by_module) ? usage.by_module : []
  const estimated = Boolean(usage.estimated || rows.some((row: any) => row.estimated))
  return <section className='space-y-2 text-sm' aria-label={title}>
    <div className='flex flex-wrap items-baseline gap-2'><span className='font-medium'>{title}</span><strong>{usage.total_tokens.toLocaleString()} tokens</strong><span className='text-xs text-muted'>{estimated ? '含估算' : '服务商实报'}</span></div>
    <p className='text-xs text-muted'>输入 {Number(usage.prompt_tokens || 0).toLocaleString()} / 输出 {Number(usage.completion_tokens || 0).toLocaleString()}</p>
    {(usage.image_tokens_unknown || rows.some((row: any) => row.image_tokens_unknown)) && <p className='text-xs text-muted'>估算未包含图片，以服务商实报为准。</p>}
    {rows.length > 0 && <details><summary className='cursor-pointer text-xs text-muted'>模型明细</summary><div className='mt-2 overflow-x-auto'><table className='w-full min-w-[420px] border-collapse text-left text-xs'><thead><tr className='border-b border-border text-muted'><th className='py-2 pr-3 font-medium'>任务 / 模型</th><th className='py-2 pr-3 font-medium'>输入</th><th className='py-2 pr-3 font-medium'>输出</th><th className='py-2 pr-3 font-medium'>合计</th><th className='py-2 font-medium'>来源</th></tr></thead><tbody>{rows.map((row: any, index: number) => <tr key={index} className='border-b border-border'><td className='py-2 pr-3'>{MODULE_LABELS[row.module] || '写作辅助'}<span className='mt-1 block text-muted'>{row.model || '未记录模型'}</span></td><td className='py-2 pr-3'>{Number(row.prompt_tokens || 0).toLocaleString()}</td><td className='py-2 pr-3'>{Number(row.completion_tokens || 0).toLocaleString()}</td><td className='py-2 pr-3'>{Number(row.total_tokens || 0).toLocaleString()}</td><td className='py-2'>{row.estimated ? '估算' : '实报'}</td></tr>)}</tbody></table></div></details>}
  </section>
}

export function TrialWritingTools({ project, chapterId, text, revision, dirty, isGenerating, profileId, storyId, sceneDirection, onApplied }: { project: string; chapterId: string; text: string; revision?: string; dirty: boolean; isGenerating: boolean; profileId?: string; storyId?: string; sceneDirection?: any; onApplied: (text: string) => void }) {
  const key = `${project}:${chapterId}`
  const active = useRef(key); active.current = key
  const [trialState, setTrialState] = useState<any>(null)
  const trial = trialState?.key === key ? trialState.value : null
  const setTrial = (value: any) => setTrialState({ key, value })
  const current = useRef(trial); current.current = trial
  const latestManuscript = useRef(text); latestManuscript.current = text
  const [baseline, setBaseline] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [locked, setLocked] = useState(false)
  const localDraft = useDraftRecovery(`${key}:trial:${trial?.id || 'new'}`, trial, baseline, setTrial)
  useEffect(() => { setMessage(''); setBusy(''); setLocked(false); setBaseline(''); const id = localStorage.getItem(`novix:trial:${key}`); if (id) void api.get(`/api/projects/${project}/trials/${id}`).then((value) => { if (active.current === key) { setTrial(value); setInstructions(value.instructions || ''); setBaseline(JSON.stringify(value)) } }).catch((error) => { if (active.current === key) setMessage(error.message) }) }, [key])
  const act = async (action: 'create' | 'save' | 'generate' | 'apply' | 'discard') => {
    const held = key, submitted = current.current; const before = JSON.stringify(submitted); setBusy(action); setMessage('')
    try {
      if (action === 'discard' && submitted?.status === 'applied') { setTrial(null); localStorage.removeItem(`novix:trial:${key}`); localDraft.markSaved(submitted, null); setMessage('已关闭这份试写，采用记录仍保留。'); return }
      if (['create', 'apply'].includes(action) && (dirty || isGenerating)) throw new Error('请先保存正文，并暂停或等待当前生成结束。试写稿仍保留。')
      let result: any
      if (action === 'create') {
        const editor = document.getElementById('chapter-manuscript-editor') as HTMLTextAreaElement | null
        const start = editor?.selectionStart || 0, end = editor?.selectionEnd || 0
        result = await api.post(`/api/projects/${project}/chapters/${chapterId}/trials`, { instructions, story_card_id: storyId, ...(end > start ? { start: Array.from(text.slice(0, start)).length, end: Array.from(text.slice(0, end)).length } : {}) })
      } else {
        let saved = submitted
        if (action !== 'discard') saved = await api.put(`/api/projects/${project}/trials/${submitted.id}`, { revision: submitted.revision, text: submitted.text, instructions })
        result = action === 'save' ? saved : await api.post(`/api/projects/${project}/trials/${saved.id}/${action}`, { revision: saved.revision, ...(action === 'generate' ? { instructions, llm_profile_id: profileId, scene_direction: sceneDirection } : {}) })
      }
      if (active.current !== held) return
      if (action === 'apply') { if (latestManuscript.current !== text) { setMessage('试写已保存采用；等待期间的新正文编辑保留，请核对后再保存。'); setTrial(result); return }; if (typeof result.result?.content !== 'string') throw new Error('已提交采用，但返回的正文暂时无法读取，请刷新保存版核对；当前编辑仍保留。'); onApplied(result.result.content); setMessage('试写已按所选范围采用，原版本与修改差异保留。'); setTrial(result); setBaseline(JSON.stringify(result)); localDraft.markSaved(submitted, result); return }
      if (action !== 'create' && before !== JSON.stringify(current.current)) { setTrial({ ...current.current, revision: result.revision || current.current.revision }); setMessage('等待期间你又修改了试写，当前稿保留。请重新核对后采用。'); return }
      if (action === 'discard') { setTrial(null); localStorage.removeItem(`novix:trial:${key}`); localDraft.markSaved(submitted, null); setMessage('试写已放弃，正式正文和设定保持原样。'); return }
      setTrial(result); setBaseline(JSON.stringify(result)); localDraft.markSaved(submitted, result); localStorage.setItem(`novix:trial:${key}`, result.id); setMessage(action === 'generate' ? 'AI 只改了试写候选，可继续编辑；正式资料未变。' : action === 'create' ? '试写工作稿已建立。选中文字只试写选段，否则试写全章。' : '试写稿已保存，尚未采用。')
    } catch (error) { if (active.current === held) { if ((error as any)?.status === 409 && action === 'apply') setLocked(/锁定|指定修改/.test(error instanceof Error ? error.message : '')); setMessage(error instanceof Error ? error.message : '试写未完成，当前稿保留。'); if (submitted?.id && action !== 'discard') { try { const fresh = await api.get(`/api/projects/${project}/trials/${submitted.id}`); if (active.current === held) { if (JSON.stringify(current.current) === before) { setTrial(fresh); setBaseline(JSON.stringify(fresh)) } else setTrial({ ...current.current, revision: fresh.revision, status: fresh.status }) } } catch { /* The current trial remains editable if reloading fails. */ } } } }
    finally { if (active.current === held) setBusy('') }
  }
  const candidateManuscript = trial?.target_range ? Array.from(trial.source_text || text).slice(0, trial.target_range.start).join('') + (trial.text || '') + Array.from(trial.source_text || text).slice(trial.target_range.end).join('') : trial?.text || text
  return <details className='trial-tools'><summary className='cursor-pointer text-sm text-brand-600'>试写另一种发展（不改正式稿）</summary><div className='mt-4 space-y-3'><Textarea aria-label='试写方向' value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder='可以手动试写，也可主动让 AI 提一个不同走法。放弃不会改变正式设定、认知与披露。' />{!trial && <Button disabled={Boolean(busy) || dirty || isGenerating} onClick={() => act('create')}>建立试写稿</Button>}{localDraft.recovery && <Button onClick={localDraft.restore}>恢复未保存试写</Button>}{trial && <><Textarea readOnly={['applied', 'discarded'].includes(trial.status)} aria-label='试写正文' className='min-h-52 leading-8' value={trial.text || ''} onChange={(e) => setTrial({ ...trial, text: e.target.value })} /><TokenUsage usage={trial.usage} calls={trial.usage_calls} /><div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy) || ['applied', 'discarded'].includes(trial.status)} onClick={() => act('save')}>保存试写</Button><Button disabled={Boolean(busy) || ['applied', 'discarded'].includes(trial.status)} onClick={() => act('generate')}>请 AI 试写</Button><Button variant='primary' disabled={Boolean(busy) || dirty || isGenerating || ['applied', 'discarded'].includes(trial.status)} onClick={() => act('apply')}>核对后采用到正式稿</Button><Button variant='ghost' disabled={Boolean(busy)} onClick={() => act('discard')}>{trial.status === 'applied' ? '关闭这份已采用试写' : '放弃试写'}</Button></div>{locked && <AuthorControls key={`${key}:trial-amend`} project={project} target={`drafts/${chapterId}.md`} label='正文' value={text} revision={revision} dirty={dirty} onChanged={(value) => onApplied(value)} suggestedChanges={{ '/': candidateManuscript }} />}</>}{message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}</div></details>
}
