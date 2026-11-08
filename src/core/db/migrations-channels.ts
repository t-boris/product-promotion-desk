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
  }
]
