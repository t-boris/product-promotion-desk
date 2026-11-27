// The seasonal calendar of a product (DEC-060): which calendars the owner follows, the owner's own dates, and for each date ahead the channels
// it is time to prepare for (weeks ahead for a search-like surface, days ahead for a feed). The dates are computed or listed by the application
// (src/shared/seasonal.ts), never by the AI. "Prepare a post" makes a draft for one date and one channel; the owner approves it like any other.
import { ApiError } from '../../shared/api'
import { CALENDAR_KINDS, LOOK_AHEAD_DAYS, daysUntil, dueNow, eventsBetween, leadDays, type CalendarKind, type OwnDate, type SeasonalEvent } from '../../shared/seasonal'
import type { AttentionItem, Channel, Id, OpportunityCard, SeasonalView } from '../../shared/types'
import { oneLine } from '../assist/kit'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { newId } from '../db/database'

const DAY_MS = 86_400_000
export const MAX_DATE_NAME = 80
export const MAX_OWN_DATES = 40

const isKind = (value: unknown): value is CalendarKind => (CALENDAR_KINDS as readonly unknown[]).includes(value)

function kindsOf(core: Core, productId: Id): CalendarKind[] {
  const rows = core.db.prepare('SELECT kind FROM product_calendars WHERE product_id = ?').all(productId) as { kind: string }[]
  return CALENDAR_KINDS.filter((kind) => rows.some((r) => r.kind === kind))
}

function ownDates(core: Core, productId: Id): OwnDate[] {
  return (core.db.prepare('SELECT id, name, month, day, year FROM product_dates WHERE product_id = ? ORDER BY month, day, name').all(productId) as OwnDate[]).map((r) => ({ ...r }))
}

function eventsAhead(core: Core, productId: Id, nowMs: number): SeasonalEvent[] {
  // From the start of today: a date that is today is still shown.
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)
  return eventsBetween(kindsOf(core, productId), ownDates(core, productId), start.getTime(), start.getTime() + LOOK_AHEAD_DAYS * DAY_MS)
}

const activeChannels = (core: Core, productId: Id): Channel[] => core.repos.listChannels().filter((c) => c.productId === productId && c.status === 'active')

/** "Dec 24" in the application's language. */
const dayLabel = (atMs: number): string => new Date(atMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** One Inbox item per product: dates it is time to prepare for, with nothing prepared and not skipped. */
export function seasonalItems(core: Core): AttentionItem[] {
  const nowMs = core.clock.now().getTime()
  const items: AttentionItem[] = []
  for (const product of core.repos.listProducts()) {
    const channels = activeChannels(core, product.id)
    if (channels.length === 0) continue
    const events = eventsAhead(core, product.id, nowMs)
    if (events.length === 0) continue
    const handled = new Set(
      (core.db.prepare('SELECT event_key FROM seasonal_posts WHERE product_id = ? UNION SELECT event_key FROM seasonal_skipped WHERE product_id = ?').all(product.id, product.id) as { event_key: string }[]).map((r) => r.event_key)
    )
    const open = events.filter((e) => !handled.has(e.key) && channels.some((c) => dueNow(e.atMs, nowMs, c.platform)))
    if (open.length === 0) continue
    const names = open.slice(0, 3).map((e) => `${e.name} (${dayLabel(e.atMs)})`)
    items.push({
      id: `seasonal:${product.id}`,
      kind: 'question',
      title: open.length === 1 ? `A date is coming: ${names[0]}` : `${open.length} dates are coming with nothing prepared`,
      detail: `${open.length === 1 ? 'It is time to prepare a post for it' : `${names.join(', ')}${open.length > 3 ? ' and others' : ''}: it is time to prepare`}. Prepare a draft or skip the date. Nothing is posted without your Approve.`,
      refType: 'product',
      refId: product.id,
      createdAt: new Date(Math.min(...open.map((e) => e.atMs)) - 35 * DAY_MS).toISOString()
    })
  }
  return items
}

export class SeasonalCalendar {
  constructor(
    private readonly core: Core,
    /** Makes the AI's draft of a post about one date for a channel. */
    private readonly suggest: (channelId: Id, focus: string, origin: string) => Promise<OpportunityCard>
  ) {}

  view(args: { productId: Id }): SeasonalView {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const nowMs = this.core.clock.now().getTime()
    const channels = activeChannels(this.core, product.id)
    // A prepared post that was deleted since no longer counts.
    const prepared = this.core.db
      .prepare('SELECT s.event_key, s.channel_id, s.opportunity_id FROM seasonal_posts s JOIN opportunities o ON o.id = s.opportunity_id WHERE s.product_id = ?')
      .all(product.id) as { event_key: string; channel_id: Id; opportunity_id: Id }[]
    const skipped = new Set((this.core.db.prepare('SELECT event_key FROM seasonal_skipped WHERE product_id = ?').all(product.id) as { event_key: string }[]).map((r) => r.event_key))
    return {
      productId: product.id,
      kinds: kindsOf(this.core, product.id),
      own: ownDates(this.core, product.id),
      events: eventsAhead(this.core, product.id, nowMs).map((event) => ({
        key: event.key,
        kind: event.kind,
        name: event.name,
        at: new Date(event.atMs).toISOString(),
        days: daysUntil(event.atMs, nowMs),
        skipped: skipped.has(event.key),
        channels: channels.map((channel) => ({
          channelId: channel.id,
          target: channel.target,
          platform: channel.platform,
          leadDays: leadDays(channel.platform),
          due: dueNow(event.atMs, nowMs, channel.platform),
          opportunityId: prepared.find((p) => p.event_key === event.key && p.channel_id === channel.id)?.opportunity_id ?? null
        }))
      }))
    }
  }

  setKinds(args: { productId: Id; kinds: CalendarKind[] }): SeasonalView {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    if (!Array.isArray(args.kinds) || !args.kinds.every(isKind)) throw new ApiError('invalid_input', 'Choose calendars from the list.')
    this.core.db.transaction(() => {
      this.core.db.prepare('DELETE FROM product_calendars WHERE product_id = ?').run(product.id)
      for (const kind of new Set(args.kinds)) this.core.db.prepare('INSERT INTO product_calendars (product_id, kind) VALUES (?, ?)').run(product.id, kind)
    })()
    this.core.events.changed('products')
    return this.view({ productId: product.id })
  }

  addDate(args: { productId: Id; name: string; month: number; day: number; year?: number | null }): SeasonalView {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const name = oneLine(requireText(args.name, 'The name of the date'), MAX_DATE_NAME)
    const year = args.year ?? null
    const { month, day } = args
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) throw new ApiError('invalid_input', 'Give a real day and month.')
    if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) throw new ApiError('invalid_input', 'Give a real year, or leave it empty for every year.')
    // A leap year stands in for "every year", so February 29 is allowed there.
    const probe = new Date(year ?? 2024, month - 1, day)
    if (probe.getMonth() !== month - 1 || probe.getDate() !== day) throw new ApiError('invalid_input', 'That day does not exist in that month.')
    const count = (this.core.db.prepare('SELECT COUNT(*) AS n FROM product_dates WHERE product_id = ?').get(product.id) as { n: number }).n
    if (count >= MAX_OWN_DATES) throw new ApiError('invalid_state', `A product keeps at most ${MAX_OWN_DATES} dates of its own. Remove one first.`)
    this.core.db.prepare('INSERT INTO product_dates (id, product_id, name, month, day, year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), product.id, name, month, day, year, this.core.clock.now().toISOString())
    this.core.events.changed('products')
    return this.view({ productId: product.id })
  }

  removeDate(args: { id: Id }): SeasonalView {
    const row = this.core.db.prepare('SELECT product_id FROM product_dates WHERE id = ?').get(requireText(args.id, 'The date')) as { product_id: Id } | undefined
    if (!row) throw new ApiError('not_found', 'That date is not kept any more.')
    this.core.db.prepare('DELETE FROM product_dates WHERE id = ?').run(args.id)
    this.core.events.changed('products')
    return this.view({ productId: row.product_id })
  }

  /** Skips a date (nothing will be asked about it) or takes the skip back. */
  skip(args: { productId: Id; eventKey: string; skipped: boolean }): SeasonalView {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const key = requireText(args.eventKey, 'The date')
    if (args.skipped) this.core.db.prepare('INSERT OR IGNORE INTO seasonal_skipped (product_id, event_key, created_at) VALUES (?, ?, ?)').run(product.id, key, this.core.clock.now().toISOString())
    else this.core.db.prepare('DELETE FROM seasonal_skipped WHERE product_id = ? AND event_key = ?').run(product.id, key)
    this.core.events.changed('products')
    return this.view({ productId: product.id })
  }

  /** A draft of a post for one date ahead, for one channel. A draft only. */
  async prepare(args: { productId: Id; eventKey: string; channelId: Id }): Promise<OpportunityCard> {
    const view = this.view({ productId: args.productId })
    const event = view.events.find((e) => e.key === args.eventKey)
    if (!event) throw new ApiError('not_found', 'That date is not ahead any more.')
    const channel = event.channels.find((c) => c.channelId === args.channelId)
    if (!channel) throw new ApiError('invalid_input', 'That channel is not an active channel of this product.')
    if (channel.opportunityId) throw new ApiError('invalid_state', 'A post for this date is prepared for this channel already. Find it on the Posts screen.')
    const on = new Date(event.at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const focus =
      `This post is for a date ahead: ${JSON.stringify(event.name)}, on ${on} (${event.days === 0 ? 'today' : `in ${event.days} day${event.days === 1 ? '' : 's'}`}). ` +
      'Write a post that is useful to this community before or on that date and ties the date to what the product is for. ' +
      'The name and the day are all that is known about the date: state no other detail about it (no time of day, no sign, no figures, no customs) as a fact.'
    const card = await this.suggest(channel.channelId, focus, `For ${event.name} on ${dayLabel(Date.parse(event.at))}`)
    this.core.db
      .prepare('INSERT OR REPLACE INTO seasonal_posts (product_id, event_key, channel_id, opportunity_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(view.productId, event.key, channel.channelId, card.opportunity.id, this.core.clock.now().toISOString())
    this.core.events.changed('products')
    return card
  }
}
