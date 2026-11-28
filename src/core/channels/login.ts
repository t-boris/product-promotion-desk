// Mapping of a connector's login check to the account fields the rest of the application reads.

import type { AccountAccess, AccountStatus } from '../../shared/types'
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

/** Short plain-language summary of what a sign-in check saw, persisted on the account (DEC-095). Never holds secrets. */
export function loginCheckNote(state: LoginState, access: AccountAccess = 'browser'): string {
  const signal = state.signal?.trim() || ''
  const seen = signal ? ` (${signal})` : ''
  if (state.captcha) return `CAPTCHA requested${seen}`
  if (!state.loggedIn) return access === 'api' ? `Key not accepted${seen}` : `Not signed in${seen}`
  const identity = state.identity?.trim() || null
  if (identity) return access === 'api' ? `Connected as ${identity}` : `Signed in as ${identity}`
  return access === 'api' ? `Connected${seen}` : signal ? `Signed in${seen}` : 'Signed in (account name not shown)'
}
