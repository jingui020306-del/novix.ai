import { Badge } from './ui/Badge'
import { Card } from './ui/Card'

type StructureNode = {
  id: string
  label: string
  description?: string
}

type EvidenceMark = {
  mark_id?: string
  detection?: {
    support_level?: string
  }
  span?: {
    start_line?: number | string
    end_line?: number | string
    quote?: string
  }
}

type ChapterStructureLightsProps = {
  nodes: StructureNode[]
  getTracesForNode: (node: StructureNode) => EvidenceMark[]
  onSelectEvidence: (mark: EvidenceMark) => void
}

export function ChapterStructureLights({ nodes, getTracesForNode, onSelectEvidence }: ChapterStructureLightsProps) {
  const totalSupported = nodes.reduce((sum, node) => {
    const traces = getTracesForNode(node)
    return sum + (traces.some((mark) => mark?.detection?.support_level === 'supported' && mark?.span?.quote) ? 1 : 0)
  }, 0)

  return (
    <Card title='本章结构点亮' extra={<Badge tone={nodes.length && totalSupported === nodes.length ? 'success' : totalSupported ? 'warn' : 'default'}>{totalSupported}/{nodes.length}</Badge>} className='module-card module-trust'>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
        {nodes.map((node) => {
          const traces = getTracesForNode(node)
          const supported = traces.filter((mark) => mark?.detection?.support_level === 'supported' && mark?.span?.quote).length
          const quoted = traces.filter((mark) => mark?.span?.quote).length
          return (
            <button
              key={node.id}
              className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2'
              onClick={() => {
                const first = traces.find((mark) => Number(mark?.span?.start_line || 0) > 0)
                if (first) onSelectEvidence(first)
              }}
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='text-sm font-medium'>{node.label}</span>
                <Badge tone={supported ? 'success' : traces.length ? 'warn' : 'default'}>
                  {supported ? '已点亮' : traces.length ? '待确认' : '未写到'}
                </Badge>
              </div>
              <div className='mt-1 line-clamp-2 text-xs text-muted'>{node.description || '暂无节点说明'}</div>
              <div className='mt-1 text-[11px] text-muted'>
                已证实 {supported} · 有文本 {quoted} · 待确认 {Math.max(traces.length - supported, 0)}
              </div>
            </button>
          )
        })}
        {!nodes.length ? (
          <div className='rounded-ui border border-dashed border-border bg-surface-2 p-3 text-sm text-muted md:col-span-3'>
            先在“本次写作控制”里勾选本章结构点。生成或检查正文后，这里会显示哪些真的被正文点亮。
          </div>
        ) : null}
      </div>
    </Card>
  )
}
