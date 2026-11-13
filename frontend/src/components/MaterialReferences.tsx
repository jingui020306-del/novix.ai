import { useId, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Fields'
import { isIncompleteReference, referenceLabel } from '../lib/writingReferences'

export const MATERIAL_TYPES: Record<string, string> = { information: '关键信息', character: '人物', world: '世界条目', world_rule: '世界规则', lore: '背景资料', worldview: '世界观', story: '故事', outline: '情节工作表与大纲', style: '文风', chapter: '章节', technique: '技法', tool_skill: '写作工具', scene: '场景', beat: '节拍', character_intersection: '角色交集', character_storyline: '人物故事线', chapter_plan: '章节计划', open_line: '明线', hidden_line: '暗线', foreshadowings: '伏笔', fact: '作品事实' }
export type OpenMaterial = (target: { id: string; type?: string; [key: string]: any }) => void

export function MaterialBacklinks({ project, targetId, onOpen }: { project: string; targetId?: string; onOpen?: OpenMaterial }) {
  const { data, mutate } = useSWR(targetId ? `/api/projects/${project}/backlinks/${encodeURIComponent(targetId)}` : null, api.get)
  if (!targetId) return null
  const items = Array.isArray(data?.items) ? data.items : []
  return <section className='space-y-3' aria-label='哪些内容引用了这里'>
    <div className='flex items-center justify-between gap-3'><h4 className='text-sm font-medium'>哪些内容引用了这里</h4><Button variant='ghost' className='text-xs' onClick={() => mutate()}>更新关联</Button></div>
    {data?.detail ? <p className='text-xs text-muted'>反向关联读取失败，可点击更新重试。</p> : !data ? <p className='text-xs text-muted'>正在读取关联…</p> : !items.length ? <p className='text-xs text-muted'>尚未有其他资料引用这里。保存关联后会出现在此处。</p> : <ul className='divide-y divide-border'>{items.map((item: any, index: number) => <li key={`${item.source_id}:${index}`} className='py-2 text-sm'><button className='text-left text-brand-600 hover:underline focus-ring' disabled={!onOpen} onClick={() => onOpen?.({ id: item.source_id, type: item.type, evidence: item.evidence })}>{item.label || MATERIAL_TYPES[item.type] || '关联资料'}</button><span className='ml-2 text-xs text-muted'>{item.relation || '引用此处'}</span>{item.evidence?.quote && <blockquote className='mt-1 text-xs leading-5 text-muted'>{item.evidence.quote}</blockquote>}{item.source && <details className='mt-1'><summary className='cursor-pointer text-xs text-muted'>引用位置</summary><p className='mt-1 break-all text-xs text-muted'>{typeof item.source === 'string' ? item.source : item.source.path || '作者资料'}</p></details>}</li>)}</ul>}
  </section>
}

export function MaterialReferences({ project, value, onChange, onOpen, sourceId, compact = false, hint = '保存当前内容后关联生效；修改原资料时，各处引用会读取同一份作者版。' }: {
  project: string; value: string[]; onChange: (ids: string[]) => void; onOpen?: OpenMaterial; sourceId?: string; compact?: boolean; hint?: string;
}) {
  const { data } = useSWR(project ? `/api/projects/${project}/materials` : null, api.get)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const controlId = useId()
  const rows = Array.isArray(data) ? data : []
  const ids = Array.isArray(value) ? value : []
  const candidates = rows.filter((row: any) => !isIncompleteReference({ title: row.label }) && row.id !== sourceId && !ids.includes(row.id) && (kind === 'all' || row.type === kind) && `${row.label || ''} ${row.summary || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const body = <div className='space-y-3'>
    {ids.length ? <ul className='divide-y divide-border'>{ids.map((id) => { const material = rows.find((row: any) => row.id === id); return <li key={id} className='flex items-center justify-between gap-3 py-2 text-sm'><button className='min-w-0 text-left text-brand-600 hover:underline focus-ring' disabled={!material || !onOpen} onClick={() => material && onOpen?.(material)}>{(material ? referenceLabel({ title: material.label }) : '') || (!data ? '正在读取关联…' : '未找到的资料（保留关联）')}{material && <span className='ml-2 text-xs text-muted'>{MATERIAL_TYPES[material.type] || '资料'}</span>}</button><Button variant='ghost' className='shrink-0 text-xs' onClick={() => onChange(ids.filter((entry) => entry !== id))}>移除</Button></li> })}</ul> : <p className='text-xs text-muted'>还没有关联资料，可以选人物、世界条目或章节。</p>}
    <details><summary className='cursor-pointer text-sm text-brand-600'>选择要关联的资料</summary><div className='mt-3 space-y-3'>
      <div className='flex flex-col gap-2 sm:flex-row'><div className='flex-1'><label className='sr-only' htmlFor={`${controlId}-query`}>查找关联资料</label><Input id={`${controlId}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder='按名称查找资料…' /></div><div className='sm:w-36'><label className='sr-only' htmlFor={`${controlId}-kind`}>资料类型</label><Select id={`${controlId}-kind`} value={kind} onChange={(event) => setKind(event.target.value)}><option value='all'>所有类型</option>{[...new Set(rows.map((row: any) => row.type))].map((type: any) => <option key={type} value={type}>{MATERIAL_TYPES[type] || '其他资料'}</option>)}</Select></div></div>
      <div className='max-h-60 divide-y divide-border overflow-auto'>{candidates.map((row: any) => <div key={row.id} className='flex items-center justify-between gap-3 py-2'><div className='min-w-0'><p className='text-sm'>{row.label || '未命名资料'}</p><span className='text-xs text-muted'>{MATERIAL_TYPES[row.type] || '资料'}</span></div><Button className='shrink-0 text-xs' aria-label={`关联${row.label || '资料'}`} onClick={() => onChange([...ids, row.id])}>关联</Button></div>)}</div>
      {data?.detail ? <p role='alert' className='text-xs text-muted'>资料目录读取失败，请稍后重试。</p> : !data ? <p className='text-xs text-muted'>正在读取资料目录…</p> : !candidates.length && <p className='text-xs text-muted'>没有匹配的资料，试试其他名称或类型。</p>}
    </div></details>
    <p className='text-xs leading-5 text-muted'>{hint}</p>
  </div>
  return compact ? <details><summary className='cursor-pointer text-xs text-brand-600'>关联资料{ids.length ? `（${ids.length}）` : ''}</summary><div className='mt-3'>{body}</div></details> : <section className='space-y-3 border-t border-border pt-4' aria-label='关联资料'><h3 className='text-sm font-medium'>关联资料</h3>{body}{sourceId && <div className='border-t border-border pt-3'><MaterialBacklinks project={project} targetId={sourceId} onOpen={onOpen} /></div>}</section>
}
