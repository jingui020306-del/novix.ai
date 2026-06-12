import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type RightTechniquePanelProps = {
  autoRecommendedTechniques: any[]
  canGenerate: boolean
  findRequirementMark: (targetType: string, candidates: string[]) => any
  markTone: (level?: string) => 'default' | 'success' | 'warn'
  onPinAutoTechnique: (row: any) => void
  onPinQuickTechnique: (row: any) => void
  onRequestTechniqueAction: (tech: any, mode: string, intensity?: string) => void
  onSelectMark: (mark: any) => void
  onUnpinTechnique: (row: any, title: string) => void
  pinnedTechniqueRows: any[]
  quickTechniqueRows: any[]
  supportLabel: (level?: string) => string
  techniqueCards: any[]
  techniqueLayerLabel: (layer?: string) => string
  techniqueTitleById: (techniqueId: string) => string
}

export function RightTechniquePanel({
  autoRecommendedTechniques,
  canGenerate,
  findRequirementMark,
  markTone,
  onPinAutoTechnique,
  onPinQuickTechnique,
  onRequestTechniqueAction,
  onSelectMark,
  onUnpinTechnique,
  pinnedTechniqueRows,
  quickTechniqueRows,
  supportLabel,
  techniqueCards,
  techniqueLayerLabel,
  techniqueTitleById,
}: RightTechniquePanelProps) {
  const suggestionRows = autoRecommendedTechniques.length ? autoRecommendedTechniques.slice(0, 4) : quickTechniqueRows.slice(0, 4)
  const shortList = (items?: unknown[], limit = 2) => Array.isArray(items) ? items.map(String).filter(Boolean).slice(0, limit) : []

  return (
    <Card title='本章技法' extra={<Badge>{pinnedTechniqueRows.length}</Badge>} className='module-card module-technique'>
      <div className='space-y-2 text-xs'>
        {pinnedTechniqueRows.map((row) => {
          const tech = (Array.isArray(techniqueCards) ? techniqueCards : []).find((x: any) => x.id === row.technique_id)
          const mark = tech ? findRequirementMark('technique', [row.technique_id, tech.title, tech.payload?.name, ...(tech.payload?.signals || [])]) : null
          const level = mark?.detection?.support_level || 'unsupported'
          const suitable = shortList(tech?.payload?.suitable_scenes)
          const unsuitable = shortList(tech?.payload?.unsuitable_scenes)
          const signals = shortList(tech?.payload?.signals)
          const dos = shortList(tech?.payload?.do_dont?.do)
          return (
            <div key={row.technique_id} className='rounded-ui border border-border bg-surface px-2 py-1.5'>
              <div className='flex items-start justify-between gap-2'>
                <div>
                  <div className='font-medium'>{tech?.title || tech?.payload?.name || row.technique_id}</div>
                  <div className='mt-1 text-muted'>{row.notes || tech?.payload?.description || '用于本章写法'}</div>
                </div>
                <Badge>{row.intensity || 'med'}</Badge>
              </div>
              <div className='mt-2 flex flex-wrap gap-1'>
                <Badge>{techniqueLayerLabel(tech?.payload?.usage_layer)}</Badge>
                <Badge tone={mark?.span?.quote ? markTone(level) : 'default'}>{mark?.span?.quote ? supportLabel(level) : '未点亮'}</Badge>
              </div>
              {mark?.span?.quote ? (
                <button
                  className='mt-2 w-full rounded-ui border border-border bg-surface-2 px-2 py-1 text-left text-muted hover:bg-surface'
                  onClick={() => onSelectMark(mark)}
                >
                  第 {mark.span.start_line} 行：{mark.span.quote}
                </button>
              ) : null}
              {suitable.length || signals.length || dos.length ? (
                <div className='mt-2 space-y-1 rounded-ui border border-border bg-surface-2 p-2 text-muted'>
                  {suitable.length ? <div>适合：{suitable.join(' / ')}</div> : null}
                  {signals.length ? <div>检查：{signals.join(' / ')}</div> : null}
                  {dos.length ? <div>写法：{dos.join(' / ')}</div> : null}
                </div>
              ) : null}
              {unsuitable.length ? <div className='mt-2 text-muted'>慎用：{unsuitable.join(' / ')}</div> : null}
              {tech?.payload?.overuse_risks?.length ? <div className='mt-2 text-amber-700 dark:text-amber-300'>使用提醒：{tech.payload.overuse_risks.slice(0, 2).join(' / ')}</div> : null}
              {tech ? (
                <div className='mt-2 grid grid-cols-3 gap-1'>
                  <Button className='text-xs' onClick={() => onRequestTechniqueAction(tech, '试写一句', row.intensity || 'med')} disabled={!canGenerate}>试写</Button>
                  <Button className='text-xs' onClick={() => onRequestTechniqueAction(tech, '改写选区', row.intensity || 'med')} disabled={!canGenerate}>改写</Button>
                  <Button className='text-xs' onClick={() => onRequestTechniqueAction(tech, '强度变体', 'high')} disabled={!canGenerate}>强度</Button>
                </div>
              ) : null}
              <Button className='mt-1 w-full text-xs' onClick={() => onUnpinTechnique(row, tech?.title || row.technique_id)}>移除</Button>
            </div>
          )
        })}
        {!pinnedTechniqueRows.length && <p className='text-muted'>本章还没有挂载技法。</p>}
        <div className='grid grid-cols-2 gap-1'>
          {suggestionRows.map((row) => {
            const isAuto = Boolean(row.technique_id)
            const id = isAuto ? row.technique_id : row.id
            return (
              <button
                key={`${id}:${row.source || 'right'}`}
                className='rounded-ui border border-border bg-surface-2 px-2 py-1 text-left hover:bg-surface'
                onClick={() => isAuto ? onPinAutoTechnique(row) : onPinQuickTechnique(row)}
              >
                {isAuto ? techniqueTitleById(row.technique_id) : (row.title || row.payload?.name || row.id)}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
