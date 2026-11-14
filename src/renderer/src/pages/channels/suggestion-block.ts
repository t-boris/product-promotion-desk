// Why the "with AI" buttons of a product (roles, channels, the plan) cannot be used, in plain words, and where to fix it.
// Pure, so the words are tested without the interface (BUG-009, QA finding 47).

import { productHref } from '../../route'

export interface BlockFacts {
  productId: string
  /** Null while the product is still loading. */
  approved: boolean | null
  engineId: string | null | undefined
  engines: { id: string; ready: boolean; detail: string; label: string }[] | undefined
  /** False until the settings and the engines have arrived: nothing is blocked on a guess. */
  ready: boolean
}

export interface Blocked {
  text: string
  /** The one place that removes the reason. */
  fix: { label: string; href: string }
}

export function suggestionBlock(facts: BlockFacts): Blocked | null {
  if (facts.approved === false) {
    return { text: 'Approve the product passport first so the suggestions fit it.', fix: { label: 'Open the Passport tab', href: productHref(facts.productId, 'passport') } }
  }
  if (!facts.ready) return null
  if (!facts.engineId) return { text: 'Choose an AI engine in Settings first.', fix: { label: 'Open Settings', href: '#/settings' } }
  const engine = facts.engines?.find((e) => e.id === facts.engineId)
  if (!engine || !engine.ready) {
    return { text: engine?.detail || `${engine?.label ?? 'The selected AI engine'} is not available. Check it in Settings.`, fix: { label: 'Open Settings', href: '#/settings' } }
  }
  return null
}
