import { useCallback, useState } from 'react'
import type { Id, OpportunityState } from '../../../../shared/types'
import { LOCKED_STATES } from './labels'

/** The one action a review card offers as its main one: it is never an AI helper, and a card in a final state offers none. */
export type MainAction = 'reconcile' | 'send' | 'approve'

/**
 * What a card's main action is, by the state of the item (the same rules the buttons follow): checking an unknown result, sending
 * an approved and unchanged item, approving (or saving and approving) anything else that can still be worked on. Null when the
 * item is out, in flight, being prepared or rejected.
 */
export function mainActionOf(state: OpportunityState, dirty: boolean): MainAction | null {
  if (state === 'unknown_result') return 'reconcile'
  if (LOCKED_STATES.includes(state) || state === 'analyzing' || state === 'cancelled') return null
  return state === 'ready' && !dirty ? 'send' : 'approve'
}

/**
 * Who owns the filled button: the first id of `order` that offers a main action. Pure, so the rule is tested without the interface; a group
 * and a card are the same here.
 */
export function mainOwner(order: readonly Id[], offering: ReadonlySet<Id>): Id | undefined {
  return order.find((id) => offering.has(id))
}

/**
 * One filled button per screen (visual-system.md §10): in a list of review cards it belongs to the first card, in list order, that
 * offers a main action. The cards say whether they do (`offer`); every other card shows the same action as a secondary button.
 * `order` is the ids of the cards as the list shows them. A group of versions (DEC-032) takes part under its own id, like a card: it
 * offers "Approve all" or "Send all now", and the versions inside it never own the button themselves. `hasOwner` tells a place that
 * would otherwise fill its own button (the empty list's "Write one myself") that something above it already has the filled one.
 */
export function useMainActionOwner(order: readonly Id[]): { isOwner: (id: Id) => boolean; hasOwner: boolean; offer: (id: Id, offering: boolean) => void } {
  const [offering, setOffering] = useState<ReadonlySet<Id>>(() => new Set())
  const offer = useCallback((id: Id, on: boolean) => {
    setOffering((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const owner = mainOwner(order, offering)
  return { isOwner: (id) => id === owner, hasOwner: owner !== undefined, offer }
}
