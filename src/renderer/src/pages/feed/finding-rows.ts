// The fourth list of the Feed, Noted, and the read-only list of what the AI judged not relevant (DEC-040): one row for each finding, the
// tabs the Feed offers (the three lists of opportunities and Noted), what the Noted tab counts, the words of a finding, when a notice is
// marked seen, and what to say when a list is empty. Pure, so it is tested from src/main/feed-logic.test.ts. A finding is NOT an opportunity
// (nothing to approve or send), so it has no state in the opportunity maps: it has its own row, which carries the `id` and `at` every list
// of the Feed needs, so the selection (`useListSelection`, `selectionAfterKey`) and the day groups work on either kind of row.

import type { FindingCard, FindingCounts, FindingLabel, FindingStage, Id, IsoTime } from '../../../../shared/types'
import { isReplyNote } from '../../../../shared/finding-reply'
import { rowExcerpt } from '../inbox/inbox-groups'
import { LINE_LIMIT, type FeedEmpty, type FeedRow, type FeedState } from './feed-filter'
import { isWatchable, type ReadingWays } from './watching-line'

// ───────────── The tabs ─────────────

/** What the Feed's tabs choose: the three lists of opportunities, or the notices the AI found worth a look. */
export type FeedTab = FeedState | 'noted' | 'reply'

/** The tabs in the order they are shown. */
export const FEED_TABS: readonly { id: FeedTab; label: string }[] = [
  { id: 'reply', label: 'Worth a reply' },
  { id: 'decide', label: 'To decide' },
  { id: 'noted', label: 'Noted' },
  { id: 'sent', label: 'Sent' },
  { id: 'skipped', label: 'Skipped' }
]

/** The opportunity list a tab shows; null for Noted and Worth a reply, whose rows are findings. */
export function opportunityListOf(tab: FeedTab): FeedState | null {
  return tab === 'noted' || tab === 'reply' ? null : tab
}

/** The findings the AI judged worth a reply: the notices that say so (the stream of posts with their threads). */
export function replyRows(rows: readonly FindingRow[]): FindingRow[] {
  return rows.filter((row) => isReplyNote(row.card.finding.relation))
}

// ───────────── Words ─────────────

/** What the AI made of a post, in the tag of a detail. */
export const FINDING_LABEL_WORDS: Record<FindingLabel, string> = { reply: 'Worth a reply', notice: 'Noted', skip: 'Judged not relevant' }

/** How far the AI looked at a post. */
export const FINDING_STAGE_WORDS: Record<FindingStage, string> = {
  pending: 'Not judged yet: waiting for the AI',
  title: 'Judged by its title',
  read: 'Opened and read by the AI'
}

/** The tag of a post found by the look-back of a new channel. */
export const FIRST_LOOK = 'First look'

/** What the action bar says in place of buttons: a finding has nothing to approve or send. */
export function findingBarNote(label: FindingLabel | null): string {
  return label === 'skip' ? 'The AI judged this post not relevant. Nothing is proposed for it.' : 'A notice has nothing to send. A post worth a reply is also in Worth a reply, with its thread.'
}

// ───────────── Rows ─────────────

export interface FindingRow {
  kind: 'finding'
  /** The finding's id. */
  id: Id
  card: FindingCard
  channelId: Id
  /** Where: the channel's address. */
  where: string
  /** The post's title on one line; "Untitled post" for a post that has none. */
  title: string
  /** The AI's one line on how the post relates to the goal, on one line (page-derived text: shown as it is, never as markup). */
  relation: string
  firstLook: boolean
  /** The owner has not looked at it yet. */
  unseen: boolean
  label: FindingLabel | null
  /** The moment the row is listed under: when the post was written, else when the AI found it. Neither changes, so a row never moves. */
  at: IsoTime
}

/** A row of the Feed's list: an opportunity or a finding. The two never share a list, and both carry `id` and `at`. */
export type ListedRow = FeedRow | FindingRow

export function isFindingRow(row: ListedRow): row is FindingRow {
  return 'kind' in row && row.kind === 'finding'
}

export function findingRowOf(card: FindingCard): FindingRow {
  const { finding } = card
  return {
    kind: 'finding',
    id: finding.id,
    card,
    channelId: finding.channelId,
    where: card.channelTarget,
    title: rowExcerpt(finding.title, LINE_LIMIT) || 'Untitled post',
    relation: rowExcerpt(finding.relation, LINE_LIMIT * 2),
    firstLook: finding.firstLook,
    unseen: finding.seenAt === null,
    label: finding.label,
    at: finding.postedAt ?? finding.createdAt
  }
}

/** Newest first; equal moments keep a fixed order, so the list never shuffles between two looks. */
const byTime = (a: FindingRow, b: FindingRow): number => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1)

/** The rows of one list of findings, newest first. Only findings with the label asked for: a pending one, or another label, is not in this list. */
export function buildFindingRows(cards: readonly FindingCard[], label: FindingLabel): FindingRow[] {
  return cards
    .filter((card) => card.finding.label === label)
    .map(findingRowOf)
    .sort(byTime)
}

/** The rows of one channel, or all of them (a channel of null), in the order they were given. */
export function visibleFindings(rows: readonly FindingRow[], channelId: Id | null): FindingRow[] {
  return channelId === null ? [...rows] : rows.filter((row) => row.channelId === channelId)
}

// ───────────── Counts ─────────────

/**
 * The number on the Noted tab: every notice of the product, or of the chosen channel (a count of the list the screen holds: the core
 * counts per product only). While the counts are not here, the rows are counted.
 */
export function notedCount(counts: FindingCounts | undefined, rows: readonly FindingRow[], channelId: Id | null): number {
  return channelId === null && counts ? counts.notices : visibleFindings(rows, channelId).length
}

/** The number of notices the owner has not looked at yet (the badge on the Noted tab), for the product or the chosen channel. */
export function unseenNoticeCount(counts: FindingCounts | undefined, rows: readonly FindingRow[], channelId: Id | null): number {
  return channelId === null && counts ? counts.unseenNotices : visibleFindings(rows, channelId).filter((row) => row.unseen).length
}

export interface JudgedLine {
  /** "Judged not relevant: 143". */
  text: string
  /** There is a list to show. */
  canShow: boolean
  /** "12 waiting for the AI": posts found but not judged yet (the engine was not ready, or the pass was cut short); null when none. */
  waiting: string | null
}

/** The quiet line beside the tabs: how many posts the AI judged not relevant, which the owner can look through. Nothing until the counts are here. */
export function judgedLine(counts: FindingCounts | undefined): JudgedLine | null {
  if (!counts) return null
  return { text: `Judged not relevant: ${counts.skipped}`, canShow: counts.skipped > 0, waiting: counts.pending > 0 ? `${counts.pending} waiting for the AI` : null }
}

// ───────────── Seen ─────────────

/**
 * The findings to mark seen when `selected` is the row shown: a notice the owner has not seen, that this screen did not already mark.
 * `already` is what the screen has marked; asking again for the same row (every render, every reload) gives nothing, so the core is asked
 * once. Posts judged not relevant are not marked: the owner is auditing them, they are not waiting to be noticed.
 */
export function unseenToMark(selected: FindingRow | undefined, already: ReadonlySet<Id>): Id[] {
  if (!selected || selected.label !== 'notice' || !selected.unseen || already.has(selected.id)) return []
  return [selected.id]
}

// ───────────── Empty ─────────────

/** Why the Noted list shows nothing, when it does not: the Feed's own reasons, or that the AI has found nothing worth noting yet. */
export type NotedEmpty = FeedEmpty | 'nothing_noted' | 'nothing_reply'

/** The same reasons for the Worth a reply list: where the Noted list would say the AI has noted nothing, this one says nothing is worth a reply yet. */
export const replyEmptyKind = (kind: NotedEmpty | null): NotedEmpty | null => (kind === 'nothing_noted' ? 'nothing_reply' : kind)

export function notedEmptyKind(channels: readonly ReadingWays[], all: readonly FindingRow[], visible: readonly FindingRow[]): NotedEmpty | null {
  if (channels.length === 0) return 'no_channels'
  if (all.length > 0) return visible.length === 0 ? 'no_match' : null
  return channels.some(isWatchable) ? 'nothing_noted' : 'nothing_read'
}
