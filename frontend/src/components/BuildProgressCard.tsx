import { Badge } from './ui/Badge'
import { Card } from './ui/Card'

type BuildProgressStep = {
  id: string
  label: string
  done: boolean
  detail: string
}

type BuildProgressCardProps = {
  steps: BuildProgressStep[]
  onOpenStep: (stepId: string) => void
}

export function BuildProgressCard({ steps, onOpenStep }: BuildProgressCardProps) {
  const doneCount = steps.filter((step) => step.done).length

  return (
    <Card
      title='建书完成度'
      extra={<Badge tone={doneCount === steps.length ? 'success' : 'warn'}>{doneCount}/{steps.length}</Badge>}
    >
      <div className='grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3'>
        {steps.map((step) => (
          <button
            key={step.id}
            className={`rounded-ui border px-3 py-2 text-left ${step.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
            onClick={() => onOpenStep(step.id)}
          >
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium'>{step.label}</span>
              <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : '待补'}</Badge>
            </div>
            <div className='mt-1 text-xs text-muted'>{step.detail}</div>
          </button>
        ))}
      </div>
    </Card>
  )
}
