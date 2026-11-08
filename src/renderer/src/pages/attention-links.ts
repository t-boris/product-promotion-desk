import type { Account, AttentionItem, Channel, Product } from '../../../shared/types'
import { productHref } from '../route'

export interface FixLink {
  href: string
  label: string
  /** The product the problem belongs to, when it could be worked out. */
  productName: string | null
}

export interface LinkSources {
  channels: Channel[]
  accounts: Account[]
  products: Product[]
}

/**
 * Where the owner fixes a problem that is not a decision about content. Channels, accounts and results belong to a
 * product (DEC-009), so the link opens that product's Channels tab. The attention item carries only the channel or
 * account id, so the product is looked up here.
 */
export function fixLinkFor(item: AttentionItem, { channels, accounts, products }: LinkSources): FixLink | null {
  let productId: string | null = null
  switch (item.refType) {
    case 'channel':
      productId = channels.find((c) => c.id === item.refId)?.productId ?? null
      break
    case 'account':
      // An account made before products owned accounts has no product of its own; its channels know it.
      productId = accounts.find((a) => a.id === item.refId)?.productId ?? channels.find((c) => c.accountId === item.refId)?.productId ?? null
      break
    case 'product':
      return { href: productHref(item.refId), label: 'Open product', productName: products.find((p) => p.id === item.refId)?.name ?? null }
    default:
      return null
  }
  const productName = productId ? (products.find((p) => p.id === productId)?.name ?? null) : null
  if (!productId) return { href: productHref(null), label: 'Open Products', productName: null }
  return { href: productHref(productId, 'channels'), label: productName ? `Open ${productName} channels` : 'Open channels', productName }
}
