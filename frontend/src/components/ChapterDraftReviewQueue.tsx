import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

type ChapterReview = {
  review_id?: string
  status?: string
  preview?: string
  word_count?: number
}

type ChapterDraftReviewQueueProps = {
  pendingCount: number
  reviews: ChapterReview[]
  onAccept: (review: ChapterReview) => void
  onReject: (review: ChapterReview) => void
}

export function ChapterDraftReviewQueue({ pendingCount, reviews, onAccept, onReject }: ChapterDraftReviewQueueProps) {
  return (
    <details className='rounded-ui border border-border bg-surface'>
      <summary className='cursor-pointer px-3 py-2 text-sm font-medium'>
        AI 草稿待确认 <span className='text-xs text-muted'>({pendingCount})</span>
      </summary>
      <div className='space-y-2 border-t border-border p-3'>
        {reviews.slice(0, 4).map((review) => (
          <div key={review.review_id} className='rounded-ui border border-border bg-surface p-2 text-xs'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <div className='font-medium'>AI 初稿</div>
                <div className='text-muted'>{review.word_count || 0} 字</div>
              </div>
              <Badge tone={review.status === 'accepted' ? 'success' : review.status === 'pending_author_review' ? 'warn' : 'default'}>
                {review.status === 'accepted' ? '已确认' : review.status === 'pending_author_review' ? '待确认' : '已处理'}
              </Badge>
            </div>
            <div className='mt-2 text-muted'>{review.preview || '无预览'}</div>
            {review.status === 'pending_author_review' ? (
              <div className='mt-2 flex gap-2'>
                <Button className='text-xs' onClick={() => onAccept(review)}>确认草稿</Button>
                <Button className='text-xs' onClick={() => onReject(review)}>先不用</Button>
              </div>
            ) : null}
          </div>
        ))}
        {!reviews.length && <p className='text-sm text-muted'>开始写初稿后，AI 草稿会先进入这里等待作者确认。</p>}
      </div>
    </details>
  )
}
