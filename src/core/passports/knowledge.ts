import type { Claim, Id } from '../../shared/types'
import type { KnowledgeProvider } from '../services'
import type { ClaimsRepo } from './claims-repo'
import type { ProductStore } from './store'

/**
 * What the rest of the application may know about a product. Only the approved passport version is visible: a draft
 * under review never leaks into promotional text, and prohibited statements are reported separately so drafting can
 * avoid them.
 */
export class PassportKnowledge implements KnowledgeProvider {
  constructor(
    private readonly products: ProductStore,
    private readonly repo: ClaimsRepo
  ) {}

  private active(productId: Id): Claim[] {
    const versionId = this.activeVersionId(productId)
    return versionId ? this.repo.claims(versionId) : []
  }

  activeVersionId(productId: Id): Id | null {
    try {
      return this.products.product(productId).activePassportVersionId
    } catch {
      return null
    }
  }

  approvedClaims(productId: Id): Claim[] {
    return this.active(productId).filter((c) => c.status === 'approved')
  }

  prohibitedClaims(productId: Id): Claim[] {
    return this.active(productId).filter((c) => c.status === 'prohibited')
  }
}
