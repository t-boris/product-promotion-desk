import { useState } from 'react'
import type { Id } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Button, ErrorNote, Loading } from '../../ui'
import { ReviewCard } from '../review/ReviewCard'

/**
 * "Edit in full" of the reply window: the same card every draft has (the text in its editor with a picture, a link and formatting, Approve, and the other
 * buttons), shown in place of the quick window, for the item that holds this comment. The window gave it the text as its draft and did not approve or send
 * anything. "Back to the reply window" returns to the quick one, which then shows what the card kept.
 */
export function FullReply({ opportunityId, onBack }: { opportunityId: Id; onBack: () => void }) {
  const card = useQuery('opportunities.get', { id: opportunityId }, ['opportunities'])
  // Changes in the editor that are not saved would be lost on the way back; the way back waits until they are saved or undone.
  const [dirty, setDirty] = useState(false)
  return (
    <div className="reply-full" data-testid="reply-full">
      <div className="reply-full-head">
        <Button variant="secondary" onClick={onBack} disabled={dirty} data-testid="reply-full-back">
          Back to the reply window
        </Button>
        {dirty && <span className="muted small">There are changes that are not saved: save or undo them first.</span>}
      </div>
      {card.data ? <ReviewCard card={card.data} onDirty={(_id, isDirty) => setDirty(isDirty)} /> : card.error ? <ErrorNote error={card.error} /> : <Loading what="Opening the comment" />}
    </div>
  )
}
