import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Textarea } from './ui/Fields'

export type StoryCanvasNode = {
  id: string
  label: string
  type?: string
  group?: string
  status?: string
  description?: string
  ai_suggestion?: string
  author_decision?: string
}

export type StoryCanvasEdge = {
  id?: string
  from: string
  to: string
  type?: string
}

type StoryCanvasPanelProps = {
  edges: StoryCanvasEdge[]
  nodes: StoryCanvasNode[]
  selectedNodeId: string
  statusLabels: Record<string, string>
  statusToneClasses: Record<string, string>
  typeLabels: Record<string, string>
  onApplyToStory: (node: StoryCanvasNode) => void
  onConfirmNode: (node: StoryCanvasNode) => void
  onGenerateDraft: (node: StoryCanvasNode) => void
  onGenerateLocalSuggestion: (node: StoryCanvasNode) => void
  onMarkRisk: (node: StoryCanvasNode) => void
  onSave: () => void
  onSelectNode: (nodeId: string) => void
  onSkipNode: (node: StoryCanvasNode) => void
  onUpdateNode: (nodeId: string, patch: Record<string, unknown>) => void
}

const CANVAS_COLUMNS = [
  { key: 'foundation', title: '基础', subtitle: '先决定这本书的底座' },
  { key: 'thread', title: '脉络', subtitle: '明线、暗线、伏笔都归这里' },
  { key: 'volume', title: '卷', subtitle: '阶段容器，不列普通章节' },
  { key: 'beat', title: '爆点', subtitle: '强事件、转折、揭示' },
  { key: 'ending', title: '结局', subtitle: '只锁方向和承诺' },
]

export function StoryCanvasPanel({
  edges,
  nodes,
  selectedNodeId,
  statusLabels,
  statusToneClasses,
  typeLabels,
  onApplyToStory,
  onConfirmNode,
  onGenerateDraft,
  onGenerateLocalSuggestion,
  onMarkRisk,
  onSave,
  onSelectNode,
  onSkipNode,
  onUpdateNode,
}: StoryCanvasPanelProps) {
  const nodesByGroup = CANVAS_COLUMNS.reduce<Record<string, StoryCanvasNode[]>>((groups, column) => {
    groups[column.key] = nodes.filter((node) => node.group === column.key)
    return groups
  }, {})
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0]
  const nodeLabelById = (nodeId: string) => nodes.find((node) => node.id === nodeId)?.label || nodeId

  const renderNode = (node: StoryCanvasNode) => {
    const toneClass = statusToneClasses[node.status || ''] || statusToneClasses.not_started || ''
    const outgoing = edges.filter((edge) => edge.from === node.id)
    return (
      <button
        key={node.id}
        className={`canvas-node ${toneClass} ${selectedNode?.id === node.id ? 'canvas-node-active' : ''}`}
        onClick={() => onSelectNode(node.id)}
      >
        <div className='flex items-start justify-between gap-2'>
          <div>
            <div className='text-[11px] text-muted'>{typeLabels[node.type || ''] || node.type}</div>
            <div className='font-display text-sm font-semibold'>{node.label}</div>
          </div>
          <span className='canvas-dot' />
        </div>
        <div className='mt-2 line-clamp-2 text-left text-xs text-muted'>{node.description || node.ai_suggestion || '待补充'}</div>
        {outgoing.length ? <div className='mt-2 text-[10px] text-muted'>{outgoing.map((edge) => edge.type).join(' · ')}</div> : null}
      </button>
    )
  }

  const renderColumn = (title: string, subtitle: string, columnNodes: StoryCanvasNode[]) => (
    <div className='canvas-column' key={title}>
      <div className='mb-2'>
        <div className='font-display text-sm font-semibold'>{title}</div>
        <div className='text-[11px] text-muted'>{subtitle}</div>
      </div>
      <div className='space-y-2'>
        {columnNodes.map(renderNode)}
      </div>
    </div>
  )

  return (
    <Card
      title='小说脉络画布'
      extra={
        <div className='flex gap-2'>
          <Badge>{nodes.length} nodes · {edges.length} links</Badge>
          <Button className='text-xs' onClick={onSave}>保存故事卡</Button>
        </div>
      }
      className='module-card module-context'
    >
      <div className='grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]'>
        <div className='min-w-0 space-y-3'>
          <div className='canvas-board'>
            {CANVAS_COLUMNS.map((column) => renderColumn(column.title, column.subtitle, nodesByGroup[column.key] || []))}
          </div>
          <div className='rounded-ui border border-border bg-surface p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <div>
                <div className='text-sm font-semibold'>连接关系</div>
                <div className='text-[11px] text-muted'>轻量显示因果和包含关系，不做复杂分支编辑。</div>
              </div>
              <Badge>{edges.length} links</Badge>
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {edges.slice(0, 18).map((edge) => (
                <button
                  key={edge.id || `${edge.from}-${edge.to}`}
                  className='rounded-full border border-border bg-panel px-2 py-1 text-left text-[11px] hover:bg-surface-2'
                  onClick={() => onSelectNode(edge.to)}
                  title={`${nodeLabelById(edge.from)} -> ${nodeLabelById(edge.to)}`}
                >
                  <span className='font-medium'>{nodeLabelById(edge.from)}</span>
                  <span className='mx-1 text-muted'>{edge.type}</span>
                  <span className='font-medium'>{nodeLabelById(edge.to)}</span>
                </button>
              ))}
              {!edges.length ? <span className='text-xs text-muted'>暂无连接。</span> : null}
            </div>
          </div>
        </div>

        <div className='rounded-ui border border-border bg-surface p-3'>
          {selectedNode ? (
            <div className='space-y-3'>
              <div className='flex items-start justify-between gap-2'>
                <div>
                  <div className='text-xs text-muted'>{typeLabels[selectedNode.type || ''] || selectedNode.type}</div>
                  <div className='font-display text-lg font-semibold'>{selectedNode.label}</div>
                </div>
                <Badge tone={selectedNode.status === 'confirmed' ? 'success' : selectedNode.status === 'risk' || selectedNode.status === 'pending_author' ? 'warn' : 'default'}>
                  {statusLabels[selectedNode.status || ''] || selectedNode.status}
                </Badge>
              </div>
              <div>
                <label className='text-xs text-muted'>这个节点要完成什么</label>
                <Textarea
                  className='mt-1 min-h-[92px]'
                  value={selectedNode.description || ''}
                  onChange={(e) => onUpdateNode(selectedNode.id, { description: e.target.value, status: selectedNode.status === 'confirmed' ? 'pending_author' : selectedNode.status })}
                />
              </div>
              <div>
                <label className='text-xs text-muted'>AI 建议</label>
                <Textarea
                  className='mt-1 min-h-[92px]'
                  value={selectedNode.ai_suggestion || ''}
                  onChange={(e) => onUpdateNode(selectedNode.id, { ai_suggestion: e.target.value, status: 'pending_author' })}
                />
              </div>
              <div>
                <label className='text-xs text-muted'>作者决策</label>
                <Textarea
                  className='mt-1 min-h-[92px]'
                  value={selectedNode.author_decision || ''}
                  onChange={(e) => onUpdateNode(selectedNode.id, { author_decision: e.target.value, status: 'pending_author' })}
                  placeholder='写下你最终采用、修改或拒绝的原因。'
                />
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <Button onClick={() => onConfirmNode(selectedNode)}>确认</Button>
                <Button onClick={() => onGenerateDraft(selectedNode)}>生成草案</Button>
                <Button onClick={() => onGenerateLocalSuggestion(selectedNode)}>本地建议</Button>
                <Button onClick={() => onApplyToStory(selectedNode)}>写回表格</Button>
                <Button onClick={() => onMarkRisk(selectedNode)}>标记风险</Button>
                <Button onClick={() => onSkipNode(selectedNode)}>跳过</Button>
              </div>
              <div className='rounded-ui border border-border bg-surface-2 p-2 text-xs text-muted'>
                AI 只给建议；只有你点“确认”后，节点才算进入正式脉络。伏笔属于脉络内部，不会被当成和“卷”同级的主线点。
              </div>
            </div>
          ) : (
            <p className='text-sm text-muted'>选择一个节点开始整理。</p>
          )}
        </div>
      </div>
    </Card>
  )
}
