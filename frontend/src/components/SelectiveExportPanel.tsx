import { useEffect, useId, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { MATERIAL_TYPES, OpenMaterial } from './MaterialReferences'
import { isIncompleteReference } from '../lib/writingReferences'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Fields'

export function SelectiveExportPanel({ project, projectTitle, onOpen }: { project: string; projectTitle: string; onOpen?: OpenMaterial }) {
  const { data, mutate } = useSWR(project ? `/api/projects/${project}/materials` : null, api.get)
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [detail, setDetail] = useState<'summary' | 'full'>('summary')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const controlId = useId()
  useEffect(() => { setSelected([]); setQuery(''); setKind('all'); setMessage('') }, [project])
  const rows: any[] = (Array.isArray(data) ? data : []).filter((row: any) => !isIncompleteReference({ title: row.label }))
  const visible = rows.filter((row) => (kind === 'all' || row.type === kind) && `${row.label || ''} ${row.summary || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string) => {
    setMessage('')
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : current.length >= 100 ? current : [...current, id])
  }
  const download = async () => {
    if (!selected.length || selected.length > 100) { setMessage('请先选择 1 至 100 项资料。'); return }
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/projects/${project}/selective-export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: selected.map((id) => ({ id })), detail }) })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.detail === 'string' ? result.detail : '导出失败，请减少条目或检查所选资料后重试。') }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = url; link.download = `${(projectTitle || '作品').replace(/[\\/\u0000-\u001f]/g, '_')}-选定资料.md`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('已下载所选作者资料与来源。导出使用保存版，不改变原资料。')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '导出失败，请重试。') }
    finally { setBusy(false) }
  }
  return <section className='space-y-6' aria-label='导出选定资料'>
    <header><h1 className='text-2xl font-semibold'>导出选定资料</h1><p className='mt-2 max-w-[65ch] text-sm leading-7 text-muted'>只带走这次需要的人物、世界、情节或章节。读取最新保存版，保留来源；不用导出整本作品。</p></header>
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_180px]'><div><label htmlFor={`${controlId}-query`} className='mb-1 block text-sm text-muted'>按名称查找</label><Input id={`${controlId}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder='搜索要导出的资料…' /></div><div><label htmlFor={`${controlId}-type`} className='mb-1 block text-sm text-muted'>资料类型</label><Select id={`${controlId}-type`} value={kind} onChange={(event) => setKind(event.target.value)}><option value='all'>全部类型</option>{[...new Set(rows.map((row) => row.type))].map((type) => <option key={type} value={type}>{MATERIAL_TYPES[type] || '其他资料'}</option>)}</Select></div></div>
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_220px]'>
      <div className='space-y-3'><div className='flex items-center justify-between gap-2'><h2 className='text-sm font-medium'>勾选需要的资料</h2><span className='text-xs text-muted' aria-live='polite'>已选 {selected.length} / 100 项</span></div><div className='max-h-[480px] divide-y divide-border overflow-auto border-y border-border'>{visible.map((row) => <label key={row.id} className='flex cursor-pointer items-start gap-3 py-3'><input className='mt-1' type='checkbox' checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 100} onChange={() => toggle(row.id)} /><span className='min-w-0 flex-1'><span className='block text-sm'>{row.label || '未命名资料'}</span><span className='mt-1 block text-xs text-muted'>{MATERIAL_TYPES[row.type] || '资料'}</span></span></label>)}</div>{data?.detail ? <div className='space-y-2'><p className='text-sm text-muted'>资料目录读取失败，请重试。</p><Button onClick={() => mutate()}>重新读取</Button></div> : !data ? <p className='text-sm text-muted'>正在读取资料目录…</p> : !visible.length && <p className='text-sm text-muted'>没有匹配的资料，试试其他名称或类型。</p>}{selected.length >= 100 && <p className='text-xs text-muted'>已达到本次上限，取消部分勾选后可以换选其他资料。</p>}</div>
      <aside className='space-y-3' aria-label='已选导出条目'><div className='flex items-center justify-between gap-2'><h2 className='text-sm font-medium'>本次导出</h2><Button variant='ghost' className='text-xs' disabled={!selected.length || busy} onClick={() => setSelected([])}>清空选择</Button></div>{selected.length ? <ul className='max-h-80 divide-y divide-border overflow-auto'>{selected.map((id) => { const row = rows.find((entry) => entry.id === id); return <li key={id} className='flex items-start justify-between gap-2 py-2'><div className='min-w-0'>{row && onOpen ? <button className='text-left text-sm text-brand-600 hover:underline focus-ring' onClick={() => onOpen(row)}>{row.label || '未命名资料'}</button> : <span className='text-sm'>{row?.label || '原资料暂时不可用'}</span>}</div><Button variant='ghost' className='shrink-0 text-xs' onClick={() => toggle(id)}>取消</Button></li> })}</ul> : <p className='text-sm text-muted'>从左侧勾选，所选条目会列在这里。</p>}</aside>
    </div>
    <fieldset className='space-y-3 border-t border-border pt-4'><legend className='pr-3 text-sm font-medium'>导出详略</legend><div className='flex flex-wrap gap-5'><label className='flex items-center gap-2 text-sm'><input type='radio' name={`${controlId}-detail`} checked={detail === 'summary'} onChange={() => setDetail('summary')} />摘要摘录</label><label className='flex items-center gap-2 text-sm'><input type='radio' name={`${controlId}-detail`} checked={detail === 'full'} onChange={() => setDetail('full')} />所选资料全文</label></div><p className='text-xs leading-6 text-muted'>摘要为本地摘录，不额外调用模型；全文只包含勾选条目与来源，不会自动加入所有关联资料。导出为 Markdown 文本。</p></fieldset>
    <Button variant='primary' disabled={busy || !selected.length} onClick={download}>{busy ? '正在导出…' : '下载选定资料'}</Button>
    {message && <p role='status' className='text-sm leading-6 text-muted'>{message}</p>}
  </section>
}
