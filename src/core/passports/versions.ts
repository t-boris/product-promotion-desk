// Passport versions (REQ-001): a draft is the only mutable version. Approving it supersedes the previous approved
// version, which is never changed again, so a publication can always point at the exact knowledge it was based on.

import { ApiError } from '../../shared/api'
import type { Claim, Id, PassportVersion } from '../../shared/types'
import { tx, type Db } from '../db/database'
import type { ClaimsRepo } from './claims-repo'
import type { ProductStore } from './store'
import { normalizeForCompare } from './text'

export const isUnresolvedContradiction = (claim: Claim): boolean =>
  claim.kind === 'contradiction' && (claim.status === 'proposed' || claim.status === 'approved')

/**
 * Lineage ids whose use in pending content must be re-reviewed after `previous` (the active version) is replaced by
 * `next`: approved claims whose text changed or that are no longer approved or were deleted, and claims that became
 * prohibited. Newly added claims change nothing for existing content.
 */
export function changedLineages(previous: Claim[], next: Claim[]): Id[] {
  const nextByLineage = new Map(next.map((c) => [c.lineageId, c]))
  const previousByLineage = new Map(previous.map((c) => [c.lineageId, c]))
  const changed = new Set<Id>()
  for (const before of previous) {
    const after = nextByLineage.get(before.lineageId)
    if (before.status === 'approved') {
      if (!after || after.status !== 'approved' || normalizeForCompare(after.text) !== normalizeForCompare(before.text)) {
        changed.add(before.lineageId)
      }
    }
    if (after?.status === 'prohibited' && before.status !== 'prohibited') changed.add(before.lineageId)
  }
  for (const after of next) {
    if (after.status === 'prohibited' && !previousByLineage.has(after.lineageId)) changed.add(after.lineageId)
  }
  return [...changed]
}

export interface ApprovalResult {
  version: PassportVersion
  changedLineageIds: Id[]
}

export class PassportVersions {
  constructor(
    private readonly db: Db,
    private readonly products: ProductStore,
    private readonly repo: ClaimsRepo
  ) {}

  /** The draft being edited. Starting one from an approved passport copies its claims (same lineage, new ids). */
  ensureDraft(productId: Id): PassportVersion {
    const existing = this.repo.draft(productId)
    if (existing) return existing
    return tx(this.db, () => {
      const draft = this.repo.insertVersion(productId, 'draft')
      const active = this.repo.approved(productId)
      if (active) this.repo.copyClaims(active.id, draft.id)
      return draft
    })
  }

  /** The claims the user is looking at: the draft if there is one, otherwise the approved version. */
  working(productId: Id): { version: PassportVersion | null; claims: Claim[] } {
    const version = this.repo.draft(productId) ?? this.repo.approved(productId)
    return { version, claims: version ? this.repo.claims(version.id) : [] }
  }

  approve(productId: Id): ApprovalResult {
    const draft = this.repo.draft(productId)
    if (!draft) throw new ApiError('no_draft', 'There are no unapproved changes. Edit a claim to start a new version.')
    const claims = this.repo.claims(draft.id)
    const unresolved = claims.filter(isUnresolvedContradiction)
    if (unresolved.length > 0) {
      throw new ApiError(
        'unresolved_contradictions',
        `${unresolved.length} contradiction${unresolved.length === 1 ? '' : 's'} must be resolved first: reject it, edit it into a fact, or remove it.`
      )
    }
    if (!claims.some((c) => c.status === 'approved')) {
      throw new ApiError('nothing_to_approve', 'Approve at least one claim before approving the passport.')
    }
    const previous = this.repo.approved(productId)
    const changedLineageIds = previous ? changedLineages(this.repo.claims(previous.id), claims) : []
    tx(this.db, () => {
      // The previous version is superseded first: only one approved version may exist per product.
      if (previous) this.repo.setVersionStatus(previous.id, 'superseded')
      this.repo.setVersionStatus(draft.id, 'approved')
      this.products.setActiveVersion(productId, draft.id)
    })
    return { version: this.repo.version(draft.id) as PassportVersion, changedLineageIds }
  }
}
