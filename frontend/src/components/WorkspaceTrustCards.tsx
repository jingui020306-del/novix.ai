import { Card } from './ui/Card'

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

  return (
    <div className='grid grid-cols-2 gap-3'>
      <Card title='待确认事实'>
        <div className='space-y-1'>
          {pendingProposals.slice(-5).reverse().map((proposal) => {
            const proposalId = proposal.proposal_id || proposal.id || ''
            return (
              <button
                key={proposalId}
                className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
                onClick={() => onOpenProposal(proposalId)}
              >
                {proposal.name || proposalId}
              </button>
            )
          })}
          {!pendingProposals.length && <p className='text-sm text-muted'>没有待确认事实。</p>}
        </div>
      </Card>

      <Card title='未证实风险'>
        <div className='space-y-1'>
          {unsupportedMarks.slice(0, 5).map((mark) => (
            <button
              key={mark.mark_id}
              className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
              onClick={() => onOpenMark(mark.mark_id)}
            >
              {markTypeLabel[mark.target_type || ''] || '风险'} · {mark.label || mark.target_id}
            </button>
          ))}
          {!unsupportedMarks.length && <p className='text-sm text-muted'>当前章节没有未证实风险。</p>}
        </div>
      </Card>
    </div>
  )
}
