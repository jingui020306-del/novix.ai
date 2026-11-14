import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { MaterialImportWorkspace } from './MaterialImportWorkspace'
import { CardEditor } from './CardEditor'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Fields'

const CATEGORIES: Record<string, string> = { sentinel: '哨兵', xianxia: '修仙', modern: '现代', space: '星际文明', fantasy: '西幻' }
export function WorldLibrary({ project, worldId, worldRevision, dirty = false, expanded = false, onChanged, onOpenWorld }: { project: string; worldId?: string; worldRevision?: string; dirty?: boolean; expanded?: boolean; onChanged: () => void; onOpenWorld: (id: string) => void }) {
  const { data, error, mutate } = useSWR('/api/world-library', api.get)
  const [category, setCategory] = useState('all')
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [personalProject, setPersonalProject] = useState('')
  const [title, setTitle] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [diff, setDiff] = useState<any>(null)
  const [adopted, setAdopted] = useState<{ signature: string; worldId: string } | null>(null)
  const { data: manifest, error: detailError } = useSWR(selected ? `/api/world-library/${encodeURIComponent(selected)}` : null, api.get)
  const active = useRef(project); active.current = project
  const selectedRef = useRef(selected); selectedRef.current = selected
  useEffect(() => { active.current = project; return () => { active.current = '' } }, [project])
  const requests = useRef(new Map<string, string>())
  const initialized = useRef('')
  const rows = Array.isArray(data?.items) ? data.items : []
  const item = rows.find((row: any) => row.id === selected)
  const privateItem = rows.find((row: any) => row.library_project_id === personalProject)
  const cards = Array.isArray(manifest?.cards) ? manifest.cards : []
  useEffect(() => { setSelected(''); setPersonalProject(''); setMessage(''); setBusy(''); setDiff(null); setAdopted(null) }, [project])
  useEffect(() => { if (!manifest || !selected) return; const key = `${selected}:${manifest.version || item?.version}`; if (initialized.current === key) return; initialized.current = key; setSelectedIds(cards.map((card: any) => card.id)); setTitle((current) => current === (item?.title || '') ? manifest.title || current : current) }, [selected, manifest])
  const signature = JSON.stringify([project, selected, manifest?.version || item?.version, selectedIds.slice().sort(), title])
  const choose = (row: any) => { initialized.current = ''; setSelected(row.id); setPersonalProject(''); setDiff(null); setMessage(''); setTitle(row.title || ''); setSelectedIds([]) }
  const refresh = () => { void mutate(); onChanged() }
  const act = async (action: 'create' | 'save' | 'adopt' | 'diff') => {
    const heldProject = project; const heldSelection = selected; setBusy(action); setMessage('')
    try {
      if (action === 'diff') { if (!worldId) throw new Error('请先选择一个已有世界。'); const result = await api.get(`/api/projects/${project}/world-library/diff?world_id=${encodeURIComponent(worldId)}`); if (active.current === heldProject) setDiff(result); return }
      if (action === 'save') { if (!worldId || dirty) throw new Error('请先保存当前世界的编辑，再另存到个人资料库。'); const result = await api.post(`/api/projects/${project}/world-library/save`, { world_id: worldId, title: title.trim() || '我的世界', base_revision: worldRevision }); if (active.current !== heldProject) return; await mutate(); if (active.current !== heldProject) return; setMessage(`已另存为个人世界。当前作品与原来源保持独立。${result.title ? `名称：${result.title}` : ''}`); return }
      if (action === 'create') { if (!title.trim()) throw new Error('请先给个人资料库起一个名字。'); const result = await api.post('/api/world-library', { title: title.trim(), ...(category !== 'all' ? { category } : {}) }); if (active.current !== heldProject) return; await mutate(); if (active.current !== heldProject) return; if (!result.library_project_id) throw new Error('资料库已创建，目录正在更新，请从个人库列表打开。'); setPersonalProject(result.library_project_id); setSelected(''); setMessage('已创建私人资料库。可直接读入原材料，整理确认前只作为原材料保留。'); return }
      if (!item?.prepared || !selectedIds.length) throw new Error('请选择已整理的世界内容；未整理的原材料需要先进入工作稿。')
      const version = manifest?.version || item.version
      if (!version) throw new Error('未能读取这个世界的固定版本，请重新打开后再选用。')
      if (!requests.current.has(signature)) requests.current.set(signature, crypto.randomUUID())
      const result = await api.post(`/api/world-library/${encodeURIComponent(selected)}/adopt`, { project_id: project, version, selected_ids: selectedIds, request_id: requests.current.get(signature), title: title.trim() || item.title })
      if (active.current !== heldProject) return
      setAdopted({ signature, worldId: result.world_id }); refresh(); setMessage(`已固定所选来源版本，建立本作品自己的世界实例。${result.added_dependencies?.length ? `同时保留 ${result.added_dependencies.length} 项必要关联。` : ''}${(result.warnings || []).join('；')}`)
      if (selectedRef.current === heldSelection && result.world_id) onOpenWorld(result.world_id)
    } catch (cause) { if (active.current === heldProject) setMessage(cause instanceof Error ? cause.message : '操作未完成，当前选择保留。') }
    finally { if (active.current === heldProject) setBusy('') }
  }
  const filtered = rows.filter((row: any) => (category === 'all' || row.category === category) && (scope === 'all' || (scope === 'raw' ? row.kind === 'source_material' : row.visibility === scope)) && `${row.title} ${row.summary || ''} ${(row.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  return <details open={expanded} className='world-library border-y border-border py-4'><summary className='cursor-pointer text-sm font-medium'>从世界资料库开始，或导入自己的资料</summary><div className='mt-5 space-y-5'>
    <p className='text-sm leading-7 text-muted'>精选示例是原创虚构设定，可以选择部分内容形成作品实例；个人上传只存本地，未整理的材料不会当成正式世界。</p>
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(150px,1fr)_minmax(150px,1fr)]'><Input aria-label='查找世界资料' className='flex-1' placeholder='按名称、题材或标签查找' value={query} onChange={(event) => setQuery(event.target.value)} /><Select aria-label='世界资料题材' value={category} onChange={(event) => setCategory(event.target.value)}><option value='all'>所有题材</option>{[...new Set(rows.map((row: any) => row.category).filter(Boolean))].map((key: any) => <option key={key} value={key}>{CATEGORIES[key] || key}</option>)}</Select><Select aria-label='世界资料使用范围' value={scope} onChange={(event) => setScope(event.target.value)}><option value='all'>全部资料</option><option value='public'>精选原创示例</option><option value='private'>个人世界</option><option value='raw'>未整理原材料</option></Select></div>
    {error ? <div className='space-y-2'><p role='alert' className='text-sm text-muted'>世界资料库暂时无法读取，作品中的设定仍可编辑。</p><Button onClick={() => mutate()}>重新读取资料库</Button></div> : !data ? <p className='text-sm text-muted'>正在读取世界资料库…</p> : <ul className='divide-y divide-border'>{filtered.map((row: any) => <li key={row.id} className='py-4'><div className='flex flex-wrap items-baseline justify-between gap-3'><button className='text-left text-sm font-semibold text-brand-600 hover:underline focus-ring' onClick={() => choose(row)}>{row.title}</button><span className='text-xs text-muted'>{row.kind === 'source_material' ? '原材料 · 尚未整理' : row.visibility === 'private' ? '个人世界' : '精选原创示例'}{row.version ? ' · 选用时固定此版' : ''}</span></div><p className='mt-2 text-sm leading-7 text-muted'>{row.summary}</p>{row.library_project_id && <Button className='mt-2 text-xs' variant='ghost' onClick={() => { setPersonalProject(row.library_project_id); setSelected(''); setMessage('') }}>打开个人资料与工作稿</Button>}</li>)}{!filtered.length && <li className='py-4 text-sm text-muted'>没有匹配的资料，可以调整筛选，或读入自己的原材料。</li>}</ul>}
    {selected && <section className='space-y-4 border-t border-border pt-5' aria-label='世界内容选用预览'><h3 className='text-lg font-semibold'>{manifest?.title || item?.title || '世界预览'}</h3>{detailError ? <p role='alert' className='text-sm text-muted'>这个世界的详情暂时无法读取，请重新选择。</p> : !manifest ? <p className='text-sm text-muted'>正在读取原始版本…</p> : <><p className='text-xs leading-6 text-muted'>来源：{manifest.source?.label || manifest.source?.title || (item?.visibility === 'public' ? 'novix 原创虚构示例' : '作者个人资料库')}。选用时固定当前保存版，后续修改本作品不会回写原库。</p>{item?.prepared ? <><fieldset className='max-h-72 space-y-3 overflow-auto'><legend className='mb-3 text-sm font-medium'>选择本作品需要的内容</legend>{cards.map((card: any) => <div key={card.id} className='space-y-2'><label className='flex items-start gap-3 text-sm'><input type='checkbox' checked={selectedIds.includes(card.id)} onChange={(event) => setSelectedIds(event.target.checked ? [...selectedIds, card.id] : selectedIds.filter((id) => id !== card.id))} /><span>{card.title || card.payload?.name || '未命名条目'}<span className='mt-1 block text-xs leading-6 text-muted'>{card.payload?.summary || card.payload?.identity || ''}</span></span></label><details className='ml-6'><summary className='cursor-pointer text-xs text-brand-600'>查看实际设定内容</summary><div className='mt-2 space-y-2 whitespace-pre-wrap text-xs leading-7 text-muted'>{[card.payload?.content, card.payload?.setting, card.payload?.description, ...(card.payload?.rules || [])].filter(Boolean).map((text, index) => <p key={index}>{text}</p>)}{!card.payload?.content && !card.payload?.setting && !card.payload?.description && !card.payload?.rules?.length && <p>{card.payload?.summary || '这项只有名称与关联，其他内容保留为空。'}</p>}</div></details></div>)}</fieldset><label className='block text-xs text-muted'>在本作品中的世界名称</label><Input aria-label='选用后世界名称' value={title} onChange={(event) => setTitle(event.target.value)} /><div className='flex flex-wrap gap-2'><Button variant='primary' disabled={Boolean(busy) || !selectedIds.length || adopted?.signature === signature} onClick={() => act('adopt')}>{busy === 'adopt' ? '正在建立作品实例…' : adopted?.signature === signature ? '本版本已选用' : '确认选用所选内容'}</Button>{adopted?.signature === signature && <Button onClick={() => onOpenWorld(adopted.worldId)}>打开本作品实例</Button>}</div></> : <p className='text-sm leading-7 text-muted'>这里只保存原材料，还没有可直接采用的世界。请打开个人库，先核对读取范围并整理候选。</p>}</> }</section>}
    <details><summary className='cursor-pointer text-sm text-brand-600'>建立个人资料库，或另存当前世界</summary><div className='mt-3 space-y-3'><Input aria-label='个人世界名称' value={title} onChange={(event) => setTitle(event.target.value)} placeholder='给你的世界或待整理资料起一个名字' /><div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy) || !title.trim()} onClick={() => act('create')}>新建私人资料库</Button>{worldId && <Button disabled={Boolean(busy) || dirty || !title.trim()} onClick={() => act('save')}>将当前世界保存版另存到个人库</Button>}{worldId && <Button disabled={Boolean(busy)} onClick={() => act('diff')}>核对原库是否有新版本</Button>}</div>{dirty && <p className='text-xs text-muted'>当前世界有未保存编辑，请先保存，再另存。</p>}{diff && <section className='space-y-2'><p className='text-sm'>{diff.latest_source_version === diff.current_source_version ? '原库没有新版本，本作品的改动保留。' : '原库已有新版本，本作品继续保留已采用的版本与作者改动。'}</p>{[['added', '新增'], ['changed', '变化'], ['removed', '移除']].map(([key, label]) => <p key={key} className='text-xs leading-6 text-muted'>{label}：{Array.isArray(diff[key]) ? diff[key].map((entry: any) => entry.title || entry.label || '一项设定').join('、') || '无' : '无'}</p>)}<p className='text-xs text-muted'>只比较来源版本，不自动覆盖作者的当前世界；可从资料库明确选用新版本形成另一个实例。</p></section>}</div></details>
    {personalProject && <section className='space-y-5 border-t border-border pt-5'><h3 className='text-lg font-semibold'>{privateItem?.title || '我的私人资料库'}</h3><p className='text-xs text-muted'>以下操作只维护这份私人库，不修改当前作品。</p><MaterialImportWorkspace key={personalProject} project={personalProject} purpose='world' onApplied={() => { void mutate() }} /><details><summary className='cursor-pointer text-sm text-brand-600'>编辑已整理的库内条目</summary><div className='mt-4'><CardEditor key={personalProject} project={personalProject} type='world' onSaved={() => { void mutate() }} /></div></details></section>}
    {data?.tools?.length > 0 && <details><summary className='cursor-pointer text-sm text-muted'>外部构建工具与方法</summary><ul className='mt-3 space-y-4'>{data.tools.map((tool: any) => <li key={tool.id}><a className='text-sm text-brand-600 underline' href={tool.url} target='_blank' rel='noreferrer'>{tool.title}</a><p className='mt-1 text-xs leading-6 text-muted'>{tool.description}</p></li>)}</ul><p className='mt-3 text-xs text-muted'>在外部工具完成后，可以把实际导出的文字、图片或资料包带回这里；没有自动跨网站同步。</p></details>}
    {message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}
  </div></details>
}
