import { Badge } from './ui/Badge'
import { Card } from './ui/Card'

type RecentChapter = {
  chapter_id: string
  chapter_title?: string
  title?: string
  chapter_status?: string
  volume_id?: string
}

type RecentChaptersCardProps = {
  chapters: RecentChapter[]
  onOpenChapter: (chapterId: string) => void
}

export function RecentChaptersCard({ chapters, onOpenChapter }: RecentChaptersCardProps) {
  return (
    <Card title='最近章节'>
      <div className='grid grid-cols-2 gap-2'>
        {chapters.map((chapter) => (
          <button
            key={chapter.chapter_id}
            onClick={() => onOpenChapter(chapter.chapter_id)}
            className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2'
          >
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium'>{chapter.chapter_title || chapter.title || chapter.chapter_id}</span>
              <Badge>{chapter.chapter_status || '未开始'}</Badge>
            </div>
            <div className='mt-1 text-xs text-muted'>{chapter.chapter_id} · {chapter.volume_id || 'volume_default'}</div>
          </button>
        ))}
        {!chapters.length && <p className='text-sm text-muted'>暂无章节。</p>}
      </div>
    </Card>
  )
}
