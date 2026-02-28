import { motion, AnimatePresence } from 'framer-motion'
import { Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { CommandItem } from './commandIndex'
import { useCommandPalette } from './useCommandPalette'

export function CommandPalette({
  items,
  onOpen,
  resolveCreateCommand,
}: {
  items: CommandItem[]
  onOpen?: () => Promise<void> | void
  resolveCreateCommand?: (query: string) => { item?: CommandItem; error?: string } | null
}) {
  const {
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
  } = useCommandPalette(items)
  const panelRef = useRef<HTMLDivElement>(null)

  const createResolved = useMemo(() => resolveCreateCommand?.(query) || null, [resolveCreateCommand, query])
  const mergedItems = useMemo(() => {
    if (!createResolved?.item) return visibleItems
    return [createResolved.item, ...visibleItems]
  }, [createResolved, visibleItems])

  const requestOpen = async () => {
    if (!open) await onOpen?.()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const el = panelRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = el.querySelectorAll<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        onClick={requestOpen}
        className='rounded-ui border border-border bg-surface px-2 py-1 text-xs text-muted hover:bg-surface-2'
        title='Open command palette'
      >
        ⌘K / Ctrl+K
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className='fixed inset-0 z-50'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setOpen(false)}
          >
            <div className='absolute inset-0 bg-black/35 backdrop-blur-[1px]' />

            <motion.div
              ref={panelRef}
              role='dialog'
              aria-modal='true'
              aria-label='Command Palette'
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              onMouseDown={(e) => e.stopPropagation()}
              className='absolute left-1/2 top-[12%] w-[min(760px,92vw)] -translate-x-1/2 rounded-xl border border-border bg-panel shadow-soft'
            >
              <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
                <Search size={16} className='text-muted' />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => onKeyDown(e, mergedItems)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  placeholder='Search commands…  (>, @, #, ?, + create)'
                  className='focus-ring w-full bg-transparent text-sm outline-none'
                  aria-activedescendant={mergedItems[activeIndex]?.id}
                />
                <kbd className='rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted'>Esc</kbd>
              </div>

              {createResolved?.error && (
                <div className='flex items-center gap-2 border-b border-border bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300'>
                  <Sparkles size={13} />
                  {createResolved.error}
                </div>
              )}

              <div className='max-h-[56vh] overflow-auto p-2'>
                {!mergedItems.length && <div className='rounded-ui px-3 py-8 text-center text-sm text-muted'>No matching commands.</div>}
                {mergedItems.map((item, i) => {
                  const Icon = item.icon
                  const active = i === activeIndex
                  return (
                    <button
                      id={item.id}
                      key={item.id}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => {
                        item.run()
                        setOpen(false)
                      }}
                      className={`w-full rounded-ui px-3 py-2 text-left ${active ? 'bg-indigo-50 dark:bg-indigo-900/25' : 'hover:bg-surface-2'}`}
                    >
                      <div className='flex items-center gap-2 text-sm'>
                        {Icon && <Icon size={15} className='text-muted' />}
                        <span className='font-medium'>{item.title}</span>
                        <span className='ml-auto text-[10px] uppercase tracking-wide text-muted'>{item.group}</span>
                      </div>
                      {item.subtitle && <div className='ml-7 text-xs text-muted'>{item.subtitle}</div>}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
