// Validation of claim input coming from the UI. Everything crossing the API boundary is untrusted.

import { ApiError } from '../../shared/api'
import type { ClaimInput } from '../../shared/api'
import { PASSPORT_SECTIONS, type ClaimKind, type ClaimSourceRef, type ClaimStatus, type PassportSection } from '../../shared/types'

export const MAX_CLAIM_TEXT = 2000
export const CLAIM_STATUSES: ClaimStatus[] = ['proposed', 'approved', 'rejected', 'prohibited']
const USER_KINDS: ClaimKind[] = ['fact', 'assumption', 'unknown']

export interface ParsedClaimInput {
  id?: string
  section: PassportSection
  text: string
  /** Only fact, assumption or unknown can be chosen by the user; contradictions are created by the analysis. */
  kind?: ClaimKind
  sources?: ClaimSourceRef[]
}

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === 'string' && (CLAIM_STATUSES as string[]).includes(value)
}

function parseSources(raw: unknown, now: string): ClaimSourceRef[] {
  if (!Array.isArray(raw)) throw new ApiError('invalid_input', 'Sources must be a list.')
  return raw.slice(0, 20).map((item): ClaimSourceRef => {
    const entry = (item ?? {}) as Partial<ClaimSourceRef>
    const ref = typeof entry.ref === 'string' ? entry.ref.trim().slice(0, 500) : ''
    if (!ref) throw new ApiError('invalid_input', 'Every source needs a reference (a link, file or note).')
    const verified = typeof entry.verifiedAt === 'string' ? new Date(entry.verifiedAt) : null
    return {
      sourceId: typeof entry.sourceId === 'string' ? entry.sourceId : null,
      ref,
      verifiedAt: verified && !Number.isNaN(verified.getTime()) ? verified.toISOString() : now
    }
  })
}

export function parseClaimInput(raw: ClaimInput, now: string): ParsedClaimInput {
  if (!raw || typeof raw !== 'object') throw new ApiError('invalid_input', 'The claim is missing.')
  if (!PASSPORT_SECTIONS.includes(raw.section)) throw new ApiError('invalid_input', `Unknown passport section: ${String(raw.section)}`)
  const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim() : ''
  if (!text) throw new ApiError('invalid_input', 'The claim text is empty.')
  if (text.length > MAX_CLAIM_TEXT) throw new ApiError('invalid_input', `The claim is too long (limit ${MAX_CLAIM_TEXT} characters).`)
  const kind = raw.kind !== undefined && (USER_KINDS as string[]).includes(raw.kind) ? raw.kind : undefined
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    section: raw.section,
    text,
    kind,
    sources: raw.sources === undefined ? undefined : parseSources(raw.sources, now)
  }
}
