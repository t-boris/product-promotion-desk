// Assisted sign-in (REQ-012, DEC-014): the saved password is filled into the sign-in form of the account's own browser, once.
//
// What stops it: no saved password, a page outside the platform, a CAPTCHA, a form that did not accept the values, a site
// that did not confirm the sign-in. Then control goes to the owner (the existing hand-off). An automatic attempt (an account
// found signed out) is made at most once an hour per account, so a wrong password cannot lock the account.

import { ApiError } from '../../shared/api'
import type { Account, SignInResult } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type SignInStatus } from '../ports'
import type { AccountsService } from './accounts'
import { browserError } from './errors'
import type { ChannelsStore } from './store'
import type { VaultService } from './vault'

const AUTOMATIC_INTERVAL_MS = 60 * 60 * 1000
/** A form may ask for the name first and the password on the next step: at most this many passes. */
const MAX_STEPS = 3

const STOPPED: Record<Exclude<SignInStatus, 'submitted' | 'next_step'>, string> = {
  no_form: 'The sign-in form was not found or did not accept the values. Sign in in the account browser.',
  captcha: 'The site shows a CAPTCHA. Solve it in the account browser and sign in there.',
  wrong_host: 'The page is not a page of this platform, so nothing was filled in. Open the account browser and sign in there.'
}

export class SignInService {
  private readonly running = new Set<string>()

  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly vault: VaultService,
    private readonly store: ChannelsStore
  ) {}

  /** "Sign in with saved password": always the owner's own action, so it is not held back by the hourly limit. */
  async signIn(accountId: unknown): Promise<SignInResult> {
    return this.run(this.accounts.account(accountId))
  }

  /** An account was found signed out: try the saved password, but only if the hour is up and nobody is using the browser. */
  async maybeAutomatic(account: Account): Promise<void> {
    if (!account.loginName || !this.vault.has(account)) return
    const last = this.store.lastLoginAttempt(account.id)
    if (last !== null && this.core.clock.now().getTime() - Date.parse(last) < AUTOMATIC_INTERVAL_MS) return
    try {
      const result = await this.run(account)
      this.core.log.info('accounts', `Automatic sign-in of ${account.label}: ${result.outcome === 'signed_in' ? 'signed in' : result.detail}`)
    } catch (error) {
      // Not an error for the owner: the account stays "sign-in needed" and appears on the attention list as before.
      if (!(error instanceof ApiError && error.code === 'user_window_open')) this.core.log.warn('accounts', `Automatic sign-in of ${account.label} did not run: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async run(account: Account): Promise<SignInResult> {
    const username = account.loginName
    const password = this.vault.password(account)
    if (!username || password === null) throw new ApiError('no_password', `No password is saved for ${account.label}. Save one first.`)
    if (this.running.has(account.id)) throw new ApiError('sign_in_running', `${account.label} is being signed in already.`)
    const target = this.accounts.signInTarget(account)

    this.running.add(account.id)
    // Counted before the attempt: a crash in the middle must not allow an immediate second try.
    this.store.markLoginAttempt(account.id, this.core.clock.now().toISOString())
    try {
      const stopped = await this.fill(account, { username, password, hosts: target.hosts }, target.url)
      if (stopped) return this.needsYou(account, stopped)
      await this.core.sleep(4000)
    } catch (error) {
      if (error instanceof TakeoverError) throw new ApiError('user_window_open', 'You have the account browser open. Close it or press "Give control back to the app" first.')
      const failure = browserError(error, { code: 'sign_in_failed', message: (reason) => `Could not sign in: ${reason}` })
      this.core.log.warn('accounts', `Sign-in of ${account.label} failed: ${failure.message}`)
      throw failure
    } finally {
      this.running.delete(account.id)
    }

    // The site's own answer decides: the connector's login check, not the fact that a form was submitted.
    const checked = await this.accounts.checkLogin(account.id)
    if (checked.status === 'ready') {
      this.core.log.info('accounts', `${account.label} was signed in with the saved password.`)
      return { account: checked, outcome: 'signed_in', detail: checked.identity ? `Signed in as ${checked.identity}.` : 'Signed in.' }
    }
    const why = checked.status === 'captcha' ? 'The site asks for a CAPTCHA. Solve it in the account browser.' : 'The site did not confirm the sign-in: the password may be wrong, or it wants a code or another check. Open the account browser to finish.'
    return { account: checked, outcome: 'needs_you', detail: why }
  }

  /** Runs the form step(s) on the account's own page; returns the reason it stopped, or null when the form was submitted. */
  private async fill(account: Account, form: { username: string; password: string; hosts: string[] }, url: string): Promise<string | null> {
    return this.core.browser.session(account).withAgentControl('sign-in', async (page) => {
      await page.goto(url)
      for (let step = 0; step < MAX_STEPS; step++) {
        const { status } = await page.signIn(form)
        if (status === 'submitted') return null
        if (status === 'next_step') {
          await this.core.sleep(2500)
          continue
        }
        return STOPPED[status]
      }
      return STOPPED.no_form
    })
  }

  private needsYou(account: Account, detail: string): SignInResult {
    this.core.log.info('accounts', `Sign-in of ${account.label} stopped: ${detail}`)
    return { account: this.accounts.account(account.id), outcome: 'needs_you', detail }
  }
}
