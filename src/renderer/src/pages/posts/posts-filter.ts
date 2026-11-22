// What the Posts screen lists and how: one row for each post and one for each group (a post for several channels), the state they
// are in, and the filter, the search and the sort over them. Pure, so it is tested from src/main/posts-logic.test.ts.
// The state of a post comes from its opportunity and nothing else; the screen never invents one.

import { kindsOf } from '../../../../shared/post-format'
import type { Attachment, Id, IsoTime, OpportunityCard, OpportunityState, PostGroupCard } from '../../../../shared/types'
import { nameOf } from '../review/quick/labels'

/** The states the owner filters by. `deleted` is a post the owner took back (the record of it stays). */
export type PostState = 'draft' | 'approved' | 'scheduled' | 'sent' | 'deleted'
export type PostStateFilter = 'all' | PostState
export type PostSort = 'updated' | 'planned' | 'channel'

export const POST_STATE_FILTERS: { id: PostStateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'approved', label: 'Approved' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'sent', label: 'Sent' },
  { id: 'deleted', label: 'Deleted' }
]

export const POST_SORTS: { id: PostSort; label: string }[] = [
  { id: 'updated', label: 'Updated' },
  { id: 'planned', label: 'Planned time' },
  { id: 'channel', label: 'Channel' }
]

/** Which of the filter's states a post is in. A state that needs the owner (needs you, error) is still a draft, with its reason in `attention`. */
export function postStateOf(state: OpportunityState, scheduledAt: IsoTime | null): PostState {
  switch (state) {
    case 'cancelled':
      return 'deleted'
    case 'confirmed':
      return 'sent'
    case 'ready':
      return scheduledAt !== null ? 'scheduled' : 'approved'
    case 'sending':
    case 'unknown_result':
      return 'approved'
    default:
      return 'draft'
  }
}

/** Why a post asks for the owner although it is not a plain draft, or null. */
export function attentionOf(state: OpportunityState): string | null {
  switch (state) {
    case 'needs_user':
      return 'Needs you'
    case 'error':
      return 'Failed'
    case 'unknown_result':
      return 'Result unknown'
    default:
      return null
  }
}

/** One post or one group, as a row of the list. */
export interface PostRow {
  /** The group's id for a group, else the opportunity's id. */
  id: Id
  kind: 'post' | 'group'
  /** One card for a post; every version's card for a group. */
  cards: OpportunityCard[]
  title: string
  /** The text the search reads: title, text and the channels. */
  haystack: string
  /** The states of the versions; a post has exactly one. */
  states: PostState[]
  /** The state the row is shown in: the least finished one of its versions. */
  state: PostState
  attention: string | null
  channelIds: Id[]
  targets: string[]
  platforms: string[]
  thumbnail: Attachment | null
  updatedAt: IsoTime
  /** The first planned send time of the row, if any version is scheduled. */
  scheduledAt: IsoTime | null
  /** When the last version was confirmed sent, if any. */
  sentAt: IsoTime | null
}

/** Least finished first: a group with a draft in it is shown as a draft. */
const STATE_ORDER: PostState[] = ['draft', 'approved', 'scheduled', 'sent', 'deleted']

const TITLE_LIMIT = 80

/**
 * The post's name in a row, by its type: an article is its title, else the first line of its text, cut to a row (as it always was); a quick post
 * has no title, and is the first words of its caption (a picture alone is "Picture post").
 */
export function titleOf(card: OpportunityCard): string {
  const draft = card.draft
  if (draft?.postType === 'quick') return nameOf(draft) || 'Picture post'
  const title = draft?.title?.trim()
  if (title) return title
  const first = (draft?.text ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '')
  if (!first) return draft && draft.attachments.length > 0 ? (kindsOf(draft.attachments).videos > 0 ? 'Video post' : 'Picture post') : 'Empty draft'
  return first.length > TITLE_LIMIT ? `${first.slice(0, TITLE_LIMIT - 1)}…` : first
}

function rowOf(id: Id, kind: PostRow['kind'], cards: OpportunityCard[], masterText = ''): PostRow {
  const states = cards.map((card) => postStateOf(card.opportunity.state, card.opportunity.scheduledAt))
  const state = STATE_ORDER.find((s) => states.includes(s)) ?? 'draft'
  const first = cards[0]
  // Every version that is still to go out and has a time: a draft with a planned time (written from the calendar) is planned too.
  const scheduled = cards
    .filter((c) => c.opportunity.state !== 'cancelled' && c.opportunity.state !== 'confirmed' && c.opportunity.scheduledAt !== null)
    .map((c) => c.opportunity.scheduledAt as string)
    .sort()
  const sent = cards.map((c) => (c.opportunity.state === 'confirmed' ? c.lastAction?.completedAt ?? c.opportunity.updatedAt : null)).filter((at): at is string => at !== null).sort()
  // What the search reads: the title and the text, and the headline of a card (it is text on the picture, and may be the owner's own words).
  const text = cards.map((c) => `${c.draft?.title ?? ''} ${c.draft?.text ?? ''} ${c.draft?.postType === 'quick' ? (c.draft.card?.headline ?? '') : ''}`).join(' ')
  return {
    id,
    kind,
    cards,
    title: titleOf(first),
    haystack: `${text} ${masterText} ${cards.map((c) => c.channelTarget).join(' ')}`.toLowerCase(),
    states,
    state,
    attention: cards.map((c) => attentionOf(c.opportunity.state)).find((a) => a !== null) ?? null,
    channelIds: [...new Set(cards.map((c) => c.opportunity.channelId))],
    targets: cards.map((c) => c.channelTarget),
    platforms: [...new Set(cards.map((c) => c.channelPlatform))],
    thumbnail: cards.flatMap((c) => c.draft?.attachments ?? [])[0] ?? null,
    updatedAt: cards.map((c) => c.opportunity.updatedAt).sort().reverse()[0],
    scheduledAt: scheduled[0] ?? null,
    sentAt: sent[sent.length - 1] ?? null
  }
}

/**
 * The rows of the screen: a row for every group (its versions together) and for every post that is not one of a group's versions.
 * A version of a group that the owner deleted is listed by itself, so that the record of it is not lost.
 */
export function buildPostRows(cards: OpportunityCard[], groups: PostGroupCard[]): PostRow[] {
  const inGroup = new Set(groups.flatMap((g) => g.versions.map((v) => v.card.opportunity.id)))
  const rows: PostRow[] = groups.filter((g) => g.versions.length > 0).map((g) => rowOf(g.group.id, 'group', g.versions.map((v) => v.card), `${g.group.master.title ?? ''} ${g.group.master.text}`))
  for (const card of cards) {
    if (card.opportunity.kind !== 'standalone' || inGroup.has(card.opportunity.id)) continue
    rows.push(rowOf(card.opportunity.id, 'post', [card]))
  }
  return rows
}

export interface PostFilter {
  state: PostStateFilter
  /** A channel's id, or null for every channel. */
  channelId: Id | null
  /** What the owner typed; every word of it must be found. */
  query: string
}

export function matchesFilter(row: PostRow, filter: PostFilter): boolean {
  if (filter.state !== 'all' && !row.states.includes(filter.state)) return false
  if (filter.channelId !== null && !row.channelIds.includes(filter.channelId)) return false
  const words = filter.query.toLowerCase().split(/\s+/).filter((word) => word !== '')
  return words.every((word) => row.haystack.includes(word))
}

const byUpdated = (a: PostRow, b: PostRow): number => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt < b.updatedAt ? 1 : -1)

/**
 * Updated: the newest first. Planned time: what is going out soonest first, then everything else, newest first. Channel: by the
 * channel's name, then newest first. Equal rows keep a fixed order, so the list never shuffles between two looks.
 */
export function sortRows(rows: PostRow[], sort: PostSort): PostRow[] {
  const copy = [...rows]
  switch (sort) {
    case 'planned':
      return copy.sort((a, b) => {
        if (a.scheduledAt !== null && b.scheduledAt !== null) return a.scheduledAt === b.scheduledAt ? byUpdated(a, b) : a.scheduledAt < b.scheduledAt ? -1 : 1
        if (a.scheduledAt !== null) return -1
        if (b.scheduledAt !== null) return 1
        return byUpdated(a, b)
      })
    case 'channel':
      return copy.sort((a, b) => {
        const left = a.targets[0] ?? ''
        const right = b.targets[0] ?? ''
        const order = left.localeCompare(right, 'en', { sensitivity: 'base' })
        return order !== 0 ? order : byUpdated(a, b)
      })
    default:
      return copy.sort(byUpdated)
  }
}

/** How many rows each state filter would show, with the channel and the search applied: the numbers on the segments. */
export function stateCounts(rows: PostRow[], filter: Pick<PostFilter, 'channelId' | 'query'>): Record<PostStateFilter, number> {
  const counts: Record<PostStateFilter, number> = { all: 0, draft: 0, approved: 0, scheduled: 0, sent: 0, deleted: 0 }
  for (const filterState of POST_STATE_FILTERS) {
    counts[filterState.id] = rows.filter((row) => matchesFilter(row, { ...filter, state: filterState.id })).length
  }
  return counts
}

/** The rows to show: filtered, then sorted. */
export function visibleRows(rows: PostRow[], filter: PostFilter, sort: PostSort): PostRow[] {
  return sortRows(rows.filter((row) => matchesFilter(row, filter)), sort)
}
