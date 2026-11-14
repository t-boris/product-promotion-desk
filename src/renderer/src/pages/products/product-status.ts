// What the product list and the product header say about a product, from the same facts the Passport and Analysis tabs use,
// so the three places cannot contradict each other (QA findings 15, 27, 42, 48). Pure, so the words are tested without the interface.

import type { PassportVersion, Product } from '../../../../shared/types'
import type { Tone } from '../../tone'
import type { LaunchCounts } from './launch-path'
import { summarize } from './model'

export interface StatusLine {
  tone: Tone
  label: string
  /** What is going on beside the badge, kept out of it so the badge stays short in a narrow window. */
  detail?: string
}

/** One line for the passport: approved, approved with a draft waiting, or not approved yet (and how far the draft is). */
export function passportStatus(product: Pick<Product, 'activePassportVersionId'>, version: Pick<PassportVersion, 'status' | 'version'> | null, claims: Parameters<typeof summarize>[0]): StatusLine {
  const approved = product.activePassportVersionId !== null
  const draft = version?.status === 'draft'
  const summary = summarize(claims)
  if (approved && draft) return { tone: 'info', label: 'Passport approved', detail: `Draft in progress: ${summary.proposed} to review` }
  if (approved) return { tone: 'good', label: 'Passport approved' }
  if (draft) return { tone: 'warn', label: 'No approved passport', detail: `Draft: ${summary.approved} approved, ${summary.proposed} to review` }
  return { tone: 'warn', label: 'No approved passport' }
}

/** What the owner does next with a product, in the order of its launch path (BUG-012), from the same counts; null once
 *  the path is complete (an approved publication), when the five dots of the card already say so. */
export function nextProductStep(product: Pick<Product, 'activePassportVersionId' | 'analysisStatus' | 'goals'>, counts: LaunchCounts): string | null {
  if (product.activePassportVersionId === null) return product.analysisStatus === 'idle' ? 'Next: run the analysis' : 'Next: approve the passport'
  if (product.goals.length === 0) return 'Next: write a goal'
  if (counts.channels === 0) return 'Next: connect a channel'
  if (counts.approvedPublications > 0) return null
  return counts.draftPublications > 0 ? 'Next: approve a draft' : 'Next: write a publication'
}

/** Why a product shows "Not analyzed", in words that say what is missing and where to fix it. */
export const NOT_ANALYZED_HINT = 'The AI has not read this product’s sources yet. Open the Analysis tab to run it, or build the passport by hand.'
