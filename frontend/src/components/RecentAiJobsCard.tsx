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

const jobSteps = [
  { id: 'plan', label: '读要求' },
  { id: 'draft', label: '写初稿' },
  { id: 'proof', label: '校对' },
]

function stepIndexForJob(stage?: string, status?: string) {
  if (status === 'completed') return jobSteps.length - 1
  const raw = stage || ''
  if (raw.includes('PRE_REVIEW') || raw.includes('MANIFEST')) return 0
  if (raw.includes('WRITER') || raw.includes('DRAFT')) return 1
  if (raw.includes('PROOFREAD') || raw.includes('PATCH')) return 2
  if (raw.includes('TRUST') || raw.includes('VERIFICATION') || raw.includes('MARK')) return 2
  return -1
}

function cleanSummary(job: AiJobSummary) {
  const text = job.output_summary || job.input_summary || ''
  if (!text || text.trim().startsWith('{') || text.trim().startsWith('[')) return ''
  return text
}

export function RecentAiJobsCard({ jobs, selectedJobId, onSelectJob }: RecentAiJobsCardProps) {
  return (
    <Card title='最近写作'>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
        {jobs.slice(0, 6).map((job) => {
          const currentStep = stepIndexForJob(job.last_event || job.stage, job.status)
          const summary = cleanSummary(job)
          return (
            <button
              key={job.job_id}
              className={`rounded-ui border px-3 py-2 text-left hover:bg-surface-2 ${selectedJobId === job.job_id ? 'border-brand-500 bg-surface-2' : 'border-border bg-surface'}`}
              onClick={() => onSelectJob(job)}
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='truncate text-sm font-medium'>{job.chapter_id || '本章写作'}</span>
                <Badge tone={toneForJob(job.status)}>{labelForStatus(job.status)}</Badge>
              </div>
              <div className='mt-2 flex items-center gap-2 text-[11px]'>
                {jobSteps.map((step, idx) => (
                  <div key={step.id} className='flex min-w-0 flex-1 items-center gap-1.5'>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${idx <= currentStep ? 'bg-brand-500' : 'bg-border'}`} />
                    <span className={idx <= currentStep ? 'truncate text-foreground' : 'truncate text-muted'}>{step.label}</span>
                    {idx < jobSteps.length - 1 ? <span className='h-px flex-1 bg-border' /> : null}
                  </div>
                ))}
              </div>
              <div className='mt-2 text-xs text-muted'>{labelForStage(job.last_event || job.stage)}</div>
              <div className='mt-1 truncate text-xs text-muted'>{summary || (job.updated_at ? `最近更新：${job.updated_at}` : '等待下一次写作动作')}</div>
            </button>
          )
        })}
        {!jobs.length && <p className='text-sm text-muted'>还没有写作记录。开始写初稿后，这里会显示当前进度。</p>}
      </div>
    </Card>
  )
}
