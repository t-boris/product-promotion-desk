// Wires the passports services together for one core.

import type { PassportView } from '../../shared/types'
import { PASSPORT_SECTIONS, type Id } from '../../shared/types'
import type { Core } from '../core'
import { AnalysisRunner } from './analysis'
import { ClaimService } from './claim-service'
import { ClaimsRepo } from './claims-repo'
import { PassportKnowledge } from './knowledge'
import { ProductStore } from './store'
import { PassportVersions } from './versions'

export class PassportModule {
  readonly store: ProductStore
  readonly repo: ClaimsRepo
  readonly versions: PassportVersions
  readonly claims: ClaimService
  readonly analysis: AnalysisRunner
  readonly knowledge: PassportKnowledge

  constructor(readonly core: Core) {
    this.store = new ProductStore(core.db, core.clock)
    this.repo = new ClaimsRepo(core.db, core.clock)
    this.versions = new PassportVersions(core.db, this.store, this.repo)
    this.claims = new ClaimService(this.store, this.repo, this.versions, () => core.clock.now().toISOString())
    this.analysis = new AnalysisRunner(core, this.store, this.claims, this.versions)
    this.knowledge = new PassportKnowledge(this.store, this.repo)
  }

  /** Everything the passport screen needs: the draft being edited (else the approved version), sources and stages. */
  view(productId: Id): PassportView {
    const product = this.store.product(productId)
    const { version, claims } = this.versions.working(productId)
    const order = (section: string): number => PASSPORT_SECTIONS.indexOf(section as (typeof PASSPORT_SECTIONS)[number])
    return {
      product,
      version,
      claims: [...claims].sort((a, b) => order(a.section) - order(b.section)),
      sources: this.store.sources(productId),
      stages: this.store.stages(productId)
    }
  }

  /** The products, passport and analysis views changed. */
  touch(): void {
    this.core.events.changed('products', 'passport')
  }
}
