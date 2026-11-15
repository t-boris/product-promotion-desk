// What the Feed lists and how (DEC-037 phase E4, DEC-039): one row for each reply opportunity of the current product, the source it came
// from, the state it is in (To decide, Sent, Skipped), what the AI proposes, the filters, the day groups and what to say when a list is
// empty. Pure, so it is tested from src/main/feed-logic.test.ts. The state of an item comes from its opportunity and nothing else: the
// screen never invents one.

import { localDay } from '../../../../shared/local-day'
import type { CapabilityKey, CapabilityStatus, Channel, Id, IsoTime, OpportunityCard, OpportunitySource, OpportunityState } from '../../../../shared/types'
import { CAPABILITY_LABEL, CAPABILITY_STATUS_LABEL } from '../channels/capability-words'
import { rowExcerpt } from '../inbox/inbox-groups'
import { STATE_TONE } from '../review/labels'

// ───────────── Source, state ─────────────

/** What the chips choose: every source, or one. */
export type FeedSourceFilter = 'all' | OpportunitySource

/** The chips in the order they are shown. */
export const FEED_SOURCES: readonly { id: FeedSourceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new_post', label: 'New posts' },
  { id: 'comment', label: 'Comments' },
  { id: 'reply_to_me', label: 'Replies to me' },
  { id: 'mention', label: 'Mentions' }
]

/** One source in the singular: the tag of a row and of an item in full. */
export const SOURCE_LABEL: Record<OpportunitySource, string> = { comment: 'Comment', new_post: 'New post', reply_to_me: 'Reply to me', mention: 'Mention' }

/** The three lists of the Feed: what waits for the owner or for the AI, what went out, what was left alone. */
export type FeedState = 'decide' | 'sent' | 'skipped'

export const FEED_STATES: readonly { id: FeedState; label: string }[] = [
  { id: 'decide', label: 'To decide' },
  { id: 'sent', label: 'Sent' },
  { id: 'skipped', label: 'Skipped' }
]

/**
 * The list an opportunity is in. To decide: the owner has something to do, or the AI is still working (including an approved reply that
 * is not out yet, a failure and a result nobody knows). Sent: confirmed by the platform. Skipped: the AI judged that no reply is needed,
 * or the item was rejected or withdrawn. A `Record`, so a state added to the pipeline cannot be left without a list.
 */
const STATE_OF: Record<OpportunityState, FeedState> = {
  discovered: 'decide',
  analyzing: 'decide',
  draft: 'decide',
  awaiting_approval: 'decide',
  ready: 'decide',
  sending: 'decide',
  needs_user: 'decide',
  error: 'decide',
  deferred: 'decide',
  unknown_result: 'decide',
  confirmed: 'sent',
  no_reply: 'skipped',
  cancelled: 'skipped'
}

export function feedStateOf(state: OpportunityState): FeedState {
  return STATE_OF[state]
}

/** The opportunity states of one list: what the screen asks the core for. */
export function statesOf(feedState: FeedState): OpportunityState[] {
  return (Object.keys(STATE_OF) as OpportunityState[]).filter((state) => STATE_OF[state] === feedState)
}

/** The most items the core returns for one list (`opportunities.list`). A list that is this long may have older items it does not show. */
export const FEED_LIMIT = 300

/** The words of the sidebar's count: nothing for none (null), the number, and "300+" once the list is as long as the core returns. */
export function feedCountLabel(count: number): string | null {
  if (count <= 0) return null
  return count >= FEED_LIMIT ? `${FEED_LIMIT}+` : String(count)
}

// ───────────── What the AI proposes ─────────────

/** What the AI's side of an item is: the words of the third line of a row. */
export type FeedProposal = 'preparing' | 'drafted' | 'undrafted' | 'approved' | 'sending' | 'unknown' | 'failed' | 'needs' | 'skip' | 'sent' | 'cancelled'

export const PROPOSAL_LABEL: Record<FeedProposal, string> = {
  preparing: 'Preparing a reply',
  drafted: 'Reply drafted',
  undrafted: 'Not drafted',
  approved: 'Approved, not sent',
  sending: 'Sending',
  unknown: 'Result unknown',
  failed: 'Failed',
  needs: 'Needs you',
  skip: 'Suggests skipping',
  sent: 'Sent',
  cancelled: 'Cancelled'
}

/**
 * What the AI proposes for an item, from its state and its draft. "Suggests skipping" is the AI's own judgment that no reply is needed
 * (its reason is the item's reason); "Not drafted" is an item nobody has written a reply for yet. Where the state says more than the draft
 * does (approved, sending, sent, failed) the state wins: "Reply drafted" must not describe a reply that is out.
 */
export function proposalOf(card: Pick<OpportunityCard, 'opportunity' | 'draft'>): FeedProposal {
  switch (card.opportunity.state) {
    case 'analyzing':
      return 'preparing'
    case 'ready':
      return 'approved'
    case 'sending':
      return 'sending'
    case 'unknown_result':
      return 'unknown'
    case 'error':
      return 'failed'
    case 'needs_user':
      return 'needs'
    case 'no_reply':
      return 'skip'
    case 'confirmed':
      return 'sent'
    case 'cancelled':
      return 'cancelled'
    default:
      // discovered, draft, awaiting_approval, deferred
      return card.draft !== null ? 'drafted' : 'undrafted'
  }
}

// ───────────── Rows ─────────────

/** The colour of the dot of a row; empty is grey. */
export type RowTone = 'good' | 'warn' | 'bad' | ''

export interface FeedRow {
  /** The opportunity's id. */
  id: Id
  card: OpportunityCard
  source: OpportunitySource
  state: FeedState
  channelId: Id
  /** Where: the channel's address. */
  where: string
  /** Who: the author of the comment, or of the post when the item answers the post. */
  who: string
  /** The first words of what was written: the comment, or the post's title. */
  line: string
  proposal: FeedProposal
  tone: RowTone
  /** The moment the row is listed under: when it was found, or for a sent reply when it went out. */
  at: IsoTime
}

/** The longest first line of a row. */
export const LINE_LIMIT = 80

/** Who wrote what the item is about: the comment's author; for a post (no comment) the post's author. */
export function whoOf(card: Pick<OpportunityCard, 'comment' | 'discussion'>): string {
  return card.comment?.author || card.discussion?.author || 'Unknown'
}

/** What the item is about, on one line: the comment, else the post's title, else the post's text. */
export function lineOf(card: Pick<OpportunityCard, 'comment' | 'discussion'>): string {
  if (card.comment) return rowExcerpt(card.comment.body, LINE_LIMIT)
  const post = card.discussion
  return post ? rowExcerpt(post.title.trim() !== '' ? post.title : post.body, LINE_LIMIT) : ''
}

/**
 * When the row is listed: a sent reply when the platform confirmed it (else when it last changed), everything else when it was found. Both
 * never change afterwards, so a row does not move while the owner works on it.
 */
export function rowTime(card: Pick<OpportunityCard, 'opportunity' | 'lastAction'>): IsoTime {
  const { opportunity } = card
  return opportunity.state === 'confirmed' ? (card.lastAction?.completedAt ?? opportunity.updatedAt) : opportunity.createdAt
}

function toneOf(state: OpportunityState): RowTone {
  const tone = STATE_TONE[state]
  return tone === 'good' || tone === 'warn' || tone === 'bad' ? tone : ''
}

export function feedRowOf(card: OpportunityCard): FeedRow {
  const { opportunity } = card
  return {
    id: opportunity.id,
    card,
    source: opportunity.source,
    state: feedStateOf(opportunity.state),
    channelId: opportunity.channelId,
    where: card.channelTarget,
    who: whoOf(card),
    line: lineOf(card),
    proposal: proposalOf(card),
    tone: toneOf(opportunity.state),
    at: rowTime(card)
  }
}

/** Newest first; equal moments keep a fixed order, so the list never shuffles between two looks. */
const byTime = (a: FeedRow, b: FeedRow): number => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1)

/** The rows of the screen, newest first. */
export function buildFeedRows(cards: readonly OpportunityCard[]): FeedRow[] {
  return cards.map(feedRowOf).sort(byTime)
}

/**
 * One list of cards from the lists asked for each state (each is cut at `FEED_LIMIT`, so a long list of sent replies never pushes out
 * what waits). An item that changed state between two loads is in two of them: the newer one is kept.
 */
export function mergeCards(lists: readonly (readonly OpportunityCard[])[]): OpportunityCard[] {
  const byId = new Map<Id, OpportunityCard>()
  for (const card of lists.flat()) {
    const known = byId.get(card.opportunity.id)
    if (!known || card.opportunity.updatedAt > known.opportunity.updatedAt) byId.set(card.opportunity.id, card)
  }
  return [...byId.values()]
}

/** One of the lists is as long as the core returns: older items of that state exist and are not listed. */
export function isCapped(lists: readonly (readonly OpportunityCard[] | undefined)[]): boolean {
  return lists.some((list) => list !== undefined && list.length >= FEED_LIMIT)
}

// ───────────── Filters ─────────────

export interface FeedFilter {
  source: FeedSourceFilter
  state: FeedState
  /** A channel's id, or null for every channel. */
  channelId: Id | null
}

export function matchesFilter(row: FeedRow, filter: FeedFilter): boolean {
  if (filter.source !== 'all' && row.source !== filter.source) return false
  if (row.state !== filter.state) return false
  return filter.channelId === null || row.channelId === filter.channelId
}

/** The rows to show, in the order they were given (newest first). */
export function visibleRows(rows: readonly FeedRow[], filter: FeedFilter): FeedRow[] {
  return rows.filter((row) => matchesFilter(row, filter))
}

/** How many rows each chip would show, with the state and the channel applied: the numbers on the chips. */
export function sourceCounts(rows: readonly FeedRow[], filter: Pick<FeedFilter, 'state' | 'channelId'>): Record<FeedSourceFilter, number> {
  const counts: Record<FeedSourceFilter, number> = { all: 0, new_post: 0, comment: 0, reply_to_me: 0, mention: 0 }
  for (const source of FEED_SOURCES) counts[source.id] = visibleRows(rows, { ...filter, source: source.id }).length
  return counts
}

/** How many rows each list would show, with the chip and the channel applied: the numbers on the state segments. */
export function stateCounts(rows: readonly FeedRow[], filter: Pick<FeedFilter, 'source' | 'channelId'>): Record<FeedState, number> {
  const counts: Record<FeedState, number> = { decide: 0, sent: 0, skipped: 0 }
  for (const state of FEED_STATES) counts[state.id] = visibleRows(rows, { ...filter, state: state.id }).length
  return counts
}

/**
 * What "Show all" chooses: every source and channel, in the list that has something (To decide first). With nothing at all it is To decide,
 * where an item that arrives will be.
 */
export function widestFilter(rows: readonly FeedRow[]): FeedFilter {
  const state = FEED_STATES.find((s) => rows.some((row) => row.state === s.id))?.id ?? 'decide'
  return { source: 'all', state, channelId: null }
}

// ───────────── Days ─────────────

export interface FeedDay {
  /** The local day, `YYYY-MM-DD`; empty for a row whose time cannot be read. */
  day: string
  label: string
  ids: Id[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

/** "Today", "Yesterday", else "Nov 12" (with the year when it is not this year's); a day that cannot be read is "Earlier". */
export function dayLabel(day: string, today: string): string {
  if (day === '') return 'Earlier'
  if (day === today) return 'Today'
  if (day === new Date(Date.parse(`${today}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10)) return 'Yesterday'
  const [year, month, date] = day.split('-').map(Number)
  const text = `${MONTHS[month - 1]} ${date}`
  return year === Number(today.slice(0, 4)) ? text : `${text}, ${year}`
}

/**
 * The rows under their local day, in the order they were given: a day is a run of neighbours, so the order of the list is the order the
 * arrow keys walk. `offsetMinutes` is the viewer's offset from UTC, east positive, as the Overview and the calendar take it.
 */
export function groupByDay(rows: readonly FeedRow[], today: string, offsetMinutes: number): FeedDay[] {
  const days: FeedDay[] = []
  for (const row of rows) {
    const day = Number.isNaN(Date.parse(row.at)) ? '' : localDay(row.at, offsetMinutes)
    const last = days[days.length - 1]
    if (last && last.day === day) last.ids.push(row.id)
    else days.push({ day, label: dayLabel(day, today), ids: [row.id] })
  }
  return days
}

// ───────────── What is read ─────────────

/** The channels a check or the older discussions are for: those the app reads, the chosen one alone when one is chosen. */
export function readableChannels(channels: readonly Channel[], channelId: Id | null): Channel[] {
  return channels.filter((channel) => channel.reads && (channelId === null || channel.id === channelId))
}

/**
 * The channels in view that the app does not read at all (DEC-034): they take the owner's own posts and nothing else. With every channel
 * of the product unread, and none chosen, there is nothing to tell them from: the empty state says it (`emptyKind`) and none is named here.
 */
export function unreadChannels(channels: readonly Channel[], channelId: Id | null): Channel[] {
  const unread = channels.filter((channel) => !channel.reads && (channelId === null || channel.id === channelId))
  return channelId === null && unread.length === channels.length ? [] : unread
}

/** The abilities a source depends on. */
const SOURCE_ABILITIES: Record<FeedSourceFilter, readonly CapabilityKey[]> = {
  all: ['read_posts', 'read_comments', 'read_inbox'],
  new_post: ['read_posts'],
  comment: ['read_comments'],
  reply_to_me: ['read_inbox'],
  mention: ['read_inbox']
}

/** The states of an ability that mean the app does not read it now, whatever the owner waits for. */
const BLOCKING: readonly CapabilityStatus[] = ['unavailable', 'needs_user', 'restricted']

export interface ReadingProblem {
  channelId: Id
  target: string
  key: CapabilityKey
  /** The ability in the words of the Channels screen's table. */
  ability: string
  /** Its state in the same words. */
  status: string
  /** The reason the channel gave, in its words. */
  detail: string
}

/**
 * Why a source is empty although the channel is read: an ability it depends on is unavailable, needs the owner or is restricted. The reason
 * is the channel's own (`detail`); a state that only needs checking is not a problem. Channels the app does not read are not here: they
 * are `unreadChannels`.
 */
export function readingProblems(channels: readonly Channel[], scope: { source: FeedSourceFilter; channelId: Id | null }): ReadingProblem[] {
  const problems: ReadingProblem[] = []
  for (const channel of channels) {
    if (!channel.reads || (scope.channelId !== null && channel.id !== scope.channelId)) continue
    for (const key of SOURCE_ABILITIES[scope.source]) {
      const capability = channel.capabilities.find((c) => c.key === key)
      if (!capability || !BLOCKING.includes(capability.status)) continue
      problems.push({ channelId: channel.id, target: channel.target, key, ability: CAPABILITY_LABEL[key], status: CAPABILITY_STATUS_LABEL[capability.status], detail: capability.detail })
    }
  }
  return problems
}

// ───────────── Empty, and the words of an item ─────────────

/** Why the list shows nothing, when it does not: no channel, none the app reads, nothing found yet, or filters that exclude everything. */
export type FeedEmpty = 'no_channels' | 'nothing_read' | 'nothing_found' | 'no_match'

export function emptyKind(channels: readonly Pick<Channel, 'reads'>[], rows: readonly FeedRow[], visible: readonly FeedRow[]): FeedEmpty | null {
  if (channels.length === 0) return 'no_channels'
  if (rows.length > 0) return visible.length === 0 ? 'no_match' : null
  return channels.some((channel) => channel.reads) ? 'nothing_found' : 'nothing_read'
}

/** What the action bar says in place of buttons when the item has none: it is out, in flight, or put away for good. */
export function barNote(state: OpportunityState): string | null {
  switch (state) {
    case 'confirmed':
      return 'This reply was sent.'
    case 'sending':
      return 'This reply is being sent right now.'
    case 'cancelled':
      return 'This item was rejected. The record of it stays.'
    default:
      return null
  }
}

/** What the owner is told about the way a reply to a new post goes out: it answers the post, and nobody wrote to the account. */
export const NEW_POST_NOTE = 'Your reply goes under the post as a top-level comment. Nobody wrote to your account, so it is never sent automatically: you decide and send it.'
