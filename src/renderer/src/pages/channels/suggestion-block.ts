// Why the "with AI" buttons of a product that fit its passport (roles, channels, the plan) cannot be used. The rule is the shared one
// (assist/block.ts) with the passport required.

import { assistBlock, type Blocked } from '../../assist/block'

export type { Blocked }

export interface BlockFacts {
  productId: string
  /** Null while the product is still loading. */
  approved: boolean | null
  engineId: string | null | undefined
  engines: { id: string; ready: boolean; detail: string; label: string }[] | undefined
  /** False until the settings and the engines have arrived: nothing is blocked on a guess. */
  ready: boolean
}

export function suggestionBlock(facts: BlockFacts): Blocked | null {
  return assistBlock({ ...facts, needsPassport: true })
}
