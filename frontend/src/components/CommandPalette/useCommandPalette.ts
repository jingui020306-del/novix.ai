import { useEffect, useMemo, useRef, useState } from 'react'
import { CommandItem, filterAndRank } from './commandIndex'

export function useCommandPalette(allItems: CommandItem[]) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const visibleItems = useMemo(() => filterAndRank(allItems, query), [allItems, query])

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
