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

function labelForStatus(status?: string) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '有问题'
  if (status === 'awaiting_review') return '待确认'
  if (status === 'running') return '写作中'
  if (status === 'queued') return '排队中'
  return '待开始'
}

function labelForStage(stage?: string) {
  const raw = stage || ''
  if (raw.includes('PRE_REVIEW')) return '审查写作要求'
  if (raw.includes('WRITER') || raw.includes('DRAFT')) return '扩展正文'
  if (raw.includes('PROOFREAD') || raw.includes('PATCH')) return '校对建议'
  if (raw.includes('TRUST') || raw.includes('VERIFICATION') || raw.includes('MARK')) return '检查证据'
  if (raw.includes('DONE')) return '完成'
  return '等待下一步'
}

export function RecentAiJobsCard({ jobs, selectedJobId, onSelectJob }: RecentAiJobsCardProps) {
  return (
    <Card title='AI 写作进度'>
      <div className='grid grid-cols-2 gap-2'>
        {jobs.slice(0, 6).map((job) => (
          <button
            key={job.job_id}
            className={`rounded-ui border px-3 py-2 text-left hover:bg-surface-2 ${selectedJobId === job.job_id ? 'border-brand-500 bg-surface-2' : 'border-border bg-surface'}`}
            onClick={() => onSelectJob(job)}
          >
            <div className='flex items-center justify-between gap-2'>
              <span className='truncate text-sm font-medium'>{job.chapter_id || job.job_id}</span>
              <Badge tone={toneForJob(job.status)}>{labelForStatus(job.status)}</Badge>
            </div>
            <div className='mt-1 text-xs text-muted'>{labelForStage(job.last_event || job.stage)}</div>
            <div className='mt-1 text-xs text-muted'>{job.output_summary || job.input_summary || job.updated_at}</div>
          </button>
        ))}
        {!jobs.length && <p className='text-sm text-muted'>还没有写作记录。生成本章后，这里会显示当前进度。</p>}
      </div>
    </Card>
  )
}
