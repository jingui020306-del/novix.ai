import { useId } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { Input, Select, Textarea } from './ui/Fields'

export function WorldContextFields({ project, value = {}, onChange, inherited, storyId }: { project: string; value?: any; onChange: (value: any) => void; inherited?: string; storyId?: string }) {
  const id = useId()
  const { data: worlds } = useSWR(`/api/projects/${project}/cards?type=world`, api.get)
  const { data: events } = useSWR(`/api/projects/${project}/events${storyId ? `?story_card_id=${encodeURIComponent(storyId)}` : ''}`, api.get)
  const { data: branches } = useSWR(value.world_id ? `/api/projects/${project}/worlds/${value.world_id}/branches` : null, api.get)
  const change = (patch: any) => onChange({ ...value, ...patch })
  const changeTime = (patch: any) => change({ time: { ...value.time, ...patch } })
  const rows = Array.isArray(events) ? events : []
  const eventName = (event: any) => event.values?.scene || event.values?.plot || '未命名事件'
  const nameCounts = new Map<string, number>()
  for (const event of rows) nameCounts.set(eventName(event), (nameCounts.get(eventName(event)) || 0) + 1)
  return <section className='space-y-3' aria-label='世界与发生时间'>
    <p className='text-xs leading-6 text-muted'>{inherited || '先选故事使用的世界。章节与事件默认继承，只有确实不同时再补充。'} 世界分支是“另一种历史”；故事线是并行线索，两者分开保存。</p>
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'><div><label className='mb-1 block text-xs text-muted' htmlFor={`${id}-world`}>使用哪个世界</label><Select id={`${id}-world`} value={value.world_id || ''} onChange={(e) => change({ world_id: e.target.value || undefined, branch_id: undefined })}><option value=''>继承上级 / 暂未指定</option>{value.world_id && !(worlds || []).some?.((world: any) => world.id === value.world_id) && <option value={value.world_id}>原关联世界（暂未读到，保留）</option>}{(Array.isArray(worlds) ? worlds : []).map((world: any) => <option key={world.id} value={world.id}>{world.title || '未命名世界'}</option>)}</Select></div>{value.world_id && <div><label className='mb-1 block text-xs text-muted' htmlFor={`${id}-branch`}>世界分支</label><Select id={`${id}-branch`} value={value.branch_id || ''} onChange={(e) => change({ branch_id: e.target.value || undefined })}><option value=''>继承 / 主世界</option>{(branches?.branches || []).map((branch: any) => <option key={branch.id} value={branch.id}>{branch.label || '未命名分支'}</option>)}</Select></div>}</div>
    <details><summary className='cursor-pointer text-xs text-brand-600'>补充发生时间与局部差异（可选）</summary><div className='mt-3 space-y-3'><div><label className='mb-1 block text-xs text-muted' htmlFor={`${id}-year`}>事情发生的年份</label><Input id={`${id}-year`} type='number' step={1} value={value.time?.year ?? ''} onChange={(e) => changeTime({ year: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder='未知时留空，不按章节号推断年龄。' /></div><div><label className='mb-1 block text-xs text-muted' htmlFor={`${id}-event`}>相对于哪个事件</label><Select id={`${id}-event`} value={value.time?.event_ref ? `${value.time.event_ref.owner_card_id}:${value.time.event_ref.scene_id}` : ''} onChange={(e) => { const [owner_card_id, scene_id] = e.target.value.split(':'); changeTime({ event_ref: e.target.value ? { owner_card_id, scene_id } : undefined }) }}><option value=''>未指定事件</option>{rows.map((event: any) => <option key={event.id} value={`${event.owner_card_id}:${event.scene_id}`}>{eventName(event)}{(nameCounts.get(eventName(event)) || 0) > 1 ? `（${event.owner_card_id === event.story_card_id ? '故事策划' : '情节工作表'}）` : ''}</option>)}</Select></div><div><label className='mb-1 block text-xs text-muted' htmlFor={`${id}-position`}>相对时点</label><Select id={`${id}-position`} value={value.time?.position || ''} onChange={(e) => changeTime({ position: e.target.value || undefined })}><option value=''>暂未指定</option><option value='before'>事件发生前</option><option value='immediate_after'>事件刚结束</option><option value='phase'>明确说明的后续阶段</option></Select></div>{value.time?.position === 'phase' && <Textarea aria-label='后续阶段的明确说明' value={value.time.phase || ''} onChange={(e) => changeTime({ phase: e.target.value })} placeholder='例如：分歧后三个月，二人重新见面；不能把任意后续状态当成刚结束。' />}<Textarea aria-label='本处与基础世界的局部差异' value={value.local_adjustments || ''} onChange={(e) => change({ local_adjustments: e.target.value })} placeholder='只补本章 / 本场不同的规则；基础设定不必重复录入。' /></div></details>
  </section>
}
