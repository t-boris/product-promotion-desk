import { useEffect, useSyncExternalStore } from 'react'
import type { Id, Product } from '../../shared/types'
import { createProductChoiceStore, resolveCurrentProduct, type ProductStorage } from './current-product'
import { useQuery } from './hooks'

/** The browser's storage, or undefined where the browser refuses even to hand it out. */
function browserStorage(): ProductStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** The one choice of the window: the sidebar's switcher, a link with `?product=` and every screen read and write this store. */
export const productChoice = createProductChoiceStore(browserStorage())

const NO_PRODUCTS: Product[] = []

export interface CurrentProduct {
  products: Product[]
  /** The product every screen shows: the chosen one, else the newest; null while loading and when there is no product. */
  current: Product | null
  /** Choose a product (the switcher, a link). */
  setCurrent: (id: Id) => void
  /** A product the app just made is the current one at once, before the list holds it. */
  setCreated: (id: Id) => void
  /** The list has not answered yet, or has not caught up with a product that was just made. */
  loading: boolean
  error: string | null
}

/**
 * The current product (DEC-037). The choice is kept in browser storage under `ppd.lastProduct` and works without it; the product
 * list is the same `products.list` every screen loads, so a product added, renamed or deleted anywhere is followed here.
 */
export function useCurrentProduct(): CurrentProduct {
  const query = useQuery('products.list', undefined, ['products', 'passport'])
  const choice = useSyncExternalStore(productChoice.subscribe, productChoice.snapshot)
  const products = query.data ?? NO_PRODUCTS
  const currentId = query.data ? resolveCurrentProduct(products, choice) : null
  // Once the list holds the product that was just made it is an ordinary row, so a later deletion elsewhere selects the newest again.
  useEffect(() => {
    if (choice.pending !== null && products.some((product) => product.id === choice.pending)) productChoice.settle()
  }, [choice.pending, products])
  const current = products.find((product) => product.id === currentId) ?? null
  return {
    products,
    current,
    setCurrent: productChoice.choose,
    setCreated: productChoice.chooseCreated,
    // Also while the product just made is the current one but the list has not reloaded to hold it: a moment, never the previous product.
    loading: (query.data === undefined && query.error === null) || (currentId !== null && current === null),
    error: query.error
  }
}
