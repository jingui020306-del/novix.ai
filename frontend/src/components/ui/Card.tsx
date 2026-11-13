import { ReactNode } from 'react'

export function Card({ title, extra, children, className = '' }: { title?: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`content-section ${className}`}>
    {(title || extra) && <header className='content-section-heading'>{title && <h3>{title}</h3>}{extra && <div className='section-actions'>{extra}</div>}</header>}
    <div className='content-section-body'>{children}</div>
  </section>
}
