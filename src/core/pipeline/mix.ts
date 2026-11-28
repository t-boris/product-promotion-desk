// The content mix (DEC-033). Besides answering comments, a channel may have the AI prepare drafts of the persona's own posts from time to time:
// a post about the product, a showcase of one thing it does, an update about what the owner did (written ONLY from the owner's note).
//
// The rule that governs all of it: this prepares DRAFTS and nothing else. A draft is an ordinary standalone post in the state `draft`; nothing
// here approves it, schedules it or sends it, and nothing here can: the file does not touch the review flow, the gate or the sending flow,
// and the job that calls it runs only while automation is on and the gate (the reconciliation after launch) is open. What it adds is
// the rhythm: what is due, how many drafts may wait for the owner at once, and when a failed try is made again.

import { ApiError } from '../../shared/api'
import type { Channel, Id, IsoTime, MixCard, MixKind, MixKindCard, MixSetting, ProductUpdate } from '../../shared/types'
import { newId } from '../db/database'
import type { Core } from '../core'
import type { MixService } from '../services'
import { loadKnowledge } from './context'
import { DEFAULT_EVERY_DAYS, MIX_KINDS, rhythmInForce, stepApplies } from '../../shared/mix-plan'
import { RECUT_EVERY_DAYS } from '../../shared/product-choices'
import { RECUT_FOCUS, SHOWCASE_FOCUS } from './draft-prompt'
import { lowTimeOn } from './product-choices'
import type { PublicationsFlow } from './publications'
import { schedulableChannels } from './scheduler-eligibility'
import type { FlowStore } from './store'
import { errorMessage } from './util'
import { changeInForce, ownRhythm } from './weekly-review'

/** The mix prepares no draft for a channel while this many of its posts wait for the owner. */
export const MIX_WAITING_CAP = 3
/** A failed try is not repeated before this long (the AI's quota is the owner's). */
export const MIX_RETRY_GAP_MS = 3 * 3_600_000
/** The pause before a failed kind is tried again doubles with each failure in a row, up to a day: a broken engine is not asked 8 times a day. */
export const MIX_RETRY_MAX_MS = 24 * 3_600_000
export const retryGapMs = (failures: number): number => Math.min(MIX_RETRY_GAP_MS * 2 ** Math.max(0, failures - 1), MIX_RETRY_MAX_MS)
const DAY_MS = 86_400_000
/** How far the due time of a kind moves around its rhythm, so drafts do not appear at the same minute every week. */
const JITTER = 0.1
const MAX_NOTE_CHARS = 500
/** A note the AI failed to make a post from this many times is set aside: one note never holds the others back. */
export const MAX_NOTE_TRIES = 3

export { DEFAULT_EVERY_DAYS, MIX_KINDS }
/** Posts that wait for the owner to decide. */
const WAITING_STATES = ['draft', 'awaiting_approval']
/** A post about the product stands on approved facts; an own update stands on a note. */
const NEEDS_FACTS: MixKind[] = ['product_post', 'showcase']
const ORIGIN = 'From your content mix'

const unit = (text: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash / 0x1_0000_0000
}

/**
 * When the next draft of a kind is due: its rhythm after the last one, moved by a steady jitter of the channel, the kind and the last time
 * (the same inputs give the same time, so it can be shown and tested). 0 when none was prepared yet: a kind the owner just switched on starts at once.
 */
export function dueAtMs(channelId: Id, kind: MixKind | 'recut', everyDays: number, lastDraftAt: IsoTime | null, now: number): number {
  if (!lastDraftAt) return 0
  const jitter = (unit(`${channelId}:${kind}:${lastDraftAt}`) * 2 - 1) * JITTER
  // A last draft that lies in the future (the clock was set back) counts as now, or the kind would wait for months.
  return Math.min(Date.parse(lastDraftAt), now) + everyDays * DAY_MS * (1 + jitter)
}

/** The time before which a kind that failed is not tried again, or 0. */
export function retryAtMs(lastAttemptAt: IsoTime | null, failures: number, now: number): number {
  return lastAttemptAt && failures > 0 ? Math.min(Date.parse(lastAttemptAt), now) + retryGapMs(failures) : 0
}

/** Why the mix cannot work on this channel at all, or null. An observe-only channel stays as the owner set it. */
export function mixBlocker(channel: Channel): string | null {
  // Observing is about replies: a channel the app does not read has none, so the mode says nothing about its posts (DEC-034).
  if (channel.mode === 'observe' && channel.reads) return 'This channel only watches. Let it prepare drafts (change its mode) before the AI prepares posts here.'
  if (channel.status === 'paused') return 'The channel is paused.'
  if (channel.status === 'setup') return 'The channel is not set up yet.'
  const publish = channel.capabilities.find((c) => c.key === 'publish_post')
  if (publish && (publish.status === 'unavailable' || publish.status === 'restricted')) return `Posting is ${publish.status} on this channel.`
  return null
}

/** The mix a plan proposes: its steps that are a kind of post, the first of each kind, with the rhythm the step names. Nothing in it is on yet but as proposed. */
export function proposalFromPlan(plan: Channel['plan']): MixSetting[] {
  const out: MixSetting[] = []
  for (const step of plan?.steps ?? []) {
    const kind = step.kind
    if (!kind || kind === 'replies' || out.some((entry) => entry.kind === kind)) continue
    out.push({ kind, enabled: true, everyDays: step.everyDays ?? DEFAULT_EVERY_DAYS[kind] })
  }
  return out
}

/** Posts of the channel that wait for the owner, whoever made them. Replies are not counted: they have their own queue. */
export function waitingCount(core: Core, channelId: Id): number {
  const marks = WAITING_STATES.map(() => '?').join(', ')
  const row = core.db.prepare(`SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ? AND kind = 'standalone' AND state IN (${marks})`).get(channelId, ...WAITING_STATES) as { n: number }
  return row.n
}

/**
 * A note whose post was rejected or deleted before anything was sent is free again: the news was not told, so it can be written again, or the owner
 * can remove the note. A post that went out (or may have: its result is unknown) keeps its note.
 */
export function releaseNotes(core: Core): void {
  core.db
    .prepare(
      `UPDATE product_updates SET used_in_opportunity_id = NULL
       WHERE used_in_opportunity_id IN (
         SELECT o.id FROM opportunities o WHERE o.state = 'cancelled'
           AND NOT EXISTS (SELECT 1 FROM send_actions a WHERE a.opportunity_id = o.id AND a.state IN ('sending', 'confirmed', 'unknown'))
       )`
    )
    .run()
}

/** The notes of a product a post can still be written from: not used, not set aside. Oldest first: what the owner did first is told first. */
export function usableNotes(core: Core, productId: Id): ProductUpdate[] {
  releaseNotes(core)
  const rows = core.db.prepare('SELECT * FROM product_updates WHERE product_id = ? AND used_in_opportunity_id IS NULL AND failed_tries < ? ORDER BY created_at, rowid').all(productId, MAX_NOTE_TRIES) as Row[]
  return rows.map(readNote)
}

interface State {
  lastDraftAt: IsoTime | null
  lastAttemptAt: IsoTime | null
  lastError: string | null
  failures: number
}

/** Why a try failed: only a post the checks refused is the note's fault; an engine that is down, or slow, or stopped is not. */
const NOTE_FAULT = ['blocked', 'ai_invalid']

export class MixFlow implements MixService {
  /** One scan at a time: a scan takes as long as the AI takes. */
  private running = false

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly publications: Pick<PublicationsFlow, 'suggest' | 'suggestUpdate'>
  ) {}

  // ───────────── what the owner sees ─────────────

  card(channelId: Id): MixCard {
    const channel = this.store.requireChannel(channelId)
    const now = this.core.clock.now().getTime()
    const waiting = waitingCount(this.core, channelId)
    const unused = usableNotes(this.core, channel.productId).length
    const setAside = (this.core.db.prepare('SELECT COUNT(*) AS n FROM product_updates WHERE product_id = ? AND used_in_opportunity_id IS NULL AND failed_tries >= ?').get(channel.productId, MAX_NOTE_TRIES) as { n: number }).n
    const facts = loadKnowledge(this.core, channel.productId).approved.length
    const change = changeInForce(this.core, channel.productId)
    const kinds = MIX_KINDS.map((kind): MixKindCard => {
      // `enabled` and `everyDays` are the owner's own: the form shows and saves them. What the accepted change of the weekly review makes of
      // the kind for now is beside them, and it is what the next draft is counted from.
      const { enabled, everyDays } = ownRhythm(channel, kind)
      const step = change?.plan.find((s) => s.channelId === channelId && s.kind === kind)
      const review = change && step && stepApplies({ enabled, everyDays }, step) ? { ...step.to, until: change.until } : null
      const inForce = review ?? { enabled, everyDays }
      const state = this.state(channelId, kind)
      let nextAt: IsoTime | null = null
      let problem: string | null = null
      if (inForce.enabled) {
        nextAt = new Date(Math.max(now, dueAtMs(channelId, kind, inForce.everyDays, state.lastDraftAt, now), retryAtMs(state.lastAttemptAt, state.failures, now))).toISOString()
        if (kind === 'own_update' && unused === 0) problem = setAside > 0 ? `The AI could not make a post from ${setAside === 1 ? 'a note' : `${setAside} notes`}. Rewrite ${setAside === 1 ? 'it' : 'them'}, or remove ${setAside === 1 ? 'it' : 'them'}, and tell what is new.` : 'Waiting for a note: tell what is new.'
        else if (NEEDS_FACTS.includes(kind) && facts === 0) problem = 'There are no approved facts about the product yet.'
        else if (waiting >= MIX_WAITING_CAP) problem = `${waiting} posts of this channel are waiting for you.`
        else if (state.lastError) problem = `The last try failed: ${state.lastError}`
      }
      return { kind, enabled, everyDays, review, lastDraftAt: state.lastDraftAt, nextAt, problem }
    })
    return { channelId, kinds, waiting, cap: MIX_WAITING_CAP, unusedUpdates: unused, blocked: mixBlocker(channel) }
  }

  /** The AI's proposal for the mix, from the steps of the plan of the channel; a plan without a rhythm is made again first. Nothing is saved or switched on. */
  async propose(channelId: Id): Promise<MixSetting[]> {
    let channel = this.store.requireChannel(channelId)
    if (proposalFromPlan(channel.plan).length === 0) {
      const prepare = this.core.services.channels?.preparePlan
      if (!prepare) throw new ApiError('unavailable', 'The AI cannot plan this channel now.')
      channel = await prepare(channelId)
    }
    const proposal = proposalFromPlan(channel.plan)
    if (proposal.length === 0) throw new ApiError('no_proposal', 'The AI planned no post of a kind the mix can prepare. Choose the mix yourself, or plan again.')
    return proposal
  }

  // ───────────── the owner's notes ("What's new") ─────────────

  addNote(productId: Id, text: string): ProductUpdate {
    try {
      this.core.repos.product(productId)
    } catch {
      throw new ApiError('not_found', 'This product does not exist.')
    }
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
    if (!clean) throw new ApiError('invalid_input', 'Write what you did, in a line or two.')
    if (clean.length > MAX_NOTE_CHARS) throw new ApiError('invalid_input', `A note is a line or two: at most ${MAX_NOTE_CHARS} characters.`)
    const id = newId()
    const createdAt = this.core.clock.now().toISOString()
    this.core.db.prepare('INSERT INTO product_updates (id, product_id, text, created_at, used_in_opportunity_id) VALUES (?, ?, ?, ?, NULL)').run(id, productId, clean, createdAt)
    this.core.events.changed('channels')
    return { id, productId, text: clean, createdAt, usedInOpportunityId: null, failedTries: 0 }
  }

  listNotes(productId: Id): ProductUpdate[] {
    releaseNotes(this.core)
    const rows = this.core.db.prepare('SELECT * FROM product_updates WHERE product_id = ? ORDER BY created_at DESC, rowid DESC').all(productId) as Row[]
    return rows.map(readNote)
  }

  removeNote(id: Id): void {
    releaseNotes(this.core)
    const row = this.core.db.prepare('SELECT used_in_opportunity_id FROM product_updates WHERE id = ?').get(id) as { used_in_opportunity_id: string | null } | undefined
    if (!row) throw new ApiError('not_found', 'This note does not exist.')
    if (row.used_in_opportunity_id) throw new ApiError('invalid_state', 'A post was written from this note: it stays as the record of it.')
    this.core.db.prepare('DELETE FROM product_updates WHERE id = ? AND used_in_opportunity_id IS NULL').run(id)
    this.core.events.changed('channels')
  }

  // ───────────── the job ─────────────

  /**
   * Prepares what is due: at most one draft per channel per scan, for the first kind that is due, on a channel the scheduler may work on, that
   * is not observe-only, has fewer than MIX_WAITING_CAP posts waiting, and has an AI engine chosen. Never approves, schedules or sends.
   */
  async runDue(stop: () => boolean = () => false): Promise<number> {
    if (this.running || !this.core.engines.selected()) return 0
    this.running = true
    let prepared = 0
    let asked = false
    // A note is tried once per scan, whoever it is tried for: several channels of one product must not use up its three tries together.
    const tried = new Set<Id>()
    try {
      for (const channel of schedulableChannels(this.core)) {
        if (stop()) break
        if (mixBlocker(channel) !== null || waitingCount(this.core, channel.id) >= MIX_WAITING_CAP) continue
        // The kind that has waited longest goes first, so a kind with a short rhythm does not starve the others when only one slot is free.
        const now0 = this.core.clock.now().getTime()
        const wanted = this.inForce(channel)
          .filter((entry) => entry.enabled)
          .map((entry) => ({ entry, due: dueAtMs(channel.id, entry.kind, entry.everyDays, this.state(channel.id, entry.kind).lastDraftAt, now0) }))
          .sort((a, b) => a.due - b.due)
        let engineDown = false
        // A week with no time (DEC-071): the usual mix rests for the product; a channel that has sent a post gets one re-cut of an earlier post a week.
        if (lowTimeOn(this.core, channel.productId)) {
          const state = this.state(channel.id, 'recut')
          const due = dueAtMs(channel.id, 'recut', RECUT_EVERY_DAYS, state.lastDraftAt, now0)
          const sent = (this.core.db.prepare("SELECT COUNT(*) AS n FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.channel_id = ? AND o.kind = 'standalone' AND a.state = 'confirmed'").get(channel.id) as { n: number }).n
          if (sent === 0 || now0 < due || now0 < retryAtMs(state.lastAttemptAt, state.failures, now0)) continue
          try {
            await this.publications.suggest(channel.id, { origin: `${ORIGIN} (a week with no time)`, focus: RECUT_FOCUS })
            this.record(channel.id, 'recut', { drafted: true })
            this.core.log.info('pipeline', `A week with no time: a re-cut of an earlier post is prepared for ${channel.target}. It waits for you.`, channel.id)
            prepared += 1
          } catch (error) {
            this.record(channel.id, 'recut', { drafted: false, error: errorMessage(error) })
            this.core.log.warn('pipeline', `A week with no time: the re-cut for ${channel.target} could not be prepared: ${errorMessage(error)}`, channel.id)
            if (error instanceof ApiError && error.code === 'ai_unavailable') break
          }
          continue
        }
        for (const { entry, due } of wanted) {
          const now = this.core.clock.now().getTime()
          const state = this.state(channel.id, entry.kind)
          if (now < due) continue
          if (now < retryAtMs(state.lastAttemptAt, state.failures, now)) continue
          // Waiting for a note, or for approved facts, is not a failure: nothing is tried and nothing is recorded.
          const notes = entry.kind === 'own_update' ? usableNotes(this.core, channel.productId).filter((n) => !tried.has(n.id)) : []
          if (entry.kind === 'own_update' && notes.length === 0) {
            if (usableNotes(this.core, channel.productId).length === 0) asked = true // the attention list asks the owner for a note (mix-attention.ts)
            continue
          }
          if (NEEDS_FACTS.includes(entry.kind) && loadKnowledge(this.core, channel.productId).approved.length === 0) continue
          const note = notes[0]
          if (note) tried.add(note.id)
          try {
            await this.prepare(channel, entry.kind, note)
            this.record(channel.id, entry.kind, { drafted: true })
            this.core.log.info('pipeline', `The content mix prepared a draft (${entry.kind.replace('_', ' ')}) for ${channel.target}. It waits for you.`, channel.id)
            prepared += 1
          } catch (error) {
            const code = error instanceof ApiError ? error.code : ''
            if (note && NOTE_FAULT.includes(code)) this.core.db.prepare('UPDATE product_updates SET failed_tries = failed_tries + 1 WHERE id = ? AND used_in_opportunity_id IS NULL').run(note.id)
            this.record(channel.id, entry.kind, { drafted: false, error: errorMessage(error) })
            this.core.log.warn('pipeline', `The content mix could not prepare a draft (${entry.kind.replace('_', ' ')}) for ${channel.target}: ${errorMessage(error)}`, channel.id)
            // The AI itself failed (it is down, slow or stopped): the other channels would meet the same, so the scan ends here.
            engineDown = code === 'ai_unavailable'
          }
          break
        }
        if (engineDown) break
      }
    } finally {
      this.running = false
    }
    if (prepared > 0 || asked) this.core.events.changed('channels')
    return prepared
  }

  // ───────────── parts ─────────────

  /**
   * The mix of a channel as it runs now: the owner's setting of each kind, or what the accepted change of the weekly review makes of it while
   * that change is in force and the owner has not changed the setting since (owner's answer of 2026-11-28). Drafts only, as ever.
   */
  private inForce(channel: Channel): MixSetting[] {
    const change = changeInForce(this.core, channel.productId)
    return MIX_KINDS.map((kind) => ({ kind, ...rhythmInForce(ownRhythm(channel, kind), change?.plan.find((step) => step.channelId === channel.id && step.kind === kind)) }))
  }

  private async prepare(channel: Channel, kind: MixKind, note: ProductUpdate | undefined): Promise<void> {
    if (kind === 'own_update') {
      if (!note) throw new ApiError('no_note', 'There is no note to write from.')
      await this.publications.suggestUpdate(channel.id, note.id, { origin: ORIGIN })
    } else if (kind === 'showcase') {
      await this.publications.suggest(channel.id, { origin: `${ORIGIN} (showcase)`, focus: SHOWCASE_FOCUS })
    } else {
      await this.publications.suggest(channel.id, { origin: ORIGIN })
    }
  }

  private state(channelId: Id, kind: MixKind | 'recut'): State {
    const row = this.core.db.prepare('SELECT last_draft_at, last_attempt_at, last_error, failures FROM mix_state WHERE channel_id = ? AND kind = ?').get(channelId, kind) as
      | { last_draft_at: string | null; last_attempt_at: string | null; last_error: string | null; failures: number }
      | undefined
    return { lastDraftAt: row?.last_draft_at ?? null, lastAttemptAt: row?.last_attempt_at ?? null, lastError: row?.last_error ?? null, failures: row?.failures ?? 0 }
  }

  private record(channelId: Id, kind: MixKind | 'recut', outcome: { drafted: true } | { drafted: false; error: string }): void {
    const at = this.core.clock.now().toISOString()
    const previous = this.state(channelId, kind)
    const lastDraftAt = outcome.drafted ? at : previous.lastDraftAt
    const lastError = outcome.drafted ? null : outcome.error.slice(0, 300)
    const failures = outcome.drafted ? 0 : previous.failures + 1
    this.core.db
      .prepare(
        `INSERT INTO mix_state (channel_id, kind, last_draft_at, last_attempt_at, last_error, failures) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, kind) DO UPDATE SET last_draft_at = excluded.last_draft_at, last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error, failures = excluded.failures`
      )
      .run(channelId, kind, lastDraftAt, at, lastError, failures)
  }
}

interface Row {
  id: string
  product_id: string
  text: string
  created_at: string
  used_in_opportunity_id: string | null
  failed_tries: number
}

const readNote = (row: Row): ProductUpdate => ({
  id: row.id,
  productId: row.product_id,
  text: row.text,
  createdAt: row.created_at,
  usedInOpportunityId: row.used_in_opportunity_id,
  failedTries: row.failed_tries
})
