import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type ReadinessItem = {
  id: string
  label: string
  done: boolean
  detail: string
  run: () => void
}

type ReadinessGroup = {
  id: string
  label: string
  detail: string
  items: ReadinessItem[]
}

type WritingPrepMapProps = {
  groups: ReadinessGroup[]
  itemCount: number
  doneCount: number
  majorDoneCount: number
  onStartChapter: () => void
}

export function WritingPrepMap({ groups, itemCount, doneCount, majorDoneCount, onStartChapter }: WritingPrepMapProps) {
  const renderGroup = (group: ReadinessGroup) => {
    const done = group.items.filter((item) => item.done).length
    const allDone = done === group.items.length
    return (
      <div key={group.id} className={`rounded-ui border p-3 ${allDone ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border bg-surface'}`}>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <div className='text-sm font-semibold'>{group.label}</div>
            <div className='mt-1 text-xs text-muted'>{group.detail}</div>
          </div>
          <Badge tone={allDone ? 'success' : 'warn'}>{done}/{group.items.length}</Badge>
        </div>
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {group.items.map((item) => (
            <button
              key={item.id}
              className={`rounded-full border px-2 py-1 text-left text-xs transition ${item.done ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-border bg-surface-2 text-muted hover:bg-surface'}`}
              onClick={item.run}
              title={`${item.label}: ${item.detail}`}
            >
              <span className='font-medium'>{item.label}</span>
              <span className='ml-1 opacity-80'>{item.done ? '已亮' : '待补'}</span>
            </button>
          ))}
        </div>
        <div className='mt-2 text-[11px] text-muted'>
          {group.items.filter((item) => !item.done).slice(0, 3).map((item) => `${item.label}: ${item.detail}`).join(' · ') || '这一块已经可以支撑开写。'}
        </div>
      </div>
    )
  }

  return (
    <Card
      title='写作准备地图'
      extra={<Badge tone={doneCount === itemCount ? 'success' : 'warn'}>大重要 {majorDoneCount}/{groups.length} · 小节点 {doneCount}/{itemCount}</Badge>}
    >
      <div className='flex flex-col gap-3 lg:flex-row'>
        <div className='lg:w-64'>
          <div className='rounded-ui border border-border bg-surface p-3'>
            <div className='text-xs text-muted'>当前开写状态</div>
            <div className='mt-1 text-2xl font-semibold'>{majorDoneCount}/{groups.length}</div>
            <div className='text-xs text-muted'>大重要节点已亮起</div>
            <Button
              className='mt-3 w-full'
              variant={majorDoneCount >= 4 ? 'primary' : 'secondary'}
              onClick={onStartChapter}
            >
              开始写当前章
            </Button>
            <div className='mt-2 text-xs text-muted'>
              点击下面任意小节点，会跳到对应填写页；绿色表示已有材料，灰色表示缺失或还没被证据点亮。
            </div>
          </div>
        </div>
        <div className='grid flex-1 grid-cols-1 gap-2 xl:grid-cols-2'>
          {groups.map(renderGroup)}
        </div>
      </div>
    </Card>
  )
}
