import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Select, Textarea } from './ui/Fields'
import { WritingReferenceNotice } from './WritingReferencePicker'

export function RevisionTools({ project, chapterId, text, profileId, storyCardId, onChange, onApplied }: {
  project: string; chapterId: string; text: string; profileId?: string; storyCardId?: string;
  onChange: (text: string) => void; onApplied: () => void;
}) {
  const [mode, setMode] = useState('polish')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState<any>(null)

  useEffect(() => { setRevision(null); setError('') }, [project, chapterId])

  const revise = async () => {
    const editor = document.getElementById('chapter-manuscript-editor') as HTMLTextAreaElement | null
    let start = editor?.selectionStart || 0
    let end = editor?.selectionEnd || 0
    if (start === end) {
      start = text.match(/^# [^\n]*\n+/)?.[0].length || 0
      end = text.length
    }
    setBusy(true)
    setError('')
    setRevision(null)
    try {
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise`, {
        source_text: text, mode, instructions, llm_profile_id: profileId,
        story_card_id: storyCardId,
        start: Array.from(text.slice(0, start)).length,
        end: Array.from(text.slice(0, end)).length,
      })
      if (result.detail) throw new Error(String(result.detail))
      setRevision({ ...result, project, chapterId })
    } catch (err) { setError(err instanceof Error ? err.message : '修改未完成，请重试。') }
    finally { setBusy(false) }
  }

  const apply = async () => {
    if (text !== revision.source_text || project !== revision.project || chapterId !== revision.chapterId) {
      setError('正文已经修改，请重新处理后再应用。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.post(`/api/projects/${project}/chapters/${chapterId}/revise/apply`, revision)
      if (result.detail) throw new Error(String(result.detail))
      onChange(result.content)
      setRevision(null)
      onApplied()
    } catch (err) { setError(err instanceof Error ? err.message : '应用失败，请重试。') }
    finally { setBusy(false) }
  }

  return (
    <section className='my-4 space-y-3 border-y border-border py-4' aria-label='润色与改写'>
      <div className='flex flex-wrap items-end gap-3'>
        <div>
          <label htmlFor='revision-mode' className='mb-1 block text-sm font-medium'>润色与改写</label>
          <Select id='revision-mode' value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}>
            <option value='polish'>日常润色：修顺病句，保留语气</option>
            <option value='rewrite'>清晰自然地改写</option>
          </Select>
        </div>
        <Button onClick={revise} disabled={busy || !text.trim()}>{busy ? '正在处理…' : mode === 'polish' ? '润色正文' : '改写正文'}</Button>
      </div>
      <p className='text-xs text-muted'>选中文字可只处理选段；未选择时处理正文。先预览，确认后才应用。</p>
      {mode === 'rewrite' && <div>
        <label htmlFor='rewrite-instructions' className='text-sm text-muted'>希望怎样改写</label>
        <Textarea id='rewrite-instructions' value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} placeholder='例如：对话更自然；场景描写加入少量贴切的比喻，保留原意。' />
      </div>}
      {error && <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{error}</p>}
      {revision && <div className='space-y-2'>
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
