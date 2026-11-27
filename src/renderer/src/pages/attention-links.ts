import type { AttentionItem, Channel, Product } from '../../../shared/types'
import { accountHref, productHref } from '../route'

export interface FixLink {
  href: string
  label: string
  /** The product the problem belongs to, when it could be worked out. */
  productName: string | null
}

export interface LinkSources {
  channels: Channel[]
  products: Product[]
}

/**
 * Where the owner fixes a problem that is not a decision about content. A channel belongs to a product (DEC-009), so its
 * link opens that product's Channels screen. An account belongs to no product (DEC-015): its link opens the Accounts section with that
 * account selected, and the products that use it are named. The attention item carries only the channel or account id, so everything is looked up here.
 */
export function fixLinkFor(item: AttentionItem, { channels, products }: LinkSources): FixLink | null {
  // A trial that is over is answered on the channel's Results tab, where its numbers are.
  if (item.id.startsWith('trial:')) {
    const owner = channels.find((c) => c.id === item.refId)?.productId ?? null
    return { href: `#/channels/${item.refId}/results${owner ? `?product=${owner}` : ''}`, label: 'Open the trial', productName: products.find((p) => p.id === owner)?.name ?? null }
  }
  // A post that took off is read where its numbers are: the channel's Results tab.
  if (item.id.startsWith('tookoff:')) {
    const owner = channels.find((c) => c.id === item.refId)?.productId ?? null
    return { href: `#/channels/${item.refId}/results${owner ? `?product=${owner}` : ''}`, label: 'Open the results', productName: products.find((p) => p.id === owner)?.name ?? null }
  }
  // Dates ahead are prepared on the Posts screen, in the calendar.
  if (item.id.startsWith('seasonal:')) {
    return { href: `#/posts?${new URLSearchParams({ product: item.refId, view: 'calendar' }).toString()}`, label: 'Open the dates ahead', productName: products.find((p) => p.id === item.refId)?.name ?? null }
  }
  let productId: string | null = null
  switch (item.refType) {
    case 'channel':
      productId = channels.find((c) => c.id === item.refId)?.productId ?? null
      break
    case 'account': {
      const users = [...new Set(channels.filter((c) => c.accountId === item.refId).map((c) => c.productId))]
      const names = users.flatMap((id) => products.find((p) => p.id === id)?.name ?? [])
      return { href: accountHref(item.refId), label: 'Open Accounts', productName: names.length > 0 ? names.join(', ') : null }
    }
    case 'product':
      return { href: productHref(item.refId), label: 'Open Setup', productName: products.find((p) => p.id === item.refId)?.name ?? null }
    default:
      return null
  }
  const productName = productId ? (products.find((p) => p.id === productId)?.name ?? null) : null
  if (!productId) return { href: productHref(null), label: 'Open Setup', productName: null }
  return { href: productHref(productId, 'channels'), label: productName ? `Open ${productName} channels` : 'Open channels', productName }
}

/** Where the owner connects a channel: the Channels screen of the product, or Setup (where a product is added) when there is none,
 *  since a channel always belongs to a product (DEC-009). */
export function connectChannelHref(productId: string | null | undefined): string {
  return productId ? productHref(productId, 'channels') : productHref(null)
}
