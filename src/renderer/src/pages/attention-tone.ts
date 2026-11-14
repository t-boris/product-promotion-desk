// The colour of an attention item and of the count next to "Attention" in the menu. A pure module (no JSX), so it is
// tested from src/main/renderer-logic.test.ts.
import type { AttentionKind } from '../../../shared/types'
import type { Tone } from '../tone'

/** Red is kept for failures: a send that failed or ended without a known result. Everything else that waits for the
 *  owner (an approval, a question, a sign-in, a CAPTCHA, a connection to check) is amber; a draft is information. */
export const KIND_TONE: Record<AttentionKind, Tone> = {
  approval: 'warn',
  draft: 'info',
  question: 'warn',
  login: 'warn',
  captcha: 'warn',
  connection: 'warn',
  error: 'bad',
  unknown_result: 'bad'
}

/** The count means "needs you": amber, and red only while at least one of the items is a failure. Null with no items. */
export function attentionCountTone(kinds: AttentionKind[]): 'attention' | 'error' | null {
  if (kinds.length === 0) return null
  return kinds.some((kind) => KIND_TONE[kind] === 'bad') ? 'error' : 'attention'
}
