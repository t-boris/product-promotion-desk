import { useMemo, useState } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, useOpenForm } from '../../ui'
import { draftInputOf, extendLabel, toggled, whereRows } from './post-group'
import { WhereToPost, useChannelOptions } from './WhereToPost'

/**
 * "Also post to…" on a post of the owner's: the same list of channels, asked about the post's own text. Saving makes a version for each
 * ticked channel and the post becomes one of a group; nothing is approved or sent. While it is open it is a form opened on demand, so its
 * button is the screen's filled one.
 */
export function AlsoPostPanel({ card, onClose }: { card: OpportunityCard; onClose: () => void }) {
  const opp = card.opportunity
  const saveVariant = useOpenForm()
  const [chosen, setChosen] = useState<Id[]>([])
  const draft = useMemo(() => (card.draft ? draftInputOf(card.draft) : { text: '' }), [card.draft])
  const options = useChannelOptions(opp.productId, draft)
  // The channel the post is in is not offered again.
  const rows = whereRows(options.data, chosen, undefined, [opp.channelId])
  const [save, saving] = useAction(async () => {
    await call('postGroups.extend', { opportunityId: opp.id, channelIds: chosen })
    onClose()
  })

  return (
    <div className="also-post" data-testid="also-post-panel">
      <WhereToPost
        heading="Also post to"
        note="Tick the channels this post should go to as well. Each gets its own version; nothing is approved or sent until you do it."
        rows={rows}
        loading={options.loading}
        error={options.error}
        chosen={chosen}
        onToggle={(id) => setChosen((current) => toggled(current, id))}
        disabled={saving.busy}
        alone="This product has no other channel that can post."
      />
      <ErrorNote error={saving.error} />
      <div className="form-actions">
        {chosen.length === 0 && (
          <span className="muted small" data-testid="also-post-reason">
            Tick a channel first.
          </span>
        )}
        <Button onClick={onClose} disabled={saving.busy} data-testid="also-post-cancel">
          Cancel
        </Button>
        <Button variant={saveVariant} onClick={() => void save()} disabled={saving.busy || chosen.length === 0} data-testid="also-post-save">
          {extendLabel(chosen.length)}
        </Button>
      </div>
    </div>
  )
}
