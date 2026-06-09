import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type ReadyItem = {
  id: string
  label: string
  done: boolean
  detail: string
}

type CanvasNode = {
  id: string
  label: string
  type?: string
  description?: string
}

type ChapterPrewriteCardProps = {
  canGenerate: boolean
  canvasConstraintRows: CanvasNode[]
  generationScopeLabel: string
  nodeTypeLabels: Record<string, string>
  onGenerate: () => void
  onOpenCanvas: () => void
  onSaveStructure: () => void
  onToggleNode: (nodeId: string) => void
  readyItems: ReadyItem[]
  selectedNodeIds: string[]
  targetText: string
}

export function ChapterPrewriteCard({
  canGenerate,
  canvasConstraintRows,
  generationScopeLabel,
  nodeTypeLabels,
  onGenerate,
  onOpenCanvas,
  onSaveStructure,
  onToggleNode,
  readyItems,
  selectedNodeIds,
  targetText,
}: ChapterPrewriteCardProps) {
  return (
    <Card
      title='开写前卡片'
      extra={<Badge tone={canGenerate ? 'success' : 'warn'}>{generationScopeLabel}</Badge>}
      className='module-card module-draft'
    >
      <div className='grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr]'>
        <div className='space-y-2'>
          <div className='grid grid-cols-2 gap-2'>
            {readyItems.map((item) => (
              <div key={item.id} className={`rounded-ui border px-3 py-2 ${item.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface'}`}>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-sm font-medium'>{item.label}</span>
                  <Badge tone={item.done ? 'success' : 'warn'}>{item.done ? '已完成' : '待补'}</Badge>
                </div>
                <div className='mt-1 text-xs text-muted'>{item.detail}</div>
              </div>
            ))}
          </div>
          <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
            <div className='mb-2 font-medium'>本章目标</div>
            <div className='line-clamp-4 text-muted'>{targetText}</div>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button onClick={onSaveStructure}>保存结构点</Button>
            <Button onClick={onOpenCanvas}>打开画布</Button>
            <Button variant='primary' onClick={onGenerate} disabled={!canGenerate}>按共识生成</Button>
          </div>
        </div>
        <div className='rounded-ui border border-border bg-surface p-3'>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <div>
              <div className='text-sm font-semibold'>这一章要写到</div>
              <div className='text-[11px] text-muted'>勾选后会进入生成控制和证据点亮。</div>
            </div>
            <Badge>{selectedNodeIds.length}</Badge>
          </div>
          <div className='grid max-h-52 grid-cols-1 gap-1.5 overflow-auto md:grid-cols-2'>
            {canvasConstraintRows.map((node) => (
              <label
                key={`prewrite-${node.id}`}
                className={`flex cursor-pointer items-start gap-2 rounded-ui border px-2 py-1.5 text-xs ${selectedNodeIds.includes(node.id) ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-panel hover:bg-surface-2'}`}
              >
                <input className='mt-0.5' type='checkbox' checked={selectedNodeIds.includes(node.id)} onChange={() => onToggleNode(node.id)} />
                <span className='min-w-0'>
                  <span className='block truncate font-medium'>{node.label}</span>
                  <span className='line-clamp-1 block text-[11px] text-muted'>{nodeTypeLabels[node.type || ''] || node.type || '节点'} · {node.description || '待补充'}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
