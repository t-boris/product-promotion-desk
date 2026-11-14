// Pure helpers for the Products page. Kept free of React so the rules shown to the user are easy to read in one place.

import { PASSPORT_SECTIONS, type Claim, type PassportSection, type PassportView, type SourceScope } from '../../../../shared/types'

/** Claims of the shown passport grouped by section, in the fixed section order. */
export function groupBySection(claims: Claim[]): Record<PassportSection, Claim[]> {
  const grouped = Object.fromEntries(PASSPORT_SECTIONS.map((s) => [s, [] as Claim[]])) as Record<PassportSection, Claim[]>
  for (const claim of claims) grouped[claim.section].push(claim)
  return grouped
}

/** A contradiction that still blocks approval: not yet rejected or prohibited by the user. */
export const isUnresolved = (claim: Claim): boolean => claim.kind === 'contradiction' && (claim.status === 'proposed' || claim.status === 'approved')

export interface PassportSummary {
  total: number
  approved: number
  proposed: number
  unresolvedContradictions: number
  unconfirmed: number
}

export function summarize(claims: Claim[]): PassportSummary {
  return {
    total: claims.length,
    approved: claims.filter((c) => c.status === 'approved').length,
    proposed: claims.filter((c) => c.status === 'proposed').length,
    unresolvedContradictions: claims.filter(isUnresolved).length,
    unconfirmed: claims.filter((c) => c.unconfirmedAvailability && c.status !== 'rejected').length
  }
}

/** Why the passport cannot be approved right now, or null when it can. The core enforces the same rules. */
export function approvalBlocker(view: PassportView): string | null {
  if (view.version?.status !== 'draft') return 'There are no changes to approve.'
  const summary = summarize(view.claims)
  if (summary.unresolvedContradictions > 0) {
    return `Resolve ${summary.unresolvedContradictions} contradiction${summary.unresolvedContradictions === 1 ? '' : 's'} first: edit it into one statement, or reject it once you have decided.`
  }
  if (summary.approved === 0) return 'Approve at least one statement first.'
  return null
}

/** The claims a contradiction points at, in the order stored. */
export function conflicting(claim: Claim, all: Claim[]): Claim[] {
  return claim.conflictsWith.map((id) => all.find((c) => c.id === id)).filter((c): c is Claim => c !== undefined)
}

/** One entry per non-empty line, trimmed. */
export function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function scopeFromText(include: string, exclude: string): SourceScope | null {
  const scope = { include: lines(include), exclude: lines(exclude) }
  return scope.include.length === 0 && scope.exclude.length === 0 ? null : scope
}

export function describeScope(scope: SourceScope | null): string | null {
  if (!scope) return null
  const parts: string[] = []
  if (scope.include.length > 0) parts.push(`only ${scope.include.join(', ')}`)
  if (scope.exclude.length > 0) parts.push(`without ${scope.exclude.join(', ')}`)
  return parts.length > 0 ? parts.join('; ') : null
}

/**
 * The statements "Approve all proposed" approves: proposed facts and assumptions. It leaves out what needs a look first: an unknown (nothing
 * to approve yet), a contradiction (the owner decides) and a capability found only in the project code (availability not confirmed).
 */
export function approvableClaims(claims: Claim[]): { approve: Claim[]; needLook: Claim[] } {
  const proposed = claims.filter((c) => c.status === 'proposed')
  const approve = proposed.filter((c) => (c.kind === 'fact' || c.kind === 'assumption') && !c.unconfirmedAvailability)
  return { approve, needLook: proposed.filter((c) => !approve.includes(c)) }
}
