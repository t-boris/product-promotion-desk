import type { LogEvent, LogLevel } from '../shared/types'
import type { Db } from './db/database'
import type { EventBus } from './events'
import type { Clock } from './ports'

export class Logger {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
    private readonly clock: Clock,
    private readonly echo = false
  ) {}

  log(level: LogLevel, source: string, message: string, channelId: string | null = null): void {
    this.db
      .prepare('INSERT INTO log_events (ts, level, source, message, channel_id) VALUES (?, ?, ?, ?, ?)')
      .run(this.clock.now().toISOString(), level, source, message.slice(0, 2000), channelId)
    if (this.echo) console.log(`[${level}] ${source}: ${message}`)
    this.events.changed('logs')
  }

  info(source: string, message: string, channelId: string | null = null): void {
    this.log('info', source, message, channelId)
  }
  warn(source: string, message: string, channelId: string | null = null): void {
    this.log('warn', source, message, channelId)
  }
  error(source: string, message: string, channelId: string | null = null): void {
    this.log('error', source, message, channelId)
  }

  list(limit = 200, level?: LogLevel): LogEvent[] {
    const rows = (
      level
        ? this.db.prepare('SELECT * FROM log_events WHERE level = ? ORDER BY id DESC LIMIT ?').all(level, limit)
        : this.db.prepare('SELECT * FROM log_events ORDER BY id DESC LIMIT ?').all(limit)
    ) as { id: number; ts: string; level: LogLevel; source: string; message: string; channel_id: string | null }[]
    return rows.map((r) => ({ id: r.id, ts: r.ts, level: r.level, source: r.source, message: r.message, channelId: r.channel_id }))
  }
}
