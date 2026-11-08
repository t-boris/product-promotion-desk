// Platform metrics (I-8, REQ-006, DEC-002): snapshots only. Version 1 has no business-event ingestion and no
// analytics connection, so nothing here claims to measure conversions.

import { ApiError } from '../../shared/api'
import type { Id, MetricReading, MetricSnapshot } from '../../shared/types'
import type { Core } from '../core'
import { newId, tx } from '../db/database'
import { TakeoverError } from '../ports'
import type { MetricsService } from '../services'

type Row = Record<string, unknown>

export function mapSnapshot(r: Row): MetricSnapshot {
  return {
    id: r.id as string,
    channelId: r.channel_id as string,
    key: r.key as string,
    label: r.label as string,
    value: (r.value as number | null) ?? null,
    available: r.available === 1,
    capturedAt: r.captured_at as string
  }
}

/**
 * A metric the platform does not provide is stored as value NULL with available=0 and is never shown as 0
 * (REQ-006). A reading only counts as available when it says so AND carries a finite number; a connector that
 * reports a value for an unavailable metric (or the reverse) is not allowed to turn "unknown" into "zero".
 */
export function normalizeReading(reading: MetricReading): MetricReading {
  const usable = reading.available && typeof reading.value === 'number' && Number.isFinite(reading.value)
  return { key: reading.key, label: reading.label, value: usable ? reading.value : null, available: usable }
}

/** The most recent snapshot batch of a channel (all rows captured together). */
export function latestSnapshots(core: Core, channelId: Id): MetricSnapshot[] {
  const rows = core.db
    .prepare(
      `SELECT * FROM metric_snapshots WHERE channel_id = ?
         AND captured_at = (SELECT MAX(captured_at) FROM metric_snapshots WHERE channel_id = ?)
       ORDER BY label, key`
    )
    .all(channelId, channelId) as Row[]
  return rows.map(mapSnapshot)
}

export function lastCapturedAt(core: Core, channelId: Id): string | null {
  const row = core.db.prepare('SELECT MAX(captured_at) AS at FROM metric_snapshots WHERE channel_id = ?').get(channelId) as { at: string | null }
  return row.at
}

export class MetricsServiceImpl implements MetricsService {
  constructor(private readonly core: Core) {}

  async refresh(channelId: Id): Promise<MetricSnapshot[]> {
    const { core } = this
    const { connector, ctx } = core.connectorContext(channelId)
    // The connector reads through ctx.session (serialized per account, yields to a user takeover).
    const readings = await connector.fetchMetrics(ctx)

    const byKey = new Map<string, MetricReading>()
    for (const reading of readings) byKey.set(reading.key, normalizeReading(reading))

    const capturedAt = core.clock.now().toISOString()
    const insert = core.db.prepare(
      'INSERT INTO metric_snapshots (id, channel_id, key, label, value, available, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const snapshots = tx(core.db, () =>
      [...byKey.values()].map((m): MetricSnapshot => {
        const id = newId()
        insert.run(id, channelId, m.key, m.label, m.value, m.available ? 1 : 0, capturedAt)
        return { id, channelId, capturedAt, ...m }
      })
    )
    core.events.changed('results')

    if (snapshots.some((s) => s.available)) this.markVerified(channelId)
    return snapshots
  }

  /** A real, successful metrics read is the only honest proof of the 'metrics' capability. */
  private markVerified(channelId: Id): void {
    try {
      const capability = this.core.repos.channel(channelId).capabilities.find((c) => c.key === 'metrics')
      if (capability?.status === 'verified') return
      this.core.services.channels?.markCapabilityVerified(channelId, 'metrics', 'Platform metrics were read successfully')
    } catch (error) {
      this.core.log.warn('metrics', `Could not mark metrics verified: ${error instanceof Error ? error.message : String(error)}`, channelId)
    }
  }
}

export function summarizeSnapshots(snapshots: MetricSnapshot[]): string {
  if (snapshots.length === 0) return 'The platform returned no metrics'
  const unavailable = snapshots.filter((s) => !s.available).length
  const base = `${snapshots.length - unavailable} of ${snapshots.length} metrics available`
  return unavailable > 0 ? `${base}, ${unavailable} unavailable` : base
}

/**
 * Refreshes one channel as a recorded run (time, status, short result; REQ-005). With `rethrow` the error reaches
 * the caller (explicit user action); otherwise a failure is only recorded (scheduled refresh).
 */
export async function refreshTracked(core: Core, channelId: Id, options: { rethrow?: boolean } = {}): Promise<MetricSnapshot[] | null> {
  const service = core.services.metrics
  if (!service) throw new ApiError('not_available', 'The metrics service is not available')
  let captured: MetricSnapshot[] | null = null
  const productId = (() => {
    try {
      return core.repos.channel(channelId).productId
    } catch {
      return null
    }
  })()
  await core.runs.track(
    'metrics',
    { channelId, productId },
    async () => {
      try {
        captured = await service.refresh(channelId)
        return { status: 'ok', summary: summarizeSnapshots(captured) }
      } catch (error) {
        // The user holds the browser: not a failure, the next scheduled refresh simply tries again.
        if (error instanceof TakeoverError) return { status: 'skipped', summary: 'Skipped: you are using the browser for this account' }
        throw error
      }
    },
    { rethrow: options.rethrow }
  )
  return captured
}
