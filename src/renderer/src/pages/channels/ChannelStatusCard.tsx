import { useState } from 'react'
import type { Account, Channel, PlatformInfo, Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ConfirmAction, ErrorNote, formatTime, Hint, useMainVariant } from '../../ui'
import { useWatchingContext } from '../feed/useWatching'
import { watchingLine } from '../feed/watching-line'
import { JoinChannel } from './JoinChannel'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE, capabilityOf, membershipWord, nextCheckText } from './model'
import { OWN_POSTS_READING, activateHint } from './own-posts'
import { activateBlocker, canActivate, canPause } from './setup-stage'

/**
 * Status, last run and next check (a channel the app does not read says why it has none), plus Activate / Pause and removal. "Activate" is the tab's filled button only at its stage (`filled`:
 * the channel was assessed and is still to be started); "Pause", "Resume" and "Pause this channel instead" are never filled.
 */
export function ChannelStatusCard({ channel, product, account, platform, accountLabel, filled, onRemoved }: { channel: Channel; product: Product | undefined; account: Account | undefined; platform?: PlatformInfo; accountLabel: string; filled: boolean; onRemoved: () => void }) {
  const main = useMainVariant()
  const runs = useQuery('runs.list', { channelId: channel.id, limit: 1 }, ['logs', 'channels'])
  const lastRun = runs.data?.[0]
  // How often the channel is looked at, or why it is not (DEC-040). The last and the next check are the rows below; this is the rest of the line.
  const watchingContext = useWatchingContext()
  const watching = watchingContext ? watchingLine(channel, watchingContext) : null
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
      return
    }
    onRemoved()
  })
  const error = activating.error ?? pausing.error ?? removing.error ?? refusal

  const activatable = canActivate(channel)
  // The reason Activate is off: shown beside the button, and the same result disables it.
  const blocker = activateBlocker(channel)
  const pausable = canPause(channel)

  return (
    <Card title="Status" className="wraps-title">
      <dl className="kv">
        <dt>Product</dt>
        <dd>{product?.name ?? 'Unknown product'}</dd>
        <dt>Account</dt>
        <dd>{accountLabel}</dd>
        {/* Whether the account joined (DEC-029): only where the platform can tell. */}
        {platform?.canJoin && (
          <>
            <dt>Membership</dt>
            <dd data-testid="channel-membership">{membershipWord(capabilityOf(channel, 'membership'))}</dd>
          </>
        )}
        <dt>Address</dt>
        <dd className="small">{channel.url}</dd>
        <dt>Status</dt>
        <dd data-testid="channel-status">
          <Badge tone={CHANNEL_STATUS_TONE[channel.status]}>{CHANNEL_STATUS_LABEL[channel.status]}</Badge> <span className="muted">{channel.statusDetail}</span>
        </dd>
        {/* A channel the app does not read has no runs, no last success and no next check (DEC-034): one row says why. */}
        {channel.reads ? (
          <>
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
            {watching && (
              <>
                <dt>Watching</dt>
                <dd data-testid="channel-watching" data-watching={watching.watching}>
                  {watching.schedule}
                </dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Reading</dt>
            <dd data-testid="channel-reading">{OWN_POSTS_READING}</dd>
          </>
        )}
      </dl>
      <ErrorNote error={error} />
      {refusal && pausable && (
        <div className="row actions-row">
          <Button onClick={() => void setPaused(true)} disabled={pausing.busy} data-testid="channel-pause-instead">
            Pause this channel instead
          </Button>
        </div>
      )}
      <div className="row actions-row">
        {activatable && (
          <Button variant={filled ? main : 'ghost'} onClick={() => void activate()} disabled={activating.busy || blocker !== null} data-testid="channel-activate" title={activateHint(channel)}>
            {activating.busy ? 'Activating…' : 'Activate'}
          </Button>
        )}
        {blocker && (
          <Hint className="row-note" data-testid="channel-activate-reason">
            {blocker}
          </Hint>
        )}
        {pausable && (
          <Button onClick={() => void setPaused(true)} disabled={pausing.busy} data-testid="channel-pause">
            Pause
          </Button>
        )}
        {channel.status === 'paused' && (
          <Button onClick={() => void setPaused(false)} disabled={pausing.busy} data-testid="channel-resume">
            Resume
          </Button>
        )}
        {/* Joins the community with the account, on the owner's press and nothing else (DEC-029); only where the platform can tell it worked. */}
        {account && <JoinChannel key={`${account.id}:${channel.id}`} channel={channel} account={account} canJoin={platform?.canJoin === true} />}
        <span className="sep" />
        <ConfirmAction
          label="Remove"
          question="Deletes this channel with its discussions and drafts. The account stays. A channel that has already sent something cannot be removed, only paused."
          confirmLabel="Remove channel"
          onConfirm={() => remove()}
          testId="channel-remove"
          confirmTestId="channel-remove-confirm"
        />
      </div>
    </Card>
  )
}
