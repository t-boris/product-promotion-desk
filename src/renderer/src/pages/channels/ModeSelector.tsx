import type { Channel, ChannelMode } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Card, ErrorNote } from '../../ui'
import { MODE_OPTIONS, modeBlockedReason } from './model'

export function ModeSelector({ channel }: { channel: Channel }) {
  const [setMode, state] = useAction((mode: ChannelMode) => call('channels.setMode', { channelId: channel.id, mode }))

  return (
    <Card title="What the app does here">
      <div className="stack" role="radiogroup" aria-label="Channel mode">
        {MODE_OPTIONS.map((option) => {
          const blocked = modeBlockedReason(channel, option.id)
          const selected = channel.mode === option.id
          return (
            <label key={option.id} className={`mode-option ${selected ? 'selected' : ''} ${blocked ? 'blocked' : ''}`} data-testid={`mode-${option.id}`}>
              <input type="radio" name={`mode-${channel.id}`} checked={selected} disabled={state.busy || (blocked !== null && !selected)} onChange={() => void setMode(option.id)} />
              <span>
                <strong>{option.label}</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  {option.summary}
                </span>
                {blocked && !selected && (
                  <span className="small" style={{ display: 'block', color: 'var(--warn)' }}>
                    Not available: {blocked}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      <ErrorNote error={state.error} />
    </Card>
  )
}
