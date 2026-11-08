import { useEffect, useState } from 'react'
import type { AttentionItem, AttentionKind, Id } from '../../../shared/types'
import { useQuery } from '../hooks'
import { Badge, Button, EmptyState, ErrorNote, Loading, Page, type Tone } from '../ui'
import { ReviewCard } from './review/ReviewCard'

const KIND_LABEL: Record<AttentionKind, string> = {
  approval: 'Approval',
  draft: 'Draft',
  question: 'Question',
  login: 'Sign in',
  captcha: 'CAPTCHA',
  connection: 'Connection',
  error: 'Problem',
  unknown_result: 'Unknown result'
}

const KIND_TONE: Record<AttentionKind, Tone> = {
  approval: 'warn',
  draft: 'info',
  question: 'warn',
  login: 'bad',
  captcha: 'bad',
  connection: 'warn',
  error: 'bad',
  unknown_result: 'bad'
}

/** Where the owner fixes a problem that is not a decision about content. */
const FIX_LINK: Partial<Record<AttentionItem['refType'], { href: string; label: string }>> = {
  channel: { href: '#/channels', label: 'Open Channels' },
  account: { href: '#/channels', label: 'Open Channels' },
  product: { href: '#/products', label: 'Open Products' }
}

/**
 * One decision card. It loads its own card so that it keeps updating while the owner works on it, and it
 * stays on the page after an action (for example approved and waiting for Send, or sent with its link) until
 * the owner dismisses it, instead of vanishing from the list the moment it is no longer "waiting".
 */
function DecisionCard({ id, stillWaiting, onDismiss }: { id: Id; stillWaiting: boolean; onDismiss: () => void }) {
  const card = useQuery('opportunities.get', { id }, ['opportunities'])
  if (card.error && !card.data) return <ErrorNote error={card.error} />
  if (!card.data) return <Loading what="Loading" />
  return (
    <div className="stack">
      <ReviewCard card={card.data} />
      {!stillWaiting && (
        <div className="row">
          <span className="muted small">This item no longer needs a decision.</span>
          <Button onClick={onDismiss} data-testid="dismiss-card">
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}

export function AttentionPage() {
  const attention = useQuery('attention.list', undefined, ['attention', 'opportunities', 'channels', 'accounts'])
  const items = attention.data ?? []
  const decisionIds = [...new Set(items.filter((i) => i.refType === 'opportunity').map((i) => i.refId))]
  const problems = items.filter((i) => i.refType !== 'opportunity')

  // Everything that appeared stays until dismissed, in the order it first appeared.
  const [shown, setShown] = useState<Id[]>([])
  useEffect(() => {
    setShown((prev) => {
      const fresh = decisionIds.filter((id) => !prev.includes(id))
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [decisionIds.join(',')])
  const waiting = new Set(decisionIds)
  // Stable order: a card must not jump to the bottom when the owner approves it.
  const ordered = [...shown, ...decisionIds.filter((id) => !shown.includes(id))]

  return (
    <Page title="Attention" subtitle="Comments, drafts, questions and connection problems that need you">
      <ErrorNote error={attention.error} />
      {attention.loading && !attention.data && <Loading what="Loading" />}
      {attention.data && ordered.length === 0 && problems.length === 0 && <EmptyState title="Nothing needs you right now">New comments, drafts to approve and connection problems appear here.</EmptyState>}

      {problems.length > 0 && (
        <div className="stack" data-testid="problem-list">
          <h2>Connections and accounts</h2>
          {problems.map((item) => {
            const fix = FIX_LINK[item.refType]
            return (
              <div key={item.id} className="list-row" data-testid={`attention-${item.kind}`}>
                <div>
                  <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge> <strong>{item.title}</strong>
                  <div className="muted small">{item.detail}</div>
                </div>
                {fix && (
                  <a className="btn" href={fix.href}>
                    {fix.label}
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}

      {ordered.length > 0 && (
        <div className="stack" data-testid="decision-list">
          <h2>Needs your decision</h2>
          {ordered.map((id) => (
            <DecisionCard key={id} id={id} stillWaiting={waiting.has(id)} onDismiss={() => setShown((prev) => prev.filter((x) => x !== id))} />
          ))}
        </div>
      )}
    </Page>
  )
}
