import { describe, expect, it, vi } from 'vitest'
import type { MetricReading } from '../../shared/types'
import { TakeoverError } from '../ports'
import { MetricsServiceImpl, normalizeReading, refreshTracked } from './metrics'
import { fakeConnector } from './scheduler-fakes'
import { makeHarness } from './scheduler-harness'
import { seedChannel, seedProduct } from './scheduler-seed'

const READINGS: MetricReading[] = [
  { key: 'upvotes', label: 'Upvotes', value: 0, available: true },
  { key: 'comments', label: 'Comments', value: 12, available: true },
  { key: 'subscribers', label: 'Subscribers', value: null, available: false },
  // Connector bugs must not turn "unknown" into a number or a number into "unknown":
  { key: 'reach', label: 'Reach', value: 5, available: false },
  { key: 'clicks', label: 'Clicks', value: null, available: true }
]

function setup(metrics: MetricReading[] | Error = READINGS) {
  const h = makeHarness({ connectors: [fakeConnector({ metrics })] })
  h.core.services.metrics = new MetricsServiceImpl(h.core)
  const channel = h.channel()
  return { h, channel }
}

describe('Platform metrics (REQ-006, DEC-002)', () => {
  it('stores a metric the platform does not provide as NULL with available=0, never as zero', async () => {
    const { h, channel } = setup()

    await h.core.router.call('results.refresh', { channelId: channel.id })

    const rows = h.core.db.prepare('SELECT key, value, available FROM metric_snapshots WHERE channel_id = ? ORDER BY key').all(channel.id) as { key: string; value: number | null; available: number }[]
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.subscribers).toEqual({ key: 'subscribers', value: null, available: 0 })
    expect(byKey.reach).toEqual({ key: 'reach', value: null, available: 0 })
    expect(byKey.clicks).toEqual({ key: 'clicks', value: null, available: 0 })
    // A real zero is a measurement and stays a measurement.
    expect(byKey.upvotes).toEqual({ key: 'upvotes', value: 0, available: 1 })
    expect(byKey.comments).toEqual({ key: 'comments', value: 12, available: 1 })
  })

  it('normalizes readings so unavailable and zero can never be confused', () => {
    expect(normalizeReading({ key: 'a', label: 'A', value: 0, available: true })).toMatchObject({ value: 0, available: true })
    expect(normalizeReading({ key: 'a', label: 'A', value: null, available: false })).toMatchObject({ value: null, available: false })
    expect(normalizeReading({ key: 'a', label: 'A', value: 0, available: false })).toMatchObject({ value: null, available: false })
    expect(normalizeReading({ key: 'a', label: 'A', value: Number.NaN, available: true })).toMatchObject({ value: null, available: false })
  })

  it('results.get returns promotion goals, the latest metrics per channel and the explicit "not measured" marker', async () => {
    const { h, channel } = setup()
    const goalProduct = seedProduct(h.core, { name: 'Other product', goal: { targetAction: 'Sign up', successMetrics: ['signups'], notes: 'v1' } })
    await h.core.router.call('results.refresh', { channelId: channel.id })

    const view = await h.core.router.call('results.get', {})

    expect(view.businessConversions).toBe('not_measured')
    expect(view.goals.find((g) => g.productId === goalProduct)).toMatchObject({ productName: 'Other product', goal: { targetAction: 'Sign up' } })
    expect(view.goals.find((g) => g.productId === h.productId)?.goal).toBeNull()
    const entry = view.channels.find((c) => c.channel.id === channel.id)!
    expect(entry.metrics.map((m) => m.key).sort()).toEqual(['clicks', 'comments', 'reach', 'subscribers', 'upvotes'])
    expect(entry.metrics.find((m) => m.key === 'subscribers')).toMatchObject({ value: null, available: false })
    expect(entry.metrics.find((m) => m.key === 'upvotes')).toMatchObject({ value: 0, available: true })
  })

  it('shows only the most recent snapshot batch but keeps the older ones', async () => {
    const { h, channel } = setup()
    await h.core.router.call('results.refresh', { channelId: channel.id })
    h.clock.advance(60 * 60_000)
    h.core.connectors.register(fakeConnector({ metrics: [{ key: 'upvotes', label: 'Upvotes', value: 3, available: true }] }))
    await h.core.router.call('results.refresh', { channelId: channel.id })

    const view = await h.core.router.call('results.get', { productId: h.productId })
    expect(view.channels[0].metrics).toHaveLength(1)
    expect(view.channels[0].metrics[0]).toMatchObject({ key: 'upvotes', value: 3, available: true })
    const total = (h.core.db.prepare('SELECT COUNT(*) AS n FROM metric_snapshots').get() as { n: number }).n
    expect(total).toBe(6)
  })

  it('filters by product and rejects an unknown one', async () => {
    const { h } = setup()
    const other = seedProduct(h.core, { name: 'Other' })
    const view = await h.core.router.call('results.get', { productId: other })
    expect(view.goals.map((g) => g.productId)).toEqual([other])
    expect(view.channels).toEqual([])
    await expect(h.core.router.call('results.get', { productId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('scoped to a product, returns only that product\'s goals, channels and metrics and nothing of the others (DEC-009, REQ-008)', async () => {
    const { h, channel: mine } = setup()
    h.core.db.prepare('UPDATE products SET goal_json = ? WHERE id = ?').run(JSON.stringify({ targetAction: 'Install the app', successMetrics: [], notes: '' }), h.productId)
    const otherProduct = seedProduct(h.core, { name: 'Other product', goal: { targetAction: 'Sign up', successMetrics: ['signups'], notes: '' } })
    const theirs = seedChannel(h.core, { productId: otherProduct, accountId: h.account.id, target: 'r/other' })
    await h.core.router.call('results.refresh', { channelId: mine.id })
    await h.core.router.call('results.refresh', { channelId: theirs.id })

    const view = await h.core.router.call('results.get', { productId: h.productId })

    expect(view.goals).toHaveLength(1)
    expect(view.goals[0]).toMatchObject({ productId: h.productId, goal: { targetAction: 'Install the app' } })
    expect(view.channels.map((c) => c.channel.id)).toEqual([mine.id])
    expect(view.channels[0].metrics.length).toBeGreaterThan(0)
    expect(view.channels[0].metrics.every((m) => m.channelId === mine.id)).toBe(true)
    expect(JSON.stringify(view)).not.toContain('Other product')
    expect(JSON.stringify(view)).not.toContain(theirs.id)
    expect(view.businessConversions).toBe('not_measured')

    // The other product sees the mirror image, and an unscoped call still sees both.
    const mirror = await h.core.router.call('results.get', { productId: otherProduct })
    expect(mirror.goals.map((g) => g.productId)).toEqual([otherProduct])
    expect(mirror.channels.map((c) => c.channel.id)).toEqual([theirs.id])
    expect((await h.core.router.call('results.get', {})).channels).toHaveLength(2)
  })

  it('records a refresh as a run, and surfaces a failing platform to the caller', async () => {
    const { h, channel } = setup(new Error('Reddit insights page changed'))

    await expect(h.core.router.call('results.refresh', { channelId: channel.id })).rejects.toThrow('Reddit insights page changed')

    const run = h.core.runs.list({ limit: 5 }).find((r) => r.kind === 'metrics')
    expect(run).toMatchObject({ channelId: channel.id, status: 'failed', summary: 'Reddit insights page changed' })
    expect((await h.core.router.call('results.get', {})).channels[0].metrics).toEqual([])
  })

  it('does not throw for a scheduled refresh that fails and treats a user takeover as skipped', async () => {
    const { h, channel } = setup(new Error('offline'))
    await expect(refreshTracked(h.core, channel.id)).resolves.toBeNull()

    h.core.connectors.register(
      fakeConnector({
        fetchMetrics: async () => {
          throw new TakeoverError()
        }
      })
    )
    await refreshTracked(h.core, channel.id, { rethrow: true })
    const latest = h.core.runs.list({ limit: 1 })[0]
    expect(latest).toMatchObject({ kind: 'metrics', status: 'skipped' })
  })

  it('summarizes a refresh as a short run result', async () => {
    const { h, channel } = setup()
    await h.core.router.call('results.refresh', { channelId: channel.id })
    expect(h.core.runs.list({ limit: 1 })[0].summary).toBe('2 of 5 metrics available, 3 unavailable')
  })

  it('marks the metrics capability verified only after real metrics were read', async () => {
    const { h, channel } = setup()
    const markCapabilityVerified = vi.fn()
    h.core.services.channels = { markCapabilityVerified }
    await h.core.router.call('results.refresh', { channelId: channel.id })
    expect(markCapabilityVerified).toHaveBeenCalledWith(channel.id, 'metrics', expect.any(String))

    markCapabilityVerified.mockClear()
    h.core.connectors.register(fakeConnector({ metrics: [{ key: 'x', label: 'X', value: null, available: false }] }))
    await h.core.router.call('results.refresh', { channelId: channel.id })
    expect(markCapabilityVerified).not.toHaveBeenCalled()
  })

  it('reports unknown channels and a missing service as API errors', async () => {
    const { h } = setup()
    await expect(h.core.router.call('results.refresh', { channelId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
    const { channel } = { channel: h.channel() }
    h.core.services.metrics = undefined
    await expect(h.core.router.call('results.refresh', { channelId: channel.id })).rejects.toMatchObject({ code: 'not_available' })
  })

  it('offers no business-event ingestion or analytics connection in version 1 (DEC-002)', () => {
    const { h } = setup()
    const methods = h.core.router.methods()
    expect(methods.filter((m) => /analytics|conversion|business|ingest|import/i.test(m))).toEqual([])
  })
})
