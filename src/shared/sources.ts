// Rules about product sources that the interface and the core must agree on.

import type { Product, ProductSource } from './types'

/**
 * The website address and the description of a product are mirrored as sources (the analysis reads only sources). Such a source is
 * the same text the product header already shows, so it is marked "From product details" and kept short instead of repeating the
 * description in full (QA finding 20), and it changes only with Edit details (sources.update refuses it, BUG-034). A text the owner
 * added and named himself is never matched, even when it is equal to the description.
 */
export function isMirroredSource(source: Pick<ProductSource, 'kind' | 'ref' | 'label'>, product: Pick<Product, 'websiteUrl' | 'description'>): boolean {
  if (source.kind === 'url') return product.websiteUrl !== null && source.ref === product.websiteUrl
  if (source.kind === 'text') return product.description !== null && source.ref === product.description && source.label === 'Description'
  return false
}
