// What the list of channels shows and how it is searched, kept apart from the component so it is tested on its own (visual-system: a list, never tiles).

import type { Channel, PlatformInfo } from '../../../../shared/types'
import type { Tone } from '../../tone'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE, platformLabel } from './model'

export interface ChannelRow {
  id: string
  /** The address as the channel is named: "r/astrology", "@natalmystic". */
  target: string
  platform: string
  /** The platform's name for people. */
  label: string
  /** What is worth saying next to the platform: "paused", "needs you", "your own posts"; null for a channel that is simply working. */
  note: string | null
  tone: Tone
  /** The status in words, for the dot (a screen reader reads it; the colour alone says nothing). */
  statusLabel: string
  /** How many posts of this channel wait for the owner. */
  waiting: number
}

/** A note for a status that is not "working"; a working channel that nothing reads, in a connector or in the browser, says that it is for the owner's own posts. */
const STATUS_NOTE: Partial<Record<Channel['status'], string>> = { paused: 'paused', needs_user: 'needs you', error: 'a problem', setup: 'setting up' }

/** One row for each channel, in the order the owner looks for them in: by platform, then by address. */
export function channelRows(channels: readonly Channel[], waiting: ReadonlyMap<string, number>, platforms: readonly PlatformInfo[]): ChannelRow[] {
  const rows = channels.map((channel) => ({
    id: channel.id,
    target: channel.target,
    platform: channel.platform,
    label: platformLabel(channel.platform, platforms as PlatformInfo[]),
    note: STATUS_NOTE[channel.status] ?? (channel.reads || channel.watchedInBrowser ? null : 'your own posts'),
    tone: CHANNEL_STATUS_TONE[channel.status],
    statusLabel: CHANNEL_STATUS_LABEL[channel.status],
    waiting: waiting.get(channel.id) ?? 0
  }))
  return rows.sort((a, b) => a.label.localeCompare(b.label) || a.target.localeCompare(b.target))
}

/** What the row says under its address: the platform, and the note when there is one. */
export const rowLine = (row: Pick<ChannelRow, 'label' | 'note'>): string => (row.note ? `${row.label} · ${row.note}` : row.label)

/** Rows that match the search words (every word, in the address or the platform's name) and the platform chosen on the chips (null: all). */
export function filterRows(rows: readonly ChannelRow[], platform: string | null, search: string): ChannelRow[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    if (platform !== null && row.platform !== platform) return false
    const text = `${row.target} ${row.label}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

export interface PlatformChip {
  /** The platform key, or null for "All". */
  key: string | null
  label: string
  count: number
}

/** "All 7", then each platform that has a channel, the one with most channels first. */
export function platformChips(rows: readonly ChannelRow[]): PlatformChip[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const row of rows) counts.set(row.platform, { label: row.label, count: (counts.get(row.platform)?.count ?? 0) + 1 })
  const chips = [...counts.entries()].map(([key, { label, count }]) => ({ key, label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return [{ key: null, label: 'All', count: rows.length }, ...chips]
}

/**
 * The channel whose page is shown: the one the address names, even when the search hides it from the list; without one, the first channel of the list.
 * An address that names no channel (it was removed) shows none: the screen says so.
 */
export function shownChannelId(visible: readonly Pick<ChannelRow, 'id'>[], all: readonly Pick<ChannelRow, 'id'>[], routeId: string | null): string | null {
  if (routeId !== null) return all.some((row) => row.id === routeId) ? routeId : null
  return visible[0]?.id ?? null
}

/** The row an arrow key moves to from the shown one (-1 up, 1 down); the ends stay where they are, and nothing shown starts at the first. */
export function neighbour(visible: readonly Pick<ChannelRow, 'id'>[], shown: string | null, step: 1 | -1): string | null {
  if (visible.length === 0) return null
  const at = visible.findIndex((row) => row.id === shown)
  if (at < 0) return visible[0].id
  return visible[Math.min(visible.length - 1, Math.max(0, at + step))].id
}
