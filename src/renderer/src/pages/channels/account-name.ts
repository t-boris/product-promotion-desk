// The name of an account (the one the owner reads in lists and headers). The core holds the same limit and folds spaces the same way
// (accounts.rename); this only keeps the interface from sending what it will refuse.

export const ACCOUNT_NAME_LIMIT = 80

/** The name as the core keeps it: spaces folded, trimmed. */
export function normalizeName(draft: string): string {
  return draft.replace(/\s+/g, ' ').trim()
}

/** Why a draft cannot be saved as the new name of an account, or null when it can. */
export function renameProblem(current: string, draft: string): 'empty' | 'unchanged' | 'too_long' | null {
  const name = normalizeName(draft)
  if (name === '') return 'empty'
  if (name.length > ACCOUNT_NAME_LIMIT) return 'too_long'
  if (name === current) return 'unchanged'
  return null
}
