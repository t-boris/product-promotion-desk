// The AI agent on an account (DEC-018): the owner gives an account its e-mail and password, the AI does the rest in the account's own browser.
// This service starts a mission, keeps what the AI is doing where the UI can read it, passes the AI's questions to the owner and the owner's
// answers back, and stops it. The AI itself is a real Claude Code or Codex run that owns the goal and works the browser through the
// application's MCP tools (src/core/browser-agent/toolbox.ts); here is what only the application knows: which account, which engine, which
// secrets, which hosts.
//
// Rules held here: the password is read from the vault for the one mission and handed over by name; one mission per account, except that missions
// which only look (a watch of a channel, a search for trends) may run side by side, each in a window of its own, and never beside a mission that
// acts (a sign-in, a profile, a join, a publication); how many looks run at once is the scheduler's limit, not this service's; the browser is shown
// to the owner while the AI works in it; the owner may take the browser between two tool calls (a CAPTCHA) and the AI waits; after the
// engine ends, the site's own answer decides (the connector's login check), not the AI's opinion.

import { statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'
import { ApiError } from '../../shared/api'
import type { Account, Channel, Profile, AgentAsk, AgentReadiness, AgentRun, AgentTaskKind, MissionKind } from '../../shared/types'
import { AiError, TakeoverError, type AgentTask, type AiEngine } from '../ports'
import { joinMissionPrompt } from '../browser-agent/join'
import { missionPrompt, type Mission } from '../browser-agent/mission'
import { postMissionPrompt } from '../browser-agent/post-mission'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { BrowserToolbox, type MissionStatus, type Rhythm } from '../browser-agent/toolbox'
import { WATCH_MAX_CALLS, WATCH_MAX_FINDINGS, WATCH_MIN_GAP_MS, WATCH_TIMEOUT_MS, type WatchMissionRequest, type WatchMissionService, type WatchOutcome, type WatchSetup } from '../browser-agent/watch'
import { watchMissionPrompt } from '../browser-agent/watch-mission'
import { RESEARCH_MAX_CALLS, RESEARCH_MAX_TOPICS, RESEARCH_MIN_GAP_MS, RESEARCH_TIMEOUT_MS, type ResearchMissionRequest, type ResearchMissionService, type ResearchOutcome, type ResearchSetup } from '../browser-agent/research'
import { researchMissionPrompt } from '../browser-agent/research-mission'
import type { Core } from '../core'
import type { Connector, Membership } from '../ports'
import type { LessonService } from './lessons'
import type { PersonProfileService } from './person-profile'
import type { AccountsService } from './accounts'
import type { ChannelService } from './channel-service'
import { BROWSER_BUSY, browserError, found } from './errors'
import { presetFor } from './presets'
import type { VaultService } from './vault'

const MAX_LINES = 80
/** How much of the AI's last words a failed look keeps (for the log and the channel's status). */
const LAST_WORDS_MAX = 200
const MAX_FACT = 400
/** A mission is minutes, not hours: a run that has not ended after this long is stopped. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const SERVER_NAME = 'ppd'

/** A publication is one form: a quarter of an hour and a hundred calls are generous, and the owner may need that long for a CAPTCHA. */
const POST_TIMEOUT_MS = 15 * 60 * 1000
const POST_MAX_CALLS = 100
/** Joining is one press: ten minutes and forty calls are generous (a CAPTCHA, a sign-in), and the pause between actions is that of a post. */
const JOIN_TIMEOUT_MS = 10 * 60 * 1000
const JOIN_MAX_CALLS = 40
/** The pause between two actions of a join, and how long the application waits before it reads the membership a second time. */
const JOIN_MIN_GAP_MS = 2000
const JOIN_RECHECK_MS = 2500
const JOIN_TIMED_OUT = 'The AI did not finish in ten minutes and was stopped. Its window is closed: open the browser to continue yourself.'
const NEEDS_YOU_FIRST = (target: string): string =>
  `The last check of ${target} says Membership needs you first (a private community needs an invitation; a sign-in or a check has to be done by a person). Look at Membership in the table, then assess the channel again.`
const PRIVATE_COMMUNITY = (target: string): string => `${target} is private: joining needs an invitation or approval, and the AI does not ask for it. Do it yourself in the account's browser.`
/** The least time between two actions on the page in a post mission: a person does not act in milliseconds, and a site notices. */
const POST_MIN_GAP_MS = 2000

/**
 * What a kind of mission is: who starts it, how long and how many calls it has, what it says while it opens. A new kind (creating an
 * account, connecting a channel, scanning one) is one more row here and, if its tools differ, a toolset in the toolbox: the engine run,
 * the questions to the owner and the stopping are the same for all.
 */
interface MissionSpec {
  /**
   * `owner`: through `agent.start`. `send_flow`: only the send flow starts it, with a ticket for one approved publication in hand. `watch_flow`: only the
   * monitor's watch flow starts it, for one channel the app reads through the browser (DEC-042). `quick_help`: only the quick-post composer's trend
   * search starts it, when the owner asks for it (REQ-004).
   */
  startedBy: 'owner' | 'send_flow' | 'watch_flow' | 'quick_help'
  timeoutMs: number
  /** Tool calls the mission has; the toolbox's own default when not given. */
  maxCalls?: number
  /** What the run says before the AI has said anything. */
  opening: string
  /** The log's verb: "The AI started to <doing> <account>". */
  doing: string
}

const MISSIONS: Record<MissionKind, MissionSpec> = {
  signup: { startedBy: 'owner', timeoutMs: RUN_TIMEOUT_MS, opening: 'The AI is opening the registration page.', doing: 'register' },
  profile: { startedBy: 'owner', timeoutMs: RUN_TIMEOUT_MS, opening: 'The AI is opening the profile page.', doing: 'fill in the profile of' },
  signin: { startedBy: 'owner', timeoutMs: RUN_TIMEOUT_MS, opening: 'The AI is opening the sign-in page.', doing: 'sign in to' },
  join: { startedBy: 'owner', timeoutMs: JOIN_TIMEOUT_MS, maxCalls: JOIN_MAX_CALLS, opening: 'The AI is opening the community page.', doing: 'join a community with' },
  post: { startedBy: 'send_flow', timeoutMs: POST_TIMEOUT_MS, maxCalls: POST_MAX_CALLS, opening: 'The AI is opening the page to publish.', doing: 'publish for' },
  watch: { startedBy: 'watch_flow', timeoutMs: WATCH_TIMEOUT_MS, maxCalls: WATCH_MAX_CALLS, opening: 'The AI is opening the page to look at.', doing: 'watch a channel of' },
  research: { startedBy: 'quick_help', timeoutMs: RESEARCH_TIMEOUT_MS, maxCalls: RESEARCH_MAX_CALLS, opening: 'The AI is opening the search to look at.', doing: 'search for trends with' }
}

/** What differs between the two missions that only look: what is said when the owner takes the browser, when the time is up, and what the log says it did. */
const LOOKS = {
  watch: {
    busy: 'The owner has the browser, so the check stops here and is made again later.',
    timeout: 'The AI did not finish in twenty minutes and was stopped.',
    did: 'The AI looked at a channel of'
  },
  research: {
    busy: 'You have the browser, so the search stops here. Ask again when you are done.',
    timeout: 'The AI did not finish in ten minutes and was stopped.',
    did: 'The AI searched for trends with'
  }
} as const

interface Live {
  run: AgentRun
  abort: AbortController
  /** Set while the AI waits for the owner. */
  answer: { resolve: (text: string) => void; reject: (error: Error) => void } | null
  /** What the AI said about how it ended. */
  reported: { status: MissionStatus; reason: string } | null
  /** The last question the AI asked and the owner's answer: the source of a rule the AI keeps from it. */
  exchange: { question: string; answer: string } | null
  /** The mission's own page and window in the account's browser: made when it starts, closed when it ends, and never the page of anything else. */
  task: AgentTask | null
}

export class AgentRunService implements PostMissionService, WatchMissionService, ResearchMissionService {
  /** The mission of an account that acts (a sign-in, a profile, a join, a publication): one at a time, and never beside a look. */
  private readonly runs = new Map<string, Live>()
  /** The looks of an account: the ones running and the last one that ended (the screen reads how it ended). They only read and nobody is asked anything. */
  private readonly looks = new Map<string, Live[]>()
  /** When a page was last opened on an account by any look of it: the least time between two openings holds for all the looks together. */
  private readonly rhythms = new Map<string, Rhythm>()

  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly vault: VaultService,
    private readonly profiles: PersonProfileService,
    private readonly lessons: LessonService,
    /** Reads the channel again once the account has joined, so every row of the table is current (DEC-029). */
    private readonly channels: Pick<ChannelService, 'assess'>
  ) {}

  /** What the AI is doing on the account: the mission that acts, else the look that began last (running ones first), else how the last one ended. */
  state(accountId: unknown): AgentRun | null {
    const account = this.accounts.account(accountId)
    const live = this.liveOf(account.id)
    return live ? snapshot(live.run) : null
  }

  /** Stops everything the AI is doing on the account: Stop is the owner's word for the account, not for one window. */
  stop(accountId: unknown): AgentRun | null {
    const account = this.accounts.account(accountId)
    const lives = this.lives(account.id)
    if (lives.length === 0) return null
    for (const live of lives) {
      if (live.run.status !== 'running') continue
      live.abort.abort()
      this.dropQuestion(live, 'The owner stopped this task.')
      this.finish(live, 'stopped', 'You stopped the AI. Its window was closed; open the browser to continue yourself.')
    }
    const shown = this.liveOf(account.id)
    return shown ? snapshot(shown.run) : null
  }

  /** Every run of the account that is kept: the one that acts, then the looks. */
  private lives(accountId: string): Live[] {
    const acting = this.runs.get(accountId)
    return [...(acting ? [acting] : []), ...(this.looks.get(accountId) ?? [])]
  }

  private liveOf(accountId: string): Live | undefined {
    const all = this.lives(accountId)
    const running = all.filter((live) => live.run.status === 'running')
    return (running.length > 0 ? running : all).reduce<Live | undefined>((latest, live) => (!latest || live.run.startedAt >= latest.run.startedAt ? live : latest), undefined)
  }
  /** Brings the browser the AI works in to the front: the owner acts in the very page the AI waits on (a CAPTCHA). */
  showBrowser(accountId: unknown): { shown: boolean } {
    const account = this.accounts.account(accountId)
    const show = this.core.browser.showAgentBrowser
    if (!show || !this.working(account.id)) return { shown: false }
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
      live.exchange = { question: live.run.question?.text ?? '', answer: args.answer.trim().slice(0, 500) }
      live.answer = null
      live.run.question = null
      this.core.events.changed('accounts', 'attention')
      resolve(args.answer.trim().slice(0, 500) || 'done')
    }
    return snapshot(live.run)
  }

  /** True while a mission, or a look, is running on the account. */
  working(accountId: string): boolean {
    return this.lives(accountId).some((live) => live.run.status === 'running')
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
  async canStart(args: { accountId: string; kind: AgentTaskKind | 'watch'; channelId?: string }): Promise<AgentReadiness> {
    try {
      const account = this.accounts.account(args.accountId)
      if (args.kind === 'watch') await this.watchPrerequisites(account)
      else await this.prerequisites(account, args.kind, args.channelId)
      return { ready: true, reason: null }
    } catch (error) {
      if (error instanceof ApiError) return { ready: false, reason: error.message }
      throw error
    }
  }

  /**
   * What a run needs: a known kind, no run going, an engine that can work the browser and is ready, an e-mail and a saved password, and the
   * profile the owner approved (DEC-019): the AI invents no personal detail, it types the owner's decision. Nothing here asks the keychain:
   * that the password is saved is a lookup in the vault file, and `mission()` reads it, which only `start` calls (BUG-041).
   */
  private async prerequisites(account: Account, kind: AgentTaskKind, channelId?: string): Promise<{ engine: AiEngine; mission: () => Promise<Mission> }> {
    // Only a kind the owner starts: `post` is the send flow's, and anything else is not a kind at all.
    const spec = Object.hasOwn(MISSIONS, kind) ? MISSIONS[kind] : undefined
    if (!spec || spec.startedBy !== 'owner') throw new ApiError('invalid_input', 'This kind of task is not known.')
    if (kind === 'join') return this.joinPrerequisites(account, channelId)
    if (channelId !== undefined) throw new ApiError('invalid_input', 'Only a task of joining a community is about a channel.')
    const engine = await this.readyEngine(account)

    if (kind === 'signup') return { engine, mission: this.signUpMission(account) }
    if (kind === 'signin') return { engine, mission: this.signInMission(account) }
    const mission = this.profileMission(account)
    return { engine, mission: async () => mission }
  }

  /**
   * What joining a community needs (DEC-029): a channel of this account on a platform that can say whether the account joined (so the
   * application, not the AI, decides whether it worked), an account that is signed in, an engine that can work the browser,
   * and a channel the account has not joined. `canStart` goes only by what the last assessment stored; `start` reads the
   * community once more, in the function it gets back, and refuses a banned account and a private community there.
   */
  private async joinPrerequisites(account: Account, channelId: string | undefined): Promise<{ engine: AiEngine; mission: () => Promise<Mission> }> {
    if (!channelId) throw new ApiError('invalid_input', 'Say which channel to join.')
    const channel = found(() => this.core.repos.channel(channelId), 'The channel')
    if (channel.accountId !== account.id) throw new ApiError('invalid_input', 'This channel belongs to another account.')
    const connector = this.core.connectors.get(channel.connectorId)
    if (!connector?.membership) {
      throw new ApiError('not_supported', `${connector?.label ?? channel.platform} cannot tell whether an account has joined, so the AI is not asked to join there. Join in the account's browser yourself.`)
    }
    if (account.status !== 'ready') throw new ApiError('not_ready', `${account.label} is not signed in. Sign in first, then join.`)
    const known = channel.capabilities.find((c) => c.key === 'membership')
    if (known?.status === 'verified') throw new ApiError('already_member', `${account.label} has already joined ${channel.target}.`)
    if (known?.status === 'restricted') throw new ApiError('cannot_join', known.detail)
    // Membership "needs you" in the last assessment (a private community, or a sign-in or a check first): the button would only be refused later
    if (known?.status === 'needs_user' && known.checkedAt !== null) throw new ApiError('cannot_join', NEEDS_YOU_FIRST(channel.target))
    const engine = await this.readyEngine(account)
    return { engine, mission: () => this.joinMission(account, channel, connector) }
  }

  /** The live check before the AI is asked to join, and the brief it gets. Throws when joining is not possible or not something a button does. */
  private async joinMission(account: Account, channel: Channel, connector: Connector): Promise<Mission> {
    let state: Membership
    try {
      state = await connector.membership!(this.core.connectorContext(channel.id).ctx)
    } catch (error) {
      throw browserError(error, { code: 'read_failed', message: (reason) => `Could not check whether ${account.label} has joined ${channel.target}: ${reason}` })
    }
    if (state.banned) throw new ApiError('cannot_join', `${account.label} is banned from ${channel.target}.`)
    if (state.member === true) throw new ApiError('already_member', `${account.label} has already joined ${channel.target}.`)
    if (state.access === 'private') {
      throw new ApiError('cannot_join', PRIVATE_COMMUNITY(channel.target))
    }
    const platform = presetFor(account.platform)?.label ?? connector.label ?? account.platform
    const join = { channelId: channel.id, community: channel.target.replace(/^\/?r\//i, ''), destination: channel.url, platform, accountLabel: account.label }
    return { goal: `Join ${channel.target} on ${platform} with ${account.label}.`, facts: [], startUrl: channel.url, hosts: this.accounts.signInTarget(account).hosts, values: {}, join }
  }

  /**
   * A mission that acts takes the whole account: nothing else runs on it, a look included. Synchronous on purpose: the caller claims the account
   * (`runs.set`) in the same turn, with nothing awaited in between, so two starts that were both waiting for the engine cannot both go on.
   */
  private assertIdle(account: Account): void {
    if (this.working(account.id)) throw new ApiError('agent_running', `The AI is already working on ${account.label}.`)
  }

  /**
   * A look needs the account free of a mission that acts; any number of looks may run beside each other (the owner has several channels on one account,
   * and looking at them one after another took the best part of an hour). How many run at once is the scheduler's limit for channel checks; the owner's
   * own "Look around" adds to it by one press at a time. The least time between two openings of a page is shared by all the looks of the account
   * (`rhythmOf`), so they do not open pages faster than one sign-in ever did. Synchronous like `assertIdle`: the caller claims its place in the same turn.
   */
  private assertRoomToLook(account: Account): void {
    if (this.runs.get(account.id)?.run.status === 'running') throw new ApiError('agent_running', `The AI is already working on ${account.label}.`)
  }

  private claimLook(account: Account, live: Live): void {
    const kept = this.looks.get(account.id) ?? []
    const lastEnded = kept.filter((other) => other.run.status !== 'running').at(-1)
    this.looks.set(account.id, [...(lastEnded ? [lastEnded] : []), ...kept.filter((other) => other.run.status === 'running'), live])
  }

  private rhythmOf(accountId: string): Rhythm {
    let rhythm = this.rhythms.get(accountId)
    if (!rhythm) this.rhythms.set(accountId, (rhythm = { at: null, reserved: null }))
    return rhythm
  }

  /**
   * No run going on the account, and an engine that can work the browser and is ready: what every kind of mission needs first. Any selected
   * engine that can work the browser may do it, publishing included (the owner's decision of 2026-11-20, which replaced the refusal of an engine
   * that cannot be held to the application's tools): `runEngine` holds the engine to the tools when it can be, and what the send needs stays
   * the same for every engine (the send ticket, the content checked against the approval, the owner's own press).
   */
  private async readyEngine(account: Account, looking = false): Promise<AiEngine> {
    if (looking) this.assertRoomToLook(account)
    else this.assertIdle(account)

    const engine = this.core.engines.selected()
    if (!engine) throw new ApiError('no_engine', 'No AI engine is selected. Choose Claude Code or Codex in Settings.')
    if (!engine.supportsAgent) throw new ApiError('engine_cannot_drive', `${engine.label} cannot work the browser. Choose Claude Code or Codex in Settings (AI engine).`)
    if (!this.core.agentBridge) throw new ApiError('no_agent_bridge', 'The AI browser agent is not available in this build.')
    const status = await engine.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)
    return engine
  }

  /** Starts a mission and returns at once; it goes on in the background and is read with `state`. */
  async start(args: { accountId: string; kind: AgentTaskKind; channelId?: string }): Promise<AgentRun> {
    const account = this.accounts.account(args.accountId)
    const { engine, mission: buildMission } = await this.prerequisites(account, args.kind, args.channelId)
    // The one place a password is read from the keychain; a refusal stops the start before anything is recorded.
    const mission = await buildMission()
    const kind = args.kind
    const live: Live = {
      abort: new AbortController(),
      answer: null,
      reported: null,
      exchange: null,
      task: null,
      run: {
        accountId: account.id,
        kind,
        ...(mission.join ? { channelId: mission.join.channelId } : {}),
        status: 'running',
        summary: MISSIONS[kind].opening,
        lines: [],
        typed: [],
        question: null,
        learned: [],
        startedAt: this.core.clock.now().toISOString(),
        finishedAt: null
      }
    }
    // The checks above and the password lookup awaited: another start may have taken the account meanwhile.
    this.assertIdle(account)
    this.runs.set(account.id, live)
    this.lessons.markUsed(this.lessons.forPlatform(account.platform))
    this.core.log.info('accounts', `The AI started to ${MISSIONS[kind].doing} ${account.label} on ${mission.hosts[0] ?? 'the platform'} (${engine.label}).`)
    this.core.events.changed('accounts')
    try {
      // The owner watches the AI work in a window of its own, which the mission closes when it ends.
      await this.openTask(account, live, `agent-${kind}`)
    } catch (error) {
      this.finish(live, 'failed', `The AI could not open its window: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    void this.drive(account, live, mission, engine, kind)
    return snapshot(live.run)
  }

  /**
   * One approved publication, worked by the AI in the account's browser (B1). Only the send flow calls this, with an authority built from
   * a gate grant: without one there is no mission, and the mission has no tool that types, presses a key or runs a script (see the
   * toolbox). Unlike `start` it resolves when the mission is over. What the AI says about how it went is passed on as a note; whether the
   * control that publishes was pressed is the authority's word, and whether the text is on the site is for the send flow to read back.
   */
  async run(request: PostMissionRequest): Promise<PostMissionOutcome> {
    const account = this.accounts.account(request.accountId)
    const engine = await this.readyEngine(account)
    const spec = MISSIONS.post
    const live: Live = {
      abort: new AbortController(),
      answer: null,
      reported: null,
      exchange: null,
      task: null,
      run: { accountId: account.id, kind: 'post', status: 'running', summary: spec.opening, lines: [], typed: [], question: null, learned: [], startedAt: this.core.clock.now().toISOString(), finishedAt: null }
    }
    // The engine check above awaited: another start may have taken the account meanwhile.
    this.assertIdle(account)
    this.runs.set(account.id, live)

    // The moment the owner presses Stop the mission loses the right to press, and so it does when the engine ends, however it ends: a
    // call of the AI that is still running (a submit in the middle of its typing) cannot press after this run has read `committed`.
    live.abort.signal.addEventListener('abort', () => request.authority.seal(), { once: true })
    let ended: PostMissionOutcome['ended'] = 'finished'
    let error: string | null = null
    let toolbox: BrowserToolbox | null = null
    try {
      // Everything after the claim is inside the try: whatever throws here ends the run as failed, and never leaves it "running".
      this.core.log.info('accounts', `The AI started to ${spec.doing} ${account.label} on ${request.hosts[0] ?? 'the platform'} (${engine.label}).`)
      this.core.events.changed('accounts')
      const task = await this.openTask(account, live, 'agent-post')
      toolbox = new BrowserToolbox({
        withPage: (work) => task.withAgentControl(work),
        hosts: request.hosts,
        values: {},
        sleep: this.core.sleep,
        say: (line) => this.say(live, line),
        ask: (question) => this.ask(live, question),
        note: () => undefined,
        report: (result) => void (live.reported = result),
        signal: live.abort.signal,
        maxCalls: spec.maxCalls,
        post: { authority: request.authority, minGapMs: POST_MIN_GAP_MS, now: () => this.core.clock.now().getTime() }
      })
      const said = await this.runEngine(live, engine, toolbox, 'agent.post', account.profileId ?? account.id, postMissionPrompt(request, this.core.clock.now().toISOString().slice(0, 10)), spec.timeoutMs, true)
      if (said.trim()) this.say(live, `The AI: ${said.trim().replace(/\s+/g, ' ').slice(0, 240)}`)
    } catch (caught) {
      if (caught instanceof AiError && caught.kind === 'cancelled') ended = 'stopped'
      else if (caught instanceof AiError && caught.kind === 'timeout') ended = 'timeout'
      else {
        ended = 'error'
        error = caught instanceof TakeoverError || (caught instanceof ApiError && caught.code === 'browser_busy') ? BROWSER_BUSY : caught instanceof Error ? caught.message : String(caught)
      }
    } finally {
      request.authority.seal()
      this.dropQuestion(live, 'The mission is over.')
      await live.task?.close()
    }
    if (live.run.status !== 'running') ended = 'stopped' // the owner stopped it (its run was finished by `stop`)

    const committed = request.authority.committed
    const reported = live.reported ? { status: live.reported.status, reason: live.reported.reason } : null
    const observed = toolbox?.observed ?? { humanCheck: null, warning: null }
    if (live.run.status === 'running') {
      if (committed) this.finish(live, 'done', 'The AI pressed the button that publishes. The application is checking that the text is on the site.')
      else if (ended === 'timeout') this.finish(live, 'needs_owner', 'The AI did not finish in a quarter of an hour and was stopped. Nothing was published.')
      else if (ended === 'error') this.finish(live, 'failed', `The AI stopped because of an error: ${error}`)
      else this.finish(live, reported?.status === 'failed' ? 'failed' : 'needs_owner', reported?.reason || 'The AI did not publish anything.')
    }
    // The AI's own words are shown to the owner in the run; the log keeps a fixed phrase and the status it reported.
    this.core.log.info('accounts', `The AI ${committed ? 'pressed the button that publishes' : 'did not publish'} for ${account.label}${reported ? ` (it reported "${reported.status}")` : ''}.`)
    return { ended, committed, reported, humanCheck: observed.humanCheck, warning: observed.warning, error, steps: toolbox?.steps ?? null }
  }

  /** What a look at a channel needs (DEC-042): an account that is signed in, no run going on it, and an engine that can work the browser. */
  private async watchPrerequisites(account: Account): Promise<AiEngine> {
    if (account.status !== 'ready') throw new ApiError('not_ready', `${account.label} is not signed in, so its channels are not watched. Sign in first.`)
    return this.readyEngine(account, true)
  }

  async watchReady(accountId: string): Promise<AgentReadiness> {
    return this.canStart({ accountId, kind: 'watch' })
  }

  /**
   * One look at one channel, worked by the AI in the account's browser (DEC-042). Only the monitor's watch flow calls this. The AI only reads: its toolbox
   * has no tool that clicks, types or runs a script, and the posts it records go to the flow's own recorder as findings. Like `run` it resolves when
   * the mission is over. It throws (an ApiError) when the check cannot start: the account is busy, signed out or has no engine that can work the browser.
   * Whether the check counts as made is the flow's decision: what the AI said is only a note.
   */
  async watch(request: WatchMissionRequest): Promise<WatchOutcome> {
    const account = this.accounts.account(request.accountId)
    const engine = await this.watchPrerequisites(account)
    const setup = { watch: { places: request.brief.places.map((place) => place.url), record: request.record, recordStats: request.recordStats, recordBody: request.recordBody, maxFindings: WATCH_MAX_FINDINGS, minGapMs: WATCH_MIN_GAP_MS, now: () => this.core.clock.now().getTime() } }
    return this.look('watch', account, engine, { channelId: request.channelId, maxCalls: request.brief.maxCalls, title: `the AI is looking at ${request.brief.channelTarget}`, subject: account.profileId ?? account.id, hosts: request.hosts, prompt: watchMissionPrompt(request.brief, this.core.clock.now()), setup })
  }

  /** What a search for trends needs (REQ-004): an account that is signed in, no run going on it, and an engine that can work the browser. */
  private async researchPrerequisites(account: Account): Promise<AiEngine> {
    if (account.status !== 'ready') throw new ApiError('not_ready', `${account.label} is not signed in, so its browser cannot search for trends. Sign in first.`)
    return this.readyEngine(account, true)
  }

  async researchReady(accountId: string): Promise<AgentReadiness> {
    try {
      await this.researchPrerequisites(this.accounts.account(accountId))
      return { ready: true, reason: null }
    } catch (error) {
      if (error instanceof ApiError) return { ready: false, reason: error.message }
      throw error
    }
  }

  /**
   * One search for what the platform's people talk about, worked by the AI in the account's browser for the owner who is writing a post (REQ-004). Only the
   * quick-post helper calls this, on the owner's press. The AI only reads, with the very tools of a watch mission but for the record of topics, which go to
   * the helper's own list and are stored nowhere. Like `watch` it resolves when the mission is over and throws (an ApiError) when it cannot start.
   */
  async research(request: ResearchMissionRequest): Promise<ResearchOutcome> {
    const account = this.accounts.account(request.accountId)
    const engine = await this.researchPrerequisites(account)
    const research: ResearchSetup = { places: request.brief.places.map((place) => place.url), record: request.record, maxTopics: RESEARCH_MAX_TOPICS, minGapMs: RESEARCH_MIN_GAP_MS, now: () => this.core.clock.now().getTime() }
    return this.look('research', account, engine, { title: 'the AI is searching for what people talk about', subject: request.subject, hosts: request.hosts, prompt: researchMissionPrompt(request.brief, this.core.clock.now()), setup: { research } })
  }

  /**
   * A mission that only looks (a watch, a research): the AI has the six reading tools, nobody can be asked anything, and the run ends in a way the caller can
   * tell apart (finished, stopped, timeout, error, busy). Whether it counts as made is the caller's decision: what the AI said is only a note.
   */
  private async look(
    kind: 'watch' | 'research',
    account: Account,
    engine: AiEngine,
    options: { channelId?: string; title: string; subject: string; hosts: string[]; prompt: string; maxCalls?: number; setup: { watch: WatchSetup } | { research: ResearchSetup } }
  ): Promise<WatchOutcome> {
    const spec = MISSIONS[kind]
    const words = LOOKS[kind]
    const live: Live = {
      abort: new AbortController(),
      answer: null,
      reported: null,
      exchange: null,
      task: null,
      run: { accountId: account.id, kind, ...(options.channelId ? { channelId: options.channelId } : {}), status: 'running', summary: spec.opening, lines: [], typed: [], question: null, learned: [], startedAt: this.core.clock.now().toISOString(), finishedAt: null }
    }
    // The engine check before awaited: another start may have taken the account, or the last place beside its looks, meanwhile.
    this.assertRoomToLook(account)
    this.claimLook(account, live)
    let ended: WatchOutcome['ended'] = 'finished'
    let error: string | null = null
    let toolbox: BrowserToolbox | null = null
    let lastWords = ''
    try {
      this.core.log.info('accounts', `The AI started to ${spec.doing} ${account.label} on ${options.hosts[0] ?? 'the platform'} (${engine.label}).`)
      this.core.events.changed('accounts')
      const task = await this.openTask(account, live, `agent-${kind}`, options.title)
      toolbox = new BrowserToolbox({
        withPage: (work) => task.withAgentControl(work),
        hosts: options.hosts,
        values: {},
        sleep: this.core.sleep,
        say: (line) => this.say(live, line),
        ask: async () => 'Nobody can be asked in this mission.',
        note: () => undefined,
        report: (result) => void (live.reported = result),
        signal: live.abort.signal,
        maxCalls: options.maxCalls ?? spec.maxCalls,
        rhythm: this.rhythmOf(account.id),
        ...options.setup
      })
      const said = await this.runEngine(live, engine, toolbox, `agent.${kind}`, options.subject, options.prompt, spec.timeoutMs, true)
      lastWords = said.trim().replace(/\s+/g, ' ').slice(0, LAST_WORDS_MAX)
      if (lastWords) this.say(live, `The AI: ${lastWords.slice(0, 240)}`)
    } catch (caught) {
      if (caught instanceof AiError && caught.kind === 'cancelled') ended = 'stopped'
      else if (caught instanceof AiError && caught.kind === 'timeout') ended = 'timeout'
      else if (caught instanceof TakeoverError || (caught instanceof ApiError && caught.code === 'browser_busy')) ended = 'busy'
      else {
        ended = 'error'
        error = caught instanceof Error ? caught.message : String(caught)
      }
    } finally {
      this.dropQuestion(live, 'The check is over.')
      await live.task?.close()
    }
    if (toolbox?.watchPaused) ended = 'busy'
    if (live.run.status !== 'running') ended = 'stopped' // the owner stopped it (its run was finished by `stop`)

    const reported = live.reported ? { status: live.reported.status, reason: live.reported.reason } : null
    // A look that ended by itself without saying how it went: the log keeps how far it got and its last words, never what the pages said, so the next
    // look is not a guess (the owner saw this end six times in a row with nothing to go on).
    if (ended === 'finished' && !reported && live.run.status === 'running') this.logUnreported(account, live, toolbox, lastWords, words.did)
    if (live.run.status === 'running') {
      if (ended === 'busy') this.finish(live, 'stopped', words.busy)
      else if (ended === 'timeout') this.finish(live, 'failed', words.timeout)
      else if (ended === 'error') this.finish(live, 'failed', `The AI stopped because of an error: ${error}`)
      else this.finish(live, reported?.status ?? 'failed', reported?.reason || 'The AI ended without saying how it went.')
    }
    this.core.log.info('accounts', `${words.did} ${account.label}${reported ? ` (it reported "${reported.status}")` : ''}.`)
    return { ended, reported, humanCheck: toolbox?.observed.humanCheck ?? null, error, said: lastWords, outOfCalls: toolbox?.progress.outOfCalls ?? false }
  }

  /** One line in the log for a look that ended without its report: the calls it made, what it recorded, the last page it was on and what it said last. */
  private logUnreported(account: Account, live: Live, toolbox: BrowserToolbox | null, lastWords: string, did: string): void {
    const progress = toolbox?.progress
    const where = progress?.address ? `${displayAddress(progress.address)}${progress.title ? ` ("${progress.title.replace(/\s+/g, ' ').slice(0, 80)}")` : ''}` : 'no page at all'
    const calls = progress ? `${progress.calls} tool call${progress.calls === 1 ? '' : 's'}, ${progress.recorded} post${progress.recorded === 1 ? '' : 's'} recorded` : 'no tool called'
    this.core.log.warn('accounts', `${did} ${account.label} ended without a report after ${calls}. The last page: ${where}. The AI's last words: ${lastWords ? `"${lastWords}"` : 'none'}.`, live.run.channelId)
  }

  /**
   * Checks what a registration needs and gathers everything but the password; the returned function reads the password from the vault (the
   * keychain is asked there and nowhere else) and completes the mission. That the password is saved is a lookup in the vault file.
   */
  private signUpMission(account: Account): () => Promise<Mission> {
    if (!account.email) throw new ApiError('no_email', `${account.label} has no e-mail yet. Add the e-mail address of the account first.`)
    if (!this.vault.has(account)) throw new ApiError('no_password', `No password is saved for ${account.label}. Save the password the account should have first.`)
    const email = account.email
    const target = this.accounts.signUpTarget(account)
    const platform = presetFor(account.platform)?.label ?? account.platform

    const profile = this.profiles.approved(account)

    const facts = this.contextFacts(account, platform)
    facts.push(...profileFacts(profile))
    facts.push('Use the same e-mail address and password everywhere. Do not tick optional boxes about ads, newsletters or contacts; tick only what the site requires to continue.')
    const files = this.pictureFiles(account, profile)
    const lessons = this.lessons.forPlatform(account.platform).map((l) => l.rule)

    return async () => {
      const password = await this.vault.password(account)
      if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}. Save the password the account should have first.`)
      const values: Mission['values'] = {
        EMAIL: { value: email, describe: 'the e-mail address of the account (use it wherever the site asks for an e-mail address or login)', secret: false },
        PASSWORD: { value: password, describe: 'the password of the account', secret: true },
        USERNAME: { value: profile.username, describe: 'the user name the account should have, if the site asks for one', secret: false }
      }
      return {
        goal: `Create a new account on ${platform} for the owner, with the profile below: fill in everything the site needs, and make sure the account exists and is signed in.`,
        facts,
        startUrl: target.url,
        hosts: target.hosts,
        values,
        files,
        lessons
      }
    }
  }

  /**
   * Signing in to an account that has no credentials of its own (DEC-027): Threads through its Instagram account. Everything but the
   * password is gathered here; the returned function reads the Instagram password from the vault for this one mission. The password is bound
   * to the hosts of the Instagram account's platform: the toolbox refuses to type it on any other page, Threads' own included.
   */
  private signInMission(account: Account): () => Promise<Mission> {
    if (!account.signsInVia) {
      const wanted = presetFor(account.platform)?.signsInWith
      // An account made before the platform signed in through another one has no link yet: the way on is to choose the account, not a password.
      if (wanted) throw new ApiError('no_via', `${account.label} signs in through a ${presetFor(wanted)?.label ?? wanted} account, and none is chosen yet. Choose it in the account first.`)
      throw new ApiError('invalid_input', `${account.label} has credentials of its own: sign in with its saved password, or in its browser.`)
    }
    const via = this.accounts.account(account.signsInVia)
    const login = via.loginName ?? via.email
    const viaPlatform = presetFor(via.platform)?.label ?? via.platform
    if (!login) throw new ApiError('no_email', `${via.label} has no login name or e-mail yet. ${account.label} signs in through it, so add that to ${via.label} first.`)
    if (!this.vault.has(via)) throw new ApiError('no_password', `No password is saved for ${via.label}. ${account.label} signs in through it, so save its password first.`)
    const target = this.accounts.signInTarget(account)
    const viaHosts = this.accounts.signInTarget(via).hosts
    const platform = presetFor(account.platform)?.label ?? account.platform
    const hosts = [...new Set([...target.hosts, ...viaHosts])]

    return async () => {
      const password = await this.vault.password(via)
      if (password === null) throw new ApiError('no_password', `No password is saved for ${via.label}. ${account.label} signs in through it, so save its password first.`)
      return {
        goal: `Sign in to ${platform} for the owner. ${platform} has no password of its own: it signs in through the owner's ${viaPlatform} account "${via.label}". Make sure ${platform} shows this account signed in.`,
        facts: [
          `${platform}'s sign-in page offers to continue with ${viaPlatform}; there is no ${platform} user name or password, and the owner is never asked for one.`,
          `The ${viaPlatform} account to use is "${via.label}"${via.identity ? `, signed in there as ${via.identity}` : ''}. Its login and its password are given as values below.`
        ],
        startUrl: target.url,
        hosts,
        values: {
          LOGIN: { value: login, describe: `the login of the ${viaPlatform} account (its user name or e-mail address), for ${viaPlatform}'s own sign-in page`, secret: false },
          PASSWORD: { value: password, describe: `the password of the ${viaPlatform} account; it is typed only on ${viaPlatform} pages (${viaHosts.join(', ')})`, secret: true, hosts: viaHosts }
        },
        lessons: this.lessons.forPlatform(account.platform).map((l) => l.rule),
        rules: [
          `On ${platform} take the way that continues with ${viaPlatform} (a button like "Continue with ${viaPlatform}" or "Log in with ${viaPlatform}"). Never take a way that asks for a ${platform} user name or password of its own.`,
          `You may go to the ${viaPlatform} sign-in pages (${viaHosts.join(', ')}) for this and nowhere else. On them sign in with {{LOGIN}} and {{PASSWORD}}, then approve what ${platform} asks, to continue as the account. If the page already offers "Continue as <name>" for the right account, use that.`,
          `{{PASSWORD}} goes only into a password field of a ${viaPlatform} page: the application refuses it anywhere else.`,
          'Change nothing in the account: no profile, privacy or security setting, and post nothing.',
          `The mission is done when ${platform} shows the account signed in (its feed, its profile or its menu), not when a button was pressed.`
        ]
      }
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
      goal: `The account on ${platform} already exists and is signed in. Find where this site lets the account edit its own profile (look for it yourself: the avatar or the account menu, "Profile", "Edit profile", "Settings", "Account"; no address is given) and fill in every profile field the site has from the profile below: the display name, the first and last name, the about-text (bio, description, headline), the place, the website, the birthday, the gender and the picture.`,
      facts,
      startUrl: target.url,
      hosts: target.hosts,
      values: {},
      files: this.pictureFiles(account, profile),
      lessons: this.lessons.forPlatform(account.platform).map((l) => l.rule),
      rules: [
        'Change only the profile fields named in the facts. Do not change the e-mail address, the password, the user name or any privacy or security setting.',
        'If the site shows a sign-in page instead of the account, the account is not signed in: report needs_owner and say so.',
        'Every site keeps its profile in another place and names the fields differently (bio, about, description, headline, location, link, avatar, photo): match each value of the profile to the site\'s field by its meaning, and put a value only where it fits.',
        'The picture goes through browser_upload into a file input of the page (listed as input:file, even when the site hides it behind a button). Never click a photo button that opens a file chooser.',
        'A field the site does not have is skipped without a word; do not hunt for it. Save the profile if the site has a save button, then open the public profile page again and confirm the values are shown. Record what you filled with note_value.'
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
  private pictureFiles(account: Account, profile: Profile): Mission['files'] {
    const path = profile.hasPicture ? this.profiles.pictureFile(profile.id) : null
    if (!path) return undefined
    const kb = sizeInKb(path)
    return { PICTURE: { path, describe: `the profile picture the owner approved${kb ? ` (${kb} KB)` : ''} (upload it where the site asks for a profile photo or an avatar; when the site limits the size, upload it with shrink_to_kb)` } }
  }

  private async drive(account: Account, live: Live, mission: Mission, engine: AiEngine, kind: AgentTaskKind): Promise<void> {
    const bridge = this.core.agentBridge
    if (!bridge) return this.finish(live, 'failed', 'The AI browser agent is not available in this build.')
    const session = this.core.browser.session(account)
    const join = mission.join
    // The owner may use a sign-in or sign-out page of the same session in a window of their own (DEC-038): a join is made by the account that was
    // signed in when the mission began, or by nobody.
    const startedAt = session.identityEpoch()
    // Smaller copies of a picture, for a site that limits its size; they are removed when the mission ends.
    const shrunkDir = pathJoin(this.core.dataDir, 'shrunk', account.id)
    const toolbox = new BrowserToolbox({
      // Each call holds the mission's page only for itself, so an explicit Take control can come between two calls.
      withPage: (work) => this.taskOf(live).withAgentControl(work),
      hosts: mission.hosts,
      values: mission.values,
      files: mission.files,
      sleep: this.core.sleep,
      say: (line) => this.say(live, line),
      ask: (question) => this.ask(live, question),
      note: (label, value) => this.note(live, label, value),
      remember: (rule, scope) => this.remember(account, live, rule, scope),
      shrink: this.core.imageShrinker ? (path, maxBytes) => this.core.imageShrinker!.shrink(path, maxBytes, shrunkDir) : undefined,
      report: (result) => void (live.reported = result),
      signal: live.abort.signal,
      // A join mission has its own seven tools, one allowed click and a pause between actions; the others are as they were.
      ...(join ? { maxCalls: MISSIONS[kind].maxCalls, join: { community: join.community, destination: join.destination, minGapMs: JOIN_MIN_GAP_MS, now: () => this.core.clock.now().getTime(), sessionMoved: () => session.identityEpoch() !== startedAt } } : {})
    })
    try {
      const today = this.core.clock.now().toISOString().slice(0, 10)
      // A join mission is quiet for every engine, and held to the application's tools alone when the engine can be, like a publication.
      const said = await this.runEngine(live, engine, toolbox, `agent.${kind}`, account.profileId ?? account.id, join ? joinMissionPrompt(join, today) : missionPrompt(mission, today), MISSIONS[kind].timeoutMs, join !== undefined)
      if (live.run.status !== 'running') return // stopped by the owner while the engine was ending
      if (said.trim()) this.say(live, `The AI: ${said.trim().replace(/\s+/g, ' ').slice(0, 240)}`)
      if (join) await this.concludeJoin(account, live, join, toolbox.joinPressed)
      else await this.conclude(account, live, kind)
    } catch (error) {
      if (live.run.status !== 'running') return
      if (error instanceof AiError && error.kind === 'cancelled') return this.finish(live, 'stopped', 'The AI was stopped.')
      if (error instanceof AiError && error.kind === 'timeout') {
        if (join) {
          // A join that was pressed may have worked before the AI ran out of time: what the account is now is for the application to read.
          try {
            return await this.concludeJoin(account, live, join, toolbox.joinPressed, true)
          } catch {
            return this.finish(live, 'needs_owner', JOIN_TIMED_OUT)
          }
        }
        return this.finish(live, 'needs_owner', 'The AI did not finish in half an hour and was stopped. Its window is closed: open the browser to continue yourself.')
      }
      if (error instanceof TakeoverError || (error instanceof ApiError && error.code === 'browser_busy')) return this.finish(live, 'needs_owner', BROWSER_BUSY)
      const reason = error instanceof Error ? error.message : String(error)
      this.core.log.warn('accounts', `The AI could not ${MISSIONS[kind].doing} ${account.label}: ${reason}`)
      this.finish(live, 'failed', `The AI stopped because of an error: ${reason}`)
    } finally {
      this.dropQuestion(live, 'The mission is over.')
      await live.task?.close()
      await rm(shrunkDir, { recursive: true, force: true })
    }
  }

  /**
   * Offers the toolbox to the engine, lets the engine work the mission, and closes the tools again, however it ends. Resolves with what the engine said last.
   * A mission that publishes or reads pages of strangers (`strangers`) is quiet for every engine, and held to the application's tools alone when the engine can be.
   */
  private async runEngine(live: Live, engine: AiEngine, toolbox: BrowserToolbox, label: string, subject: string, prompt: string, timeoutMs: number, strangers = false): Promise<string> {
    const bridge = this.core.agentBridge
    if (!bridge) throw new ApiError('no_agent_bridge', 'The AI browser agent is not available in this build.')
    const opened = await bridge.open(toolbox)
    try {
      return await engine.run({ label, subject, prompt, agent: { server: SERVER_NAME, launch: opened.launch, ...(strangers ? { quiet: true } : {}), ...(strangers && engine.confinesAgent === true ? { confined: true } : {}) }, timeoutMs }, { signal: live.abort.signal })
    } finally {
      opened.close()
    }
  }

  /**
   * The engine of a join mission has ended. The AI's word counts for nothing here: when the join was pressed (or the AI says it is done)
   * the application reads from Reddit whether the account is a member now, once more after a short wait when the AI says it is done (the
   * page of the community is not instant). Only that read makes the run done, and the channel is then assessed again so that every row of
   * its table is current. When the AI stopped for a person (a sign-in, a request to join, a gate) before anything was pressed, nothing is
   * read: the page where the person continues is not loaded over. What the AI said is shown to the owner as the AI's, the log keeps a
   * fixed phrase and the status.
   */
  private async concludeJoin(account: Account, live: Live, join: NonNullable<Mission['join']>, pressed: boolean, timedOut = false): Promise<void> {
    const reported = live.reported
    const says = (fallback: string): string => (reported?.reason ? `The AI says: ${reported.reason}` : fallback)
    let state: Membership | string | null = null
    if (pressed || reported?.status === 'done') {
      state = await this.tryMembership(join.channelId)
      if (typeof state !== 'string' && state.member !== true && reported?.status === 'done') {
        await this.core.sleep(JOIN_RECHECK_MS)
        state = await this.tryMembership(join.channelId)
      }
    }
    if (live.run.status !== 'running') return
    if (state !== null && typeof state !== 'string' && state.member === true) {
      this.core.log.info('accounts', `The AI joined ${join.community} with ${account.label}.`)
      this.finish(live, 'done', `Joined ${join.community}. The channel is being assessed again.`)
      await this.assessAfterJoin(join.channelId)
      return
    }
    if (reported) this.core.log.info('accounts', `The AI stopped on ${account.label} (it reported "${reported.status}").`)
    if (reported?.status === 'needs_owner') return this.finish(live, 'needs_owner', says('The AI needs you.'))
    if (reported?.status === 'failed') return this.finish(live, 'failed', says('The AI could not join.'))
    if (typeof state === 'string') {
      return this.finish(live, 'needs_owner', `The AI has finished, but the application could not check whether ${account.label} joined (${state}). Assess the channel to see.`)
    }
    if (timedOut) return this.finish(live, 'needs_owner', JOIN_TIMED_OUT)
    const why = reported ? 'The AI says it is done, but Reddit does not show this account as a member yet.' : 'The AI stopped without joining.'
    this.finish(live, 'needs_owner', `${why} Join in the account's browser, then assess the channel again.`)
  }

  /** What the account is now, or the reason it could not be read (in the connector's own safe words). */
  private async tryMembership(channelId: string): Promise<Membership | string> {
    try {
      return await this.membershipOf(channelId)
    } catch (error) {
      return error instanceof Error ? error.message.slice(0, 160) : 'unknown error'
    }
  }

  private async membershipOf(channelId: string): Promise<Membership> {
    const { connector, ctx } = this.core.connectorContext(channelId)
    if (!connector.membership) throw new ApiError('not_supported', 'This platform cannot tell whether an account has joined.')
    return connector.membership(ctx)
  }

  /** Best effort: the join is done whether or not the assessment that follows it works (the owner can press Assess again). */
  private async assessAfterJoin(channelId: string): Promise<void> {
    try {
      await this.channels.assess(channelId)
    } catch (error) {
      this.core.log.warn('accounts', `The community was joined, but the channel could not be assessed again: ${error instanceof Error ? error.message : String(error)}`)
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
      if (kind === 'signin') {
        this.core.log.info('accounts', `The AI signed in to ${account.label}${checked.identity ? ` as ${checked.identity}` : ''}.`)
        return this.finish(live, 'done', checked.identity ? `Signed in as ${checked.identity}.` : 'Signed in.')
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

  /** The AI keeps a rule from the owner's answer: it is stored, shown in the run with an Undo, and given to the next missions. */
  private remember(account: Account, live: Live, rule: string, scope: 'platform' | 'all'): { known: boolean } {
    const { lesson, known } = this.lessons.remember({ platform: scope === 'all' ? null : account.platform, rule, question: live.exchange?.question ?? '', answer: live.exchange?.answer ?? '' })
    if (live.run.status === 'running' && !live.run.learned.some((l) => l.id === lesson.id)) live.run.learned.push({ id: lesson.id, rule: lesson.rule })
    this.core.events.changed('accounts')
    return { known }
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
    // The window the AI worked in is closed with the mission: whatever the owner needs to continue they open themselves.
    void live.task?.close()
    this.core.events.changed('accounts', 'attention')
  }

  /** Gives the mission its own page and window (the owner watches the AI work in it; it is shown without taking the focus). */
  private async openTask(account: Account, live: Live, owner: string, title?: string): Promise<AgentTask> {
    const task = this.core.browser.session(account).task(owner)
    live.task = task
    await task.show(title)
    return task
  }

  private taskOf(live: Live): AgentTask {
    if (!live.task) throw new Error('The mission has no page.')
    return live.task
  }
}

/** An address without its query and fragment: where the AI was, not what it searched for. */
function displayAddress(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return url.slice(0, 120)
  }
}

/** The size of a file in kilobytes, or 0 when it cannot be read. */
function sizeInKb(path: string): number {
  try {
    return Math.max(1, Math.round(statSync(path).size / 1024))
  } catch {
    return 0
  }
}

/** The approved profile as facts for the AI: exactly what it types, and why the profile is what it is. */
function profileFacts(profile: Profile): string[] {
  const facts = ['THE PROFILE (the owner approved it; type exactly these values and never invent another personal detail):']
  if (profile.purpose) facts.push(`What the profile is for: ${profile.purpose}`)
  facts.push(`First name: ${profile.firstName}. Last name: ${profile.lastName}. Display name: ${profile.displayName}. User name: ${profile.username}.`)
  facts.push(`Birth date: ${profile.birthDate} (day, month and year as the form asks). Gender: ${profile.gender}.`)
  if (profile.place) facts.push(`Place: ${profile.place}.`)
  if (profile.about) facts.push(`About-text: ${profile.about}`)
  if (profile.website) facts.push(`Website: ${profile.website}`)
  return facts
}

const snapshot = (run: AgentRun): AgentRun => ({ ...run, lines: [...run.lines], typed: run.typed.map((t) => ({ ...t })), question: run.question ? { ...run.question } : null, learned: run.learned.map((l) => ({ ...l })) })
