// Choices keep the server's explicit identity; a shared title is never a merge rule.
export function canonicalEvents(input: any): any[] {
  const groups = new Map<string, any>()
  for (const row of Array.isArray(input) ? input : []) {
    const key = row.canonical_id || row.id || `${row.owner_card_id}:important_scenes:${row.scene_id}`
    const parts = String(key).split(':important_scenes:')
    const reference = parts.length === 2 ? { owner_card_id: parts[0], scene_id: parts[1] } : { owner_card_id: row.owner_card_id, scene_id: row.scene_id }
    const previous = groups.get(key)
    const alias = `${row.owner_card_id}:${row.scene_id}`
    groups.set(key, { ...row, ...reference, id: key, canonical_id: key, values: row.effective_values || row.shared_values || row.values || {}, sources: [...(previous?.sources || []), ...(row.sources || [])], choice_refs: [...new Set([...(previous?.choice_refs || []), alias, `${reference.owner_card_id}:${reference.scene_id}`])] })
  }
  return [...groups.values()]
}
export function eventChoiceValue(rows: any[], ref: any): string {
  if (!ref) return ''
  const key = `${ref.owner_card_id}:${ref.scene_id}`
  const event = rows.find((row) => row.choice_refs?.includes(key))
  return event ? `${event.owner_card_id}:${event.scene_id}` : key
}
export function rootWorlds(cards: any): any[] {
  return (Array.isArray(cards) ? cards : []).filter((card: any) => {
    if (!['world', 'worldview', 'world_rule', 'lore'].includes(card.type)) return false
    const p = card.payload || {}, kind = p.entry_type
    if (['world', '世界', '世界简介', '世界总览'].includes(kind)) return true
    if (kind || p.parent_id || p.direction) return false
    return p.world_context?.world_id === card.id || Boolean(p.library_source?.id && p.library_source?.source_world_id) || Boolean(p.era || p.setting || p.world_base || p.extra_context?.world_base)
  })
}

export const WORLD_ENTRY_TYPES = ['地点', '生物与族群', '人物与组织', '规则与能力', '历史事件', '科技', '文化', '原创设定']
export const WORLD_ENTRY_LABELS: Record<string, string> = { place: '地点', region: '地点', location: '地点', organization: '人物与组织', faction: '人物与组织', rule: '规则与能力', ability: '规则与能力', period: '历史事件', history: '历史事件', reference: '参考资料', letter: '信件', rules: '规则与能力' }
