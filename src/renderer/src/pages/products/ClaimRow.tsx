import { useState } from 'react'
import type { Claim, ClaimStatus } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote, formatTime } from '../../ui'
import { ClaimForm } from './ClaimForm'
import { KIND_HELP, KIND_LABELS, KIND_TONES, SECTION_LABELS, STATUS_LABELS, STATUS_TONES } from './labels'
import { conflicting } from './model'

/** One statement of the passport with everything the user needs to judge it: type, status, sources and dates. */
export function ClaimRow({ claim, all, productId }: { claim: Claim; all: Claim[]; productId: string }) {
  const [editing, setEditing] = useState(false)
  const [setStatus, statusState] = useAction((status: ClaimStatus) => call('passport.claim.setStatus', { claimId: claim.id, status }))
  const [remove, removeState] = useAction(() => call('passport.claim.delete', { claimId: claim.id }))
  const busy = statusState.busy || removeState.busy
  const others = conflicting(claim, all)
  const isContradiction = claim.kind === 'contradiction'
  // Prohibited or rejected statements stay visible but are not usable; unknowns and contradictions cannot be approved as they are.
  const canApprove = claim.status !== 'approved' && claim.kind !== 'unknown' && !isContradiction

  if (editing) {
    return (
      <div className="claim" data-testid={`claim-${claim.id}`}>
        <ClaimForm productId={productId} section={claim.section} claim={claim} onDone={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <div className={`claim claim-${claim.status}${isContradiction ? ' claim-contradiction' : ''}`} data-testid={`claim-${claim.id}`} data-kind={claim.kind} data-status={claim.status}>
      <div className="claim-head">
        <div className="row">
          <span title={KIND_HELP[claim.kind]}>
            <Badge tone={KIND_TONES[claim.kind]}>{KIND_LABELS[claim.kind]}</Badge>
          </span>
          <Badge tone={STATUS_TONES[claim.status]}>{STATUS_LABELS[claim.status]}</Badge>
          {claim.unconfirmedAvailability && (
            <span title="This capability was found only in the project code. Confirm that users can actually use it before it is presented as available.">
              <Badge tone="warn">Unconfirmed availability</Badge>
            </span>
          )}
        </div>
      </div>
      <p className={`claim-text${claim.status === 'rejected' ? ' struck' : ''}`}>{claim.text}</p>

      {isContradiction && others.length > 0 && (
        <div className="conflict-box" data-testid={`conflict-${claim.id}`}>
          <div className="small muted">Sources disagree. Neither version has been chosen:</div>
          <ul>
            {others.map((other) => (
              <li key={other.id}>
                <span className="muted small">{SECTION_LABELS[other.section]}: </span>
                {other.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!isContradiction && others.length > 0 && (
        <div className="small warn-text" data-testid={`conflicts-with-${claim.id}`}>
          Conflicts with another statement: {others.map((o) => o.text).join(' / ')}
        </div>
      )}

      {claim.kind === 'fact' || claim.sources.length > 0 ? (
        <ul className="claim-sources" data-testid={`claim-sources-${claim.id}`}>
          {claim.sources.map((s) => (
            <li key={`${s.sourceId ?? ''}|${s.ref}`}>
              <span className="source-ref">{s.ref}</span> <span className="muted small">checked {formatTime(s.verifiedAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted small" data-testid={`claim-nosource-${claim.id}`}>
          {claim.kind === 'assumption' ? 'No source: this is a guess, not a verified fact.' : claim.kind === 'unknown' ? 'No source provides this yet.' : ''}
        </div>
      )}

      <ErrorNote error={statusState.error ?? removeState.error} />
      <div className="row claim-actions">
        {canApprove && (
          <Button onClick={() => void setStatus('approved')} disabled={busy} data-testid={`claim-approve-${claim.id}`}>
            Approve
          </Button>
        )}
        {claim.status !== 'rejected' && (
          <Button onClick={() => void setStatus('rejected')} disabled={busy} data-testid={`claim-reject-${claim.id}`}>
            {isContradiction ? 'Not a conflict' : 'Reject'}
          </Button>
        )}
        {claim.status !== 'prohibited' && !isContradiction && (
          <Button onClick={() => void setStatus('prohibited')} disabled={busy} title="Never to be said in promotion" data-testid={`claim-prohibit-${claim.id}`}>
            Prohibit
          </Button>
        )}
        {claim.status !== 'proposed' && (
          <Button onClick={() => void setStatus('proposed')} disabled={busy} data-testid={`claim-reopen-${claim.id}`}>
            Back to review
          </Button>
        )}
        <Button onClick={() => setEditing(true)} disabled={busy} data-testid={`claim-edit-${claim.id}`}>
          {isContradiction ? 'Settle…' : 'Edit'}
        </Button>
        <Button variant="danger" onClick={() => void remove()} disabled={busy} data-testid={`claim-delete-${claim.id}`}>
          Delete
        </Button>
      </div>
    </div>
  )
}
