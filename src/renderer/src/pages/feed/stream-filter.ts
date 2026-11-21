// The "Worth a reply" list of the Feed, a stream of posts with their threads: how it is searched and sorted. Pure, so it is tested from src/main.

import type { FindingRow } from './finding-rows'

export type StreamSort = 'newest' | 'oldest' | 'unseen' | 'channel'

export const STREAM_SORTS: readonly { id: StreamSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'unseen', label: 'Not seen first' },
  { id: 'channel', label: 'By channel' }
]

const newestFirst = (a: FindingRow, b: FindingRow): number => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1)

/** The rows in the order chosen; the same rows give the same order every time (equal moments are told apart by their ids). */
export function sortStream(rows: readonly FindingRow[], sort: StreamSort): FindingRow[] {
  const copy = [...rows]
  if (sort === 'oldest') return copy.sort((a, b) => -newestFirst(a, b))
  if (sort === 'unseen') return copy.sort((a, b) => Number(b.unseen) - Number(a.unseen) || newestFirst(a, b))
  if (sort === 'channel') return copy.sort((a, b) => a.where.localeCompare(b.where) || newestFirst(a, b))
  return copy.sort(newestFirst)
}

/** The rows whose channel, title, author, note or reading of the post holds every word of the search (case does not matter); all of them for an empty search. */
export function searchStream(rows: readonly FindingRow[], query: string): FindingRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter((row) => {
    const { finding } = row.card
    const text = [row.where, finding.title, finding.author, finding.relation, finding.about, finding.thread].join('\n').toLowerCase()
    return words.every((word) => text.includes(word))
  })
}
