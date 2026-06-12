import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

export type ChapterWorkflowStep = {
  id: string
  label: string
  done: boolean
  detail: string
  action: string
  disabled?: boolean
  run: () => void
}

type ChapterWorkflowChecklistProps = {
  steps: ChapterWorkflowStep[]
}

export function ChapterWorkflowChecklist({ steps }: ChapterWorkflowChecklistProps) {
  const completed = steps.filter((step) => step.done).length
  return (
    <details className='rounded-ui border border-border bg-surface'>
      <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>
        初稿后的作者流程 <span className='text-xs text-muted'>({completed}/{steps.length})</span>
      </summary>
      <div className='grid grid-cols-1 gap-2 border-t border-border p-3 md:grid-cols-4'>
        {steps.map((step) => (
          <div key={step.id} className={`rounded-ui border p-3 ${step.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface'}`}>
            <div className='flex items-start justify-between gap-2'>
              <div>
                <div className='text-sm font-semibold'>{step.label}</div>
                <div className='mt-1 text-xs text-muted'>{step.detail}</div>
              </div>
              <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : '待做'}</Badge>
            </div>
            <Button className='mt-3 w-full text-xs' onClick={step.run} disabled={step.disabled}>
              {step.action}
            </Button>
          </div>
        ))}
      </div>
    </details>
  )
}
