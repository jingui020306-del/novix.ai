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

export function RevisionTools({ project, chapterId, text, profileId, storyCardId, sceneDirection, onChange, onApplied }: {
  project: string; chapterId: string; text: string; profileId?: string; storyCardId?: string;
  sceneDirection?: any; onChange: (text: string) => void; onApplied: () => void;
}) {
  const [mode, setMode] = useState('polish')
  const [strategy, setStrategy] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState<any>(null)

  const activeScope = useRef(`${project}:${chapterId}`); activeScope.current = `${project}:${chapterId}`
  const latestText = useRef(text); latestText.current = text
  const requestNumber = useRef(0)
  useEffect(() => { setRevision(null); setError(''); setBusy(false); return () => { requestNumber.current++ } }, [project, chapterId])

  const revise = async () => {
    const editor = document.getElementById('chapter-manuscript-editor') as HTMLTextAreaElement | null
    let start = editor?.selectionStart || 0
    let end = editor?.selectionEnd || 0
    if (start === end) {
      start = text.match(/^# [^\n]*\n+/)?.[0].length || 0
      end = text.length
    }
    const number = ++requestNumber.current
    setBusy(true)
    setError('')
    setRevision(null)
    try {
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise`, {
        source_text: text, mode, instructions, llm_profile_id: profileId,
        allow_plot_change: false, scene_direction: { ...sceneDirection, ...(strategy ? { prose_strategy: strategy } : {}) },
        story_card_id: storyCardId,
        start: Array.from(text.slice(0, start)).length,
        end: Array.from(text.slice(0, end)).length,
      })
      if (number !== requestNumber.current) return
      if (result.detail) throw new Error(String(result.detail))
      setRevision({ ...result, project, chapterId })
    } catch (err) { if (number === requestNumber.current) setError(err instanceof Error ? err.message : '修改未完成，请重试。') }
    finally { if (number === requestNumber.current) setBusy(false) }
  }

  const apply = async () => {
    if (text !== revision.source_text || project !== revision.project || chapterId !== revision.chapterId) {
      setError('正文已经修改，请重新处理后再应用。')
      return
    }
    const held = `${project}:${chapterId}`
    setBusy(true)
    setError('')
    try {
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise/apply`, revision)
      if (activeScope.current !== held) return
      if (latestText.current !== revision.source_text) { onApplied(); throw new Error('提交时的修改已保存，等待期间的新编辑保留，请核对后再保存。') }
      if (result.detail) throw new Error(String(result.detail))
      onChange(result.content)
      setRevision(null)
      onApplied()
    } catch (err) { if (activeScope.current === held) setError(err instanceof Error ? err.message : '应用失败，请重试。') }
    finally { if (activeScope.current === held) setBusy(false) }
  }

  return (
    <section className='my-4 space-y-3 border-y border-border py-4' aria-label='润色与改写'>
      <div className='flex flex-wrap items-end gap-3'>
        <div>
          <label htmlFor='revision-mode' className='mb-1 block text-sm font-medium'>润色与改写</label>
          <Select id='revision-mode' value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}>
            <option value='polish'>日常润色：修顺病句，保留语气</option>
            <option value='rewrite'>清晰自然地改写</option><option value='cinematic'>调整描写顺序与画面承接</option>
          </Select>
        </div>
        <Button onClick={revise} disabled={busy || !text.trim()}>{busy ? '正在处理…' : mode === 'polish' ? '润色正文' : mode === 'cinematic' ? '调整这一段的写法' : '改写正文'}</Button>
      </div>
      <p className='text-xs text-muted'>选中文字可只处理选段；未选择时处理正文。先预览，确认后才应用。</p>
      {mode === 'cinematic' && <ProseStrategy value={strategy || sceneDirection?.prose_strategy || ''} onChange={setStrategy} />}
      {mode !== 'polish' && <div>
        <label htmlFor='rewrite-instructions' className='text-sm text-muted'>希望怎样改写</label>
        <Textarea id='rewrite-instructions' value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} placeholder='例如：对话更自然；场景描写加入少量贴切的比喻，保留原意。' />
      </div>}
      {error && <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{error}</p>}
      {revision && <div className='space-y-2'>{revision.candidate_kind === 'plot_change' && <p role='alert' className='text-sm leading-7 text-muted'>这一候选涉及剧情变化，请先逐项核对事件与人物意图；不是单纯语言润色。</p>}
        <label htmlFor='revision-result' className='text-sm font-medium'>修改后的段落</label>
        <Textarea id='revision-result' className='min-h-40 font-serif leading-7' value={revision.text} onChange={(e) => setRevision({ ...revision, text: e.target.value })} />
        <TokenUsage usage={revision.usage} />
        <WritingReferenceNotice usage={revision.writing_reference_usage} />
        <div className='flex gap-2'>
          <Button variant='primary' disabled={busy || !revision.text.trim()} onClick={apply}>应用并保存</Button>
          <Button disabled={busy} onClick={() => setRevision(null)}>保留原文</Button>
        </div>
      </div>}
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
