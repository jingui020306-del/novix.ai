import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useSWR from 'swr'
import { api } from '../api/client'
import { isIncompleteReference, referenceDescription, referenceLabel } from '../lib/writingReferences'
import { Button } from './ui/Button'
import { Input } from './ui/Fields'
import type { OpenMaterial } from './MaterialReferences'

export function WritingReferencePanel({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const origin = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current() } }
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('keydown', escape, true); if (origin?.isConnected) origin.focus() }
  }, [open])
  return open ? createPortal(<aside className='writing-reference-panel' aria-label={title}><header><h2>{title}</h2><button ref={closeButton} className='icon-control' aria-label={`关闭${title}`} onClick={onClose}><X size={18} /></button></header><div className='writing-reference-panel-body'>{children}</div></aside>, document.body) : null
}

function ReferenceDetails({ card, includeDescription = true }: { card: any; includeDescription?: boolean }) {
  const payload = card.payload || {}
  const sections = [
    ['怎么使用', payload.apply_steps], ['检查哪些内容', payload.check_rules],
    ['建议这样写', payload.do_dont?.do], ['避免这样写', payload.do_dont?.dont],
  ].map(([label, values]) => ({ label: String(label), values: Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : [] })).filter((section) => section.values.length)
  const examples = (Array.isArray(payload.examples) ? payload.examples : []).flatMap((example: any) => typeof example === 'string' ? [example] : [example?.text, example?.before && `原句：${example.before}`, example?.after && `改后：${example.after}`, example?.explanation].filter((value) => typeof value === 'string' && value.trim()))
  return <div className='space-y-3 text-xs leading-6 text-muted'>
    {includeDescription && referenceDescription(card) && <p>{referenceDescription(card)}</p>}
    {sections.map((section) => <div key={section.label}><h4 className='font-medium text-text'>{section.label}</h4><ul className='mt-1 list-disc space-y-1 pl-4'>{section.values.map((value: string, index: number) => <li key={index}>{value}</li>)}</ul></div>)}
    {examples.length > 0 && <div><h4 className='font-medium text-text'>写法示例</h4>{examples.map((example: string, index: number) => <p key={index} className='mt-1 whitespace-pre-wrap'>{example}</p>)}</div>}
    {!sections.length && !examples.length && (!includeDescription || !referenceDescription(card)) && <p>暂时没有更详细的说明。</p>}
  </div>
}

export function WritingReferencePicker({ project, value, onChange, onOpen, techniquesOnly = false, saveHint = '选择后请保存当前内容，后续写作才会使用这些参考。' }: {
  project: string; value: string[]; onChange: (ids: string[]) => void; saveHint?: string; onOpen?: OpenMaterial; techniquesOnly?: boolean;
}) {
  const { data: techniques, error: techniqueError, mutate: refreshTechniques } = useSWR(project ? `/api/projects/${project}/cards?type=technique` : null, api.get)
  const { data: tools, error: toolError, mutate: refreshTools } = useSWR(project && !techniquesOnly ? `/api/projects/${project}/cards?type=tool_skill` : null, api.get)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const id = useId()
  const all = [...(Array.isArray(techniques) ? techniques : []), ...(!techniquesOnly && Array.isArray(tools) ? tools : [])]
  const selected = Array.isArray(value) ? value : []
  const legacyTools = selected.filter((referenceId) => all.some((card) => card.id === referenceId && card.type === 'tool_skill'))
  const literaryIds = selected.filter((referenceId) => !legacyTools.includes(referenceId))
  const available = (Array.isArray(techniques) ? techniques : []).filter((card) => !isIncompleteReference(card))
  const candidates = available.filter((card) => !selected.includes(card.id) && `${referenceLabel(card)} ${referenceDescription(card)}`.toLowerCase().includes(query.trim().toLowerCase()))
  const failed = techniqueError || techniques?.detail
  const loading = project && !techniques && !failed
  const entry = (card: any, label: string) => <details><summary className='cursor-pointer text-sm font-medium text-brand-600'>{label}{referenceDescription(card) && <p className='mt-1 text-xs font-normal leading-5 text-muted'>{referenceDescription(card)}</p>}</summary><div className='mt-3'><ReferenceDetails card={card} includeDescription={false} />{onOpen && <Button variant='ghost' className='mt-2 text-xs' aria-label={`编辑原参考：${label}`} onClick={() => onOpen(card)}>编辑原条目</Button>}</div></details>
  const selectedEntry = (referenceId: string) => {
    const card = all.find((row) => row.id === referenceId)
    const label = referenceLabel(card, referenceId)
    return <li key={referenceId} className='flex items-start justify-between gap-3 py-3 text-sm'><div className='min-w-0 flex-1'>{card ? entry(card, label) : <><span>{loading ? '正在读取参考…' : label}</span>{!loading && <p className='mt-1 text-xs text-muted'>当前无法读取原条目，可移除后重新选择。</p>}</>}</div><Button variant='ghost' className='shrink-0 text-xs' aria-label={`移除${label}`} onClick={() => onChange(selected.filter((entry) => entry !== referenceId))}>移除</Button></li>
  }
  return <section className='space-y-3 border-t border-border pt-4' aria-label='选用写作参考'>
    <div className='flex flex-wrap items-baseline justify-between gap-2'><h3 className='text-sm font-medium'>文学技法</h3><span className='text-xs text-muted' aria-live='polite'>{literaryIds.length ? `已选 ${literaryIds.length} 项` : '可选，按当前内容需要添加'}</span></div>
    {literaryIds.length ? <ul className='divide-y divide-border'>{literaryIds.map(selectedEntry)}</ul> : <p className='text-sm text-muted'>先把故事写出来，需要时再选用写法。</p>}
    <Button className='text-xs' aria-expanded={adding} aria-controls={`${id}-choices`} disabled={!project} onClick={() => setAdding(!adding)}>{adding ? '收起技法选择' : '添加文学技法'}</Button>
    {!project && <p className='text-xs text-muted'>请先选择作品，再添加技法。</p>}
    {adding && <div id={`${id}-choices`} className='space-y-3 border-t border-border pt-3'>
      <div><label htmlFor={`${id}-query`} className='mb-1 block text-xs text-muted'>搜索技法名称或用途</label><Input id={`${id}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder='例如：对话、描写、冲突…' /></div>
      <div className='max-h-72 divide-y divide-border overflow-auto'>{candidates.map((card) => <div key={card.id} className='flex items-start justify-between gap-3 py-3'><div className='min-w-0 flex-1'>{entry(card, referenceLabel(card))}</div><Button className='shrink-0 text-xs' aria-label={`选择${referenceLabel(card)}`} onClick={() => onChange([...selected, card.id])}>选用</Button></div>)}</div>
      {failed ? <div role='alert' className='space-y-2'><p className='text-sm text-muted'>技法未能完整载入，可以重新读取。</p><Button className='text-xs' onClick={() => { void refreshTechniques() }}>重新读取技法</Button></div> : loading ? <p role='status' className='text-sm text-muted'>正在读取技法…</p> : !candidates.length && <p className='text-sm text-muted'>{!available.length ? '还没有可用技法，不影响你先构思和写作。' : query.trim() ? '没有匹配的技法，试试其他关键词。' : '可用技法已在上方选用列表中。'}</p>}
    </div>}
    {legacyTools.length > 0 && <details className='border-t border-border pt-3'><summary className='cursor-pointer text-xs text-muted'>旧工具引用（兼容保留 {legacyTools.length} 项）</summary><p className='mt-3 text-xs leading-6 text-muted'>以前的选择仍保留，可查看或移除。引用工具说明不等于执行检查；检查正文、伏笔核对等请使用对应任务入口。</p><ul className='divide-y divide-border'>{legacyTools.map(selectedEntry)}</ul></details>}
    {!techniquesOnly && (toolError || tools?.detail) && <details><summary className='cursor-pointer text-xs text-muted'>旧工具资料暂未读到</summary><p className='my-2 text-xs text-muted'>原关联没有删除，可重新读取兼容资料。</p><Button className='text-xs' onClick={() => { void refreshTools() }}>重新读取旧资料</Button></details>}
    <p className='text-xs leading-5 text-muted'>{saveHint}</p>
  </section>
}

export function WritingReferenceNotice({ usage }: { usage: any }) {
  const omitted = Array.isArray(usage?.omitted) ? usage.omitted : []
  const total = usage?.omitted_count ?? omitted.length
  if (!total) return null
  const unlisted = Math.max(0, total - omitted.length)
  return <div role='status' className='space-y-1 text-xs leading-5 text-muted'><p>本次有 {total} 项参考未采用。</p>{omitted.length > 0 && <ul>{omitted.map((item: any, index: number) => <li key={`${item.id}:${index}`}>{item.title && !/^[a-z][\w:.-]*$/i.test(item.title) ? referenceLabel({ title: item.title }) : '所选参考'}：{item.reason || '未能读取，请重新选择。'}</li>)}</ul>}{unlisted > 0 && <p>还有 {unlisted} 项未列出原因，请减少选用或检查参考。</p>}</div>
}
