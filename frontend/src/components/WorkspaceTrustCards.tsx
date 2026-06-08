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

  return (
    <div className='grid grid-cols-2 gap-3'>
      <Card title='待确认 Canon'>
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
          {!pendingProposals.length && <p className='text-sm text-muted'>没有待确认 canon proposal。</p>}
        </div>
      </Card>

      <Card title='可信风险'>
        <div className='space-y-1'>
          {unsupportedMarks.slice(0, 5).map((mark) => (
            <button
              key={mark.mark_id}
              className='w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-left text-xs hover:bg-surface-2'
              onClick={() => onOpenMark(mark.mark_id)}
            >
              {mark.target_type} · {mark.label || mark.target_id}
            </button>
          ))}
          {!unsupportedMarks.length && <p className='text-sm text-muted'>当前章节没有未证实风险。</p>}
        </div>
      </Card>
    </div>
  )
}
