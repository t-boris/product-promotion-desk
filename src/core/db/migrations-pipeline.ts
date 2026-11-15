import type { Migration } from './migrations'

/** pipeline migrations. Ids must stay inside this area's range (see migrations.ts). */
export const PIPELINE_MIGRATIONS: Migration[] = [
  {
    id: 300,
    name: 'pipeline: approval uniqueness and lookup indexes',
    sql: `
-- A draft carries at most one valid approval at any time. Re-approving first invalidates the old one,
-- so two concurrent approvals can never both be usable by the SendGate.
CREATE UNIQUE INDEX idx_approvals_one_active ON approvals(draft_id) WHERE invalidated_at IS NULL;

-- Limit checks count the account's recent attempts; reconciliation scans unresolved ones.
CREATE INDEX idx_actions_state_time ON send_actions(state, attempted_at);

-- Scheduled standalone publications are found by kind, state and planned time.
CREATE INDEX idx_opp_kind_state_sched ON opportunities(kind, state, scheduled_at);

-- Thread context walks parent links and looks for the account's own replies under a comment.
CREATE INDEX idx_comments_parent ON comments(channel_id, parent_external_id);
`
  },
  {
    id: 301,
    name: 'pipeline: approvals remember the signed-in identity they were given under',
    sql: `
-- The content hash binds an approval to who is signed in to the account. The identity is stored next to it
-- only so the SendGate can say WHY an approval no longer applies (a changed login, not an edited text).
ALTER TABLE approvals ADD COLUMN signed_in_identity TEXT;
`
  },
  {
    id: 302,
    name: 'pipeline: the picture library of a product (DEC-030)',
    sql: `
-- A picture is a file in the data folder (media/<id>.<ext>) that never changes: an approval binds the bytes by their hash, and a draft that
-- uses a picture keeps pointing at the same file. One picture per product and content: adding the same file twice returns the first.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  origin TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_media_product_hash ON media(product_id, sha256);
CREATE INDEX idx_media_product ON media(product_id, created_at);
`
  },
  {
    id: 303,
    name: 'pipeline: how the text of a draft is marked up (DEC-030)',
    sql: `
-- 'legacy': the text is sent as it is written (every draft before the post editor, replies, text the AI wrote).
-- 'markdown': written in the post editor; each platform gets the form it can show. Part of the approval hash only when it is 'markdown'.
ALTER TABLE drafts ADD COLUMN markup TEXT NOT NULL DEFAULT 'legacy';
`
  },
  {
    id: 304,
    name: 'pipeline: one post for several channels (DEC-032)',
    sql: `
-- A post group is a wrapper: the master text the owner wrote and the versions made from it. Each version is an ordinary standalone
-- opportunity of one channel (own drafts, own approval, own send, own failure); nothing else in the pipeline reads group_id.
CREATE TABLE post_groups (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  master_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE opportunities ADD COLUMN group_id TEXT;
CREATE INDEX idx_opportunities_group ON opportunities(group_id) WHERE group_id IS NOT NULL;
-- One live version per channel in a group (a cancelled one may be made again).
CREATE UNIQUE INDEX idx_opportunities_group_channel ON opportunities(group_id, channel_id) WHERE group_id IS NOT NULL AND state <> 'cancelled';
`
  },
  {
    id: 305,
    name: 'pipeline: the content mix and the owner\'s notes for own updates (DEC-033)',
    sql: `
-- A note the owner wrote about something they did. An own-update draft is written from one unused note and from nothing else.
CREATE TABLE product_updates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_in_opportunity_id TEXT,
  -- How many times the AI could not make a post from it (it is set aside after a few, so one note never holds the others back).
  failed_tries INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_updates_product ON product_updates(product_id, created_at);

-- When the content mix last prepared a draft of a kind on a channel, and when it last tried (a failed try is not repeated at once).
CREATE TABLE mix_state (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  last_draft_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  PRIMARY KEY (channel_id, kind)
);
`
  }
]
