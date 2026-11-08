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
  },
  {
    id: 101,
    name: 'several promotion goals per product (DEC-012)',
    sql: `
-- A product keeps a list of goals. The single goal of earlier versions becomes the first item of the list, with an id.
ALTER TABLE products ADD COLUMN goals_json TEXT NOT NULL DEFAULT '[]';
UPDATE products
   SET goals_json = json_array(json_patch(goal_json, json_object('id', lower(hex(randomblob(16))))))
 WHERE goal_json IS NOT NULL AND json_valid(goal_json) AND json_type(goal_json) = 'object';
ALTER TABLE products DROP COLUMN goal_json;
`
  }
]
