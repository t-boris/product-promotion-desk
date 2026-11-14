// Hash routes shared by the shell, the product page and the attention list. Kept apart from the components so the
// rules (which hashes exist, where old links go) live in one place.

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

/** Reads `#/page`, `#/products/<productId>` and `#/products/<productId>/<tab>`. */
export function parseHash(hash: string): ParsedHash {
  const [page = '', productId, tab] = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((segment) => segment !== '')
  const onProductPage = page === 'products' && !!productId
  return {
    page,
    productId: onProductPage ? safeDecode(productId) : null,
    tab: onProductPage && isProductTab(tab) ? tab : null
  }
}

/** Link to a product (and optionally one of its tabs); without a product, the product list. */
export function productHref(productId: string | null | undefined, tab?: ProductTab): string {
  if (!productId) return '#/products'
  const base = `#/products/${encodeURIComponent(productId)}`
  return tab ? `${base}/${tab}` : base
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

/** What the Accounts section was asked to show: the new-account form, possibly with a role already filled in. */
export interface AccountsRoute {
  adding: boolean
  role: { name: string; voice: string } | null
}

/** Link to the new-account form of the Accounts section; "Use this role" on the product page passes the role along. */
export function accountsNewHref(role?: { name: string; voice: string }): string {
  if (!role) return '#/accounts/new'
  return `#/accounts/new?${new URLSearchParams({ name: role.name, voice: role.voice }).toString()}`
}

/** Reads `#/accounts` and `#/accounts/new?name=…&voice=…`. */
export function parseAccountsHash(hash: string): AccountsRoute {
  const body = hash.replace(/^#\/?/, '')
  const at = body.indexOf('?')
  const segments = (at < 0 ? body : body.slice(0, at)).split('/').filter((segment) => segment !== '')
  const adding = segments[0] === 'accounts' && segments[1] === 'new'
  const params = new URLSearchParams(at < 0 ? '' : body.slice(at + 1))
  const name = params.get('name')?.trim() ?? ''
  return { adding, role: adding && name ? { name, voice: params.get('voice')?.trim() ?? '' } : null }
}
