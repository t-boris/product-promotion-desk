// The owner's choices about how a product is worked (DEC-071). Stored per product; read by the content mix (a week with no time) and by the
// trial card (the limit on channels in work). Nothing here asks the AI, blocks a press or posts.
import { ApiError } from '../../shared/api'
import { MAX_CHANNEL_LIMIT, VENUES, isVenue, isVenueStep, type ProductChoices, type VenueState, type VenueStep } from '../../shared/product-choices'
import type { Id } from '../../shared/types'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'

interface ChoiceRow {
  channel_limit: number | null
  low_time: number
  software: number
}

const rowOf = (core: Core, productId: Id): ChoiceRow =>
  (core.db.prepare('SELECT channel_limit, low_time, software FROM product_choices WHERE product_id = ?').get(productId) as ChoiceRow | undefined) ?? { channel_limit: null, low_time: 0, software: 0 }

/** Whether the owner said this is a week with no time for the product. */
export function lowTimeOn(core: Core, productId: Id): boolean {
  return rowOf(core, productId).low_time === 1
}

/** The owner's limit on channels in work; null when none is set. */
export function channelLimitOf(core: Core, productId: Id): number | null {
  return rowOf(core, productId).channel_limit
}

export class Choices {
  constructor(private readonly core: Core) {}

  get(args: { productId: Id }): ProductChoices {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const row = rowOf(this.core, product.id)
    const inWork = this.core.repos.listChannels().filter((c) => c.productId === product.id && c.status === 'active').length
    return { productId: product.id, channelLimit: row.channel_limit, inWork, lowTime: row.low_time === 1, software: row.software === 1 }
  }

  set(args: { productId: Id; channelLimit?: number | null; lowTime?: boolean; software?: boolean }): ProductChoices {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const row = rowOf(this.core, product.id)
    let limit = row.channel_limit
    if (args.channelLimit !== undefined) {
      if (args.channelLimit !== null && (!Number.isInteger(args.channelLimit) || args.channelLimit < 1 || args.channelLimit > MAX_CHANNEL_LIMIT)) throw new ApiError('invalid_input', `The limit is a whole number from 1 to ${MAX_CHANNEL_LIMIT}, or none.`)
      limit = args.channelLimit
    }
    for (const key of ['lowTime', 'software'] as const) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new ApiError('invalid_input', 'The setting must be on or off.')
    const lowTime = args.lowTime ?? row.low_time === 1
    const software = args.software ?? row.software === 1
    this.core.db
      .prepare(
        `INSERT INTO product_choices (product_id, channel_limit, low_time, software) VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET channel_limit = excluded.channel_limit, low_time = excluded.low_time, software = excluded.software`
      )
      .run(product.id, limit, lowTime ? 1 : 0, software ? 1 : 0)
    this.core.events.changed('products')
    this.core.events.changed('channels')
    return this.get({ productId: product.id })
  }

  /** The owner's ticks per launch venue, in the venues' own order. */
  venues(args: { productId: Id }): VenueState[] {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const rows = this.core.db.prepare('SELECT venue, steps_json FROM launch_venues WHERE product_id = ?').all(product.id) as { venue: string; steps_json: string }[]
    const kept = new Map(rows.map((r) => [r.venue, (JSON.parse(r.steps_json) as unknown[]).filter(isVenueStep)]))
    return VENUES.map((v) => ({ venue: v.id, done: kept.get(v.id) ?? [] }))
  }

  tickVenue(args: { productId: Id; venue: string; step: VenueStep; done: boolean }): VenueState[] {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    if (!isVenue(args.venue) || !isVenueStep(args.step) || typeof args.done !== 'boolean') throw new ApiError('invalid_input', 'Choose a venue and a step from the list.')
    const now = this.venues({ productId: product.id }).find((v) => v.venue === args.venue)?.done ?? []
    const next = args.done ? [...new Set([...now, args.step])] : now.filter((s) => s !== args.step)
    this.core.db
      .prepare('INSERT INTO launch_venues (product_id, venue, steps_json) VALUES (?, ?, ?) ON CONFLICT(product_id, venue) DO UPDATE SET steps_json = excluded.steps_json')
      .run(product.id, args.venue, JSON.stringify(next))
    this.core.events.changed('products')
    return this.venues({ productId: product.id })
  }
}
