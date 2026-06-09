import type { ReactNode } from 'react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Fields'
import { Tabs } from './ui/Tabs'

type StoryRowField = {
  key: string
  label: string
  span?: string
}

type StoryPayload = {
  stages?: Record<string, unknown>[]
  open_line?: Record<string, unknown>[]
  hidden_line?: Record<string, unknown>[]
  foreshadowings?: Record<string, unknown>[]
  chapter_plan?: Record<string, unknown>[]
}

type StoryPayloadTemplate = {
  stages: Record<string, unknown>[]
  open_line: Record<string, unknown>[]
  hidden_line: Record<string, unknown>[]
  foreshadowings: Record<string, unknown>[]
  chapter_plan: Record<string, unknown>[]
}

type TraceItem = {
  type: string
  label: string
  candidates: unknown[]
}

type StoryPlanningPanelProps = {
  activeTab: string
  payload: StoryPayload
  template: StoryPayloadTemplate
  canvasPanel: ReactNode
  selectedChapter: string
  openLineRows: Record<string, unknown>[]
  hiddenLineRows: Record<string, unknown>[]
  foreshadowingRows: Record<string, unknown>[]
  storyCardPreview: unknown
  showJsonPreview: boolean
  onChangeTab: (tab: string) => void
  onUpdateRow: (section: string, index: number, key: string, value: unknown) => void
  onAddRow: (section: string, template: Record<string, unknown>) => void
  onRemoveRow: (section: string, index: number) => void
  getTraceRows: (targetType: string, candidates: unknown[]) => unknown[]
  getTraceTone: (rows: unknown[]) => string
  getTraceSummary: (rows: unknown[]) => string
}

const STORY_TABS = ['Overview', 'Canvas', 'Stages', 'Lines', 'Foreshadowings', 'Chapter Matrix']

const STAGE_FIELDS: StoryRowField[] = [
  { key: 'stage', label: '阶段', span: 'col-span-2' },
  { key: 'goal', label: '阶段目标', span: 'col-span-3' },
  { key: 'conflict', label: '阶段冲突', span: 'col-span-3' },
  { key: 'result', label: '阶段结果', span: 'col-span-2' },
  { key: 'turning_point', label: '转折点', span: 'col-span-2' },
]

const OPEN_LINE_FIELDS: StoryRowField[] = [
  { key: 'chapter', label: '章节', span: 'col-span-2' },
  { key: 'event', label: '表面事件', span: 'col-span-3' },
  { key: 'goal', label: '角色目标', span: 'col-span-3' },
  { key: 'conflict', label: '阻碍/冲突', span: 'col-span-2' },
  { key: 'result', label: '结果', span: 'col-span-2' },
]

const HIDDEN_LINE_FIELDS: StoryRowField[] = [
  { key: 'chapter', label: '章节', span: 'col-span-2' },
  { key: 'truth', label: '真实发生的事', span: 'col-span-3' },
  { key: 'visible_hint', label: '可见提示', span: 'col-span-3' },
  { key: 'hidden_meaning', label: '隐藏含义', span: 'col-span-2' },
  { key: 'reveal_timing', label: '揭示时机', span: 'col-span-2' },
]

const FORESHADOWING_FIELDS: StoryRowField[] = [
  { key: 'id', label: '伏笔ID', span: 'col-span-2' },
  { key: 'status', label: '状态', span: 'col-span-2' },
  { key: 'content', label: '伏笔内容', span: 'col-span-4' },
  { key: 'first_chapter', label: '首次出现', span: 'col-span-2' },
  { key: 'surface_signal', label: '显示方式', span: 'col-span-3' },
  { key: 'reader_feeling', label: '读者感受', span: 'col-span-3' },
  { key: 'true_meaning', label: '真实意义', span: 'col-span-4' },
  { key: 'payoff_chapter', label: '回收章节', span: 'col-span-2' },
  { key: 'payoff', label: '回收方式', span: 'col-span-4' },
  { key: 'emphasis', label: '强调方式', span: 'col-span-6' },
]

const CHAPTER_MATRIX_FIELDS: StoryRowField[] = [
  { key: 'chapter', label: '计划编号', span: 'col-span-2' },
  { key: 'chapter_id', label: '绑定章节', span: 'col-span-2' },
  { key: 'title', label: '章节标题', span: 'col-span-2' },
  { key: 'focus', label: '本章重点', span: 'col-span-3' },
  { key: 'key_events', label: '发生的事', span: 'col-span-4' },
  { key: 'conflict', label: '冲突', span: 'col-span-3' },
  { key: 'result', label: '结果', span: 'col-span-3' },
  { key: 'stage_result', label: '阶段性结果', span: 'col-span-3' },
  { key: 'open_line', label: '明线推进', span: 'col-span-3' },
  { key: 'hidden_line', label: '暗线推进', span: 'col-span-3' },
  { key: 'foreshadowing', label: '伏笔/回收', span: 'col-span-3' },
]

export function StoryPlanningPanel({
  activeTab,
  payload,
  template,
  canvasPanel,
  selectedChapter,
  openLineRows,
  hiddenLineRows,
  foreshadowingRows,
  storyCardPreview,
  showJsonPreview,
  onChangeTab,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  getTraceRows,
  getTraceTone,
  getTraceSummary,
}: StoryPlanningPanelProps) {
  return (
    <>
      <Tabs items={STORY_TABS} active={activeTab} onChange={onChangeTab} />

      {(activeTab === 'Overview' || activeTab === 'Canvas') && canvasPanel}

      {(activeTab === 'Overview' || activeTab === 'Lines' || activeTab === 'Foreshadowings') && (
        <LineTraceCard
          selectedChapter={selectedChapter}
          items={buildTraceItems(openLineRows, hiddenLineRows, foreshadowingRows)}
          getTraceRows={getTraceRows}
          getTraceTone={getTraceTone}
          getTraceSummary={getTraceSummary}
        />
      )}

      {(activeTab === 'Overview' || activeTab === 'Stages') && (
        <Card title='阶段性目标 / 冲突 / 结果'>
          <StoryRows
            section='stages'
            rows={payload.stages || []}
            fields={STAGE_FIELDS}
            template={template.stages[0]}
            onUpdateRow={onUpdateRow}
            onAddRow={onAddRow}
            onRemoveRow={onRemoveRow}
          />
        </Card>
      )}

      {(activeTab === 'Overview' || activeTab === 'Lines') && (
        <>
          <Card title='明线'>
            <StoryRows
              section='open_line'
              rows={payload.open_line || []}
              fields={OPEN_LINE_FIELDS}
              template={template.open_line[0]}
              onUpdateRow={onUpdateRow}
              onAddRow={onAddRow}
              onRemoveRow={onRemoveRow}
            />
          </Card>

          <Card title='暗线'>
            <StoryRows
              section='hidden_line'
              rows={payload.hidden_line || []}
              fields={HIDDEN_LINE_FIELDS}
              template={template.hidden_line[0]}
              onUpdateRow={onUpdateRow}
              onAddRow={onAddRow}
              onRemoveRow={onRemoveRow}
            />
          </Card>
        </>
      )}

      {(activeTab === 'Overview' || activeTab === 'Foreshadowings') && (
        <Card title='伏笔追踪表'>
          <StoryRows
            section='foreshadowings'
            rows={payload.foreshadowings || []}
            fields={FORESHADOWING_FIELDS}
            template={template.foreshadowings[0]}
            onUpdateRow={onUpdateRow}
            onAddRow={onAddRow}
            onRemoveRow={onRemoveRow}
          />
        </Card>
      )}

      {(activeTab === 'Overview' || activeTab === 'Chapter Matrix') && (
        <Card title='章节矩阵'>
          <StoryRows
            section='chapter_plan'
            rows={payload.chapter_plan || []}
            fields={CHAPTER_MATRIX_FIELDS}
            template={template.chapter_plan[0]}
            onUpdateRow={onUpdateRow}
            onAddRow={onAddRow}
            onRemoveRow={onRemoveRow}
          />
        </Card>
      )}

      {showJsonPreview ? (
        <Card title='维护预览'>
          <pre className='mono text-xs overflow-auto rounded-ui bg-surface-2 p-3'>{JSON.stringify(storyCardPreview, null, 2)}</pre>
        </Card>
      ) : null}
    </>
  )
}

function StoryRows({
  section,
  rows,
  fields,
  template,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
}: {
  section: string
  rows: Record<string, unknown>[]
  fields: StoryRowField[]
  template: Record<string, unknown>
  onUpdateRow: (section: string, index: number, key: string, value: unknown) => void
  onAddRow: (section: string, template: Record<string, unknown>) => void
  onRemoveRow: (section: string, index: number) => void
}) {
  return (
    <div className='space-y-2'>
      {rows.map((row, index) => (
        <div key={`${section}-${index}`} className='rounded-ui border border-border bg-surface p-3'>
          <div className='grid grid-cols-12 gap-2'>
            {fields.map((field) => (
              <div key={field.key} className={field.span || 'col-span-6'}>
                <label className='text-xs text-muted'>{field.label}</label>
                <Input value={String(row?.[field.key] || '')} onChange={(event) => onUpdateRow(section, index, field.key, event.target.value)} />
              </div>
            ))}
          </div>
          <div className='mt-2 flex justify-end'>
            <Button className='text-xs' onClick={() => onRemoveRow(section, index)}>删除</Button>
          </div>
        </div>
      ))}
      <Button onClick={() => onAddRow(section, template)}>新增</Button>
    </div>
  )
}

function LineTraceCard({
  selectedChapter,
  items,
  getTraceRows,
  getTraceTone,
  getTraceSummary,
}: {
  selectedChapter: string
  items: TraceItem[]
  getTraceRows: (targetType: string, candidates: unknown[]) => unknown[]
  getTraceTone: (rows: unknown[]) => string
  getTraceSummary: (rows: unknown[]) => string
}) {
  return (
    <Card title='脉络调用痕迹' extra={<Badge>{selectedChapter}</Badge>}>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
        {items.map((item, index) => {
          const traces = getTraceRows(item.type, item.candidates)
          return (
            <div key={`${item.type}-${index}`} className='rounded-ui border border-border bg-surface p-2 text-xs'>
              <div className='flex items-center justify-between gap-2'>
                <span className='font-medium'>{item.label}</span>
                <Badge tone={getTraceTone(traces) as any}>{getTraceSummary(traces)}</Badge>
              </div>
              <div className='mt-1 text-muted'>{item.type} · 当前章节证据记录</div>
            </div>
          )
        })}
        {!items.length ? <p className='text-sm text-muted'>暂无明线、暗线或伏笔节点。</p> : null}
      </div>
    </Card>
  )
}

function buildTraceItems(openLineRows: Record<string, unknown>[], hiddenLineRows: Record<string, unknown>[], foreshadowingRows: Record<string, unknown>[]): TraceItem[] {
  return [
    ...openLineRows.map((row) => ({
      type: 'open_line',
      label: String(row.event || row.result || row.chapter || '明线节点'),
      candidates: [row.id, row.chapter, row.event, row.result],
    })),
    ...hiddenLineRows.map((row) => ({
      type: 'hidden_line',
      label: String(row.visible_hint || row.truth || row.chapter || '暗线节点'),
      candidates: [row.id, row.chapter, row.visible_hint, row.hidden_meaning, row.truth],
    })),
    ...foreshadowingRows.map((row) => ({
      type: 'foreshadowing',
      label: String(row.content || row.id || '伏笔节点'),
      candidates: [row.id, row.content, row.surface_signal, row.true_meaning],
    })),
  ]
}
