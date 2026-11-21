// Watching a channel the app cannot read itself, through the account's browser (DEC-042, DEC-045). The monitor calls this for a channel with
// `watchedInBrowser` (any platform or site: Instagram, a Reddit community whose list Reddit refuses, a forum); the AI agent service does the looking, the findings table keeps
// what it recorded, and this flow decides what the look was worth: a whole look moves the cursor and sets the first-look mark, anything else leaves
// them alone so the next look covers the same ground (a post is recorded once, so nothing is judged twice).
//
// What this never does: reply, measure, baseline, draft, approve or send anything. The channel keeps `reads = false`; what the AI records is a
// finding (a notice or a skip), and `reply` is only ever a notice that says so. There is no opportunity in this file.

import { ApiError } from '../../shared/api'
import type { Account, Channel } from '../../shared/types'
import { WATCH_FIRST_LOOK_MAX_CALLS, WATCH_KNOWN_LIMIT, WATCH_MAX_CALLS, WATCH_MAX_POSTS, WATCH_TIMEOUT_MS, type WatchBrief, type WatchItem, type WatchOutcome, type WatchRecorded } from '../browser-agent/watch'
import { MAX_LOOK_BACK_DAYS } from '../channels/settings'
import { webPlaces } from '../channels/web-places'
import { platformLabel } from '../../shared/post-format'
import type { Core } from '../core'
import type { FindingStore } from './findings'
import type { Ingestor } from './ingest'
import type { FlowStore } from './store'
import { OVERLAP_MS } from './triage'
import { errorMessage } from './util'

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60_000

/** What a look at a channel came to, for the monitor to put into the channel's state. */
export type WatchResult =
  | { status: 'done'; summary: string }
  /** The AI could not go on without a person: a sign-in, a CAPTCHA, a check. `humanCheck`: the last page showed a human check. */
  | { status: 'needs_owner'; reason: string; humanCheck: boolean }
  | { status: 'failed'; reason: string }
  /** The look saved posts and then ran out of calls: what it saved stands, nothing failed, and it goes on soon. The cursor does not move. */
  | { status: 'partial'; summary: string }
  /** The look did not run: nothing failed. `soon`: it is tried again in a few minutes; otherwise at the channel's next regular check. */
  | { status: 'deferred'; reason: string; soon: boolean }

/** The ways a look cannot even start that are not the channel's fault: the account is busy or signed out, the engine is not ready or cannot work the browser. */
const NOT_STARTED = new Set(['agent_running', 'not_ready', 'no_engine', 'engine_cannot_drive', 'engine_unavailable', 'no_agent_bridge', 'browser_busy'])

const deferred = (reason: string, soon = true): WatchResult => ({ status: 'deferred', reason, soon })

export class BrowserWatchFlow {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly findings: FindingStore,
    private readonly ingestor: Ingestor
  ) {}

  /** One look at the channel. Never throws for what it can name: the monitor turns the result into the channel's state. */
  async run(channel: Channel, account: Account): Promise<WatchResult> {
    const missions = this.core.services.watchMissions
    if (!missions) return deferred('The AI browser is not available in this build, so this channel is not watched.')
    const startedAt = this.core.clock.now()
    const now = startedAt.getTime()
    const cursor = this.findings.listedThrough(channel.id)
    const firstLook = cursor === null
    const days = Math.min(channel.settings.lookBackDays, MAX_LOOK_BACK_DAYS)
    if (firstLook && !(days > 0)) {
      // No look-back wanted: the channel starts from now, and the next checks look at what is new.
      this.finish(channel, startedAt.toISOString())
      return { status: 'done', summary: 'Watching starts now: no look-back was asked for' }
    }
    const last = cursor === null ? Number.NaN : Date.parse(cursor)
    // Never further back than the look-back can go, so a post whose finding was forgotten (60 days) is not found and judged again.
    const since = firstLook ? now - days * DAY_MS : Math.max((Number.isFinite(last) ? last : now - DAY_MS) - OVERLAP_MS, now - MAX_LOOK_BACK_DAYS * DAY_MS)

    const ready = await missions.watchReady(account.id)
    if (!ready.ready) return deferred(`The channel was not looked at: ${ready.reason ?? 'the AI cannot work in this account now'}`)

    const tally = { noted: 0, skipped: 0, known: 0 }
    const isOwn = this.ingestor.ownPostTest(channel, account)
    const record = (items: WatchItem[]): WatchRecorded => {
      let stored = 0
      let known = 0
      this.core.db.transaction(() => {
        for (const item of items) {
          // The account's own posts are not what it watches for, whatever the AI says.
          if (isOwn({ author: item.author, externalId: item.url })) continue
          if (this.findings.addWatched(channel.productId, channel.id, item, firstLook)) {
            stored += 1
            if (item.label === 'skip') tally.skipped += 1
            else tally.noted += 1
          } else known += 1
        }
      })()
      tally.known += known
      return { stored, known }
    }

    let outcome: WatchOutcome
    try {
      outcome = await missions.watch({ accountId: account.id, channelId: channel.id, hosts: webPlaces(channel).hosts, brief: this.brief(channel, account, firstLook, days, since), record })
    } catch (error) {
      if (error instanceof ApiError && NOT_STARTED.has(error.code)) return deferred(`The channel was not looked at: ${error.message}`)
      this.core.log.error('monitor', `The look at the channel stopped unexpectedly: ${errorMessage(error)}`, channel.id)
      return { status: 'failed', reason: `The look at the channel stopped unexpectedly: ${errorMessage(error)}` }
    }
    // Whatever the look came to, what it recorded stands and the Feed shows it.
    this.findings.pruneSkipped()
    if (tally.noted + tally.skipped > 0) this.findings.notify()
    return this.result(channel, outcome, startedAt.toISOString(), tally)
  }

  private result(channel: Channel, outcome: WatchOutcome, startedAt: string, tally: { noted: number; skipped: number; known: number }): WatchResult {
    const { reported } = outcome
    if (outcome.ended === 'busy') return deferred('The browser was in use (another task of the account, or you), so the look stopped. It is tried again soon.')
    if (outcome.ended === 'stopped') return deferred('You stopped the AI. The channel is looked at again at its next check.', false)
    if (outcome.ended === 'timeout') return { status: 'failed', reason: `The AI did not finish in ${WATCH_TIMEOUT_MS / MINUTE_MS} minutes and was stopped.` }
    if (outcome.ended === 'error') return { status: 'failed', reason: `The AI stopped because of an error: ${outcome.error ?? 'unknown error'}` }
    if (outcome.humanCheck) return { status: 'needs_owner', reason: `The site shows a human check (${outcome.humanCheck}): solve it in the account's browser.`, humanCheck: true }
    if (reported?.status === 'needs_owner') return { status: 'needs_owner', reason: `The AI needs you: ${reported.reason || 'the site asks for something only a person can do.'}`, humanCheck: false }
    // Out of calls: what the AI said about how it went does not make the look whole, however it put it. What it saved stands and the next look goes on.
    if (outcome.outOfCalls) {
      const seen = tally.noted + tally.skipped
      if (seen + tally.known === 0) return { status: 'failed', reason: `The AI used all its tool calls without saving a single post${outcome.said ? ` (its last words: "${outcome.said}")` : ''}.` }
      return { status: 'partial', summary: `Looked at part of it and ran out of calls: ${tally.noted} noted, ${tally.skipped} judged not relevant, ${tally.known} already known. The next look goes on` }
    }
    if (!reported) return { status: 'failed', reason: `The AI ended without saying how it went${outcome.said ? ` (its last words: "${outcome.said}")` : ''}, so the look does not count.` }
    if (reported.status === 'failed') return { status: 'failed', reason: `The AI could not look at the channel: ${reported.reason || 'it gave no reason.'}` }
    // Only a look that was whole moves the cursor, and to the moment it STARTED: a post written while it ran is looked at again next time.
    this.finish(channel, startedAt)
    return { status: 'done', summary: `Watched in the browser: ${tally.noted} noted, ${tally.skipped} judged not relevant, ${tally.known} already known` }
  }

  /** The look was whole: the cursor moves to where it started, and the first look is marked as made (once). */
  private finish(channel: Channel, startedAt: string): void {
    this.core.db.transaction(() => {
      this.findings.setListedThrough(channel.id, startedAt)
      if (channel.lookedBackAt === null) this.store.updateChannel(channel.id, { lookedBackAt: startedAt })
    })()
  }

  /** What the AI is told: the owner's product and goals, the channel's newest posts (or its own page), how far back, and what was judged. */
  private brief(channel: Channel, account: Account, firstLook: boolean, lookBackDays: number, since: number): WatchBrief {
    const product = this.core.repos.product(channel.productId)
    const site = webPlaces(channel)
    // The owner asked for one thing: what was posted in the channel since the last look (30 days the first time). So the AI goes through the channel itself,
    // the newest posts first where the site has such a page (a Reddit community's own page shows its best posts, not what was written since the last look),
    // and never searches: the channel's queries only tell it what the owner follows, and "Look around" is where the owner asks for a search.
    const places = [...(site.newest ? [{ label: `The newest posts of ${channel.target}`, url: site.newest }] : []), { label: `The channel's own page, ${channel.target}`, url: channel.url }]
    const queries = channel.settings.queries.filter((q) => q.trim() !== '')
    return {
      platform: platformLabel(channel.platform),
      channelTarget: channel.target,
      channelUrl: channel.url,
      accountLabel: account.label,
      accountIdentity: account.identity,
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      goals: product.goals.map((g) => ({ targetAction: g.targetAction, successMetrics: g.successMetrics })),
      topics: channel.settings.topics,
      queries,
      places,
      firstLook,
      lookBackDays,
      since: new Date(since).toISOString(),
      known: this.findings.recentUrls(channel.id, WATCH_KNOWN_LIMIT),
      maxPosts: WATCH_MAX_POSTS,
      maxCalls: firstLook ? WATCH_FIRST_LOOK_MAX_CALLS : WATCH_MAX_CALLS
    }
  }
}
