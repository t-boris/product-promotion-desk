// The "Getting started" steps of an empty Attention page. Pure, so the order and the words are tested without the interface.

export interface StartStep {
  id: 'product' | 'account' | 'resume'
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
}

/** The three things that bring the app to work, in the order the owner does them; `done` says which are already behind. */
export function startSteps(facts: StartFacts): StartStep[] {
  return [
    {
      id: 'product',
      title: 'Add a product',
      hint: 'A name and a website or a short description. The app reads it and builds a passport you approve.',
      action: 'Add a product',
      href: '#/products',
      done: facts.products > 0
    },
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
