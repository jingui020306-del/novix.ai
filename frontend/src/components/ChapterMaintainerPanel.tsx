import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type ProviderInfo = {
  provider?: string
  model?: string
  fallback?: boolean
}

type PatchOperation = {
  op_id: string
  type?: string
  before?: string
  after?: string
}

type PatchReview = {
  patch_review_id?: string
  review_id?: string
  patch_id?: string
  status?: string
  source?: string
  provider?: string
  model?: string
  ops?: PatchOperation[]
}

type VersionEntry = {
  version_id: string
  label?: string
  reason?: string
  tone?: string
  is_current?: boolean
  ts?: string
  patch_id?: string
}

type VersionsPayload = {
  current_version?: string
  versions?: VersionEntry[]
}

type MemoryPack = {
  pack_id: string
  chapter_id?: string
  job_id?: string
  summary?: {
    compression_reason?: string
  }
}

type EventRow = {
  event: string
  data?: unknown
}

type ChapterMaintainerPanelProps = {
  providerInfo?: ProviderInfo | null
  pinnedTechniques: unknown[]
  pinnedTechniqueCategories: unknown[]
  reviewPatch?: PatchReview | null
  selectedOpIds: string[]
  versions?: VersionsPayload | null
  techniqueBrief: unknown
  memoryPacks: MemoryPack[]
  currentManifest: unknown
  eventGroups: Record<string, EventRow[]>
  evidenceWrap: boolean
  onTogglePatchOp: (opId: string, checked: boolean) => void
  onSelectAllPatchOps: (opIds: string[]) => void
  onApplyPatch: () => void
  onRejectPatch: () => void
  onRollbackVersion: (versionId: string) => void
  onOpenMemoryPack: (packId: string) => void
}

export function ChapterMaintainerPanel({
  providerInfo,
  pinnedTechniques,
  pinnedTechniqueCategories,
  reviewPatch,
  selectedOpIds,
  versions,
  techniqueBrief,
  memoryPacks,
  currentManifest,
  eventGroups,
  evidenceWrap,
  onTogglePatchOp,
  onSelectAllPatchOps,
  onApplyPatch,
  onRejectPatch,
  onRollbackVersion,
  onOpenMemoryPack,
}: ChapterMaintainerPanelProps) {
  const patchOps = reviewPatch?.ops || []

  return (
    <details className='rounded-ui border border-border bg-surface'>
      <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>维护记录 <span className='text-xs text-muted'>开源维护 / 调试</span></summary>
      <div className='space-y-2 border-t border-border p-2'>
        <Card
          title='运行环境'
          extra={<Badge tone={providerInfo?.fallback ? 'warn' : 'success'}>{providerInfo?.provider || '-'} / {providerInfo?.model || '-'}</Badge>}
        >
          <div className='text-xs text-muted'>备用路径：{providerInfo?.fallback ? '是' : '否'}</div>
        </Card>

        <Card title='本章挂载技法'>
          <pre className='mono text-xs max-h-40 overflow-auto rounded-ui bg-surface-2 p-2'>{JSON.stringify({
            techniques: pinnedTechniques,
            categories: pinnedTechniqueCategories,
          }, null, 2)}</pre>
        </Card>

        <PatchReviewDetails
          patch={reviewPatch}
          selectedOpIds={selectedOpIds}
          onApplyPatch={onApplyPatch}
          onRejectPatch={onRejectPatch}
          onSelectAllPatchOps={onSelectAllPatchOps}
          onTogglePatchOp={onTogglePatchOp}
        />

        <VersionTimelineDetails
          versions={versions}
          onRollbackVersion={onRollbackVersion}
        />

        <details className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>技法摘要</summary>
          <pre className='mono max-h-60 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-2 text-xs'>{JSON.stringify(techniqueBrief, null, 2)}</pre>
        </details>

        <MemoryPacksDetails memoryPacks={memoryPacks} onOpenMemoryPack={onOpenMemoryPack} />

        <details className='rounded-ui border border-border bg-surface'>
          <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>上下文记录</summary>
          <pre className='mono max-h-60 overflow-auto whitespace-pre-wrap border-t border-border bg-surface-2 p-2 text-xs'>{JSON.stringify(currentManifest || {}, null, 2)}</pre>
        </details>

        {Object.entries(eventGroups).map(([group, rows]) => (
          <details key={group} className='rounded-ui border border-border bg-surface'>
            <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>{group} <span className='text-xs text-muted'>({rows.length})</span></summary>
            <div className='border-t border-border p-2'>
              <pre className={`mono text-xs ${evidenceWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'} overflow-auto max-h-60 rounded-ui bg-surface-2 p-2`}>
                {rows.map((event) => `${event.event}\n${JSON.stringify(event.data, null, 2)}`).join('\n\n') || '暂无事件'}
              </pre>
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

function PatchReviewDetails({
  patch,
  selectedOpIds,
  onTogglePatchOp,
  onSelectAllPatchOps,
  onApplyPatch,
  onRejectPatch,
}: {
  patch?: PatchReview | null
  selectedOpIds: string[]
  onTogglePatchOp: (opId: string, checked: boolean) => void
  onSelectAllPatchOps: (opIds: string[]) => void
  onApplyPatch: () => void
  onRejectPatch: () => void
}) {
  const patchOps = patch?.ops || []

  return (
    <details className='rounded-ui border border-border bg-surface'>
      <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>校对建议审稿 <span className='text-xs text-muted'>({patchOps.length})</span></summary>
      <div className='space-y-2 border-t border-border p-2'>
        {patch ? (
          <div className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
            <div className='flex items-center justify-between gap-2'>
              <span>{patch.patch_review_id || patch.review_id || patch.patch_id}</span>
              <Badge tone={patch.status === 'pending_author_review' ? 'warn' : patch.status === 'accepted' ? 'success' : 'default'}>{patch.status || 'event_patch'}</Badge>
            </div>
            <div className='mt-1 text-muted'>{patch.source || 'proofread_agent'} · {patch.provider || '-'} / {patch.model || '-'}</div>
          </div>
        ) : null}
        {patchOps.map((op) => (
          <div key={op.op_id} className='rounded-ui border border-border bg-surface-2 p-2'>
            <label className='flex items-center gap-2 text-xs'>
              <input type='checkbox' checked={selectedOpIds.includes(op.op_id)} onChange={(event) => onTogglePatchOp(op.op_id, event.target.checked)} />
              <span className='font-medium'>{op.op_id}</span>
              <Badge>{op.type}</Badge>
            </label>
            <pre className='mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-ui bg-red-50 p-2 text-[11px] dark:bg-red-950/20'>- {op.before || ''}</pre>
            <pre className='mono mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-ui bg-emerald-50 p-2 text-[11px] dark:bg-emerald-950/20'>+ {op.after || ''}</pre>
          </div>
        ))}
        {!patchOps.length && <p className='text-xs text-muted'>还没有校对建议。</p>}
        <div className='flex gap-2'>
          <Button className='text-xs' onClick={() => onSelectAllPatchOps(patchOps.map((op) => op.op_id))}>全选</Button>
          <Button className='text-xs' onClick={onApplyPatch}>应用</Button>
          <Button className='text-xs' onClick={onRejectPatch}>拒绝</Button>
        </div>
      </div>
    </details>
  )
}

function VersionTimelineDetails({ versions, onRollbackVersion }: { versions?: VersionsPayload | null, onRollbackVersion: (versionId: string) => void }) {
  const rows = versions?.versions || []

  return (
    <details className='rounded-ui border border-border bg-surface'>
      <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>版本时间线 <span className='text-xs text-muted'>({rows.length})</span></summary>
      <div className='space-y-2 border-t border-border p-2'>
        <div className='rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-xs'>
          <div className='flex items-center justify-between gap-2'>
            <span className='font-medium'>当前版本</span>
            <Badge>{versions?.current_version || '未记录'}</Badge>
          </div>
          <div className='mt-1 text-muted'>回滚会先保存“回滚前备份”，不会直接丢掉当前正文。</div>
        </div>
        {rows.map((version) => (
          <div key={version.version_id} className='rounded-ui border border-border bg-surface-2 px-2 py-2 text-xs'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-1'>
                  <span className='font-medium'>{version.label || version.reason || '版本快照'}</span>
                  <Badge tone={version.tone === 'warn' ? 'warn' : version.is_current ? 'success' : 'default'}>{version.is_current ? '当前' : version.version_id}</Badge>
                </div>
                <div className='mt-1 text-muted'>{version.ts || '未记录时间'}</div>
                {version.patch_id ? <div className='mt-1 truncate text-muted'>关联: {version.patch_id}</div> : null}
              </div>
              <Button className='shrink-0 text-xs' disabled={version.is_current} onClick={() => onRollbackVersion(version.version_id)}>回滚</Button>
            </div>
          </div>
        ))}
        {!rows.length && <p className='text-xs text-muted'>还没有版本记录。</p>}
      </div>
    </details>
  )
}

function MemoryPacksDetails({ memoryPacks, onOpenMemoryPack }: { memoryPacks: MemoryPack[], onOpenMemoryPack: (packId: string) => void }) {
  return (
    <details className='rounded-ui border border-border bg-surface'>
      <summary className='cursor-pointer px-2 py-1.5 text-sm font-medium'>记忆包 <span className='text-xs text-muted'>({memoryPacks.length})</span></summary>
      <div className='space-y-1 border-t border-border p-2'>
        {memoryPacks.slice(0, 6).map((pack) => (
          <button key={pack.pack_id} className='w-full rounded-ui border border-border bg-surface-2 px-2 py-1 text-left text-xs hover:bg-surface' onClick={() => onOpenMemoryPack(pack.pack_id)}>
            {pack.chapter_id} / {pack.job_id}
            {pack.summary?.compression_reason ? <div className='text-[11px] text-muted'>{pack.summary.compression_reason}</div> : null}
          </button>
        ))}
        {!memoryPacks.length ? <p className='text-xs text-muted'>还没有记忆包。</p> : null}
      </div>
    </details>
  )
}
