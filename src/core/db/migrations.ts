// Ordered, append-only schema migrations. Never edit a shipped migration; add a new one.

export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Products and passports (REQ-001)
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT,
  description TEXT,
  goal_json TEXT,
  active_passport_version_id TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_sources (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  label TEXT NOT NULL,
  scope_json TEXT,
  added_at TEXT NOT NULL
);
CREATE INDEX idx_sources_product ON product_sources(product_id);

-- Completed analysis stages are kept so an interrupted analysis resumes where it stopped.
CREATE TABLE analysis_stages (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  output_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, name)
);

CREATE TABLE passport_versions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE (product_id, version)
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  passport_version_id TEXT NOT NULL REFERENCES passport_versions(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  verified_at TEXT,
  unconfirmed_availability INTEGER NOT NULL DEFAULT 0,
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_claims_version ON claims(passport_version_id);
CREATE INDEX idx_claims_lineage ON claims(lineage_id);

-- Accounts, channels (REQ-002)
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  identity TEXT,
  partition TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'login_required',
  created_at TEXT NOT NULL
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  target TEXT NOT NULL,
  url TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'observe',
  settings_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'setup',
  status_detail TEXT NOT NULL DEFAULT '',
  baseline_done_at TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, account_id, target)
);

-- Declarative profiles of the universal connector: validated and versioned, never executable code.
CREATE TABLE connector_profiles (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  valid INTEGER NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (host, version)
);

-- Discussions and opportunities (REQ-003)
CREATE TABLE discussions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (channel_id, external_id)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  parent_external_id TEXT,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  posted_at TEXT,
  baseline INTEGER NOT NULL DEFAULT 0,
  is_own INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (channel_id, external_id)
);
CREATE INDEX idx_comments_discussion ON comments(discussion_id);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
  discussion_id TEXT REFERENCES discussions(id) ON DELETE SET NULL,
  category TEXT,
  decision TEXT,
  destination TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_opp_channel_state ON opportunities(channel_id, state);
-- A rediscovered comment updates its record; it can never produce a second opportunity.
CREATE UNIQUE INDEX idx_opp_one_per_comment ON opportunities(comment_id) WHERE comment_id IS NOT NULL;

-- Drafts, approvals, sending (REQ-003, REQ-004)
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  title TEXT,
  text TEXT NOT NULL,
  link TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  knowledge_version_id TEXT,
  used_claims_json TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_drafts_opp ON drafts(opportunity_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  rule_id TEXT,
  approved_at TEXT NOT NULL,
  invalidated_at TEXT,
  invalid_reason TEXT
);
CREATE INDEX idx_approvals_draft ON approvals(draft_id);

CREATE TABLE send_actions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  approval_id TEXT NOT NULL REFERENCES approvals(id),
  content_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  state TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  completed_at TEXT,
  result_url TEXT,
  result_external_id TEXT,
  authorization_basis TEXT NOT NULL,
  knowledge_version_id TEXT,
  error TEXT
);
CREATE INDEX idx_actions_account_time ON send_actions(account_id, attempted_at);
-- Database-level duplicate guard: at most one attempt per opportunity may be in flight,
-- unresolved ('unknown') or confirmed. Only a definitely-failed attempt allows another one.
CREATE UNIQUE INDEX idx_actions_one_open ON send_actions(opportunity_id)
  WHERE state IN ('sending', 'unknown', 'confirmed');

-- Runs, logs, metrics (REQ-005, REQ-006)
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  channel_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_runs_started ON runs(started_at);

CREATE TABLE log_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  channel_id TEXT
);

CREATE TABLE metric_snapshots (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  value REAL,
  available INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_metrics_channel ON metric_snapshots(channel_id, captured_at);
`
  }
]
