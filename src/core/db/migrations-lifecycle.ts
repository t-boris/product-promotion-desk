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
  },
  {
    id: 401,
    name: 'post standing: is a confirmed post still up',
    sql: `
-- What the platform says about a confirmed post when it is looked at again (a site can remove a post after it was published):
-- 'live' or 'removed', why in words, and when it was last looked at. Null: never read (a platform that cannot be read is not checked).
ALTER TABLE send_actions ADD COLUMN standing TEXT;
ALTER TABLE send_actions ADD COLUMN standing_note TEXT;
ALTER TABLE send_actions ADD COLUMN standing_checked_at TEXT;
`
  },
  {
    id: 402,
    name: "post standing: the community's own words under a removed post",
    sql: `
-- What the community wrote under a post it took down (its bot's or a moderator's pinned comment) and who wrote it. Null: none, or the post is up.
ALTER TABLE send_actions ADD COLUMN standing_notice TEXT;
ALTER TABLE send_actions ADD COLUMN standing_notice_by TEXT;
`
  }
]
