// "Suggest channels with AI" (DEC-009): ideas for where this product's audience talks, from its approved passport.
// Nothing is connected here. Every idea is unverified; the owner decides, and the channel is assessed after it is connected.

import { ApiError } from '../../shared/api'
import type { ChannelSuggestion } from '../../shared/types'
import type { Core } from '../core'
import { AiError } from '../ports'
import type { suggestChannels } from './ai-help'
import { found, requireText } from './errors'
import { listPlatforms } from './platforms'

/** The AI helper this service calls (ai-help.ts); injectable so tests can script it. */
export interface SuggestHelp {
  suggestChannels: typeof suggestChannels
}

export class SuggestionService {
  constructor(
    private readonly core: Core,
    private readonly ai: SuggestHelp
  ) {}

  async suggest(args: { productId: string }): Promise<ChannelSuggestion[]> {
    const productId = requireText(args.productId, 'The product')
    const product = found(() => this.core.repos.product(productId), 'The product')
    const knowledge = this.core.services.knowledge
    if (!knowledge || knowledge.activeVersionId(product.id) === null) {
      throw new ApiError('no_approved_passport', 'Approve the product passport first so the suggestions fit it')
    }
    const engine = this.core.engines.selected()
    if (!engine) throw new ApiError('engine_unavailable', 'No AI engine is selected. Choose Codex or Claude Code in Settings.')
    const status = await engine.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)

    const input = {
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      // Approved claims only: the passport's own rules keep prohibited and unverified statements out of this list.
      claims: knowledge.approvedClaims(product.id).map((claim) => ({ section: claim.section, text: claim.text })),
      platforms: listPlatforms(this.core.connectors),
      connected: this.core.repos
        .listChannels()
        .filter((channel) => channel.productId === product.id)
        .map((channel) => `${channel.platform}: ${channel.target}`)
    }
    try {
      const suggestions = await this.ai.suggestChannels(engine, input)
      this.core.log.info('channels', `Suggested ${suggestions.length} channel${suggestions.length === 1 ? '' : 's'} for ${product.name}. None is connected or verified.`)
      return suggestions
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
  }
}
