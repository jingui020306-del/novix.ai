import { ReactNode, useState } from 'react'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Fields'

export type PlotThread = { id: string; name: string }
export const plotThreads = (value: any): PlotThread[] => {
  const rows = Array.isArray(value) ? value.filter((row) => row && typeof row.id === 'string') : []
  return [{ id: 'main', name: rows.find((row) => row.id === 'main')?.name || '主线' }, ...rows.filter((row, index) => row.id !== 'main' && rows.findIndex((other) => other.id === row.id) === index)]
}
export const unplacedReason = (row: any, chapters: any[], threads: PlotThread[]) => {
  const reasons = []
  if (!row.chapter) reasons.push('尚未关联章节')
  else if (!chapters.some((chapter) => chapter.chapter_id === row.chapter)) reasons.push('原关联章节已不可用')
  if (row.thread_id && !threads.some((thread) => thread.id === row.thread_id)) reasons.push('原故事线已不可用')
  return reasons.join('；')
}

export function ChapterThreadsMatrix({ chapters, threads, events, busy, onEventsChange, onThreadsChange, onEdit, onSuggest, onOpenEvent, onRehearse, onOpenSource, renderExtras }: {
  chapters: any[]; threads: PlotThread[]; events: any[]; busy: boolean;
  onEventsChange: (rows: any[]) => void; onThreadsChange: (rows: PlotThread[]) => void;
  onEdit: (rowId: string, key: string, value: any) => void; onSuggest: (row: any) => void;
  onOpenEvent: (rowId: string) => void; renderExtras: (row: any) => ReactNode;
  onRehearse?: (rowId: string) => void; onOpenSource?: (row: any) => void;
}) {
  const [newName, setNewName] = useState('')
  const [message, setMessage] = useState('')
  const unplaced = events.filter((row) => unplacedReason(row, chapters, threads))
  const addThread = () => {
    const name = newName.trim()
    if (!name) { setMessage('请先给故事线起一个名称。'); return }
    if (threads.some((thread) => thread.name === name)) { setMessage('已有同名故事线，可以直接使用或换个名称。'); return }
    onThreadsChange([...threads, { id: `thread_${crypto.randomUUID().slice(0, 8)}`, name }])
    setNewName(''); setMessage('故事线已加入当前表单，请保存工作表。')
  }
  const addEvent = (chapterId: string, threadId: string) => onEventsChange([...events, { id: `important_scenes_${crypto.randomUUID().slice(0, 8)}`, chapter: chapterId, thread_id: threadId }])
  return <section className='space-y-4' aria-label='章节与线索矩阵'>
    <div><h2 className='text-lg font-semibold'>章节与线索</h2><p className='mt-2 text-sm leading-6 text-muted'>按章节并排看主线、人物支线与伏笔。每格可放多件事，与情节梗概共用记录，改一处会同步显示。</p></div>
    <details className='border-y border-border py-3'><summary className='cursor-pointer text-sm font-medium'>管理故事线</summary><div className='mt-4 space-y-3'>
      {threads.map((thread, index) => { const count = events.filter((row) => (row.thread_id || 'main') === thread.id).length; return <div key={thread.id} className='flex flex-wrap items-center gap-2'><div className='min-w-40 flex-1'><label className='sr-only' htmlFor={`plot-thread-${thread.id}`}>第 {index + 1} 列故事线名称</label><Input id={`plot-thread-${thread.id}`} value={thread.name} onChange={(event) => onThreadsChange(threads.map((row) => row.id === thread.id ? { ...row, name: event.target.value } : row))} /></div><span className='text-xs text-muted'>{count} 项事件</span><Button variant='ghost' className='text-xs' disabled={thread.id === 'main' || count > 0} title={thread.id === 'main' ? '主线保留' : count ? '请先在情节梗概中调整这些事件的故事线' : '删除空故事线'} onClick={() => onThreadsChange(threads.filter((row) => row.id !== thread.id))}>移除空列</Button></div> })}
      <div className='flex flex-wrap gap-2 border-t border-border pt-3'><div className='min-w-40 flex-1'><label className='sr-only' htmlFor='new-plot-thread'>新故事线名称</label><Input id='new-plot-thread' value={newName} onChange={(event) => setNewName(event.target.value)} placeholder='例如：人物支线、某个悬念或伏笔' /></div><Button onClick={addThread}>添加故事线</Button></div><p className='text-xs leading-5 text-muted'>含事件的列会保留。需要移除时，先到情节梗概调整事件归属，已有内容不会删除。</p>
    </div></details>
    {unplaced.length > 0 && <details className='border-b border-border pb-3'><summary className='cursor-pointer text-sm text-muted'>还有 {unplaced.length} 项事件未放入矩阵，原记录保留</summary><ul className='mt-3 space-y-2'>{unplaced.map((row) => <li key={row.id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => onOpenEvent(row.id)}>{row.scene || String(row.plot || '').slice(0, 45) || '未命名事件'}</button><p className='mt-1 text-xs text-muted'>{unplacedReason(row, chapters, threads)}；可到情节梗概调整。</p></li>)}</ul></details>}
    <div className='planning-table-scroll' role='region' tabIndex={0} aria-label='章节与线索，表内可横向滚动，章节列固定'><table className='planning-table chapter-thread-table'><caption className='sr-only'>章节按原有顺序排列，故事线为可自定义列</caption><thead><tr><th scope='col' className='thread-chapter'>章节 / 事件时间</th>{threads.map((thread) => <th scope='col' key={thread.id}>{thread.name || '未命名故事线'}</th>)}</tr></thead><tbody>{chapters.map((chapter) => {
      const times = [...new Set(events.filter((row) => row.chapter === chapter.chapter_id).map((row) => String(row.time || '').trim()).filter(Boolean))]
      return <tr key={chapter.chapter_id}><th scope='row' className='thread-chapter'><strong>{chapter.chapter_title || chapter.title || '未命名章节'}</strong>{times.length > 0 && <p className='mt-2 text-xs font-normal leading-5 text-muted'>{times.join(' / ')}</p>}</th>{threads.map((thread) => {
        const cell = events.filter((row) => row.chapter === chapter.chapter_id && (row.thread_id || 'main') === thread.id)
        return <td key={thread.id}><div className='space-y-3'>{cell.map((row, index) => <article key={row.id} className='thread-event space-y-3'>
          <div><label className='sr-only' htmlFor={`matrix-scene-${row.id}`}>{thread.name}第 {index + 1} 项事件名称</label><Input id={`matrix-scene-${row.id}`} readOnly={Boolean(row.canonical_event_ref)} value={row.scene || ''} onChange={(event) => onEdit(row.id, 'scene', event.target.value)} placeholder='事件 / 场景名称' /></div>
          <div><label className='sr-only' htmlFor={`matrix-plot-${row.id}`}>{thread.name}第 {index + 1} 项事件内容</label><Textarea id={`matrix-plot-${row.id}`} readOnly={Boolean(row.canonical_event_ref)} className='min-h-24 text-sm leading-6' value={row.plot || ''} onChange={(event) => onEdit(row.id, 'plot', event.target.value)} placeholder='在这一章，这条线发生了什么变化？' /></div>
          <div><label className='text-xs text-muted' htmlFor={`matrix-time-${row.id}`}>事件时间（可选）</label><Input id={`matrix-time-${row.id}`} readOnly={Boolean(row.canonical_event_ref)} value={row.time || ''} onChange={(event) => onEdit(row.id, 'time', event.target.value)} placeholder='沿用你自己的时间写法' /></div>
          {row.canonical_event_ref && <Button className='text-xs' onClick={() => onOpenSource?.(row)}>打开原事件编辑</Button>}
          <details><summary className='cursor-pointer text-xs text-muted'>人物、作用与关联资料</summary><div className='mt-3 space-y-3'>{renderExtras(row)}</div></details>
          <div className='flex flex-wrap gap-2'>{onRehearse && <Button className='text-xs' disabled={busy} onClick={() => onRehearse(row.id)}>推演这一场</Button>}<Button className='text-xs' disabled={busy || Boolean(row.canonical_event_ref)} onClick={() => onSuggest(row)}>AI 补充空白</Button><Button variant='ghost' className='text-xs' onClick={() => onOpenEvent(row.id)}>打开情节梗概</Button></div>
        </article>)}<Button className='w-full text-xs' disabled={busy} onClick={() => addEvent(chapter.chapter_id, thread.id)}>添加事件</Button></div></td>
      })}</tr>
    })}</tbody></table>{!chapters.length && <p className='py-8 text-sm text-muted'>还没有真实章节。先从章节目录创建章节；已有情节会继续保留在情节梗概中。</p>}</div>
    <p className='text-xs leading-5 text-muted'>章节标题和顺序读取现有目录；在表内横向滚动可查看其他故事线。所有编辑随“保存工作表”生效。</p>
    {message && <p role='status' className='text-sm text-muted'>{message}</p>}
  </section>
}
