import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Bot, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useState } from 'react'

export default function Layout({ left, center, right, header }: { left: any; center: any; right: any; header?: any }) {
  const [hideLeft, setHideLeft] = useState(false)
  return (
    <div className='h-full grid grid-cols-12 gap-3 p-3'>
      <AnimatePresence initial={false}>
        {!hideLeft && (
          <motion.aside
            key='left'
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            className='col-span-2 rounded-xl border border-border bg-panel shadow-soft panel-scroll'
          >
            <div className='flex items-center justify-between border-b border-border px-3 py-2'>
              <div className='flex items-center gap-2 font-semibold text-sm'>
                <BookOpen size={16} />
                Workbench
              </div>
              <button className='focus-ring rounded-ui p-1 hover:bg-surface-2' onClick={() => setHideLeft(true)} title='Hide sidebar'>
                <PanelLeftClose size={15} />
              </button>
            </div>
            <div className='p-3'>{left}</div>
          </motion.aside>
        )}
      </AnimatePresence>

      <main className={`${hideLeft ? 'col-span-9' : 'col-span-7'} rounded-xl border border-border bg-panel shadow-soft panel-scroll`}>
        <div className='sticky top-0 z-10 border-b border-border bg-panel/95 backdrop-blur px-4 py-2'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              {hideLeft && (
                <button className='focus-ring rounded-ui p-1 hover:bg-surface-2' onClick={() => setHideLeft(false)} title='Show sidebar'>
                  <PanelLeftOpen size={15} />
                </button>
              )}
              {header}
            </div>
            <span className='text-xs text-muted'>Product-style IDE shell</span>
          </div>
        </div>
        <div className='p-4'>{center}</div>
      </main>

      <section className='col-span-3 rounded-xl border border-border bg-panel shadow-soft panel-scroll'>
        <div className='flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-semibold'>
          <Bot size={16} />
          Agent Console
        </div>
        <div className='p-3'>{right}</div>
      </section>
    </div>
  )
}
