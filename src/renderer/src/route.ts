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
