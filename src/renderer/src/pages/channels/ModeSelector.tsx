import type { Channel, ChannelMode } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Card, ErrorNote } from '../../ui'
import { MODE_OPTIONS, modeBlockedReason } from './model'
import { ownPostsWhatItDoes } from './own-posts'

/** How far the app goes in this channel: one of four modes, as selectable rows of one group (the chosen one is tinted). */
export function ModeSelector({ channel }: { channel: Channel }) {
  const [setMode, state] = useAction((mode: ChannelMode) => call('channels.setMode', { channelId: channel.id, mode }))

  // A channel the app does not read through a connector has no replies, so there is no mode to choose, though the AI may watch it in the browser: one line says what it does (DEC-034, DEC-042).
  if (!channel.reads) {
    return (
      <Card title="What the app does here">
        <p className="muted" data-testid="own-posts-line">
          {ownPostsWhatItDoes(channel)}
        </p>
      </Card>
    )
  }

  return (
    <Card title="What the app does here">
      <div className="mode-options" role="radiogroup" aria-label="Channel mode">
        {MODE_OPTIONS.map((option) => {
          const blocked = modeBlockedReason(channel, option.id)
          const selected = channel.mode === option.id
          return (
            <label key={option.id} className={`mode-option ${selected ? 'selected' : ''} ${blocked ? 'blocked' : ''}`} data-testid={`mode-${option.id}`}>
              <input type="radio" name={`mode-${channel.id}`} checked={selected} disabled={state.busy || (blocked !== null && !selected)} onChange={() => void setMode(option.id)} />
              <span>
                <strong>{option.label}</strong>
                <span className="muted small mode-summary">{option.summary}</span>
                {blocked && !selected && <span className="small mode-blocked">Not available: {blocked}</span>}
              </span>
            </label>
          )
        })}
      </div>
      <ErrorNote error={state.error} />
    </Card>
  )
}
