// The browser agent on an account (DEC-017): the owner gives an account its e-mail and password, the AI does the rest in the account's
// own browser. This service starts a run, keeps what it is doing where the UI can read it, and stops it. The loop itself is
// src/core/browser-agent/agent.ts; here is what only the application knows: which account, which engine, which secrets, which hosts.
//
// Rules held here: only a tool-free engine is ever shown a website; the password is read from the vault for the one run and handed over
// by name; one run per account; the owner opening the account's browser stops the run; after "done" the site's own answer decides
// (the connector's login check), not the AI's opinion.

import { ApiError } from '../../shared/api'
import type { Account, AgentReadiness, AgentRun, AgentTaskKind } from '../../shared/types'
import { AiError, TakeoverError, type AiEngine } from '../ports'
import { runBrowserAgent, type AgentResult, type BrowserTask } from '../browser-agent/agent'
import type { Core } from '../core'
import type { AccountsService } from './accounts'
import { BROWSER_BUSY, found } from './errors'
import { presetFor } from './presets'
import type { VaultService } from './vault'

const MAX_LINES = 80
const MAX_FACT = 400

interface Live {
  run: AgentRun
  abort: AbortController
}

export class AgentRunService {
  private readonly runs = new Map<string, Live>()

  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly vault: VaultService
  ) {}

  state(accountId: unknown): AgentRun | null {
    const account = this.accounts.account(accountId)
    const live = this.runs.get(account.id)
    return live ? snapshot(live.run) : null
  }

  stop(accountId: unknown): AgentRun | null {
    const account = this.accounts.account(accountId)
    const live = this.runs.get(account.id)
    if (!live) return null
    if (live.run.status === 'running') {
      live.abort.abort()
      this.finish(live, 'stopped', 'You stopped the AI. The page is as it was left; open the browser to continue yourself.')
    }
    return snapshot(live.run)
  }

  /** Whether a run can start now; the same checks as `start`, with the reason in words instead of an error, and nothing done. */
  async canStart(args: { accountId: string; kind: AgentTaskKind }): Promise<AgentReadiness> {
    try {
      await this.prerequisites(this.accounts.account(args.accountId), args.kind)
      return { ready: true, reason: null }
    } catch (error) {
      if (error instanceof ApiError) return { ready: false, reason: error.message }
      throw error
    }
  }

  /** What a run needs: a known kind, no run going, an engine that cannot act on this computer and is ready, an e-mail and a saved password. */
  private async prerequisites(account: Account, kind: AgentTaskKind): Promise<{ engine: AiEngine; task: BrowserTask }> {
    if (kind !== 'signup') throw new ApiError('invalid_input', 'This kind of task is not known.')
    if (this.runs.get(account.id)?.run.status === 'running') throw new ApiError('agent_running', `The AI is already working on ${account.label}.`)

    const engine = this.core.engines.selected()
    if (!engine) throw new ApiError('no_engine', 'No AI engine is selected. Choose Claude Code in Settings.')
    if (!engine.toolFree) {
      throw new ApiError('engine_not_tool_free', `${engine.label} can use tools on this computer, so it is never shown a website. Choose Claude Code in Settings (AI engine) to let the AI work in the browser.`)
    }
    const status = await engine.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)

    return { engine, task: this.signUpTask(account) }
  }

  /** Starts a run and returns at once; the run goes on in the background and is read with `state`. */
  async start(args: { accountId: string; kind: AgentTaskKind }): Promise<AgentRun> {
    const account = this.accounts.account(args.accountId)
    const { engine, task } = await this.prerequisites(account, args.kind)
    const live: Live = {
      abort: new AbortController(),
      run: { accountId: account.id, kind: 'signup', status: 'running', summary: 'The AI is opening the registration page.', lines: [], typed: [], startedAt: this.core.clock.now().toISOString(), finishedAt: null }
    }
    this.runs.set(account.id, live)
    this.core.log.info('accounts', `The AI started to register ${account.label} on ${task.hosts[0] ?? 'the platform'}.`)
    this.core.events.changed('accounts')
    void this.drive(account, live, task, engine)
    return snapshot(live.run)
  }

  private signUpTask(account: Account): BrowserTask {
    if (!account.email) throw new ApiError('no_email', `${account.label} has no e-mail yet. Add the e-mail address of the account first.`)
    const password = this.vault.password(account)
    if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}. Save the password the account should have first.`)
    const target = this.accounts.signUpTarget(account)
    const platform = presetFor(account.platform)?.label ?? account.platform

    const facts = [`The account is called "${account.label}" by the owner. It will be used on ${platform}.`]
    if (account.role) facts.push(`It speaks as "${account.role.name}": ${account.role.voice}`)
    if (account.productId) {
      const product = found(() => this.core.repos.product(account.productId as string), 'The product')
      facts.push(`It is first used to promote "${product.name}"${product.websiteUrl ? ` (${product.websiteUrl})` : ''}.${product.description ? ` ${product.description.slice(0, MAX_FACT)}` : ''}`)
    }
    facts.push('Choose a display name that fits the role and the account name, and a birth date that makes the person an adult (30 to 45 years old). Use the same e-mail address and password everywhere.')
    facts.push('Do not tick optional boxes about ads, newsletters or contacts; tick only what the site requires to continue.')

    const values: BrowserTask['values'] = {
      EMAIL: { value: account.email, describe: 'the e-mail address of the account (use it wherever the site asks for an e-mail address or login)', secret: false },
      PASSWORD: { value: password, describe: 'the password of the account', secret: true }
    }
    if (account.loginName && account.loginName !== account.email) values.USERNAME = { value: account.loginName, describe: 'the user name the account should have, if the site asks for one', secret: false }

    return {
      goal: `Register a new account on ${platform} and finish when the site shows it as created and signed in.`,
      facts,
      startUrl: target.url,
      hosts: target.hosts,
      values
    }
  }

  private async drive(account: Account, live: Live, task: BrowserTask, engine: AiEngine): Promise<void> {
    try {
      const result = await this.core.browser.session(account).withAgentControl('agent-signup', (page) =>
        runBrowserAgent(
          {
            page,
            engine,
            sleep: this.core.sleep,
            today: this.core.clock.now().toISOString().slice(0, 10),
            signal: live.abort.signal,
            say: (line) => this.say(live, line)
          },
          task
        )
      )
      if (live.run.status !== 'running') return // stopped by the owner while the last step was under way
      await this.conclude(account, live, result)
    } catch (error) {
      if (live.run.status !== 'running') return
      if (error instanceof AiError && error.kind === 'cancelled') return this.finish(live, 'stopped', 'The AI was stopped.')
      if (error instanceof TakeoverError) return this.finish(live, 'needs_owner', BROWSER_BUSY)
      const reason = error instanceof Error ? error.message : String(error)
      this.core.log.warn('accounts', `The AI could not register ${account.label}: ${reason}`)
      this.finish(live, 'failed', `The AI stopped because of an error: ${reason}`)
    }
  }

  /** The AI says it is done: the site's own answer decides. */
  private async conclude(account: Account, live: Live, result: AgentResult): Promise<void> {
    live.run.typed = result.typed
    if (result.outcome !== 'done') {
      this.core.log.info('accounts', `The AI stopped on ${account.label}: ${result.reason}`)
      return this.finish(live, result.outcome, result.reason)
    }
    const checked = await this.accounts.checkLogin(account.id)
    if (checked.status === 'ready') {
      this.core.log.info('accounts', `The AI registered ${account.label}${checked.identity ? ` as ${checked.identity}` : ''}.`)
      return this.finish(live, 'done', checked.identity ? `The account was created and signed in as ${checked.identity}.` : 'The account was created and signed in.')
    }
    const why = checked.status === 'captcha' ? 'The site asks for a human check.' : 'The site does not show a signed-in account yet (it may want a code from the e-mail).'
    this.finish(live, 'needs_owner', `${why} Open the account browser, finish there, then check the sign-in.`)
  }

  private say(live: Live, line: string): void {
    if (live.run.status !== 'running') return
    live.run.lines.push(line)
    if (live.run.lines.length > MAX_LINES) live.run.lines.shift()
    live.run.summary = line
    this.core.events.changed('accounts')
  }

  private finish(live: Live, status: AgentRun['status'], summary: string): void {
    live.run.status = status
    live.run.summary = summary
    live.run.finishedAt = this.core.clock.now().toISOString()
    this.core.events.changed('accounts', 'attention')
  }
}

const snapshot = (run: AgentRun): AgentRun => ({ ...run, lines: [...run.lines], typed: run.typed.map((t) => ({ ...t })) })
