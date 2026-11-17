import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { canonicalEvents } from '../lib/materialScope'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'

const levels = { book: '全书期待', unit: '卷内悬念', chapter: '章节钩子' }
const hooks = { danger: '危机逼近', choice: '人物选择', anomaly: '反常细节', shift: '立场变化', identity: '身份线索', other: '其他' }
const kinds = { clue: '新线索', choice: '人物选择', cost: '代价变化', misdirection: '误导线索', reminder: '再次提起', payoff: '兑现' }
const settingLabels = {
  book_min: '全书期待建议下限', book_max: '全书期待建议上限', hook_chapters: '章节钩子回应间隔（章）',
  reminder_limit: '重复提问提醒次数', pressure_limit: '连续同类或高压钩子提醒次数',
}
const payoffs = { direct: '正向兑现', reverse: '反向兑现', derivative: '兑现并引出新悬念' }
const options = (labels: Record<string, string>) => Object.entries(labels).map(([key, value]) => <option value={key} key={key}>{value}</option>)

type Plan = {
  id?: string; question: string; level: keyof typeof levels; parent_id?: string; answer?: string
  setup_chapter_id?: string; due_from?: string; due_to?: string; hook_type?: string; climax?: boolean
  interval?: number | null; information_id?: string; event_ref?: string; reader_prompt?: string; foreshadowing_id?: string
}
type Evidence = { id: string; chapter_id: string; kind: keyof typeof kinds; quote: string; valid: boolean; explanation?: string; payoff_type?: keyof typeof payoffs; followup_id?: string }
type LinkedProgress = Pick<Evidence, 'id' | 'chapter_id' | 'quote' | 'valid'> & { origin_thread_id: string }
type Thread = Plan & { id: string; evidence: Evidence[]; linked_progress?: LinkedProgress[]; status: 'planned' | 'open' | 'paid' }
type Check = { code: string; message: string; thread_id?: string; chapter_id?: string }
type Settings = Record<keyof typeof settingLabels, number>
type Snapshot = { settings: Settings; _revision: string; branch_id: string; chapters: { id: string; title: string }[]; threads: Thread[]; checks: Check[] }
type Candidate = Pick<Evidence, 'kind' | 'quote' | 'explanation' | 'payoff_type' | 'followup_id'> & { thread_id: string; review_basis?: string }
type Manual = Candidate & { evidence_id?: string; _revision: string; source_revision: string }
type Review = { _revision: string; source_revision: string; candidates: Candidate[]; warnings: { thread_id: string; quote: string; message: string }[] }
type Chapter = { id: string; revision?: string; dirty: boolean; profileId?: string; openOutline: () => void }
type Props = { project: string; storyId: string; branch?: string; worldId?: string; openChapter?: (chapterId: string) => void; chapter?: Chapter; foreshadowings?: { id: string; content: string }[] }

export function SuspensePanel(props: Props) {
  const [opened, setOpened] = useState(false)
  const [branch, setBranch] = useState(props.branch || '')
  const [editing, setEditing] = useState(false)
  const { data: registry } = useSWR(opened && props.worldId && !props.chapter ? `/api/projects/${props.project}/worlds/${props.worldId}/branches` : null, api.get)
  if (!props.storyId || props.storyId === 'story_new') return <p className='text-sm text-muted'>保存故事后即可安排悬念。</p>
  return <details className='py-3' onToggle={e => { if (e.currentTarget.open) setOpened(true) }}>
    <summary className='cursor-pointer text-sm font-medium'>{props.chapter ? '本章悬念' : '悬念安排'}</summary>
    {opened && registry?.branches?.some((b: { id: string }) => b.id !== 'main') && <label className='mt-3 block max-w-sm text-sm'>剧情分支<Select value={branch || 'main'} disabled={editing} onChange={e => setBranch(e.target.value)}>{registry.branches.map((b: {id: string; label: string}) => <option key={b.id} value={b.id}>{b.id === 'main' ? '主线' : b.label}</option>)}</Select></label>}
    {opened && <SuspenseWorkspace key={branch} {...props} branch={branch} onEditing={setEditing} />}
  </details>
}

function SuspenseWorkspace({ project, storyId, branch, chapter, openChapter, foreshadowings = [], onEditing }: Props & { onEditing: (editing: boolean) => void }) {
  const base = `/api/projects/${encodeURIComponent(project)}/suspense/${encodeURIComponent(storyId)}`
  const query = new URLSearchParams()
  if (branch) query.set('branch_id', branch)
  if (chapter) query.set('chapter_id', chapter.id)
  const { data, error, mutate } = useSWR<Snapshot>(base + '?' + query, api.get)
  const [editor, setEditor] = useState<{ form: Plan; revision: string } | null>(null)
  const [selected, setSelected] = useState('')
  const [manual, setManual] = useState<Manual | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [preset, setPreset] = useState<{ settings: Settings; revision: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState('')
  const { data: events } = useSWR(editor ? `/api/projects/${project}/events?story_card_id=${encodeURIComponent(storyId)}` : null, api.get)
  const { data: information } = useSWR(editor ? `/api/projects/${project}/information-items` : null, api.get)

  useEffect(() => { onEditing(Boolean(editor || preset || busy)) }, [editor, preset, busy, onEditing])
  useEffect(() => { if (chapter?.revision) void mutate() }, [chapter?.revision, mutate])
  if (error && !data) return <p role='alert' className='mt-3 text-sm'>{error.message} <Button onClick={() => void mutate()}>重试</Button></p>
  if (!data) return <p role='status' className='mt-3 text-sm text-muted'>正在读取悬念安排…</p>

  const { threads, chapters, checks, branch_id, _revision } = data
  const infoItems = (Array.isArray(information) ? information : []).filter(item => !item.scope?.story_card_id || item.scope.story_card_id === storyId)
  const name = (id: string) => threads.find(t => t.id === id)?.question || ''
  const chapterName = (id: string) => chapters.find(c => c.id === id)?.title || '原章节'
  const chapterOptions = chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)
  const available = Boolean(chapter?.revision) && !chapter?.dirty
  const manualStale = !!manual && (chapter?.revision !== manual.source_revision || _revision !== manual._revision)
  const reviewStale = !!review && (chapter?.revision !== review.source_revision || _revision !== review._revision)
  const form = editor?.form
  const edit = (patch: Partial<Plan>) => setEditor(current => current && ({ ...current, form: { ...current.form, ...patch } }))
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setNotice(''); setBusy(true)
    try { await action() } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作未完成，请重试。')
      void mutate().catch(() => undefined)
    } finally { setBusy(false) }
  }
  const remove = (path: string) => run(async () => {
    await api.delete(`${base}/${path}?${new URLSearchParams({ branch_id, _revision })}`)
    setConfirmRemove(''); await mutate()
  })
  const removeButton = (path: string, label: string) => confirmRemove === path
    ? <><Button onClick={() => void remove(path)}>确认移除</Button><Button variant='ghost' onClick={() => setConfirmRemove('')}>取消</Button></>
    : <Button variant='ghost' onClick={() => setConfirmRemove(path)}>{label}</Button>
  const storeEvidence = (candidate: Candidate, source: 'manual' | 'review') => run(async () => {
    if (!available || !chapter || (source === 'review' ? reviewStale : manualStale)) return
    const { thread_id, ...entry } = candidate
    const result = await api.post(`${base}/${encodeURIComponent(thread_id)}/evidence`, { ...entry, chapter_id: chapter.id, branch_id,
      _revision: source === 'review' ? review?._revision : manual?._revision, source_revision: source === 'review' ? review?.source_revision : manual?.source_revision })
    if (source === 'review') setReview(current => current && ({ ...current, _revision: result._revision, candidates: current.candidates.filter(c => c !== candidate) }))
    else setManual(null)
    await mutate(); setNotice('已记录这处正文依据。')
  })
  const evidenceRows = (thread: Thread, rows: Evidence[]) => rows.map(row => {
    const path = `${encodeURIComponent(thread.id)}/evidence/${encodeURIComponent(row.id)}`
    return <li key={row.id} className='py-1'><details>
      <summary className='cursor-pointer text-sm'>{kinds[row.kind]} · {chapterName(row.chapter_id)}{!row.valid && ' · 原文已变，待核对'}</summary>
      <blockquote className='my-2 whitespace-pre-wrap text-sm'>{row.quote}</blockquote>
      {row.explanation && <p className='text-xs text-muted'>作者备注 · {row.explanation}</p>}
      {row.payoff_type && <p className='text-xs text-muted'>{payoffs[row.payoff_type]}{row.followup_id && ' · ' + name(row.followup_id)}</p>}
      {chapter?.id === row.chapter_id && <Button variant='ghost' disabled={!available || Boolean(manual)} onClick={() => setManual({ evidence_id: row.id, _revision, source_revision: chapter?.revision || '', thread_id: thread.id, kind: row.kind, quote: row.quote, explanation: row.explanation, payoff_type: row.payoff_type, followup_id: row.followup_id })}>重新核对原句</Button>}
      {openChapter && <Button variant='ghost' onClick={() => openChapter(row.chapter_id)}>打开对应章节</Button>}
      {removeButton(path, '移除这条记录')}
    </details></li>
  })
  const planRow = (thread: Thread, depth = 0): JSX.Element => {
    const { evidence, status, linked_progress, ...editable } = thread
    const { id, question } = editable
    const children = threads.filter(t => t.parent_id === id)
    return <li key={id} className={depth ? 'pl-4' : ''}>
      <details><summary className='cursor-pointer py-2 text-sm'><span className='mr-2 text-xs text-muted'>{levels[thread.level]}</span>{question}{status === 'paid' && <span className='ml-2 text-xs text-muted'>已兑现</span>}</summary>
        {thread.reader_prompt && <p className='my-2 text-sm'>可向读者展示 · {thread.reader_prompt}</p>}
        {thread.answer && <p className='my-2 text-sm'>作者预想的答案 · {thread.answer}</p>}
        {thread.due_to && <p className='text-xs text-muted'>计划在{chapterName(thread.due_to)}前后回应</p>}
        <ul>{evidenceRows(thread, evidence)}{linked_progress?.map(mark => <li key={mark.id}><details><summary className='cursor-pointer text-sm'>子项兑现 · {name(mark.origin_thread_id)} · {chapterName(mark.chapter_id)}{!mark.valid && ' · 原文已变'}</summary><blockquote className='my-2 whitespace-pre-wrap text-sm'>{mark.quote}</blockquote></details></li>)}</ul>
        <div className='flex gap-2 py-2'><Button disabled={Boolean(editor || preset)} onClick={() => { setEditor({ form: editable, revision: _revision }); setNotice('') }}>编辑悬念</Button>
          {!editor && !preset && !children.length && removeButton(encodeURIComponent(id), '移除悬念')}</div>
      </details>
      {children.length > 0 && <ul>{children.map(t => planRow(t, depth + 1))}</ul>}
    </li>
  }
  const manualEditor = chapter && manual && <div className='space-y-3'>
    <label className='block text-sm'>关联悬念<Select disabled={Boolean(manual.evidence_id)} value={manual.thread_id} onChange={e => setManual({ ...manual, thread_id: e.target.value })}>{threads.map(t => <option key={t.id} value={t.id}>{t.question}</option>)}</Select></label>
    <label className='block text-sm'>本章变化<Select value={manual.kind} onChange={e => setManual({ ...manual, kind: e.target.value as Candidate['kind'], payoff_type: undefined, followup_id: undefined })}>{options(kinds)}</Select></label>
    <label className='block text-sm'>正文原句<Textarea value={manual.quote} onChange={e => setManual({ ...manual, quote: e.target.value })} placeholder='粘贴本章已保存的一句或一段原文。' /></label>
    {manual.kind === 'payoff' && <label className='block text-sm'>兑现方式<Select value={manual.payoff_type || 'direct'} onChange={e => setManual({ ...manual, payoff_type: e.target.value as Evidence['payoff_type'], followup_id: undefined })}>{options(payoffs)}</Select></label>}
    {manual.payoff_type === 'derivative' && <label className='block text-sm'>新引出的悬念<Select value={manual.followup_id || ''} onChange={e => setManual({ ...manual, followup_id: e.target.value })}><option value=''>暂未安排</option>{threads.filter(t => t.id !== manual.thread_id).map(t => <option key={t.id} value={t.id}>{t.question}</option>)}</Select></label>}
    <label className='block text-sm'>{manual.kind === 'misdirection' ? '揭晓后如何解释这条线索（作者可见）' : '作者备注（可选）'}<Input value={manual.explanation || ''} onChange={e => setManual({ ...manual, explanation: e.target.value })} /></label>
    {manualStale && <p className='text-sm text-muted'>保存版已更新，请取消这次编辑后重新核对。</p>}
    <div className='flex gap-2'><Button variant='primary' disabled={!available || !manual.quote.trim() || manualStale} onClick={() => void storeEvidence(manual, 'manual')}>确认记录</Button><Button variant='ghost' onClick={() => setManual(null)}>取消</Button></div>
  </div>
  return <fieldset disabled={busy} className='mt-4 min-w-0 space-y-4'>
    {error && <p role='alert' className='text-sm'>{error.message}</p>}
    {!chapter && <>
      {threads.length > 0 && <ul>{threads.filter(t => !t.parent_id).map(t => planRow(t))}</ul>}
      {!editor && !preset && <Button onClick={() => setEditor({ form: { level: 'book', question: '' }, revision: _revision })}>添加悬念</Button>}
      {form && editor && <section aria-label='编辑悬念' className='space-y-3'>
        <label className='block text-sm'>读者期待知道什么？<Input value={form.question} onChange={e => edit({ question: e.target.value })} /></label>
        <div className='grid gap-3 sm:grid-cols-2'>
          <label className='block text-sm'>层级<Select value={form.level} onChange={e => edit({ level: e.target.value as Plan['level'], parent_id: '', hook_type: '', climax: false })}>{options(levels)}</Select></label>
          {form.level !== 'book' && <label className='block text-sm'>上层悬念<Select value={form.parent_id || ''} onChange={e => edit({ parent_id: e.target.value })}><option value=''>独立安排</option>{threads.filter(t => t.id !== form.id && (t.level === 'book' || (form.level === 'chapter' && t.level === 'unit'))).map(t => <option key={t.id} value={t.id}>{t.question}</option>)}</Select></label>}
        </div>
        <label className='block text-sm'>首次提出时可向读者展示的提示（可选）<Input value={form.reader_prompt || ''} onChange={e => edit({ reader_prompt: e.target.value })} /></label>
        <label className='block text-sm'>预想的答案（仅作者可见，可留空）<Input value={form.answer || ''} onChange={e => edit({ answer: e.target.value })} /></label>
        <details><summary className='cursor-pointer text-sm text-brand-600'>安排章节与线索</summary><div className='mt-3 grid gap-3 sm:grid-cols-2'>
          {([['setup_chapter_id', '首次提出'], ['due_from', '最早回应'], ['due_to', '最晚回应']] as const).map(([field, label]) => <label className='text-sm' key={field}>{label}<Select value={form[field] || ''} onChange={e => edit({ [field]: e.target.value })}><option value=''>待定</option>{chapterOptions}</Select></label>)}
          {form.level === 'chapter' && <label className='text-sm'>钩子类型<Select value={form.hook_type || ''} onChange={e => edit({ hook_type: e.target.value })}><option value=''>待定</option>{options(hooks)}</Select></label>}
          <label className='text-sm'>提醒间隔（章）<Input type='number' min='1' value={form.interval ?? ''} placeholder={form.level === 'chapter' ? String(data.settings.hook_chapters) : '按需设置'} onChange={e => edit({ interval: e.target.value ? Number(e.target.value) : null })} /></label>
          {form.level === 'chapter' && <label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={Boolean(form.climax)} onChange={e => edit({ climax: e.target.checked })} />属于连续高潮</label>}
          <label className='text-sm'>关联事件<Select value={form.event_ref || ''} onChange={e => edit({ event_ref: e.target.value })}><option value=''>暂不关联</option>{canonicalEvents(events).map(event => <option key={event.id} value={event.id}>{event.label || event.values?.scene || event.title || '未命名事件'}</option>)}</Select></label>
          {foreshadowings.some(f => f.id) && <label className='text-sm'>关联伏笔<Select value={form.foreshadowing_id || ''} onChange={e => edit({ foreshadowing_id: e.target.value })}><option value=''>暂不关联</option>{foreshadowings.filter(f => f.id).map(f => <option key={f.id} value={f.id}>{f.content || '未命名伏笔'}</option>)}</Select></label>}
          <label className='text-sm'>关联关键信息<Select value={form.information_id || ''} onChange={e => edit({ information_id: e.target.value })}><option value=''>暂不关联</option>{infoItems.map((item: {id: string; label: string}) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>
        </div></details>
        <div className='flex gap-2'><Button variant='primary' disabled={!form.question.trim() || (form.interval != null && (!Number.isInteger(form.interval) || form.interval < 1 || form.interval > 1000))} onClick={() => void run(async () => {
          await api.post(base, { branch_id, _revision: editor.revision, thread: form }); setEditor(null); await mutate(); setNotice('悬念已保存。')
        })}>保存悬念</Button><Button variant='ghost' onClick={() => setEditor(null)}>取消</Button></div>
      </section>}
      {!editor && <details><summary className='cursor-pointer text-xs text-muted'>连载提醒设置</summary><div className='mt-3 space-y-2'>
        {(Object.keys(settingLabels) as (keyof Settings)[]).map(key => (
          <label key={key} className='flex max-w-sm items-center justify-between gap-2 text-sm'>{settingLabels[key]}
            <Input className='max-w-20' type='number' min={1} max={1000} value={(preset?.settings || data.settings)[key]}
              onChange={e => setPreset({ revision: preset?.revision ?? _revision,
                settings: { ...(preset?.settings || data.settings), [key]: Number(e.target.value) } })} />
          </label>
        ))}
        {preset && <div className='flex gap-2'>
          <Button onClick={() => void run(async () => {
            await api.post(base, { branch_id, _revision: preset.revision, settings: preset.settings })
            setPreset(null); await mutate(); setNotice('提醒设置已保存。')
          })}>保存提醒设置</Button>
          <Button variant='ghost' onClick={() => setPreset(null)}>取消</Button>
        </div>}
      </div></details>}
    </>}
    {chapter && <>
      {!threads.length && <Button onClick={chapter.openOutline}>到全书构想添加悬念</Button>}
      {threads.length > 0 && <>
        {!available && <p className='text-sm text-muted'>先保存本章正文，再核对原文。</p>}
        <div className='flex flex-wrap items-center gap-2'>
          <Select aria-label='核对范围' className='sm:max-w-xs' value={selected} onChange={e => { setSelected(e.target.value); setReview(null) }}><option value=''>本故事的全部悬念</option>{threads.map(t => <option key={t.id} value={t.id}>{t.question}</option>)}</Select>
          <Button disabled={!available} onClick={() => void run(async () => {
            const result: Review = await api.post(base + '/review', { chapter_id: chapter.id, branch_id, thread_id: selected || undefined, llm_profile_id: chapter.profileId, _revision })
            setReview(result); if (!result.candidates.length && !result.warnings.length) setNotice('本章没有找到新的悬念进展。')
          })}>请 AI 核对本章</Button>
          {!manual && <Button disabled={!available} onClick={() => setManual({ _revision, source_revision: chapter.revision || '', thread_id: selected || threads[0].id, kind: 'clue', quote: '' })}>手动记录进展</Button>}
        </div>
        {manualEditor}
        {review && (reviewStale ? <p role='status' className='text-sm text-muted'>正文或安排已更新，请重新核对。</p> : <>
          {review.candidates.map((candidate, i) => <section key={i} className='space-y-2'>
            <h4 className='text-sm font-medium'>{kinds[candidate.kind]} · {name(candidate.thread_id)}</h4>
            <blockquote className='whitespace-pre-wrap text-sm'>{candidate.quote}</blockquote>
            <details><summary className='cursor-pointer text-xs text-muted'>作者备注</summary><Input aria-label='编辑候选备注' value={candidate.explanation || ''} onChange={e => setReview({ ...review, candidates: review.candidates.map((c, j) => i === j ? { ...c, explanation: e.target.value } : c) })} /></details>
            <div className='flex gap-2'><Button disabled={!available} onClick={() => void storeEvidence(candidate, 'review')}>采用</Button><Button variant='ghost' onClick={() => setReview({ ...review, candidates: review.candidates.filter(c => c !== candidate) })}>略过</Button></div>
          </section>)}
          {review.warnings.map((warning, i) => <details key={i}><summary className='cursor-pointer text-sm'>{warning.message}</summary><blockquote className='text-sm'>{warning.quote}</blockquote></details>)}
        </>)}
        {threads.filter(t => !selected || t.id === selected).map(t => {
          const rows = t.evidence.filter(e => e.chapter_id === chapter.id)
          return rows.length ? <div key={t.id}><h4 className='text-sm font-medium'>{t.question}</h4><ul>{evidenceRows(t, rows)}</ul></div> : null
        })}
      </>}
    </>}
    {checks.length > 0 && <details><summary className='cursor-pointer text-sm'>待核对（{checks.length}）</summary><ul className='mt-2 space-y-1'>{checks.map((check, i) => <li key={i} className='text-sm'>{check.thread_id && name(check.thread_id) ? name(check.thread_id) + ' · ' : ''}{check.message}</li>)}</ul></details>}
    {(busy || notice) && <p role='status' className='text-sm text-muted'>{busy ? '正在处理…' : notice}</p>}
  </fieldset>
}
