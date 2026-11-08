// The AI agent on an account (DEC-018): the owner gives an account its e-mail and password, the AI does the rest in the account's own browser.
// This service starts a mission, keeps what the AI is doing where the UI can read it, passes the AI's questions to the owner and the owner's
// answers back, and stops it. The AI itself is a real Claude Code or Codex run that owns the goal and works the browser through the
// application's MCP tools (src/core/browser-agent/toolbox.ts); here is what only the application knows: which account, which engine, which
// secrets, which hosts.
//
// Rules held here: the password is read from the vault for the one mission and handed over by name; one mission per account; the browser is
// shown to the owner while the AI works in it; the owner may take the browser between two tool calls (a CAPTCHA) and the AI waits; after the
// engine ends, the site's own answer decides (the connector's login check), not the AI's opinion.

import { ApiError } from '../../shared/api'
import type { Account, AccountProfile, AgentAsk, AgentReadiness, AgentRun, AgentTaskKind } from '../../shared/types'
import { AiError, TakeoverError, type AiEngine } from '../ports'
import { missionPrompt, type Mission } from '../browser-agent/mission'
import { BrowserToolbox, type MissionStatus } from '../browser-agent/toolbox'
import type { Core } from '../core'
import type { AccountProfileService } from './account-profile'
import type { AccountsService } from './accounts'
import { BROWSER_BUSY, found } from './errors'
import { presetFor } from './presets'
import type { VaultService } from './vault'

const MAX_LINES = 80
const MAX_FACT = 400
/** A mission is minutes, not hours: a run that has not ended after this long is stopped. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const SERVER_NAME = 'ppd'

interface Live {
  run: AgentRun
  abort: AbortController
  /** Set while the AI waits for the owner. */
  answer: { resolve: (text: string) => void; reject: (error: Error) => void } | null
  /** What the AI said about how it ended. */
  reported: { status: MissionStatus; reason: string } | null
}

export class AgentRunService {
  private readonly runs = new Map<string, Live>()

  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly vault: VaultService,
    private readonly profiles: AccountProfileService
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
      this.dropQuestion(live, 'The owner stopped this task.')
      this.finish(live, 'stopped', 'You stopped the AI. The page is as it was left; open the browser to continue yourself.')
    }
    return snapshot(live.run)
  }

  /** Brings the browser the AI works in to the front: the owner acts in the very page the AI waits on (a CAPTCHA). */
  showBrowser(accountId: unknown): { shown: boolean } {
    const account = this.accounts.account(accountId)
    const show = this.core.browser.showAgentBrowser
    if (!show || this.runs.get(account.id)?.run.status !== 'running') return { shown: false }
    show.call(this.core.browser, account, true)
    return { shown: true }
  }

  /** The owner answers the question the AI is waiting on (the pop-up). */
  answer(args: { accountId: string; answer: string }): AgentRun | null {
    const account = this.accounts.account(args.accountId)
    const live = this.runs.get(account.id)
    if (!live) return null
    if (live.run.status === 'running' && live.answer) {
      const { resolve } = live.answer
      live.answer = null
      live.run.question = null
      this.core.events.changed('accounts', 'attention')
      resolve(args.answer.trim().slice(0, 500) || 'done')
    }
    return snapshot(live.run)
  }

  /** Every question an AI is waiting on now, for the pop-up that appears on any screen. */
  questions(): AgentAsk[] {
    const asks: AgentAsk[] = []
    for (const [accountId, live] of this.runs) {
      if (live.run.status !== 'running' || !live.run.question) continue
      const account = this.accounts.account(accountId)
      asks.push({ accountId, accountLabel: account.label, ...live.run.question })
    }
    return asks
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

  /**
   * What a run needs: a known kind, no run going, an engine that can work the browser and is ready, an e-mail and a saved password, and the
   * profile the owner approved (DEC-019): the AI invents no personal detail, it types the owner's decision.
   */
  private async prerequisites(account: Account, kind: AgentTaskKind): Promise<{ engine: AiEngine; mission: Mission }> {
    if (kind !== 'signup' && kind !== 'profile') throw new ApiError('invalid_input', 'This kind of task is not known.')
    if (this.runs.get(account.id)?.run.status === 'running') throw new ApiError('agent_running', `The AI is already working on ${account.label}.`)

    const engine = this.core.engines.selected()
    if (!engine) throw new ApiError('no_engine', 'No AI engine is selected. Choose Claude Code or Codex in Settings.')
    if (!engine.supportsAgent) throw new ApiError('engine_cannot_drive', `${engine.label} cannot work the browser. Choose Claude Code or Codex in Settings (AI engine).`)
    if (!this.core.agentBridge) throw new ApiError('no_agent_bridge', 'The AI browser agent is not available in this build.')
    const status = await engine.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)

    return { engine, mission: kind === 'signup' ? this.signUpMission(account) : this.profileMission(account) }
  }

  /** Starts a mission and returns at once; it goes on in the background and is read with `state`. */
  async start(args: { accountId: string; kind: AgentTaskKind }): Promise<AgentRun> {
    const account = this.accounts.account(args.accountId)
    const { engine, mission } = await this.prerequisites(account, args.kind)
    const kind = args.kind
    const live: Live = {
      abort: new AbortController(),
      answer: null,
      reported: null,
      run: {
        accountId: account.id,
        kind,
        status: 'running',
        summary: kind === 'signup' ? 'The AI is opening the registration page.' : 'The AI is opening the profile page.',
        lines: [],
        typed: [],
        question: null,
        startedAt: this.core.clock.now().toISOString(),
        finishedAt: null
      }
    }
    this.runs.set(account.id, live)
    this.core.log.info('accounts', `The AI started to ${kind === 'signup' ? 'register' : 'fill in the profile of'} ${account.label} on ${mission.hosts[0] ?? 'the platform'} (${engine.label}).`)
    this.core.events.changed('accounts')
    // The owner watches the AI work in the account's own browser.
    this.core.browser.showAgentBrowser?.(account)
    void this.drive(account, live, mission, engine, kind)
    return snapshot(live.run)
  }

  private signUpMission(account: Account): Mission {
    if (!account.email) throw new ApiError('no_email', `${account.label} has no e-mail yet. Add the e-mail address of the account first.`)
    const password = this.vault.password(account)
    if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}. Save the password the account should have first.`)
    const target = this.accounts.signUpTarget(account)
    const platform = presetFor(account.platform)?.label ?? account.platform

    const profile = this.profiles.approved(account)

    const facts = this.contextFacts(account, platform)
    facts.push(...profileFacts(profile))
    facts.push('Use the same e-mail address and password everywhere. Do not tick optional boxes about ads, newsletters or contacts; tick only what the site requires to continue.')

    const values: Mission['values'] = {
      EMAIL: { value: account.email, describe: 'the e-mail address of the account (use it wherever the site asks for an e-mail address or login)', secret: false },
      PASSWORD: { value: password, describe: 'the password of the account', secret: true },
      USERNAME: { value: profile.username, describe: 'the user name the account should have, if the site asks for one', secret: false }
    }

    return {
      goal: `Create a new account on ${platform} for the owner, with the profile below: fill in everything the site needs, and make sure the account exists and is signed in.`,
      facts,
      startUrl: target.url,
      hosts: target.hosts,
      values,
      files: this.pictureFiles(account, profile)
    }
  }

  /** The profile of an account that is already signed in: the about-text, the place, the website and the picture (DEC-019). */
  private profileMission(account: Account): Mission {
    const profile = this.profiles.approved(account)
    const target = this.accounts.signInTarget(account)
    const platform = presetFor(account.platform)?.label ?? account.platform
    const facts = this.contextFacts(account, platform)
    facts.push(...profileFacts(profile))
    return {
      goal: `The account on ${platform} already exists and is signed in. Open its profile settings and fill in the profile below: the display name, the about-text, the place, the website (only where the site has those fields) and the picture.`,
      facts,
      startUrl: target.url,
      hosts: target.hosts,
      values: {},
      files: this.pictureFiles(account, profile),
      rules: [
        'Change only the profile fields named in the facts. Do not change the e-mail address, the password, the user name or any privacy or security setting.',
        'If the site shows a sign-in page instead of the account, the account is not signed in: report needs_owner and say so.',
        'A field the site does not have is skipped without a word; do not hunt for it. Save the profile if the site has a save button, then look at the profile page again to confirm the values are shown.'
      ]
    }
  }

  /** What the owner knows about the account, the role and the product: the strategy the profile serves. */
  private contextFacts(account: Account, platform: string): string[] {
    const facts = [`The account is called "${account.label}" by the owner. It is used on ${platform}.`]
    if (account.role) facts.push(`It speaks as "${account.role.name}": ${account.role.voice}`)
    if (account.productId) {
      const product = found(() => this.core.repos.product(account.productId as string), 'The product')
      facts.push(`It is first used to promote "${product.name}"${product.websiteUrl ? ` (${product.websiteUrl})` : ''}.${product.description ? ` ${product.description.slice(0, MAX_FACT)}` : ''}`)
    }
    return facts
  }

  /** The picture of the profile, when there is one: the AI uploads it by name and never sees a path. */
  private pictureFiles(account: Account, profile: AccountProfile): Mission['files'] {
    const path = profile.hasPicture ? this.profiles.pictureFile(account.id) : null
    return path ? { PICTURE: { path, describe: 'the profile picture the owner approved (upload it where the site asks for a profile photo or an avatar)' } } : undefined
  }

  private async drive(account: Account, live: Live, mission: Mission, engine: AiEngine, kind: AgentTaskKind): Promise<void> {
    const bridge = this.core.agentBridge
    if (!bridge) return this.finish(live, 'failed', 'The AI browser agent is not available in this build.')
    const session = this.core.browser.session(account)
    const toolbox = new BrowserToolbox({
      // Each call holds the browser only for itself, so the owner can take it between two calls.
      withPage: (work) => session.withAgentControl(`agent-${kind}`, work),
      hosts: mission.hosts,
      values: mission.values,
      files: mission.files,
      sleep: this.core.sleep,
      say: (line) => this.say(live, line),
      ask: (question) => this.ask(live, question),
      note: (label, value) => this.note(live, label, value),
      report: (result) => void (live.reported = result),
      signal: live.abort.signal
    })
    let opened: Awaited<ReturnType<typeof bridge.open>> | null = null
    try {
      opened = await bridge.open(toolbox)
      const said = await engine.run(
        { label: `agent.${kind}`, prompt: missionPrompt(mission, this.core.clock.now().toISOString().slice(0, 10)), agent: { server: SERVER_NAME, launch: opened.launch }, timeoutMs: RUN_TIMEOUT_MS },
        { signal: live.abort.signal }
      )
      if (live.run.status !== 'running') return // stopped by the owner while the engine was ending
      if (said.trim()) this.say(live, `The AI: ${said.trim().replace(/\s+/g, ' ').slice(0, 240)}`)
      await this.conclude(account, live, kind)
    } catch (error) {
      if (live.run.status !== 'running') return
      if (error instanceof AiError && error.kind === 'cancelled') return this.finish(live, 'stopped', 'The AI was stopped.')
      if (error instanceof AiError && error.kind === 'timeout') return this.finish(live, 'needs_owner', 'The AI did not finish in half an hour and was stopped. Open the browser and look at where it got to.')
      if (error instanceof TakeoverError || (error instanceof ApiError && error.code === 'browser_busy')) return this.finish(live, 'needs_owner', BROWSER_BUSY)
      const reason = error instanceof Error ? error.message : String(error)
      this.core.log.warn('accounts', `The AI could not ${kind === 'signup' ? 'register' : 'fill in the profile of'} ${account.label}: ${reason}`)
      this.finish(live, 'failed', `The AI stopped because of an error: ${reason}`)
    } finally {
      this.dropQuestion(live, 'The mission is over.')
      opened?.close()
    }
  }

  /** The engine has ended: the site's own answer decides whether the account exists, whatever the AI said. */
  private async conclude(account: Account, live: Live, kind: AgentTaskKind): Promise<void> {
    const reported = live.reported
    // The AI stopped for something only a person can do: the page is where the person continues, so nothing is loaded over it
    // (the check opens another page) and nothing is signed in on the side.
    if (reported?.status === 'needs_owner') {
      this.core.log.info('accounts', `The AI stopped on ${account.label}: ${reported.reason}`)
      return this.finish(live, 'needs_owner', reported.reason || 'The AI needs you.')
    }
    // `signInAgain: false`: the check is part of this mission, it must not start the automatic sign-in with the saved password.
    const checked = await this.accounts.checkLogin(account.id, { signInAgain: false })
    if (live.run.status !== 'running') return
    if (checked.status === 'ready') {
      if (kind === 'profile') {
        this.core.log.info('accounts', `The AI filled in the profile of ${account.label}.`)
        return this.finish(live, 'done', 'The profile was filled in. Open the account browser to look at it.')
      }
      this.core.log.info('accounts', `The AI registered ${account.label}${checked.identity ? ` as ${checked.identity}` : ''}.`)
      return this.finish(live, 'done', checked.identity ? `The account was created and signed in as ${checked.identity}.` : 'The account was created and signed in.')
    }
    if (reported && reported.status !== 'done') {
      this.core.log.info('accounts', `The AI stopped on ${account.label}: ${reported.reason}`)
      return this.finish(live, reported.status, reported.reason || 'The AI could not finish.')
    }
    const why = checked.status === 'captcha' ? 'The site asks for a human check.' : reported ? 'The AI says it is done, but the site does not show a signed-in account yet (it may want a code from the e-mail).' : 'The AI ended without saying how it went, and the site does not show a signed-in account yet.'
    this.finish(live, 'needs_owner', `${why} Open the account browser, finish there, then check the sign-in.`)
  }

  /** The AI asks the owner something; resolves with the answer, rejects when the task is stopped. */
  private ask(live: Live, text: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (live.run.status !== 'running') return reject(new Error('The mission is over.'))
      live.answer = { resolve, reject }
      live.run.question = { text: text.slice(0, 500), askedAt: this.core.clock.now().toISOString() }
      live.run.summary = 'The AI needs you.'
      this.core.events.changed('accounts', 'attention')
    })
  }

  private dropQuestion(live: Live, why: string): void {
    live.run.question = null
    const pending = live.answer
    live.answer = null
    pending?.reject(new Error(why))
  }

  private note(live: Live, label: string, value: string): void {
    if (live.run.status !== 'running') return
    const existing = live.run.typed.find((t) => t.label === label)
    if (existing) existing.value = value
    else live.run.typed.push({ label, value })
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
    live.run.question = null
    live.run.finishedAt = this.core.clock.now().toISOString()
    this.core.events.changed('accounts', 'attention')
  }
}

/** The approved profile as facts for the AI: exactly what it types, and why the profile is what it is. */
function profileFacts(profile: AccountProfile): string[] {
  const facts = ['THE PROFILE (the owner approved it; type exactly these values and never invent another personal detail):']
  if (profile.purpose) facts.push(`What the profile is for: ${profile.purpose}`)
  facts.push(`First name: ${profile.firstName}. Last name: ${profile.lastName}. Display name: ${profile.displayName}. User name: ${profile.username}.`)
  facts.push(`Birth date: ${profile.birthDate} (day, month and year as the form asks). Gender: ${profile.gender}.`)
  if (profile.place) facts.push(`Place: ${profile.place}.`)
  if (profile.about) facts.push(`About-text: ${profile.about}`)
  if (profile.website) facts.push(`Website: ${profile.website}`)
  return facts
}

const snapshot = (run: AgentRun): AgentRun => ({ ...run, lines: [...run.lines], typed: run.typed.map((t) => ({ ...t })), question: run.question ? { ...run.question } : null })
