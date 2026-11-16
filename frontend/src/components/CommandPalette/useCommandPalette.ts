import { useEffect, useMemo, useRef, useState } from 'react'
import { CommandItem, filterAndRank } from './commandIndex'

type RecentCommand = Pick<CommandItem, 'id' | 'title' | 'subtitle' | 'group'>
const historyKey = 'novix.palette.mru.v1'
const historyLimit = 20

function loadRecentCommands(): RecentCommand[] {
  try {
    const rows = JSON.parse(localStorage.getItem(historyKey) || '[]')
    return Array.isArray(rows) ? rows.filter(row => typeof row?.id === 'string').slice(0, historyLimit) : []
  } catch {
    return []
  }
}

export function useCommandPalette(allItems: CommandItem[]) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [recent, setRecent] = useState(loadRecentCommands)
  const itemsWithHistory = useMemo(() => {
    const commands = allItems.map(item => {
      if (item.group !== 'Navigate') return item
      const run = () => {
        item.run()
        const { id, title, subtitle, group } = item
        const next = [{ id, title, subtitle, group }, ...recent.filter(row => row.id !== id)].slice(0, historyLimit)
        setRecent(next)
        localStorage.setItem(historyKey, JSON.stringify(next))
      }
      return { ...item, run }
    })
    const shortcuts = recent.flatMap(row => {
      const item = commands.find(command => command.id === row.id)
      return item ? [{ ...item, id: `mru-${item.id}`, title: `[Recent] ${item.title}` }] : []
    })
    return [...shortcuts, ...commands]
  }, [allItems, recent])

  const visibleItems = useMemo(() => filterAndRank(itemsWithHistory, query), [itemsWithHistory, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isToggle = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)
      if (isToggle) {
        e.preventDefault()
        setOpen((x) => !x)
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 10)
    return () => clearTimeout(t)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent, list: CommandItem[]) => {
    if (isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((x) => Math.min(list.length - 1, x + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((x) => Math.max(0, x - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = list[activeIndex]
      if (!cmd) return
      cmd.run()
      if (!(e.metaKey || e.ctrlKey)) {
        setOpen(false)
      }
    }
  }

  return {
    open,
    setOpen,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    inputRef,
    onKeyDown,
    visibleItems,
    setIsComposing,
  }
}
