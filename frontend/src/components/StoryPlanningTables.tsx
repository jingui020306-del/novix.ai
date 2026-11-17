import { useEffect, useRef, useState } from 'react'
import { NarrativePacing } from './NarrativePacing'
import useSWR from 'swr'
import { api } from '../api/client'
import { canonicalEvents } from '../lib/materialScope'
import { PacingAnalysis } from './PacingAnalysis'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'
import { WritingReferenceNotice } from './WritingReferencePicker'
import { MaterialBacklinks, MaterialReferences, OpenMaterial } from './MaterialReferences'
import { ChapterThreadsMatrix, plotThreads, unplacedReason } from './ChapterThreadsMatrix'
import { CardOperations } from './CardOperations'
import { KnowledgeGraph } from './KnowledgeGraph'
import { InformationPanel } from './InformationPanel'
import { AuthorControls, useAuthorControl, pointerLocked } from './AuthorControls'
import { WorldContextFields } from './WorldContextFields'
import { SceneRehearsalWorkspace } from './SceneRehearsalWorkspace'
import { mergeConfirmedRehearsal } from '../lib/sceneRehearsal'
import { cardAfterSave, useDraftRecovery } from '../lib/editorDrafts'
import { TokenUsage } from './WritingTools'

type TableKey = 'important_scenes' | 'character_intersections' | 'character_storylines' | 'beat_sheet'
type Column = { key: string; label: string; kind?: 'character' | 'characters' | 'scene' | 'scenes' | 'chapter' | 'beat' | 'thread' }
const TABS: { label: string; table: TableKey; brief?: boolean; matrix?: boolean; pacing?: boolean }[] = [
  { label: '情节梗概', table: 'important_scenes' }, { label: '角色交集', table: 'character_intersections' },
  { label: '人物故事线', table: 'character_storylines' }, { label: '十五节拍表', table: 'beat_sheet' },
  { label: '十五节拍简表', table: 'beat_sheet', brief: true },
  { label: '章节与线索', table: 'important_scenes', matrix: true }, { label: '节奏编排', table: 'important_scenes', pacing: true },
]
const COLUMNS: Record<TableKey, Column[]> = {
  important_scenes: [{ key: 'scene', label: '情节 / 场景' }, { key: 'plot', label: '事件内容' }, { key: 'purpose', label: '在故事中的作用' }, { key: 'time', label: '时间' }, { key: 'location', label: '地点' }, { key: 'characters', label: '出场人物', kind: 'characters' }, { key: 'chapter', label: '对应章节', kind: 'chapter' }, { key: 'thread_id', label: '故事线', kind: 'thread' }, { key: 'beat_id', label: '对应节拍', kind: 'beat' }, { key: 'emotion', label: '情绪变化' }, { key: 'camp', label: '立场 / 阵营' }, { key: 'attack', label: '行动 / 出招' }, { key: 'notes', label: '补充' }],
  character_intersections: [{ key: 'scene_id', label: '在哪一场相遇', kind: 'scene' }, { key: 'characters', label: '相关人物', kind: 'characters' }, { key: 'goal', label: '双方想得到什么' }, { key: 'protagonist_action', label: '一方如何行动' }, { key: 'opponent_action', label: '另一方如何回应' }, { key: 'attack_point', label: '冲突 / 交锋点' }, { key: 'result', label: '交锋后的结果' }, { key: 'chapter', label: '对应章节', kind: 'chapter' }, { key: 'beat_id', label: '对应节拍', kind: 'beat' }, { key: 'notes', label: '补充' }],
  character_storylines: [{ key: 'character_id', label: '人物', kind: 'character' }, { key: 'goal', label: '此时的目标' }, { key: 'obstacle', label: '遇到的阻碍' }, { key: 'choice', label: '做出的选择' }, { key: 'change', label: '发生的变化' }, { key: 'emotion', label: '情绪承接' }, { key: 'scene_id', label: '相关场景', kind: 'scene' }, { key: 'chapter', label: '对应章节', kind: 'chapter' }, { key: 'beat_id', label: '对应节拍', kind: 'beat' }, { key: 'notes', label: '补充' }],
  beat_sheet: [{ key: 'name', label: '节拍名称' }, { key: 'summary', label: '这一拍发生什么' }, { key: 'structural_function', label: '在整书中的作用' }, { key: 'scene_ids', label: '相关场景', kind: 'scenes' }, { key: 'chapter', label: '对应章节', kind: 'chapter' }, { key: 'emotion', label: '情绪 / 感受' }, { key: 'notes', label: '补充' }],
}
const BEAT_NAMES = ['开场画面', '阐明主题', '铺垫', '触发事件', '争论', '进入第二幕', 'B 故事', '游戏与乐趣', '中点', '坏人逼近', '一无所有', '灵魂黑夜', '进入第三幕', '终局', '终场画面']
const blank = (value: any) => value === undefined || value === null || value === '' || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)
const makeRow = (table: TableKey) => ({ id: `${table}_${crypto.randomUUID().slice(0, 8)}` })
const makeSkeletonEvent = () => ({ id: `event_${crypto.randomUUID().slice(0, 8)}`, title: '', summary: '', chapter: '', characters: [], goal: '', action: '', choice: '', outcome: '', character_steps: [], source_quotes: [], basis: 'author_edited' })
const createCard = (story: any) => ({ id: `outline_planning_${story.id}`, type: 'outline', title: `${story.title || '故事'}的情节工作表`, tags: [], links: [], payload: { story_card_id: story.id, planning_worksheet: true, inspiration: '', beat_sheet_enabled: false, important_scenes: [], character_intersections: [], character_storylines: [], beat_sheet: [] } })
const sourceLabel = (basis: string) => basis === 'author_edited' ? '作者已编辑' : basis === 'extracted' ? '含原文提取内容' : '含已确认的补充建议'
type Preview = { table: TableKey; label: string; targetId?: string; field?: string; rows: { values: any; source_quotes: string[]; basis: string }[]; usage?: any; matrix?: boolean }

export function StoryPlanningTables({ project, storyCard, characters, chapters, profileId, draftCache, onStorySection, onOpenStory, onOpenMaterial, onSaved, focusRequest, onOpenSettings, onStoryCardChange, onSaveStory, isTargetDirty }: {
  project: string; storyCard: any; characters: any[]; chapters: any[]; profileId?: string;
  draftCache: { current: Record<string, any> }; onOpenStory: () => void;
  onStorySection: (tab: string) => void; onOpenMaterial?: OpenMaterial; onSaved?: () => void; onOpenSettings?: () => void; onStoryCardChange?: (card: any) => void; onSaveStory?: () => void; isTargetDirty?: (id: string) => boolean; focusRequest?: { id?: string; requestId: number; table?: string; rowId?: string; rehearsal?: boolean; editPath?: string[] } | null;
}) {
  const { data, error, mutate } = useSWR(project ? `/api/projects/${project}/cards?type=outline` : null, api.get)
  const { data: allEvents, mutate: mutateEvents } = useSWR(project ? `/api/projects/${project}/events` : null, api.get)
  const { data: materialRows } = useSWR(project ? `/api/projects/${project}/materials` : null, api.get)
  const [timelineEvent, setTimelineEvent] = useState('')
  const [sourceChoices, setSourceChoices] = useState<Record<string, string>>({})
  const scope = `${project}:${storyCard?.id}`
  const [draft, setDraft] = useState<{ scope: string; card: any } | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [hasSaved, setHasSaved] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [section, setSection] = useState('时间线')
  const [pacingView, setPacingView] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [activeRehearsal, setActiveRehearsal] = useState<{ scope: string; sceneId: string; uiSceneId: string; label: string } | null>(null)
  const [pendingRehearsal, setPendingRehearsal] = useState<string | null>(null)
  const handledRehearsalFocus = useRef(0)
  const [skeletonPreview, setSkeletonPreview] = useState<any>(null)
  const skeleton = skeletonPreview?.scope === scope ? skeletonPreview : null
  const latestSkeleton = useRef(skeleton)
  latestSkeleton.current = skeleton
  const skeletonRequest = useRef(0)
  if (skeleton) draftCache.current[`${scope}:skeletonPreview`] = skeleton
  const requestNumber = useRef(0)
  const latestScope = useRef(scope)
  latestScope.current = scope
  const form = draft?.scope === scope ? draft.card : null
  const latest = useRef(form)
  latest.current = form
  const tab = TABS[activeTab]
  const payload = form?.payload || {}
  const { lockedPaths } = useAuthorControl(project, form?.id && hasSaved ? `cards/${form.id}.yaml` : undefined)
  const threads = plotThreads(payload.plot_threads)
  const rows: any[] = Array.isArray(payload[tab.table]) ? payload[tab.table] : []
  const [visibleColumns, setVisibleColumns] = useState<Record<string, string[]>>(() => { try { return JSON.parse(localStorage.getItem('novix:worksheet-columns') || '{}') } catch { return {} } })
  const allColumns = tab.brief ? COLUMNS.beat_sheet.filter((column) => ['name', 'summary', 'chapter', 'emotion'].includes(column.key)) : COLUMNS[tab.table]
  const columns = allColumns.filter((column) => !visibleColumns[tab.label] || visibleColumns[tab.label].includes(column.key))
  const localDraft = useDraftRecovery(`${scope}:planning`, form, savedSnapshot, (card) => setDraft({ scope, card }))
  if (form) draftCache.current[`${scope}:planningDraft`] = { card: form, savedSnapshot, hasSaved }
  useEffect(() => {
    if (!focusRequest) return
    if (!focusRequest.rehearsal) setActiveRehearsal(null)
    const index = TABS.findIndex((item) => item.table === focusRequest.table)
    if (index >= 0) { setActiveTab(index); setSection(index === 0 ? '时间线' : '故事线') }
    if (focusRequest.table === 'important_scenes' && focusRequest.rowId && !focusRequest.rehearsal) setTimelineEvent(focusRequest.rowId)
  }, [focusRequest])
  useEffect(() => {
    if (!form || !timelineEvent) return
    const element = document.getElementById(`timeline-edit-${timelineEvent}`)
    for (let parent = element?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
    if (element && (focusRequest?.rowId === timelineEvent || timelineEvent)) element.scrollIntoView({ block: 'center' })
  }, [form?.id, timelineEvent, section, focusRequest?.requestId])
  useEffect(() => {
    requestNumber.current += 1
    setBusy('')
    setMessage('')
    setPreview(null)
    setPendingRehearsal(null)
    setTimelineEvent(focusRequest?.table === 'important_scenes' && !focusRequest.rehearsal ? focusRequest.rowId || '' : '')
    skeletonRequest.current++
    setSkeletonPreview(draftCache.current[`${scope}:skeletonPreview`] || null)
    return () => { skeletonRequest.current++ }
  }, [scope])
  useEffect(() => {
    if (!Array.isArray(data) || !storyCard?.id || draft?.scope === scope) return
    const cached = draftCache.current[`${scope}:planningDraft`]
    const stored = data.find((card: any) => card.id === `outline_planning_${storyCard.id}` || (card.payload?.planning_worksheet && card.payload?.story_card_id === storyCard.id))
    const card = cached?.card || (stored ? { ...stored, payload: { ...createCard(storyCard).payload, ...stored.payload } } : createCard(storyCard))
    for (const table of Object.keys(COLUMNS) as TableKey[]) card.payload[table] = (Array.isArray(card.payload[table]) ? card.payload[table] : []).map((row: any, index: number) => ({ ...row, id: row.id || `${table}_${index + 1}` }))
    setDraft({ scope, card })
    setSavedSnapshot(cached?.savedSnapshot || JSON.stringify(card))
    setHasSaved(cached?.hasSaved ?? Boolean(stored))
  }, [data, scope, draft?.scope])

  useEffect(() => {
    if (!form || JSON.stringify(form) !== savedSnapshot || !Array.isArray(data)) return
    const stored = data.find((card: any) => card.id === form.id)
    if (!stored || stored._revision === form._revision) return
    const next = { ...stored, payload: { ...createCard(storyCard).payload, ...stored.payload } }
    for (const table of Object.keys(COLUMNS) as TableKey[]) next.payload[table] = (next.payload[table] || []).map((row: any, index: number) => ({ ...row, id: row.id || `${table}_${index + 1}` }))
    setDraft({ scope, card: next }); setSavedSnapshot(JSON.stringify(next))
  }, [data])
  const changePayload = (key: string, value: any) => setDraft((current) => {
    if (current?.scope !== scope) return current
    const next = key === 'important_scenes' && Array.isArray(value) ? value.map((row: any) => { const stored = current.card.payload.important_scenes?.find((entry: any) => entry.id === row.id); return stored?.canonical_event_ref ? { ...stored, ...Object.fromEntries(localEventFields.map((field) => [field, row[field]])) } : row }) : value
    return { ...current, card: { ...current.card, payload: { ...current.card.payload, [key]: next } } }
  })
  const localEventFields = ['chapter', 'thread_id', 'beat_id', 'notes']
  const editCell = (table: TableKey, rowId: string, key: string, value: any) => {
    const existingRow = latest.current?.payload?.[table]?.find((item: any) => item.id === rowId)
    if (pointerLocked(lockedPaths, `/payload/${table}/${existingRow?.id ? `@${existingRow.id}` : '0'}/${key}`)) { setMessage('这项已锁定，请通过指定范围修改。'); return }
    const row = latest.current?.payload?.important_scenes?.find((item: any) => item.id === rowId)
    if (table === 'important_scenes' && row?.canonical_event_ref && ![...localEventFields, 'canonical_event_ref'].includes(key)) { setMessage('这是同一事件的共享内容。请打开原事件编辑；本表的章节、故事线、节拍与备注仍可单独调整。'); return }
    setDraft((current) => current?.scope === scope ? { ...current, card: { ...current.card, payload: { ...current.card.payload, [table]: (current.card.payload[table] || []).map((row: any) => row.id === rowId ? { ...row, [key]: value, ...(row.basis ? { basis: 'author_edited' } : {}) } : row) } } } : current)
  }
  const enableMatrix = () => setDraft((current) => current?.scope === scope && !current.card.payload.plot_threads?.length ? { ...current, card: { ...current.card, payload: { ...current.card.payload, plot_threads: [{ id: 'main', name: '主线' }] } } } : current)
  const editMatrixCell = (id: string, key: string, value: any) => { editCell('important_scenes', id, key, value); enableMatrix() }
  const save = async () => {
    const snapshot = JSON.stringify(form)
    setBusy('save')
    setMessage('')
    try {
      const result = await api.put(`/api/projects/${project}/cards/${encodeURIComponent(form.id)}`, form)
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '工作表保存失败，请重试。')
      if (latestScope.current !== scope) return
      const savedCard = cardAfterSave(form, form, result, snapshot)
      const savedVersion = JSON.stringify(savedCard)
      setDraft((current) => current?.scope === scope ? { ...current, card: cardAfterSave(current.card, form, result, snapshot) } : current)
      setSavedSnapshot(savedVersion)
      setHasSaved(true)
      localDraft.markSaved(form, savedCard)
      await mutate()
      void mutateEvents()
      onSaved?.()
      setMessage(result.change_suggestions?.error ? `工作表已保存；${result.change_suggestions.error}` : [snapshot, savedVersion].includes(JSON.stringify(latest.current)) ? '工作表已保存。章节生成会按当前故事取用相关内容。' : '已保存提交时的工作表，之后的编辑请再次保存。')
      return { snapshot: savedVersion, card: savedCard }
    } catch (cause) { if (latestScope.current === scope) setMessage(cause instanceof Error ? cause.message : '工作表保存失败，请重试。') }
    finally { if (latestScope.current === scope) setBusy('') }
  }
  const enterRehearsal = (uiSceneId: string, storedCard?: any) => {
    const current = latest.current
    const index = (current?.payload?.important_scenes || []).findIndex((row: any) => row.id === uiSceneId)
    if (index < 0) { setMessage('原情节已不在当前表中，未打开旧推演。'); return }
    const stored = storedCard || (Array.isArray(data) ? data : []).find((card: any) => card.id === current.id)
    const row = current.payload.important_scenes[index]
    const storedRow = stored?.payload?.important_scenes?.[index]
    setActiveRehearsal({ scope, sceneId: storedRow?.id || `index_${index}`, uiSceneId, label: row.scene || row.plot?.slice(0, 40) || '未命名情节' })
    setPendingRehearsal(null)
  }
  const askRehearsal = (uiSceneId: string) => {
    if (!hasSaved || JSON.stringify(latest.current) !== savedSnapshot) { setPendingRehearsal(uiSceneId); setMessage('推演会读取保存版情节。当前工作表有未保存编辑，请先保存并打开。'); setTimeout(() => document.getElementById('planning-rehearsal-open')?.scrollIntoView({ block: 'center' }), 0); return }
    enterRehearsal(uiSceneId)
  }
  const saveAndOpenRehearsal = async () => {
    if (!pendingRehearsal) return
    const uiSceneId = pendingRehearsal
    const result = await save()
    if (!result) return
    if (JSON.stringify(latest.current) !== result.snapshot) { setMessage('保存期间你又修改了工作表，编辑已保留。请再次保存后打开推演。'); return }
    enterRehearsal(uiSceneId, result.card)
  }
  const mergeRehearsalConfirmation = (result: any) => {
    if (!activeRehearsal || !result.saved) return
    if (result.owner_card_id && result.owner_card_id !== form.id) { void mutate(); onSaved?.(); return }
    const cached = draftCache.current[`${scope}:planningDraft`]
    const merge = (card: any) => mergeConfirmedRehearsal(card, activeRehearsal.uiSceneId, activeRehearsal.sceneId, result.saved, result.updated_at, result._revision)
    let baseline = cached?.savedSnapshot || savedSnapshot
    try { baseline = JSON.stringify(merge(JSON.parse(baseline))) } catch { /* Keep an existing snapshot if it cannot be read. */ }
    const nextCard = merge(cached?.card || latest.current)
    draftCache.current[`${scope}:planningDraft`] = { ...cached, card: nextCard, savedSnapshot: baseline, hasSaved: true }
    setDraft((current) => current?.scope === scope ? { ...current, card: merge(current.card) } : current)
    setSavedSnapshot(baseline); setHasSaved(true)
    void mutate(); onSaved?.()
  }
  useEffect(() => {
    if (!focusRequest?.rehearsal || !form || focusRequest.id && focusRequest.id !== form.id || handledRehearsalFocus.current === focusRequest.requestId) return
    const index = /^index_\d+$/.test(focusRequest.rowId || '') ? Number(focusRequest.rowId!.slice(6)) : -1
    const row = (form.payload.important_scenes || []).find((item: any) => item.id === focusRequest.rowId) || (index >= 0 ? form.payload.important_scenes[index] : null)
    if (row) { handledRehearsalFocus.current = focusRequest.requestId; askRehearsal(row.id) }
  }, [focusRequest, form?.id, data])
  const propose = async (mode: 'extract' | 'suggest', row?: any, field?: string) => {
    if (row?.canonical_event_ref) { setMessage('已引用原事件。共享内容请到原事件编辑，本表不再生成另一份。'); return }
    const number = ++requestNumber.current
    setBusy(field || row?.id || 'propose')
    setMessage('')
    setPreview(null)
    try {
      const result = await api.post(`/api/projects/${project}/story-planning/propose`, { planning_card: form, story_card: storyCard, table: tab.table, row, field, mode, llm_profile_id: profileId })
      if (latestScope.current !== scope || number !== requestNumber.current) return
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '整理未完成，请检查模型设置。')
      if (!Array.isArray(result.rows) || !result.rows.length) { setMessage(mode === 'extract' ? '未找到可直接提取的内容，空白已保留。可手动补充，或主动点击 AI 补空。' : '没有生成可用补充，原内容已保留。'); return }
      const suggestions = result.rows.map((candidate: any) => ({ ...candidate, values: Object.fromEntries(Object.entries(candidate.values || {}).filter(([key]) => key === 'id' || (!field || key === field) && (!row || blank(row[key])))) }))
      setPreview({ table: tab.table, label: tab.label, targetId: row?.id, field, rows: suggestions, usage: result.writing_reference_usage, matrix: tab.matrix })
    } catch (cause) { if (latestScope.current === scope && number === requestNumber.current) setMessage(cause instanceof Error ? cause.message : 'AI 整理失败，请重试。') }
    finally { if (latestScope.current === scope && number === requestNumber.current) setBusy('') }
  }
  const accept = () => {
    if (!preview || !latest.current) return
    const currentRows: any[] = [...(latest.current.payload[preview.table] || [])]
    if (preview.targetId && !currentRows.some((row) => row.id === preview.targetId)) { setMessage('原行已经删除，未填入候选内容。'); return }
    let filled = 0
    for (const suggestion of preview.rows) {
      const values = suggestion.values || {}
      if (!COLUMNS[preview.table].some((column) => !blank(values[column.key]))) continue
      let index = preview.targetId ? currentRows.findIndex((row) => row.id === preview.targetId) : currentRows.findIndex((row) => row.id === values.id)
      if (index < 0) index = currentRows.findIndex((row) => COLUMNS[preview.table].every((column) => blank(row[column.key])))
      if (index < 0) { currentRows.push(makeRow(preview.table)); index = currentRows.length - 1 }
      const target = { ...currentRows[index] }
      let rowFilled = false
      for (const column of COLUMNS[preview.table]) if ((!preview.field || column.key === preview.field) && blank(target[column.key]) && !blank(values[column.key])) {
        target[column.key] = values[column.key]
        filled += 1
        rowFilled = true
      }
      if (rowFilled) { target.source_quotes = [...new Set([...(target.source_quotes || []), ...(suggestion.source_quotes || [])])]; target.basis = target.basis === 'author_edited' ? 'author_edited' : suggestion.basis; currentRows[index] = target }
    }
    changePayload(preview.table, currentRows)
    if (preview.matrix && filled) enableMatrix()
    setPreview(null)
    setMessage(filled ? `已填入 ${filled} 个空白项，原有内容保留。请保存工作表。` : '这些位置已有内容或候选为空，未覆盖任何内容。')
  }
  const skeletonInput = { story_card: storyCard, planning_card: form, source_text: payload.inspiration || '' }
  const skeletonInputKey = JSON.stringify(skeletonInput)
  const latestSkeletonInputKey = useRef(skeletonInputKey)
  latestSkeletonInputKey.current = skeletonInputKey
  const skeletonStale = Boolean(skeleton?.inputKey && skeleton.inputKey !== skeletonInputKey)
  const editSkeleton = (events: any[], suggestions = skeleton?.skeleton?.suggestions || []) => setSkeletonPreview((current: any) => ({ ...(current?.scope === scope ? current : {}), scope, skeleton: { events, suggestions }, applied: false }))
  const starterRequest = async (action: 'prepare' | 'propose' | 'apply') => {
    const number = ++skeletonRequest.current
    const input = { story_card: storyCard, planning_card: latest.current, source_text: latest.current?.payload?.inspiration || '' }
    const inputKey = JSON.stringify(input)
    const held = latestSkeleton.current
    const draftKey = JSON.stringify(held?.skeleton)
    setBusy(`skeleton-${action}`); setMessage('')
    try {
      let proof = held
      if (action === 'apply' && !proof?.base_hash) {
        proof = await api.post(`/api/projects/${project}/story-planning/skeleton/prepare`, input)
        if (proof.detail) throw new Error(typeof proof.detail === 'string' ? proof.detail : '已有材料未能读取，请重试。')
      }
      const result = await api.post(`/api/projects/${project}/story-planning/skeleton/${action}`, { ...input, ...(action === 'propose' ? { llm_profile_id: profileId } : {}), ...(action === 'apply' ? { skeleton: held?.skeleton, base_hash: proof?.base_hash, source_versions: proof?.source_versions } : {}) })
      if (latestScope.current !== scope || skeletonRequest.current !== number) return
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '本次整理未完成，请重试。')
      if (latestSkeletonInputKey.current !== inputKey || JSON.stringify(latestSkeleton.current?.skeleton) !== draftKey) { setMessage('等待期间你又修改了工作表或骨架，当前编辑已保留。请按最新材料重新整理。'); return }
      if (action === 'apply') {
        if (!result.planning_card?.id || result.planning_card.id !== input.planning_card.id) throw new Error('返回的工作表不匹配，原内容已保留。')
        setDraft({ scope, card: result.planning_card })
        setSkeletonPreview({ ...held, ...result, scope, skeleton: result.skeleton || held.skeleton, inputKey: JSON.stringify({ ...input, planning_card: result.planning_card }), base_hash: undefined, applied: true })
        const changes = result.changes || {}
        setMessage(`已分配到当前工作表：情节 ${changes.important_scenes || 0} 项、角色交集 ${changes.character_intersections || 0} 项、人物故事线 ${changes.character_storylines || 0} 项。原有非空内容与场景推演保留；请保存工作表。`)
      } else {
        setSkeletonPreview({ ...result, scope, inputKey, skeleton: action === 'prepare' && held?.skeleton ? held.skeleton : { events: result.skeleton?.events || [], suggestions: result.skeleton?.suggestions || [] }, applied: false })
        setMessage(action === 'prepare' ? held?.skeleton ? '已核对最新材料，当前骨架预览保留。确认后只分配到原表空白位置。' : '已整理现有明确事件。自由长文不会在本地被假装理解，可手动添事件，或主动请 AI 提取。' : 'AI 提取结果仅供预览。请修订事件顺序；新建议单列，确认后才分配。')
      }
    } catch (cause) { if (latestScope.current === scope && skeletonRequest.current === number) setMessage(cause instanceof Error ? cause.message : '整理失败，当前故事与表格已保留。') }
    finally { if (latestScope.current === scope && skeletonRequest.current === number) setBusy('') }
  }
  const exportWorkbook = async () => {
    setBusy('export')
    setMessage('')
    try {
      const response = await fetch(`/api/projects/${project}/story-planning/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planning_card: form, story_card: storyCard }) })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.detail || '导出失败，请重试。') }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${storyCard.title || '故事'}-情节工作表.xlsx`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      if (latestScope.current === scope) setMessage('已导出当前表单，包含尚未保存的编辑。导出不会代替保存。')
    } catch (cause) { if (latestScope.current === scope) setMessage(cause instanceof Error ? cause.message : '导出失败，请重试。') }
    finally { if (latestScope.current === scope) setBusy('') }
  }
  const optionsFor = (kind?: Column['kind']) => {
    if (kind === 'thread') return threads.map((thread) => ({ id: thread.id, label: thread.name || '未命名故事线' }))
    if (kind === 'character' || kind === 'characters') return characters.map((card: any) => ({ id: card.id, label: card.payload?.name || card.title || '未命名人物' }))
    if (kind === 'scene' || kind === 'scenes') return (payload.important_scenes || []).map((row: any, index: number) => ({ id: row.id, label: row.scene || `情节 ${index + 1}` }))
    if (kind === 'chapter') return chapters.map((row: any) => ({ id: row.chapter_id, label: row.chapter_title || row.title || '未命名章节' }))
    if (kind === 'beat') return (payload.beat_sheet || []).map((row: any, index: number) => ({ id: row.id, label: row.name || `节拍 ${index + 1}` }))
    return []
  }
  const fieldEditor = (column: Column, value: any, change: (value: any) => void, label: string) => {
    if (!column.kind) return <Textarea aria-label={label} className='planning-cell-input' value={value || ''} onChange={(event) => change(event.target.value)} />
    const options = optionsFor(column.kind)
    if (column.kind === 'thread') return <Select aria-label={label} value={value || 'main'} onChange={(event) => change(event.target.value)}>{value && !options.some((option: any) => option.id === value) && <option value={value}>原故事线已不可用（保留关联）</option>}{options.map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select>
    if (column.kind === 'characters' || column.kind === 'scenes') {
      const ids: string[] = Array.isArray(value) ? value : []
      return <details className='planning-links'><summary>{ids.length ? ids.map((id) => options.find((option: any) => option.id === id)?.label || '未找到的关联').join('、') : `选择${column.label}`}</summary><div className='mt-2 max-h-44 space-y-2 overflow-auto'>{options.map((option: any) => <label key={option.id} className='flex items-start gap-2 text-xs'><input type='checkbox' checked={ids.includes(option.id)} onChange={(event) => change(event.target.checked ? [...ids, option.id] : ids.filter((id) => id !== option.id))} />{option.label}</label>)}{ids.filter((id) => !options.some((option: any) => option.id === id)).map((id) => <label key={id} className='flex items-start gap-2 text-xs'><input type='checkbox' checked onChange={() => change(ids.filter((entry) => entry !== id))} />未找到的关联（保留）</label>)}{!options.length && <p className='text-xs text-muted'>还没有可关联的内容，可稍后补充。</p>}</div></details>
    }
    return <Select aria-label={label} value={value || ''} onChange={(event) => change(event.target.value)}><option value=''>暂不关联</option>{value && !options.some((option: any) => option.id === value) && <option value={value}>未找到的关联（保留）</option>}{options.map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select>
  }
  const sourceEvent = (row: any) => {
    const ref = row.canonical_event_ref
    if (!ref) return null
    return (Array.isArray(allEvents) ? allEvents : []).find((entry: any) => entry.owner_card_id === ref.owner_card_id && entry.scene_id === ref.scene_id)
  }
  const sharedEventValues = (row: any) => { const source = sourceEvent(row); return source?.shared_values || source?.values }
  const displayEvent = (row: any) => {
    if (!row.canonical_event_ref) return row
    const local = Object.fromEntries(localEventFields.map((key) => [key, row[key]]))
    return { ...(sharedEventValues(row) || { scene: '原事件暂未读到', plot: '共享内容保留在原来源，可重新读取后查看。' }), ...local, id: row.id, canonical_event_ref: row.canonical_event_ref }
  }
  const sourceName = (entry: any) => {
    const owner = (Array.isArray(materialRows) ? materialRows : []).find((item: any) => item.id === entry.owner_card_id)
    return `${entry.owner_card_id === storyCard.id || owner?.type === 'story' ? '故事策划' : '情节工作表'}：${owner?.label || (entry.owner_card_id === storyCard.id ? storyCard.title : '原资料')}`
  }
  const openEventSource = (row: any) => {
    const source = sourceEvent(row)
    const ref = row.canonical_event_ref
    if (ref) onOpenMaterial?.({ id: source?.canonical_id || `${ref.owner_card_id}:important_scenes:${ref.scene_id}`, type: 'scene' })
  }
  const openTimelineEvent = (id: string) => {
    setSection('时间线'); setActiveTab(0); setTimelineEvent(id)
    const container = document.getElementById('planning-event-workspace') as HTMLDetailsElement | null
    if (container) container.open = true
    const element = document.getElementById(`timeline-edit-${id}`)
    element?.scrollIntoView({ block: 'center' })
  }
  const connectOriginalEvents = async (causeId: string, effectId: string) => {
    if (JSON.stringify(latest.current) !== savedSnapshot) throw new Error('工作表还有未保存编辑，请先保存，再连接正式事件；当前稿保留。')
    const cause = causeId.split(':important_scenes:'), effect = effectId.split(':important_scenes:')
    if (cause.length !== 2 || effect.length !== 2 || causeId === effectId) throw new Error('请选择两个不同的正式事件。')
    if (isTargetDirty?.(effect[0])) throw new Error('原事件资料还有未保存编辑，请回原处保存后再连接。')
    const held = scope
    const owner = await api.get(`/api/projects/${project}/cards/${encodeURIComponent(effect[0])}`)
    if (latestScope.current !== held) throw new Error('作品已切换，未提交这条连接。')
    if (JSON.stringify(latest.current) !== savedSnapshot || isTargetDirty?.(effect[0])) throw new Error('等待期间有新编辑，请先保存再连接。')
    const original = (owner.payload?.important_scenes || []).find((row: any, index: number) => (row.id || `index_${index}`) === effect[1])
    if (!original) throw new Error('原事件已变化，请更新资料后重试。')
    if ((original.causal_scene_ids || []).includes(cause[1]) && cause[0] === effect[0] || (original.causal_event_refs || []).some((ref: any) => ref.owner_card_id === cause[0] && ref.scene_id === cause[1])) return
    await api.put(`/api/projects/${project}/events/${encodeURIComponent(effect[0])}/${encodeURIComponent(effect[1])}`, { base_revision: owner._revision, values: { ...original, causal_event_refs: [...(original.causal_event_refs || []), { owner_card_id: cause[0], scene_id: cause[1] }] } })
    const incoming: any = await mutate(); await mutateEvents(); onSaved?.()
    if (latestScope.current !== held) return
    const updated = incoming?.find?.((card: any) => card.id === form.id)
    if (updated && JSON.stringify(latest.current) === savedSnapshot) { localDraft.markSaved(form, updated); setDraft({ scope, card: updated }); setSavedSnapshot(JSON.stringify(updated)) }
  }
  const sourceControls = (row: any) => <details className='border-t border-border pt-2'><summary className='cursor-pointer text-xs text-brand-600'>{row.canonical_event_ref ? '同一事件的原来源' : '核对是否已有同一事件'}</summary><div className='mt-3 space-y-3'>{row.canonical_event_ref ? <><p className='text-xs leading-6 text-muted'>共享名称、内容、时间、人物及场景安排读取原记录；本表只单独安排章节、故事线、节拍与备注。旧数据保留，没有按同名自动合并。</p><p className='text-xs leading-6'>{sharedEventValues(row)?.scene || '原事件暂时无法读取'}{sourceEvent(row) ? `（${sourceName(sourceEvent(row))}）` : ''}</p><Button className='text-xs' onClick={() => openEventSource(row)}>打开原事件编辑共享内容</Button><Button variant='ghost' className='text-xs' onClick={() => editCell('important_scenes', row.id, 'canonical_event_ref', undefined)}>解除引用，保留本表原内容</Button></> : <><label className='block text-xs text-muted' htmlFor={`event-source-${row.id}`}>只有确定是同一件事，才选择原来源</label><Select id={`event-source-${row.id}`} value={sourceChoices[`${scope}:${row.id}`] || ''} onChange={(e) => setSourceChoices((current) => ({ ...current, [`${scope}:${row.id}`]: e.target.value }))}><option value=''>保持为独立事件</option>{canonicalEvents(allEvents).filter((entry: any) => entry.owner_card_id !== form.id || entry.scene_id !== row.id).map((entry: any) => <option key={entry.id} value={entry.id}>{entry.values?.scene || '未命名事件'}（{sourceName(entry)}）</option>)}</Select><Button className='text-xs' disabled={!sourceChoices[`${scope}:${row.id}`]} onClick={() => { const selected = canonicalEvents(allEvents).find((entry: any) => entry.id === sourceChoices[`${scope}:${row.id}`]); if (!selected) return; editCell('important_scenes', row.id, 'canonical_event_ref', { owner_card_id: selected.owner_card_id, scene_id: selected.scene_id }); setMessage('同源引用已放入本表，保存工作表后生效；没有复制或改写原事件。') }}>确认同一事件并引用</Button></>}</div></details>
  const eventRows: any[] = (Array.isArray(payload.important_scenes) ? payload.important_scenes : []).map(displayEvent)
  const event = eventRows.find((row: any) => row.id === timelineEvent)
  const linkedEvent = focusRequest?.id !== form?.id && timelineEvent === focusRequest?.rowId
    ? (Array.isArray(allEvents) ? allEvents : []).find(row => row.owner_card_id === focusRequest?.id && row.scene_id === timelineEvent)
    : null
  const eventLinks = (row: any, owner: string) => {
    const ref = row.canonical_event_ref || { owner_card_id: owner, scene_id: row.id }
    const context = { ...storyCard.payload?.world_context, ...row.world_context }
    const eventOrigin = { owner, scene: row.id, label: row.scene || '未命名事件', ref,
      context: { ...context, time: { ...context.time, event_ref: ref, position: 'immediate_after' } } }
    return <nav aria-label='事件关联资料' className='story-task-nav'>
      {characters.filter(person => (row.characters || row.cast || []).includes(person.id)).map(person =>
        <button key={person.id} onClick={() => onOpenMaterial?.({ id: person.id, type: 'character', eventOrigin })}>
          {person.payload?.name || person.title}
        </button>)}
      <button onClick={() => onOpenMaterial?.({ id: 'world', type: 'event-world', eventOrigin })}>此时的世界</button>
    </nav>
  }
  const tableRows = rows.slice().sort((a, b) => Number((tab.table === 'important_scenes' ? displayEvent(a) : a).sort_order ?? 1e9) - Number((tab.table === 'important_scenes' ? displayEvent(b) : b).sort_order ?? 1e9))
  const entities = (Array.isArray(materialRows) ? materialRows : []).filter((row: any) => ['character', 'world', 'world_rule', 'worldview', 'lore'].includes(row.type))
  const storedEvents = (Array.isArray(data) ? data.find((card: any) => card.id === form?.id)?.payload?.important_scenes || [] : [])
  const isStoredEvent = (id: string) => storedEvents.some((row: any) => row.id === id)
  const foreshadowings = Array.isArray(storyCard?.payload?.foreshadowings) ? storyCard.payload.foreshadowings : []
  const changeForeshadow = (index: number, patch: any) => onStoryCardChange?.({ ...storyCard, payload: { ...storyCard.payload, foreshadowings: foreshadowings.map((row: any, i: number) => i === index ? { ...row, ...patch, id: row.id || `foreshadow_${crypto.randomUUID().slice(0, 8)}` } : row) } })
  const pendingForeshadowRefs = foreshadowings.some((row: any) => [row.first_event_ref, row.payoff_event_ref].some((ref: any) => Boolean(ref && form?.id && ref.owner_card_id === form.id && !isStoredEvent(ref.scene_id))))
  if (!storyCard?.id || storyCard.id === 'story_new') return <section className='space-y-4'><h1 className='page-title'>故事安排</h1><p className='text-sm text-muted'>先保存一份故事设定，再为它建立独立工作表。</p><Button onClick={onOpenStory}>回到故事策划</Button></section>
  if (!form) return <p role='status' className='text-sm text-muted'>{error || data?.detail ? '工作表读取失败，请刷新后重试。' : '正在读取情节工作表…'}</p>
  if (activeRehearsal?.scope === scope) return <SceneRehearsalWorkspace key={`${scope}:${activeRehearsal.sceneId}`} project={project} ownerCardId={form.id} sceneId={activeRehearsal.sceneId} sceneLabel={activeRehearsal.label} profileId={profileId} draftCache={draftCache} onBack={() => setActiveRehearsal(null)} onConfirmed={mergeRehearsalConfirmation} onOpenMaterial={onOpenMaterial} onOpenSettings={onOpenSettings} />
  return <div className='planning-workspace space-y-6'>
    <header className='flex flex-wrap items-start justify-between gap-4'><h1 className='page-title'>故事安排</h1><div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy)} onClick={exportWorkbook}>{busy === 'export' ? '导出中…' : '导出当前表单'}</Button><Button variant='primary' disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '保存中…' : '保存工作表'}</Button></div></header>
    {hasSaved && <AuthorControls key={`${scope}:lock`} project={project} target={`cards/${form.id}.yaml`} label='情节工作表' value={form} revision={form._revision} dirty={JSON.stringify(form) !== savedSnapshot} onChanged={(value, result) => { const next = { ...value, _revision: result.base_revision }; setDraft({ scope, card: next }); setSavedSnapshot(JSON.stringify(next)); localDraft.markSaved(form, next); void mutate(); void mutateEvents(); onSaved?.() }} />}
    {(!hasSaved || JSON.stringify(form) !== savedSnapshot) && <p role='status' className='text-xs text-muted'>{hasSaved ? '有未保存的修改' : '工作表尚未保存'}</p>}
    {pendingRehearsal && <section id='planning-rehearsal-open' className='space-y-3 border-y border-border py-4' aria-label='保存工作表后打开推演'><p className='text-sm leading-7'>当前工作表有未保存内容。推演会联动保存版，请先保存后打开，或留在表内继续编辑。</p><div className='flex flex-wrap gap-2'><Button variant='primary' disabled={Boolean(busy)} onClick={saveAndOpenRehearsal}>{busy === 'save' ? '保存中…' : '保存并打开这一场'}</Button><Button disabled={Boolean(busy)} onClick={() => setPendingRehearsal(null)}>继续编辑工作表</Button></div></section>}
    {localDraft.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>找到这份工作表的本地草稿，恢复后可继续核对。</p><div className='flex gap-2'><Button onClick={localDraft.restore}>恢复草稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留保存版</Button></div></div>}
    <nav className='story-task-nav' aria-label='故事安排'>{['时间线','故事线','章节编排'].map(label => <button key={label} aria-current={section === label ? 'page' : undefined} onClick={() => {setSection(label);setActiveTab(label === '章节编排' ? 5 : label === '故事线' ? 2 : 0)}}>{label}</button>)}</nav>
    {section === '章节编排' && <><div className='flex gap-2'><Button aria-pressed={pacingView} onClick={() => setPacingView(true)}>线路与正文</Button><Button aria-pressed={!pacingView} onClick={() => setPacingView(false)}>章节与线索表</Button></div>{pacingView && <NarrativePacing key={scope} project={project} story={storyCard.id} draftCache={draftCache} />}</>}
    <div hidden={section === '章节编排' && pacingView}>
    <details className='border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>故事素材与骨架</summary><div className='mt-4'>
    <section className='planning-starter space-y-4 border-y border-border py-5' aria-label='从故事整理骨架'>
      <details><summary className='cursor-pointer text-sm text-brand-600'>参考故事 · {storyCard.title || '当前故事'}</summary><p className='mt-3 max-w-prose whitespace-pre-wrap text-sm leading-7 text-muted'>{[storyCard.payload?.logline, storyCard.payload?.summary, storyCard.payload?.main_conflict, storyCard.payload?.worldview].filter(Boolean).join('\n\n') || '暂无故事摘要'}</p></details>
      <div className='space-y-2'><label htmlFor='planning-inspiration' className='text-sm font-medium'>故事素材</label><Textarea id='planning-inspiration' maxLength={24000} className='min-h-36' value={payload.inspiration || ''} onChange={(event) => changePayload('inspiration', event.target.value)} placeholder='输入故事构想或粘贴原文' /></div>
      <div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy)} onClick={() => starterRequest('prepare')}>{busy === 'skeleton-prepare' ? '整理中…' : skeleton?.skeleton ? '核对最新材料，保留骨架' : '整理已有材料（本地）'}</Button><Button disabled={Boolean(busy)} onClick={() => starterRequest('propose')}>{busy === 'skeleton-propose' ? '提取中…' : skeleton?.skeleton ? 'AI 重新提取' : 'AI 提取骨架'}</Button><Button variant='ghost' disabled={Boolean(busy) || (skeleton?.skeleton?.events?.length || 0) >= 40} onClick={() => editSkeleton([...(skeleton?.skeleton?.events || []), makeSkeletonEvent()])}>手动添加事件</Button></div>
      <p className='text-xs leading-6 text-muted'>本地整理仅关联已有资料。AI 重新提取会替换当前预览，创作建议单独列出。</p>
      {skeleton && <section className='space-y-4 border-t border-border pt-5' aria-label='待确认的故事骨架'>
        <div><h3 className='text-lg font-semibold'>事件顺序</h3><p className='mt-2 text-xs leading-6 text-muted'>这是待确认的骨架，不是作品事实。可直接修订顺序和内容；下面详细表中的原记录不会被删除。</p></div>
        {skeletonStale && <p role='status' className='text-sm leading-7 text-muted'>已有材料或表单又有变化，骨架预览仍保留。请先“核对最新材料”，再确认分配。</p>}
        {(skeleton.skeleton?.events || []).map((event: any, index: number, events: any[]) => {
          const update = (key: string, value: any) => editSkeleton(events.map((row: any, i: number) => i === index ? { ...row, [key]: value, basis: 'author_edited' } : row))
          const move = (offset: number) => { const items = [...events]; [items[index], items[index + offset]] = [items[index + offset], items[index]]; editSkeleton(items) }
          return <article key={event.id || index} className='space-y-3 border-b border-border pb-5' aria-label={`骨架事件${index + 1}`}>
            <div className='flex flex-wrap items-center justify-between gap-2'><h4 className='text-sm font-medium'>第 {index + 1} 件事</h4><div className='flex flex-wrap gap-1'><Button variant='ghost' className='text-xs' disabled={index === 0} onClick={() => move(-1)}>上移</Button><Button variant='ghost' className='text-xs' disabled={index === events.length - 1} onClick={() => move(1)}>下移</Button><Button variant='ghost' className='text-xs' onClick={() => editSkeleton(events.filter((_: any, i: number) => i !== index))}>移出预览</Button></div></div>
            <div className='space-y-2'><label className='text-xs text-muted' htmlFor={`skeleton-title-${index}`}>事件名称</label><Input id={`skeleton-title-${index}`} value={event.title || ''} onChange={(e) => update('title', e.target.value)} placeholder='例如：雨夜错过渡船' /></div>
            <div className='space-y-2'><label className='text-xs text-muted' htmlFor={`skeleton-summary-${index}`}>事件内容</label><Textarea id={`skeleton-summary-${index}`} className='min-h-24' value={event.summary || ''} onChange={(e) => update('summary', e.target.value)} /></div>
            <p className='text-xs text-muted'>{event.basis === 'extracted' ? '来自已有明确材料' : event.basis === 'suggested' ? '新建议，待作者判断' : '作者已修订 / 手写'}</p>
            <details><summary className='cursor-pointer text-xs text-brand-600'>补充人物、选择与章节关联（可选）</summary><div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'><div className='space-y-2'><label className='text-xs text-muted'>涉及人物</label>{fieldEditor({ key: 'characters', label: '人物', kind: 'characters' }, event.characters, (value) => update('characters', value), `骨架事件${index + 1}涉及人物`)}</div><div className='space-y-2'><label className='text-xs text-muted'>对应章节</label>{fieldEditor({ key: 'chapter', label: '章节', kind: 'chapter' }, event.chapter, (value) => update('chapter', value), `骨架事件${index + 1}对应章节`)}</div>{[['goal', '此时想得到什么'], ['action', '做了什么'], ['choice', '关键选择'], ['outcome', '带来的结果']].map(([key, label]) => <div key={key} className='space-y-2'><label className='text-xs text-muted' htmlFor={`skeleton-${key}-${index}`}>{label}</label><Textarea id={`skeleton-${key}-${index}`} value={event[key] || ''} onChange={(e) => update(key, e.target.value)} placeholder='未写明时可留空。' /></div>)}</div>{event.character_steps?.length > 0 && <div className='mt-4 space-y-3'>{event.character_steps.map((step: any, stepIndex: number) => <div key={stepIndex} className='space-y-2 border-t border-border pt-3'><p className='text-sm font-medium'>{characters.find((person: any) => person.id === step.character_id)?.payload?.name || characters.find((person: any) => person.id === step.character_id)?.title || '相关人物'}的走向</p>{[['goal', '目标'], ['action', '行动'], ['choice', '选择'], ['outcome', '变化']].map(([key, label]) => <div key={key}><label className='text-xs text-muted' htmlFor={`skeleton-step-${index}-${stepIndex}-${key}`}>{label}</label><Input id={`skeleton-step-${index}-${stepIndex}-${key}`} value={step[key] || ''} onChange={(e) => update('character_steps', event.character_steps.map((entry: any, i: number) => i === stepIndex ? { ...entry, [key]: e.target.value } : entry))} /></div>)}</div>)}</div>}</details>
            {event.source_quotes?.length > 0 && <details><summary className='cursor-pointer text-xs text-muted'>提取时的原文依据</summary>{event.source_quotes.map((quote: string, i: number) => <blockquote key={i} className='mt-2 text-xs leading-6 text-muted'>{quote}</blockquote>)}</details>}
          </article>
        })}
        {!skeleton.skeleton?.events?.length && <p className='py-3 text-sm leading-7 text-muted'>还没有可确认的事件。可手动添加事件，或请 AI 从文字里提取；没有写出的剧情不会由本地整理编造。</p>}
        {skeleton.skeleton?.suggestions?.length > 0 && <details className='border-b border-border pb-4'><summary className='cursor-pointer text-sm font-medium'>另外的创作建议（尚未加入骨架）</summary><div className='mt-3 space-y-4'>{skeleton.skeleton.suggestions.map((event: any, index: number) => <section key={event.id || index} className='space-y-2'><h4 className='text-sm font-medium'>{event.title || '待判断的建议'}</h4><p className='whitespace-pre-wrap text-sm leading-7 text-muted'>{event.summary}</p><Button className='text-xs' onClick={() => editSkeleton([...(skeleton.skeleton.events || []), { ...event, basis: 'author_edited' }], skeleton.skeleton.suggestions.filter((_: any, i: number) => i !== index))}>将这条建议加入骨架</Button></section>)}</div></details>}
        {(skeleton.notices || []).map((notice: string, index: number) => <p key={index} className='text-xs leading-6 text-muted'>{notice}</p>)}
        {skeleton.conflicts?.length > 0 && <details className='border-b border-border pb-4'><summary className='cursor-pointer text-sm font-medium'>有 {skeleton.conflicts.length} 项与原表不同，已保留原内容</summary><ul className='mt-3 space-y-3'>{skeleton.conflicts.map((conflict: any, index: number) => { const field = COLUMNS[conflict.table as TableKey]?.find((column) => column.key === conflict.field); const row = (payload[conflict.table] || []).find((item: any) => item.id === conflict.row_id); const show = (value: any) => conflict.field === 'basis' ? sourceLabel(value) : field?.kind ? (Array.isArray(value) ? value : [value]).map((id: string) => optionsFor(field.kind).find((option: any) => option.id === id)?.label || '原关联资料').join('、') : Array.isArray(value) ? value.join('；') : String(value || '未填写'); return <li key={index} className='text-xs leading-6 text-muted'><p className='font-medium text-text'>{row?.scene || row?.name || TABS.find((item) => item.table === conflict.table)?.label || '原记录'}：{field?.label || '来源说明'}</p><p>保留：{show(conflict.existing)}</p><p>本次骨架：{show(conflict.proposed)}</p></li> })}</ul></details>}
        <TokenUsage usage={skeleton.usage} calls={skeleton.usage?.by_module?.length ? undefined : []} />
        <Button variant='primary' disabled={Boolean(busy) || skeletonStale || !skeleton.skeleton?.events?.some((event: any) => event.title?.trim() || event.summary?.trim())} onClick={() => starterRequest('apply')}>{busy === 'skeleton-apply' ? '分配中…' : '确认骨架，分配到工作表'}</Button>
        <p className='text-xs leading-6 text-muted'>用代码关联情节、人物交集与人物线，只补原表空白；不改原故事、已有推演或正文。分配后仍需点击“保存工作表”。十五拍只在详细表里按需选用。</p>
      </section>}
    </section>
    </div></details>
    {section === '时间线' && <>
    <section className='space-y-4 border-y border-border py-5' aria-label='故事事件时间线'>
      <div className='flex flex-wrap items-center justify-between gap-3'><div><h2 className='text-lg font-semibold'>事件时间线</h2><p className='mt-2 text-xs leading-6 text-muted'>按故事时间排序，可关联章节。</p></div><Button onClick={() => { const row = makeRow('important_scenes'); changePayload('important_scenes', [...(payload.important_scenes || []), row]); setTimelineEvent(row.id) }}>添加事件</Button></div>
      {hasSaved && <details><summary className='cursor-pointer text-sm text-brand-600'>事件关系图</summary><div className='mt-4'><KnowledgeGraph project={project} defaultLayer='events' focusId={event ? `${form.id}:important_scenes:${event.id}` : undefined} title='同一份事件与前因' onCreateEvent={() => { const row = makeRow('important_scenes'); changePayload('important_scenes', [...(payload.important_scenes || []), row]); setTimelineEvent(row.id) }} onConnectEvents={connectOriginalEvents} onOpen={(target) => onOpenMaterial?.(target)} /></div></details>}
      {eventRows.length ? <ol className='event-timeline'>{eventRows.map((row: any, index: number) => <li key={row.id} className={timelineEvent === row.id ? 'is-current' : ''}><button className='event-timeline-select focus-ring' aria-current={timelineEvent === row.id ? 'true' : undefined} onClick={() => setTimelineEvent(timelineEvent === row.id ? '' : row.id)}><span className='text-xs text-muted'>{index + 1}</span><span className='min-w-0'><strong className='block text-sm font-medium'>{row.scene || '未命名事件'}</strong><span className='mt-1 block text-xs leading-6 text-muted'>{row.time || '时间未注明'}{row.emotion ? ` · ${row.emotion}` : ''}{row.chapter ? ` · ${chapters.find((chapter: any) => chapter.chapter_id === row.chapter)?.chapter_title || chapters.find((chapter: any) => chapter.chapter_id === row.chapter)?.title || '已关联章节'}` : ' · 未分章'}</span>{row.plot && <span className='mt-1 block text-sm leading-7 text-muted'>{row.plot}</span>}</span></button><div className='ml-7 flex flex-wrap gap-2'><Button variant='ghost' className='text-xs' disabled={Boolean(busy)} onClick={() => askRehearsal(row.id)}>推演这一场</Button><Button variant='ghost' className='text-xs' disabled={index === 0} onClick={() => { const items = [...eventRows]; [items[index], items[index - 1]] = [items[index - 1], items[index]]; changePayload('important_scenes', items) }}>前移</Button><Button variant='ghost' className='text-xs' disabled={index === eventRows.length - 1} onClick={() => { const items = [...eventRows]; [items[index], items[index + 1]] = [items[index + 1], items[index]]; changePayload('important_scenes', items) }}>后移</Button></div></li>)}</ol> : <p className='py-3 text-sm text-muted'>暂无事件，可从故事骨架导入或手动添加。</p>}
      {linkedEvent && <article className='space-y-3 border-t border-border py-4' aria-label='所选故事事件'>
        <h3>{linkedEvent.effective_values.scene || '未命名事件'}</h3>
        <p>{linkedEvent.effective_values.time}</p>
        <p className='whitespace-pre-wrap'>{linkedEvent.effective_values.plot}</p>
        {eventLinks({ ...linkedEvent.effective_values, id: linkedEvent.scene_id }, linkedEvent.owner_card_id)}
        <Button onClick={() => onOpenMaterial?.({ id: linkedEvent.id, type: 'scene' })}>编辑来源</Button>
      </article>}
      {event && !linkedEvent && <section id={`timeline-edit-${event.id}`} className='space-y-4 border-t border-border pt-5' aria-label='编辑同一事件'><h3 className='font-medium'>编辑：{event.scene || '未命名事件'}</h3>{isStoredEvent(event.id) && eventLinks(event, form.id)}{sourceControls(event)}<InformationPanel key={`${scope}:${event.id}:info`} project={project} storyId={storyCard.id} chapterId={event.chapter} eventRef={event.canonical_event_ref || (hasSaved ? { owner_card_id: form.id, scene_id: event.id } : undefined)} value={event.information_ids || []} onChange={event.canonical_event_ref ? undefined : (ids) => editCell('important_scenes', event.id, 'information_ids', ids)} /><fieldset disabled={Boolean(event.canonical_event_ref)} className='min-w-0 space-y-4'><div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>{[['scene', '事件名称'], ['time', '在故事中的时间'], ['plot', '发生的事'], ['emotion', '情绪怎样承接']].map(([key, label]) => <div key={key} className={key === 'plot' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}><label className='text-xs text-muted' htmlFor={`timeline-${event.id}-${key}`}>{label}</label><Textarea id={`timeline-${event.id}-${key}`} value={event[key] || ''} onChange={(e) => editCell('important_scenes', event.id, key, e.target.value)} placeholder={key === 'emotion' ? '可选：上一件事留下什么感受，本场又怎样改变；无需填写每人的表情衣着。' : '可先留空'} /></div>)}</div><div className='space-y-2'><h4 className='text-sm font-medium'>哪些事件是它的前因？</h4><div className='flex flex-col gap-2'>{eventRows.filter((row: any) => row.id !== event.id).map((row: any) => <label key={row.id} className='flex items-start gap-2 text-xs leading-6'><input type='checkbox' checked={(event.causal_scene_ids || []).includes(row.id)} onChange={(e) => editCell('important_scenes', event.id, 'causal_scene_ids', e.target.checked ? [...(event.causal_scene_ids || []), row.id] : (event.causal_scene_ids || []).filter((id: string) => id !== row.id))} />{row.scene || '未命名事件'}</label>)}</div><details><summary className='cursor-pointer text-xs text-brand-600'>关联其他来源中的原事件</summary><div className='mt-3 flex flex-col gap-2'>{canonicalEvents(allEvents).filter((row: any) => row.owner_card_id !== form.id).map((row: any) => { const selected = (event.causal_event_refs || []).some((ref: any) => ref.owner_card_id === row.owner_card_id && ref.scene_id === row.scene_id); return <label key={row.id} className='flex items-start gap-2 text-xs leading-6'><input type='checkbox' checked={selected} onChange={(e) => editCell('important_scenes', event.id, 'causal_event_refs', e.target.checked ? [...(event.causal_event_refs || []), { owner_card_id: row.owner_card_id, scene_id: row.scene_id }] : (event.causal_event_refs || []).filter((ref: any) => ref.owner_card_id !== row.owner_card_id || ref.scene_id !== row.scene_id))} />{row.values?.scene || '未命名原事件'}<span className='text-muted'>同一份来源</span></label> })}</div></details><p className='text-xs text-muted'>只连接你确定的前因，不会自动推断因果或补写关系。跨来源仍引用原事件，不复制一行。</p></div>
        <details><summary className='cursor-pointer text-sm text-muted'>本事件的世界与叙述视角（继承故事 / 章节）</summary><div className='mt-3'><WorldContextFields project={project} storyId={storyCard.id} value={event.world_context} onChange={(value) => editCell('important_scenes', event.id, 'world_context', value)} inherited='本事件默认继承章节、再继承故事。只有改变时才填写；发生时间不按讲述顺序推断。' /><label className='my-2 block text-xs text-muted'>本场视角（留空沿用默认）</label><Input value={event.pov || ''} onChange={(e) => editCell('important_scenes', event.id, 'pov', e.target.value)} placeholder='例如：林秋的有限视角，或第一人称。' /><label className='my-2 block text-xs text-muted'>本场的视角人物（限制可知信息）</label><Select value={event.pov_character_id || ''} onChange={(e) => editCell('important_scenes', event.id, 'pov_character_id', e.target.value)}><option value=''>未指定 / 继承章节</option>{characters.map((person: any) => <option key={person.id} value={person.id}>{person.payload?.name || person.title || '未命名人物'}</option>)}</Select></div></details>
        <details className='border-y border-border py-4' open={Boolean(focusRequest?.editPath?.includes('relationship_changes') && focusRequest.rowId === event.id)}><summary className='cursor-pointer text-sm font-medium'>本场带来的关系变化（作者计划）</summary><div className='mt-4 space-y-4'>{(event.relationship_changes || []).map((relation: any, index: number) => { const update = (key: string, value: string) => editCell('important_scenes', event.id, 'relationship_changes', event.relationship_changes.map((row: any, i: number) => i === index ? { ...row, [key]: value } : row)); return <div key={relation.id || index} id={`planning-relationship-${event.id}-${index}`} className='space-y-3 border-b border-border pb-4'><p className='text-xs leading-6 text-muted'>只记录前者对后者的变化；对方的态度可以不同。此项尚非正文事实。</p><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{[['source_id', '谁的态度 / 关系'], ['target_id', '对谁']].map(([key, label]) => <div key={key}><label className='mb-1 block text-xs text-muted' htmlFor={`relation-${event.id}-${index}-${key}`}>{label}</label><Select id={`relation-${event.id}-${index}-${key}`} value={relation[key] || ''} onChange={(e) => update(key, e.target.value)}><option value=''>选择已有实体</option>{relation[key] && !entities.some((item: any) => item.id === relation[key]) && <option value={relation[key]}>原关联暂不可用（保留）</option>}{entities.map((item: any) => <option key={item.id} value={item.id}>{item.label || '未命名资料'}</option>)}</Select></div>)}</div><label className='block text-xs text-muted' htmlFor={`relation-${event.id}-${index}-text`}>到本场之后，关系变成什么</label><Input id={`relation-${event.id}-${index}-text`} value={relation.relation || ''} onChange={(e) => update('relation', e.target.value)} placeholder='例如：暂时合作，仍互相防备。' /><Textarea aria-label='关系变化的缘由与限制' value={relation.notes || ''} onChange={(e) => update('notes', e.target.value)} placeholder='可选：由哪个选择引起，仍有什么保留。' />{(!relation.source_id || !relation.target_id) && <p className='text-xs text-muted'>保存前请选择双方，或移除这条尚未填写的记录。</p>}<Button variant='ghost' className='text-xs' onClick={() => editCell('important_scenes', event.id, 'relationship_changes', event.relationship_changes.filter((_: any, i: number) => i !== index))}>移除这条计划</Button></div> })}<Button className='text-xs' onClick={() => editCell('important_scenes', event.id, 'relationship_changes', [...(event.relationship_changes || []), { id: `relation_${crypto.randomUUID().slice(0, 8)}`, source_id: '', target_id: '', relation: '', notes: '' }])}>安排一处关系变化</Button></div></details>
        </fieldset>{onStoryCardChange && <details className='border-b border-border pb-4'><summary className='cursor-pointer text-sm font-medium'>从这件事安排伏笔</summary><div className='mt-4 space-y-4'><p className='text-xs leading-6 text-muted'>编辑故事中的同一份伏笔，不复制到工作表。这里是埋设与回收计划；原文命中及确认仍到章节检查结果核对。</p>{foreshadowings.map((row: any, index: number) => ({ row, index })).filter(({ row }: any) => row.first_event_ref?.owner_card_id === form.id && row.first_event_ref.scene_id === event.id).map(({ row, index }: any) => <div key={row.id || index} className='space-y-3 border-t border-border pt-3'><h4 className='text-sm font-medium'>伏笔 {index + 1} · 作者计划</h4><Textarea aria-label={`事件中的伏笔${index + 1}`} value={row.content || ''} onChange={(e) => changeForeshadow(index, { content: e.target.value })} placeholder='这件事中让读者注意到什么？' /><Textarea aria-label={`伏笔${index + 1}回收方式`} value={row.payoff || ''} onChange={(e) => changeForeshadow(index, { payoff: e.target.value })} placeholder='可选：后来怎样回收，不确定时留空。' /><label className='block text-xs text-muted' htmlFor={`event-payoff-${index}`}>计划在哪件事回收</label><Select id={`event-payoff-${index}`} value={row.payoff_event_ref?.owner_card_id === form.id ? row.payoff_event_ref.scene_id || '' : ''} onChange={(e) => changeForeshadow(index, { payoff_event_ref: e.target.value ? { owner_card_id: form.id, scene_id: e.target.value } : undefined })}><option value=''>未决定 / 另有原安排</option>{eventRows.map((item: any) => <option key={item.id} value={item.id}>{item.scene || '未命名事件'}</option>)}</Select></div>)}<Button className='text-xs' disabled={!isStoredEvent(event.id)} onClick={() => onStoryCardChange({ ...storyCard, payload: { ...storyCard.payload, foreshadowings: [...foreshadowings, { id: `foreshadow_${crypto.randomUUID().slice(0, 8)}`, content: '', status: '未出现', first_event_ref: { owner_card_id: form.id, scene_id: event.id } }] } })}>在此安排一处伏笔</Button>{!isStoredEvent(event.id) && <p className='text-xs leading-6 text-muted'>请先保存工作表，让这个事件有保存版，再安排故事中的伏笔。</p>}{pendingForeshadowRefs && <p className='text-xs leading-6 text-muted'>回收目标中含尚未保存的事件，请先保存工作表，再保存故事伏笔；当前编辑保留。</p>}{onSaveStory && <Button className='text-xs' disabled={pendingForeshadowRefs || Boolean(busy)} onClick={onSaveStory}>保存故事中的伏笔</Button>}<Button variant='ghost' className='text-xs' onClick={onOpenStory}>查看故事与伏笔汇总</Button></div></details>}
        {hasSaved && isStoredEvent(event.id) && <CardOperations key={`${scope}:${event.id}:organize`} project={project} storyId={storyCard.id} actions={['split', 'reorder']} current={{ id: event.canonical_event_ref ? `${event.canonical_event_ref.owner_card_id}:important_scenes:${event.canonical_event_ref.scene_id}` : `${form.id}:important_scenes:${event.id}`, label: event.scene || '当前事件', content: event.plot || '' }} entries={(Array.isArray(allEvents) ? allEvents : []).filter((row: any) => row.owner_card_id === (event.canonical_event_ref?.owner_card_id || form.id)).map((row: any) => ({ id: row.id, label: `${row.values?.scene || '未命名事件'}（${sourceName(row)}）`, content: row.values?.plot || '' }))} isDirty={(id) => { const owner = id.split(':')[0]; return owner === form.id ? JSON.stringify(latest.current) !== savedSnapshot : Boolean(isTargetDirty?.(owner)) }} onApplied={async () => { const before = form; const incoming: any = await mutate(); await mutateEvents(); if (latestScope.current !== scope) return; const updated = incoming?.find?.((card: any) => card.id === form.id); if (updated && JSON.stringify(latest.current) === JSON.stringify(before)) { localDraft.markSaved(before, updated); setDraft({ scope, card: updated }); setSavedSnapshot(JSON.stringify(updated)); draftCache.current[`${scope}:planningDraft`] = { card: updated, savedSnapshot: JSON.stringify(updated), hasSaved: true } }; onSaved?.() }} />}
      </section>}
    </section>
    </>}
    <details><summary className='cursor-pointer text-sm'>故事设定中的安排</summary>
      <div className='flex flex-wrap gap-2'>
        {section === '章节编排' ? <Button onClick={() => onStorySection('Chapter Matrix')}>章节计划</Button> : <>
          <Button onClick={() => onStorySection('Lines')}>重要场景与明暗线</Button>
          <Button onClick={() => onStorySection('Foreshadowings')}>伏笔安排</Button>
        </>}
      </div>
    </details>
    <details key={section} open={section !== '时间线'} className='py-2'>
    <summary className='cursor-pointer text-sm'>{section === '时间线' ? '详细工作表' : section}</summary>
    {section === '章节编排' ? <nav className='story-task-nav planning-tab-nav' aria-label='章节编排'>
      {TABS.map((item, index) => (item.matrix || item.pacing) && <button key={item.label} aria-current={activeTab === index ? 'page' : undefined} onClick={() => setActiveTab(index)}>{item.label}</button>)}
    </nav> : <nav className='story-task-nav planning-tab-nav' aria-label='情节工作表'>{TABS.slice(0,5).map((item, index) => <button key={item.label} aria-current={activeTab === index ? 'page' : undefined} onClick={() => setActiveTab(index)}>{item.label}</button>)}</nav>}
    {!tab.pacing && <details className='border-b border-border pb-4'><summary className='cursor-pointer text-xs text-muted'>只整理当前表</summary><p className='my-3 text-xs leading-6 text-muted'>使用上面的故事想法，只提取当前表所需的明确内容；仍先预览，只补空白。</p><Button className='text-xs' disabled={Boolean(busy) || !payload.inspiration?.trim()} onClick={() => propose('extract')}>AI 提取到当前表：{tab.label}</Button></details>}
    {tab.pacing ? <PacingAnalysis key={scope} project={project} story={storyCard.id} chapters={chapters} outline={storyCard.payload?.full_outline || payload.inspiration || storyCard.payload?.summary || storyCard.payload?.logline || ''} /> : tab.matrix ? <ChapterThreadsMatrix chapters={chapters} threads={threads} events={rows.map(displayEvent)} busy={Boolean(busy)} onEventsChange={(events) => { changePayload('important_scenes', events.map((entry: any) => { const old = rows.find((item: any) => item.id === entry.id); return old?.canonical_event_ref ? { ...old, ...Object.fromEntries(localEventFields.map((key) => [key, entry[key]])) } : entry })); enableMatrix() }} onThreadsChange={(items) => changePayload('plot_threads', items)} onEdit={editMatrixCell} onSuggest={(row) => propose('suggest', row)} onRehearse={askRehearsal} onOpenSource={openEventSource} onOpenEvent={(id) => { setSection('时间线'); setActiveTab(0); setTimelineEvent(id) }} renderExtras={(row) => <>{sourceControls(row)}{row.canonical_event_ref ? <p className='text-xs leading-6 text-muted'>人物、作用、地点和关联资料请回原事件查看与修改。</p> : <><div className='space-y-1'><label className='text-xs text-muted'>相关人物</label>{fieldEditor({ key: 'characters', label: '相关人物', kind: 'characters' }, row.characters, (value) => editMatrixCell(row.id, 'characters', value), '矩阵事件相关人物')}</div><div className='space-y-1'><label className='text-xs text-muted' htmlFor={`matrix-purpose-${row.id}`}>在故事中的作用</label><Textarea id={`matrix-purpose-${row.id}`} value={row.purpose || ''} onChange={(event) => editMatrixCell(row.id, 'purpose', event.target.value)} /></div><div className='space-y-1'><label className='text-xs text-muted' htmlFor={`matrix-location-${row.id}`}>地点</label><Input id={`matrix-location-${row.id}`} value={row.location || ''} onChange={(event) => editMatrixCell(row.id, 'location', event.target.value)} /></div><MaterialReferences compact project={project} value={row.material_ids || []} onChange={(ids) => editMatrixCell(row.id, 'material_ids', ids)} onOpen={onOpenMaterial} hint='关联随同一份情节工作表保存。' /></>}</>} /> : <section className='space-y-4' aria-label={tab.label}>
      <div className='flex flex-wrap items-center justify-between gap-3'><div><h2 className='text-lg font-semibold'>{tab.label}</h2><p className='mt-1 text-xs text-muted'>{tab.brief ? '与十五节拍详表同步。' : '可按单元格或整行生成建议。'}</p></div><Button disabled={Boolean(busy)} onClick={() => changePayload(tab.table, [...rows, makeRow(tab.table)])}>添加一行</Button></div>
      {tab.table === 'beat_sheet' && <div className='space-y-2'><label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={Boolean(payload.beat_sheet_enabled)} onChange={(event) => { const enabled = event.target.checked; setDraft((current) => current?.scope === scope ? { ...current, card: { ...current.card, payload: { ...current.card.payload, beat_sheet_enabled: enabled, beat_sheet: enabled && !current.card.payload.beat_sheet?.length ? BEAT_NAMES.map((name, index) => ({ id: `beat_${index + 1}`, name })) : current.card.payload.beat_sheet } } } : current) }} />使用整书十五拍参考</label><p className='text-xs text-muted'>模板可修改，不要求每章套用十五拍。关闭后保留表内内容，并停止将它作为整书节拍参考。</p></div>}
      <details className='my-3'><summary className='cursor-pointer text-xs text-muted'>选择要显示的列</summary><div className='mt-3 flex flex-wrap gap-3'>{allColumns.map((column) => <label key={column.key} className='flex items-center gap-2 text-xs'><input type='checkbox' checked={columns.some((item) => item.key === column.key)} onChange={(e) => { const next = { ...visibleColumns, [tab.label]: e.target.checked ? [...columns.map((item) => item.key), column.key] : columns.filter((item) => item.key !== column.key).map((item) => item.key) }; setVisibleColumns(next); localStorage.setItem('novix:worksheet-columns', JSON.stringify(next)) }} />{column.label}</label>)}</div></details>
      <div className='planning-table-scroll' role='region' aria-label={`${tab.label}编辑表，宽表可横向滚动`} tabIndex={0}><table className='planning-table'><caption className='sr-only'>{tab.label}，所有字段均可留空</caption><thead><tr><th scope='col' className='planning-row-number'>行</th>{columns.map((column) => <th key={column.key} scope='col'>{column.label}</th>)}<th scope='col'>操作与来源</th></tr></thead><tbody>{tableRows.map((row, index) => <tr key={row.id} id={`planning-row-${row.id}`}><th scope='row' className='planning-row-number'>{index + 1}</th>{columns.map((column) => <td key={column.key}><div className='planning-focus-cell space-y-2'>{tab.table === 'important_scenes' && row.canonical_event_ref && !localEventFields.includes(column.key) ? <p className='whitespace-pre-wrap text-xs leading-6'>{column.kind ? (Array.isArray(displayEvent(row)[column.key]) ? displayEvent(row)[column.key] : [displayEvent(row)[column.key]]).filter(Boolean).map((id: string) => optionsFor(column.kind).find((item: any) => item.id === id)?.label || '原关联资料').join('、') || '原资料未填写' : displayEvent(row)[column.key] || '原资料未填写'}</p> : fieldEditor(column, row[column.key], (value) => editCell(tab.table, row.id, column.key, value), `${tab.label}第${index + 1}行${column.label}`)}<Button variant='ghost' className='planning-cell-ai text-xs' disabled={Boolean(busy) || Boolean(row.canonical_event_ref) || !blank(row[column.key])} aria-label={`AI 补充第${index + 1}行${column.label}`} onClick={() => propose('suggest', row, column.key)}>AI 补空</Button></div></td>)}<td><div className='space-y-2'>{tab.table === 'important_scenes' && <><Button variant='ghost' className='w-full text-xs' onClick={() => openTimelineEvent(row.id)}>编辑事件与整理</Button>{sourceControls(row)}</>}{tab.table === 'important_scenes' && <Button className='w-full text-xs' disabled={Boolean(busy)} onClick={() => askRehearsal(row.id)}>推演这一场</Button>}{tab.table === 'important_scenes' && unplacedReason(row, chapters, threads) && <p className='text-xs leading-5 text-muted'>{unplacedReason(row, chapters, threads)}；记录已保留，可在此调整。</p>}{row.canonical_event_ref ? <Button variant='ghost' className='text-xs' onClick={() => openEventSource(row)}>查看原事件资料</Button> : <MaterialReferences compact project={project} value={row.material_ids || []} onChange={(ids) => editCell(tab.table, row.id, 'material_ids', ids)} onOpen={onOpenMaterial} hint='随工作表保存，共享原资料，不复制正文。' />}<Button className='w-full text-xs' disabled={Boolean(busy) || Boolean(row.canonical_event_ref)} onClick={() => propose('suggest', row)}>AI 补这一行</Button><Button variant='ghost' className='w-full text-xs' onClick={() => changePayload(tab.table, rows.filter((entry) => entry.id !== row.id))}>移除行</Button><InformationPanel key={`${scope}:${tab.table}:${row.id}:information`} project={project} storyId={storyCard.id} chapterId={row.chapter} characterId={row.character_id} eventRef={tab.table === 'important_scenes' ? row.canonical_event_ref || (hasSaved ? { owner_card_id: form.id, scene_id: row.id } : undefined) : row.scene_id && hasSaved ? { owner_card_id: form.id, scene_id: row.scene_id } : undefined} value={tab.table === 'important_scenes' && row.canonical_event_ref ? displayEvent(row).information_ids || [] : row.information_ids || []} onChange={row.canonical_event_ref ? undefined : (ids) => editCell(tab.table, row.id, 'information_ids', ids)} title='相关信息与透露' />{row.basis && <p className='text-xs text-muted'>{sourceLabel(row.basis)}</p>}{Array.isArray(row.source_quotes) && row.source_quotes.length > 0 && <details><summary className='cursor-pointer text-xs text-muted'>提取时的原文参考</summary>{row.source_quotes.map((quote: string, quoteIndex: number) => <blockquote key={quoteIndex} className='mt-2 text-xs leading-5 text-muted'>{quote}</blockquote>)}</details>}</div></td></tr>)}</tbody></table>{!rows.length && <div className='py-8 text-sm text-muted'>暂无记录</div>}</div>
    </section>}
    </details>
    {preview && <section className='space-y-4 border-y border-border py-5' aria-label='待确认的工作表候选'><div><h2 className='text-lg font-semibold'>待确认：{preview.label}</h2><p className='mt-2 text-sm text-muted'>可先编辑候选，再确认填入当前仍空白的位置。生成期间你新写的内容会保留。</p></div>{preview.rows.map((candidate, index) => <details key={index} open className='border-b border-border pb-4'><summary className='cursor-pointer text-sm font-medium'>{candidate.basis === 'author_edited' ? '作者已编辑的候选' : candidate.basis === 'extracted' ? '原文明确内容' : 'AI 补充建议'} · 候选 {index + 1}</summary><div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>{COLUMNS[preview.table].filter((column) => (!preview.field || column.key === preview.field) && (!preview.targetId || blank((payload[preview.table] || []).find((row: any) => row.id === preview.targetId)?.[column.key]))).map((column) => <div key={column.key} className='space-y-2'><label className='text-sm text-muted'>{column.label}</label>{fieldEditor(column, candidate.values[column.key], (value) => setPreview((current) => current ? { ...current, rows: current.rows.map((entry, entryIndex) => entryIndex === index ? { ...entry, basis: 'author_edited', values: { ...entry.values, [column.key]: value } } : entry) } : current), `候选${index + 1}${column.label}`)}</div>)}</div>{candidate.source_quotes?.length > 0 && <details className='mt-4'><summary className='cursor-pointer text-xs text-muted'>查看原文依据</summary>{candidate.source_quotes.map((quote, quoteIndex) => <blockquote key={quoteIndex} className='mt-2 text-sm leading-6 text-muted'>{quote}</blockquote>)}</details>}</details>)}<WritingReferenceNotice usage={preview.usage} /><div className='flex flex-wrap gap-2'><Button variant='primary' onClick={accept}>确认填入空白</Button><Button onClick={() => setPreview(null)}>暂不采用</Button></div></section>}
    {hasSaved && <MaterialBacklinks project={project} targetId={form.id} onOpen={onOpenMaterial} />}
    {busy && !['save', 'export'].includes(busy) && <p role='status' className='text-sm text-muted'>正在整理候选，原表内容仍可编辑…</p>}
    {message && <p role='status' className='text-sm leading-6 text-muted'>{message}</p>}
    </div>
  </div>
}
