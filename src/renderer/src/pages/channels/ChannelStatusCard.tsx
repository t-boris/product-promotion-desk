import { useState } from 'react'
import type { Channel, Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE, neverAssessed, nextCheckText } from './model'

/** Status, last run and next check, plus Activate / Pause and removal. */
export function ChannelStatusCard({ channel, product, accountLabel, onRemoved }: { channel: Channel; product: Product | undefined; accountLabel: string; onRemoved: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const runs = useQuery('runs.list', { channelId: channel.id, limit: 1 }, ['logs', 'channels'])
  const lastRun = runs.data?.[0]
  // A channel with send history cannot be removed (that history prevents sending the same thing twice); the reason is
  // shown here, and pausing is offered instead.
  const [refusal, setRefusal] = useState<string | null>(null)
  const [activate, activating] = useAction(() => call('channels.activate', { channelId: channel.id }))
  const [setPaused, pausing] = useAction(async (paused: boolean) => {
    setRefusal(null)
    await call('channels.setPaused', { channelId: channel.id, paused })
  })
  const [remove, removing] = useAction(async () => {
    try {
      await call('channels.remove', { id: channel.id })
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : String(e))
      setConfirmRemove(false)
      return
    }
    onRemoved()
  })
  const error = activating.error ?? pausing.error ?? removing.error ?? refusal

  const canActivate = channel.status === 'setup' || ((channel.status === 'needs_user' || channel.status === 'error') && channel.baselineDoneAt === null)
  const canPause = channel.status === 'active' || channel.status === 'error' || (channel.status === 'needs_user' && channel.baselineDoneAt !== null)

  return (
    <Card title={channel.target}>
      <dl className="kv">
        <dt>Product</dt>
        <dd>{product?.name ?? 'Unknown product'}</dd>
        <dt>Account</dt>
        <dd>{accountLabel}</dd>
        <dt>Address</dt>
        <dd className="small">{channel.url}</dd>
        <dt>Status</dt>
        <dd data-testid="channel-status">
          <Badge tone={CHANNEL_STATUS_TONE[channel.status]}>{CHANNEL_STATUS_LABEL[channel.status]}</Badge> <span className="muted">{channel.statusDetail}</span>
        </dd>
        <dt>Last run</dt>
        <dd data-testid="channel-last-run">
          {lastRun ? (
            <span className="run-line">
              {formatTime(lastRun.startedAt)} · {lastRun.kind} · {lastRun.status}
              {lastRun.summary ? ` · ${lastRun.summary}` : ''}
            </span>
          ) : (
            <span className="muted">{formatTime(channel.lastRunAt)}</span>
          )}
        </dd>
        <dt>Last success</dt>
        <dd>{formatTime(channel.lastSuccessAt)}</dd>
        <dt>Next check</dt>
        <dd data-testid="channel-next-check">{nextCheckText(channel, formatTime)}</dd>
      </dl>
      {neverAssessed(channel) && channel.status === 'setup' && <p className="muted small">Assess the channel first to see what this account can do here. Then check the settings and activate it.</p>}
      <ErrorNote error={error} />
      {refusal && canPause && (
        <div className="row" style={{ marginTop: 8 }}>
          <Button variant="primary" onClick={() => void setPaused(true)} disabled={pausing.busy} data-testid="channel-pause-instead">
            Pause this channel instead
          </Button>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        {canActivate && (
          <Button variant="primary" onClick={() => void activate()} disabled={activating.busy} data-testid="channel-activate" title="Reads the existing discussions once as a baseline, then starts watching for new activity">
            {activating.busy ? 'Activating…' : 'Activate'}
          </Button>
        )}
        {canPause && (
          <Button onClick={() => void setPaused(true)} disabled={pausing.busy} data-testid="channel-pause">
            Pause
          </Button>
        )}
        {channel.status === 'paused' && (
          <Button variant="primary" onClick={() => void setPaused(false)} disabled={pausing.busy} data-testid="channel-resume">
            Resume
          </Button>
        )}
        <span className="sep" />
        {confirmRemove ? (
          <>
            <span className="muted small">Deletes this channel with its discussions and drafts. The account stays. A channel that has already sent something cannot be removed, only paused.</span>
            <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid="channel-remove-confirm">
              Remove channel
            </Button>
            <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirmRemove(true)} data-testid="channel-remove">
            Remove
          </Button>
        )}
      </div>
    </Card>
  )
}
