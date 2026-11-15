// The product's Overview screen (UI-redesign phase C, DEC-037): the funnel, the channels at a glance, the product's own
// attention items and the sends per day. Everything is a count over rows the application already keeps; nothing is
// stored, nothing is predicted, and nothing here changes a row.

import { ApiError } from '../../shared/api'
import type { AttentionItem, Id, OverviewChannel, OverviewDay, OverviewFunnel, OverviewView } from '../../shared/types'
import { localDay } from '../../shared/local-day'
import type { Core } from '../core'
import { getAutomation } from './lifecycle'

const DAY_MS = 86_400_000
export const MIN_DAYS = 1
export const MAX_DAYS = 365
/** The largest offset from UTC any time zone has, in minutes. */
const MAX_OFFSET_MINUTES = 14 * 60

/** The opportunity states in which the owner has something to do. */
const WAITING_STATES = ['draft', 'awaiting_approval', 'ready', 'needs_user'] as const

type Row = Record<string, unknown>

/** A whole number of days inside the allowed range, or the error the caller gets. */
export function checkedDays(days: unknown): number {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new ApiError('invalid_input', `days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}`)
  }
  return days
}

function checkedOffset(minutes: unknown): number {
  if (minutes === undefined) return 0
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || Math.abs(minutes) > MAX_OFFSET_MINUTES) {
    throw new ApiError('invalid_input', 'utcOffsetMinutes must be a whole number of minutes between -840 and 840')
  }
  return minutes
}

/** The first moment of the period: midnight of the local day `days - 1` days before the local today, as UTC. */
export function periodStart(now: Date, days: number, offsetMinutes: number): Date {
  const localNow = now.getTime() + offsetMinutes * 60_000
  const localMidnight = Math.floor(localNow / DAY_MS) * DAY_MS
  return new Date(localMidnight - (days - 1) * DAY_MS - offsetMinutes * 60_000)
}

function productOf(core: Core, productId: Id): void {
  try {
    core.repos.product(productId)
  } catch {
    throw new ApiError('not_found', `Product not found: ${productId}`)
  }
}

function count(core: Core, sql: string, ...args: (string | number)[]): number {
  return (core.db.prepare(sql).get(...args) as { n: number }).n
}

/**
 * How far the product's opportunities that were CREATED in the period got. Counting the same opportunities at every step is
 * what makes it a funnel: a step can never hold more than the one before it (a draft needs an opportunity, an approval a draft,
 * a send an approval).
 */
function funnelOf(core: Core, productId: Id, from: string, to: string): OverviewFunnel {
  const base = 'FROM opportunities o WHERE o.product_id = ? AND o.created_at >= ? AND o.created_at <= ?'
  const hasDraft = 'EXISTS (SELECT 1 FROM drafts d WHERE d.opportunity_id = o.id)'
  const hasApproval = 'EXISTS (SELECT 1 FROM approvals a JOIN drafts d ON d.id = a.draft_id WHERE d.opportunity_id = o.id)'
  const hasSend = "EXISTS (SELECT 1 FROM send_actions s WHERE s.opportunity_id = o.id AND s.state = 'confirmed')"
  const args = [productId, from, to] as const
  return {
    found: count(core, `SELECT COUNT(*) AS n ${base}`, ...args),
    drafted: count(core, `SELECT COUNT(*) AS n ${base} AND ${hasDraft}`, ...args),
    approved: count(core, `SELECT COUNT(*) AS n ${base} AND ${hasApproval}`, ...args),
    sent: count(core, `SELECT COUNT(*) AS n ${base} AND ${hasSend}`, ...args)
  }
}

/** Every confirmed send of the product inside the period: when it happened, on which channel, and whether it was an own post. */
function confirmedSends(core: Core, productId: Id, from: string, to: string): { at: string; channelId: Id; post: boolean }[] {
  const rows = core.db
    .prepare(
      `SELECT COALESCE(s.completed_at, s.attempted_at) AS at, o.channel_id AS channel_id, o.kind AS kind
         FROM send_actions s JOIN opportunities o ON o.id = s.opportunity_id
        WHERE o.product_id = ? AND s.state = 'confirmed' AND COALESCE(s.completed_at, s.attempted_at) >= ? AND COALESCE(s.completed_at, s.attempted_at) <= ?`
    )
    .all(productId, from, to) as Row[]
  return rows.map((row) => ({ at: row.at as string, channelId: row.channel_id as string, post: row.kind === 'standalone' }))
}

/** When the channel's last confirmed send happened (whenever that was), or null. */
function lastSentAt(core: Core, channelId: Id): string | null {
  const row = core.db
    .prepare(
      `SELECT MAX(COALESCE(s.completed_at, s.attempted_at)) AS at
         FROM send_actions s JOIN opportunities o ON o.id = s.opportunity_id
        WHERE o.channel_id = ? AND s.state = 'confirmed'`
    )
    .get(channelId) as { at: string | null }
  return row.at
}

/** The attention items that are about this product: its opportunities, channels and accounts its channels use. */
function attentionOf(core: Core, productId: Id): AttentionItem[] {
  const channels = core.repos.listChannels().filter((c) => c.productId === productId)
  const channelIds = new Set(channels.map((c) => c.id))
  const accountIds = new Set(channels.map((c) => c.accountId))
  const belongs = (item: AttentionItem): boolean => {
    switch (item.refType) {
      case 'product':
        return item.refId === productId
      case 'channel':
        return channelIds.has(item.refId)
      case 'account':
        return accountIds.has(item.refId)
      case 'opportunity':
        try {
          return core.repos.opportunity(item.refId).productId === productId
        } catch {
          return false
        }
      case 'action': {
        const row = core.db.prepare('SELECT o.product_id AS product_id FROM send_actions s JOIN opportunities o ON o.id = s.opportunity_id WHERE s.id = ?').get(item.refId) as Row | undefined
        return row?.product_id === productId
      }
    }
  }
  return getAutomation(core).attention.list().filter(belongs)
}

export function buildOverview(core: Core, args: { productId: Id; days: number; utcOffsetMinutes?: number }): OverviewView {
  const days = checkedDays(args.days)
  const offset = checkedOffset(args.utcOffsetMinutes)
  productOf(core, args.productId)
  const now = core.clock.now()
  const from = periodStart(now, days, offset).toISOString()
  const to = now.toISOString()

  const sends = confirmedSends(core, args.productId, from, to)
  const sentByChannel = new Map<Id, number>()
  for (const send of sends) sentByChannel.set(send.channelId, (sentByChannel.get(send.channelId) ?? 0) + 1)

  const channels = core.repos
    .listChannels()
    .filter((channel) => channel.productId === args.productId)
    .map((channel): OverviewChannel => {
      const marks = WAITING_STATES.map(() => '?').join(', ')
      return {
        channelId: channel.id,
        platform: channel.platform,
        target: channel.target,
        status: channel.status,
        waiting: count(core, `SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ? AND state IN (${marks})`, channel.id, ...WAITING_STATES),
        sent: sentByChannel.get(channel.id) ?? 0,
        lastSuccessAt: channel.lastSuccessAt,
        nextCheckAt: channel.nextCheckAt,
        lastSentAt: lastSentAt(core, channel.id)
      }
    })

  // One entry per local day of the period, so a quiet day is a zero on the chart and not a gap.
  const perDay = new Map<string, OverviewDay>()
  for (let i = 0; i < days; i += 1) {
    const day = localDay(new Date(Date.parse(from) + i * DAY_MS), offset)
    perDay.set(day, { day, posts: 0, replies: 0 })
  }
  for (const send of sends) {
    const entry = perDay.get(localDay(send.at, offset))
    if (!entry) continue
    if (send.post) entry.posts += 1
    else entry.replies += 1
  }

  return {
    productId: args.productId,
    days,
    from,
    to,
    funnel: funnelOf(core, args.productId, from, to),
    channels,
    attention: attentionOf(core, args.productId),
    activity: [...perDay.values()]
  }
}
