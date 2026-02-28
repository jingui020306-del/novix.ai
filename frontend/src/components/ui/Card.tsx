import { ReactNode } from 'react'

export function Card({ title, extra, children, className = '' }: { title?: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-panel shadow-soft ${className}`}>
      {(title || extra) && (
        <div className='flex items-center justify-between border-b border-border px-4 py-2'>
          <h3 className='text-sm font-semibold'>{title}</h3>
          {extra}
        </div>
      )}
      <div className='p-4'>{children}</div>
    </div>
  )
}
