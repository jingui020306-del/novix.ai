import type { ReactNode } from 'react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type BuildStep = {
  id: string
  label: string
  done: boolean
  detail: string
}

type ActiveBuildStep = {
  id: string
  label?: string
  draftKind?: string
  checks?: string[]
}

type BuildDraftRecord = {
  draft_id?: string
  title?: string
  kind?: string
  revision?: number
  source?: string
  status?: string
  selected_chapter?: string
  updated_at?: string
  created_at?: string
  accepted_target?: string
  rejection_reason?: string
  generation_reason?: string
  source_node?: {
    label?: string
  }
}

type StoryBuildWizardPanelProps = {
  steps: BuildStep[]
  activeStepId: string
  activeStep: ActiveBuildStep
  busy: boolean
  selectedDraft?: BuildDraftRecord | null
  pendingDrafts: BuildDraftRecord[]
  processedDrafts: BuildDraftRecord[]
  historyRows: BuildDraftRecord[]
  historyFilter: string
  historyCounts: Record<string, number>
  draftEditor: ReactNode
  onSelectStep: (stepId: string) => void
  onGenerateDraft: (kind: string, sourceNode?: unknown) => void
  onSaveStory: () => void
  onOpenDraft: (draft: BuildDraftRecord) => void
  onRejectDraft: (draft: BuildDraftRecord) => void
  onRestoreDraft: (draft: BuildDraftRecord) => void
  onChangeHistoryFilter: (filter: string) => void
  onAcceptDraft: () => void
  getAcceptedScopeLabels: (draft: BuildDraftRecord) => string[]
}

const HISTORY_FILTERS = [
  ['all', '全部'],
  ['accepted', '已接受'],
  ['partially_accepted', '局部'],
  ['rejected', '已拒绝'],
]

export function StoryBuildWizardPanel({
  steps,
  activeStepId,
  activeStep,
  busy,
  selectedDraft,
  pendingDrafts,
  processedDrafts,
  historyRows,
  historyFilter,
  historyCounts,
  draftEditor,
  onSelectStep,
  onGenerateDraft,
  onSaveStory,
  onOpenDraft,
  onRejectDraft,
  onRestoreDraft,
  onChangeHistoryFilter,
  onAcceptDraft,
  getAcceptedScopeLabels,
}: StoryBuildWizardPanelProps) {
  return (
    <Card
      title='小说建设向导 / 待确认草案'
      extra={<Badge>单环节生成 · 可刷新 · 可编辑 · 确认后写入</Badge>}
    >
      <div className='grid grid-cols-12 gap-3'>
        <div className='col-span-5 space-y-2'>
          <div className='grid grid-cols-2 gap-2'>
            {steps.map((step) => (
              <button
                key={step.id}
                className={`rounded-ui border px-3 py-2 text-left ${activeStepId === step.id ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
                onClick={() => onSelectStep(step.id)}
              >
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-sm font-medium'>{step.label}</span>
                  <Badge tone={step.done ? 'success' : 'warn'}>{step.done ? '已完成' : '待补'}</Badge>
                </div>
                <div className='mt-1 text-xs text-muted'>{step.detail}</div>
              </button>
            ))}
          </div>
          <div className='rounded-ui border border-border bg-surface p-2'>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <div className='text-xs font-medium'>{activeStep.label || '建设步骤'}</div>
                <div className='mt-1 flex flex-wrap gap-1'>
                  {(activeStep.checks || []).map((check) => <Badge key={check}>{check}</Badge>)}
                </div>
              </div>
              {activeStep.draftKind ? (
                <div className='flex flex-col gap-1'>
                  <Button className='text-xs' disabled={busy} onClick={() => onGenerateDraft(activeStep.draftKind || 'story_overview')}>
                    {busy ? '生成中...' : '生成此步草案'}
                  </Button>
                  {activeStepId === 'lines' && <Button className='text-xs' disabled={busy} onClick={() => onGenerateDraft('foreshadowing')}>生成伏笔草案</Button>}
                </div>
              ) : (
                <Button className='text-xs' onClick={onSaveStory}>保存故事卡</Button>
              )}
            </div>
          </div>
          <div className='rounded-ui border border-border bg-surface-2 p-2 text-xs text-muted'>
            草案不会自动覆盖卡片。你可以按步骤生成、在右侧结构化修改，也可以局部确认某几条内容。
          </div>
          <DraftQueue
            drafts={pendingDrafts}
            onOpenDraft={onOpenDraft}
            onRejectDraft={onRejectDraft}
          />
          <DraftHistory
            rows={historyRows}
            processedCount={processedDrafts.length}
            historyFilter={historyFilter}
            historyCounts={historyCounts}
            onChangeHistoryFilter={onChangeHistoryFilter}
            onOpenDraft={onOpenDraft}
            onRestoreDraft={onRestoreDraft}
            getAcceptedScopeLabels={getAcceptedScopeLabels}
          />
        </div>
        <div className='col-span-7'>
          {selectedDraft ? (
            <div className='space-y-2'>
              <div className='flex items-center justify-between gap-2'>
                <div className='text-sm font-medium'>{selectedDraft.title} <span className='text-xs text-muted'>rev {selectedDraft.revision}</span></div>
                <div className='flex gap-2'>
                  <Button className='text-xs' disabled={busy} onClick={() => onGenerateDraft(selectedDraft.kind || 'story_overview', selectedDraft.source_node || null)}>{busy ? '生成中...' : '刷新这一环节'}</Button>
                  <Button className='text-xs' variant='primary' onClick={onAcceptDraft}>确认写入</Button>
                </div>
              </div>
              <div className='flex flex-wrap gap-2 text-xs text-muted'>
                <Badge>{selectedDraft.status || 'pending'}</Badge>
                <Badge>{selectedDraft.source || 'local'}</Badge>
                {getAcceptedScopeLabels(selectedDraft).length ? <Badge tone='success'>已接受: {getAcceptedScopeLabels(selectedDraft).join(', ')}</Badge> : null}
                {selectedDraft.accepted_target ? <Badge>写入: {selectedDraft.accepted_target}</Badge> : null}
                {selectedDraft.rejection_reason ? <Badge tone='warn'>拒绝: {selectedDraft.rejection_reason}</Badge> : null}
                {selectedDraft.source_node?.label ? <Badge>来源节点: {selectedDraft.source_node.label}</Badge> : null}
                {selectedDraft.draft_id ? <span>{selectedDraft.draft_id}</span> : <span>未落盘 fallback</span>}
              </div>
              {selectedDraft.generation_reason ? <div className='text-xs text-muted'>{selectedDraft.generation_reason}</div> : null}
              {draftEditor}
            </div>
          ) : (
            draftEditor
          )}
        </div>
      </div>
    </Card>
  )
}

function DraftQueue({
  drafts,
  onOpenDraft,
  onRejectDraft,
}: {
  drafts: BuildDraftRecord[]
  onOpenDraft: (draft: BuildDraftRecord) => void
  onRejectDraft: (draft: BuildDraftRecord) => void
}) {
  return (
    <div className='space-y-1 rounded-ui border border-border bg-surface p-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs font-medium'>待确认队列</span>
        <Badge>{drafts.length}</Badge>
      </div>
      <div className='max-h-36 space-y-1 overflow-auto'>
        {drafts.slice(0, 6).map((draft) => (
          <div key={draft.draft_id} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
            <button className='w-full text-left hover:underline' onClick={() => onOpenDraft(draft)}>
              <span className='font-medium'>{draft.title || draft.kind}</span>
              <span className='ml-2 text-muted'>rev {draft.revision || 1}</span>
            </button>
            <div className='mt-1 text-muted'>{draft.updated_at || draft.created_at || 'no timestamp'}</div>
            <div className='mt-1 flex items-center justify-between gap-2 text-muted'>
              <span>{draft.source || 'unknown'} · {draft.selected_chapter || 'no chapter'}</span>
              <div className='flex gap-1'>
                <Button className='text-xs' onClick={() => onOpenDraft(draft)}>打开</Button>
                <Button className='text-xs' onClick={() => onRejectDraft(draft)}>拒绝</Button>
              </div>
            </div>
            {draft.source_node?.label ? (
              <div className='mt-1 text-[11px] text-muted'>来源节点：{draft.source_node.label}</div>
            ) : null}
          </div>
        ))}
        {!drafts.length && <div className='text-xs text-muted'>暂无待确认草案。</div>}
      </div>
    </div>
  )
}

function DraftHistory({
  rows,
  processedCount,
  historyFilter,
  historyCounts,
  onChangeHistoryFilter,
  onOpenDraft,
  onRestoreDraft,
  getAcceptedScopeLabels,
}: {
  rows: BuildDraftRecord[]
  processedCount: number
  historyFilter: string
  historyCounts: Record<string, number>
  onChangeHistoryFilter: (filter: string) => void
  onOpenDraft: (draft: BuildDraftRecord) => void
  onRestoreDraft: (draft: BuildDraftRecord) => void
  getAcceptedScopeLabels: (draft: BuildDraftRecord) => string[]
}) {
  return (
    <div className='space-y-1 rounded-ui border border-border bg-surface p-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs font-medium'>已处理草案</span>
        <Badge>{rows.length}/{processedCount}</Badge>
      </div>
      <div className='flex flex-wrap gap-1'>
        {HISTORY_FILTERS.map(([key, label]) => (
          <Button key={key} className='text-xs' variant={historyFilter === key ? 'primary' : 'secondary'} onClick={() => onChangeHistoryFilter(key)}>
            {label} {historyCounts[key] || 0}
          </Button>
        ))}
      </div>
      <div className='max-h-36 space-y-1 overflow-auto'>
        {rows.slice(0, 6).map((draft) => (
          <div key={draft.draft_id} className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
            <button className='w-full text-left hover:underline' onClick={() => onOpenDraft(draft)}>
              <span className='font-medium'>{draft.title || draft.kind}</span>
              <span className='ml-2 text-muted'>{draft.status || 'processed'}</span>
            </button>
            <div className='mt-1 text-muted'>{draft.updated_at || draft.created_at || 'no timestamp'}</div>
            <div className='mt-1 flex flex-wrap items-center gap-1 text-muted'>
              {getAcceptedScopeLabels(draft).length ? <Badge tone='success'>{getAcceptedScopeLabels(draft).join(', ')}</Badge> : null}
              {draft.accepted_target ? <span>target: {draft.accepted_target}</span> : null}
              {draft.rejection_reason ? <span>{draft.rejection_reason}</span> : null}
            </div>
            <div className='mt-1 flex gap-1'>
              <Button className='text-xs' onClick={() => onOpenDraft(draft)}>打开</Button>
              <Button className='text-xs' onClick={() => onRestoreDraft(draft)}>恢复待确认</Button>
            </div>
          </div>
        ))}
        {!rows.length && <div className='text-xs text-muted'>没有符合筛选的已处理草案。</div>}
      </div>
    </div>
  )
}
