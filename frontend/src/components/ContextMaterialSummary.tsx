import { useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { OpenMaterial } from './MaterialReferences'
import { Button } from './ui/Button'
import { Select } from './ui/Fields'
import { fieldLabel } from './SchemaForm'

export const expansionKey = (reference: any) => JSON.stringify([reference.source, reference.material_id || '', reference.start ?? null, reference.end ?? null, Boolean(reference.follow_refs)])
export function materialSourceTarget(item: any) {
  const source = typeof item.source === 'string' ? item.source : item.source?.path || ''
  const card = source.match(/cards\/([^/.]+)\.(?:yaml|json)(?:#(.+))?/)
  const chapter = source.match(/drafts\/([^/.]+)\.md/)
  const stageId = item.stage_id || item.source_record_id
  const materialType = item.material_type || item.type
  const canon = /^canon\/(?:facts|revisions|author_stages)\.jsonl(?:#|$)/.test(source) && item.material_id && item.material_id !== 'information_context' && (['fact', 'canon', 'information', 'character', 'world', 'world_rule', 'lore', 'worldview', 'relationship'].includes(materialType) || /^(?:fact|information|character|world|relationship)_/.test(item.material_id))
  const relationshipId = materialType === 'relationship' && item.material_id && (card || canon) ? item.material_id : undefined
  return { id: relationshipId || (stageId && item.material_id && (card || canon) ? item.material_id : card?.[1] || chapter?.[1] || (canon ? item.material_id : undefined)), type: relationshipId ? 'relationship' : chapter ? 'chapter' : canon && /^canon\/(?:facts|revisions)\.jsonl/.test(source) ? 'fact' : materialType, ...(stageId ? { stage_id: stageId } : !relationshipId && card?.[2] ? { editPath: card[2].split(/[./]/).filter(Boolean) } : {}), source, start: item.start, end: item.end }
}
export function MaterialText({ text, names, onOpen }: { text: string; names: Record<string, string>; onOpen?: OpenMaterial }) {
  const inline = (content: string) => {
    const parts: any[] = []; let cursor = 0
    const pattern = /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(((?:cards|drafts|canon)\/[^)]+)\)/g
    for (const match of content.matchAll(pattern)) {
      const [source, alias] = (match[1] || match[3]).split('|')
      if (!/^(?:cards|drafts|canon)\//.test(source)) continue
      const target = materialSourceTarget({ source })
      parts.push(content.slice(cursor, match.index))
      const label = alias || match[2] || names[target.id || ''] || '关联资料'
      parts.push(onOpen && target.id ? <button key={match.index} type='button' className='inline p-0 text-brand-600 underline decoration-dotted underline-offset-4 focus-ring' onClick={() => onOpen(target)}>{label}</button> : <span key={match.index}>{label}</span>)
      cursor = (match.index || 0) + match[0].length
    }
    parts.push(content.slice(cursor)); return parts
  }

  let value: any
  try { value = JSON.parse(text) } catch {}
  const proseClass = 'whitespace-pre-wrap break-words text-sm leading-7'
  if (!value || typeof value !== 'object') return <p className={proseClass}>{inline(text || '旧记录没有保留这段读取文字。')}</p>
  const labels: Record<string, string> = { rules: '规则', cast: '出场人物', constraints: '本次限制', max_tokens: '输出预留', scene_direction: '场景表达', writing_alignment: '本章写法', technique_applications: '技法落点', current_goal: '当前打算', outcome: '结果', next_question: '遗留问题', cost: '代价', conditions: '适用条件', exceptions: '例外', content: '正文' }
  const render = (item: any, key = ''): any => {
    if (Array.isArray(item)) return <div className='space-y-2'>{item.map((entry, index) => <div key={index}>{render(entry, key)}</div>)}</div>
    if (item && typeof item === 'object') return <div className='space-y-3'>{Object.entries(item).filter(([field]) => !['id', '_revision', '_source_versions', 'source_versions', 'fingerprint', 'sha256', 'path', 'raw_path'].includes(field)).map(([field, entry]) => { const label = labels[field] || (/[^\x00-\x7f]/.test(field) ? field : fieldLabel(field)); return <div key={field}>{label !== '补充内容' && <p className='mb-1 text-xs font-medium text-muted'>{label}</p>}{render(entry, field)}</div> })}</div>
    const reference = /(?:_id|_ids|_ref|_refs)$/.test(key) || ['cast', 'characters', '人物', '编号'].includes(key)
    const content = reference && typeof item === 'string' ? names[item] || (/^(?:character|chapter|world|story|outline|relationship|information)_/.test(item) ? '原关联资料（可从来源查看）' : item) : typeof item === 'boolean' ? item ? '是' : '否' : item ?? '未填写'
    return <p className={proseClass}>{inline(String(content))}</p>
  }
  return <div className='space-y-4'>{render(value)}<details><summary className='cursor-pointer text-xs text-muted'>核对原始材料文本</summary><p className={`mt-2 ${proseClass}`}>{text}</p></details></div>
}
export function GenerationMaterialItems({ items = [], onOpen, expansions = [], onExpansionsChange, preview = false, sent = false, names = {} }: { items?: any[]; onOpen: OpenMaterial; expansions?: any[]; onExpansionsChange?: (value: any[]) => void; preview?: boolean; sent?: boolean; names?: Record<string, string> }) {
  const chosen = new Set(expansions.map(expansionKey))
  const toggle = (reference: any, follow: boolean, checked: boolean) => {
    const value = { source: reference.source, ...(reference.material_id ? { material_id: reference.material_id } : {}), ...(reference.start !== undefined ? { start: reference.start } : {}), ...(reference.end !== undefined ? { end: reference.end } : {}), ...(follow ? { follow_refs: true } : {}) }
    onExpansionsChange?.(checked ? [...expansions.filter((entry) => entry.source !== value.source || entry.start !== value.start || entry.end !== value.end), value] : expansions.filter((entry) => expansionKey(entry) !== expansionKey(value)))
  }
  return <ul className='divide-y divide-border'>{items.map((item: any, index) => <li key={`${item.id || item.source}:${index}`} className='min-w-0 space-y-2 py-4'>
    <div className='flex flex-wrap items-baseline justify-between gap-2'><h4 className='text-sm font-semibold'>{item.label || '一项写作资料'}</h4><span className='text-xs text-muted'>{({ full: '全文', summary: '摘要', expanded: '沿引用展开' } as Record<string, string>)[item.mode] || '请求材料'}{item.required ? '，必须完整保留' : ''}</span></div>
    <p className='text-xs leading-6 text-muted'>{Array.isArray(item.reason) ? item.reason.join('；') : item.reason || '由本次任务选用。'}</p>
    {item.via?.length > 0 && <p className='text-xs text-muted'>由其他已选段落的引用展开，深度 {item.depth || 1}。</p>}
    <details><summary className='cursor-pointer text-xs text-brand-600'>{preview ? '查看将带入的文字' : sent ? '查看正文请求采用的文字' : '查看这次请求准备的文字'}{typeof item.text === 'string' ? `（${Array.from(item.text).length} 字符）` : ''}</summary><div className='mt-3 max-h-96 max-w-prose overflow-auto'><MaterialText text={item.text || ''} names={names} onOpen={onOpen} /></div></details>
    {materialSourceTarget(item).id && <Button className='text-xs' variant='ghost' onClick={() => onOpen(materialSourceTarget(item))}>打开原段落</Button>}
    {onExpansionsChange && item.references?.length > 0 && <details><summary className='cursor-pointer text-xs text-brand-600'>这段还引用了哪些内容</summary><div className='mt-3 space-y-3'>{item.references.map((reference: any, i: number) => { const plain = { source: reference.source, ...(reference.material_id ? { material_id: reference.material_id } : {}), ...(reference.start !== undefined ? { start: reference.start } : {}), ...(reference.end !== undefined ? { end: reference.end } : {}) }; return <div key={i} className='space-y-1'><p className='text-sm'>{reference.label || '原文中的一处引用'}</p><div className='flex flex-wrap gap-x-4 gap-y-1'><label className='flex items-start gap-2 text-xs leading-6'><input type='checkbox' checked={chosen.has(expansionKey(plain))} onChange={(event) => toggle(reference, false, event.target.checked)} />本次带入这段原文</label><label className='flex items-start gap-2 text-xs leading-6'><input type='checkbox' checked={chosen.has(expansionKey({ ...plain, follow_refs: true }))} onChange={(event) => toggle(reference, true, event.target.checked)} />同时沿它的引用继续取材</label>{materialSourceTarget(reference).id && <Button className='text-xs' variant='ghost' onClick={() => onOpen(materialSourceTarget(reference))}>查看原段落</Button>}</div></div> })}<p className='text-xs leading-6 text-muted'>更改后需重新核对材料。继续取材仍检查时间、人物所知、隐私与预算，不等于展开整部作品。</p></div></details>}
  </li>)}</ul>
}

export function ContextMaterialSummary({ project, chapterId, pack, onOpen }: { project: string; chapterId: string; pack: any; onOpen: OpenMaterial }) {
  const { data: materials } = useSWR(project ? `/api/projects/${project}/materials` : null, api.get)
  const { data: jobs, error, mutate } = useSWR(project && chapterId ? `/api/projects/${project}/jobs?chapter_id=${encodeURIComponent(chapterId)}` : null, api.get, { refreshInterval: 2500 })
  const [selection, setSelection] = useState({ scope: '', id: '' })
  const scope = `${project}:${chapterId}`
  const rows = Array.isArray(jobs) ? jobs : []
  const job = rows.find((row: any) => selection.scope === scope && row.job_id === selection.id) || rows[0]
  const { data: detail, error: detailError, mutate: refreshDetail } = useSWR(job?.job_id ? `/api/projects/${project}/jobs/${job.job_id}` : null, api.get, { refreshInterval: job && !['completed', 'failed', 'cancelled'].includes(job.status) ? 1800 : 0 })
  const manifest = detail?.context_manifest
  const actual = manifest?.generation_materials
  const materialPack = job ? manifest?.context_pack : pack
  const citations = materialPack?.citations || []
  const sent = actual?.request_status === 'sent' && actual?.sent === true
  const names = Object.fromEntries((Array.isArray(materials) ? materials : []).map((item: any) => [item.id, item.label]))
  return <section className='space-y-3' aria-label='本次生成材料'>
    <h3 className='text-base font-semibold'>本次生成材料</h3><p className='text-xs leading-6 text-muted'>这里只记录所选任务的正文生成请求材料，不包含审查与编辑请求。请求完成不代表模型已理解所有内容。</p>
    {rows.length > 1 && <div><label htmlFor='actual-material-job' className='mb-1 block text-xs text-muted'>查看哪次生成</label><Select id='actual-material-job' value={job?.job_id || ''} onChange={(event) => setSelection({ scope, id: event.target.value })}>{rows.map((row: any, index: number) => <option key={row.job_id} value={row.job_id}>{row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : `本章第 ${rows.length - index} 次任务`}{row.status === 'failed' ? '（未完成）' : ''}</option>)}</Select></div>}
    {error || detailError ? <div className='space-y-2'><p role='alert' className='text-xs leading-6 text-muted'>本次材料记录暂时无法读取，不能据此判断模型已读。请重试。</p><Button className='text-xs' onClick={() => { void mutate(); void refreshDetail() }}>重新读取记录</Button></div> : job && !detail ? <p className='text-sm text-muted'>正在读取这次任务的材料记录…</p> : actual ? <><p className='text-sm leading-7'>{sent ? `正文生成请求已完成，采用 ${actual.items?.length || 0} 项材料。` : actual.request_status === 'sending' ? `正在发送正文生成请求，已准备 ${actual.items?.length || 0} 项材料。` : actual.request_status === 'failed' ? `正文生成请求未完成，无法确认服务商是否已处理这 ${actual.items?.length || 0} 项材料。` : actual.request_status === 'prepared' ? `正文生成请求已准备 ${actual.items?.length || 0} 项材料，尚未确认发送。` : `已记录 ${actual.items?.length || 0} 项正文生成材料，发送状态未记录。`}</p>{job?.status === 'failed' && <p className='text-xs leading-6 text-muted'>任务未完成，此清单不代表模型已成功处理这些内容。</p>}<GenerationMaterialItems items={actual.items || []} onOpen={onOpen} sent={sent} names={names} />{(actual.budget?.warnings || []).map((notice: string, i: number) => <p key={i} className='text-xs leading-6 text-muted'>{notice}</p>)}</> : materialPack ? <><p className='text-xs leading-6 text-muted'>这是较早任务的来源记录，未记录每项读取方式和完整文字。</p><ul className='space-y-3'>{(materialPack.used_ids || []).map((id: string, index: number) => { const item = (Array.isArray(materials) ? materials : []).find((row: any) => row.id === id); const citation = citations.find((row: any) => row.id === id); return <li key={id}><Button variant='ghost' className='text-xs' disabled={!materialSourceTarget({ ...item, source: citation?.source, material_id: id }).id} onClick={() => onOpen(materialSourceTarget({ ...item, source: citation?.source, material_id: id }))}>{item?.label || `采用的资料 ${index + 1}`}</Button></li> })}</ul></> : <p className='text-sm leading-7 text-muted'>{job ? '这次任务尚未留下实际取材记录。' : '本章还没有生成记录。生成前可以先核对“本次生成材料”。'}</p>}
  </section>
}
