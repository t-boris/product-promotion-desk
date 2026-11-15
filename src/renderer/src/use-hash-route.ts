import { useEffect, useState } from 'react'
import { productChoice } from './product-context'
import { PAGE_IDS, resolveRoute, type PageId } from './route'

/**
 * Reads the hash the window shows and settles it: an address of the old menu is replaced by the new one (no history entry), and the
 * product an address names (`?product=`, or the product of an old `#/products/<id>` link) becomes the current product and is taken out
 * of the address, so a bookmark or a reload shows the product the owner chose last and not the one the link happened to carry.
 */
function settle(): string {
  const route = resolveRoute(window.location.hash)
  if (route.productId) productChoice.choose(route.productId)
  if (route.moved) window.history.replaceState(null, '', route.hash)
  return window.location.hash
}

/** The screen the hash asks for; an address that names none shows the first screen. */
export function useHashRoute(): PageId {
  // Settled before the first render, so no screen loads for the previous product first; nothing listens to the choice yet, so no screen is told mid-render.
  const [hash, setHash] = useState(settle)
  useEffect(() => {
    const onChange = (): void => setHash(settle())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return resolveRoute(hash).page ?? PAGE_IDS[0]
}
