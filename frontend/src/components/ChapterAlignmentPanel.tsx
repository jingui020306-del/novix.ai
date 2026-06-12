import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Textarea } from './ui/Fields'

type AlignmentMessage = {
  role?: string
  text?: string
  created_at?: string
}

type AlignmentVersion = {
  version_id?: string
  text?: string
  created_at?: string
  source?: string
}

type ChapterAlignmentPanelProps = {
  agreedDraft: string
  canGenerate: boolean
  confirmed: boolean
  discussionInput: string
  idea: string
  messages: AlignmentMessage[]
  understanding: string
  versions: AlignmentVersion[]
  onConfirm: () => void
  onFocus: () => void
  onGenerateUnderstanding: () => void
  onMergeIntoAgreement: () => void
  onRunWithAgreement: () => void
  onSaveAgreement: () => void
  onSaveIdea: () => void
  onSelectCurrentUnderstanding: (text: string) => void
  onSendMessage: () => void
  onUseVersionAsAgreement: (text: string) => void
  setAgreedDraft: (text: string) => void
  setConfirmed: (confirmed: boolean) => void
  setDiscussionInput: (text: string) => void
  setIdea: (text: string) => void
}

export function ChapterAlignmentPanel({
  agreedDraft,
  canGenerate,
  confirmed,
  discussionInput,
  idea,
  messages,
  understanding,
  versions,
  onConfirm,
  onFocus,
  onGenerateUnderstanding,
  onMergeIntoAgreement,
  onRunWithAgreement,
  onSaveAgreement,
  onSaveIdea,
  onSelectCurrentUnderstanding,
  onSendMessage,
  onUseVersionAsAgreement,
  setAgreedDraft,
  setConfirmed,
  setDiscussionInput,
  setIdea,
}: ChapterAlignmentPanelProps) {
  const ready = Boolean(confirmed && agreedDraft.trim())
  const writeReady = ready && canGenerate
  const statusTone = ready ? 'success' : understanding.trim() ? 'warn' : 'default'
  const statusText = ready ? '作者已确认' : understanding.trim() ? '待确认' : '未开始'
  const stepRows = [
    ['01', '作者原始想法', idea.trim(), 'module-author'],
    ['02', '对话调整', messages.length, 'module-chat'],
    ['03', 'AI 理解缓存', versions.length, 'module-ai'],
  ]

  return (
    <Card
      title='写作共识'
      extra={<Badge tone={statusTone}>{statusText}</Badge>}
      className='module-card module-author'
    >
      <div className='mb-3 grid grid-cols-1 gap-3 text-xs xl:grid-cols-[1.05fr_1fr_.9fr]'>
        {stepRows.map(([num, label, done, tone]: any) => (
          <div key={label} className={`module-card ${tone} flex h-14 flex-col justify-center rounded-ui border px-3 py-2 ${done ? '' : 'opacity-80'}`}>
            <div className='text-[11px] text-muted'>{num}</div>
            <div className='font-display truncate font-medium'>{label}</div>
          </div>
        ))}
      </div>

      <div className='grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_1fr_.9fr]'>
        <div className='space-y-3'>
          <div>
            <div className='mb-1 flex items-center justify-between gap-2'>
              <label className='font-display text-sm font-medium'>作者原始想法</label>
              <Button className='text-xs' onClick={onSaveIdea}>保存想法</Button>
            </div>
            <Textarea
              className='font-writing min-h-[360px] resize-y bg-amber-50/60 text-[15px] leading-7 dark:bg-amber-950/20'
              value={idea}
              onFocus={onFocus}
              onChange={(e) => {
                setIdea(e.target.value)
                setConfirmed(false)
              }}
              placeholder='这里保留作者最原始的想法，不需要完整：这一章想写什么、人物什么感觉、哪里不要太快揭露。'
            />
          </div>
        </div>

        <div className='space-y-3'>
          <div className='module-card module-chat min-h-[220px] max-h-[220px] space-y-2 overflow-auto rounded-ui border p-2'>
            {messages.map((msg, idx) => (
              <div key={`${msg.created_at || idx}:${idx}`} className={`max-w-[92%] rounded-ui border p-2 text-xs ${msg.role === 'author' ? 'ml-auto border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-teal-300 bg-teal-50 dark:bg-teal-950/20'}`}>
                <div className='font-display mb-1 font-medium'>{msg.role === 'author' ? '作者' : 'AI'}</div>
                <div className='whitespace-pre-wrap text-muted'>{msg.text}</div>
              </div>
            ))}
            {!messages.length && <p className='text-xs text-muted'>先补充你想调整的地方，AI 的回应会留在这里。</p>}
          </div>
          <div>
            <Textarea
              className='min-h-[110px] resize-y'
              value={discussionInput}
              onFocus={onFocus}
              onChange={(e) => setDiscussionInput(e.target.value)}
              placeholder='继续补充：比如这章更压抑、某人不能主动坦白、结尾留下误会。'
            />
            <div className='mt-2 flex flex-wrap gap-2'>
              <Button onClick={onSendMessage}>发送</Button>
              <Button onClick={onGenerateUnderstanding}>让 AI 整理理解</Button>
            </div>
          </div>
        </div>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-2'>
            <label className='font-display text-sm font-medium'>AI 理解缓存</label>
            <Button className='text-xs' onClick={onGenerateUnderstanding}>新增一版</Button>
          </div>
          <div className='module-card module-ai min-h-[360px] max-h-[360px] space-y-2 overflow-auto rounded-ui border p-2'>
            {versions.map((version, idx) => (
              <div key={version.version_id || idx} className='rounded-ui border border-border bg-surface p-2 text-xs'>
                <div className='mb-1 flex items-center justify-between gap-2'>
                  <span className='font-display font-medium'>AI #{versions.length - idx}</span>
                  <Badge>{version.source || 'AI'}</Badge>
                </div>
                <div className='mb-2 whitespace-pre-wrap text-muted line-clamp-6'>{version.text}</div>
                <div className='flex flex-wrap gap-1'>
                  <Button className='text-xs' onClick={() => onUseVersionAsAgreement(version.text || '')}>带入最终稿</Button>
                  <Button className='text-xs' onClick={() => onSelectCurrentUnderstanding(version.text || '')}>设为当前</Button>
                </div>
                {version.created_at ? <div className='mt-1 text-[10px] text-muted'>{version.created_at}</div> : null}
              </div>
            ))}
            {!versions.length && <p className='text-xs text-muted'>AI 每次整理后的版本会留在这里，最多保留 6 个。</p>}
            {versions.length ? <p className='text-[11px] text-muted'>最多保留最近 6 个版本。</p> : null}
          </div>
        </div>
      </div>

      <div className='module-card module-draft mt-3 rounded-ui border p-3'>
        <div className='mb-1 flex items-center justify-between gap-2'>
          <label className='font-display text-sm font-medium'>最终确认稿</label>
          <Badge tone={ready ? 'success' : 'warn'}>{ready ? '已确认' : '等作者确认'}</Badge>
        </div>
        <Textarea
          className='font-writing min-h-[190px] resize-y whitespace-pre-wrap bg-white/80 text-[15px] leading-7 dark:bg-slate-950/30'
          value={agreedDraft}
          onFocus={onFocus}
          onChange={(e) => {
            setAgreedDraft(e.target.value)
            setConfirmed(false)
          }}
          placeholder='最后一步才改这里：作者从右侧挑一版，或自己重写成最终开写要求。'
        />
        <div className='mt-2 flex flex-wrap gap-2'>
          <Button onClick={onMergeIntoAgreement} disabled={!understanding.trim() && !messages.length}>带入当前 AI 理解</Button>
          <Button onClick={onConfirm}>确认写法</Button>
          <Button onClick={onSaveAgreement}>保存共识</Button>
          <Button variant='primary' onClick={onRunWithAgreement} disabled={!writeReady}>按这个写初稿</Button>
        </div>
        {!writeReady ? <div className='mt-2 text-xs text-muted'>确认写法并补齐开写检查后，才能开始写初稿。</div> : null}
      </div>
    </Card>
  )
}
