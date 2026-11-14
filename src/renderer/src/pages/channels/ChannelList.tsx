import type { Channel, Product } from '../../../../shared/types'
import { Badge, EmptyState } from '../../ui'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE } from './model'

export function ChannelList({ channels, products, selectedId, onSelect }: { channels: Channel[]; products: Product[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (channels.length === 0) return <EmptyState art="channel" title="No channels yet">Connect your first channel above.</EmptyState>
  return (
    <>
      {channels.map((channel) => (
        <div
          key={channel.id}
          className={`list-row selectable ${channel.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(channel.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(channel.id)}
          data-testid={`channel-row-${channel.id}`}
        >
          <div>
            <strong>{channel.target}</strong>
            <div className="muted small">{products.find((p) => p.id === channel.productId)?.name ?? 'Unknown product'}</div>
          </div>
          <Badge tone={CHANNEL_STATUS_TONE[channel.status]}>{CHANNEL_STATUS_LABEL[channel.status]}</Badge>
        </div>
      ))}
    </>
  )
}
