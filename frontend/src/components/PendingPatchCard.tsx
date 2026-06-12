import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
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
    <Card title='待确认修改' extra={<Badge tone={operations.length ? 'warn' : 'success'}>{operations.length}</Badge>}>
      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-2 text-xs text-muted'>
          <span>{operations.length ? 'AI 校对后留下的修改建议，需要作者确认。' : '当前没有待处理的修改。'}</span>
          {operations.length ? <Button className='text-xs' onClick={onOpenPatchReview}>查看建议</Button> : null}
        </div>
        {operations.slice(0, 5).map((op, index) => {
          const typeLabel = op.type === 'replace' ? '替换' : op.type === 'delete' ? '删除' : op.type === 'insert' ? '补充' : '调整'
          return (
            <button
              key={op.op_id}
              className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
              onClick={onOpenPatchReview}
            >
              {index + 1}. {typeLabel} · {op.rationale || '等待作者确认'}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
