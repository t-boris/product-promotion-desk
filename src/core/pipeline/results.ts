// Data for the product page's Results tab (REQ-006, DEC-009): promotion goals and the latest platform metrics per channel. Version 1 never
// measures business conversions (DEC-002), which the view states explicitly instead of leaving it implicit.

import { ApiError } from '../../shared/api'
import type { Id, Product, ResultsView } from '../../shared/types'
import type { Core } from '../core'
import { latestSnapshots } from './metrics'

export function buildResultsView(core: Core, productId?: Id): ResultsView {
  let products: Product[]
  if (productId) {
    try {
      products = [core.repos.product(productId)]
    } catch {
      throw new ApiError('not_found', `Product not found: ${productId}`)
    }
  } else {
    products = core.repos.listProducts()
  }
  const ids = new Set(products.map((p) => p.id))
  return {
    goals: products.map((p) => ({ productId: p.id, productName: p.name, goals: p.goals })),
    channels: core.repos
      .listChannels()
      .filter((c) => ids.has(c.productId))
      .map((channel) => ({ channel, metrics: latestSnapshots(core, channel.id) })),
    businessConversions: 'not_measured'
  }
}
