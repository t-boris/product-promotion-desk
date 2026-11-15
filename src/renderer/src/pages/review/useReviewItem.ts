import { useState, type Dispatch, type SetStateAction } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { OpportunityCard } from '../../../../shared/types'
import { useDraftForm, type DraftForm } from './DraftEditor'
import { LOCKED_STATES, LOGIN_CONFLICT_HINT, isLoginConflict, stateHintFor } from './labels'
import { alsoPostAllowed } from './post-group'
import { useReviewActions, type ReviewActions } from './useReviewActions'

export interface ReviewItem {
  card: OpportunityCard
  standalone: boolean
  form: DraftForm
  setForm: Dispatch<SetStateAction<DraftForm>>
  /** The editor holds changes that are not saved. */
  dirty: boolean
  /** The form as it stands; approving saves it first so the approval covers exactly what is on screen. */
  input: DraftInput
  /** The owner's actions, for the buttons: busy while the group (`frozen`) works on the item too. */
  actions: ReviewActions
  /** The owner's actions as they are, for what the item itself says about a failure. */
  error: string | null
  /** The item, or its group, is working: the editor and the buttons are off. */
  working: boolean
  /** The content is out, in flight, being prepared or cancelled: it can no longer be edited. */
  locked: boolean
  alsoPost: boolean
  alsoOpen: boolean
  setAlsoOpen: (open: boolean) => void
  conflict: boolean
  /** What the state means and what to do next, or the reason a held item is held. */
  hint: string | undefined
}

/**
 * Everything a review item holds besides its looks: the draft form, the owner's actions, the "Also post to…" panel and what the state
 * says. A review card (Feed, Posts) and the Inbox's detail both read it, so the two cannot decide differently what the buttons offer or
 * when the editor is off. `onDone` is called after any successful action with the card that came back.
 */
export function useReviewItem(card: OpportunityCard, options: { frozen?: boolean; alsoPostTo?: boolean; onDone?: (card: OpportunityCard) => void } = {}): ReviewItem {
  const { frozen = false, alsoPostTo = false, onDone } = options
  const opp = card.opportunity
  const standalone = opp.kind === 'standalone'
  const { form, setForm, dirty, input } = useDraftForm(card.draft, standalone)
  const actions = useReviewActions(onDone)
  // While the group works on this item nothing here is offered; the card shows the work as busy.
  const working = frozen || actions.busy
  const buttons = working === actions.busy ? actions : { ...actions, busy: true }
  const [alsoOpen, setAlsoOpen] = useState(false)
  const conflict = isLoginConflict(opp.reason)
  return {
    card,
    standalone,
    form,
    setForm,
    dirty,
    input,
    actions: buttons,
    error: actions.error,
    working,
    locked: LOCKED_STATES.includes(opp.state) || opp.state === 'analyzing' || opp.state === 'cancelled',
    alsoPost: alsoPostTo && alsoPostAllowed(card),
    alsoOpen,
    setAlsoOpen,
    conflict,
    // A held item must not be told to "prepare a draft" when that is exactly what is refused.
    hint: conflict ? LOGIN_CONFLICT_HINT : stateHintFor(opp)
  }
}
