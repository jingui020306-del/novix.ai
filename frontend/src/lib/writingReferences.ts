export const isIncompleteReference = (card: any) => [card?.title, card?.payload?.name].some((value) => /^[a-z]+_扩展技法_\d+$/i.test(String(value || '')))

export const referenceLabel = (card: any, fallbackId = '') => {
  const raw = String(card?.title || card?.payload?.name || '')
  if (isIncompleteReference(card) || /^[a-z]+_扩展技法_\d+$/i.test(raw || fallbackId)) {
    const number = (raw || fallbackId).match(/_(\d+)$/)?.[1]
    return `待完善技法${number ? `（${number}）` : ''}`
  }
  return raw || (card?.type === 'tool_skill' ? '未命名写作工具' : '未找到的参考（保留关联）')
}

export const referenceDescription = (card: any) => {
  const description = String(card?.payload?.description || card?.payload?.purpose || '')
  return /出现.*可观察信号/.test(description) ? '' : description
}

export const chapterReferenceIds = (meta: any): string[] => [...new Set<string>([
  ...(Array.isArray(meta?.pinned_techniques) ? meta.pinned_techniques.map((row: any) => row.technique_id) : []),
  ...(Array.isArray(meta?.tool_skill_ids) ? meta.tool_skill_ids : []),
].filter((id) => typeof id === 'string' && id))]

export const mergeReferenceSelection = (latest: string[], base: string[], selected: string[]) => {
  const removed = new Set(base.filter((id) => !selected.includes(id)))
  return [...new Set([...latest.filter((id) => !removed.has(id)), ...selected.filter((id) => !base.includes(id))])]
}
