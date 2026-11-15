import type { Channel, Id } from '../../../../shared/types'
import { Button, MenuItem, RowMenu } from '../../ui'

/**
 * An action that is done for one channel: a button when there is one channel to do it for, a menu of the channels when there are several
 * (the Posts screen's "Suggest with AI" does the same), nothing when there is none. A channel the screen has chosen is the only one given,
 * so the action never asks which one again.
 */
export function ChannelAction({
  label,
  channels,
  onPick,
  disabled = false,
  variant = 'ghost',
  testId
}: {
  label: string
  channels: readonly Channel[]
  onPick: (channelId: Id) => void
  disabled?: boolean
  variant?: 'ghost' | 'quiet'
  testId: string
}) {
  if (channels.length === 0) return null
  if (channels.length === 1) {
    return (
      <Button variant={variant} onClick={() => onPick(channels[0].id)} disabled={disabled} data-testid={testId}>
        {label}
      </Button>
    )
  }
  return (
    <RowMenu label={label} variant={variant} testId={testId}>
      {(close) =>
        channels.map((channel) => (
          <MenuItem
            key={channel.id}
            onClick={() => {
              close()
              onPick(channel.id)
            }}
            disabled={disabled}
            data-testid={`${testId}-${channel.id}`}
          >
            {channel.target}
          </MenuItem>
        ))
      }
    </RowMenu>
  )
}
