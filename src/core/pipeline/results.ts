// Data for the product page's Results tab (REQ-006, DEC-009): promotion goals and the latest platform metrics per channel. Version 1 never
// measures business conversions (DEC-002), which the view states explicitly instead of leaving it implicit.

import { ApiError } from '../../shared/api'
import type { Id, MetricSeries, Product, ResultsHistory, ResultsView } from '../../shared/types'
import type { Core } from '../core'
import { latestSnapshots } from './metrics'
import { checkedDays } from './overview'

export function buildResultsView(core: Core, productId?: Id): ResultsView {
  let products: Product[]
  if (productId) {
    try {
      products = [core.repos.product(productId)]
    } catch {
      throw new ApiError('not_found', `Product not found: ${productId}`)
    }
  } else {
    products = core.repos.listProducts()
  }
  const ids = new Set(products.map((p) => p.id))
  return {
    goals: products.map((p) => ({ productId: p.id, productName: p.name, goals: p.goals })),
    channels: core.repos
      .listChannels()
      .filter((c) => ids.has(c.productId))
      .map((channel) => ({ channel, metrics: latestSnapshots(core, channel.id) })),
    businessConversions: 'not_measured'
  }
}

const DAY_MS = 86_400_000

/**
 * Every kept reading of the product's channels over the last `days` days, one series per channel and metric, oldest first (UI-redesign
 * phase C). A reading the platform did not give is a null point, never a zero: the chart leaves a gap, as the Results tab leaves "not available".
 */
export function buildResultsHistory(core: Core, args: { productId: Id; days: number }): ResultsHistory {
  const days = checkedDays(args.days)
  try {
    core.repos.product(args.productId)
  } catch {
    throw new ApiError('not_found', `Product not found: ${args.productId}`)
  }
  const now = core.clock.now()
  const from = new Date(now.getTime() - days * DAY_MS).toISOString()
  const to = now.toISOString()
  const rows = core.db
    .prepare(
      `SELECT m.channel_id, m.key, m.label, m.value, m.available, m.captured_at
         FROM metric_snapshots m JOIN channels c ON c.id = m.channel_id
        WHERE c.product_id = ? AND m.captured_at >= ? AND m.captured_at <= ?
        ORDER BY m.captured_at, m.rowid`
    )
    .all(args.productId, from, to) as Record<string, unknown>[]
  const series = new Map<string, MetricSeries>()
  for (const row of rows) {
    const key = `${row.channel_id as string}\u0000${row.key as string}`
    let entry = series.get(key)
    if (!entry) {
      entry = { channelId: row.channel_id as string, key: row.key as string, label: row.label as string, points: [] }
      series.set(key, entry)
    }
    // The newest label wins: a connector may rename a metric, and the legend should show the current name.
    entry.label = row.label as string
    const usable = row.available === 1 && typeof row.value === 'number' && Number.isFinite(row.value)
    entry.points.push({ capturedAt: row.captured_at as string, value: usable ? (row.value as number) : null })
  }
  return { productId: args.productId, days, from, to, series: [...series.values()] }
}
