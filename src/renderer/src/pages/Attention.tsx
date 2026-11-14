import { useEffect, useState } from 'react'
import type { AttentionKind, Id, Product } from '../../../shared/types'
import { useAutomation, useQuery } from '../hooks'
import { Icon } from '../icons'
import { Badge, Button, Card, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { fixLinkFor } from './attention-links'
import { KIND_TONE } from './attention-tone'
import { startSteps } from './attention-start'
import { launchStages } from './products/launch-path'
import { LaunchPath, useLaunchCounts } from './products/LaunchPath'
import { useMainActionOwner } from './review/main-action'
import { useProductDirectory, type ProductDirectory } from './review/products'
import { ReviewCard } from './review/ReviewCard'
import './attention.css'

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
function DecisionCard({
  id,
  stillWaiting,
  onDismiss,
  directory,
  primaryAction,
  onMainAction
}: {
  id: Id
  stillWaiting: boolean
  onDismiss: () => void
  directory: ProductDirectory
  /** The first card that shows a main action owns the screen's filled button. */
  primaryAction: boolean
  onMainAction: (id: Id, offering: boolean) => void
}) {
  const card = useQuery('opportunities.get', { id }, ['opportunities'])
  if (card.error && !card.data) return <ErrorNote error={card.error} />
  if (!card.data) return <Loading what="Loading" />
  return (
    <ReviewCard
      card={card.data}
      productName={directory.productNameOfChannel(card.data.opportunity.channelId)}
      primaryAction={primaryAction}
      onMainAction={onMainAction}
      footer={
        !stillWaiting && (
          <>
            <span className="review-foot-note">This item no longer needs a decision.</span>
            <Button onClick={onDismiss} data-testid="dismiss-card">
              Dismiss
            </Button>
          </>
        )
      }
    />
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
      <div className="gs" data-testid="attention-empty">
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
    <div className="gs" data-testid="attention-empty">
      <section className="card gs-hero" aria-label="Getting started" data-testid="attention-start">
        <p className="gs-eyebrow">Getting started</p>
        <h2 className="gs-headline">Launch your first product</h2>
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
        <ol className="gs-steps">
          {steps.map((step) => (
            <li key={step.id} className={`${step.done ? 'done' : ''}${step === next ? ' next' : ''}`}>
              <span className="gs-mark" aria-hidden="true">
                {step.done && <Icon name="check" small />}
              </span>
              <span className="gs-text">
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
      <p className="gs-nothing" data-testid="attention-nothing">
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
  // The first card that shows a main action (Approve, Send now) has the screen's one filled button.
  const mainAction = useMainActionOwner(ordered)

  return (
    <Page title="Attention" subtitle="Comments, drafts, questions and connection problems that need you">
      <ErrorNote error={attention.error} />
      {attention.loading && !attention.data && <Loading what="Loading" />}
      {attention.data && ordered.length === 0 && problems.length === 0 && products.data && accounts.data && (
        <NothingNeedsYou products={products.data} accounts={accounts.data.length} paused={automation?.paused} onResume={() => void setPaused(false)} />
      )}

      {problems.length > 0 && (
        <div data-testid="problem-list">
          <Card title="Connections and accounts">
            <div className="rows">
              {problems.map((item) => {
                const fix = fixLinkFor(item, links)
                return (
                  <div key={item.id} className="problem-row" data-testid={`attention-${item.kind}`}>
                    <div className="problem-main">
                      <div className="problem-title">
                        <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                        <strong>{item.title}</strong>
                      </div>
                      <div className="problem-line">{item.detail}</div>
                      {fix?.productName && <div className="problem-line">Product: {fix.productName}</div>}
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
          </Card>
        </div>
      )}

      {ordered.length > 0 && (
        <section className="review-section" data-testid="decision-list">
          <h2>Needs your decision</h2>
          <div className="review-list">
            {ordered.map((id) => (
              <DecisionCard
                key={id}
                id={id}
                stillWaiting={waiting.has(id)}
                onDismiss={() => setShown((prev) => prev.filter((x) => x !== id))}
                directory={directory}
                primaryAction={mainAction.isOwner(id)}
                onMainAction={mainAction.offer}
              />
            ))}
          </div>
        </section>
      )}
    </Page>
  )
}
