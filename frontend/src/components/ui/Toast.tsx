import { createContext, useContext, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type ToastItem = { id: number; text: string; tone: 'info' | 'error' }

const ToastCtx = createContext<{ push: (text: string, tone?: 'info' | 'error') => void }>({ push: () => {} })

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const api = useMemo(
    () => ({
      push(text: string, tone: 'info' | 'error' = 'info') {
        const id = Date.now() + Math.floor(Math.random() * 999)
        setItems((prev) => [...prev, { id, text, tone }])
        setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600)
      },
    }),
    []
  )

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className='fixed right-4 top-4 z-50 space-y-2'>
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`rounded-ui border px-3 py-2 text-sm shadow-soft ${t.tone === 'error' ? 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'border-border bg-panel text-text'}`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
