// Persistence for the scheduler: per-channel failure streak / auto-resume flag (scheduler_state) and the
// scheduling columns of `channels`. Everything the scheduler decides is written here so a restart
// continues from the same state instead of starting blindly.

import type { Db } from '../db/database'
import type { Id } from '../../shared/types'

export interface ScheduleState {
  channelId: Id
  consecutiveFailures: number
  /** True when the scheduler stopped the channel for an account/capability reason and may resume it by itself. */
  autoResume: boolean
  lastError: string
}

interface Row {
  channel_id: string
  consecutive_failures: number
  auto_resume: number
  last_error: string
}

const EMPTY = (channelId: Id): ScheduleState => ({ channelId, consecutiveFailures: 0, autoResume: false, lastError: '' })
const fromRow = (r: Row): ScheduleState => ({ channelId: r.channel_id, consecutiveFailures: r.consecutive_failures, autoResume: r.auto_resume === 1, lastError: r.last_error })

/** Start of the status_detail the scheduler writes while a channel is failing. */
export const FAILURE_DETAIL_PREFIX = 'Last check failed'

export interface RetryPlan {
  nextCheckAt: string
  /** Text for channels.status_detail while the channel is failing. */
  detail: string
}

export class ScheduleStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string
  ) {}

  get(channelId: Id): ScheduleState {
    const row = this.db.prepare('SELECT * FROM scheduler_state WHERE channel_id = ?').get(channelId) as Row | undefined
    return row ? fromRow(row) : EMPTY(channelId)
  }

  /** Channels currently failing at least `threshold` times in a row (shown as attention items). */
  failing(threshold: number): ScheduleState[] {
    return (this.db.prepare('SELECT * FROM scheduler_state WHERE consecutive_failures >= ?').all(threshold) as Row[]).map(fromRow)
  }

  private put(state: ScheduleState): void {
    this.db
      .prepare(
        `INSERT INTO scheduler_state (channel_id, consecutive_failures, auto_resume, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET consecutive_failures = excluded.consecutive_failures,
           auto_resume = excluded.auto_resume, last_error = excluded.last_error, updated_at = excluded.updated_at`
      )
      .run(state.channelId, state.consecutiveFailures, state.autoResume ? 1 : 0, state.lastError.slice(0, 500), this.now())
  }

  /**
   * Successful cycle: clear the failure streak and schedule the next regular check. Only the scheduler's own
   * failure text is cleared; a message the monitor left for the user stays.
   */
  recordSuccess(channelId: Id, nowIso: string, nextCheckAt: string): void {
    this.put(EMPTY(channelId))
    this.db
      .prepare(
        `UPDATE channels SET last_run_at = ?, last_success_at = ?, next_check_at = ?,
           status_detail = CASE WHEN status_detail LIKE '${FAILURE_DETAIL_PREFIX}%' THEN '' ELSE status_detail END WHERE id = ?`
      )
      .run(nowIso, nowIso, nextCheckAt, channelId)
  }

  /** Failed cycle: extend the streak, then let `plan` decide the retry time from the new streak length. */
  recordFailure(channelId: Id, nowIso: string, error: string, plan: (streak: number) => RetryPlan): number {
    const streak = this.get(channelId).consecutiveFailures + 1
    const { nextCheckAt, detail } = plan(streak)
    this.put({ channelId, consecutiveFailures: streak, autoResume: false, lastError: error })
    this.db.prepare('UPDATE channels SET last_run_at = ?, next_check_at = ?, status_detail = ? WHERE id = ?').run(nowIso, nextCheckAt, detail.slice(0, 500), channelId)
    return streak
  }

  /** The cycle produced no verdict (skipped); keep the streak and just reschedule. */
  recordSkipped(channelId: Id, nowIso: string, nextCheckAt: string): void {
    this.db.prepare('UPDATE channels SET last_run_at = ?, next_check_at = ? WHERE id = ?').run(nowIso, nextCheckAt, channelId)
  }

  /** Stops scheduling the channel until a person (or, with `autoResume`, a recovered account) allows it again. */
  suspend(channelId: Id, detail: string, autoResume: boolean): void {
    this.put({ ...this.get(channelId), autoResume, lastError: detail })
    this.db.prepare("UPDATE channels SET status = 'needs_user', status_detail = ?, next_check_at = NULL WHERE id = ?").run(detail.slice(0, 500), channelId)
  }

  /** The reason for the suspension is gone: put the channel back into the schedule. */
  restore(channelId: Id, nextCheckAt: string): void {
    this.put(EMPTY(channelId))
    this.db.prepare("UPDATE channels SET status = 'active', status_detail = '', next_check_at = ? WHERE id = ?").run(nextCheckAt, channelId)
  }

  setNextCheck(channelId: Id, nextCheckAt: string): void {
    this.db.prepare('UPDATE channels SET next_check_at = ? WHERE id = ?').run(nextCheckAt, channelId)
  }
}
