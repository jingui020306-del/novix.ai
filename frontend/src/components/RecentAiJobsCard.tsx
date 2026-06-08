import { Badge } from './ui/Badge'
import { Card } from './ui/Card'

type AiJobSummary = {
  job_id: string
  chapter_id?: string
  status?: string
  last_event?: string
  stage?: string
  model?: string
  output_summary?: string
  input_summary?: string
  updated_at?: string
}

type RecentAiJobsCardProps = {
  jobs: AiJobSummary[]
  selectedJobId?: string
  onSelectJob: (job: AiJobSummary) => void
}

function toneForJob(status?: string) {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'awaiting_review') return 'warn'
  return 'default'
}

export function RecentAiJobsCard({ jobs, selectedJobId, onSelectJob }: RecentAiJobsCardProps) {
  return (
    <Card title='最近 AI 任务'>
      <div className='grid grid-cols-2 gap-2'>
        {jobs.slice(0, 6).map((job) => (
          <button
            key={job.job_id}
            className={`rounded-ui border px-3 py-2 text-left hover:bg-surface-2 ${selectedJobId === job.job_id ? 'border-brand-500 bg-surface-2' : 'border-border bg-surface'}`}
            onClick={() => onSelectJob(job)}
          >
            <div className='flex items-center justify-between gap-2'>
              <span className='truncate text-sm font-medium'>{job.chapter_id || job.job_id}</span>
              <Badge tone={toneForJob(job.status)}>{job.status || 'unknown'}</Badge>
            </div>
            <div className='mt-1 text-xs text-muted'>{job.last_event || job.stage || 'no event'} · {job.model || 'model pending'}</div>
            <div className='mt-1 text-xs text-muted'>{job.output_summary || job.input_summary || job.updated_at}</div>
          </button>
        ))}
        {!jobs.length && <p className='text-sm text-muted'>还没有生成任务。生成本章后，这里会保留任务状态。</p>}
      </div>
    </Card>
  )
}
