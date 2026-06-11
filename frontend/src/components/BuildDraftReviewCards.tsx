import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type BuildDraftRecord = {
  draft_id: string
  title?: string
  kind?: string
  revision?: number
  source?: string
  status?: string
  updated_at?: string
  created_at?: string
  rejection_reason?: string
  source_node?: {
    label?: string
  }
}

type BuildDraftReviewCardsProps = {
  pendingDrafts: BuildDraftRecord[]
  historyRows: BuildDraftRecord[]
  historyFilter: string
  historyCounts: Record<string, number>
  onChangeHistoryFilter: (filter: string) => void
  onOpenDraft: (draft: BuildDraftRecord) => void
  onRejectDraft: (draft: BuildDraftRecord) => void
  onRestoreDraft: (draft: BuildDraftRecord) => void
  getAcceptedScopeLabels: (draft: BuildDraftRecord) => string[]
}

const HISTORY_FILTERS = [
  ['all', '全部'],
  ['accepted', '已接受'],
  ['partially_accepted', '部分接受'],
  ['rejected', '先不用'],
]

const STATUS_LABELS: Record<string, string> = {
  accepted: '已接受',
  partially_accepted: '局部接受',
  rejected: '先不用',
  pending: '待确认',
  pending_author_review: '待确认',
  processed: '已处理',
}

function sourceLabel(source?: string) {
  if (!source) return '本地草案'
  if (source.includes('fallback')) return '本地草案'
  if (source.includes('ai') || source.includes('agent')) return 'AI 建议'
  if (source.includes('canvas')) return '脉络节点'
  return source
}

function timeLabel(draft: BuildDraftRecord) {
  return draft.updated_at || draft.created_at || '刚刚更新'
}

export function BuildDraftReviewCards({
  pendingDrafts,
  historyRows,
  historyFilter,
  historyCounts,
  onChangeHistoryFilter,
  onOpenDraft,
  onRejectDraft,
  onRestoreDraft,
  getAcceptedScopeLabels,
}: BuildDraftReviewCardsProps) {
  return (
    <>
      <Card title='待确认建书草案'>
        <div className='space-y-1'>
          {pendingDrafts.slice(0, 5).map((draft) => (
            <div key={draft.draft_id} className='rounded-ui border border-border bg-surface px-2 py-1.5 text-xs'>
              <button className='w-full text-left hover:underline' onClick={() => onOpenDraft(draft)}>
                <span className='font-medium'>{draft.title || draft.kind}</span>
                <span className='ml-2 text-muted'>版本 {draft.revision || 1} · {sourceLabel(draft.source)}</span>
              </button>
              <div className='mt-1 text-muted'>{timeLabel(draft)}</div>
              <div className='mt-1 flex gap-2'>
                <Button className='text-xs' onClick={() => onOpenDraft(draft)}>查看草案</Button>
                <Button className='text-xs' onClick={() => onRejectDraft(draft)}>先不用</Button>
              </div>
              {draft.source_node?.label ? (
                <div className='mt-1 text-[11px] text-muted'>来源节点：{draft.source_node.label}</div>
              ) : null}
            </div>
          ))}
          {!pendingDrafts.length && <p className='text-sm text-muted'>没有待确认建书草案。</p>}
        </div>
      </Card>

      <Card title='已处理草案'>
        <div className='space-y-1'>
          <div className='flex flex-wrap gap-1 pb-1'>
            {HISTORY_FILTERS.map(([key, label]) => (
              <Button
                key={key}
                className='text-xs'
                variant={historyFilter === key ? 'primary' : 'secondary'}
                onClick={() => onChangeHistoryFilter(key)}
              >
                {label} {historyCounts[key] || 0}
              </Button>
            ))}
          </div>
          {historyRows.slice(0, 5).map((draft) => (
            <div key={draft.draft_id} className='rounded-ui border border-border bg-surface px-2 py-1.5 text-xs'>
              <button className='w-full text-left hover:underline' onClick={() => onOpenDraft(draft)}>
                <span className='font-medium'>{draft.title || draft.kind}</span>
                <span className='ml-2 text-muted'>{STATUS_LABELS[draft.status || 'processed'] || draft.status || '已处理'}</span>
              </button>
              <div className='mt-1 text-muted'>{timeLabel(draft)}</div>
              <div className='mt-1 flex flex-wrap items-center gap-1 text-muted'>
                {getAcceptedScopeLabels(draft).length ? <Badge tone='success'>{getAcceptedScopeLabels(draft).join(', ')}</Badge> : null}
                {draft.rejection_reason ? <span>{draft.rejection_reason}</span> : null}
              </div>
              <div className='mt-1 flex gap-1'>
                <Button className='text-xs' onClick={() => onOpenDraft(draft)}>查看草案</Button>
                <Button className='text-xs' onClick={() => onRestoreDraft(draft)}>重新确认</Button>
              </div>
            </div>
          ))}
          {!historyRows.length && <p className='text-sm text-muted'>没有符合筛选的已处理草案。</p>}
        </div>
      </Card>
    </>
  )
}
