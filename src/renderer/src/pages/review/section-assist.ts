// The decisions of "Change a part" in the post editor that need no screen: when a selection can be changed, what the quick words are called, and when the AI's new part may
// still be put in. Pure, so they are tested without the interface (lesson 101).

import type { SectionEditResult, SectionQuick } from '../../../../shared/types'

/** The shortest selection worth asking about, and the longest the application takes (the core refuses more). */
export const MIN_SECTION = 2
export const MAX_SECTION = 6_000
export const MAX_WISH = 600

export interface Range {
  start: number
  end: number
}

/** The selection of the text box as a range, or null when nothing (or only a character) is selected. */
export function rangeOf(start: number | null | undefined, end: number | null | undefined, text: string): Range | null {
  if (start === null || start === undefined || end === null || end === undefined) return null
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(text.length, Math.max(start, end))
  if (to - from < MIN_SECTION || text.slice(from, to).trim() === '') return null
  return { start: from, end: to }
}

export const QUICKS: { value: SectionQuick; label: string; title: string }[] = [
  { value: 'shorter', label: 'Shorter', title: 'Say the same in fewer words' },
  { value: 'longer', label: 'Longer', title: 'Explain it more' },
  { value: 'simpler', label: 'Simpler', title: 'Simpler words and shorter sentences' },
  { value: 'warmer', label: 'Warmer', title: 'A warmer, more personal tone' },
  { value: 'rewrite', label: 'Rewrite', title: 'Say it differently' }
]

/** Why a part cannot be changed right now, in words; null when it can. */
export function changeReason(range: Range | null): string | null {
  if (!range) return 'Select the part of the text you want to change.'
  if (range.end - range.start > MAX_SECTION) return `That is more than ${MAX_SECTION} characters. Select a smaller part.`
  return null
}

/** "214 characters selected", for the line over the buttons. */
export const selectedWord = (range: Range): string => `${range.end - range.start} ${range.end - range.start === 1 ? 'character' : 'characters'} selected`

/** What the AI's part was asked from, so a late answer is put in only where it still fits. */
export interface Asked {
  text: string
  title: string
}

/**
 * The text with the AI's new part in it, and where the new part is, when the text is still exactly what the question was asked from; null when the owner typed meanwhile (typing
 * wins, lesson 84) and the answer would land in the wrong place.
 */
export function applyProposal(now: Asked, asked: Asked, result: Pick<SectionEditResult, 'start' | 'end' | 'replacement'>): { text: string; range: Range } | null {
  if (now.text !== asked.text) return null
  const text = now.text.slice(0, result.start) + result.replacement + now.text.slice(result.end)
  return { text, range: { start: result.start, end: result.start + result.replacement.length } }
}

/** The part of the text a proposal replaces, as the owner sees it in the "Now" box. */
export const oldPart = (text: string, result: Pick<SectionEditResult, 'start' | 'end'>): string => text.slice(result.start, result.end).trim()
/** The new part as the owner sees it in the other box. */
export const newPart = (result: Pick<SectionEditResult, 'replacement'>): string => result.replacement.trim()
