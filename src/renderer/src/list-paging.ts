import { useEffect, useState } from 'react'

/** How many rows a long list shows first, and how many more each "Show more" adds. */
export const PAGE_SIZE = 25

/** The part of a list that is shown, and what is left. Pure. */
export function pageOf<T>(items: readonly T[], shown: number): { visible: T[]; hidden: number } {
  const count = Math.max(0, Math.min(shown, items.length))
  return { visible: items.slice(0, count), hidden: items.length - count }
}

/** "Show 25 more (60 left)": the label of the button under a list that has more to show. */
export function moreLabel(hidden: number, step = PAGE_SIZE): string {
  return `Show ${Math.min(hidden, step)} more (${hidden} left)`
}

/**
 * A long list shown a page at a time. The page starts again (back to the first `size` rows) whenever `resetKey` changes: a new filter, search or sort
 * starts from the top. The rows already shown stay shown when the list changes under them (a new post arrives): the owner is not thrown back.
 */
export function usePaging<T>(items: readonly T[], resetKey: string, size = PAGE_SIZE): { visible: T[]; hidden: number; total: number; more: () => void } {
  const [shown, setShown] = useState(size)
  useEffect(() => setShown(size), [resetKey, size])
  const { visible, hidden } = pageOf(items, shown)
  return { visible, hidden, total: items.length, more: () => setShown((n) => n + size) }
}
