// Mapping of a connector's login check to the account fields the rest of the application reads.

import type { AccountStatus } from '../../shared/types'
import type { LoginState } from '../ports'

export interface LoginOutcome {
  status: AccountStatus
  /** The identity confirmed by this check; null when not signed in or not determinable. */
  identity: string | null
  detail: string
}

export function loginOutcome(state: LoginState): LoginOutcome {
  const seen = state.signal ? ` (${state.signal})` : ''
  if (state.captcha) {
    return { status: 'captcha', identity: null, detail: `The site asks for a human check (CAPTCHA)${seen}. Open the browser and complete it on the page.` }
  }
  if (!state.loggedIn) {
    return { status: 'login_required', identity: null, detail: `Not signed in${seen}. Open the browser and sign in on the site itself.` }
  }
  const identity = state.identity?.trim() || null
  return { status: 'ready', identity, detail: identity ? `Signed in as ${identity}.` : `Signed in, but the site did not reveal the account name${seen}.` }
}
