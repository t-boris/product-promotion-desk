// Hash routes shared by the shell, the product page and the attention list. Kept apart from the components so the
// rules (which hashes exist, where old links go) live in one place.

import type { ApiEvent } from '../../shared/api'

/** Tabs of the product page in display order (DEC-009: Channels and Results live here, not in the main menu). */
export const PRODUCT_TABS = ['sources', 'passport', 'analysis', 'goal', 'channels', 'results'] as const
export type ProductTab = (typeof PRODUCT_TABS)[number]

export const DEFAULT_PRODUCT_TAB: ProductTab = 'sources'

/** The account library (DEC-015). */
export const ACCOUNTS_HREF = '#/accounts'

/** Menu entries that moved into the product page. Old links and bookmarks still land somewhere useful. */
export const MOVED_PAGES: Record<string, string> = { channels: 'products', results: 'products' }

export function isProductTab(value: string | undefined): value is ProductTab {
  return PRODUCT_TABS.some((tab) => tab === value)
}

export interface ParsedHash {
  /** First path segment, e.g. "products". Empty when there is no hash. */
  page: string
  /** `#/products/<productId>/…` only. */
  productId: string | null
  /** A known tab, or null when the hash names none (or an unknown one). */
  tab: ProductTab | null
}

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The path segments of a hash, and the query after them. */
function splitHash(hash: string): { segments: string[]; query: URLSearchParams } {
  const body = hash.replace(/^#\/?/, '')
  const at = body.indexOf('?')
  return { segments: (at < 0 ? body : body.slice(0, at)).split('/').filter((segment) => segment !== ''), query: new URLSearchParams(at < 0 ? '' : body.slice(at + 1)) }
}

/** Reads `#/page`, `#/products/<productId>` and `#/products/<productId>/<tab>`; a query after the path is not part of it. */
export function parseHash(hash: string): ParsedHash {
  const [page = '', productId, tab] = splitHash(hash).segments
  const onProductPage = page === 'products' && !!productId
  return {
    page,
    productId: onProductPage ? safeDecode(productId) : null,
    tab: onProductPage && isProductTab(tab) ? tab : null
  }
}

/**
 * Link to a product (and optionally one of its tabs); without a product, the product list. On the Channels tab, `accountId` is the account
 * "Connect a channel" chooses first: the one just added from that tab (BUG-063).
 */
export function productHref(productId: string | null | undefined, tab?: ProductTab, accountId?: string): string {
  if (!productId) return '#/products'
  const base = `#/products/${encodeURIComponent(productId)}`
  if (!tab) return base
  return tab === 'channels' && accountId ? `${base}/${tab}?${new URLSearchParams({ account: accountId }).toString()}` : `${base}/${tab}`
}

/** The account a `#/products/<productId>/channels?account=<accountId>` link asks "Connect a channel" to choose first, or null. */
export function channelsAccountOf(hash: string): string | null {
  const { segments: [page, productId, tab], query } = splitHash(hash)
  return page === 'products' && productId && tab === 'channels' ? query.get('account')?.trim() || null : null
}

/** Link to Publications, filtered by one product when one is given (the last stage of a product's launch path). */
export function publicationsHref(productId?: string | null): string {
  return productId ? `#/publications/${encodeURIComponent(productId)}` : '#/publications'
}

/** The product a `#/publications/<productId>` link asks Publications to show, or null. */
export function publicationsProductOf(hash: string): string | null {
  const [page, productId] = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((segment) => segment !== '')
  return page === 'publications' && productId ? safeDecode(productId) : null
}

/** What the Accounts section was asked to show: the new-account form (possibly with a role already filled in, or the product it was opened from), or one account. */
export interface AccountsRoute {
  adding: boolean
  /** `#/accounts/<accountId>`: the account to select. Null for the bare list and for the new-account form. */
  accountId: string | null
  /** `#/accounts/new?product=<productId>`: the product the form was opened from, which the app returns to afterwards. Only the form carries one. */
  productId: string | null
  role: { name: string; voice: string } | null
}

/** Link to one account of the Accounts section (the account an Attention item is about). */
export function accountHref(accountId: string): string {
  return `${ACCOUNTS_HREF}/${encodeURIComponent(accountId)}`
}

/**
 * Link to the new-account form of the Accounts section. "Use this role" on the product page passes the role along; a product's Channels tab
 * passes the product, so that the new account is made for it and the app returns to that tab afterwards.
 */
export function accountsNewHref(role?: { name: string; voice: string }, productId?: string): string {
  const params = new URLSearchParams()
  if (role) {
    params.set('name', role.name)
    params.set('voice', role.voice)
  }
  if (productId) params.set('product', productId)
  const query = params.toString()
  return query ? `#/accounts/new?${query}` : '#/accounts/new'
}

/** Reads `#/accounts`, `#/accounts/<accountId>` and `#/accounts/new?name=…&voice=…&product=…`. */
export function parseAccountsHash(hash: string): AccountsRoute {
  const body = hash.replace(/^#\/?/, '')
  const at = body.indexOf('?')
  const segments = (at < 0 ? body : body.slice(0, at)).split('/').filter((segment) => segment !== '')
  const onAccounts = segments[0] === 'accounts'
  const adding = onAccounts && segments[1] === 'new'
  const params = new URLSearchParams(at < 0 ? '' : body.slice(at + 1))
  const name = params.get('name')?.trim() ?? ''
  return {
    adding,
    accountId: onAccounts && !adding && segments[1] ? safeDecode(segments[1]) : null,
    productId: adding ? params.get('product')?.trim() || null : null,
    role: adding && name ? { name, voice: params.get('voice')?.trim() ?? '' } : null
  }
}

/** The hash a `navigate` event from the main process asks the window to show (the "Settings…" menu item), or null for any other event or a malformed hash. */
export function navigateHashOf(event: ApiEvent): string | null {
  return event.type === 'navigate' && /^#\/\S*$/.test(event.hash) ? event.hash : null
}
