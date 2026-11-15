import { useEffect, useRef, useState } from 'react'
import type { Id } from '../../shared/types'
import { resolveSelection } from './list-selection'

/**
 * The row a screen shows beside its list, kept as a choice of the screen and not only derived from the list: when the chosen row leaves the
 * list (approved under a filter, deleted) the neighbour that took its place is committed, so a later render cannot fall back to the first row,
 * and a row that moves to the top of a list the owner never chose from does not take the pane away while something is being edited in it.
 */
export function useListSelection(order: readonly Id[], after: (order: readonly Id[], gone: Id) => Id | null): [Id | null, (id: Id | null) => void] {
  const [chosen, setChosen] = useState<Id | null>(null)
  const previous = useRef(order)
  const selected = resolveSelection(order, previous.current, chosen, after)
  useEffect(() => {
    previous.current = order
    if (selected !== chosen) setChosen(selected)
  })
  return [selected, setChosen]
}
