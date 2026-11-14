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
 * One filled button per screen (visual-system.md §10): in a list of review cards it belongs to the first card, in list order, that
 * offers a main action. The cards say whether they do (`offer`); every other card shows the same action as a secondary button.
 * `order` is the ids of the cards as the list shows them.
 */
export function useMainActionOwner(order: readonly Id[]): { isOwner: (id: Id) => boolean; offer: (id: Id, offering: boolean) => void } {
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
  const owner = order.find((id) => offering.has(id))
  return { isOwner: (id) => id === owner, offer }
}
