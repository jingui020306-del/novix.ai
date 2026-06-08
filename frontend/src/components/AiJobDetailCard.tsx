import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type AiJobDetail = {
  job_id: string
  chapter_id?: string
  status?: string
  stage?: string
  last_event?: string
  provider?: string
  model?: string
  fallback?: boolean
  created_at?: string
  updated_at?: string
  event_total?: number
}

type AiJobEvent = {
  event?: string
  data?: {
    stage?: string
    provider?: string
    model?: string
    fallback?: boolean
    input_summary?: string
    output_summary?: string
  }
}

type AiJobDetailCardProps = {
  summary: AiJobDetail
  events: AiJobEvent[]
  manifest?: unknown
  trustReport?: unknown
  onRefresh: () => void
  onOpenChapter: (chapterId: string) => void
}

function toneForStatus(status?: string) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'warn'
  return 'default'
}

export function AiJobDetailCard({ summary, events, manifest, trustReport, onRefresh, onOpenChapter }: AiJobDetailCardProps) {
  return (
    <Card
      title='AI 任务详情'
      extra={<Badge tone={toneForStatus(summary.status)}>{summary.status || 'unknown'}</Badge>}
    >
      <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
        <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
          <div className='mb-2 font-medium'>{summary.job_id}</div>
          <div>Chapter: {summary.chapter_id || '-'}</div>
          <div>Stage: {summary.stage || summary.last_event || '-'}</div>
          <div>Provider: {summary.provider || '-'}</div>
          <div>Model: {summary.model || '-'}</div>
          <div>Fallback: {summary.fallback ? 'yes' : 'no'}</div>
          <div>Created: {summary.created_at || '-'}</div>
          <div>Updated: {summary.updated_at || '-'}</div>
          <div className='mt-2 flex flex-wrap gap-1'>
            <Button className='text-xs' onClick={onRefresh}>刷新详情</Button>
            <Button className='text-xs' onClick={() => summary.chapter_id && onOpenChapter(summary.chapter_id)}>打开章节</Button>
          </div>
        </div>
        <div className='rounded-ui border border-border bg-surface p-3 text-xs lg:col-span-2'>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <span className='font-medium'>Stage 历史</span>
            <Badge>{events.length || summary.event_total || 0}</Badge>
          </div>
          <div className='max-h-72 space-y-1 overflow-auto'>
            {events.map((event, index) => {
              const data = event.data || {}
              return (
                <div key={`${event.event}-${index}`} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>{event.event}</span>
                    <Badge tone={data.fallback ? 'warn' : 'default'}>{data.stage || event.event}</Badge>
                  </div>
                  <div className='mt-1 text-muted'>{data.provider || 'system'} / {data.model || '-'} {data.fallback ? '(fallback)' : ''}</div>
                  {data.input_summary ? <div className='mt-1'>Input: {data.input_summary}</div> : null}
                  {data.output_summary ? <div className='mt-1'>Output: {data.output_summary}</div> : null}
                </div>
              )
            })}
            {!events.length ? <p className='text-muted'>选择任务后会显示每个 stage 的输入摘要、输出摘要、provider/model 和 fallback。</p> : null}
          </div>
        </div>
      </div>
      <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-2'>
        <details className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>Context Manifest</summary>
          <pre className='mono max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-3 text-xs'>{JSON.stringify(manifest || {}, null, 2)}</pre>
        </details>
        <details className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>Trust Report</summary>
          <pre className='mono max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-3 text-xs'>{JSON.stringify(trustReport || {}, null, 2)}</pre>
        </details>
      </div>
    </Card>
  )
}
