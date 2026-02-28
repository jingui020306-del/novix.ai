import { LucideIcon, Bolt, FileText, Globe, Settings, UserRound, Wand2 } from 'lucide-react'

export type CommandGroup = 'Navigate' | 'Actions' | 'Help'

export type CommandItem = {
  id: string
  title: string
  subtitle?: string
  group: CommandGroup
  icon?: LucideIcon
  keywords?: string[]
  payload?: Record<string, any>
  run: () => void
}

export function baseHelpCommands(onClose: () => void): CommandItem[] {
  return [
    { id: 'help-shortcuts', title: '快捷键帮助', subtitle: '⌘K/Ctrl+K 打开，Esc 关闭，↑/↓ 导航，Enter 执行', group: 'Help', icon: Bolt, run: onClose },
    { id: 'help-prefix-actions', title: '前缀 > 仅显示 Actions', group: 'Help', icon: Bolt, run: onClose },
    { id: 'help-prefix-char', title: '前缀 @ 仅显示 Characters', group: 'Help', icon: UserRound, run: onClose },
    { id: 'help-prefix-chapter', title: '前缀 # 仅显示 Chapters', group: 'Help', icon: FileText, run: onClose },
    { id: 'help-prefix-help', title: '前缀 ? 显示帮助', group: 'Help', icon: Settings, run: onClose },
    { id: 'help-prefix-create', title: '前缀 + 或 create 进入创建模式', subtitle: '+ character Alice --tag 主角', group: 'Help', icon: Bolt, run: onClose },
  ]
}

export function buildSearchText(item: CommandItem): string {
  return [item.title, item.subtitle || '', ...(item.keywords || [])].join(' ').toLowerCase()
}

function scoreOne(item: CommandItem, rawQ: string): number {
  const query = rawQ.trim().toLowerCase()
  if (!query) return 1
  const hay = buildSearchText(item)
  if (hay.startsWith(query)) return 140
  if (hay.includes(query)) return 95

  const parts = query.split(/\s+/).filter(Boolean)
  if (!parts.length) return 1

  let score = 0
  for (const p of parts) {
    if (hay.startsWith(p)) score += 30
    else if (hay.includes(p)) score += 16
    else {
      // fuzzy-ish ordered chars
      let i = 0
      for (const ch of hay) {
        if (ch === p[i]) i += 1
        if (i >= p.length) break
      }
      if (i >= Math.max(2, Math.floor(p.length * 0.6))) score += 8
      else score -= 12
    }
  }
  return score
}

export function filterAndRank(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim()
  if (q === '?') return items.filter((x) => x.group === 'Help')

  let work = items
  let payloadQ = q
  if (q.startsWith('>')) {
    work = work.filter((x) => x.group === 'Actions')
    payloadQ = q.slice(1).trim()
  } else if (q.startsWith('@')) {
    work = work.filter((x) => (x.payload?.kind || '') === 'character')
    payloadQ = q.slice(1).trim()
  } else if (q.startsWith('#')) {
    work = work.filter((x) => (x.payload?.kind || '') === 'chapter')
    payloadQ = q.slice(1).trim()
  }

  return work
    .map((item) => ({ item, s: scoreOne(item, payloadQ) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item)
}

export function iconForKind(kind: string): LucideIcon {
  if (kind === 'character') return UserRound
  if (kind === 'world') return Globe
  if (kind === 'style') return Wand2
  if (kind === 'chapter') return FileText
  return Settings
}
