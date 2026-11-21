// SQL access for the findings of the AI triage (DEC-040): one row per post of a channel that was judged, by its title first and, when it was relevant,
// by reading it. A finding is not work to approve: it carries no draft, no approval and no send. The only link to the work of the owner is
// `opportunity_id`, set when a post was worth a reply and its ordinary `new_post` opportunity was opened (or was there already).

import { ApiError } from '../../shared/api'
import type { Finding, FindingCard, FindingCounts, FindingLabel, Id } from '../../shared/types'
import type { Core } from '../core'
import { newId, type Db } from '../db/database'
import { mapFinding } from '../repos'
import { oneLine } from '../assist/kit'
import type { RemoteDiscussion } from '../ports'
import { WATCH_REPLY_PREFIX } from '../browser-agent/watch'

type Row = Record<string, unknown>
type Bindable = string | number | null

export const DEFAULT_LIST_LIMIT = 100
export const MAX_LIST_LIMIT = 300
/** Findings of posts judged not relevant are kept this long; the look-back reaches back at most a month, so a post forgotten here is never found again. */
export const SKIP_KEEP_DAYS = 60
/**
 * A post the engine keeps answering unusably about (after the one repair) must not be asked about for ever, and must not vanish: after this many such
 * passes it is settled as a notice that says the AI could not judge it, so the owner looks at it herself. Never a skip (it would hide a post nobody
 * judged) and never a reply (nothing judged it worth answering). Owner-delegated decision of DEC-040; failures that are not an answer (the engine was not
 * ready, used tools, timed out or failed, the owner took the browser) are not counted and are retried for ever. Nor is a post counted when the engine judged no
 * other post in the same pass, or when both halves of a batch failed before anything was judged in the pass: then the engine is taken to be at fault, not the
 * post (see TriageFlow.cut).
 */
export const MAX_ATTEMPTS = 3
export const UNJUDGED_RELATION = 'The AI could not judge this post, so it is shown for you to look at.'
/** The relation of a post whose thread was gone when it was opened: labelled `skip` without the engine, so it is no judgment (see `recentJudgment`). */
export const POST_GONE = 'The post is gone'
/** The relation of a post whose thread could not be read three times while other threads could: a notice with no judgment behind it (see `recentJudgment`). */
export const UNREADABLE_RELATION = 'The post could not be read, so it is shown for you to look at.'

const LABELS: readonly FindingLabel[] = ['reply', 'notice', 'skip']
const MAX_STORED_TITLE = 300
const MAX_STORED_AUTHOR = 100

/** What becomes of a post once it is read: its label, the one-line relation and, for a reply, the opportunity. */
export interface ReadSettlement {
  label: FindingLabel
  relation: string
  opportunityId: Id | null
}

export interface FindingFilter {
  productId: Id
  channelId?: Id
  labels?: FindingLabel[]
  limit?: number
}

export class FindingStore {
  constructor(private readonly core: Core) {}

  private get db(): Db {
    return this.core.db
  }

  private now(): string {
    return this.core.clock.now().toISOString()
  }

  /** Tells every connected UI that findings (listed with the Feed) changed. There is no scope of their own (DEC-040): the Feed listens to this one. */
  notify(): void {
    this.core.events.changed('opportunities')
  }

  // ───────────── finding posts ─────────────

  /** Stores a post found by a listing as `pending`. A post of the channel that already has a finding keeps it: a post is judged once. Returns whether a row was added. */
  addPending(productId: Id, channelId: Id, post: RemoteDiscussion, firstLook: boolean): boolean {
    const now = this.now()
    const info = this.db
      .prepare(
        `INSERT INTO findings (id, product_id, channel_id, external_id, title, url, author, posted_at, stage, label, relation, first_look, opportunity_id, seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, NULL, NULL, ?, ?)
         ON CONFLICT (channel_id, external_id) DO NOTHING`
      )
      .run(newId(), productId, channelId, post.externalId, oneLine(post.title, MAX_STORED_TITLE), post.url, oneLine(post.author, MAX_STORED_AUTHOR), post.postedAt, firstLook ? 1 : 0, now, now)
    return info.changes === 1
  }

  /**
   * Stores a post the AI looked at in the account's browser and judged there (DEC-042): its verdict is final, so a notice is `read` and a skip is `title`,
   * as the triage's own are. A post of the channel that has a finding keeps it. Returns whether a row was added. No opportunity, no draft: the finding
   * carries none.
   */
  addWatched(
    productId: Id,
    channelId: Id,
    item: { url: string; title: string; author: string; label: 'notice' | 'skip'; relation: string; about: string; thread: string; replyTo: string; comment: string },
    firstLook: boolean
  ): boolean {
    const now = this.now()
    const info = this.db
      .prepare(
        `INSERT INTO findings (id, product_id, channel_id, external_id, title, url, author, posted_at, stage, label, relation, about, thread, reply_to, suggested_comment, first_look, opportunity_id, seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
         ON CONFLICT (channel_id, external_id) DO NOTHING`
      )
      .run(
        newId(),
        productId,
        channelId,
        item.url,
        oneLine(item.title, MAX_STORED_TITLE),
        item.url,
        oneLine(item.author, MAX_STORED_AUTHOR),
        item.label === 'skip' ? 'title' : 'read',
        item.label,
        item.relation,
        item.about,
        item.thread,
        item.replyTo,
        item.comment,
        firstLook ? 1 : 0,
        now,
        now
      )
    if (info.changes === 1) return true
    // A post called worth a reply before the AI read threads has a verdict and nothing behind it: when the AI now read it, what it read is kept (the verdict stays).
    if (item.about !== '') {
      const upgraded = this.db
        .prepare(`UPDATE findings SET about = ?, thread = ?, reply_to = ?, suggested_comment = ?, updated_at = ? WHERE channel_id = ? AND external_id = ? AND about = '' AND relation LIKE '${WATCH_REPLY_PREFIX}%'`)
        .run(item.about, item.thread, item.replyTo, item.comment, now, channelId, item.url)
      return upgraded.changes === 1
    }
    return false
  }

  /** Posts the AI called worth a reply before it read threads: a verdict with nothing behind it. The newest first; the AI is sent back to read them. */
  unreadReplies(channelId: Id, limit: number): { url: string; title: string }[] {
    const rows = this.db
      .prepare(`SELECT external_id AS url, title FROM findings WHERE channel_id = ? AND about = '' AND relation LIKE '${WATCH_REPLY_PREFIX}%' ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(channelId, limit) as { url: string; title: string }[]
    return rows
  }

  /** The addresses of the channel's most recent findings (the ones a look in the browser is told it judged already), newest first. */
  recentUrls(channelId: Id, limit: number): string[] {
    // A post that waits to be read (see `unreadReplies`) is not "judged": the look is sent to it by name.
    const rows = this.db
      .prepare(`SELECT external_id AS id FROM findings WHERE channel_id = ? AND NOT (about = '' AND relation LIKE '${WATCH_REPLY_PREFIX}%') ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(channelId, limit) as { id: string }[]
    return rows.map((row) => row.id)
  }

  /** Whether this post of the channel has a finding already, whatever its stage. */
  has(channelId: Id, externalId: string): boolean {
    return this.db.prepare('SELECT 1 FROM findings WHERE channel_id = ? AND external_id = ?').get(channelId, externalId) !== undefined
  }

  /** Posts found and not yet judged, the newest post first (the posts of the day before the posts of last month). */
  pending(channelId: Id, limit: number): Finding[] {
    return this.byStage(channelId, "stage = 'pending'", limit)
  }

  /**
   * Posts judged relevant by their title that wait to be opened and read: those that failed the least first, the newest post first among equals. A post
   * that cannot be read (or read to an answer) goes behind the others each time it is counted, so ten of them cannot keep an older good post from being read.
   */
  waiting(channelId: Id, limit: number): Finding[] {
    return this.byStage(channelId, "stage = 'title' AND label IS NULL", limit, 'attempts ASC, ')
  }

  private byStage(channelId: Id, condition: string, limit: number, firstBy = ''): Finding[] {
    const rows = this.db
      .prepare(`SELECT * FROM findings WHERE channel_id = ? AND ${condition} ORDER BY ${firstBy}COALESCE(posted_at, created_at) DESC, rowid DESC LIMIT ?`)
      .all(channelId, limit) as Row[]
    return rows.map(mapFinding)
  }

  // ───────────── how far the channel was listed ─────────────

  /** Up to when the posts of the channel were listed, whole (the start of its last fully successful listing); null when it never was (the first look is due). */
  listedThrough(channelId: Id): string | null {
    const row = this.db.prepare('SELECT listed_through AS at FROM channels WHERE id = ?').get(channelId) as { at: string | null } | undefined
    return row?.at ?? null
  }

  /** Moves the cursor. Only after a listing that was read whole, and to the moment it STARTED: a post written while it ran is listed again next time. */
  setListedThrough(channelId: Id, iso: string): void {
    this.db.prepare('UPDATE channels SET listed_through = ? WHERE id = ?').run(iso, channelId)
  }

  /** How many posts of the channel still have no label (pending, or relevant by title and not yet read). */
  unlabelled(channelId: Id): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM findings WHERE channel_id = ? AND label IS NULL').get(channelId) as { c: number }).c
  }

  // ───────────── judging ─────────────

  /**
   * The verdict on a title. Not relevant: the post is a `skip` for good. Relevant: the post stays without a label and waits to be read. `why` is kept
   * as the relation until reading says more. Returns false when the finding was judged already (a second pass cannot overwrite a verdict).
   */
  judgeTitle(id: Id, verdict: { relevant: boolean; why: string }): boolean {
    const info = this.db
      .prepare("UPDATE findings SET stage = 'title', label = ?, relation = ?, updated_at = ? WHERE id = ? AND stage = 'pending'")
      .run(verdict.relevant ? null : 'skip', verdict.why, this.now(), id)
    return info.changes === 1
  }

  /** The verdict after reading. Only a post that waits to be read can be settled, once. */
  settleRead(id: Id, settlement: ReadSettlement): boolean {
    const info = this.db
      .prepare("UPDATE findings SET stage = 'read', label = ?, relation = ?, opportunity_id = ?, updated_at = ? WHERE id = ? AND stage = 'title' AND label IS NULL")
      .run(settlement.label, settlement.relation, settlement.opportunityId, this.now(), id)
    return info.changes === 1
  }

  /**
   * The engine ANSWERED about these posts and the answer could not be used even after the one repair, and it judged other posts in the same pass (the
   * caller makes sure: this method only counts). Each of them that has no label yet is counted once;
   * one that reaches `MAX_ATTEMPTS` is settled as a `notice` (stage `title`, the fixed relation, no opportunity) and stays in the Feed. Returns the ids
   * settled by this call. Not for failures of the engine itself: those are not an answer and are not counted.
   */
  recordUnusable(ids: Id[]): Id[] {
    return this.recordFailures(ids, UNJUDGED_RELATION)
  }

  /**
   * These posts could not be read (the thread could not be fetched) while other threads could, so the posts are at fault and not the connector (the caller
   * makes sure). Counted like `recordUnusable`, in the same `attempts`; at `MAX_ATTEMPTS` a post is settled as a notice with `UNREADABLE_RELATION`.
   */
  recordUnreadable(ids: Id[]): Id[] {
    return this.recordFailures(ids, UNREADABLE_RELATION)
  }

  private recordFailures(ids: Id[], relation: string): Id[] {
    if (ids.length === 0) return []
    const marks = ids.map(() => '?').join(', ')
    const now = this.now()
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE findings SET attempts = attempts + 1, updated_at = ? WHERE label IS NULL AND id IN (${marks})`).run(now, ...ids)
      const due = (this.db.prepare(`SELECT id FROM findings WHERE label IS NULL AND attempts >= ? AND id IN (${marks})`).all(MAX_ATTEMPTS, ...ids) as { id: Id }[]).map((r) => r.id)
      if (due.length > 0) {
        const dueMarks = due.map(() => '?').join(', ')
        this.db.prepare(`UPDATE findings SET stage = 'title', label = 'notice', relation = ?, opportunity_id = NULL, updated_at = ? WHERE label IS NULL AND id IN (${dueMarks})`).run(relation, now, ...due)
      }
      return due
    })()
  }

  /**
   * Whether any finding of any channel (the engine is global) was labelled by a real judgment at or after `sinceIso`: proof that the engine works, for
   * a pass in which it has judged nothing yet (TriageFlow.proven). `updated_at` is the time of the judgment: nothing else touches it on a labelled finding.
   * Not judgments, so not proof: a post settled by the attempts rule (`UNJUDGED_RELATION`, `UNREADABLE_RELATION`) and a post found gone (`POST_GONE`). A reply that could not be
   * queued is a notice that carries the AI's own relation: that was judged, and it counts.
   *
   * Owner-delegated decision of DEC-040, with its accepted tradeoff: an engine that breaks within a day of a good pass can have posts charged attempts
   * in the meantime (three such passes show a post as a notice saying the AI could not judge it; it is never dropped). Without this, a bad pair left
   * alone in a quiet channel would end every pass as "the engine's fault" and never settle.
   */
  recentJudgment(sinceIso: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM findings WHERE label IS NOT NULL AND updated_at >= ? AND relation NOT IN (?, ?, ?) LIMIT 1')
        .get(sinceIso, UNJUDGED_RELATION, UNREADABLE_RELATION, POST_GONE) !== undefined
    )
  }

  /** Forgets the posts judged not relevant that were found more than `SKIP_KEEP_DAYS` days ago. Returns how many. */
  pruneSkipped(): number {
    const cutoff = new Date(this.core.clock.now().getTime() - SKIP_KEEP_DAYS * 86_400_000).toISOString()
    return this.db.prepare("DELETE FROM findings WHERE label = 'skip' AND created_at < ?").run(cutoff).changes
  }

  // ───────────── what the API shows ─────────────

  /** Newest post first. Findings without a label (pending, or waiting to be read) are listed only when no label is asked for. */
  list(filter: FindingFilter): FindingCard[] {
    const where = ['f.product_id = ?']
    const params: Bindable[] = [filter.productId]
    if (filter.channelId) {
      where.push('f.channel_id = ?')
      params.push(filter.channelId)
    }
    if (filter.labels && filter.labels.length > 0) {
      where.push(`f.label IN (${filter.labels.map(() => '?').join(', ')})`)
      params.push(...filter.labels)
    }
    const asked = typeof filter.limit === 'number' && Number.isFinite(filter.limit) ? Math.floor(filter.limit) : DEFAULT_LIST_LIMIT
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, asked))
    const rows = this.db
      .prepare(
        `SELECT f.*, c.target AS channel_target, c.platform AS channel_platform
           FROM findings f JOIN channels c ON c.id = f.channel_id
          WHERE ${where.join(' AND ')}
          ORDER BY COALESCE(f.posted_at, f.created_at) DESC, f.rowid DESC LIMIT ?`
      )
      .all(...params, limit) as Row[]
    return rows.map((row) => ({ finding: mapFinding(row), channelTarget: row.channel_target as string, channelPlatform: row.channel_platform as string }))
  }

  /** The counts of a product, or of one of its channels (the screen counts what it shows). */
  counts(productId: Id, channelId?: Id): FindingCounts {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(label = 'notice' AND seen_at IS NULL), 0) AS unseen,
                COALESCE(SUM(label = 'notice'), 0) AS notices,
                COALESCE(SUM(label = 'skip'), 0) AS skipped,
                COALESCE(SUM(label IS NULL), 0) AS pending
           FROM findings WHERE product_id = ? AND (? IS NULL OR channel_id = ?)`
      )
      .get(productId, channelId ?? null, channelId ?? null) as { unseen: number; notices: number; skipped: number; pending: number }
    return { unseenNotices: row.unseen, notices: row.notices, skipped: row.skipped, pending: row.pending }
  }

  /**
   * The owner looked at these. Ids that are not findings are ignored. Returns how many findings changed. `updated_at` is left alone on purpose: it is the
   * time of the judgment, and `recentJudgment` must not take the owner's looking for the engine's work.
   */
  markSeen(ids: Id[]): number {
    const now = this.now()
    let changed = 0
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      changed += this.db.prepare(`UPDATE findings SET seen_at = ? WHERE seen_at IS NULL AND id IN (${chunk.map(() => '?').join(', ')})`).run(now, ...chunk).changes
    }
    return changed
  }
}

// ───────────── the handlers' argument checks ─────────────

export function checkLabels(value: unknown): FindingLabel[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((l) => typeof l !== 'string' || !(LABELS as readonly string[]).includes(l))) {
    throw new ApiError('invalid_input', `labels must be a list of ${LABELS.join(', ')}.`)
  }
  return value as FindingLabel[]
}

export function checkIds(value: unknown): Id[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new ApiError('invalid_input', 'ids must be a list of finding ids.')
  return value as Id[]
}
