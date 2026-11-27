import type { ReactNode } from 'react'
import type { PassportView } from '../../../../shared/types'
import { OVERVIEW_HREF, setupHref, type SetupTab } from '../../route'
import { useQuery } from '../../hooks'
import { AnalysisTab } from '../products/AnalysisTab'
import { AudienceWordsTab } from '../products/AudienceWordsTab'
import { PositioningTab } from '../products/PositioningTab'
import { GoalTab } from '../products/GoalTab'
import type { LaunchStage } from '../products/launch-path'
import { PassportTab } from '../products/PassportTab'
import { SourcesTab } from '../products/SourcesTab'
import { setupFacts, setupSteps } from './setup-steps'
import './setup.css'

const go = (hash: string): void => {
  window.location.hash = hash
}

/**
 * The launch path of Setup as a vertical stepper (DEC-037, phase C4): Sources, Passport, Analysis and Goal, one step open at a time, the open
 * one named by the address (`#/setup/<tab>`). A step is a row (its mark, its title, one line of what is in it, "Next" on the one the
 * launch path points at); the step that is open shows the tab it always was, below its row. The state of a step is the launch path's, so
 * the stepper, the path on the Inbox and the filled button name one next step (BUG-064, BUG-065).
 */
export function SetupStepper({ view, stages, open }: { view: PassportView; stages: LaunchStage[]; open: SetupTab }) {
  // Positioning and the audience's words are kept apart from the passport: their one-line summaries are read here.
  const positioning = useQuery('positioning.get', { productId: view.product.id }, ['products'])
  const words = useQuery('words.list', { productId: view.product.id }, ['products'])
  const steps = setupSteps(stages, {
    ...setupFacts(view),
    positioning: positioning.data ? (positioning.data.proposed ? 'proposed' : positioning.data.approved ? 'approved' : 'none') : undefined,
    words: words.data?.entries.length
  })
  const bodies: Record<SetupTab, () => ReactNode> = {
    sources: () => <SourcesTab view={view} />,
    passport: () => <PassportTab view={view} onOpenAnalysis={() => go(setupHref('analysis'))} />,
    analysis: () => <AnalysisTab view={view} />,
    positioning: () => <PositioningTab product={view.product} />,
    words: () => <AudienceWordsTab product={view.product} />,
    goal: () => <GoalTab product={view.product} onOpenResults={() => go(OVERVIEW_HREF)} />
  }
  return (
    <ol className="setup-steps" aria-label="Setup steps" data-testid="setup-steps">
      {steps.map((step) => {
        const isOpen = step.id === open
        const panel = `setup-step-panel-${step.id}`
        return (
          <li key={step.id} className={`setup-step ${step.state}${isOpen ? ' open' : ''}`} data-testid={`setup-step-${step.id}`} data-state={step.state}>
            {/* The name of the button is the step's title; what is in the step and "Next" are its description, so a screen reader and a UI test tool find "Passport", not a sentence. */}
            <button
              type="button"
              className="setup-step-head"
              aria-expanded={isOpen}
              aria-controls={isOpen ? panel : undefined}
              aria-current={isOpen ? 'step' : undefined}
              aria-labelledby={`setup-step-title-${step.id}`}
              aria-describedby={`setup-step-summary-${step.id}${step.state === 'current' ? ` setup-step-next-${step.id}` : ''}`}
              onClick={() => go(setupHref(step.id))}
              data-testid={`product-tab-${step.id}`}
            >
              <span className="setup-step-mark" aria-hidden="true" />
              <span className="setup-step-title" id={`setup-step-title-${step.id}`}>
                {step.label}
              </span>
              <span className={`setup-step-summary ${step.tone}`} id={`setup-step-summary-${step.id}`} data-testid={`setup-step-summary-${step.id}`}>
                {step.summary}
              </span>
              {step.state === 'current' && (
                <span className="launch-next" id={`setup-step-next-${step.id}`}>
                  Next
                </span>
              )}
            </button>
            {isOpen && (
              <div className="setup-step-body" id={panel} role="region" aria-label={`${step.label} step`}>
                {bodies[step.id]()}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
