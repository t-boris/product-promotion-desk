import type { Account, Channel, PlatformInfo, Product } from '../../../../shared/types'
import { CapabilityCard } from './CapabilityCard'
import { ChannelPlanCard } from './ChannelPlanCard'
import { ChannelStatusCard } from './ChannelStatusCard'
import { ModeSelector } from './ModeSelector'
import { SettingsForm } from './SettingsForm'

export function ChannelDetail({
  channel,
  products,
  accounts,
  platforms,
  planBlockedReason,
  onRemoved
}: {
  channel: Channel
  products: Product[]
  accounts: Account[]
  platforms: PlatformInfo[]
  planBlockedReason: string | null
  onRemoved: () => void
}) {
  const account = accounts.find((a) => a.id === channel.accountId)
  return (
    <div className="channels-detail" data-testid={`channel-detail-${channel.id}`}>
      <ChannelStatusCard channel={channel} product={products.find((p) => p.id === channel.productId)} accountLabel={account?.label ?? 'Unknown account'} onRemoved={onRemoved} />
      <CapabilityCard channel={channel} />
      <ChannelPlanCard channel={channel} platforms={platforms} blockedReason={planBlockedReason} />
      <ModeSelector channel={channel} />
      {/* Remounted when the saved settings change elsewhere, so the form never shows stale values. */}
      <SettingsForm key={JSON.stringify(channel.settings)} channel={channel} />
    </div>
  )
}
