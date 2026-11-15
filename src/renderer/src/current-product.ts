// The current product (DEC-037): every screen but Accounts, Log and Settings shows one product's work, chosen in the sidebar. This file
// holds the rules and the small store that keeps the choice, with no React and no DOM types, so they are tested from
// src/main/renderer-logic.test.ts. The hook that reads the list of products is `product-context.ts`.

import type { Product } from '../../shared/types'

/** The place the choice is kept in browser storage. The old Products page used this key for "the product seen last", so a choice made before the redesign carries over. */
export const LAST_PRODUCT_KEY = 'ppd.lastProduct'

/** The part of browser storage the choice needs; storage can be missing, blocked or full, and then the choice only lasts while the window is open. */
export interface ProductStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readLastProduct(storage: ProductStorage | undefined): string | null {
  try {
    return storage?.getItem(LAST_PRODUCT_KEY) || null
  } catch {
    return null
  }
}

export function saveLastProduct(storage: ProductStorage | undefined, id: string): void {
  try {
    storage?.setItem(LAST_PRODUCT_KEY, id)
  } catch {
    // Remembering is a convenience; without it the newest product opens.
  }
}

/** What the owner chose, and a product the app itself just made. */
export interface ProductChoice {
  /** The id chosen in the switcher, taken from a link, or remembered from the last session; it may name a product that no longer exists. */
  wanted: string | null
  /**
   * A product that was just created: it is the current product before `products.list` has reloaded and holds it, or the screen would
   * show the previous product for a moment and then jump (BUG-042, BUG-068, BUG-069). Dropped once the list holds it.
   */
  pending: string | null
}

type ProductRef = Pick<Product, 'id' | 'createdAt'>

/** The newest product (the last one made wins a tie), or null for none. */
export function newestProduct<T extends ProductRef>(products: readonly T[]): T | null {
  let newest: T | null = null
  for (const product of products) {
    if (newest === null || product.createdAt >= newest.createdAt) newest = product
  }
  return newest
}

/**
 * The current product. The chosen one while the list holds it, or while it is the product just created; otherwise the newest product (a
 * product that was deleted here or elsewhere, a link to one that does not exist, a first start); null when there is no product at all.
 */
export function resolveCurrentProduct(products: readonly ProductRef[], choice: ProductChoice): string | null {
  if (choice.wanted !== null && (products.some((product) => product.id === choice.wanted) || choice.wanted === choice.pending)) return choice.wanted
  return newestProduct(products)?.id ?? null
}

/** The store of the choice: one per window, read by every screen. Changes are announced to `subscribe`rs, which is the shape `useSyncExternalStore` takes. */
export interface ProductChoiceStore {
  /** The same object until the choice changes, so a subscriber re-renders only on a real change. */
  snapshot(): ProductChoice
  subscribe(listener: () => void): () => void
  /** Choose a product. Remembered in storage. */
  choose(id: string): void
  /** A product was just made and is the current one at once (see `ProductChoice.pending`). */
  chooseCreated(id: string): void
  /** The list now holds the product just created, so it is an ordinary row again. */
  settle(): void
}

export function createProductChoiceStore(storage: ProductStorage | undefined): ProductChoiceStore {
  let choice: ProductChoice = { wanted: readLastProduct(storage), pending: null }
  const listeners = new Set<() => void>()
  const set = (next: ProductChoice): void => {
    if (next.wanted === choice.wanted && next.pending === choice.pending) return
    choice = next
    for (const listener of [...listeners]) listener()
  }
  return {
    snapshot: () => choice,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    choose(id) {
      saveLastProduct(storage, id)
      set({ wanted: id, pending: choice.pending })
    },
    chooseCreated(id) {
      saveLastProduct(storage, id)
      set({ wanted: id, pending: id })
    },
    settle() {
      set({ wanted: choice.wanted, pending: null })
    }
  }
}
