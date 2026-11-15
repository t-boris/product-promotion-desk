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
import { SHOWCASE_FOCUS } from './draft-prompt'
import type { PublicationsFlow } from './publications'
import { schedulableChannels } from './scheduler-eligibility'
import type { FlowStore } from './store'
import { errorMessage } from './util'

/** The mix prepares no draft for a channel while this many of its posts wait for the owner. */
export const MIX_WAITING_CAP = 3
/** A failed try is not repeated before this long (the AI's quota is the owner's). */
export const MIX_RETRY_GAP_MS = 3 * 3_600_000
const DAY_MS = 86_400_000
/** How far the due time of a kind moves around its rhythm, so drafts do not appear at the same minute every week. */
const JITTER = 0.1
const MAX_NOTE_CHARS = 500

export const MIX_KINDS: readonly MixKind[] = ['product_post', 'own_update', 'showcase']
export const DEFAULT_EVERY_DAYS: Record<MixKind, number> = { product_post: 14, own_update: 7, showcase: 30 }
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
export function dueAtMs(channelId: Id, kind: MixKind, everyDays: number, lastDraftAt: IsoTime | null): number {
  if (!lastDraftAt) return 0
  const jitter = (unit(`${channelId}:${kind}:${lastDraftAt}`) * 2 - 1) * JITTER
  return Date.parse(lastDraftAt) + everyDays * DAY_MS * (1 + jitter)
}

/** Why the mix cannot work on this channel at all, or null. An observe-only channel stays as the owner set it. */
export function mixBlocker(channel: Channel): string | null {
  if (channel.mode === 'observe') return 'This channel only watches. Let it prepare drafts (change its mode) before the AI prepares posts here.'
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

interface State {
  lastDraftAt: IsoTime | null
  lastAttemptAt: IsoTime | null
  lastError: string | null
}

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
    const waiting = this.waiting(channelId)
    const unused = this.unusedNotes(channel.productId).length
    const facts = loadKnowledge(this.core, channel.productId).approved.length
    const kinds = MIX_KINDS.map((kind): MixKindCard => {
      const setting = channel.settings.mix.find((entry) => entry.kind === kind)
      const enabled = setting?.enabled ?? false
      const everyDays = setting?.everyDays ?? DEFAULT_EVERY_DAYS[kind]
      const state = this.state(channelId, kind)
      let nextAt: IsoTime | null = null
      let problem: string | null = null
      if (enabled) {
        const retry = state.lastError && state.lastAttemptAt ? Date.parse(state.lastAttemptAt) + MIX_RETRY_GAP_MS : 0
        nextAt = new Date(Math.max(now, dueAtMs(channelId, kind, everyDays, state.lastDraftAt), retry)).toISOString()
        if (kind === 'own_update' && unused === 0) problem = 'Waiting for a note: tell what is new.'
        else if (NEEDS_FACTS.includes(kind) && facts === 0) problem = 'There are no approved facts about the product yet.'
        else if (waiting >= MIX_WAITING_CAP) problem = `${waiting} posts of this channel are waiting for you.`
        else if (state.lastError) problem = `The last try failed: ${state.lastError}`
      }
      return { kind, enabled, everyDays, lastDraftAt: state.lastDraftAt, nextAt, problem }
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
    this.core.repos.product(productId)
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
    if (!clean) throw new ApiError('invalid_input', 'Write what you did, in a line or two.')
    if (clean.length > MAX_NOTE_CHARS) throw new ApiError('invalid_input', `A note is a line or two: at most ${MAX_NOTE_CHARS} characters.`)
    const id = newId()
    const createdAt = this.core.clock.now().toISOString()
    this.core.db.prepare('INSERT INTO product_updates (id, product_id, text, created_at, used_in_opportunity_id) VALUES (?, ?, ?, ?, NULL)').run(id, productId, clean, createdAt)
    this.core.events.changed('channels')
    return { id, productId, text: clean, createdAt, usedInOpportunityId: null }
  }

  listNotes(productId: Id): ProductUpdate[] {
    const rows = this.core.db.prepare('SELECT * FROM product_updates WHERE product_id = ? ORDER BY created_at DESC, rowid DESC').all(productId) as Row[]
    return rows.map(readNote)
  }

  removeNote(id: Id): void {
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
  async runDue(): Promise<number> {
    if (this.running || !this.core.engines.selected()) return 0
    this.running = true
    let prepared = 0
    try {
      for (const channel of schedulableChannels(this.core)) {
        const wanted = channel.settings.mix.filter((entry) => entry.enabled)
        if (wanted.length === 0 || mixBlocker(channel) !== null) continue
        if (this.waiting(channel.id) >= MIX_WAITING_CAP) continue
        for (const entry of wanted) {
          const now = this.core.clock.now().getTime()
          const state = this.state(channel.id, entry.kind)
          if (now < dueAtMs(channel.id, entry.kind, entry.everyDays, state.lastDraftAt)) continue
          if (state.lastError && state.lastAttemptAt && now < Date.parse(state.lastAttemptAt) + MIX_RETRY_GAP_MS) continue
          // Waiting for a note, or for approved facts, is not a failure: nothing is tried and nothing is recorded.
          if (entry.kind === 'own_update' && this.unusedNotes(channel.productId).length === 0) continue
          if (NEEDS_FACTS.includes(entry.kind) && loadKnowledge(this.core, channel.productId).approved.length === 0) continue
          try {
            await this.prepare(channel, entry.kind)
            this.record(channel.id, entry.kind, { drafted: true })
            this.core.log.info('pipeline', `The content mix prepared a draft (${entry.kind.replace('_', ' ')}) for ${channel.target}. It waits for you.`, channel.id)
            prepared += 1
          } catch (error) {
            this.record(channel.id, entry.kind, { drafted: false, error: errorMessage(error) })
            this.core.log.warn('pipeline', `The content mix could not prepare a draft (${entry.kind.replace('_', ' ')}) for ${channel.target}: ${errorMessage(error)}`, channel.id)
          }
          break
        }
      }
    } finally {
      this.running = false
    }
    if (prepared > 0) this.core.events.changed('channels')
    return prepared
  }

  // ───────────── parts ─────────────

  private async prepare(channel: Channel, kind: MixKind): Promise<void> {
    if (kind === 'own_update') {
      const note = this.unusedNotes(channel.productId)[0]
      if (!note) throw new ApiError('no_note', 'There is no unused note to write from.')
      await this.publications.suggestUpdate(channel.id, note.id, { origin: ORIGIN })
    } else if (kind === 'showcase') {
      await this.publications.suggest(channel.id, { origin: `${ORIGIN} (showcase)`, focus: SHOWCASE_FOCUS })
    } else {
      await this.publications.suggest(channel.id, { origin: ORIGIN })
    }
  }

  /** The oldest note first: what the owner did first is told first. */
  private unusedNotes(productId: Id): ProductUpdate[] {
    const rows = this.core.db.prepare('SELECT * FROM product_updates WHERE product_id = ? AND used_in_opportunity_id IS NULL ORDER BY created_at, rowid').all(productId) as Row[]
    return rows.map(readNote)
  }

  /** Posts of the channel that wait for the owner, whoever made them. */
  private waiting(channelId: Id): number {
    const marks = WAITING_STATES.map(() => '?').join(', ')
    const row = this.core.db.prepare(`SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ? AND kind = 'standalone' AND state IN (${marks})`).get(channelId, ...WAITING_STATES) as { n: number }
    return row.n
  }

  private state(channelId: Id, kind: MixKind): State {
    const row = this.core.db.prepare('SELECT last_draft_at, last_attempt_at, last_error FROM mix_state WHERE channel_id = ? AND kind = ?').get(channelId, kind) as
      | { last_draft_at: string | null; last_attempt_at: string | null; last_error: string | null }
      | undefined
    return { lastDraftAt: row?.last_draft_at ?? null, lastAttemptAt: row?.last_attempt_at ?? null, lastError: row?.last_error ?? null }
  }

  private record(channelId: Id, kind: MixKind, outcome: { drafted: true } | { drafted: false; error: string }): void {
    const at = this.core.clock.now().toISOString()
    const previous = this.state(channelId, kind)
    const lastDraftAt = outcome.drafted ? at : previous.lastDraftAt
    const lastError = outcome.drafted ? null : outcome.error.slice(0, 300)
    this.core.db
      .prepare(
        `INSERT INTO mix_state (channel_id, kind, last_draft_at, last_attempt_at, last_error) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, kind) DO UPDATE SET last_draft_at = excluded.last_draft_at, last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`
      )
      .run(channelId, kind, lastDraftAt, at, lastError)
  }
}

interface Row {
  id: string
  product_id: string
  text: string
  created_at: string
  used_in_opportunity_id: string | null
}

const readNote = (row: Row): ProductUpdate => ({ id: row.id, productId: row.product_id, text: row.text, createdAt: row.created_at, usedInOpportunityId: row.used_in_opportunity_id })
