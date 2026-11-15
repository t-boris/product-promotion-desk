// Which row of a list the screen shows beside it (Posts, Feed): the one the owner chose while it is listed, the neighbour that took its place
// when it leaves, else the first. Pure, so it is tested from src/main/list-selection.test.ts. The hook that commits the result is in
// use-list-selection.ts.

import type { Id } from '../../shared/types'

/**
 * The row to show. `previous` is the order of the render before this one (it still holds a row that has just left), `chosen` the row the
 * screen last committed, `after` says which row takes the place of one that left (the next, else the one above).
 */
export function resolveSelection(order: readonly Id[], previous: readonly Id[], chosen: Id | null, after: (order: readonly Id[], gone: Id) => Id | null): Id | null {
  if (chosen !== null && order.includes(chosen)) return chosen
  if (chosen !== null && previous.includes(chosen)) {
    const next = after(previous, chosen)
    if (next !== null && order.includes(next)) return next
  }
  return order[0] ?? null
}

/** A key that moves the selection: one row down or up, or to the first or last row. */
export type SelectionKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export const SELECTION_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Home', 'End']

/** The row a key leads to from `current`; null when the list is empty or the key does not move it (already at the end). */
export function selectionAfterKey(order: readonly Id[], current: Id | null, key: SelectionKey): Id | null {
  if (order.length === 0) return null
  const at = current === null ? -1 : order.indexOf(current)
  let target: number
  switch (key) {
    case 'Home':
      target = 0
      break
    case 'End':
      target = order.length - 1
      break
    case 'ArrowDown':
      target = at < 0 ? 0 : Math.min(at + 1, order.length - 1)
      break
    case 'ArrowUp':
      target = at < 0 ? order.length - 1 : Math.max(at - 1, 0)
      break
  }
  return target === at ? null : order[target]
}
