import { Card } from './ui/Card'
import { Badge } from './ui/Badge'

type CanonProposal = {
  proposal_id?: string
  id?: string
  name?: string
  status?: string
}

type UnsupportedMark = {
  mark_id: string
  target_type?: string
  target_id?: string
  label?: string
}

type WorkspaceTrustCardsProps = {
  proposals: CanonProposal[]
  unsupportedMarks: UnsupportedMark[]
  onOpenProposal: (proposalId: string) => void
  onOpenMark: (markId: string) => void
}

export function WorkspaceTrustCards({ proposals, unsupportedMarks, onOpenProposal, onOpenMark }: WorkspaceTrustCardsProps) {
  const pendingProposals = proposals.filter((proposal) => (proposal.status || 'pending') === 'pending')
  const markTypeLabel: Record<string, string> = {
    character: '人物',
    technique: '技法',
    open_line: '明线',
    hidden_line: '暗线',
    foreshadowing: '伏笔',
    canon_fact: '事实',
    style_rule: '文风',
  }
  const proposalTitle = (proposal: CanonProposal) => proposal.name || proposal.proposal_id || proposal.id || '待确认内容'
  const riskTitle = (mark: UnsupportedMark) => {
    const kind = markTypeLabel[mark.target_type || ''] || '要求'
    return `${kind} · ${mark.label || mark.target_id || '需要回看'}`
  }

  return (
    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
      <Card title='待作者确认' extra={<Badge tone={pendingProposals.length ? 'warn' : 'success'}>{pendingProposals.length}</Badge>}>
        <div className='space-y-2'>
          <p className='text-xs text-muted'>AI 提出的新设定、新事实或剧情信息，确认后才会进入正式资料。</p>
          {pendingProposals.slice(-5).reverse().map((proposal) => {
            const proposalId = proposal.proposal_id || proposal.id || ''
            return (
              <button
                key={proposalId}
                className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
                onClick={() => onOpenProposal(proposalId)}
              >
                {proposalTitle(proposal)}
              </button>
            )
          })}
          {!pendingProposals.length && <p className='text-sm text-muted'>没有待确认内容，正式资料暂时干净。</p>}
        </div>
      </Card>

      <Card title='需要回看' extra={<Badge tone={unsupportedMarks.length ? 'warn' : 'success'}>{unsupportedMarks.length}</Badge>}>
        <div className='space-y-2'>
          <p className='text-xs text-muted'>这些要求还没有找到可靠正文依据，可以点开回看对应段落。</p>
          {unsupportedMarks.slice(0, 5).map((mark) => (
            <button
              key={mark.mark_id}
              className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
              onClick={() => onOpenMark(mark.mark_id)}
            >
              {riskTitle(mark)}
            </button>
          ))}
          {!unsupportedMarks.length && <p className='text-sm text-muted'>当前章节没有需要回看的要求。</p>}
        </div>
      </Card>
    </div>
  )
}
