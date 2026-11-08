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
  }
]
