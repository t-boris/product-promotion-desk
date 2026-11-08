import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PRODUCT_TAB, parseHash, productHref, type ProductTab } from '../../route'

/**
 * The selected product and tab live in the hash (`#/products/<productId>/<tab>`), so a link from the attention
 * list, a bookmark or the back button all land on the same screen, and what the user picks is written back.
 */
export function useProductRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const tab = route.tab ?? DEFAULT_PRODUCT_TAB

  const go = useCallback((productId: string | null, nextTab: ProductTab) => {
    // Optimistic local update so the screen follows the click without waiting for the hashchange event.
    setRoute({ page: 'products', productId, tab: productId ? nextTab : null })
    window.location.hash = productHref(productId, nextTab)
  }, [])

  return {
    productId: route.productId,
    tab,
    /** Select a product (null clears the selection). The current tab is kept so products can be compared tab by tab. */
    selectProduct: (productId: string | null, nextTab: ProductTab = tab) => go(productId, nextTab),
    selectTab: (nextTab: ProductTab) => go(route.productId, nextTab)
  }
}
