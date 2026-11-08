import { useState } from 'react'
import type { Channel, Id, Product } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Field } from '../../ui'

/** The choice that means "do not filter by product". */
export const ALL_PRODUCTS = ''

// Opportunities and Publications stay top-level screens but work across products (DEC-009). The chosen product is
// kept per screen for as long as the application runs, so leaving a screen and coming back keeps the filter.
// It is not put into the address: the shell reads the whole hash as the screen name.
const remembered = new Map<string, Id | ''>()

export function useProductFilter(screen: string): [Id | '', (id: Id | '') => void] {
  const [productId, setProductId] = useState<Id | ''>(remembered.get(screen) ?? ALL_PRODUCTS)
  return [
    productId,
    (id) => {
      remembered.set(screen, id)
      setProductId(id)
    }
  ]
}

export interface ProductDirectory {
  products: Product[]
  channels: Channel[]
  /** Both lists have arrived, so a product filter can be applied without showing a wrong, empty result. */
  ready: boolean
  error: string | null
  /** The product filter that applies: a remembered product that no longer exists falls back to all products. */
  effective(productId: Id | ''): Id | ''
  /** The channels of the product (all channels when no product is chosen). */
  channelsOf(productId: Id | ''): Channel[]
  productNameOfChannel(channelId: Id): string | undefined
  /** "Product · channel", the way a channel is named wherever products are mixed. */
  channelLabel(channel: Channel): string
}

/**
 * Products and channels, loaded once per screen. Filtering is done here, on the client, through the channels'
 * product reference: the interface offers no product filter for opportunities and does not need one.
 */
export function useProductDirectory(): ProductDirectory {
  const productsQuery = useQuery('products.list', undefined, ['products'])
  const channelsQuery = useQuery('channels.list', undefined, ['channels', 'products'])
  const products = productsQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const nameOf = new Map(products.map((p) => [p.id, p.name]))
  const productOfChannel = new Map(channels.map((c) => [c.id, c.productId]))
  const productName = (channel: Channel): string | undefined => nameOf.get(channel.productId)

  return {
    products,
    channels,
    ready: productsQuery.data !== undefined && channelsQuery.data !== undefined,
    error: productsQuery.error ?? channelsQuery.error,
    effective: (productId) => (productId && (productsQuery.data === undefined || products.some((p) => p.id === productId)) ? productId : ALL_PRODUCTS),
    channelsOf: (productId) => (productId ? channels.filter((c) => c.productId === productId) : channels),
    productNameOfChannel: (channelId) => {
      const productId = productOfChannel.get(channelId)
      return productId ? nameOf.get(productId) : undefined
    },
    channelLabel: (channel) => {
      const name = productName(channel)
      return name ? `${name} · ${channel.target}` : channel.target
    }
  }
}

export function ProductFilter({ products, value, onChange }: { products: Product[]; value: Id | ''; onChange: (id: Id | '') => void }) {
  return (
    <Field label="Product">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} data-testid="product-filter">
        <option value={ALL_PRODUCTS}>All products</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  )
}
