// Evidence handling. The AI never writes source references itself: it cites short keys ("W1", "D2", "F3") that were
// handed to it, and the application resolves them to the real source and verification date. A claim can therefore
// only cite what was actually read, and a "fact" without resolvable evidence is demoted to an assumption.

import type { ClaimSourceRef, Id, IsoTime, PassportSection, SourceKind } from '../../shared/types'
import { mentionsPricing, pricingGrounded, PRICE_UNKNOWN_TEXT } from './pricing'
import { normalizeForCompare } from './text'
import type { RawClaim, RawKind } from './validate'

/** Where a statement came from and when the application read that source. */
export interface EvidenceRef {
  sourceId: Id | null
  ref: string
  sourceKind: SourceKind
  verifiedAt: IsoTime
}

/** A claim candidate produced by an analysis stage, with its evidence already resolved. */
export interface Finding {
  section: PassportSection
  kind: RawKind
  text: string
  evidence: EvidenceRef[]
  /** Capability or condition seen only in source code: its availability to users is unconfirmed. */
  unconfirmedAvailability: boolean
}

export const toSourceRef = (e: EvidenceRef): ClaimSourceRef => ({ sourceId: e.sourceId, ref: e.ref, verifiedAt: e.verifiedAt })

const AVAILABILITY_SECTIONS: PassportSection[] = ['offer', 'terms']

export class EvidenceTable {
  private readonly entries = new Map<string, { refs: EvidenceRef[]; text: string }>()

  add(key: string, refs: EvidenceRef[], text: string): void {
    this.entries.set(key, { refs, text })
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  resolve(keys: string[]): { refs: EvidenceRef[]; text: string } {
    const refs: EvidenceRef[] = []
    const seen = new Set<string>()
    const texts: string[] = []
    for (const key of keys) {
      const entry = this.entries.get(key.trim().toUpperCase()) ?? this.entries.get(key.trim())
      if (!entry) continue
      texts.push(entry.text)
      for (const ref of entry.refs) {
        const id = `${ref.sourceId ?? ''}|${ref.ref}`
        if (seen.has(id)) continue
        seen.add(id)
        refs.push(ref)
      }
    }
    return { refs, text: texts.join('\n') }
  }
}

export interface FinalizeResult {
  findings: Finding[]
  /** Human-readable notes about claims that were changed or removed, shown in the stage detail. */
  notes: string[]
}

/**
 * Turns raw AI claims into trustworthy findings:
 *  - evidence keys are resolved to real sources; unknown keys are ignored;
 *  - a "fact" without resolvable evidence becomes an assumption;
 *  - price and "free" statements must be backed by the cited evidence, otherwise they are dropped (never invented);
 *  - a statement backed only by source code is flagged as unconfirmed for users.
 */
export function finalizeClaims(raw: RawClaim[], table: EvidenceTable): FinalizeResult {
  const findings: Finding[] = []
  const notes: string[] = []
  const seen = new Set<string>()
  let demoted = 0
  let droppedPricing = 0
  for (const item of raw) {
    const { refs, text: evidenceText } = table.resolve(item.evidence)
    let kind = item.kind
    if (kind === 'fact' && refs.length === 0) {
      kind = 'assumption'
      demoted++
    }
    if (kind !== 'unknown' && !pricingGrounded(item.text, evidenceText)) {
      droppedPricing++
      continue
    }
    const key = `${item.section}|${normalizeForCompare(item.text)}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({
      section: item.section,
      kind,
      text: item.text,
      evidence: kind === 'unknown' ? [] : refs,
      unconfirmedAvailability: refs.length > 0 && refs.every((r) => r.sourceKind === 'code_folder') && AVAILABILITY_SECTIONS.includes(item.section)
    })
  }
  if (demoted > 0) notes.push(`${demoted} statement${demoted === 1 ? '' : 's'} without a verifiable source ${demoted === 1 ? 'was' : 'were'} marked as assumptions`)
  if (droppedPricing > 0) {
    notes.push(`${droppedPricing} price or free-of-charge statement${droppedPricing === 1 ? '' : 's'} not supported by the sources ${droppedPricing === 1 ? 'was' : 'were'} left out`)
  }
  return { findings, notes }
}

/**
 * Makes sure the passport says plainly when the price is not known, so an unknown price can never silently become an
 * advertised one. Adds an 'unknown' claim unless a verified pricing statement or an unknown-price note already exists.
 */
export function withPriceBackstop(findings: Finding[], existing: { section: PassportSection; kind: string; text: string }[]): Finding[] {
  const covers = (c: { section: PassportSection; kind: string; text: string }): boolean =>
    c.section === 'terms' && (c.kind === 'fact' || c.kind === 'unknown') && mentionsPricing(c.text)
  if (findings.some(covers) || existing.some(covers)) return findings
  return [...findings, { section: 'terms', kind: 'unknown', text: PRICE_UNKNOWN_TEXT, evidence: [], unconfirmedAvailability: false }]
}
