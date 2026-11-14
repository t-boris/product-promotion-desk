// The words of the status row in the top bar. One place for them, so the text a person sees and the name a screen reader or a
// UI test tool reads from the accessibility tree ("AI engine: Codex", "Accounts: None connected", "Automation running") cannot drift apart.

export interface EngineLike {
  label: string
}

import type { AccountStatus } from '../../shared/types'
import type { Tone } from './tone'

export interface AccountLike {
  label: string
  identity?: string | null
}

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  ready: 'Signed in',
  login_required: 'Sign-in needed',
  captcha: 'CAPTCHA to solve',
  suspended: 'Suspended by the platform'
}

export const NO_ENGINE = 'None selected'
export const NO_ACCOUNTS = 'None connected'

/** What an account badge says: the name, and the login name after it when the account has one. */
export function accountText(account: AccountLike): string {
  return `${account.label}${account.identity ? ` · ${account.identity}` : ''}`
}

/** The accessible name of the AI engine group: label and value as one statement. */
export function engineGroupName(engine: EngineLike | undefined): string {
  return `AI engine: ${engine ? engine.label : NO_ENGINE}`
}

/** The accessible name of the accounts group. */
export function accountsGroupName(accounts: readonly AccountLike[] | undefined): string {
  return `Accounts: ${accounts && accounts.length > 0 ? accounts.map(accountText).join(', ') : NO_ACCOUNTS}`
}

/** The automation state as one sentence; "…" while the state has not arrived yet. */
export function automationText(state: { paused: boolean } | null | undefined): string {
  return `Automation ${state ? (state.paused ? 'paused' : 'running') : '…'}`
}

/**
 * The one badge of the top bar for every account (BUG-023): "3 ready", or "3 · 1 needs sign-in" while some wait for the
 * owner, so the bar stays one line whatever the number of accounts. The tooltip lists every account with its state.
 * Null with no accounts: the bar then keeps "None connected".
 */
export function accountsSummary(accounts: readonly (AccountLike & { status: AccountStatus })[]): { text: string; tone: Tone; title: string } | null {
  if (accounts.length === 0) return null
  const waiting = accounts.filter((a) => a.status !== 'ready')
  const title = accounts.map((a) => `${accountText(a)}: ${ACCOUNT_STATUS_LABEL[a.status]}`).join('\n')
  if (waiting.length === 0) return { text: `${accounts.length} ready`, tone: 'good', title }
  const what = waiting.every((a) => a.status === 'login_required') ? 'sign-in' : 'you'
  const verb = waiting.length === 1 ? 'needs' : 'need'
  return { text: `${accounts.length} · ${waiting.length} ${verb} ${what}`, tone: waiting.some((a) => a.status === 'suspended') ? 'bad' : 'warn', title }
}
