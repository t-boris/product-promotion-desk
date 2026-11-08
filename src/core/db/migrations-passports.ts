import type { Migration } from './migrations'

/** passports migrations. Ids must stay inside this area's range (see migrations.ts). */
export const PASSPORT_MIGRATIONS: Migration[] = [
  {
    id: 100,
    name: 'passport version invariants',
    sql: `
-- A claim keeps one row per passport version: a lineage can never appear twice in the same version.
CREATE UNIQUE INDEX idx_claims_version_lineage ON claims(passport_version_id, lineage_id);

-- At most one draft being edited and one approved (active) version per product. Superseded versions are unlimited
-- and immutable, so historical publications keep the knowledge version they used.
CREATE UNIQUE INDEX idx_passport_one_draft ON passport_versions(product_id) WHERE status = 'draft';
CREATE UNIQUE INDEX idx_passport_one_approved ON passport_versions(product_id) WHERE status = 'approved';
`
  }
]
