import { useEffect, useState } from 'react'
import type { AttentionKind, Id } from '../../../shared/types'
import { useAutomation, useQuery } from '../hooks'
import { Badge, Button, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { fixLinkFor } from './attention-links'
import { KIND_TONE } from './attention-tone'
import { startSteps } from './attention-start'
import { useProductDirectory, type ProductDirectory } from './review/products'
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

/**
 * One decision card. It loads its own card so that it keeps updating while the owner works on it, and it
 * stays on the page after an action (for example approved and waiting for Send, or sent with its link) until
 * the owner dismisses it, instead of vanishing from the list the moment it is no longer "waiting".
 */
function DecisionCard({ id, stillWaiting, onDismiss, directory }: { id: Id; stillWaiting: boolean; onDismiss: () => void; directory: ProductDirectory }) {
  const card = useQuery('opportunities.get', { id }, ['opportunities'])
  if (card.error && !card.data) return <ErrorNote error={card.error} />
  if (!card.data) return <Loading what="Loading" />
  return (
    <div className="stack">
      <ReviewCard card={card.data} productName={directory.productNameOfChannel(card.data.opportunity.channelId)} />
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

/**
 * Nothing needs the owner: say so, and say what to do next (QA findings 1, 5, 6). The next step comes from the state of the app
 * (no product, no account, automation paused), so the page is never a thin strip with a sentence in it.
 */
function NothingNeedsYou({ products, accounts, paused, onResume }: { products: number; accounts: number; paused: boolean | undefined; onResume: () => void }) {
  const steps = startSteps({ products, accounts, paused })
  const next = steps.find((step) => !step.done)
  return (
    <div className="stack" data-testid="attention-empty">
      <EmptyState
        fill
        title="Nothing needs you right now"
        action={
          next ? (
            next.id === 'resume' ? (
              <Button variant="primary" onClick={onResume} data-testid="attention-resume">
                Resume automation
              </Button>
            ) : (
              <a className="btn btn-primary" href={next.href} data-testid={`attention-next-${next.id}`}>
                {next.action}
              </a>
            )
          ) : (
            <a className="btn" href="#/opportunities" data-testid="attention-next-opportunities">
              Open Opportunities
            </a>
          )
        }
      >
        New comments, drafts to approve and connection problems appear here.
      </EmptyState>
      {next && (
        <section className="card" aria-label="Getting started" data-testid="attention-start">
          <h2>Getting started</h2>
          <ol className="start-steps">
            {steps.map((step) => (
              <li key={step.id} className={step.done ? 'done' : ''}>
                <span className="start-mark" aria-hidden="true">
                  {step.done ? '✓' : ''}
                </span>
                <span className="start-text">
                  <strong>{step.title}</strong>
                  <span className="hint">{step.hint}</span>
                </span>
                {!step.done && step.id !== 'resume' && (
                  <a className="btn" href={step.href}>
                    {step.action}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

export function AttentionPage() {
  const attention = useQuery('attention.list', undefined, ['attention', 'opportunities', 'channels', 'accounts'])
  const directory = useProductDirectory()
  // A channel problem links to its product's Channels tab; an account problem links to the Accounts section (DEC-015).
  const channels = useQuery('channels.list', undefined, ['channels'])
  const products = useQuery('products.list', undefined, ['products'])
  const links = { channels: channels.data ?? [], products: products.data ?? [] }
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const { state: automation, setPaused } = useAutomation()
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
      {attention.data && ordered.length === 0 && problems.length === 0 && products.data && accounts.data && (
        <NothingNeedsYou products={products.data.length} accounts={accounts.data.length} paused={automation?.paused} onResume={() => void setPaused(false)} />
      )}

      {problems.length > 0 && (
        <div className="stack" data-testid="problem-list">
          <h2>Connections and accounts</h2>
          {problems.map((item) => {
            const fix = fixLinkFor(item, links)
            return (
              <div key={item.id} className="list-row" data-testid={`attention-${item.kind}`}>
                <div>
                  <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge> <strong>{item.title}</strong>
                  <div className="muted small">{item.detail}</div>
                  {fix?.productName && <div className="muted small">Product: {fix.productName}</div>}
                </div>
                {fix && (
                  <a className="btn" href={fix.href} data-testid={`attention-link-${item.kind}`}>
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
            <DecisionCard key={id} id={id} stillWaiting={waiting.has(id)} onDismiss={() => setShown((prev) => prev.filter((x) => x !== id))} directory={directory} />
          ))}
        </div>
      )}
    </Page>
  )
}
