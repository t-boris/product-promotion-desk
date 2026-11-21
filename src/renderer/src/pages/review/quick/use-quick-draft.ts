// A saved quick post in the screens that review it (REQ-003): the composer's form, restored from the draft, with what the review machinery needs
// of a draft form: whether it changed, the draft it would save, and the step that draws and stores the new card before anything is saved. Opening
// a saved quick post restores its card (style, colour, shape, headline); saving it again draws a NEW picture and saves a new draft.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { DraftInput } from '../../../../../shared/api'
import type { Draft, Id } from '../../../../../shared/types'
import { cardAttachment, isCardPicture, needsNewCard, quickDirty, quickFormOf, quickInput, quickReason, type QuickForm } from './quick-form'
import { storeCard } from './store-card'

export interface QuickEdit {
  form: QuickForm
  setForm: Dispatch<SetStateAction<QuickForm>>
  /** The composer holds changes that are not saved. */
  dirty: boolean
  /** The draft as it stands, with the saved card's picture or a stand-in for a card that is not drawn yet: enough to read and to compare, never to save. */
  input: DraftInput
  /** Why the post cannot be saved or approved as it stands (no headline on the card, no picture chosen, a headline over the limit), or null. The composer's own rule. */
  reason: string | null
  /** Draws and stores the card when it must be new, and returns the draft to save. It runs inside the busy step of a save, so the buttons and the form are off meanwhile. */
  settle: () => Promise<DraftInput>
}

/**
 * The form of a saved draft. It is restored again only when a different draft row arrives (a new save, or a re-draft), like the form of an article,
 * so what the owner is typing is never replaced by a re-render. `active` is false for a draft that is not a quick post: the form is then inert.
 */
export function useQuickDraft(draft: Draft | null, productId: Id, active: boolean): QuickEdit | null {
  const [form, setForm] = useState<QuickForm>(() => quickFormOf(draft))
  const draftId = draft?.id ?? null
  useEffect(() => {
    setForm(quickFormOf(draft))
  }, [draftId])
  // The step runs later than the render that made it: it reads the form and the draft as they are then.
  const latest = useRef({ form, draft, productId })
  latest.current = { form, draft, productId }
  const settle = useCallback(async (): Promise<DraftInput> => {
    const { form: now, draft: saved, productId: product } = latest.current
    if (!isCardPicture(now)) return quickInput(now)
    return quickInput(now, needsNewCard(now, saved) ? await storeCard(product, now) : cardAttachment(now, saved))
  }, [])
  if (!active) return null
  return { form, setForm, dirty: quickDirty(form, draft), reason: quickReason(form), input: quickInput(form, cardAttachment(form, draft)), settle }
}
