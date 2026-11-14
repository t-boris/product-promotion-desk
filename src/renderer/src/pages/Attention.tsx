import { useEffect, useState } from 'react'
import type { AttentionKind, Id, Product } from '../../../shared/types'
import { useAutomation, useQuery } from '../hooks'
import { Badge, Button, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { fixLinkFor } from './attention-links'
import { KIND_TONE } from './attention-tone'
import { startSteps } from './attention-start'
import { launchStages } from './products/launch-path'
import { LaunchPath, useLaunchCounts } from './products/LaunchPath'
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
 * Nothing needs the owner: say so, and say what to do next (QA findings 1, 5, 6). While a start step is open, Getting started
 * leads the page (BUG-024): a headline, the launch path of the newest product and one filled button for the next step, so
 * "Add a product" appears once; "Nothing needs you right now" is one line below it. Once every step is done, the empty
 * state is the page, with the way to Opportunities.
 */
function NothingNeedsYou({ products, accounts, paused, onResume }: { products: Product[]; accounts: number; paused: boolean | undefined; onResume: () => void }) {
  const steps = startSteps({ products: products.length, accounts, paused })
  const next = steps.find((step) => !step.done)
  const countsOf = useLaunchCounts()
  if (!next) {
    return (
      <div className="stack" data-testid="attention-empty">
        <EmptyState
          fill
          art="inbox"
          title="Nothing needs you right now"
          action={
            <a className="btn" href="#/opportunities" data-testid="attention-next-opportunities">
              Open Opportunities
            </a>
          }
        >
          New comments, drafts to approve and connection problems appear here.
        </EmptyState>
      </div>
    )
  }
  // The newest product; with none yet, the path starts at "Product" and its links lead to the product page.
  const latest = products.reduce<Product | undefined>((newest, p) => (!newest || p.createdAt > newest.createdAt ? p : newest), undefined)
  const stages = launchStages(latest?.id ?? '', {
    hasSources: latest !== undefined,
    passportApproved: latest?.activePassportVersionId != null,
    goals: latest?.goals.length ?? 0,
    ...(latest ? countsOf(latest.id) : { channels: 0, approvedPublications: 0 })
  })
  return (
    <div className="stack" data-testid="attention-empty">
      <section className="card start-hero" aria-label="Getting started" data-testid="attention-start">
        <p className="start-eyebrow">Getting started</p>
        <h2 className="start-headline">Launch your first product</h2>
        <LaunchPath stages={stages} testId="attention-launch-path" />
        <div className="row">
          {next.id === 'resume' ? (
            <Button variant="primary" onClick={onResume} data-testid="attention-resume">
              Resume automation
            </Button>
          ) : (
            <a className="btn btn-primary" href={next.href} data-testid={`attention-next-${next.id}`}>
              {next.action}
            </a>
          )}
        </div>
        <ol className="start-steps">
          {steps.map((step) => (
            <li key={step.id} className={`${step.done ? 'done' : ''}${step === next ? ' next' : ''}`}>
              <span className="start-mark" aria-hidden="true">
                {step.done ? '✓' : ''}
              </span>
              <span className="start-text">
                <strong>{step.title}</strong>
                <span className="hint">{step.hint}</span>
              </span>
              {/* The next step's button is the filled one above; a later step keeps a plain one. */}
              {!step.done && step !== next && step.id !== 'resume' && (
                <a className="btn" href={step.href}>
                  {step.action}
                </a>
              )}
            </li>
          ))}
        </ol>
      </section>
      <p className="nothing-line" data-testid="attention-nothing">
        <strong>Nothing needs you right now</strong> · New comments, drafts to approve and connection problems appear here.
      </p>
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
        <NothingNeedsYou products={products.data} accounts={accounts.data.length} paused={automation?.paused} onResume={() => void setPaused(false)} />
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
