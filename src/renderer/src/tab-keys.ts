// The keys of a row of tabs (WAI-ARIA "tabs"): Left and Right move to the neighbour and wrap, Home and End go to the first and the last.
// Pure, tested from src/main/list-selection.test.ts.

export const TAB_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

/** The tab a key leads to from `current`; null when the key is not a tab key, the row is empty, or `current` is not in it. */
export function tabAfterKey<T extends string>(ids: readonly T[], current: T, key: string): T | null {
  const at = ids.indexOf(current)
  if (at < 0 || !TAB_KEYS.includes(key)) return null
  switch (key) {
    case 'Home':
      return ids[0]
    case 'End':
      return ids[ids.length - 1]
    case 'ArrowRight':
      return ids[(at + 1) % ids.length]
    default:
      return ids[(at - 1 + ids.length) % ids.length]
  }
}
