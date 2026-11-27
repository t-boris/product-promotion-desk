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
  },
  {
    id: 403,
    name: 'results per post: what the site shows under a sent post, now and over time',
    sql: `
-- The latest reading stands on the send itself (what a row and a card show); NULL: the site does not show it, or it was never read.
ALTER TABLE send_actions ADD COLUMN likes INTEGER;
ALTER TABLE send_actions ADD COLUMN comments INTEGER;
ALTER TABLE send_actions ADD COLUMN views INTEGER;
ALTER TABLE send_actions ADD COLUMN numbers_read_at TEXT;
-- Every reading, for the line over time.
CREATE TABLE post_number_readings (
  action_id TEXT NOT NULL REFERENCES send_actions(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  likes INTEGER,
  comments INTEGER,
  views INTEGER,
  PRIMARY KEY (action_id, read_at)
);
`
  },
  {
    id: 404,
    name: 'weekly review: the words and the one change of a week',
    sql: `
-- One row per product and week (the local date of its Monday). The numbers of the page are counted from the sends when it is shown; kept here are
-- the AI's words, the one change and what the owner answered. by_owner: the owner wrote the change themselves.
CREATE TABLE weekly_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  worked_json TEXT NOT NULL DEFAULT '[]',
  did_not_json TEXT NOT NULL DEFAULT '[]',
  change_text TEXT NOT NULL DEFAULT '',
  change_why TEXT NOT NULL DEFAULT '',
  change_state TEXT NOT NULL DEFAULT 'proposed',
  by_owner INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT,
  prepared_at TEXT,
  UNIQUE (product_id, week_key)
);
`
  },
  {
    id: 405,
    name: 'channel trials: what is expected of a channel, for how long, and the verdict',
    sql: `
-- One running trial per channel (verdict NULL); the earlier ones are kept with their verdict. own_result: the owner's own number, typed with
-- the verdict when the trial is judged by something the application cannot see. final_measured: the trial's number at the verdict.
CREATE TABLE channel_trials (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,
  weeks INTEGER NOT NULL,
  hours_per_week INTEGER NOT NULL,
  metric TEXT NOT NULL,
  own_label TEXT,
  threshold INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  verdict TEXT,
  decided_at TEXT,
  own_result INTEGER,
  final_measured INTEGER
);
CREATE INDEX channel_trials_by_channel ON channel_trials (channel_id, started_at);
`
  }
  ,
  {
    id: 406,
    name: 'the AI-answer check: buyer questions, checks over time',
    sql: `
-- The questions a buyer would ask (DEC-061), in the owner's order.
CREATE TABLE answer_questions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX answer_questions_by_product ON answer_questions (product_id, position);
-- One check: every question asked once through an engine with web search. finished_at NULL: cut short (the application was closed).
CREATE TABLE answer_runs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX answer_runs_by_product ON answer_runs (product_id, started_at);
-- What was answered. product_named and product_cited are worked out by the application, not by the engine.
CREATE TABLE answer_results (
  run_id TEXT NOT NULL REFERENCES answer_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question TEXT NOT NULL,
  state TEXT NOT NULL,
  answer TEXT NOT NULL,
  named_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  product_named INTEGER NOT NULL,
  product_cited INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY (run_id, position)
);
`
  }
  ,
  {
    id: 407,
    name: 'wider listening: watched terms and what was found on the open web',
    sql: `
-- The phrases and competitors the owner watches for a product (DEC-062); the product's name is always watched.
CREATE TABLE listen_terms (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (product_id, kind, position)
);
-- One row per address found. dismissed: the owner took it off the list; kept so the address is not offered again.
CREATE TABLE listen_finds (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  term TEXT NOT NULL,
  said TEXT NOT NULL,
  found_at TEXT NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, url)
);
CREATE TABLE listen_state (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  last_at TEXT,
  last_error TEXT
);
`
  }
]
