import type { Channel, CapabilityStatus } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, formatTime, useMainVariant } from '../../ui'
import { CAPABILITY_LABEL, CAPABILITY_ORDER, CAPABILITY_STATUS_HELP, CAPABILITY_STATUS_LABEL, CAPABILITY_STATUS_TONE, SENDING_CAPABILITIES, capabilityOf, neverAssessed } from './model'

const LEGEND_ORDER: CapabilityStatus[] = ['verified', 'needs_check', 'needs_user', 'unavailable', 'restricted']

/** An ability's state: a tag only where the owner may have to decide (amber), otherwise a dot and its words, so a table of eight rows stays calm. */
function AbilityStatus({ status }: { status: CapabilityStatus }) {
  const tone = CAPABILITY_STATUS_TONE[status]
  if (tone === 'warn') return <Badge tone={tone}>{CAPABILITY_STATUS_LABEL[status]}</Badge>
  return (
    <span className="dot-line">
      <span className={`dot ${tone}`} aria-hidden="true" />
      {CAPABILITY_STATUS_LABEL[status]}
    </span>
  )
}

/**
 * What this account can do in this channel, as established for the current connection - never more than was verified. "Assess channel" is
 * the tab's filled button while the channel was never assessed (`filled`); "Assess again" is a bezel.
 */
export function CapabilityCard({ channel, filled }: { channel: Channel; filled: boolean }) {
  const main = useMainVariant()
  const [assess, state] = useAction(() => call('channels.assess', { channelId: channel.id }))
  const unassessed = neverAssessed(channel)

  return (
    <Card
      title="What this account can do here"
      actions={
        <Button variant={filled ? main : 'ghost'} onClick={() => void assess()} disabled={state.busy} data-testid="channel-assess">
          {state.busy ? 'Assessing…' : unassessed ? 'Assess channel' : 'Assess again'}
        </Button>
      }
    >
      <p className="muted small">
        Assessing only looks: it reads the channel through this account's own browser and never posts a test message. {unassessed ? 'This channel has not been assessed yet.' : ''}
      </p>
      <ErrorNote error={state.error} />
      <table className="table cap-table" data-testid="capabilities">
        <thead>
          <tr>
            <th>Ability</th>
            <th>Status</th>
            <th>Details</th>
            <th>Checked</th>
          </tr>
        </thead>
        <tbody>
          {CAPABILITY_ORDER.map((key) => {
            const capability = capabilityOf(channel, key)
            const status = capability?.status ?? 'needs_check'
            return (
              <tr key={key} data-testid={`capability-${key}`}>
                <td>{CAPABILITY_LABEL[key]}</td>
                <td>
                  <AbilityStatus status={status} />
                </td>
                <td className="cap-detail">{capability?.detail || '—'}</td>
                <td className="cap-checked">{formatTime(capability?.checkedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="note" data-testid="sending-note">
        <strong>Sending is confirmed by real use.</strong> {SENDING_CAPABILITIES.map((k) => CAPABILITY_LABEL[k].toLowerCase()).join(', ')} cannot be tested without publishing something, and this application never publishes test messages to a real community. They show “Needs verification” until the first message you authorize is sent and confirmed on the platform.
      </div>
      <div className="legend">
        {LEGEND_ORDER.map((status) => (
          <div key={status} className="legend-item">
            <AbilityStatus status={status} />
            <span className="muted">{CAPABILITY_STATUS_HELP[status]}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
