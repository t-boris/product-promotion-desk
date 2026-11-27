import { useState } from 'react'
import { MAX_CHANNEL_LIMIT, limitLine } from '../../../../shared/product-choices'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote } from '../../ui'

/**
 * The owner's limit on channels in work (DEC-071): a number of their own, shown beside how many channels are active. It blocks nothing and
 * pauses nothing; the owner parks a channel themselves.
 */
export function ChannelLimit({ productId }: { productId: string }) {
  const choices = useQuery('choices.get', { productId }, ['products', 'channels'])
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [save, saving] = useAction(async (limit: number | null) => {
    await call('choices.set', { productId, channelLimit: limit })
    setEditing(false)
  })
  const view = choices.data
  if (!view) return null
  const n = Number(text)
  const ready = Number.isInteger(n) && n >= 1 && n <= MAX_CHANNEL_LIMIT
  return (
    <div className="row" data-testid="channel-limit">
      <span className={view.channelLimit !== null && view.inWork > view.channelLimit ? 'health-fell' : undefined} data-testid="channel-limit-line">
        Channels of this product: {limitLine(view.inWork, view.channelLimit)}
      </span>
      {editing ? (
        <>
          <input className="input channel-limit-input" type="number" min={1} max={MAX_CHANNEL_LIMIT} step={1} value={text} onChange={(e) => setText(e.target.value)} disabled={saving.busy} aria-label="Limit on channels in work" data-testid="channel-limit-value" />
          <Button variant="primary" onClick={() => void save(n)} disabled={saving.busy || !ready} data-testid="channel-limit-save">
            Save
          </Button>
          {view.channelLimit !== null && (
            <Button onClick={() => void save(null)} disabled={saving.busy} data-testid="channel-limit-none">
              No limit
            </Button>
          )}
          <Button variant="quiet" onClick={() => setEditing(false)} disabled={saving.busy}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="quiet"
          onClick={() => {
            setText(view.channelLimit === null ? '' : String(view.channelLimit))
            setEditing(true)
          }}
          data-testid="channel-limit-edit"
        >
          {view.channelLimit === null ? 'Set my limit' : 'Change my limit'}
        </Button>
      )}
      <ErrorNote error={saving.error} />
    </div>
  )
}
