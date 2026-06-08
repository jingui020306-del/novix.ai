import { Badge } from './ui/Badge'
import { Card } from './ui/Card'

type StoryLinks = {
  chapterPlan: any[]
  openLine: any[]
  hiddenLine: any[]
  foreshadowings: any[]
}

type RightChapterContextPanelProps = {
  chapterLabel: string
  storyLinks: StoryLinks
  volumeLabel: string
}

export function RightChapterContextPanel({ chapterLabel, storyLinks, volumeLabel }: RightChapterContextPanelProps) {
  return (
    <Card title='本章上下文' extra={<Badge>{chapterLabel}</Badge>} className='module-card module-context'>
      <div className='space-y-2 text-xs'>
        <div className='rounded-ui border border-border bg-surface-2 p-2'>
          <div className='font-medium'>{volumeLabel}</div>
          <div className='text-muted'>{chapterLabel}</div>
        </div>
        <div>
          <div className='mb-1 font-medium'>章节计划</div>
          {(storyLinks.chapterPlan || []).map((row: any, idx: number) => (
            <div key={`plan-${idx}`} className='mb-1 rounded-ui border border-border bg-surface px-2 py-1'>
              {row.title || row.focus || row.chapter || row.chapter_id}
            </div>
          ))}
          {!storyLinks.chapterPlan.length && <div className='text-muted'>还没有绑定章节计划。</div>}
        </div>
        <div className='grid grid-cols-2 gap-2'>
          <div className='rounded-ui border border-border bg-surface p-2'>
            <div className='font-medium'>明线</div>
            <div className='text-muted'>{storyLinks.openLine.length ? storyLinks.openLine.map((x: any) => x.event || x.result || x.chapter).join(' / ') : '未绑定'}</div>
          </div>
          <div className='rounded-ui border border-border bg-surface p-2'>
            <div className='font-medium'>暗线</div>
            <div className='text-muted'>{storyLinks.hiddenLine.length ? storyLinks.hiddenLine.map((x: any) => x.truth || x.visible_hint || x.chapter).join(' / ') : '未绑定'}</div>
          </div>
        </div>
        <div>
          <div className='mb-1 font-medium'>伏笔</div>
          {storyLinks.foreshadowings.map((x: any) => (
            <div key={x.id || x.content} className='mb-1 rounded-ui border border-border bg-surface px-2 py-1'>
              {x.content || x.id} <span className='text-muted'>({x.status || '未出现'})</span>
            </div>
          ))}
          {!storyLinks.foreshadowings.length && <div className='text-muted'>还没有绑定伏笔。</div>}
        </div>
      </div>
    </Card>
  )
}
