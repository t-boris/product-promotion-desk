// The rules for changing claims (REQ-001): what an edit does to a claim's kind and status, which claims may be
// approved, how an approved passport is edited through a new draft, and how contradictions stay visible until the
// user resolves them. Nothing here picks a version of a conflicting fact on the user's behalf.

import { ApiError } from '../../shared/api'
import type { ClaimInput } from '../../shared/api'
import type { Claim, ClaimKind, ClaimSourceRef, ClaimStatus, Id, PassportSection, PassportVersion } from '../../shared/types'
import { parseClaimInput, isClaimStatus } from './claim-input'
import type { ClaimPatch, ClaimsRepo } from './claims-repo'
import { mentionsPricing } from './pricing'
import type { ProductStore } from './store'
import { normalizeForCompare, truncate } from './text'
import { isUnresolvedContradiction, type PassportVersions } from './versions'

export const MANUAL_ENTRY_REF = 'Entered by the user'
export const MANUAL_EDIT_REF = 'Edited by the user'
/** Sections where a capability or condition found only in source code may not actually be offered to users. */
const AVAILABILITY_SECTIONS: PassportSection[] = ['offer', 'terms']

export interface GeneratedClaim {
  section: PassportSection
  text: string
  kind: Exclude<ClaimKind, 'contradiction'>
  /** Evidence for facts; ignored for assumptions and unknowns. */
  sources: ClaimSourceRef[]
  unconfirmedAvailability: boolean
}

export interface ConflictFinding {
  claimIds: Id[]
  description: string
}

const latest = (sources: ClaimSourceRef[]): string | null => (sources.length === 0 ? null : sources.map((s) => s.verifiedAt).sort().at(-1) ?? null)
const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((id) => b.includes(id))

export class ClaimService {
  constructor(
    private readonly products: ProductStore,
    private readonly repo: ClaimsRepo,
    private readonly versions: PassportVersions,
    private readonly now: () => string
  ) {}

  // ───────────── user operations ─────────────

  save(productId: Id, input: ClaimInput): Claim {
    const parsed = parseClaimInput(input, this.now())
    if (!parsed.id) {
      const draft = this.versions.ensureDraft(productId)
      const claim = this.repo.insertClaim({ passportVersionId: draft.id, status: 'proposed', conflictsWith: [], ...this.shape(productId, null, parsed) })
      this.afterMutation(draft.id)
      return this.repo.claim(claim.id) as Claim
    }
    const original = this.requireClaim(parsed.id)
    if (this.productOf(original) !== productId) throw new ApiError('invalid_input', 'This claim belongs to a different product.')
    const patch = this.shape(productId, original, parsed)
    const textChanged = normalizeForCompare(patch.text) !== normalizeForCompare(original.text)
    // Changing the words of an approved or rejected claim means the user has not yet vouched for the new text.
    const status: ClaimStatus = textChanged && (original.status === 'approved' || original.status === 'rejected') ? 'proposed' : original.status
    // Links to the claims this one contradicted end when the contradiction itself is edited into something else.
    const next: ClaimPatch = { ...patch, status, ...(original.kind === 'contradiction' ? { conflictsWith: [] } : {}) }
    if (!this.differs(original, next)) return original
    const { claim: target, version } = this.editable(original)
    const updated = this.repo.updateClaim(target.id, next)
    this.afterMutation(version.id)
    return this.repo.claim(updated.id) as Claim
  }

  setStatus(claimId: Id, status: ClaimStatus): Claim {
    if (!isClaimStatus(status)) throw new ApiError('invalid_input', `Unknown claim status: ${String(status)}`)
    const original = this.requireClaim(claimId)
    if (status === 'approved') this.assertApprovable(original)
    if (original.status === status) return original
    const { claim: target, version } = this.editable(original)
    const updated = this.repo.updateClaim(target.id, { status })
    this.afterMutation(version.id)
    return this.repo.claim(updated.id) as Claim
  }

  remove(claimId: Id): void {
    const original = this.requireClaim(claimId)
    const { claim: target, version } = this.editable(original)
    this.repo.deleteClaim(target.id)
    this.afterMutation(version.id)
  }

  // ───────────── operations of the analysis ─────────────

  /** Adds claims the analysis proposes. Claims already in the passport (any status) are not added again. */
  addGenerated(productId: Id, generated: GeneratedClaim[]): { added: Claim[]; skipped: number } {
    const known = new Set(this.versions.working(productId).claims.map((c) => `${c.section}|${normalizeForCompare(c.text)}`))
    const fresh: GeneratedClaim[] = []
    for (const claim of generated) {
      const key = `${claim.section}|${normalizeForCompare(claim.text)}`
      if (known.has(key)) continue
      known.add(key)
      fresh.push(claim)
    }
    if (fresh.length === 0) return { added: [], skipped: generated.length }
    const draft = this.versions.ensureDraft(productId)
    const added = fresh.map((claim) =>
      this.repo.insertClaim({
        passportVersionId: draft.id,
        section: claim.section,
        text: claim.text,
        kind: claim.kind,
        status: 'proposed',
        sources: claim.kind === 'fact' ? claim.sources : [],
        verifiedAt: claim.kind === 'fact' ? latest(claim.sources) : null,
        unconfirmedAvailability: claim.unconfirmedAvailability,
        conflictsWith: []
      })
    )
    this.afterMutation(draft.id)
    return { added, skipped: generated.length - fresh.length }
  }

  /** Records conflicts between existing claims as 'contradiction' claims. Known conflicts are never duplicated. */
  addContradictions(productId: Id, findings: ConflictFinding[]): Claim[] {
    const { version, claims } = this.versions.working(productId)
    if (!version) return []
    const alive = new Map(claims.filter((c) => c.kind !== 'contradiction').map((c) => [c.id, c]))
    const known = new Set(claims.filter((c) => c.kind === 'contradiction').map((c) => [...c.conflictsWith].sort().join('|')))
    const fresh: { ids: Id[]; description: string; section: PassportSection }[] = []
    for (const finding of findings) {
      const ids = [...new Set(finding.claimIds)].filter((id) => alive.has(id))
      const key = [...ids].sort().join('|')
      if (ids.length < 2 || known.has(key)) continue
      known.add(key)
      fresh.push({ ids, description: finding.description, section: (alive.get(ids[0]) as Claim).section })
    }
    if (fresh.length === 0) return []
    const draft = this.versions.ensureDraft(productId)
    // The working version may have been an approved one: map its claim ids to the draft's copies by lineage.
    const toDraftId = (id: Id): Id | null => {
      if (version.id === draft.id) return id
      const lineage = alive.get(id)?.lineageId
      return lineage ? (this.repo.claimByLineage(draft.id, lineage)?.id ?? null) : null
    }
    const created: Claim[] = []
    for (const item of fresh) {
      const ids = item.ids.map(toDraftId).filter((id): id is Id => id !== null)
      if (ids.length < 2) continue
      created.push(
        this.repo.insertClaim({
          passportVersionId: draft.id,
          section: item.section,
          text: truncate(`Sources disagree: ${item.description}`, 600),
          kind: 'contradiction',
          status: 'proposed',
          sources: [],
          verifiedAt: null,
          unconfirmedAvailability: false,
          conflictsWith: ids
        })
      )
    }
    this.afterMutation(draft.id)
    return created
  }

  // ───────────── rules ─────────────

  /** Approval means "this text may be used in publications"; some claims can never qualify. */
  private assertApprovable(claim: Claim): void {
    if (claim.kind === 'unknown') {
      throw new ApiError('claim_not_usable', 'Unknown information cannot be approved. Provide it first (Edit), or leave it unknown.')
    }
    if (claim.kind === 'contradiction') {
      throw new ApiError('claim_not_usable', 'A contradiction cannot be approved. Resolve it: edit it into a fact, or reject it.')
    }
    if (claim.kind !== 'fact' && claim.section === 'terms' && mentionsPricing(claim.text)) {
      throw new ApiError('claim_not_usable', 'Prices and free-of-charge statements need a verified source before they can be used. Edit the claim and add the source, or leave it unapproved.')
    }
  }

  /** Computes the new content of a claim from the user's input. `original` is null for a new claim. */
  private shape(productId: Id, original: Claim | null, input: ReturnType<typeof parseClaimInput>): Required<Omit<ClaimPatch, 'status' | 'conflictsWith'>> {
    const now = this.now()
    const text = input.text
    const sourcesGiven = input.sources !== undefined
    let sources = input.sources ?? original?.sources ?? []
    let kind: ClaimKind
    if (input.kind) kind = input.kind
    else if (sourcesGiven && sources.length > 0) kind = 'fact'
    else if (!original) kind = 'fact'
    else if (original.kind === 'fact') kind = 'fact'
    else if (original.kind === 'contradiction') kind = sources.length > 0 ? 'fact' : 'assumption'
    else kind = original.kind

    if (kind === 'fact' && sources.length === 0) {
      // The user states this fact themselves (or resolves a contradiction by stating the truth).
      if (input.kind === 'fact' || !original || original.kind === 'contradiction') sources = [{ sourceId: null, ref: MANUAL_ENTRY_REF, verifiedAt: now }]
      else kind = 'assumption'
    } else if (kind === 'fact' && original?.kind === 'fact' && !sourcesGiven && normalizeForCompare(text) !== normalizeForCompare(original.text)) {
      // The wording no longer matches the original evidence verbatim: record that the user edited it, and when.
      sources = [...sources.filter((s) => s.ref !== MANUAL_EDIT_REF), { sourceId: null, ref: MANUAL_EDIT_REF, verifiedAt: now }]
    }
    if (kind !== 'fact') sources = []

    const kinds = new Map(this.products.sources(productId).map((s) => [s.id, s.kind]))
    const isCode = (s: ClaimSourceRef): boolean => s.sourceId !== null && kinds.get(s.sourceId) === 'code_folder'
    let unconfirmedAvailability = original?.unconfirmedAvailability ?? false
    if (sources.some((s) => !isCode(s))) unconfirmedAvailability = false
    else if (sources.length > 0 && AVAILABILITY_SECTIONS.includes(input.section)) unconfirmedAvailability = true

    return {
      section: input.section,
      text,
      kind,
      sources,
      verifiedAt: kind === 'fact' ? latest(sources) : null,
      unconfirmedAvailability
    }
  }

  private differs(original: Claim, next: ClaimPatch): boolean {
    return (
      original.section !== next.section ||
      original.text !== next.text ||
      original.kind !== next.kind ||
      original.status !== next.status ||
      original.unconfirmedAvailability !== next.unconfirmedAvailability ||
      JSON.stringify(original.sources) !== JSON.stringify(next.sources)
    )
  }

  // ───────────── drafts ─────────────

  private requireClaim(id: Id): Claim {
    const claim = this.repo.claim(id)
    if (!claim) throw new ApiError('not_found', 'This claim no longer exists.')
    return claim
  }

  private productOf(claim: Claim): Id {
    return (this.repo.version(claim.passportVersionId) as PassportVersion).productId
  }

  /**
   * The claim to modify. Claims of the draft are changed in place. A claim of the approved passport is never
   * changed: the change goes to the same claim (by lineage) in a draft, which is started on demand.
   */
  private editable(claim: Claim): { claim: Claim; version: PassportVersion } {
    const version = this.repo.version(claim.passportVersionId) as PassportVersion
    if (version.status === 'draft') return { claim, version }
    if (version.status === 'approved') {
      const draft = this.versions.ensureDraft(version.productId)
      const copy = this.repo.claimByLineage(draft.id, claim.lineageId)
      if (!copy) throw new ApiError('not_found', 'This claim was already removed in the draft.')
      return { claim: copy, version: draft }
    }
    throw new ApiError('read_only', 'This claim belongs to an older, superseded version and cannot be changed. Open the current passport.')
  }

  /** Keeps conflict links consistent after any change to the claims of `versionId`. */
  private afterMutation(versionId: Id): void {
    const claims = this.repo.claims(versionId)
    const alive = new Set(claims.map((c) => c.id))
    // A contradiction that lost its claims is gone: nothing conflicts any more. Resolved ones stay as a record.
    for (const claim of claims.filter((c) => c.kind === 'contradiction')) {
      const peers = claim.conflictsWith.filter((id) => alive.has(id))
      if (peers.length < 2 && isUnresolvedContradiction(claim)) {
        this.repo.deleteClaim(claim.id)
        alive.delete(claim.id)
      } else if (peers.length !== claim.conflictsWith.length) {
        this.repo.updateClaim(claim.id, { conflictsWith: peers })
      }
    }
    // Claims point at each other only while an unresolved contradiction links them.
    const links = new Map<Id, Set<Id>>()
    for (const claim of this.repo.claims(versionId).filter(isUnresolvedContradiction)) {
      for (const a of claim.conflictsWith) {
        for (const b of claim.conflictsWith) {
          if (a === b) continue
          const set = links.get(a) ?? new Set<Id>()
          set.add(b)
          links.set(a, set)
        }
      }
    }
    for (const claim of this.repo.claims(versionId)) {
      if (claim.kind === 'contradiction') continue
      const wanted = [...(links.get(claim.id) ?? [])]
      if (!sameSet(wanted, claim.conflictsWith)) this.repo.updateClaim(claim.id, { conflictsWith: wanted })
    }
  }
}
