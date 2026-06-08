import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

type PendingWriteJob = {
  maxTokens: number
  range: { start: number; end: number } | null
  label: string
  techniqueAction?: any
}

type ReadinessItem = {
  label: string
  done: boolean
  detail: string
}

type WriteConfirmOverlayProps = {
  agreedDraft: string
  alignmentConfirmed: boolean
  autoApplyPatch: boolean
  chapterLabel: string
  currentStoryLinks: {
    chapterPlan: any[]
    openLine: any[]
    hiddenLine: any[]
    foreshadowings: any[]
  }
  generationCheckLabel: string
  generationScopeLabel: string
  generationStopLabel: string
  generationUseCards: boolean
  generationUseLines: boolean
  generationUseTechniques: boolean
  llmProfileId: string
  pendingWriteJob: PendingWriteJob
  pinnedTechniques: any[]
  readinessItems: ReadinessItem[]
  selectedCanvasConstraints: any[]
  techniqueCards: any[]
  useAgentAssignments: boolean
  volumeLabel: string
  writeRouteRows: any[]
  memoryPackCount: number
  onCancel: () => void
  onConfirm: () => void
  onGoSettings: () => void
}

export function WriteConfirmOverlay({
  agreedDraft,
  alignmentConfirmed,
  autoApplyPatch,
  chapterLabel,
  currentStoryLinks,
  generationCheckLabel,
  generationScopeLabel,
  generationStopLabel,
  generationUseCards,
  generationUseLines,
  generationUseTechniques,
  llmProfileId,
  pendingWriteJob,
  pinnedTechniques,
  readinessItems,
  selectedCanvasConstraints,
  techniqueCards,
  useAgentAssignments,
  volumeLabel,
  writeRouteRows,
  memoryPackCount,
  onCancel,
  onConfirm,
  onGoSettings,
}: WriteConfirmOverlayProps) {
  const readyCount = readinessItems.filter((item) => item.done).length
  const allReady = readyCount === readinessItems.length
  const routeLabels: Record<string, { label: string; purpose: string }> = {
    chapter_writer: { label: '写初稿', purpose: '扩展正文' },
    chapter_reviewer: { label: '审故事', purpose: '检查人设/脉络/技法' },
    proofreader: { label: '改错字', purpose: '只做基础校对' },
    canon_extractor: { label: '存事实', purpose: '提取待确认事实' },
  }
  const orderedRouteRows = ['chapter_writer', 'chapter_reviewer', 'proofreader', 'canon_extractor'].map((module) => {
    const row = writeRouteRows.find((item: any) => item.module === module)
    return row || { module, profile_id: '未读取', provider: '', model: '', profile_missing: true, missing_fields: ['profile'] }
  })
  const routeReady = (row: any) => Boolean(row && !row.is_mock && !row.profile_missing && !row.missing_fields?.length)
  const readyRoutes = orderedRouteRows.filter(routeReady).length

  return (
    <div className='fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-10 backdrop-blur-[1px]' onMouseDown={onCancel}>
      <div
        role='dialog'
        aria-modal='true'
        aria-label='生成前确认'
        className='w-[min(840px,96vw)] rounded-ui border border-border bg-panel shadow-soft'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className='border-b border-border px-4 py-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <h3 className='text-base font-semibold'>生成前确认</h3>
              <p className='text-xs text-muted'>确认作者已经同意本章写法、材料和检查项，再让 AI 扩展初稿。</p>
            </div>
            <Badge tone={allReady ? 'success' : 'warn'}>{readyCount}/{readinessItems.length}</Badge>
          </div>
        </div>
        <div className='max-h-[72vh] overflow-auto p-4'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 font-medium'>本次写作</div>
              <div>动作：{pendingWriteJob.label}</div>
              <div>章节：{chapterLabel}</div>
              <div>所属卷：{volumeLabel}</div>
              <div>范围：{pendingWriteJob.range ? `正文 L${pendingWriteJob.range.start}-L${pendingWriteJob.range.end}` : '整章初稿'}</div>
              {pendingWriteJob.techniqueAction ? (
                <div className='mt-2 rounded-ui border border-border bg-surface-2 p-2'>
                  <div className='font-medium'>技法动作：{pendingWriteJob.techniqueAction.mode}</div>
                  <div className='text-muted'>{pendingWriteJob.techniqueAction.technique_title} · {pendingWriteJob.techniqueAction.intensity || 'med'}</div>
                </div>
              ) : null}
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='font-medium'>生成控制</span>
                <Badge>{generationScopeLabel}</Badge>
              </div>
              <div>生成范围：{generationScopeLabel}</div>
              <div>停止点：{generationStopLabel}</div>
              <div>检查方式：{generationCheckLabel}</div>
              <div className='mt-2 flex flex-wrap gap-1'>
                <Badge tone={generationUseCards ? 'success' : 'warn'}>{generationUseCards ? '使用卡片' : '不使用卡片'}</Badge>
                <Badge tone={generationUseTechniques ? 'success' : 'warn'}>{generationUseTechniques ? '使用技法' : '不使用技法'}</Badge>
                <Badge tone={generationUseLines ? 'success' : 'warn'}>{generationUseLines ? '使用脉络' : '不使用脉络'}</Badge>
              </div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs md:col-span-2'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='font-medium'>作者同意这样写</span>
                <Badge tone={alignmentConfirmed ? 'success' : 'warn'}>{alignmentConfirmed ? '已确认' : '待确认'}</Badge>
              </div>
              <div className='max-h-36 overflow-auto whitespace-pre-wrap rounded-ui border border-border bg-surface-2 p-2 text-muted'>
                {agreedDraft || '还没有写作共识。请先在章节页上方确认“作者同意这样写”。'}
              </div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs md:col-span-2'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='font-medium'>本章结构点</span>
                <Badge tone={selectedCanvasConstraints.length ? 'success' : 'warn'}>{selectedCanvasConstraints.length}</Badge>
              </div>
              <div className='flex flex-wrap gap-1.5'>
                {selectedCanvasConstraints.map((node: any) => (
                  <Badge key={node.id}>{node.label}</Badge>
                ))}
                {!selectedCanvasConstraints.length ? <span className='text-muted'>还没有选择结构点。可以继续生成，但 AI 不会知道这一章明确要写哪个脉络/爆点。</span> : null}
              </div>
            </div>
          </div>

          <div className='mt-3 rounded-ui border border-border bg-surface p-3 text-xs'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <span className='font-medium'>本章开写检查</span>
              <Badge tone={allReady ? 'success' : 'warn'}>{readyCount}/{readinessItems.length}</Badge>
            </div>
            <div className='grid grid-cols-2 gap-1.5 md:grid-cols-4'>
              {readinessItems.map((item) => (
                <div key={item.label} className={`rounded-ui border px-2 py-1.5 ${item.done ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface-2'}`}>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='font-medium'>{item.label}</span>
                    <Badge tone={item.done ? 'success' : 'warn'}>{item.done ? '已亮' : '待补'}</Badge>
                  </div>
                  <div className='mt-1 truncate text-muted'>{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-3'>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>章节计划</span><Badge>{currentStoryLinks.chapterPlan.length}</Badge></div>
              {(currentStoryLinks.chapterPlan || []).slice(0, 4).map((row: any, idx: number) => (
                <div key={`confirm-plan-${idx}`} className='mb-1 truncate text-muted'>{row.title || row.focus || row.chapter || row.chapter_id}</div>
              ))}
              {!currentStoryLinks.chapterPlan.length && <div className='text-muted'>还没有绑定章节计划。</div>}
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>明线 / 暗线</span><Badge>{currentStoryLinks.openLine.length + currentStoryLinks.hiddenLine.length}</Badge></div>
              <div className='text-muted'>明线：{currentStoryLinks.openLine.length ? currentStoryLinks.openLine.map((x: any) => x.event || x.result || x.chapter).join(' / ') : '未绑定'}</div>
              <div className='mt-1 text-muted'>暗线：{currentStoryLinks.hiddenLine.length ? currentStoryLinks.hiddenLine.map((x: any) => x.visible_hint || x.truth || x.chapter).join(' / ') : '未绑定'}</div>
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>伏笔</span><Badge>{currentStoryLinks.foreshadowings.length}</Badge></div>
              {currentStoryLinks.foreshadowings.slice(0, 4).map((x: any) => (
                <div key={x.id || x.content} className='mb-1 truncate text-muted'>{x.content || x.id} ({x.status || '未出现'})</div>
              ))}
              {!currentStoryLinks.foreshadowings.length && <div className='text-muted'>还没有绑定伏笔。</div>}
            </div>
          </div>

          <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>本章技法</span><Badge>{pinnedTechniques.length}</Badge></div>
              {pinnedTechniques.slice(0, 6).map((row: any) => {
                const tech = (Array.isArray(techniqueCards) ? techniqueCards : []).find((x: any) => x.id === row.technique_id)
                return <div key={row.technique_id} className='mb-1 truncate text-muted'>{tech?.title || row.technique_id} · {row.intensity || 'med'}</div>
              })}
              {!pinnedTechniques.length && <div className='text-muted'>还没有挂载技法。</div>}
            </div>
            <div className='rounded-ui border border-border bg-surface p-3 text-xs'>
              <div className='mb-2 flex items-center justify-between gap-2'><span className='font-medium'>安全规则</span><Badge>{autoApplyPatch ? '需注意' : '默认安全'}</Badge></div>
              <div className='text-muted'>AI 草稿不会直接覆盖作者正文。</div>
              <div className='mt-1 text-muted'>校对建议默认进入待确认，作者可以接受或拒绝。</div>
              <div className='mt-1 text-muted'>没有正文证据的判断不会显示为已命中。</div>
            </div>
          </div>

          <div className='mt-3 rounded-ui border border-border bg-surface p-3 text-xs'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <span className='font-medium'>AI 分工</span>
              <Badge tone={readyRoutes === orderedRouteRows.length ? 'success' : 'warn'}>{readyRoutes}/{orderedRouteRows.length} ready</Badge>
            </div>
            <div className='grid grid-cols-1 gap-1.5 md:grid-cols-4'>
              {orderedRouteRows.map((row: any) => {
                const meta = routeLabels[row.module] || { label: row.module, purpose: '本次写作' }
                const ready = routeReady(row)
                const profileLabel = row.profile_missing ? '缺 profile' : row.profile_id || '未选择'
                const modelLabel = row.model || (row.provider ? '缺 model' : '未配置')
                return (
                  <div key={row.module} className={`rounded-ui border px-2 py-2 ${ready ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/20'}`}>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='font-medium'>{meta.label}</span>
                      <Badge tone={ready ? 'success' : 'warn'}>{ready ? '可用' : '待配置'}</Badge>
                    </div>
                    <div className='mt-1 text-muted'>{meta.purpose}</div>
                    <div className='mt-1 truncate text-muted'>{profileLabel}</div>
                    <div className='mt-1 truncate text-muted'>{row.provider || 'provider'} · {modelLabel}</div>
                  </div>
                )
              })}
            </div>
            <div className='mt-2 text-muted'>
              {useAgentAssignments ? 'Settings 里的任务分工会决定本次调用。' : `当前使用 ${llmProfileId} 覆盖全部分工。`}
            </div>
          </div>

          <details className='mt-3 rounded-ui border border-border bg-surface-2 text-xs text-muted'>
            <summary className='cursor-pointer px-3 py-2 font-medium text-foreground'>维护信息</summary>
            <div className='space-y-2 border-t border-border p-3'>
              <div>路由：{useAgentAssignments ? 'Settings agent assignments' : `${llmProfileId} overrides all agents`}；auto apply patch：{autoApplyPatch ? 'on' : 'off'}；max tokens：{pendingWriteJob.maxTokens}</div>
              <div className='space-y-1'>
                {writeRouteRows.map((row: any) => (
                  <div key={row.module} className='rounded-ui border border-border bg-surface px-2 py-1'>
                    <span className='font-medium'>{row.module}</span>
                    <span className='ml-2'>{row.profile_id} · {row.provider || 'missing'} / {row.model || 'no model'}</span>
                    {row.is_mock || row.profile_missing || row.missing_fields?.length ? <span className='ml-2 text-amber-700 dark:text-amber-300'>需要检查</span> : null}
                  </div>
                ))}
                {!writeRouteRows.length ? <div>Runtime status not loaded yet.</div> : null}
              </div>
              <div>Memory packs：{memoryPackCount}</div>
            </div>
          </details>
        </div>
        <div className='flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3'>
          <Button onClick={onGoSettings}>去配置 API</Button>
          <Button onClick={onCancel}>取消</Button>
          <Button variant='primary' onClick={onConfirm}>确认生成</Button>
        </div>
      </div>
    </div>
  )
}
