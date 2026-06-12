import { Badge } from './ui/Badge'
import { Card } from './ui/Card'

type FirstRunStep = {
  id: string
  label: string
  done: boolean
  detail: string
  action: string
  run: () => void
}

type FirstRunChecklistProps = {
  steps: FirstRunStep[]
}

export function FirstRunChecklist({ steps }: FirstRunChecklistProps) {
  const doneCount = steps.filter((step) => step.done).length

  return (
    <Card
      title='正式写作前检查'
      extra={<Badge tone={doneCount === steps.length ? 'success' : 'warn'}>{doneCount}/{steps.length}</Badge>}
    >
      <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
        {steps.map((step) => (
          <button
            key={step.id}
            className={`rounded-ui border px-3 py-2 text-left ${step.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
            onClick={step.run}
          >
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium'>{step.label}</span>
              <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : step.action}</Badge>
            </div>
            <div className='mt-1 text-xs text-muted'>{step.detail}</div>
          </button>
        ))}
      </div>
      <p className='mt-2 text-xs text-muted'>
        写作模型、建书、人物、卷章和正文依据全部补齐后，再开始写初稿。
      </p>
    </Card>
  )
}
