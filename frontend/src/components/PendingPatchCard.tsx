import { Card } from './ui/Card'

type PatchOperation = {
  op_id: string
  rationale?: string
  type?: string
}

type PendingPatchCardProps = {
  operations: PatchOperation[]
  onOpenPatchReview: () => void
}

export function PendingPatchCard({ operations, onOpenPatchReview }: PendingPatchCardProps) {
  return (
    <Card title='待审 AI Patch'>
      <div className='space-y-1'>
        {operations.slice(0, 5).map((op) => (
          <button
            key={op.op_id}
            className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
            onClick={onOpenPatchReview}
          >
            {op.op_id} · {op.rationale || op.type}
          </button>
        ))}
        {!operations.length && <p className='text-sm text-muted'>没有待审 patch。</p>}
      </div>
    </Card>
  )
}
