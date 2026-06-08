type AgentStep = {
  name: string
  event: string
  data?: unknown
}

type RightAgentProgressProps = {
  mode: 'alignment' | 'draft'
  steps: AgentStep[]
  onModeChange: (mode: 'alignment' | 'draft') => void
}

export function RightAgentProgress({ mode, steps, onModeChange }: RightAgentProgressProps) {
  return (
    <div className='rounded-ui border border-border bg-surface p-2'>
      <div className='grid grid-cols-3 gap-2'>
        {steps.map((step) => {
          const done = Boolean(step.data)
          return (
            <div key={step.event} className='flex items-center justify-center gap-1.5 rounded-ui bg-surface-2 px-2 py-1.5 text-xs'>
              <span className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-muted/40'}`} />
              <span className={done ? 'font-medium text-foreground' : 'text-muted'}>{step.name}</span>
            </div>
          )
        })}
      </div>
      <div className='mt-2 grid grid-cols-2 gap-1 text-xs'>
        <button
          className={`rounded-ui border px-2 py-1 ${mode === 'alignment' ? 'border-teal-300 bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-100' : 'border-border bg-surface-2 text-muted'}`}
          onClick={() => onModeChange('alignment')}
        >
          写法
        </button>
        <button
          className={`rounded-ui border px-2 py-1 ${mode === 'draft' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100' : 'border-border bg-surface-2 text-muted'}`}
          onClick={() => onModeChange('draft')}
        >
          正文
        </button>
      </div>
    </div>
  )
}
