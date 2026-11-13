type BriefInput = {
  cards: any[]; storyId?: string; chapterId: string; chapterTitle: string;
  idea: string; direction: Record<string, string>;
}

export function buildChapterBrief({ cards, storyId, chapterId, chapterTitle, idea, direction }: BriefInput) {
  const story = cards.find((card) => card.type === 'story' && card.id === storyId) || cards.find((card) => card.type === 'story')
  const payload = story?.payload || {}
  const planning = cards.find((card) => card.payload?.planning_worksheet && card.payload.story_card_id === story?.id)
  const worksheet = planning?.payload || {}
  const atChapter = (row: any) => (row.chapter_id || row.chapter) === chapterId
  const labels = new Map(cards.map((card) => [card.id, card.payload?.name || card.title || '未命名资料']))
  const threads = new Map((worksheet.plot_threads || []).map((thread: any) => [thread.id, thread.name]))
  const beats = new Map((worksheet.beat_sheet || []).map((beat: any) => [beat.id, beat.name]))
  const lines: string[] = []
  const sources: { id: string; label: string; type: string }[] = []
  const sourceIds = new Set<string>()
  let omitted = 0
  const compact = (value: any, limit = 220) => String(Array.isArray(value) ? value.join('；') : value || '').trim().slice(0, limit)
  const addSource = (owner: any, table: string, row: any, index: number, type: string, prefix = '') => {
    const id = `${owner.id}:${table}:${row.id || (table === 'important_scenes' ? `index_${index}` : index)}`
    if (sourceIds.has(id)) return
    sourceIds.add(id)
    sources.push({ id, label: `${prefix}${row.scene || row.title || row.name || labels.get(row.character_id) || '相关策划'}`, type })
  }
  const resolve = (owner: any, row: any, index: number, seen = new Set<string>()): any => {
    const id = `${owner.id}:important_scenes:${row.id || `index_${index}`}`
    if (seen.has(id)) return null
    if (!row.canonical_event_ref) return { owner, row, index, id }
    const nextSeen = new Set(seen); nextSeen.add(id)
    const ref = row.canonical_event_ref
    const target = cards.find((card) => card.id === ref.owner_card_id)
    const targetIndex = (target?.payload?.important_scenes || []).findIndex((item: any, i: number) => item.id === ref.scene_id || !item.id && [String(i), `index_${i}`].includes(ref.scene_id))
    if (!target || targetIndex < 0) return null
    const original = resolve(target, target.payload.important_scenes[targetIndex], targetIndex, nextSeen)
    return original ? { ...original, row: { ...original.row, ...Object.fromEntries(['chapter', 'thread_id', 'beat_id', 'notes'].filter((key) => Object.prototype.hasOwnProperty.call(row, key)).map((key) => [key, row[key]])) } } : null
  }
  for (const [index, row] of (payload.chapter_plan || []).entries()) {
    if (!atChapter(row)) continue
    const content = ['focus', 'key_events', 'conflict', 'result', 'stage_result'].map((key) => compact(row[key], 100)).filter(Boolean).join('；')
    addSource(story, 'chapter_plan', row, index, 'chapter_plan')
    if (content && lines.length < 2) lines.push(`本章计划：${compact(content)}`)
    else if (content) omitted++
  }
  const seenScenes = new Set<string>()
  const relatedSceneIds = new Set<string>()
  let missingSource = false
  let sceneCount = 0
  // Projection rows keep their chapter / thread / beat / notes, while event content comes from the original.
  for (const owner of [planning, story].filter(Boolean)) for (const [index, row] of (owner.payload.important_scenes || []).entries()) {
    const original = resolve(owner, row, index)
    if (!original) { if (atChapter(row)) { addSource(owner, 'important_scenes', row, index, 'scene'); missingSource = true; omitted++ }; continue }
    if (!atChapter(original.row)) continue
    relatedSceneIds.add(row.id || `index_${index}`); relatedSceneIds.add(original.row.id || `index_${original.index}`)
    addSource(original.owner, 'important_scenes', original.row, original.index, 'scene')
    if (row.canonical_event_ref) addSource(owner, 'important_scenes', row, index, 'scene', '本表编排：')
    if (seenScenes.has(original.id)) continue
    seenScenes.add(original.id)
    if (++sceneCount > 4) { omitted++; continue }
    const current = original.row
    const goal = compact(current.purpose || current.goal || current.plot)
    if (current.scene || goal) lines.push(`场景目标：${[compact(current.scene, 60), goal].filter(Boolean).join('；')}`)
    const local = [current.thread_id ? threads.get(current.thread_id) || '已关联故事线' : '', current.beat_id ? beats.get(current.beat_id) || '已关联节拍' : '', compact(current.notes, 120)].filter(Boolean)
    if (local.length) lines.push(`本表编排：${local.join('；')}`)
  }
  const related = (row: any) => atChapter(row) || (!row.chapter && !row.chapter_id && (relatedSceneIds.has(row.scene_id) || row.scene_ids?.some((id: string) => relatedSceneIds.has(id))))
  for (const [owner, table, type] of [[story, 'open_line', 'open_line'], [story, 'hidden_line', 'hidden_line'], [story, 'foreshadowings', 'foreshadowing'], [planning, 'character_intersections', 'character_intersection'], [planning, 'character_storylines', 'character_storyline'], [planning, 'beat_sheet', 'beat']] as const) {
    if (!owner || table === 'beat_sheet' && !worksheet.beat_sheet_enabled) continue
    for (const [index, row] of (owner.payload[table] || []).entries()) {
      if (!(table === 'foreshadowings' ? row.first_chapter === chapterId || row.payoff_chapter === chapterId : related(row))) continue
      addSource(owner, table, row, index, type); omitted++
    }
  }
  if (missingSource) lines.push('部分同源场景的原资料未能读取，请到工作表核对；不采用旧副本。')
  const hasContent = Boolean(lines.length || sources.length || idea.trim() || Object.values(direction).some((value) => typeof value === 'string' && value.trim()))
  if (idea.trim()) lines.push(`本章补充与变化：${idea.trim()}`)
  for (const [key, label] of Object.entries({ perception: '感知重点', reader_feeling: '读者感受', dramatic_function: '段落作用', shots: '参考画面', setting: '场景氛围', motivation: '人物动机', performance: '动作与表情', focus: '描写焦点', atmosphere: '环境烘托' })) {
    if (direction[key]?.trim()) lines.push(`${label}：${direction[key].trim()}`)
  }
  return {
    text: hasContent ? [`本章：${chapterTitle || '当前章节'}`, ...lines, '读取适用于本故事分支和发生时间的已确认设定；未确认或未来的计划，不作为已发生事实或人物已知。未确定的内容保留未知。'].join('\n') : '',
    sources, omitted, hasContent,
  }
}

export function chapterAgreement(agreed: string, previousBrief: string, confirmed: boolean, currentBrief: string, editing = false) {
  if (editing) return agreed
  return agreed.trim() && (confirmed || agreed !== previousBrief) ? agreed : currentBrief
}
