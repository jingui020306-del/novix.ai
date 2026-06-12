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

function statusLabel(status?: string) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '有问题'
  if (status === 'running') return '写作中'
  if (status === 'queued') return '排队中'
  if (status === 'awaiting_review') return '待确认'
  return status || '等待中'
}

function stageLabel(stage?: string) {
  const raw = stage || ''
  if (raw.includes('PRE_REVIEW')) return '确认写法'
  if (raw.includes('CONTEXT') || raw.includes('MANIFEST')) return '整理材料'
  if (raw.includes('WRITER') || raw.includes('DRAFT')) return '扩展初稿'
  if (raw.includes('PROOFREAD') || raw.includes('PATCH')) return '给出校对建议'
  if (raw.includes('TRUST') || raw.includes('VERIFICATION') || raw.includes('MARK')) return '检查正文依据'
  if (raw.includes('DONE') || raw.includes('COMPLETE')) return '完成'
  return raw || '等待下一步'
}

export function AiJobDetailCard({ summary, events, manifest, trustReport, onRefresh, onOpenChapter }: AiJobDetailCardProps) {
  return (
    <Card
      title='写作记录'
      extra={<Badge tone={toneForStatus(summary.status)}>{statusLabel(summary.status)}</Badge>}
    >
      <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
        <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
          <div className='mb-2 font-medium'>{summary.chapter_id || '本章写作'}</div>
          <div>章节：{summary.chapter_id || '-'}</div>
          <div>当前阶段：{stageLabel(summary.stage || summary.last_event)}</div>
          <div>最近更新：{summary.updated_at || '-'}</div>
          <div className='mt-2 flex flex-wrap gap-1'>
            <Button className='text-xs' onClick={onRefresh}>刷新记录</Button>
            <Button className='text-xs' onClick={() => summary.chapter_id && onOpenChapter(summary.chapter_id)}>打开章节</Button>
          </div>
          <details className='mt-3 rounded-ui border border-border bg-surface-2'>
            <summary className='cursor-pointer px-2 py-1 font-medium'>技术明细</summary>
            <div className='space-y-1 border-t border-border p-2 text-muted'>
              <div>记录 ID：{summary.job_id}</div>
              <div>模型来源：{summary.provider || '-'}</div>
              <div>模型：{summary.model || '-'}</div>
              <div>备用路径：{summary.fallback ? '是' : '否'}</div>
              <div>创建：{summary.created_at || '-'}</div>
            </div>
          </details>
        </div>
        <div className='rounded-ui border border-border bg-surface p-3 text-xs lg:col-span-2'>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <span className='font-medium'>写作过程</span>
            <Badge>{events.length || summary.event_total || 0}</Badge>
          </div>
          <div className='max-h-72 space-y-1 overflow-auto'>
            {events.map((event, index) => {
              const data = event.data || {}
              return (
                <div key={`${event.event}-${index}`} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>{stageLabel(data.stage || event.event)}</span>
                    <Badge tone={data.fallback ? 'warn' : 'default'}>{data.fallback ? '备用' : '正常'}</Badge>
                  </div>
                  {data.input_summary ? <div className='mt-1'>输入摘要：{data.input_summary}</div> : null}
                  {data.output_summary ? <div className='mt-1'>输出摘要：{data.output_summary}</div> : null}
                  <details className='mt-1 text-muted'>
                    <summary className='cursor-pointer'>技术来源</summary>
                    <div className='mt-1'>{data.provider || '系统'} / {data.model || '-'} {data.fallback ? '（备用）' : ''}</div>
                    <div>{event.event}</div>
                  </details>
                </div>
              )
            })}
            {!events.length ? <p className='text-muted'>选择写作记录后，会显示每一步做了什么和留下了什么建议。</p> : null}
          </div>
        </div>
      </div>
      <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-2'>
        <details className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>AI 记住了什么</summary>
          <pre className='mono max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-3 text-xs'>{JSON.stringify(manifest || {}, null, 2)}</pre>
        </details>
        <details className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>依据检查</summary>
          <pre className='mono max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-3 text-xs'>{JSON.stringify(trustReport || {}, null, 2)}</pre>
        </details>
      </div>
    </Card>
  )
}
