import type { AttentionItem, Channel, Product } from '../../../shared/types'
import { ACCOUNTS_HREF, productHref } from '../route'

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
 * link opens that product's Channels tab. An account belongs to no product (DEC-015): its link opens the Accounts section, and
 * the products that use it are named. The attention item carries only the channel or account id, so everything is looked up here.
 */
export function fixLinkFor(item: AttentionItem, { channels, products }: LinkSources): FixLink | null {
  let productId: string | null = null
  switch (item.refType) {
    case 'channel':
      productId = channels.find((c) => c.id === item.refId)?.productId ?? null
      break
    case 'account': {
      const users = [...new Set(channels.filter((c) => c.accountId === item.refId).map((c) => c.productId))]
      const names = users.flatMap((id) => products.find((p) => p.id === id)?.name ?? [])
      return { href: ACCOUNTS_HREF, label: 'Open Accounts', productName: names.length > 0 ? names.join(', ') : null }
    }
    case 'product':
      return { href: productHref(item.refId), label: 'Open product', productName: products.find((p) => p.id === item.refId)?.name ?? null }
    default:
      return null
  }
  const productName = productId ? (products.find((p) => p.id === productId)?.name ?? null) : null
  if (!productId) return { href: productHref(null), label: 'Open Products', productName: null }
  return { href: productHref(productId, 'channels'), label: productName ? `Open ${productName} channels` : 'Open channels', productName }
}

/** Where the owner connects a channel: the Channels tab of the chosen product, or the product list when no product is
 *  chosen ("All products"), since a channel always belongs to a product (DEC-009). */
export function connectChannelHref(productId: string | null | undefined): string {
  return productId ? productHref(productId, 'channels') : productHref(null)
}
