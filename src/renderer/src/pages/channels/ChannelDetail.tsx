import type { Account, Channel, PlatformInfo, Product } from '../../../../shared/types'
import { CapabilityCard } from './CapabilityCard'
import { ChannelMixCard } from './ChannelMixCard'
import { ChannelPlanCard } from './ChannelPlanCard'
import { ChannelStatusCard } from './ChannelStatusCard'
import { ModeSelector } from './ModeSelector'
import { SettingsForm } from './SettingsForm'
import type { SetupStage } from './setup-stage'

export function ChannelDetail({
  channel,
  products,
  accounts,
  platforms,
  planBlockedReason,
  stage,
  onRemoved
}: {
  channel: Channel
  products: Product[]
  accounts: Account[]
  platforms: PlatformInfo[]
  planBlockedReason: string | null
  /** The setup stage whose button is the tab's filled one: "Assess channel" and "Activate" are filled only at their own stage, and not at all (null) while the path's next stage is elsewhere. */
  stage: SetupStage | null
  onRemoved: () => void
}) {
  const account = accounts.find((a) => a.id === channel.accountId)
  // What the platform can do for this channel (tell whether the account joined): the Membership row and the join button are for those that can.
  const platform = platforms.find((p) => p.platform === channel.platform)
  return (
    <div className="pane" data-testid={`channel-detail-${channel.id}`}>
      <ChannelStatusCard channel={channel} product={products.find((p) => p.id === channel.productId)} account={account} platform={platform} accountLabel={account?.label ?? 'Unknown account'} filled={stage === 'activate'} onRemoved={onRemoved} />
      <CapabilityCard channel={channel} filled={stage === 'assess'} platform={platform} />
      <ChannelPlanCard channel={channel} platforms={platforms} blockedReason={planBlockedReason} />
      {/* The content mix reads the plan's steps for its proposal; its "Let the AI propose a mix" is off for the same reason the plan's button is, but only when it would need the AI. */}
      <ChannelMixCard channel={channel} blockedReason={planBlockedReason} />
      <ModeSelector channel={channel} />
      {/* Remounted when the saved settings change elsewhere, so the form never shows stale values. */}
      <SettingsForm key={JSON.stringify(channel.settings)} channel={channel} />
    </div>
  )
}
