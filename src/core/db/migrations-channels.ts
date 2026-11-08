import type { Migration } from './migrations'

/** channels migrations. Ids must stay inside this area's range (see migrations.ts). */
export const CHANNEL_MIGRATIONS: Migration[] = [
  {
    id: 200,
    name: 'channels: accounts belong to a product (DEC-009)',
    sql: `
-- Each product has its own login per platform. NULL means "not assigned": an account that predates this change and
-- has no channel to infer a product from. Deleting a product leaves its logins in place, unassigned.
ALTER TABLE accounts ADD COLUMN product_id TEXT REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX idx_accounts_product ON accounts(product_id);

-- Legacy accounts: the product of the earliest channel that uses the account. An account that served several
-- products stays shared in effect (the other products keep their channels); one without channels stays NULL.
UPDATE accounts SET product_id = (
  SELECT c.product_id FROM channels c WHERE c.account_id = accounts.id ORDER BY c.created_at, c.rowid LIMIT 1
);
`
  },
  {
    id: 201,
    name: 'channels: accounts remember the last signed-in identity',
    sql: `
-- A logout clears accounts.identity but not this column, so a later sign-in as somebody else is still recognized as
-- a change of account. It is internal and not part of the Account the interface sees.
ALTER TABLE accounts ADD COLUMN last_identity TEXT;
UPDATE accounts SET last_identity = identity WHERE identity IS NOT NULL;
`
  },
  {
    id: 202,
    name: 'channels: logins may have a role with its own voice (DEC-010)',
    sql: `
-- A role is a short name plus a voice (how the login writes, what it may talk about). Both are NULL for a login
-- without a role; the shared Account shows role = null when role_name is empty.
ALTER TABLE accounts ADD COLUMN role_name TEXT;
ALTER TABLE accounts ADD COLUMN role_voice TEXT;
`
  },
  {
    id: 203,
    name: 'channels: what the AI proposed to do on the channel (DEC-013)',
    sql: `
-- The plan is advice kept as JSON; nothing in it is executed. NULL until the owner asks for one.
ALTER TABLE channels ADD COLUMN plan_json TEXT;
`
  },
  {
    id: 204,
    name: 'channels: sign-in name and last sign-in attempt of an account (DEC-014)',
    sql: `
-- The login name is not a secret. The password is never in the database: it lives in the vault file, encrypted by the
-- system keychain. last_login_attempt_at limits automatic sign-ins to one per account per hour.
ALTER TABLE accounts ADD COLUMN login_name TEXT;
ALTER TABLE accounts ADD COLUMN last_login_attempt_at TEXT;
`
  },
  {
    id: 205,
    name: 'channels: accounts are one library with an e-mail address each; base mailboxes (DEC-015)',
    sql: `
-- accounts.product_id stays as information about the product an account was first created for; it restricts nothing.
-- email is the address the account signs up with; mailbox_id is the base mailbox it was proposed from (or NULL).
ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN mailbox_id TEXT;
-- A base mailbox: an ordinary mailbox of the owner from which addresses for accounts are made. Its IMAP connection comes later.
CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'existing',
  created_at TEXT NOT NULL
);
`
  },
  {
    id: 206,
    name: 'channels: the profile of an account, proposed by the AI and approved by the owner (DEC-019)',
    sql: `
-- One row per account. The password is never here (the vault). The picture is a file in the data folder, only its existence is recorded.
CREATE TABLE account_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'other',
  place TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  picture_idea TEXT NOT NULL DEFAULT '',
  reasons_json TEXT NOT NULL DEFAULT '{}',
  picture_file TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  updated_at TEXT NOT NULL
);
`
  },
  {
    id: 207,
    name: 'channels: a profile is its own entity; accounts are its logins on platforms (DEC-019)',
    sql: `
-- A profile is a person made once for a purpose. Its accounts (logins on platforms) point to it; at most one account per platform for a profile.
-- The password is never here (the vault). The picture is a file in the data folder, only its name is recorded.
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  role_name TEXT,
  role_voice TEXT,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  purpose TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'other',
  place TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  picture_idea TEXT NOT NULL DEFAULT '',
  reasons_json TEXT NOT NULL DEFAULT '{}',
  picture_file TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE accounts ADD COLUMN profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX accounts_profile_platform ON accounts(profile_id, platform) WHERE profile_id IS NOT NULL;

-- 0.5.0 kept the profile inside the account: each such row becomes a profile of its own, using the account id as the profile id (so the picture folder stays valid).
INSERT INTO profiles (id, label, product_id, role_name, role_voice, platforms_json, purpose, strategy, first_name, last_name, display_name, username, birth_date, gender, place, about, website, picture_idea, reasons_json, picture_file, status, created_at, updated_at)
SELECT a.id, CASE WHEN p.display_name != '' THEN p.display_name ELSE a.label END, a.product_id, a.role_name, a.role_voice, json_array(a.platform), p.purpose, p.strategy, p.first_name, p.last_name, p.display_name, p.username, p.birth_date, p.gender, p.place, p.about, p.website, p.picture_idea, p.reasons_json, p.picture_file, p.status, a.created_at, p.updated_at
FROM account_profiles p JOIN accounts a ON a.id = p.account_id;
UPDATE accounts SET profile_id = id WHERE id IN (SELECT account_id FROM account_profiles);
DROP TABLE account_profiles;
`
  },
  {
    id: 208,
    name: 'channels: what the AI learned from the owner (lessons for the next missions)',
    sql: `
-- A rule kept from the owner's answer. platform NULL means every platform. The question and the answer are only the source of the rule.
CREATE TABLE agent_lessons (
  id TEXT PRIMARY KEY,
  platform TEXT,
  rule TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX agent_lessons_platform ON agent_lessons(platform);
`
  }
]
