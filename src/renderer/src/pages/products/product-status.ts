// What the product list and the product header say about a product, from the same facts the Passport and Analysis tabs use,
// so the three places cannot contradict each other (QA findings 15, 27, 42, 48). Pure, so the words are tested without the interface.

import type { PassportVersion, Product } from '../../../../shared/types'
import type { ProductTab } from '../../route'
import type { Tone } from '../../tone'
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

/** What the owner does next with a product, in the order the work goes; the tab to open for it. */
export function nextProductStep(product: Pick<Product, 'activePassportVersionId' | 'analysisStatus' | 'goals'>): { text: string; tab: ProductTab } {
  if (product.activePassportVersionId === null) {
    return product.analysisStatus === 'idle' ? { text: 'Next: run the analysis', tab: 'analysis' } : { text: 'Next: approve the passport', tab: 'passport' }
  }
  if (product.goals.length === 0) return { text: 'Next: write a goal', tab: 'goal' }
  return { text: 'Next: connect a channel', tab: 'channels' }
}

/** Why a product shows "Not analyzed", in words that say what is missing and where to fix it. */
export const NOT_ANALYZED_HINT = 'The AI has not read this product’s sources yet. Open the Analysis tab to run it, or build the passport by hand.'
