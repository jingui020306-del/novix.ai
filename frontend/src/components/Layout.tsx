import { BookOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function Layout({ left, center, right, header, surface = '', navigationKey, inspectorTitle = '材料与检查' }: { left: any; center: any; right: any; header?: any; surface?: string; navigationKey?: string; inspectorTitle?: string }) {
  const [hideLeft, setHideLeft] = useState(() => window.innerWidth < 900)
  const writing = surface === 'chapter' && inspectorTitle === '本章技法'
  const [toolsHidden, setToolsHidden] = useState(true)
  const [techniquesHidden, setTechniquesHidden] = useState(() => {
    const saved = localStorage.getItem('novix.writing.hideTechniques')
    return saved !== 'false'
  })
  const hideRight = writing ? techniquesHidden : toolsHidden
  const setHideRight = (hidden: boolean) => {
    if (writing) {setTechniquesHidden(hidden);localStorage.setItem('novix.writing.hideTechniques', String(hidden))}
    else setToolsHidden(hidden)
  }
  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)')
    const resize = () => setHideLeft(media.matches)
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (window.innerWidth < 900) setHideLeft(true)
  }, [navigationKey])
  return (
    <div className={`author-workspace surface-${surface}`} onKeyDown={(e) => { if (e.key === 'Escape') { if (window.innerWidth < 900) setHideLeft(true); setHideRight(true) } }}>
      {!hideLeft && <>
        <button className='sidebar-scrim' aria-label='关闭作品目录' onClick={() => setHideLeft(true)} />
        <aside className='workspace-sidebar' aria-label='作品目录'>
          <div className='workspace-brand'><span><BookOpen size={21} strokeWidth={1.6} /><strong>novix</strong><span className='brand-description'>写作工作台</span></span><button className='icon-control' onClick={() => setHideLeft(true)} aria-label='收起作品目录'><PanelLeftClose size={17} /></button></div>
          <div className='workspace-sidebar-body' onClick={(event) => {
            if (window.innerWidth < 900 && (event.target as Element).closest('.sidebar-nav-item')) setHideLeft(true)
          }}>{left}</div>
        </aside>
      </>}
      <main className='workspace-main'>
        <div className='workspace-topbar'>
          <div className='workspace-location'>{hideLeft && <button className='toolbar-control' onClick={() => setHideLeft(false)}><PanelLeftOpen size={16} /><span>目录</span></button>}{header}</div>
          <button className='toolbar-control workspace-inspector-toggle' onClick={() => setHideRight(!hideRight)} aria-expanded={!hideRight} aria-label={inspectorTitle}>{hideRight ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}<span>{inspectorTitle}</span></button>
        </div>
        <div className='workspace-page'>{center}</div>
      </main>
      {!hideRight && <aside className='workspace-inspector' aria-label={inspectorTitle}>
        <div className='inspector-heading'><strong>{inspectorTitle}</strong><button className='icon-control' onClick={() => setHideRight(true)} aria-label={`收起${inspectorTitle}`}><PanelRightClose size={17} /></button></div>
        <div className='inspector-content'>{right}</div>
      </aside>}
    </div>
  )
}
