// SQL for passport versions and claims. No business rules here; those live in versions.ts and claim-service.ts.

import type { Claim, ClaimKind, ClaimSourceRef, ClaimStatus, Id, PassportSection, PassportVersion, PassportStatus } from '../../shared/types'
import { newId, toJson, type Db } from '../db/database'
import type { Clock } from '../ports'
import { mapClaim, mapPassportVersion } from '../repos'

type Row = Record<string, unknown>

export interface NewClaim {
  lineageId?: Id
  passportVersionId: Id
  section: PassportSection
  text: string
  kind: ClaimKind
  status: ClaimStatus
  sources: ClaimSourceRef[]
  verifiedAt: string | null
  unconfirmedAvailability: boolean
  conflictsWith: Id[]
}

export type ClaimPatch = Partial<Pick<Claim, 'section' | 'text' | 'kind' | 'status' | 'sources' | 'verifiedAt' | 'unconfirmedAvailability' | 'conflictsWith'>>

export class ClaimsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock
  ) {}

  private now(): string {
    return this.clock.now().toISOString()
  }

  // ───────────── versions ─────────────

  versions(productId: Id): PassportVersion[] {
    return (this.db.prepare('SELECT * FROM passport_versions WHERE product_id = ? ORDER BY version DESC').all(productId) as Row[]).map(mapPassportVersion)
  }

  version(id: Id): PassportVersion | null {
    const row = this.db.prepare('SELECT * FROM passport_versions WHERE id = ?').get(id) as Row | undefined
    return row ? mapPassportVersion(row) : null
  }

  private byStatus(productId: Id, status: PassportStatus): PassportVersion | null {
    const row = this.db.prepare('SELECT * FROM passport_versions WHERE product_id = ? AND status = ?').get(productId, status) as Row | undefined
    return row ? mapPassportVersion(row) : null
  }

  draft(productId: Id): PassportVersion | null {
    return this.byStatus(productId, 'draft')
  }

  approved(productId: Id): PassportVersion | null {
    return this.byStatus(productId, 'approved')
  }

  insertVersion(productId: Id, status: PassportStatus): PassportVersion {
    const id = newId()
    const next = (this.db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM passport_versions WHERE product_id = ?').get(productId) as { n: number }).n
    this.db
      .prepare('INSERT INTO passport_versions (id, product_id, version, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, productId, next, status, this.now())
    return this.version(id) as PassportVersion
  }

  setVersionStatus(id: Id, status: PassportStatus): void {
    this.db
      .prepare('UPDATE passport_versions SET status = ?, approved_at = CASE WHEN ? = \'approved\' THEN ? ELSE approved_at END WHERE id = ?')
      .run(status, status, this.now(), id)
  }

  // ───────────── claims ─────────────

  claims(versionId: Id): Claim[] {
    return (this.db.prepare('SELECT * FROM claims WHERE passport_version_id = ? ORDER BY rowid').all(versionId) as Row[]).map(mapClaim)
  }

  claim(id: Id): Claim | null {
    const row = this.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as Row | undefined
    return row ? mapClaim(row) : null
  }

  claimByLineage(versionId: Id, lineageId: Id): Claim | null {
    const row = this.db.prepare('SELECT * FROM claims WHERE passport_version_id = ? AND lineage_id = ?').get(versionId, lineageId) as Row | undefined
    return row ? mapClaim(row) : null
  }

  insertClaim(input: NewClaim): Claim {
    const id = newId()
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO claims (id, lineage_id, passport_version_id, section, text, kind, status, sources_json, verified_at,
           unconfirmed_availability, conflicts_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.lineageId ?? newId(),
        input.passportVersionId,
        input.section,
        input.text,
        input.kind,
        input.status,
        toJson(input.sources),
        input.verifiedAt,
        input.unconfirmedAvailability ? 1 : 0,
        toJson(input.conflictsWith),
        now,
        now
      )
    return this.claim(id) as Claim
  }

  updateClaim(id: Id, patch: ClaimPatch): Claim {
    const current = this.claim(id) as Claim
    const next = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE claims SET section = ?, text = ?, kind = ?, status = ?, sources_json = ?, verified_at = ?,
           unconfirmed_availability = ?, conflicts_json = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        next.section,
        next.text,
        next.kind,
        next.status,
        toJson(next.sources),
        next.verifiedAt,
        next.unconfirmedAvailability ? 1 : 0,
        toJson(next.conflictsWith),
        this.now(),
        id
      )
    return this.claim(id) as Claim
  }

  deleteClaim(id: Id): void {
    this.db.prepare('DELETE FROM claims WHERE id = ?').run(id)
  }

  /** Copies every claim into `toVersionId` with new ids and the same lineage ids. Returns old id -> new id. */
  copyClaims(fromVersionId: Id, toVersionId: Id): Map<Id, Id> {
    const idMap = new Map<Id, Id>()
    const source = this.claims(fromVersionId)
    for (const claim of source) {
      const copy = this.insertClaim({
        lineageId: claim.lineageId,
        passportVersionId: toVersionId,
        section: claim.section,
        text: claim.text,
        kind: claim.kind,
        status: claim.status,
        sources: claim.sources,
        verifiedAt: claim.verifiedAt,
        unconfirmedAvailability: claim.unconfirmedAvailability,
        conflictsWith: []
      })
      idMap.set(claim.id, copy.id)
    }
    // Conflict links point at claim ids, which are new in the copy.
    for (const claim of source) {
      const links = claim.conflictsWith.map((id) => idMap.get(id)).filter((id): id is Id => id !== undefined)
      if (links.length > 0) this.updateClaim(idMap.get(claim.id) as Id, { conflictsWith: links })
    }
    return idMap
  }
}
