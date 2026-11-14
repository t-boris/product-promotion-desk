import type { Channel, ChannelStatus, Product } from '../../../../shared/types'
import { Badge, EmptyState } from '../../ui'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE } from './model'

/** The states in which the owner has to act: they are tags. The other states are a dot and their words. */
const NEEDS_YOU: ChannelStatus[] = ['needs_user', 'error']

/** The channels of this product on one list panel: the address on one line, the product under it, and the channel's state. */
export function ChannelList({ channels, products, selectedId, onSelect }: { channels: Channel[]; products: Product[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (channels.length === 0) return <EmptyState art="channel" title="No channels yet">Connect your first channel above.</EmptyState>
  return (
    <div className="panel" data-testid="channel-list">
      {channels.map((channel) => {
        const active = channel.id === selectedId
        const needsYou = NEEDS_YOU.includes(channel.status)
        return (
          <div
            key={channel.id}
            className={`panel-row${active ? ' active' : ''}`}
            onClick={() => onSelect(channel.id)}
            role="button"
            tabIndex={0}
            aria-current={active ? 'true' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(channel.id)
              }
            }}
            data-testid={`channel-row-${channel.id}`}
          >
            <div className="panel-row-top">
              <span className="panel-row-title">{channel.target}</span>
              {needsYou && <Badge tone={CHANNEL_STATUS_TONE[channel.status]}>{CHANNEL_STATUS_LABEL[channel.status]}</Badge>}
            </div>
            <div className="panel-row-line">{products.find((p) => p.id === channel.productId)?.name ?? 'Unknown product'}</div>
            {!needsYou && (
              <div className="panel-row-line">
                <span className="dot-line">
                  <span className={`dot ${CHANNEL_STATUS_TONE[channel.status]}`} aria-hidden="true" />
                  {CHANNEL_STATUS_LABEL[channel.status]}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
