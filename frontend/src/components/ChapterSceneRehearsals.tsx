import useSWR from 'swr'
import { api } from '../api/client'
import { Button } from './ui/Button'

export function ChapterSceneRehearsals({ project, chapterId, storyId, onOpen, onOpenPlanning, selectedScene, onSelectScene }: {
  project: string; chapterId: string; storyId?: string; onOpen: (record: any) => void; onOpenPlanning: () => void; selectedScene?: { owner_card_id: string; scene_id: string }; onSelectScene?: (record?: any) => void;
}) {
  const query = new URLSearchParams({ chapter_id: chapterId })
  if (storyId) query.set('story_card_id', storyId)
  const { data, error, mutate } = useSWR(project && chapterId ? `/api/projects/${project}/scene-rehearsals?${query}` : null, api.get)
  const rows = Array.isArray(data) ? data : []
  const nameCounts = new Map<string, number>()
  for (const row of rows) nameCounts.set(row.label || '本章情节', (nameCounts.get(row.label || '本章情节') || 0) + 1)
  const sourceLabel = (row: any) => row.owner_card_id === storyId || row.owner_card_id.startsWith('story') ? '故事策划' : '情节工作表'
  return <section className='space-y-3 border-t border-border py-4' aria-label='本章同源场景安排'>
    <div className='flex flex-wrap items-baseline justify-between gap-2'><h3 className='text-sm font-medium'>本章场景安排</h3><button className='text-xs text-brand-600 hover:underline focus-ring' onClick={onOpenPlanning}>查看原情节工作表</button></div>
    {error || data?.detail ? <div className='space-y-2'><p className='text-xs text-muted'>场景摘要暂时无法读取，原安排保留。</p><Button className='text-xs' onClick={() => mutate()}>重新读取</Button></div> : !data ? <p className='text-xs text-muted'>正在读取本章关联的场景摘要…</p> : !rows.length ? <p className='text-xs leading-6 text-muted'>本章尚未关联重要事件。可先在工作表为事件安排章节，再从此处细化场景；无分章事件也保留原入口。</p> : <ul className='divide-y divide-border'>{rows.map((row: any) => <li key={`${row.owner_card_id}:${row.scene_id}`} className='space-y-2 py-3'><button className='text-left text-sm font-medium text-brand-600 hover:underline focus-ring' onClick={() => onOpen(row)}>{row.label || '本章情节'}{(nameCounts.get(row.label || '本章情节') || 0) > 1 ? `（${sourceLabel(row)}）` : ''} · {row.confirmed ? '查看同一场安排' : '安排这一场'}</button>{onSelectScene && row.confirmed && <div><Button className='text-xs' disabled={Boolean(row.stale) && !(selectedScene?.owner_card_id === row.owner_card_id && selectedScene?.scene_id === row.scene_id)} aria-pressed={selectedScene?.owner_card_id === row.owner_card_id && selectedScene?.scene_id === row.scene_id} onClick={() => onSelectScene(selectedScene?.owner_card_id === row.owner_card_id && selectedScene?.scene_id === row.scene_id ? undefined : row)}>{selectedScene?.owner_card_id === row.owner_card_id && selectedScene?.scene_id === row.scene_id ? '取消本次事件锚点' : '以此事件为本次锚点'}</Button></div>}{row.summary && <p className='whitespace-pre-wrap text-sm leading-7 text-muted'>{row.summary}</p>}{row.stale && <p className='text-xs leading-5 text-muted'>依据已有变化，请回到这一场核对并重新确认；旧摘要不直接用于生成。</p>}</li>)}</ul>}
    <p className='text-xs leading-5 text-muted'>场景始终保存于同一份原情节。未确认安排不会用于生成，不复制章节推演或改正文。事件锚点仅限定本次关系阶段，选择不等于重新确认推演；不选时不强猜某一场。</p>
  </section>
}
