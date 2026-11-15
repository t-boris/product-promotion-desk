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
  }
]
