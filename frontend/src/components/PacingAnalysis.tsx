import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Select } from './ui/Fields'

type Mark = { source: string; offset: number; kind: string; quote: string }
type Analysis = { blocks: number; marks: Mark[] }

export function PacingAnalysis({ project, story, outline, chapters }: {
  project: string; story: string; outline: string; chapters: { chapter_id: string; title?: string }[];
}) {
  const { data: allowed } = useSWR<string[]>(`/api/projects/${project}/pacing/chapters/${story}`, api.get)
  const [chapter, setChapter] = useState('')
  const [result, setResult] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setResult(null); setError('')
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${project}/pacing`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ story_id: story, chapter_id: chapter || null, outline: chapter ? '' : outline }),
        })
        const value = await response.json()
        if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : '读取失败')
        if (!controller.signal.aborted) setResult(value)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '节奏分析未完成')
      }
    }, 400)
    return () => { clearTimeout(timer); controller.abort() }
  }, [project, story, outline, chapter, attempt])
  return <section aria-label="节奏标注" className="space-y-3 py-3">
    <label className="flex items-center gap-3 text-sm">分析范围<Select value={chapter} onChange={e => setChapter(e.target.value)}>
      <option value="">全文</option>{chapters.filter(c => allowed?.includes(c.chapter_id)).map(c => <option key={c.chapter_id} value={c.chapter_id}>章节 · {c.title || c.chapter_id}</option>)}
    </Select></label>
    {error ? <p role="status">{error} <button className="text-brand-600" onClick={() => setAttempt(i => i + 1)}>重试</button></p>
      : !result ? <p role="status">正在读取原文并进行本地标注…</p>
      : !result.blocks ? <p>暂无可分析的总纲或正文。</p>
      : !result.marks.length ? <p>已读取原文，暂无有明确依据的节奏标注。</p>
      : <ol className="divide-y divide-border">{result.marks.map(m => <li className="py-2" key={JSON.stringify([m.source,m.offset,m.kind,m.quote])}>
        <strong>{m.kind}</strong><span className="ml-2 text-xs text-muted">{chapters.find(c => c.chapter_id === m.source)?.title || m.source} · 第 {m.offset + 1} 字</span>
        <p>{m.quote}</p></li>)}</ol>}
  </section>
}
