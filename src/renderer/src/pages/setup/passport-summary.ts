// What a section of the passport says about itself when it is closed (DEC-037, phase C4): the passport's eight sections are a two-column
// summary, each with its counts and the first statements, and "Edit" opens the section's editor in place. Pure, so the rules are tested
// from src/main/setup-logic.test.ts without the interface.

import type { Claim, ClaimKind, Id, PassportSection } from '../../../../shared/types'
import { KIND_LABELS } from '../products/labels'

/** The most statements a closed section lists; the rest is a count. */
export const PREVIEW_LIMIT = 3

/** A statement set aside by the owner stays in the editor, struck through; the summary does not count it among what the passport says. */
export const isSetAside = (claim: Pick<Claim, 'status'>): boolean => claim.status === 'rejected' || claim.status === 'prohibited'

export interface ClaimPreview {
  id: Id
  text: string
  /** "Unknown", "Assumption" or "Contradiction" before the text; a fact needs no mark. */
  mark: string | null
}

export type SectionTone = 'good' | 'warn' | ''

export interface SectionSummary {
  section: PassportSection
  /** Statements the section says, by what the owner has to do with each; every statement is in exactly one of the six counts. */
  approved: number
  toReview: number
  unknown: number
  conflicts: number
  setAside: number
  /** Approved or waiting for a look: the statements the section holds for now (set-aside ones are not). */
  total: number
  /** The first statements in the order they are stored, never one that was set aside. */
  preview: ClaimPreview[]
  /** How many more statements the section holds than `preview` lists. */
  more: number
  /** Something here waits for the owner: a statement to review, an unknown, a conflict. Amber; all approved is green; empty is quiet. */
  tone: SectionTone
}

const markOf = (kind: ClaimKind): string | null => (kind === 'fact' ? null : KIND_LABELS[kind])

/**
 * One statement counts once, by the first of these that fits: set aside, contradiction, unknown, approved, otherwise to review. A
 * contradiction that is still open is the owner's decision; an unknown has nothing to approve yet.
 */
export function summarizeSection(section: PassportSection, claims: readonly Claim[]): SectionSummary {
  const own = claims.filter((claim) => claim.section === section)
  const counts = { approved: 0, toReview: 0, unknown: 0, conflicts: 0, setAside: 0 }
  for (const claim of own) {
    if (isSetAside(claim)) counts.setAside++
    else if (claim.kind === 'contradiction') counts.conflicts++
    else if (claim.kind === 'unknown') counts.unknown++
    else if (claim.status === 'approved') counts.approved++
    else counts.toReview++
  }
  const held = own.filter((claim) => !isSetAside(claim))
  const total = held.length
  const preview = held.slice(0, PREVIEW_LIMIT).map((claim) => ({ id: claim.id, text: claim.text, mark: markOf(claim.kind) }))
  const waiting = counts.toReview + counts.unknown + counts.conflicts > 0
  return { section, ...counts, total, preview, more: total - preview.length, tone: waiting ? 'warn' : counts.approved > 0 ? 'good' : '' }
}

/** "2 approved · 1 to review", or "Nothing here yet"; set-aside statements are named last so they are not mistaken for gone. */
export function sectionLine(summary: SectionSummary): string {
  const parts = [
    summary.approved > 0 ? `${summary.approved} approved` : null,
    summary.toReview > 0 ? `${summary.toReview} to review` : null,
    summary.unknown > 0 ? `${summary.unknown} unknown` : null,
    summary.conflicts > 0 ? `${summary.conflicts} in conflict` : null,
    summary.setAside > 0 ? `${summary.setAside} set aside` : null
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? 'Nothing here yet' : parts.join(' · ')
}

/** A section with no statement at all: its "Edit" opens the editor with the new-statement form already open. */
export function startsWithForm(summary: SectionSummary): boolean {
  return summary.total === 0 && summary.setAside === 0
}
