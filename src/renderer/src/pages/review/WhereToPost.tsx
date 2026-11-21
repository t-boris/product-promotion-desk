import { useMemo } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { Id } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Badge, ErrorNote, Hint, Loading } from '../../ui'
import { rowName, type WhereRow } from './post-group'
import { useDebounced } from './useDebounced'

/** How long the owner stops typing before the channels are asked how the post fits them. */
export const TYPING_PAUSE_MS = 500

/**
 * The product's channels that can post, and whether the post as it is now fits each (a rule of the platform, not the AI, so it is cheap).
 * The draft is settled for a moment first, so typing does not ask at every key. `undefined` until the first answer.
 */
export function useChannelOptions(productId: Id, draft: DraftInput) {
  const serialized = useDebounced(JSON.stringify(draft), TYPING_PAUSE_MS)
  const settled = useMemo(() => JSON.parse(serialized) as DraftInput, [serialized])
  // A channel that goes on pause or loses its account changes the answer too.
  return useQuery('postGroups.channels', { productId, draft: settled }, ['channels', 'accounts'])
}

interface Props {
  heading: string
  /** One line under the heading: what ticking does. */
  note: string
  rows: WhereRow[] | undefined
  loading: boolean
  error: string | null
  chosen: readonly Id[]
  onToggle: (id: Id) => void
  disabled: boolean
  /** Said when there is no other channel to offer. */
  alone?: string
  /** Channels that cannot be ticked now, with the reason, by channel id (a picture post and an article never go together). A ticked channel is never listed: it must be possible to untick it. */
  blocked?: Readonly<Record<Id, string>>
}

/**
 * "Where to post": the channels of the product, one tick each. Nothing is ticked for the owner but the channel the screen is on; the app
 * only marks the ones it suggests. A channel the post does not fit may still be ticked: its version will say what is wrong.
 */
export function WhereToPost({ heading, note, rows, loading, error, chosen, onToggle, disabled, alone, blocked }: Props) {
  return (
    <div className="where" data-testid="where-to-post">
      <div className="where-head">
        <span className="where-title">{heading}</span>
        <Hint>{note}</Hint>
      </div>
      <ErrorNote error={error} />
      {rows === undefined && loading && <Loading what="Looking at the channels" />}
      {rows !== undefined && (
        <div className="where-list" role="group" aria-label={heading}>
          {rows.map((row) => {
            const stopped = blocked?.[row.channelId]
            const reasonId = `where-blocked-${row.channelId}`
            return (
              <label key={row.channelId} className={`where-row${stopped ? ' blocked' : ''}`} data-testid={`where-${row.channelId}`}>
                <input type="checkbox" checked={chosen.includes(row.channelId)} disabled={disabled || stopped !== undefined} aria-describedby={stopped ? reasonId : undefined} onChange={() => onToggle(row.channelId)} data-testid={`where-check-${row.channelId}`} />
                <span className="where-main">
                  <span className="where-name">
                    <strong>{rowName(row)}</strong>
                    <span className="where-account">as {row.accountLabel}</span>
                    {!stopped && <Badge tone={row.fits ? 'good' : 'warn'}>{row.fits ? 'Fits' : 'Does not fit'}</Badge>}
                    {!stopped && row.suggested && <Badge tone="info">Suggested</Badge>}
                  </span>
                  {stopped ? (
                    <span className="where-reason off" id={reasonId} data-testid={reasonId}>
                      {stopped}
                    </span>
                  ) : (
                    <span className={`where-reason${row.fits ? '' : ' off'}`} data-testid={`where-reason-${row.channelId}`}>
                      {row.reason}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      )}
      {rows !== undefined && alone && rows.length <= 1 && <Hint data-testid="where-alone">{alone}</Hint>}
    </div>
  )
}
