import type { OpportunityCard } from '../../../../shared/types'
import { Badge, formatTime } from '../../ui'
import { SEND_STATE_LABEL, SEND_STATE_TONE, isHttpUrl } from './labels'

/**
 * What the owner approved and what happened when it was sent: the exact account and destination the approval
 * is bound to, and for a send the result link, platform id, time and the basis it was authorized on (REQ-004).
 */
export function ActionSummary({ card }: { card: OpportunityCard }) {
  const { approval, lastAction: action, accountLabel } = card
  if (!approval && !action) return null

  return (
    <div className="stack" data-testid="action-summary">
      {approval && !action?.completedAt && (
        <dl className="kv" data-testid="approval-summary">
          <dt>Approved</dt>
          <dd>
            {approval.approvedBy === 'user' ? 'By you' : `Automatically by rule ${approval.ruleId ?? ''}`} on {formatTime(approval.approvedAt)}
          </dd>
          <dt>Account</dt>
          <dd>{accountLabel}</dd>
          <dt>Destination</dt>
          <dd>
            <code>{approval.destination}</code>
          </dd>
        </dl>
      )}
      {action && (
        <dl className="kv" data-testid="send-summary">
          <dt>Last attempt</dt>
          <dd>
            <Badge tone={SEND_STATE_TONE[action.state]}>{SEND_STATE_LABEL[action.state]}</Badge> {formatTime(action.attemptedAt)}
          </dd>
          <dt>Authorized by</dt>
          <dd>{action.authorizationBasis}</dd>
          {action.state === 'confirmed' && (
            <>
              <dt>Published</dt>
              <dd>{formatTime(action.completedAt)}</dd>
              <dt>Link</dt>
              <dd>
                {isHttpUrl(action.resultUrl) ? (
                  <a href={action.resultUrl} target="_blank" rel="noreferrer" data-testid="result-link">
                    {action.resultUrl}
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
              </dd>
              <dt>Platform id</dt>
              <dd>
                <code>{action.resultExternalId ?? '—'}</code>
              </dd>
            </>
          )}
          {action.error && (
            <>
              <dt>{action.state === 'unknown' ? 'Why unknown' : 'Error'}</dt>
              <dd>{action.error}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
