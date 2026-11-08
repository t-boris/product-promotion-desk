// Daily digest (REQ-005 background operation, SRC-001 notifications): one short summary notification per channel
// at the channel's local digestTime, at most once per local day.

import type { Channel } from '../../shared/types'
import type { Core } from '../core'
import type { NotificationSink } from './attention-notify'
import { localDayKey, minutesOfLocalDay, parseLocalTime } from './scheduler-timing'

const STATE_KEY = 'digest.last'
const DAY_MS = 24 * 60 * 60 * 1000

interface DigestMark {
  day: string
  at: string
}

function count(core: Core, sql: string, ...params: unknown[]): number {
  return (core.db.prepare(sql).get(...params) as { n: number }).n
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export function buildDigest(core: Core, channel: Channel, sinceIso: string): { title: string; body: string } {
  const newComments = count(core, 'SELECT COUNT(*) AS n FROM comments WHERE channel_id = ? AND first_seen_at > ? AND baseline = 0 AND is_own = 0', channel.id, sinceIso)
  const waiting = count(core, "SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ? AND state IN ('draft', 'awaiting_approval', 'needs_user')", channel.id)
  const sent = count(
    core,
    `SELECT COUNT(*) AS n FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id
     WHERE o.channel_id = ? AND a.state = 'confirmed' AND a.completed_at > ?`,
    channel.id,
    sinceIso
  )
  const unknown = count(
    core,
    "SELECT COUNT(*) AS n FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.channel_id = ? AND a.state = 'unknown'",
    channel.id
  )
  const channelProblem = channel.status === 'needs_user' || channel.status === 'error' ? 1 : 0

  const parts: string[] = []
  if (newComments > 0) parts.push(plural(newComments, 'new comment', 'new comments'))
  if (waiting > 0) parts.push(`${waiting} waiting for you`)
  if (sent > 0) parts.push(`${sent} sent`)
  if (unknown + channelProblem > 0) parts.push(plural(unknown + channelProblem, 'problem', 'problems'))
  return { title: `Daily summary: ${channel.target}`, body: parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing new since the last summary.' }
}

/**
 * Sends every digest that is due now and returns how many were produced. A digest whose notifications are switched
 * off (globally or for the channel) is still marked as done for the day, so switching them on later does not
 * deliver a stale summary.
 */
export function sendDueDigests(core: Core, sink: NotificationSink): number {
  const now = core.clock.now()
  const today = localDayKey(now)
  const marks = core.settings.getRaw<Record<string, DigestMark>>(STATE_KEY, {})
  const globalOn = core.settings.app().notifications
  let sent = 0
  let dirty = false

  for (const channel of core.repos.listChannels()) {
    const at = parseLocalTime(channel.settings.digestTime)
    if (at === null || channel.status === 'setup') continue
    if (minutesOfLocalDay(now) < at) continue
    const previous = marks[channel.id]
    if (previous?.day === today) continue

    marks[channel.id] = { day: today, at: now.toISOString() }
    dirty = true
    if (!globalOn || !channel.settings.notifications) continue

    const since = previous?.at ?? new Date(now.getTime() - DAY_MS).toISOString()
    const digest = buildDigest(core, channel, since)
    sink.notify({ id: `digest:${channel.id}:${today}`, kind: 'digest', ...digest })
    sent += 1
  }
  if (dirty) core.settings.setRaw(STATE_KEY, marks)
  return sent
}
