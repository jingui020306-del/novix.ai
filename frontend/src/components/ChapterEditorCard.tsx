import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input, Select, Textarea } from './ui/Fields'

type Option = {
  id: string
  label: string
}

type VolumeRow = {
  id: string
  title?: string
}

type CanvasNode = {
  id: string
  label: string
  type?: string
  description?: string
}

type SelectionRange = {
  start: number
  end: number
}

type HighlightRange = {
  start: number
  end: number
}

type ChapterEditorCardProps = {
  analyzeBusy: boolean
  analyzeResult?: any
  autoApplyPatch: boolean
  canGenerate: boolean
  canvasConstraintRows: CanvasNode[]
  chapterEditorText: string
  chapterSaving: boolean
  chapterStatus: string
  chapterTitleDraft: string
  evidenceMarkCount: number
  generationCheckMode: string
  generationCheckOptions: Option[]
  generationScope: string
  generationScopeOptions: Option[]
  generationStopOptions: Option[]
  generationStopPoint: string
  generationUseCards: boolean
  generationUseLines: boolean
  generationUseTechniques: boolean
  highlighted?: string
  highlightRange?: HighlightRange | null
  llmProfileId: string
  marksByLine: Record<string, any[]>
  nodeTypeLabels: Record<string, string>
  profiles: Record<string, any>
  selectedCanvasConstraintIds: string[]
  selectedChapter: string
  selectionEnd: string
  selectionMode: string
  selectionRange?: SelectionRange | null
  selectionStart: string
  useAgentAssignments: boolean
  volumeId: string
  volumeRows: VolumeRow[]
  onAnalyze: () => void
  onEditorFocus: () => void
  onGenerate: () => void
  onRewriteSelection: () => void
  onSave: () => void
  onSaveCanvasConstraints: () => void
  onSelectMark: (mark: any) => void
  onStatusChange: (value: string) => void
  onToggleCanvasConstraint: (nodeId: string) => void
  onVolumeChange: (value: string) => void
  setAutoApplyPatch: (value: boolean) => void
  setChapterEditorText: (value: string) => void
  setChapterTitleDraft: (value: string) => void
  setGenerationCheckMode: (value: string) => void
  setGenerationScope: (value: string) => void
  setGenerationStopPoint: (value: string) => void
  setGenerationUseCards: (value: boolean) => void
  setGenerationUseLines: (value: boolean) => void
  setGenerationUseTechniques: (value: boolean) => void
  setLlmProfileId: (value: string) => void
  setSelectedChapter: (value: string) => void
  setSelectionEnd: (value: string) => void
  setSelectionMode: (value: string) => void
  setSelectionStart: (value: string) => void
  setUseAgentAssignments: (value: boolean) => void
  supportClass: (level: string) => string
}

export function ChapterEditorCard({
  analyzeBusy,
  analyzeResult,
  autoApplyPatch,
  canGenerate,
  canvasConstraintRows,
  chapterEditorText,
  chapterSaving,
  chapterStatus,
  chapterTitleDraft,
  evidenceMarkCount,
  generationCheckMode,
  generationCheckOptions,
  generationScope,
  generationScopeOptions,
  generationStopOptions,
  generationStopPoint,
  generationUseCards,
  generationUseLines,
  generationUseTechniques,
  highlighted,
  highlightRange,
  llmProfileId,
  marksByLine,
  nodeTypeLabels,
  profiles,
  selectedCanvasConstraintIds,
  selectedChapter,
  selectionEnd,
  selectionMode,
  selectionRange,
  selectionStart,
  useAgentAssignments,
  volumeId,
  volumeRows,
  onAnalyze,
  onEditorFocus,
  onGenerate,
  onRewriteSelection,
  onSave,
  onSaveCanvasConstraints,
  onSelectMark,
  onStatusChange,
  onToggleCanvasConstraint,
  onVolumeChange,
  setAutoApplyPatch,
  setChapterEditorText,
  setChapterTitleDraft,
  setGenerationCheckMode,
  setGenerationScope,
  setGenerationStopPoint,
  setGenerationUseCards,
  setGenerationUseLines,
  setGenerationUseTechniques,
  setLlmProfileId,
  setSelectedChapter,
  setSelectionEnd,
  setSelectionMode,
  setSelectionStart,
  setUseAgentAssignments,
  supportClass,
}: ChapterEditorCardProps) {
  const generationScopeLabel = generationScopeOptions.find((x) => x.id === generationScope)?.label || generationScope
  const markTypeLabel: Record<string, string> = {
    character: '人物',
    technique: '技法',
    open_line: '明线',
    hidden_line: '暗线',
    foreshadowing: '伏笔',
    canon_fact: '事实',
    style_rule: '文风',
  }
  const supportLabel: Record<string, string> = {
    supported: '已证实',
    partial: '部分证实',
    unsupported: '未证实',
    contradicted: '有矛盾',
  }

  return (
    <Card
      title='正文'
      extra={
        <div className='flex flex-wrap gap-2'>
          <Button onClick={onSave} disabled={chapterSaving}>{chapterSaving ? '保存中...' : '保存正文'}</Button>
          <Button onClick={onAnalyze} disabled={chapterSaving || analyzeBusy}>{analyzeBusy ? '检查中...' : '检查要求'}</Button>
          <Button variant='primary' onClick={onGenerate} disabled={!canGenerate}>按共识起草</Button>
        </div>
      }
    >
      <div className='grid grid-cols-12 gap-3'>
        <div className='col-span-12 md:col-span-6'>
          <label className='text-xs text-muted'>章节名</label>
          <Input value={chapterTitleDraft} onChange={(e) => setChapterTitleDraft(e.target.value)} />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <label className='text-xs text-muted'>所属卷</label>
          <Select value={volumeId} onChange={(e) => onVolumeChange(e.target.value)}>
            {volumeRows.map((v) => <option key={v.id} value={v.id}>{v.title || v.id}</option>)}
          </Select>
        </div>
        <div className='col-span-6 md:col-span-3'>
          <label className='text-xs text-muted'>状态</label>
          <Select value={chapterStatus} onChange={(e) => onStatusChange(e.target.value)}>
            <option value='draft'>草稿</option>
            <option value='drafting'>写作中</option>
            <option value='planned'>已规划</option>
            <option value='revising'>修改中</option>
            <option value='done'>已完成</option>
          </Select>
        </div>
        <details className='col-span-12 rounded-ui border border-border bg-surface-2 text-xs'>
          <summary className='cursor-pointer px-3 py-2 font-medium'>存档信息</summary>
          <div className='grid grid-cols-1 gap-3 border-t border-border p-3 md:grid-cols-2'>
            <div>
              <label className='text-xs text-muted'>章节编号</label>
              <Input value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)} />
              <div className='mt-1 text-muted'>这是本章的内部存档名，正常写作时不用修改。</div>
            </div>
          </div>
        </details>
        <details className='col-span-12 rounded-ui border border-border bg-surface-2 text-xs'>
          <summary className='cursor-pointer px-3 py-2 font-medium'>高级写作设置</summary>
          <div className='grid grid-cols-1 gap-3 border-t border-border p-3 md:grid-cols-2'>
            <div>
              <label className='text-xs text-muted'>AI 分工</label>
              <label className='mb-1 flex items-center gap-2 text-xs'>
                <input type='checkbox' checked={useAgentAssignments} onChange={(e) => setUseAgentAssignments(e.target.checked)} />
                使用设置里的分工模型
              </label>
              <Select value={llmProfileId} onChange={(e) => setLlmProfileId(e.target.value)} disabled={useAgentAssignments}>
                {Object.entries(profiles).map(([k, v]: any) => (
                  <option key={k} value={k}>{k} ({v.provider}/{v.model})</option>
                ))}
              </Select>
              <div className='mt-1 text-muted'>需要为不同写作环节指定不同模型时再改。</div>
            </div>
            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' checked={autoApplyPatch} onChange={(e) => setAutoApplyPatch(e.target.checked)} />
              校对建议直接写入正文（谨慎）
            </label>
          </div>
        </details>
      </div>

      <details className='mt-3 rounded-ui border border-border bg-surface-2 text-xs'>
        <summary className='cursor-pointer px-3 py-2 font-medium'>
          本次写作控制 <span className='ml-2 text-muted'>({generationScopeLabel})</span>
        </summary>
        <div className='border-t border-border p-3'>
          <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
            <div>
              <label className='text-xs text-muted'>生成范围</label>
              <Select value={generationScope} onChange={(e) => setGenerationScope(e.target.value)}>
                {generationScopeOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </Select>
            </div>
            <div>
              <label className='text-xs text-muted'>停止点</label>
              <Select value={generationStopPoint} onChange={(e) => setGenerationStopPoint(e.target.value)}>
                {generationStopOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </Select>
            </div>
            <div>
              <label className='text-xs text-muted'>检查方式</label>
              <Select value={generationCheckMode} onChange={(e) => setGenerationCheckMode(e.target.value)}>
                {generationCheckOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </Select>
            </div>
          </div>
          <div className='mt-2 flex flex-wrap gap-3 text-xs'>
            <label className='flex items-center gap-2'><input type='checkbox' checked={generationUseCards} onChange={(e) => setGenerationUseCards(e.target.checked)} /> 使用人物/世界/文风卡</label>
            <label className='flex items-center gap-2'><input type='checkbox' checked={generationUseTechniques} onChange={(e) => setGenerationUseTechniques(e.target.checked)} /> 使用技法挂载</label>
            <label className='flex items-center gap-2'><input type='checkbox' checked={generationUseLines} onChange={(e) => setGenerationUseLines(e.target.checked)} /> 使用脉络/明暗线</label>
          </div>
          <div className='mt-3 rounded-ui border border-border bg-panel p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <div>
                <div className='text-xs font-medium'>本章使用的结构点</div>
                <div className='text-[11px] text-muted'>只勾这一章真的要写到的脉络、卷、爆点或结局方向。</div>
              </div>
              <div className='flex gap-2'>
                <Badge>{selectedCanvasConstraintIds.length} 个已选</Badge>
                <Button className='text-xs' onClick={onSaveCanvasConstraints}>保存选择</Button>
              </div>
            </div>
            <div className='grid grid-cols-1 gap-1.5 md:grid-cols-3'>
              {canvasConstraintRows.map((node) => (
                <label
                  key={node.id}
                  className={`flex min-h-12 cursor-pointer items-start gap-2 rounded-ui border px-2 py-1.5 ${selectedCanvasConstraintIds.includes(node.id) ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
                >
                  <input
                    className='mt-1'
                    type='checkbox'
                    checked={selectedCanvasConstraintIds.includes(node.id)}
                    onChange={() => onToggleCanvasConstraint(node.id)}
                  />
                  <span>
                    <span className='block text-xs font-medium'>{node.label}</span>
                    <span className='line-clamp-1 block text-[11px] text-muted'>{nodeTypeLabels[node.type || ''] || node.type} · {node.description || '待补充'}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </details>

      <details className='mt-3 rounded-ui border border-border bg-surface-2 text-xs'>
        <summary className='cursor-pointer px-3 py-2 font-medium'>只修改正文中的一小段</summary>
        <div className='grid grid-cols-12 gap-2 border-t border-border p-3'>
          <div className='col-span-12 sm:col-span-6 lg:col-span-3'>
            <label className='text-xs text-muted'>选择方式</label>
            <Select value={selectionMode} onChange={(e) => setSelectionMode(e.target.value)}>
              <option value='line'>按行</option>
              <option value='paragraph'>按段落</option>
            </Select>
          </div>
          <div className='col-span-12 sm:col-span-6 lg:col-span-3'>
            <label className='text-xs text-muted'>{selectionMode === 'line' ? '开始行' : '开始段'}</label>
            <Input value={selectionStart} onChange={(e) => setSelectionStart(e.target.value)} placeholder='开始' />
          </div>
          <div className='col-span-12 sm:col-span-6 lg:col-span-3'>
            <label className='text-xs text-muted'>{selectionMode === 'line' ? '结束行' : '结束段'}</label>
            <Input value={selectionEnd} onChange={(e) => setSelectionEnd(e.target.value)} placeholder='结束' />
          </div>
          <div className='col-span-12 flex items-end gap-2 lg:col-span-3'>
            {selectionRange ? <Button onClick={onRewriteSelection} disabled={!canGenerate}>让 AI 改这一段</Button> : null}
          </div>
          {selectionRange ? <p className='col-span-12 text-xs text-muted'>已选择：L{selectionRange.start}-L{selectionRange.end}</p> : <p className='col-span-12 text-xs text-muted'>填写开始和结束位置后，可以只让 AI 修改这一小段。</p>}
        </div>
      </details>

      {analyzeResult ? <p className='mt-1 text-xs text-muted'>检查结果：新增 {analyzeResult.new_facts_count || 0} 条事实，{analyzeResult.new_proposals_count || 0} 条待确认建议。</p> : null}
      {highlightRange ? (
        <div className='mt-3 rounded-ui border border-border bg-surface-2 p-2'>
          <div className='mb-1 text-xs font-medium'>正文依据：{selectedChapter} L{highlightRange.start}-L{highlightRange.end}</div>
          <pre className='editor-text mono max-h-40 overflow-auto whitespace-pre-wrap text-xs'>{highlighted || '暂无正文'}</pre>
        </div>
      ) : null}

      <div className='mt-3 grid grid-cols-12 gap-3'>
        <div className='col-span-12 rounded-ui border border-border bg-surface p-2 lg:col-span-3'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='text-xs font-medium'>段落标记</span>
            <Badge>{evidenceMarkCount}</Badge>
          </div>
          <div className='max-h-[560px] space-y-2 overflow-auto'>
            {Object.entries(marksByLine).map(([line, marks]) => (
              <div key={line} className='rounded-ui border border-border bg-panel p-2'>
                <div className='mb-1 text-[11px] text-muted'>{line === '未证实' ? '没有正文定位' : `第 ${line} 行`}</div>
                <div className='space-y-1'>
                  {marks.map((mark: any) => {
                    const level = mark?.detection?.support_level || 'unsupported'
                    return (
                      <button
                        key={mark.mark_id}
                        className={`w-full rounded-ui border px-2 py-1 text-left text-[11px] ${supportClass(level)}`}
                        onClick={() => onSelectMark(mark)}
                      >
                        <div className='font-medium'>{markTypeLabel[mark.target_type] || '要求'} · {mark.label || mark.target_id}</div>
                        <div>{supportLabel[level] || '待确认'}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {!evidenceMarkCount && <p className='text-xs text-muted'>写完或“检查要求”后显示人物、技法、明线、暗线、伏笔是否真的写到。</p>}
          </div>
        </div>
        <Textarea
          id='chapter-manuscript-editor'
          className='editor-text col-span-12 min-h-[560px] resize-y whitespace-pre-wrap font-serif leading-7 lg:col-span-9'
          value={chapterEditorText}
          onFocus={onEditorFocus}
          onChange={(e) => setChapterEditorText(e.target.value)}
          placeholder='开始写这一章...'
        />
      </div>
    </Card>
  )
}
