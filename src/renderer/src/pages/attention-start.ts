// The "Getting started" steps of an empty Attention page. Pure, so the order and the words are tested without the interface.

import type { LaunchStage, LaunchStageId } from './products/launch-path'

export interface StartStep {
  /** `launch` is the newest product's next stage of the launch path (BUG-058). */
  id: 'product' | 'launch' | 'account' | 'resume'
  title: string
  hint: string
  /** The words of the button that does the step. */
  action: string
  href: string
  done: boolean
}

export interface StartFacts {
  products: number
  accounts: number
  /** Undefined until the state of the automation arrived. */
  paused: boolean | undefined
  /** The next stage of the newest product's launch path (`nextStage`), null when it has none or there is no product. */
  stage?: LaunchStage | null
}

/**
 * The stages that are a step of Getting started. Publications are the work the app does once it is set up, so a path that has reached them
 * leaves the checklist to the account and the automation.
 */
const LAUNCH_STEP_STAGES: readonly LaunchStageId[] = ['product', 'passport', 'goal', 'channel']

/**
 * The things that bring the app to work, in the order the owner does them; `done` says which are already behind. The newest product's
 * next stage of the launch path comes right after "Add a product", ahead of the account and the automation, so the checklist, the filled
 * button under the path and the path's own "Next" tag all name the same step (BUG-058).
 */
export function startSteps(facts: StartFacts): StartStep[] {
  const stage = facts.stage && LAUNCH_STEP_STAGES.includes(facts.stage.id) ? facts.stage : null
  const launch: StartStep[] = stage ? [{ id: 'launch', title: stage.action, hint: stage.todo, action: stage.action, href: stage.href, done: false }] : []
  return [
    {
      id: 'product',
      title: 'Add a product',
      hint: 'A name and a website or a short description. The app reads it and builds a passport you approve.',
      action: 'Add a product',
      href: '#/products',
      done: facts.products > 0
    },
    ...launch,
    {
      id: 'account',
      title: 'Connect an account',
      hint: 'A login on a platform where the product will be mentioned. Nothing is posted without your approval.',
      action: 'Connect an account',
      href: '#/accounts/new',
      done: facts.accounts > 0
    },
    {
      id: 'resume',
      title: 'Resume automation',
      // The hint follows the state: a running automation is not "paused on purpose" (BUG-029). The title stays.
      hint:
        facts.paused === false
          ? 'Running: your channels are checked on schedule. You can pause it at any time from the top bar.'
          : 'While it is paused, nothing is checked or sent. It is paused on purpose until the first account is ready.',
      action: 'Resume automation',
      href: '#/attention',
      done: facts.paused === false
    }
  ]
}

/** The headline of the Getting started card: it names the product its launch path is about (BUG-058); with none yet it is the first one. */
export function startHeadline(productLabel: string | null): string {
  return productLabel === null ? 'Launch your first product' : `Launch ${productLabel}`
}
