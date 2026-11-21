// The "Worth a reply" list of the Feed, a stream of posts with their threads: how it is searched and sorted. Pure, so it is tested from src/main.

import type { FindingRow } from './finding-rows'

export type StreamSort = 'newest' | 'oldest' | 'unseen' | 'channel'

export const STREAM_SORTS: readonly { id: StreamSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'unseen', label: 'Unread first' },
  { id: 'channel', label: 'By channel' }
]

const newestFirst = (a: FindingRow, b: FindingRow): number => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1)

/**
 * The rows in the order chosen; the same rows give the same order every time (equal moments are told apart by their ids). The account's own posts are
 * first in every order: the owner wants the comments under them answered before anything else.
 */
export function sortStream(rows: readonly FindingRow[], sort: StreamSort): FindingRow[] {
  const copy = [...rows]
  const ownFirst = (a: FindingRow, b: FindingRow): number => Number(b.own) - Number(a.own)
  if (sort === 'oldest') return copy.sort((a, b) => ownFirst(a, b) || -newestFirst(a, b))
  if (sort === 'unseen') return copy.sort((a, b) => ownFirst(a, b) || Number(b.unseen) - Number(a.unseen) || newestFirst(a, b))
  if (sort === 'channel') return copy.sort((a, b) => ownFirst(a, b) || a.where.localeCompare(b.where) || newestFirst(a, b))
  return copy.sort((a, b) => ownFirst(a, b) || newestFirst(a, b))
}

/** The rows whose channel, title, author, note, reading of the post or tags hold every word of the search (case does not matter); all of them for an empty search. */
export function searchStream(rows: readonly FindingRow[], query: string): FindingRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter((row) => {
    const { finding } = row.card
    const text = [row.where, finding.title, finding.author, finding.relation, finding.about, finding.thread, ...row.card.tags.map((tag) => tag.name)].join('\n').toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

// ───────────── The filter of the one list: all, the posts the owner starred, the posts not read yet ─────────────

export type StreamFilter = 'all' | 'own' | 'starred' | 'unseen'

export const STREAM_FILTERS: readonly { id: StreamFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'own', label: 'Your posts' },
  { id: 'starred', label: 'Starred' },
  { id: 'unseen', label: 'Unread' }
]

/** The rows the filter keeps, in the order they were given. */
export function filterStream(rows: readonly FindingRow[], filter: StreamFilter): FindingRow[] {
  if (filter === 'own') return rows.filter((row) => row.own)
  if (filter === 'starred') return rows.filter((row) => row.starred)
  if (filter === 'unseen') return rows.filter((row) => row.unseen)
  return [...rows]
}

/** The filters worth a button: every one, except "Your posts" while there are none (and while it is not the one chosen). */
export function visibleFilters(counts: Record<StreamFilter, number>, chosen: StreamFilter): { id: StreamFilter; label: string }[] {
  return STREAM_FILTERS.filter((f) => f.id !== 'own' || counts.own > 0 || chosen === 'own')
}

/** How many rows each filter would keep: the number written on its button. */
export function streamCounts(rows: readonly FindingRow[]): Record<StreamFilter, number> {
  return { all: rows.length, own: rows.filter((row) => row.own).length, starred: rows.filter((row) => row.starred).length, unseen: rows.filter((row) => row.unseen).length }
}


// ───────────── Tags: the posts that carry every tag the owner picked ─────────────

/** The tags picked with one more (or one less when it was picked already): a tag is picked by its name, and the order is the order of the picking. */
export function toggleTag(selected: readonly string[], name: string): string[] {
  return selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]
}

/** The rows that carry EVERY tag picked (a post must match them all); every row when none is picked. */
export function filterByTags(rows: readonly FindingRow[], selected: readonly string[]): FindingRow[] {
  if (selected.length === 0) return [...rows]
  return rows.filter((row) => selected.every((name) => row.card.tags.some((tag) => tag.name === name)))
}
