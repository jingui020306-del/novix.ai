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

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  drafting: '写作中',
  planned: '已规划',
  revising: '修改中',
  done: '已完成',
  completed: '已完成',
  generating: '起草中',
  awaiting_review: '待审稿',
  saved: '已保存',
  risky: '有风险',
}

function statusLabel(status?: string) {
  return STATUS_LABELS[status || ''] || status || '未开始'
}

function volumeLabel(volumeId?: string) {
  if (!volumeId || volumeId === 'volume_default') return '默认卷'
  return volumeId
}

export function RecentChaptersCard({ chapters, onOpenChapter }: RecentChaptersCardProps) {
  return (
    <Card title='最近在写'>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
        {chapters.map((chapter) => (
          <button
            key={chapter.chapter_id}
            onClick={() => onOpenChapter(chapter.chapter_id)}
            className='rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2'
          >
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium'>{chapter.chapter_title || chapter.title || chapter.chapter_id}</span>
              <Badge>{statusLabel(chapter.chapter_status)}</Badge>
            </div>
            <div className='mt-1 text-xs text-muted'>{volumeLabel(chapter.volume_id)}</div>
          </button>
        ))}
        {!chapters.length && <p className='text-sm text-muted'>还没有正文。先建一卷，再写第一章。</p>}
      </div>
    </Card>
  )
}
