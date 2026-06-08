import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type TimelineNode = {
  id: string
  label: string
  status: string
  suggestion: string
  draftKind?: string
  run: () => void
}

type BookTimelinePanelProps = {
  nodes: TimelineNode[]
  selectedNodeId: string
  onAccept: (node: TimelineNode) => void
  onGenerateAlternative: (node: TimelineNode) => void
  onSelectNode: (nodeId: string) => void
  onSkip: (node: TimelineNode) => void
}

const timelineToneClass = (status: string) => {
  if (status === 'confirmed') return 'border-emerald-400 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
  if (status === 'suggesting') return 'border-sky-400 bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200'
  if (status === 'pending') return 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  if (status === 'risk') return 'border-red-400 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
  return 'border-border bg-surface-2 text-muted'
}

const statusLabel = (status: string) => {
  if (status === 'confirmed') return '作者已确认'
  if (status === 'suggesting') return 'AI 建议中'
  if (status === 'pending') return '待作者确认'
  if (status === 'risk') return '有结构风险'
  return '未开始'
}

const statusTone = (status: string) => {
  if (status === 'confirmed') return 'success'
  if (status === 'risk' || status === 'pending') return 'warn'
  return 'default'
}

export function BookTimelinePanel({ nodes, selectedNodeId, onAccept, onGenerateAlternative, onSelectNode, onSkip }: BookTimelinePanelProps) {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0]

  return (
    <Card title='Book Timeline' extra={<Badge>结构线 · 非章节目录</Badge>}>
      <div className='overflow-x-auto pb-2'>
        <div className='flex min-w-max items-center gap-2'>
          {nodes.map((node, index) => (
            <div key={node.id} className='flex items-center gap-2'>
              {index > 0 ? <div className='h-px w-8 bg-border' /> : null}
              <button
                className={`rounded-full border px-3 py-1.5 text-xs ${timelineToneClass(node.status)} ${selectedNode?.id === node.id ? 'ring-2 ring-brand-500' : ''}`}
                onClick={() => onSelectNode(node.id)}
              >
                {node.label}
              </button>
            </div>
          ))}
        </div>
      </div>
      {selectedNode ? (
        <div className='mt-3 rounded-ui border border-border bg-surface p-3'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.2fr_1fr]'>
            <div>
              <div className='text-xs text-muted'>当前状态</div>
              <div className='mt-1 flex items-center gap-2'>
                <span className='text-sm font-semibold'>{selectedNode.label}</span>
                <Badge tone={statusTone(selectedNode.status)}>{statusLabel(selectedNode.status)}</Badge>
              </div>
            </div>
            <div>
              <div className='text-xs text-muted'>AI 建议</div>
              <div className='mt-1 text-sm'>{selectedNode.suggestion}</div>
            </div>
            <div>
              <div className='text-xs text-muted'>作者决策</div>
              <div className='mt-1 flex flex-wrap gap-1.5'>
                <Button className='text-xs' onClick={() => onAccept(selectedNode)}>接受建议</Button>
                <Button className='text-xs' onClick={selectedNode.run}>修改</Button>
                <Button className='text-xs' onClick={() => onSkip(selectedNode)}>跳过</Button>
                <Button className='text-xs' onClick={() => onGenerateAlternative(selectedNode)}>生成备选</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
