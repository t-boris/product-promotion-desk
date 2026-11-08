import { newId, type Db } from './db/database'
import type { EventBus } from './events'
import type { Clock } from './ports'
import { mapRun } from './repos'
import type { Id, Run, RunKind, RunStatus } from '../shared/types'

export interface RunResult {
  status: Exclude<RunStatus, 'running'>
  /** One short line shown in the log (REQ-005: each run exposes time, status and short result). */
  summary: string
}

/** Records every unit of background or user-triggered work as a Run with time, status and a short result. */
export class RunRecorder {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
    private readonly clock: Clock
  ) {}

  /**
   * Runs `work` and records it. If `work` throws, the run is marked failed and the error is re-thrown only when
   * `rethrow` is set, so a failing channel never stops the others.
   */
  async track<T extends RunResult>(
    kind: RunKind,
    scope: { channelId?: Id | null; productId?: Id | null },
    work: () => Promise<T>,
    options: { rethrow?: boolean } = {}
  ): Promise<T | null> {
    const id = newId()
    this.db
      .prepare('INSERT INTO runs (id, kind, channel_id, product_id, status, started_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, scope.channelId ?? null, scope.productId ?? null, 'running', this.clock.now().toISOString())
    this.emit(id)
    try {
      const result = await work()
      this.finish(id, result.status, result.summary)
      return result
    } catch (error) {
      this.finish(id, 'failed', error instanceof Error ? error.message : String(error))
      if (options.rethrow) throw error
      return null
    }
  }

  private finish(id: Id, status: RunStatus, summary: string): void {
    this.db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
      .run(status, this.clock.now().toISOString(), summary.slice(0, 500), id)
    this.emit(id)
  }

  private emit(id: Id): void {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown>
    this.events.emit({ type: 'run', run: mapRun(row) })
    this.events.changed('logs')
  }

  /** Marks runs left 'running' by a previous process as interrupted (called at startup). */
  closeInterrupted(): number {
    const info = this.db
      .prepare("UPDATE runs SET status = 'failed', finished_at = ?, summary = 'Interrupted by application stop' WHERE status = 'running'")
      .run(this.clock.now().toISOString())
    return info.changes
  }

  list(options: { limit?: number; channelId?: Id } = {}): Run[] {
    const limit = options.limit ?? 100
    const rows = (
      options.channelId
        ? this.db.prepare('SELECT * FROM runs WHERE channel_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(options.channelId, limit)
        : this.db.prepare('SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?').all(limit)
    ) as Record<string, unknown>[]
    return rows.map(mapRun)
  }
}
