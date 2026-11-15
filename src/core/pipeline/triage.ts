// The AI triage of what a channel shows (DEC-040): every post of the channel is judged once, by its title first (cheap, 40 titles to a call), and only a
// post whose title bears on the product's goals is opened, read with its top comments and given a label: reply, notice or skip, with a line on how it
// relates to the goals.
//
// A pass runs inside the monitor's cycle, after the inbox read, and NEVER throws and never fails the cycle: whatever goes wrong (the listing, the engine,
// a thread that cannot be read, an answer that cannot be used) leaves the posts as they are, without a label, for the next pass. Nothing is lost.
// An answer that cannot be used (after the one repair) is counted against the post (attempts); at the third it is shown to the owner as a notice
// that says the AI could not judge it (findings.ts). A failure that is not an answer (engine not ready, tools, timeout, error, browser taken) is not counted.
// Nor is an engine that is broken blamed on posts (owner-delegated decision of DEC-040): an attempt is counted only when the engine is `proven` to work,
// and a batch whose halves both fail while it is NOT proven is taken for a fault of the engine, not of the titles: the pass ends (see `cut`). Once it is
// proven, the same failure is bad titles, which are isolated and counted. Proven: it judged a post in this pass, or any finding was labelled by a real
// judgment within the last 24 hours (findings.ts). The accepted tradeoff: an engine that breaks within a day of a good pass can have posts charged
// attempts; a post charged three times is shown as a notice saying the AI could not judge it, and is never dropped.
//
// What this never does: approve, send or draft anything. `reply` opens the ordinary `new_post` opportunity (Ingestor.ingestTriagedPost), which has all
// of its guards and needs the owner's Approve like any other; `notice` and `skip` are findings and nothing more. Everything of a post that a stranger
// wrote is untrusted: it only reaches the engine inside a fence, and the engine's answer is read by hand (triage-prompt.ts).
//
// Which posts: the first pass of a channel looks back `lookBackDays` (0 = not at all); every later pass lists the posts written since the cursor
// (`listed_through`: the start of the last listing that was read WHOLE), less an hour of overlap (a post is judged once whatever the overlap). A listing that
// fails or is interrupted leaves the cursor alone, so the posts of its window are listed at the next pass. Posts of the account itself are never judged.
//
// How much a pass does is bounded: five batches of titles, ten threads read (failed tries beside them, up to 30), and a wall-clock budget (`PASS_BUDGET_MS`)
// after which no new call is started; what is left stays pending, uncharged, for the next pass.

import type { Account, Channel, Finding, Id } from '../../shared/types'
import { readyEngine } from '../assist/gate'
import { askWithRepair, oneLine } from '../assist/kit'
import { MAX_LOOK_BACK_DAYS } from '../channels/settings'
import type { Core } from '../core'
import { AiError, TakeoverError, type AiEngine, type Connector, type ConnectorContext, type RemoteDiscussion } from '../ports'
import { roleView } from './context'
import { MAX_ATTEMPTS, POST_GONE, type FindingStore } from './findings'
import type { Ingestor } from './ingest'
import { INBOX_PACING_MS } from './inbox'
import type { FlowStore } from './store'
import {
  MAX_TITLES_PER_CALL,
  buildReadTask,
  buildTitlesTask,
  readReadAnswer,
  readTitleAnswer,
  type TriageContext
} from './triage-prompt'
import { errorMessage } from './util'

/** Posts asked of one listing: what Reddit's listing can give at most (10 pages of 100). A listing that comes back full was cut: see `outcome`. */
export const LIST_MAX = 1000
/** Titles judged in one pass (five batches), the newest first: the rest of a long listing waits as pending and is worked off over the next passes. */
export const MAX_TITLES_PER_PASS = 200
/** Threads read in one pass, the newest first (those that failed the least first); the rest are read in the next passes. */
export const MAX_READS_PER_PASS = 10
/**
 * Threads tried in one pass, the ones that cannot be fetched included: they do not use up the reads, so ten unreadable posts at the head cannot keep an
 * older good one from being read (a failure is charged to a post only when some other thread was read in the pass: see `countUnreadable`).
 */
export const MAX_READ_TRIES_PER_PASS = 30
/**
 * How long a pass may keep STARTING new calls (a listing is not one; a title batch, a thread and a read are), measured on the clock of the core. The
 * scheduler gives a whole cycle ten minutes and one engine call may take three, so the pass stops early enough for the cycle to end in time.
 */
export const PASS_BUDGET_MS = 6 * 60 * 1000
/** A post older than this when it is read can no longer be a `reply`: a thread that old is not worth joining (the look-back never goes further either). */
export const OLD_POST_PREFIX = 'Older than a month: '
/**
 * How often a batch of titles whose answer cannot be used is cut in halves and each half tried once more, in the same pass: 40 titles, then 20, 10 and
 * 5. One bad title then costs the posts of one piece of about five an attempt, not all 40 (owner-delegated decision of DEC-040). A cut goes on only while
 * it makes progress: see `cut`.
 */
export const MAX_SPLIT_DEPTH = 3
/** The gap between two reads of a thread in one pass, as the connectors keep it. */
export const TRIAGE_PACING_MS = INBOX_PACING_MS
/** Posts of the last check are read again by this much, so one written while it ran is not missed. */
export const OVERLAP_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export { POST_GONE }
/** A finding labelled by a real judgment within this long shows that the engine works (`proven`). */
export const PROOF_WINDOW_MS = 24 * 60 * 60 * 1000

export interface TriageOutcome {
  /** Posts that left the "not judged" state in this pass (by their title, or by being read), each counted once. */
  judged: number
  /** Posts labelled `reply` in this pass (an opportunity opened, or the one the post had already). */
  replies: number
  noticed: number
  /** Opportunities this pass opened. */
  newOpportunities: number
  /** One piece of the cycle's summary, e.g. "triage: 7 judged, 1 reply, 2 noticed"; empty when there is nothing to say. */
  note: string
}

const NOTHING: TriageOutcome = { judged: 0, replies: 0, noticed: 0, newOpportunities: 0, note: '' }

class Tally {
  constructor(readonly startedAt: number) {}
  readonly touched = new Set<Id>()
  /** Threads fetched in this pass (a thread, or the answer that the post is gone): proof that the connector works, so a thread that failed is the post's fault. */
  reads = 0
  /** Posts whose thread could not be fetched: counted at the end if `reads > 0`. */
  readonly unreadable: Finding[] = []
  /** The pass stopped starting calls because its time was up (`PASS_BUDGET_MS`). */
  budgetHit = false
  /** When the listing came back full (cut at `LIST_MAX`): the time of the oldest post it holds, or '' when no post says; null when the listing was whole. */
  cutAt: string | null = null
  /** The engine gave a usable answer in this pass (about titles or about a post): proof that it works, so a post it could not answer for is the one at fault. */
  answered = false
  /** Whether a finding was labelled by a real judgment within `PROOF_WINDOW_MS` (read lazily, once per pass). */
  history: boolean | null = null
  /** Posts the engine answered for unusably, down to the last cut (one title and the pieces of five around it, or one read post): counted at the end if the engine is `proven`. */
  readonly unusable: Finding[] = []
  /** Both halves of a batch failed and nothing else was judged in the pass: the engine, not the titles, is at fault. The pass ended without blaming a post. */
  systemic = false
  replies = 0
  noticed = 0
  newOpportunities = 0
  /** The listing of posts failed, so this pass saw no new post. */
  listFailed = false
}

/** The reason of a post that was labelled `reply` and then could not be queued: it is only worth noticing, and says why. */
export function blockedRelation(reason: string, relation: string): string {
  return oneLine(`Not queued (${reason}). ${relation}`, 200)
}

export class TriageFlow {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly findings: FindingStore,
    private readonly ingestor: Ingestor
  ) {}

  /**
   * One triage pass for a channel the monitor has just read successfully. Only for a channel the app reads whose connector can list posts. Never throws:
   * the owner taking the browser, a failed listing, an engine that is not ready, a bug, all end the pass quietly (the log says what happened).
   */
  async run(channel: Channel, account: Account, connector: Connector, ctx: ConnectorContext): Promise<TriageOutcome> {
    if (!channel.reads || typeof connector.listPosts !== 'function') return NOTHING
    try {
      return await this.pass(channel, account, connector, ctx)
    } catch (error) {
      this.core.log.error('triage', `Triage stopped unexpectedly: ${oneLine(errorMessage(error), 300)}`, channel.id)
      return { ...NOTHING, note: 'triage stopped unexpectedly' }
    }
  }

  private async pass(channel: Channel, account: Account, connector: Connector, ctx: ConnectorContext): Promise<TriageOutcome> {
    const tally = new Tally(this.core.clock.now().getTime())
    try {
      await this.discover(channel, account, connector, ctx, tally)

      if (this.findings.unlabelled(channel.id) > 0) {
        const engine = await this.engine(channel)
        if (engine) {
          const context = this.context(channel, account)
          if (await this.judgeTitles(channel, engine, context, tally)) await this.readPosts(channel, account, connector, ctx, engine, context, tally)
        }
      }
    } catch (error) {
      // The owner took the browser: what was judged so far stands, the rest is made at the next check, and nothing is wrong.
      if (!(error instanceof TakeoverError)) throw error
    }

    this.countUnusable(channel, tally)
    this.countUnreadable(channel, tally)

    // Only what the owner never asked to see is forgotten: a post judged not relevant, long past the look-back.
    this.findings.pruneSkipped()
    if (tally.touched.size > 0 || tally.replies > 0 || tally.noticed > 0) this.findings.notify()
    return this.outcome(channel, tally)
  }

  // ───────────── which posts ─────────────

  /**
   * Lists the posts of the look-back (the first pass) or of the time since the cursor and stores the new ones as `pending`. The cursor
   * (`listed_through`) moves only after a listing that was read whole, to the moment it STARTED: a listing that fails or is taken over changes nothing, so
   * the next pass lists the same window again, and a post written while a listing ran is listed again by the next one (the hour of overlap).
   * `looked_back_at` is only the mark that the first look was made.
   */
  private async discover(channel: Channel, account: Account, connector: Connector, ctx: ConnectorContext, tally: Tally): Promise<void> {
    const now = this.core.clock.now().getTime()
    const startedAt = new Date(now).toISOString()
    const cursor = this.findings.listedThrough(channel.id)
    const firstLook = cursor === null
    const markLookedBack = (): void => {
      if (channel.lookedBackAt === null) this.store.updateChannel(channel.id, { lookedBackAt: startedAt })
    }
    let since: number
    if (cursor === null) {
      const days = Math.min(channel.settings.lookBackDays, MAX_LOOK_BACK_DAYS)
      if (!(days > 0)) {
        // No look-back wanted: the channel starts from now, and the next checks list what is new.
        this.core.db.transaction(() => {
          this.findings.setListedThrough(channel.id, startedAt)
          markLookedBack()
        })()
        return
      }
      since = now - days * DAY_MS
    } else {
      const last = Date.parse(cursor)
      // Never further back than the look-back can go, so a post whose finding was forgotten (60 days) cannot be found and judged again.
      since = Math.max((Number.isFinite(last) ? last : now - DAY_MS) - OVERLAP_MS, now - MAX_LOOK_BACK_DAYS * DAY_MS)
    }

    let posts: RemoteDiscussion[]
    try {
      posts = await (connector.listPosts as NonNullable<Connector['listPosts']>)(ctx, { since: new Date(since).toISOString(), max: LIST_MAX })
    } catch (error) {
      if (error instanceof TakeoverError) throw error
      this.core.log.warn('triage', `The posts could not be listed: ${oneLine(errorMessage(error), 200)}`, channel.id)
      tally.listFailed = true
      return
    }

    const isOwn = this.ingestor.ownPostTest(channel, account)
    const listed = posts.slice(0, LIST_MAX)
    this.core.db.transaction(() => {
      for (const post of listed) {
        if (!post.externalId || !post.url || isOwn(post)) continue
        // The connector filters by time; a post it let through that is older than what was asked for is not judged.
        const written = post.postedAt === null ? Number.NaN : Date.parse(post.postedAt)
        if (Number.isFinite(written) && written < since) continue
        this.findings.addPending(channel.productId, channel.id, post, firstLook)
      }
      this.findings.setListedThrough(channel.id, startedAt)
      markLookedBack()
    })()

    // A listing that came back full holds the NEWEST posts of the window and not the older ones: say how far back it really looked.
    if (listed.length >= LIST_MAX) {
      const times = listed.map((post) => (post.postedAt === null ? Number.NaN : Date.parse(post.postedAt))).filter((time) => Number.isFinite(time))
      tally.cutAt = times.length > 0 ? new Date(Math.min(...times)).toISOString().slice(0, 10) : ''
      this.core.log.warn('triage', `The list of posts was cut at ${LIST_MAX}: the posts older than ${tally.cutAt || 'the oldest listed'} were not listed.`, channel.id)
    }
  }

  // ───────────── the engine and what it is told ─────────────

  /**
   * A ready engine that cannot use tools on this computer, or null (the posts then wait). The page text of strangers is never shown to an engine that
   * could act on this computer: a hostile post could tell it to (the same rule as for an unknown website).
   */
  private async engine(channel: Channel): Promise<AiEngine | null> {
    let engine: AiEngine
    try {
      engine = await readyEngine(this.core)
    } catch (error) {
      this.core.log.info('triage', `The AI engine is not ready, so the posts wait: ${oneLine(errorMessage(error), 200)}`, channel.id)
      return null
    }
    if (!engine.toolFree) {
      this.core.log.warn('triage', `${engine.label} can use tools on this computer, so it is not shown the posts of strangers. Choose a tool-free engine in Settings.`, channel.id)
      return null
    }
    return engine
  }

  /**
   * What the prompts are told. The product's goals reach monitoring here for the first time (DEC-040): until now they only planned a channel and
   * guided the posts the owner asked for. The voice of the login is the one the drafts use (context.ts).
   */
  private context(channel: Channel, account: Account): TriageContext {
    const product = this.core.repos.product(channel.productId)
    const settings = channel.settings
    return {
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      goals: product.goals.map((g) => ({ targetAction: g.targetAction, successMetrics: g.successMetrics, notes: g.notes })),
      channel: { platform: channel.platform, target: channel.target, topics: settings.topics, queries: settings.queries, style: settings.style, languages: settings.languages },
      role: roleView(account)
    }
  }

  // ───────────── step 1: the titles ─────────────

  /**
   * Judges the posts that have no verdict yet, 40 titles to a call, the newest posts first. A batch whose answer cannot be used (after the one repair)
   * is cut (`cut`); any other failure of the engine ends the step, and so does a fault found to be the engine's. Returns false when the step ended early,
   * so no further batch is asked and the next step is not tried.
   */
  private async judgeTitles(channel: Channel, engine: AiEngine, context: TriageContext, tally: Tally): Promise<boolean> {
    const pending = this.findings.pending(channel.id, MAX_TITLES_PER_PASS)
    for (let start = 0; start < pending.length; start += MAX_TITLES_PER_CALL) {
      // A later batch is asked only when THIS pass has judged something already. The last 24 hours may let a failing batch be counted (`proven`), but
      // must not keep a dead engine busy: it costs one batch of calls a pass, and at most 40 posts are charged.
      if (start > 0 && !tally.answered) {
        tally.systemic = true
        return false
      }
      const batch = pending.slice(start, start + MAX_TITLES_PER_CALL)
      const asked = await this.askPiece(channel, engine, context, batch, tally)
      if (asked === 'failed') return false
      if (asked === 'unusable' && !(await this.cut(channel, engine, context, batch, 0, tally))) return false
    }
    return true
  }

  /** One call (with its one repair) for a piece of titles: 'judged' (the verdicts are stored), 'unusable' (the engine answered, not usably) or 'failed' (the engine itself). */
  private async askPiece(channel: Channel, engine: AiEngine, context: TriageContext, piece: Finding[], tally: Tally): Promise<'judged' | 'unusable' | 'failed'> {
    if (this.overBudget(tally)) return 'failed'
    let verdicts
    try {
      verdicts = await askWithRepair(engine, buildTitlesTask(context, piece.map((f) => f.title)), (raw) => readTitleAnswer(raw, piece.length), {})
    } catch (error) {
      return this.unusableAnswer(channel, error, `${piece.length} title(s)`) ? 'unusable' : 'failed'
    }
    tally.answered = true
    piece.forEach((finding, index) => {
      if (this.findings.judgeTitle(finding.id, verdicts[index])) tally.touched.add(finding.id)
    })
    return 'judged'
  }

  /**
   * `piece` was asked about and its answer was unusable. Its two halves are asked about, once each, down to `MAX_SPLIT_DEPTH` cuts:
   *  - a half that is judged is final;
   *  - when NEITHER half is judged and the engine is not `proven` (nothing judged in this pass, nothing labelled by a real judgment in the last 24 hours),
   *    nothing shows that the titles are at fault: the engine is. Nothing is counted against anyone, every member stays pending, the cutting stops and so
   *    does the pass (false): asking batch after batch of an engine that cannot answer would only cost calls;
   *  - once the engine is proven, a half that failed (even when its sibling failed too) holds a bad title: it is cut again until the title is isolated,
   *    and later batches are still asked (owner-delegated refinement of DEC-040: a bad pair must not stall the channel, in a busy pass or a quiet one);
   *  - a piece that cannot be cut any more (the depth limit, or one title) is kept in `tally.unusable`, to be counted at the end of the pass.
   * Returns false when the pass must end.
   */
  private async cut(channel: Channel, engine: AiEngine, context: TriageContext, piece: Finding[], depth: number, tally: Tally): Promise<boolean> {
    if (depth >= MAX_SPLIT_DEPTH || piece.length <= 1) {
      tally.unusable.push(...piece)
      return true
    }
    const middle = Math.ceil(piece.length / 2)
    const halves = [piece.slice(0, middle), piece.slice(middle)]
    const asked: ('judged' | 'unusable')[] = []
    for (const half of halves) {
      const result = await this.askPiece(channel, engine, context, half, tally)
      if (result === 'failed') return false
      asked.push(result)
    }
    if (!this.proven(tally)) {
      tally.systemic = true
      this.core.log.warn('triage', `Neither half of ${piece.length} title(s) could be judged, and nothing shows that the AI works: the fault is the AI's, not the titles'. Nothing is counted; the posts wait for the next pass.`, channel.id)
      return false
    }
    for (const [index, half] of halves.entries()) {
      if (asked[index] === 'unusable' && !(await this.cut(channel, engine, context, half, depth + 1, tally))) return false
    }
    return true
  }

  // ───────────── step 2: the posts that matter, read ─────────────

  /**
   * Opens at most `MAX_READS_PER_PASS` threads of the posts judged relevant by their title, those that failed the least first and the newest first among
   * them, and labels each. A thread that cannot be fetched does not use up a read: the next post is tried, up to `MAX_READ_TRIES_PER_PASS` tries, so
   * unreadable posts at the head cannot starve an older good one. The failure is charged to the post at the end of the pass, if some thread was read in it.
   */
  private async readPosts(
    channel: Channel,
    account: Account,
    connector: Connector,
    ctx: ConnectorContext,
    engine: AiEngine,
    context: TriageContext,
    tally: Tally
  ): Promise<void> {
    const candidates = this.findings.waiting(channel.id, MAX_READ_TRIES_PER_PASS)
    let tried = 0
    for (const finding of candidates) {
      if (tally.reads >= MAX_READS_PER_PASS) return
      if (this.overBudget(tally)) return
      if (tried > 0) await this.core.sleep(TRIAGE_PACING_MS)
      tried++

      let thread: RemoteDiscussion | null
      try {
        thread = await connector.fetchThread(ctx, finding.externalId)
      } catch (error) {
        if (error instanceof TakeoverError) throw error
        // This post is tried again at the next pass (behind the others once it is charged); the others go on.
        this.core.log.warn('triage', `A post could not be read: ${oneLine(errorMessage(error), 200)}`, channel.id)
        tally.unreadable.push(finding)
        continue
      }
      tally.reads++
      if (thread === null) {
        if (this.findings.settleRead(finding.id, { label: 'skip', relation: POST_GONE, opportunityId: null })) tally.touched.add(finding.id)
        continue
      }

      if (this.overBudget(tally)) return
      let verdict
      try {
        const task = buildReadTask(context, { title: thread.title, author: thread.author, body: thread.body, comments: thread.comments })
        verdict = await askWithRepair(engine, task, readReadAnswer, {})
      } catch (error) {
        if (!this.unusableAnswer(channel, error, 'a post')) return
        tally.unusable.push(finding)
        continue
      }
      tally.answered = true
      this.settle(channel, account, finding, thread, verdict, tally)
    }
  }

  /** Writes the verdict on a read post. A `reply` opens the ordinary opportunity; when it cannot be opened the post is only worth noticing, and says why. */
  private settle(channel: Channel, account: Account, finding: Finding, thread: RemoteDiscussion, answer: { label: 'reply' | 'notice' | 'skip'; relation: string }, tally: Tally): void {
    // A post that has aged past the look-back while it waited can no longer become a reply: it is only worth noticing, and says so.
    const written = Date.parse(thread.postedAt ?? finding.postedAt ?? '')
    const tooOld = Number.isFinite(written) && written < this.core.clock.now().getTime() - MAX_LOOK_BACK_DAYS * DAY_MS
    const verdict = answer.label === 'reply' && tooOld ? { label: 'notice' as const, relation: oneLine(`${OLD_POST_PREFIX}${answer.relation}`, 200) } : answer
    try {
      this.core.db.transaction(() => {
        if (verdict.label !== 'reply') {
          if (this.findings.settleRead(finding.id, { label: verdict.label, relation: verdict.relation, opportunityId: null })) {
            tally.touched.add(finding.id)
            if (verdict.label === 'notice') tally.noticed++
          }
          return
        }
        const result = this.ingestor.ingestTriagedPost(channel, account, thread, verdict.relation)
        if (result.opportunity) {
          if (!this.findings.settleRead(finding.id, { label: 'reply', relation: verdict.relation, opportunityId: result.opportunity.id })) return
          tally.touched.add(finding.id)
          tally.replies++
          if (result.opened) tally.newOpportunities++
          return
        }
        if (this.findings.settleRead(finding.id, { label: 'notice', relation: blockedRelation(result.blocked ?? 'it could not be queued', verdict.relation), opportunityId: null })) {
          tally.touched.add(finding.id)
          tally.noticed++
        }
      })()
    } catch (error) {
      // Nothing of this post was kept (the transaction is rolled back): it is read again at the next pass.
      this.core.log.error('triage', `The verdict on a post could not be stored: ${oneLine(errorMessage(error), 200)}`, channel.id)
    }
  }

  // ───────────── outcomes ─────────────

  /**
   * An engine failure is told apart from an answer that could not be used. Returns true for the latter (the caller cuts the batch, or keeps the post
   * for `countUnusable`) and false for a failure of the engine itself (the pass stops: asking again at once would fail the same way, and nothing is counted).
   */
  private unusableAnswer(channel: Channel, error: unknown, what: string): boolean {
    if (error instanceof AiError && error.kind === 'invalid_output') {
      this.core.log.warn('triage', `The AI's answer for ${what} could not be used, even after asking again.`, channel.id)
      return true
    }
    const why = error instanceof AiError ? `${error.kind}: ${oneLine(error.message, 200)}` : oneLine(errorMessage(error), 200)
    this.core.log.warn('triage', `The AI could not judge ${what}: ${why}`, channel.id)
    return false
  }

  /**
   * The posts the engine answered for unusably, down to the last cut, are counted at the end of the pass, and only when the engine is `proven` (it judged
   * some other post in this pass, title or read, or something was judged lately): otherwise nothing tells a post that cannot be judged from an engine
   * that cannot judge, and no post is blamed. One
   * that has been counted `MAX_ATTEMPTS` times is settled as a notice (findings.ts), so it is shown to the owner and no longer asked about.
   */
  private countUnusable(channel: Channel, tally: Tally): void {
    if (tally.unusable.length === 0) return
    if (!this.proven(tally)) {
      this.core.log.info('triage', `${tally.unusable.length} post(s) could not be judged, but nothing shows that the AI works: not counted against them.`, channel.id)
      return
    }
    const settled = this.findings.recordUnusable(tally.unusable.map((f) => f.id))
    for (const id of settled) tally.touched.add(id)
    tally.noticed += settled.length
    if (settled.length > 0) this.core.log.warn('triage', `${settled.length} post(s) could not be judged by the AI after ${MAX_ATTEMPTS} tries and are shown as notices.`, channel.id)
  }

  /**
   * The posts whose thread could not be fetched are counted at the end of the pass, and only when some other thread was fetched in it: when none could be,
   * the connector or the page is down and the posts are not at fault, so nobody is charged (and the next pass tries them again). One that has been
   * counted `MAX_ATTEMPTS` times is settled as a notice (findings.ts), so it is shown to the owner and no longer asked about.
   */
  private countUnreadable(channel: Channel, tally: Tally): void {
    if (tally.unreadable.length === 0) return
    if (tally.reads === 0) {
      this.core.log.info('triage', `${tally.unreadable.length} post(s) could not be read and no other post could: the connector is taken to be down, nobody is counted.`, channel.id)
      return
    }
    const settled = this.findings.recordUnreadable(tally.unreadable.map((f) => f.id))
    for (const id of settled) tally.touched.add(id)
    tally.noticed += settled.length
    if (settled.length > 0) this.core.log.warn('triage', `${settled.length} post(s) could not be read after ${MAX_ATTEMPTS} tries and are shown as notices.`, channel.id)
  }

  /** Whether the time of this pass is up: no new call is started then (and the pass says so). */
  private overBudget(tally: Tally): boolean {
    if (this.core.clock.now().getTime() - tally.startedAt < PASS_BUDGET_MS) return false
    tally.budgetHit = true
    return true
  }

  /**
   * Whether the engine is known to work: it judged a post in this pass, or any finding of any channel was labelled by a real judgment within the last 24
   * hours of the clock (`FindingStore.recentJudgment`: the engine is global, and a quiet channel has no other post to show it with). Read once per pass.
   */
  private proven(tally: Tally): boolean {
    if (tally.answered) return true
    tally.history ??= this.findings.recentJudgment(new Date(this.core.clock.now().getTime() - PROOF_WINDOW_MS).toISOString())
    return tally.history
  }

  private outcome(channel: Channel, tally: Tally): TriageOutcome {
    const waiting = this.findings.unlabelled(channel.id)
    const parts: string[] = []
    if (tally.touched.size > 0) parts.push(`${tally.touched.size} judged`)
    if (tally.replies > 0) parts.push(`${tally.replies} ${tally.replies === 1 ? 'reply' : 'replies'}`)
    if (tally.noticed > 0) parts.push(`${tally.noticed} noticed`)
    if (waiting > 0) parts.push(`${waiting} waiting${tally.budgetHit ? ' (time budget)' : ''}`)
    else if (tally.budgetHit) parts.push('time budget')
    if (tally.cutAt !== null) parts.push(tally.cutAt === '' ? `looked back only partway (the list was cut at ${LIST_MAX} posts)` : `looked back only to ${tally.cutAt}`)
    if (tally.systemic) parts.push("the AI's answers could not be used; will retry")
    if (tally.listFailed) parts.push('posts not listed')
    return {
      judged: tally.touched.size,
      replies: tally.replies,
      noticed: tally.noticed,
      newOpportunities: tally.newOpportunities,
      note: parts.length > 0 ? `triage: ${parts.join(', ')}` : ''
    }
  }
}
