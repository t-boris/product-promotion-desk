// What the product list and the product header say about a product, from the same facts the Passport and Analysis tabs use,
// so the three places cannot contradict each other (QA findings 15, 27, 42, 48). Pure, so the words are tested without the interface.

import type { PassportVersion, Product } from '../../../../shared/types'
import type { Tone } from '../../tone'
import { nextStage, type LaunchStage } from './launch-path'
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

/**
 * What the owner does next with a product, as the row of the product list says it: the next stage of its launch path (BUG-012) in the
 * words of the stage's action, "Next: build the passport". Null once the path is complete, when the five dots of the card already say so.
 * The row takes the stage from the path and has no rule of its own, so it cannot disagree with the header path, the checklist of Getting
 * started or the accent of a product tab (BUG-064).
 */
export function nextProductStep(stages: LaunchStage[]): string | null {
  const next = nextStage(stages)
  return next ? `Next: ${next.action.charAt(0).toLowerCase()}${next.action.slice(1)}` : null
}

/**
 * Why a product cannot be deleted yet: a connected channel has to be removed first, on the Channels tab. Asked before the confirm, so the
 * owner is never asked "This cannot be undone" for a delete that the core then refuses (BUG-046). Null when nothing stands in the way.
 */
export function deleteBlocker(channelCount: number): string | null {
  if (channelCount <= 0) return null
  const one = channelCount === 1
  return `This product still has ${channelCount} connected ${one ? 'channel' : 'channels'}. Remove ${one ? 'it' : 'them'} on the Channels tab first.`
}

/**
 * The website of a product as a row of the list shows it: the host (and a port), without the scheme, "www." or a path, so it fits
 * the narrow list; the full address goes in the row's tooltip (BUG-062). Text that is not an address is kept as it is.
 */
export function websiteHost(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./i, '')
    return host || url
  } catch {
    return url
  }
}

/** Why a product shows "Not analyzed", in words that say what is missing and where to fix it. */
export const NOT_ANALYZED_HINT = 'The AI has not read this product’s sources yet. Open the Analysis tab to run it, or build the passport by hand.'
