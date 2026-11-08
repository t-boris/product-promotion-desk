import type { Account, Channel, Product } from '../../../../shared/types'
import { CapabilityCard } from './CapabilityCard'
import { ChannelStatusCard } from './ChannelStatusCard'
import { ModeSelector } from './ModeSelector'
import { SettingsForm } from './SettingsForm'

export function ChannelDetail({ channel, products, accounts, onRemoved }: { channel: Channel; products: Product[]; accounts: Account[]; onRemoved: () => void }) {
  const account = accounts.find((a) => a.id === channel.accountId)
  return (
    <div className="channels-detail" data-testid={`channel-detail-${channel.id}`}>
      <ChannelStatusCard channel={channel} product={products.find((p) => p.id === channel.productId)} accountLabel={account?.label ?? 'Unknown account'} onRemoved={onRemoved} />
      <CapabilityCard channel={channel} />
      <ModeSelector channel={channel} />
      {/* Remounted when the saved settings change elsewhere, so the form never shows stale values. */}
      <SettingsForm key={JSON.stringify(channel.settings)} channel={channel} />
    </div>
  )
}
