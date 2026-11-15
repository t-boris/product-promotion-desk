import type { Product } from '../../../../shared/types'
import { Icon } from '../../icons'
import { Button } from '../../ui'
import { startHeadline, startSteps } from '../attention-start'
import { launchStages, nextStage, type LaunchCounts } from '../products/launch-path'
import { LaunchPath } from '../products/LaunchPath'
import { productLabels } from '../products/product-labels'

/**
 * What to do next while the current product has no channel: Getting started leads the page (BUG-024), with a headline naming the
 * product, its launch path and one filled button for the next step, so "Add a product" appears once; "Nothing needs you right now"
 * is one line below it. The product's next stage of the path is the first open step, so the path's "Next" tag, the filled button
 * and the checklist agree (BUG-058). With no product at all the path starts at "Product". It leaves the page as soon as the product
 * has a channel (DEC-037): then the empty Inbox is just empty.
 */
export function GettingStarted({
  product,
  products,
  accounts,
  paused,
  counts,
  onResume
}: {
  /** The current product, or null when there is none. */
  product: Product | null
  products: Product[]
  accounts: number
  paused: boolean | undefined
  /** The product's channels and publications; the caller has waited for them, or a launched product would be sent to "Connect a channel". */
  counts: LaunchCounts
  onResume: () => void
}) {
  const stages = launchStages(product?.id ?? '', {
    hasSources: product !== null,
    passportApproved: product?.activePassportVersionId != null,
    goals: product?.goals.length ?? 0,
    ...counts
  })
  // The path's next stage leads the checklist, so the path, the filled button and the checklist name one step (BUG-058).
  const steps = startSteps({ products: products.length, accounts, paused, stage: product ? nextStage(stages) : null })
  const next = steps.find((step) => !step.done)
  if (!next) return null
  const label = product ? (productLabels(products).get(product.id) ?? product.name) : null
  return (
    <div className="gs" data-testid="attention-empty">
      <section className="card gs-hero" aria-label="Getting started" data-testid="attention-start">
        <p className="gs-eyebrow">Getting started</p>
        <h2 className="gs-headline">{startHeadline(label)}</h2>
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
