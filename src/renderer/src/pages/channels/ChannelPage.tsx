import { useState } from 'react'
import { platformLabel } from '../../../../shared/post-format'
import type { Account, Channel, PlatformInfo, Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { CHANNEL_TABS, channelHref, type ChannelTab } from '../../route'
import { tabAfterKey } from '../../tab-keys'
import { Button, ErrorNote, Hint, ObjectHeader } from '../../ui'
import { isWatchable } from '../feed/watching-line'
import { CapabilityCard } from './CapabilityCard'
import { ChannelMixCard } from './ChannelMixCard'
import { ChannelPlanCard } from './ChannelPlanCard'
import { ChannelStatusCard } from './ChannelStatusCard'
import { ModeSelector } from './ModeSelector'
import { OpenAccountBrowser } from './OpenAccountBrowser'
import { SettingsForm } from './SettingsForm'
import type { SetupStage } from './setup-stage'

export const CHANNEL_TAB_LABEL: Record<ChannelTab, string> = { status: 'Status', plan: 'Plan', mix: 'Content mix', settings: 'Settings' }

/**
 * One channel (DEC-037): its header (the address, who serves it, "Open browser" and "Check now") and four tabs that regroup what the
 * channel's single column of six cards held. Status: where it stands and what its account can do there. Plan: what the AI intends for
 * it. Content mix: how often it prepares the owner's own posts. Settings: how the app behaves there.
 */
export function ChannelPage({
  channel,
  tab,
  products,
  accounts,
  platforms,
  planBlockedReason,
  stage,
  onRemoved
}: {
  channel: Channel
  tab: ChannelTab
  products: Product[]
  accounts: Account[]
  platforms: PlatformInfo[]
  planBlockedReason: string | null
  /** The setup stage whose button is the screen's filled one: "Assess channel" and "Activate" are filled only at their own stage, and not at all (null) while the path's next stage is elsewhere. */
  stage: SetupStage | null
  onRemoved: () => void
}) {
  const account = accounts.find((a) => a.id === channel.accountId)
  const platform = platforms.find((p) => p.platform === channel.platform)
  const [lastCheck, setLastCheck] = useState<string | null>(null)
  const [checkNow, checking] = useAction(async () => {
    const run = await call('channels.checkNow', { channelId: channel.id })
    setLastCheck(`${run.status}: ${run.summary}`)
  })

  return (
    <div className="pane" data-testid={`channel-detail-${channel.id}`}>
      <a className="back-link" href="#/channels" data-testid="channels-back">
        All channels
      </a>
      <ObjectHeader
        title={channel.target}
        meta={`${platformLabel(channel.platform)} · ${account?.label ?? 'Unknown account'}`}
        testId="channel-header"
        actions={
          <>
            {/* The channel's own page in the browser of its account, to look around signed in as it (DEC-028). */}
            {account && <OpenAccountBrowser key={account.id} account={account} open={() => call('accounts.openBrowser', { accountId: account.id, url: channel.url })} testId="channel-browse" />}
            {/* A check is for a channel the app looks at: through a connector or, where it has none, in the browser (DEC-042). */}
            {isWatchable(channel) && (
              <Button onClick={() => void checkNow()} disabled={checking.busy} data-testid="check-now">
                {checking.busy ? 'Checking…' : 'Check now'}
              </Button>
            )}
          </>
        }
      />
      <ErrorNote error={checking.error} />
      {lastCheck && <Hint data-testid="check-result">Last check: {lastCheck}</Hint>}
      <div className="tabs" role="tablist" aria-label="Channel sections">
        {CHANNEL_TABS.map((id) => (
          <button
            key={id}
            role="tab"
            id={`channel-tab-${id}-${channel.id}`}
            aria-selected={tab === id}
            aria-controls={`channel-panel-${channel.id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => (window.location.hash = channelHref(channel.id, id))}
            onKeyDown={(event) => {
              const next = tabAfterKey(CHANNEL_TABS, id, event.key)
              if (next === null) return
              event.preventDefault()
              window.location.hash = channelHref(channel.id, next)
              // The page keeps the row, so the focus follows the tab that was chosen.
              document.getElementById(`channel-tab-${next}-${channel.id}`)?.focus()
            }}
            data-testid={`channel-tab-${id}`}
          >
            {CHANNEL_TAB_LABEL[id]}
          </button>
        ))}
      </div>
      <div className="stack" role="tabpanel" id={`channel-panel-${channel.id}`} aria-labelledby={`channel-tab-${tab}-${channel.id}`} data-testid={`channel-panel-${tab}`}>
        {tab === 'status' && (
          <>
            <ChannelStatusCard channel={channel} product={products.find((p) => p.id === channel.productId)} account={account} platform={platform} accountLabel={account?.label ?? 'Unknown account'} filled={stage === 'activate'} onRemoved={onRemoved} />
            <CapabilityCard channel={channel} filled={stage === 'assess'} platform={platform} />
          </>
        )}
        {tab === 'plan' && <ChannelPlanCard channel={channel} platforms={platforms} blockedReason={planBlockedReason} />}
        {/* The content mix reads the plan's steps for its proposal; its "Let the AI propose a mix" is off for the same reason the plan's button is, but only when it would need the AI. */}
        {tab === 'mix' && <ChannelMixCard channel={channel} blockedReason={planBlockedReason} />}
        {tab === 'settings' && (
          <>
            <ModeSelector channel={channel} />
            {/* Remounted when the saved settings change elsewhere, so the form never shows stale values. */}
            <SettingsForm key={JSON.stringify(channel.settings)} channel={channel} />
          </>
        )}
      </div>
    </div>
  )
}
