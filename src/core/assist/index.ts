// The assist module: the AI helps that are not tied to one screen's service: assist.refine (write or improve one text field) and
// products.draftFromSite (propose a product's name and description from its website).

import type { Core } from '../core'
import { AssistService } from './service'
import { SiteProductService } from './site-product'

export function register(core: Core): void {
  const assist = new AssistService(core)
  const siteProducts = new SiteProductService(core)
  core.router.register({
    'assist.refine': (args) => assist.refine(args),
    'products.draftFromSite': (args) => siteProducts.draft(args)
  })
}
