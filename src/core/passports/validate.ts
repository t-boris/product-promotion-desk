// Hand-written validators for the JSON the AI engine returns (DEC-005: no schema library). They are strict about
// types and vocabulary, lenient about harmless extras, and their error messages are written for the repair prompt.

import { PASSPORT_SECTIONS, type PassportSection } from '../../shared/types'
import type { Validation, Validator } from './ai-json'

export type RawKind = 'fact' | 'assumption' | 'unknown'

export interface RawClaim {
  section: PassportSection
  kind: RawKind
  text: string
  /** Evidence keys (for example "W1", "D2", "E3") that the application resolves to real sources. */
  evidence: string[]
}

export interface RawConflict {
  /** Claim keys (for example "C1", "C4"). */
  claims: string[]
  description: string
}

const MAX_ITEMS = 120
const MAX_TEXT = 600
const KINDS: RawKind[] = ['fact', 'assumption', 'unknown']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

function listOf(raw: unknown, key: string): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (!isRecord(raw)) return fail('the answer must be a JSON object')
  const value = raw[key]
  if (!Array.isArray(value)) return fail(`"${key}" must be an array`)
  return { ok: true, value: value.slice(0, MAX_ITEMS) }
}

function stringList(value: unknown, path: string): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return fail(`${path} must be an array of strings`)
  return { ok: true, value: (value as string[]).map((v) => v.trim()).filter(Boolean) }
}

/** `{ "<key>": [ { section, kind, text, evidence[] } ] }`: used for document/code findings and for the synthesis. */
export function claimListValidator(key: string): Validator<RawClaim[]> {
  return (raw): Validation<RawClaim[]> => {
    const list = listOf(raw, key)
    if (!list.ok) return list
    const claims: RawClaim[] = []
    for (const [index, item] of list.value.entries()) {
      const path = `${key}[${index}]`
      if (!isRecord(item)) return fail(`${path} must be an object`)
      const section = typeof item.section === 'string' ? item.section.trim().toLowerCase() : ''
      if (!(PASSPORT_SECTIONS as string[]).includes(section)) {
        return fail(`${path}.section must be one of ${PASSPORT_SECTIONS.join(', ')} (got ${JSON.stringify(item.section)})`)
      }
      const kind = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : ''
      if (!(KINDS as string[]).includes(kind)) return fail(`${path}.kind must be one of ${KINDS.join(', ')} (got ${JSON.stringify(item.kind)})`)
      if (typeof item.text !== 'string') return fail(`${path}.text must be a string`)
      const text = item.text.replace(/\s+/g, ' ').trim()
      if (!text) continue
      const evidence = stringList(item.evidence, `${path}.evidence`)
      if (!evidence.ok) return evidence
      claims.push({ section: section as PassportSection, kind: kind as RawKind, text: text.slice(0, MAX_TEXT), evidence: evidence.value })
    }
    return { ok: true, value: claims }
  }
}

/** `{ "conflicts": [ { claims: ["C1","C2"], description } ] }` */
export const validateConflicts: Validator<RawConflict[]> = (raw) => {
  const list = listOf(raw, 'conflicts')
  if (!list.ok) return list
  const conflicts: RawConflict[] = []
  for (const [index, item] of list.value.entries()) {
    const path = `conflicts[${index}]`
    if (!isRecord(item)) return fail(`${path} must be an object`)
    const claims = stringList(item.claims, `${path}.claims`)
    if (!claims.ok) return claims
    if (typeof item.description !== 'string') return fail(`${path}.description must be a string`)
    if (new Set(claims.value).size < 2) continue
    conflicts.push({ claims: [...new Set(claims.value)], description: item.description.replace(/\s+/g, ' ').trim().slice(0, 400) })
  }
  return { ok: true, value: conflicts }
}
