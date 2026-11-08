import type { Migration } from './migrations'

/** lifecycle migrations. Ids must stay inside this area's range (see migrations.ts). */
export const LIFECYCLE_MIGRATIONS: Migration[] = [
  {
    id: 400,
    name: 'scheduler state and lifecycle indexes',
    sql: `
-- Per-channel scheduling state that must survive a restart: the failure streak drives the exponential
-- backoff, and auto_resume remembers that the scheduler stopped the channel because of an account or
-- capability problem, so it may resume the channel by itself once that problem is gone.
CREATE TABLE scheduler_state (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  auto_resume INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- Action history and daily digests read these ranges.
CREATE INDEX IF NOT EXISTS idx_actions_attempted_at ON send_actions(attempted_at);
CREATE INDEX IF NOT EXISTS idx_comments_channel_seen ON comments(channel_id, first_seen_at);
`
  }
]
