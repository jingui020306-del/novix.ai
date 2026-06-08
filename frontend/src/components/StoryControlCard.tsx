import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input, Textarea } from './ui/Fields'

type StoryCardRecord = {
  id?: string
  title?: string
  tags?: string[]
}

type ImportantScene = {
  scene?: string
  purpose?: string
  chapter?: string
}

type StoryPayload = {
  genre?: string
  keywords?: string[]
  target_reader?: string
  platform_style?: string
  logline?: string
  theme?: string
  worldview?: string
  main_conflict?: string
  banned_items?: string[]
  important_scenes?: ImportantScene[]
}

type StoryControlCardProps = {
  storyForm?: StoryCardRecord | null
  storyPayload: StoryPayload
  storyCards: StoryCardRecord[]
  onNewStory: () => void
  onSaveStory: () => void
  onSelectStory: (card: StoryCardRecord) => void
  onUpdateRoot: (key: string, value: unknown) => void
  onUpdatePayload: (key: string, value: unknown) => void
  onAddImportantScene: () => void
  onUpdateImportantScene: (index: number, key: string, value: unknown) => void
  onRemoveImportantScene: (index: number) => void
}

function splitCsv(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function splitLines(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

export function StoryControlCard({
  storyForm,
  storyPayload,
  storyCards,
  onNewStory,
  onSaveStory,
  onSelectStory,
  onUpdateRoot,
  onUpdatePayload,
  onAddImportantScene,
  onUpdateImportantScene,
  onRemoveImportantScene,
}: StoryControlCardProps) {
  return (
    <>
      <Card
        title='故事卡 / Story Control'
        extra={
          <div className='flex gap-2'>
            <Button onClick={onNewStory}>新建故事卡</Button>
            <Button variant='primary' onClick={onSaveStory}>保存故事卡</Button>
          </div>
        }
      >
        <div className='grid grid-cols-12 gap-3'>
          <div className='col-span-3'>
            <label className='text-xs text-muted'>ID</label>
            <Input value={storyForm?.id || ''} onChange={(event) => onUpdateRoot('id', event.target.value)} />
          </div>
          <div className='col-span-4'>
            <label className='text-xs text-muted'>标题</label>
            <Input value={storyForm?.title || ''} onChange={(event) => onUpdateRoot('title', event.target.value)} />
          </div>
          <div className='col-span-3'>
            <label className='text-xs text-muted'>类型/题材</label>
            <Input value={storyPayload.genre || ''} onChange={(event) => onUpdatePayload('genre', event.target.value)} />
          </div>
          <div className='col-span-2'>
            <label className='text-xs text-muted'>Tags</label>
            <Input value={(storyForm?.tags || []).join(',')} onChange={(event) => onUpdateRoot('tags', splitCsv(event.target.value))} />
          </div>
          <div className='col-span-4'>
            <label className='text-xs text-muted'>关键词</label>
            <Input value={(storyPayload.keywords || []).join(',')} onChange={(event) => onUpdatePayload('keywords', splitCsv(event.target.value))} />
          </div>
          <div className='col-span-4'>
            <label className='text-xs text-muted'>目标读者</label>
            <Input value={storyPayload.target_reader || ''} onChange={(event) => onUpdatePayload('target_reader', event.target.value)} />
          </div>
          <div className='col-span-4'>
            <label className='text-xs text-muted'>平台风格</label>
            <Input value={storyPayload.platform_style || ''} onChange={(event) => onUpdatePayload('platform_style', event.target.value)} />
          </div>
          <div className='col-span-6'>
            <label className='text-xs text-muted'>一句话故事</label>
            <Textarea className='h-20' value={storyPayload.logline || ''} onChange={(event) => onUpdatePayload('logline', event.target.value)} />
          </div>
          <div className='col-span-6'>
            <label className='text-xs text-muted'>主题</label>
            <Textarea className='h-20' value={storyPayload.theme || ''} onChange={(event) => onUpdatePayload('theme', event.target.value)} />
          </div>
          <div className='col-span-6'>
            <label className='text-xs text-muted'>世界/背景</label>
            <Textarea className='h-24' value={storyPayload.worldview || ''} onChange={(event) => onUpdatePayload('worldview', event.target.value)} />
          </div>
          <div className='col-span-6'>
            <label className='text-xs text-muted'>总冲突</label>
            <Textarea className='h-24' value={storyPayload.main_conflict || ''} onChange={(event) => onUpdatePayload('main_conflict', event.target.value)} />
          </div>
          <div className='col-span-6'>
            <label className='text-xs text-muted'>禁写事项</label>
            <Textarea className='h-24' value={(storyPayload.banned_items || []).join('\n')} onChange={(event) => onUpdatePayload('banned_items', splitLines(event.target.value))} />
          </div>
          <div className='col-span-6 space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <label className='text-xs text-muted'>重要场景</label>
              <Button className='text-xs' onClick={onAddImportantScene}>新增场景</Button>
            </div>
            {(storyPayload.important_scenes || []).map((row, index) => (
              <div key={`story-scene-${index}`} className='rounded-ui border border-border bg-surface p-2'>
                <div className='grid grid-cols-12 gap-2'>
                  <div className='col-span-4'>
                    <label className='text-xs text-muted'>场景</label>
                    <Input value={row.scene || ''} onChange={(event) => onUpdateImportantScene(index, 'scene', event.target.value)} />
                  </div>
                  <div className='col-span-5'>
                    <label className='text-xs text-muted'>作用</label>
                    <Input value={row.purpose || ''} onChange={(event) => onUpdateImportantScene(index, 'purpose', event.target.value)} />
                  </div>
                  <div className='col-span-3'>
                    <label className='text-xs text-muted'>章节</label>
                    <Input value={row.chapter || ''} onChange={(event) => onUpdateImportantScene(index, 'chapter', event.target.value)} />
                  </div>
                </div>
                <div className='mt-2 flex justify-end'>
                  <Button className='text-xs' onClick={() => onRemoveImportantScene(index)}>删除</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title='已有故事卡'>
        <div className='flex flex-wrap gap-2'>
          {storyCards.map((card) => (
            <Button key={card.id} onClick={() => onSelectStory(card)}>{card.title || card.id}</Button>
          ))}
          {!storyCards.length && <p className='text-sm text-muted'>暂无故事卡，保存后会出现在这里。</p>}
        </div>
      </Card>
    </>
  )
}
