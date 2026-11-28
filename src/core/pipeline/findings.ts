// SQL access for the findings of the AI triage (DEC-040): one row per post of a channel that was judged, by its title first and, when it was relevant,
// by reading it. A finding is not work to approve: it carries no draft, no approval and no send. The only link to the work of the owner is
// `opportunity_id`, set when a post was worth a reply and its ordinary `new_post` opportunity was opened (or was there already).

import { ApiError } from '../../shared/api'
import type { Account, Channel, Finding, FindingCard, FindingComment, FindingCounts, FindingLabel, FindingPicture, FindingTag, Id } from '../../shared/types'
import type { Core } from '../core'
import { newId, type Db } from '../db/database'
import { mapFinding } from '../repos'
import { oneLine } from '../assist/kit'
import type { RemoteDiscussion } from '../ports'
import { canonicalWatchUrl, OWN_POST_WATCH_DAYS, WATCH_IMAGES_MAX, WATCH_READ_TRIES, WATCH_REPLY_PREFIX, type WatchComment, type WatchItem, type WatchPicture } from '../browser-agent/watch'

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
  addWatched(productId: Id, channelId: Id, item: WatchItem, firstLook: boolean): boolean {
    return this.db.transaction((): boolean => {
      const now = this.now()
      const id = newId()
      const info = this.db
        .prepare(
          `INSERT INTO findings (id, product_id, channel_id, external_id, title, url, author, posted_at, stage, label, relation, about, thread, reply_to, suggested_comment, analysis, topics_json, read_at, is_own, first_look, opportunity_id, seen_at, starred_at, reply_count, score, stats_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (channel_id, external_id) DO NOTHING`
        )
        .run(
          id,
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
          item.analysis,
          JSON.stringify(item.topics),
          item.about === '' ? null : now,
          item.own ? 1 : 0,
          firstLook ? 1 : 0,
          // A post the AI calls worth a reply starts starred: the owner's first filter ("Starred") is the posts the AI would answer.
          item.relation.startsWith(WATCH_REPLY_PREFIX) ? now : null,
          item.replies,
          item.score,
          item.replies !== null || item.score !== null ? now : null,
          now,
          now
        )
      if (info.changes === 1) {
        this.saveThread(id, item.comments, now)
        this.savePictures(id, item.images, now)
        this.keepBodyOf(id, item.body, now)
        return true
      }
      // A post found before the AI read it has a verdict and nothing behind it: when the AI now read it, what it read is kept (the verdict stays).
      if (item.about === '') return false
      const existing = this.db.prepare('SELECT id, about, is_own FROM findings WHERE channel_id = ? AND external_id = ?').get(channelId, item.url) as { id: Id; about: string; is_own: number } | undefined
      if (!existing) return false
      if (existing.about === '') {
        this.applyRead(existing.id, item, now)
        return true
      }
      // B4 (DEC-099): an own post already read once is re-checked for new comments. Refresh its comments, and mark it unseen if any new comment arrived.
      if (existing.is_own === 1 || item.own) {
        const before = this.thread(existing.id)
        const seenComments = new Set(before.map((c) => `${c.author.trim().toLowerCase()}\n${c.text.trim()}`))
        const hasNew = item.comments.some((c) => !seenComments.has(`${c.author.trim().toLowerCase()}\n${c.text.trim()}`))
        this.applyRead(existing.id, { ...item, own: true }, now)
        if (hasNew) {
          this.db.prepare('UPDATE findings SET seen_at = NULL WHERE id = ?').run(existing.id)
          return true
        }
      }
      return false
    })()
  }

  /**
   * What the AI read in a post it opened: the summary, the thread, the analysis, the topics, the comments and the pictures. The verdict stays as it was, except
   * that a post the AI now calls worth a reply is one (and starts starred). A re-read replaces the comments; a picture that is kept already stays and the
   * new ones are added. Returns whether a post of that id was there.
   */
  applyRead(id: Id, item: WatchItem, now = this.now()): boolean {
    return this.db.transaction((): boolean => {
      const row = this.db.prepare('SELECT relation FROM findings WHERE id = ?').get(id) as { relation: string } | undefined
      if (!row) return false
      const becomesReply = item.relation.startsWith(WATCH_REPLY_PREFIX) && !row.relation.startsWith(WATCH_REPLY_PREFIX)
      this.db
        .prepare(
          `UPDATE findings SET about = ?, thread = ?, reply_to = ?, suggested_comment = ?, analysis = ?, topics_json = ?, read_at = ?, updated_at = ?,
                 relation = CASE WHEN ? THEN ? ELSE relation END, starred_at = CASE WHEN ? THEN COALESCE(starred_at, ?) ELSE starred_at END,
                 is_own = CASE WHEN ? THEN 1 ELSE is_own END,
                 reply_count = COALESCE(?, reply_count), score = COALESCE(?, score), stats_at = CASE WHEN ? OR ? THEN ? ELSE stats_at END
           WHERE id = ?`
        )
        .run(item.about, item.thread, item.replyTo, item.comment, item.analysis, JSON.stringify(item.topics), now, now, becomesReply ? 1 : 0, item.relation, becomesReply ? 1 : 0, now, item.own ? 1 : 0, item.replies, item.score, item.replies !== null ? 1 : 0, item.score !== null ? 1 : 0, now, id)
      this.db.prepare('DELETE FROM finding_comments WHERE finding_id = ?').run(id)
      this.saveThread(id, item.comments, now)
      this.savePictures(id, item.images, now)
      this.keepBodyOf(id, item.body, now)
      return true
    })()
  }

  /** The text a page of the post gave with what the AI recorded, kept for this post (see `applyBody` for the rule). */
  private keepBodyOf(id: Id, text: string | undefined, now: string): void {
    if (text === undefined) return
    if (text === '') this.db.prepare("UPDATE findings SET body = '', body_at = ? WHERE id = ? AND body_at IS NULL").run(now, id)
    else this.db.prepare('UPDATE findings SET body = ?, body_at = ? WHERE id = ? AND (body <> ? OR body_at IS NULL)').run(text, now, id, text)
  }

  /**
   * The numbers a page showed for the posts on it (comments, score), kept for the posts of this channel that the application knows: a post is recorded once, so
   * without this its numbers would stay as they were on the day it was found. A number the page did not give is not touched. Returns how many posts changed.
   */
  applyStats(channelId: Id, stats: readonly { url: string; replies: number | null; score: number | null }[]): number {
    if (stats.length === 0) return 0
    const now = this.now()
    const update = this.db.prepare(
      `UPDATE findings SET reply_count = COALESCE(?, reply_count), score = COALESCE(?, score), stats_at = ?
        WHERE channel_id = ? AND external_id = ? AND (COALESCE(?, reply_count) IS NOT reply_count OR COALESCE(?, score) IS NOT score OR stats_at IS NULL)`
    )
    let changed = 0
    this.db.transaction(() => {
      for (const stat of stats) {
        if (stat.replies === null && stat.score === null) continue
        changed += update.run(stat.replies, stat.score, now, channelId, stat.url, stat.replies, stat.score).changes
      }
    })()
    return changed
  }

  /**
   * Keeps the post's own text a page of the post showed (the page's address is the post's own: found by the address the finding is known by). A text keeps the
   * date it was given; an empty text (a post that plainly has none of its own) is kept only while no page has given a text, so a page that was not loaded yet
   * never wipes a text that was read. Returns how many posts changed.
   */
  applyBody(channelId: Id, url: string, text: string): number {
    const now = this.now()
    if (text === '') return this.db.prepare("UPDATE findings SET body = '', body_at = ? WHERE channel_id = ? AND (external_id = ? OR url = ?) AND body_at IS NULL").run(now, channelId, url, url).changes
    return this.db.prepare('UPDATE findings SET body = ?, body_at = ? WHERE channel_id = ? AND (external_id = ? OR url = ?) AND (body <> ? OR body_at IS NULL)').run(text, now, channelId, url, url, text).changes
  }

  /**
   * The posts the AI noted (a notice or a reply) that the application first saw from `from` up to (not including) `to`, the newest first, at most `limit`, and how
   * many there are in all. Posts judged not relevant are not among them. These are the posts the analysis of the Feed is made of.
   */
  notedBetween(productId: Id, channelId: Id | null, from: string, to: string, limit: number): { findings: Finding[]; total: number } {
    const where = `product_id = ? AND label IN ('reply', 'notice') AND created_at >= ? AND created_at < ?${channelId !== null ? ' AND channel_id = ?' : ''}`
    const args: Bindable[] = [productId, from, to, ...(channelId !== null ? [channelId] : [])]
    const rows = this.db.prepare(`SELECT * FROM findings WHERE ${where} ORDER BY created_at DESC, id LIMIT ?`).all(...args, limit) as Row[]
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM findings WHERE ${where}`).get(...args) as { n: number }).n
    return { findings: rows.map(mapFinding), total }
  }

  /** The posts of these ids, for the card of the analysis (a post that is gone is left out). */
  byIds(ids: readonly Id[]): Finding[] {
    if (ids.length === 0) return []
    const out: Finding[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200)
      const rows = this.db.prepare(`SELECT * FROM findings WHERE id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]
      out.push(...rows.map(mapFinding))
    }
    return out
  }

  /** The pictures of a post, as the page showed them, waiting to be fetched. An address kept already is not added again; at most `WATCH_IMAGES_MAX` in all. */
  private savePictures(findingId: Id, images: WatchPicture[], now: string): void {
    if (images.length === 0) return
    const have = this.db.prepare('SELECT source_url AS url FROM finding_images WHERE finding_id = ? ORDER BY position').all(findingId) as { url: string }[]
    const known = new Set(have.map((row) => row.url))
    let position = have.length
    const insert = this.db.prepare('INSERT INTO finding_images (id, finding_id, position, source_url, alt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const image of images) {
      if (position >= WATCH_IMAGES_MAX) break
      if (known.has(image.url)) continue
      known.add(image.url)
      insert.run(newId(), findingId, position++, image.url, image.alt, now)
    }
  }

  /** The pictures of a post in the order the page showed them: what the owner sees of each (the file itself is asked for apart). */
  pictures(findingId: Id): FindingPicture[] {
    const rows = this.db.prepare('SELECT id, alt, file, width, height, failure FROM finding_images WHERE finding_id = ? ORDER BY position').all(findingId) as Row[]
    return rows.map((row) => ({
      id: row.id as string,
      alt: row.alt as string,
      width: (row.width as number | null) ?? null,
      height: (row.height as number | null) ?? null,
      state: row.file ? 'ready' : row.failure ? 'failed' : 'waiting',
      failure: row.failure as string
    }))
  }

  /** The stored file of one picture and its place among the pictures of its post (0 for the first), or null while it has no file (or the picture is not there). */
  pictureFile(id: Id): { file: string; mime: string; position: number } | null {
    const row = this.db.prepare('SELECT file, mime, position FROM finding_images WHERE id = ?').get(id) as { file: string | null; mime: string | null; position: number } | undefined
    return row && row.file && row.mime ? { file: row.file, mime: row.mime, position: row.position } : null
  }

  /** The pictures that wait to be fetched (no file, no failure), the oldest first. */
  waitingPictures(limit: number): { id: Id; url: string }[] {
    return this.db.prepare(`SELECT id, source_url AS url FROM finding_images WHERE file IS NULL AND failure = '' ORDER BY created_at, position LIMIT ?`).all(limit) as { id: Id; url: string }[]
  }

  /** The application has the file of a picture. */
  setPictureFile(id: Id, picture: { file: string; mime: string; bytes: number; width: number | null; height: number | null }): void {
    this.db.prepare('UPDATE finding_images SET file = ?, mime = ?, bytes = ?, width = ?, height = ?, failure = ? WHERE id = ?').run(picture.file, picture.mime, picture.bytes, picture.width, picture.height, '', id)
  }

  /** The site would not give a picture, or what came was not one: the reason, in words for the owner. */
  failPicture(id: Id, failure: string): void {
    this.db.prepare('UPDATE finding_images SET failure = ? WHERE id = ?').run(oneLine(failure, 200) || 'The picture could not be fetched.', id)
  }

  private saveThread(findingId: Id, comments: WatchComment[], now: string): void {
    const insert = this.db.prepare('INSERT INTO finding_comments (id, finding_id, position, depth, author, text, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    comments.forEach((c, position) => insert.run(newId(), findingId, position, c.depth, c.author, c.text, c.url, now))
  }

  /** One finding by its id; refused when it is not there. */
  get(id: Id): Finding {
    const row = this.db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new ApiError('not_found', 'The post was not found. It may have been removed.')
    return mapFinding(row)
  }

  /** The comments the AI read under a post worth a reply, in reading order; none for a post nobody read. */
  thread(findingId: Id): FindingComment[] {
    return this.db.prepare('SELECT position, depth, author, text, url FROM finding_comments WHERE finding_id = ? ORDER BY position').all(findingId) as FindingComment[]
  }

  /**
   * Posts the AI noted and has not read: a verdict with nothing behind it. The AI is sent back to read them, a few at a time: first the ones it called worth a reply
   * and the ones the owner starred, then the ones found since `since` (the last day or two); the newest first. A post found long ago that nobody starred stays as
   * it is until the owner asks for it to be read.
   */
  unreadPosts(channelId: Id, limit: number, since: string): { url: string; title: string }[] {
    const rows = this.db
      .prepare(
        `SELECT external_id AS url, title FROM findings
          WHERE channel_id = ? AND label = 'notice' AND about = '' AND read_tries < ${WATCH_READ_TRIES} AND (relation LIKE '${WATCH_REPLY_PREFIX}%' OR starred_at IS NOT NULL OR created_at >= ?)
          ORDER BY (is_own = 1) DESC, (relation LIKE '${WATCH_REPLY_PREFIX}%' OR starred_at IS NOT NULL) DESC, created_at DESC, rowid DESC LIMIT ?`
      )
      .all(channelId, since, limit) as { url: string; title: string }[]
    return rows
  }

  /**
   * Registers recent confirmed standalone posts published on this channel (with a known `result_url` on the channel's hosts) as own findings
   * (`is_own = 1`) so browser watching checks them first for new comments and shows them at the top of Feed (B4, DEC-099).
   */
  syncOwnPublished(channel: Channel, account: Account, hosts: readonly string[], windowDays = OWN_POST_WATCH_DAYS): number {
    const since = new Date(this.core.clock.now().getTime() - windowDays * 86_400_000).toISOString()
    const rows = this.db
      .prepare(
        `SELECT o.id AS opp_id, a.result_url AS url, COALESCE(a.completed_at, a.attempted_at) AS at
           FROM send_actions a
           JOIN opportunities o ON o.id = a.opportunity_id
          WHERE o.channel_id = ? AND o.kind = 'standalone' AND a.state = 'confirmed'
            AND a.result_url IS NOT NULL AND a.result_url <> ''
            AND COALESCE(a.completed_at, a.attempted_at) >= ?
          ORDER BY COALESCE(a.completed_at, a.attempted_at) DESC
          LIMIT 20`
      )
      .all(channel.id, since) as { opp_id: Id; url: string; at: string }[]
    if (rows.length === 0) return 0
    const author = oneLine(account.identity ?? account.label, MAX_STORED_AUTHOR)
    let added = 0
    this.db.transaction(() => {
      for (const row of rows) {
        const url = canonicalWatchUrl(row.url, [...hosts])
        if (!url) continue
        const draft = this.core.repos.latestDraft(row.opp_id)
        const firstLine = (draft?.text ?? '').split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
        const title = oneLine(draft?.title?.trim() || firstLine || 'Your post', MAX_STORED_TITLE)
        const info = this.db
          .prepare(
            `INSERT INTO findings (id, product_id, channel_id, external_id, title, url, author, posted_at, stage, label, relation, about, thread, reply_to, suggested_comment, analysis, topics_json, read_at, is_own, first_look, opportunity_id, seen_at, starred_at, reply_count, score, stats_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'read', 'notice', 'Your own post — watching for new comments.', '', '', '', '', '', '[]', NULL, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
             ON CONFLICT (channel_id, external_id) DO UPDATE SET is_own = 1`
          )
          .run(newId(), channel.productId, channel.id, url, title, url, author, row.at, row.at, row.at)
        if (info.changes > 0) added += 1
      }
    })()
    return added
  }

  /**
   * Recent own posts of this channel (`is_own = 1`) that should be checked first in browser watch for new comments (B4, DEC-099):
   * never read yet, or last read before `recheckBefore`.
   */
  ownPostsToWatch(channelId: Id, limit: number, since: string, recheckBefore: string): { url: string; title: string }[] {
    return this.db
      .prepare(
        `SELECT external_id AS url, title FROM findings
          WHERE channel_id = ? AND is_own = 1 AND label = 'notice' AND created_at >= ?
            AND (read_at IS NULL OR read_at < ?)
          ORDER BY (read_at IS NULL) DESC, COALESCE(read_at, created_at) ASC, created_at DESC LIMIT ?`
      )
      .all(channelId, since, recheckBefore, limit) as { url: string; title: string }[]
  }

  /**
   * The addresses of the channel's most recent findings (the ones a look in the browser is told it judged already), newest first. A post that waits to be read
   * (see `unreadPosts`, with the same `since`) or an own post scheduled for comment refresh (`excludeUrls`) is not "judged": the look is sent to it by name.
   */
  recentUrls(channelId: Id, limit: number, since: string, excludeUrls?: ReadonlySet<string>): string[] {
    const rows = this.db
      .prepare(
        `SELECT external_id AS id FROM findings
          WHERE channel_id = ? AND NOT (label = 'notice' AND about = '' AND read_tries < ${WATCH_READ_TRIES} AND (relation LIKE '${WATCH_REPLY_PREFIX}%' OR starred_at IS NOT NULL OR created_at >= ?))
          ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(channelId, since, limit) as { id: string }[]
    const urls = rows.map((row) => row.id)
    return excludeUrls && excludeUrls.size > 0 ? urls.filter((u) => !excludeUrls.has(u)) : urls
  }

  /** A look was told to read these posts: each one has been offered once more (see `WATCH_READ_TRIES`). */
  markOffered(channelId: Id, urls: string[]): void {
    const bump = this.db.prepare('UPDATE findings SET read_tries = read_tries + 1 WHERE channel_id = ? AND external_id = ?')
    for (const url of urls) bump.run(channelId, url)
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
    const tags = this.tagsOf(rows.map((row) => row.id as Id))
    return rows.map((row) => ({ finding: mapFinding(row), channelTarget: row.channel_target as string, channelPlatform: row.channel_platform as string, tags: tags.get(row.id as Id) ?? [] }))
  }

  /** The tags of these posts, the shortest name first; a post with none is not in the map. */
  tagsOf(ids: readonly Id[]): Map<Id, FindingTag[]> {
    const map = new Map<Id, FindingTag[]>()
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400)
      const rows = this.db
        .prepare(
          `SELECT ft.finding_id AS finding_id, t.id AS id, t.name AS name FROM finding_tags ft JOIN tags t ON t.id = ft.tag_id
            WHERE ft.finding_id IN (${part.map(() => '?').join(',')}) ORDER BY LENGTH(t.name), t.name`
        )
        .all(...part) as { finding_id: Id; id: Id; name: string }[]
      for (const row of rows) map.set(row.finding_id, [...(map.get(row.finding_id) ?? []), { id: row.id, name: row.name }])
    }
    return map
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

  /** Stars a post or takes the star off. Refused when there is no such post. `updated_at` stays: a star is the owner's mark, not the AI's judgment. */
  setStarred(id: Id, starred: boolean): void {
    const changed = this.db.prepare('UPDATE findings SET starred_at = ? WHERE id = ?').run(starred ? this.now() : null, id).changes
    if (changed === 0) throw new ApiError('not_found', 'The post was not found. It may have been removed.')
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

  /**
   * The owner asks to read these again (Mark as unread): they count as unseen once more. Ids that are not findings, and findings not seen, are left as they
   * are. Returns how many findings changed. `updated_at` is left alone for the reason `markSeen` gives.
   */
  markUnseen(ids: Id[]): number {
    let changed = 0
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      changed += this.db.prepare(`UPDATE findings SET seen_at = NULL WHERE seen_at IS NOT NULL AND id IN (${chunk.map(() => '?').join(', ')})`).run(...chunk).changes
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
