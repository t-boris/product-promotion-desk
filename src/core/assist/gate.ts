// What every AI help needs before it asks the engine, refused with the same codes everywhere:
//   engine_unavailable    no engine is selected, or the selected one is not installed or not ready
//   no_approved_passport  the help needs the owner's approved passport and there is none
// A help that only needs an engine (writing a first description, proposing a product from its website) asks for no passport.

import { ApiError } from '../../shared/api'
import type { Product } from '../../shared/types'
import type { Core } from '../core'
import type { AiEngine } from '../ports'
import { found, requireText } from '../channels/errors'
import type { Claim } from './kit'

/** The selected engine, checked to be installed and ready. */
export async function readyEngine(core: Core): Promise<AiEngine> {
  const engine = core.engines.selected()
  if (!engine) throw new ApiError('engine_unavailable', 'No AI engine is selected. Choose Codex or Claude Code in Settings.')
  const status = await engine.check()
  if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)
  return engine
}

export interface AssistContext {
  product: Product
  engine: AiEngine
  /** The approved statements only: the passport's own rules keep prohibited and unverified statements out. Empty without a passport. */
  claims: Claim[]
}

/**
 * The product, a ready engine and the approved statements. `passport: 'required'` refuses with no_approved_passport when the
 * owner has not approved one yet; `'optional'` goes on with an empty list, for the helps that come before the passport.
 */
export async function prepareAssist(core: Core, rawProductId: unknown, options: { passport: 'required' | 'optional' }): Promise<AssistContext> {
  const productId = requireText(rawProductId, 'The product')
  const product = found(() => core.repos.product(productId), 'The product')
  const knowledge = core.services.knowledge
  const approved = knowledge !== undefined && knowledge.activeVersionId(product.id) !== null
  if (!approved && options.passport === 'required') {
    throw new ApiError('no_approved_passport', 'Approve the product passport first so the suggestions fit it')
  }
  const engine = await readyEngine(core)
  const claims = approved && knowledge ? knowledge.approvedClaims(product.id).map((claim) => ({ section: claim.section, text: claim.text })) : []
  return { product, engine, claims }
}
