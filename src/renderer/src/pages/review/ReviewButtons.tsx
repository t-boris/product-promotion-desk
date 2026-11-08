import type { DraftInput } from '../../../../shared/api'
import type { OpportunityCard } from '../../../../shared/types'
import { Button } from '../../ui'
import { LOCKED_STATES, PREPARABLE_STATES } from './labels'
import { ResolveUnknown } from './ResolveUnknown'
import type { ReviewActions } from './useReviewActions'

interface Props {
  card: OpportunityCard
  actions: ReviewActions
  dirty: boolean
  /** The form as it stands; approving saves it first so the approval covers exactly what is on screen. */
  input: DraftInput
}

/** The buttons of a review card, chosen by the state of the item so the owner only sees what makes sense. */
export function ReviewButtons({ card, actions, dirty, input }: Props) {
  const { opportunity: opp } = card
  const id = opp.id
  const hasText = input.text.trim().length > 0 || Boolean(input.link) || (input.attachments?.length ?? 0) > 0
  const editable = !LOCKED_STATES.includes(opp.state) && opp.state !== 'analyzing' && opp.state !== 'cancelled'
  const { busy } = actions

  if (opp.state === 'unknown_result') {
    return (
      <div className="stack">
        <div className="row">
          <Button variant="primary" onClick={() => void actions.reconcile(id)} disabled={busy} data-testid="reconcile">
            Check the platform
          </Button>
          <span className="muted small">Looks for the reply on the platform. It is never sent a second time before the result is known.</span>
        </div>
        <ResolveUnknown id={id} actions={actions} />
      </div>
    )
  }
  if (!editable) return null

  const readyAndUnchanged = opp.state === 'ready' && !dirty
  const approveLabel = dirty ? 'Save and approve' : 'Approve'
  return (
    <div className="row" data-testid="review-buttons">
      {readyAndUnchanged ? (
        <Button variant="primary" onClick={() => void actions.send(id)} disabled={busy} data-testid="send">
          Send now
        </Button>
      ) : (
        <>
          <Button variant="primary" onClick={() => void actions.approve(id, dirty ? input : undefined)} disabled={busy || !hasText} data-testid="approve">
            {approveLabel}
          </Button>
          <Button onClick={() => void actions.approveAndSend(id, dirty ? input : undefined)} disabled={busy || !hasText} data-testid="approve-send">
            {approveLabel} and send
          </Button>
        </>
      )}
      {dirty && (
        <Button onClick={() => void actions.save(id, input)} disabled={busy || !hasText} data-testid="save-draft">
          Save draft
        </Button>
      )}
      {PREPARABLE_STATES.includes(opp.state) && opp.kind === 'reply' && (
        <Button onClick={() => void actions.prepare(id)} disabled={busy} data-testid="prepare">
          {card.draft ? 'Redo with AI' : 'Draft with AI'}
        </Button>
      )}
      {opp.state !== 'deferred' && (
        <Button onClick={() => void actions.defer(id)} disabled={busy} data-testid="defer">
          Defer
        </Button>
      )}
      <Button variant="danger" onClick={() => void actions.reject(id)} disabled={busy} data-testid="reject">
        Reject
      </Button>
    </div>
  )
}
