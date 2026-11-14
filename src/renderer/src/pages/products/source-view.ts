// How a source is shown in the Sources tab. Pure, so the rules are tested without the interface.

import type { Product, ProductSource } from '../../../../shared/types'

/**
 * The website address and the description of a product are mirrored as sources (the analysis reads only sources). Such a source is
 * the same text the product header already shows, so it is marked "From product details" and kept short instead of repeating the
 * description in full (QA finding 20). A text the owner added himself is never matched, even when it happens to be equal.
 */
export function isMirroredSource(source: Pick<ProductSource, 'kind' | 'ref' | 'label'>, product: Pick<Product, 'websiteUrl' | 'description'>): boolean {
  if (source.kind === 'url') return product.websiteUrl !== null && source.ref === product.websiteUrl
  if (source.kind === 'text') return product.description !== null && source.ref === product.description && source.label === 'Description'
  return false
}

/** A text source is read as sentences (the interface font, wraps at words); an address or a path is a code-like string. */
export const isProse = (source: Pick<ProductSource, 'kind'>): boolean => source.kind === 'text'
