// Why an "AI helps here" control cannot be used, in plain words, and where to fix it. Pure, so the words are tested without the
// interface (BUG-009, QA finding 47). Every AI help has the same two reasons: no ready engine, and, for the helps that fit the
// passport, no approved passport. The helps that come before the passport (a first description, a goal) ask for an engine only.

import { productHref } from '../route'

export interface BlockFacts {
  /** The product the help is for; without one, the passport is never asked for. */
  productId?: string
  /** True for the helps that need the owner's approved passport (channel ideas, roles, the plan). */
  needsPassport: boolean
  /** Null while the product is still loading. */
  approved: boolean | null
  engineId: string | null | undefined
  engines: { id: string; ready: boolean; detail: string; label: string }[] | undefined
  /** False until the settings and the engines have arrived: nothing is blocked on a guess. */
  ready: boolean
  /**
   * False for a control that is repeated many times on a screen (the editor of every open card): it only says that no engine is chosen. Whether the
   * chosen engine is installed and ready is not asked (that check starts the engine's program); the refusal after the press says it.
   */
  checkReady?: boolean
}

export interface Blocked {
  text: string
  /** The one place that removes the reason. */
  fix: { label: string; href: string }
}

export function assistBlock(facts: BlockFacts): Blocked | null {
  if (facts.needsPassport && facts.productId && facts.approved === false) {
    return { text: 'Approve the product passport first so the suggestions fit it.', fix: { label: 'Open the Passport tab', href: productHref(facts.productId, 'passport') } }
  }
  if (!facts.ready) return null
  if (!facts.engineId) return { text: 'Choose an AI engine in Settings first.', fix: { label: 'Open Settings', href: '#/settings' } }
  if (facts.checkReady === false) return null
  const engine = facts.engines?.find((e) => e.id === facts.engineId)
  if (!engine || !engine.ready) {
    return { text: engine?.detail || `${engine?.label ?? 'The selected AI engine'} is not available. Check it in Settings.`, fix: { label: 'Open Settings', href: '#/settings' } }
  }
  return null
}
