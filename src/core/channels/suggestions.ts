// "Suggest channels with AI" (DEC-009): ideas for where this product's audience talks, from its approved passport.
// Nothing is connected here. Every idea is unverified; the owner decides, and the channel is assessed after it is connected.

import { ApiError } from '../../shared/api'
import type { ChannelSuggestion, PassportSection, Product } from '../../shared/types'
import type { Core } from '../core'
import { UNIVERSAL_CONNECTOR_ID } from '../connector-registry'
import { AiError, type AiEngine, type ConnectorRegistry } from '../ports'
import type { suggestChannels } from './ai-help'
import { found, requireText } from './errors'
import { listPlatforms } from './platforms'
import { addressOnPlatform, expandHandle, presetFor } from './presets'

/** The AI helper this service calls (ai-help.ts); injectable so tests can script it. */
export interface SuggestHelp {
  suggestChannels: typeof suggestChannels
}

/**
 * An idea is only useful when its address can be read by the connector of its platform: the "Use this" button fills
 * the connect form with it. Descriptions, sentences and half addresses are dropped here, whatever the AI answered.
 */
export function connectableSuggestions(connectors: ConnectorRegistry, suggestions: ChannelSuggestion[]): ChannelSuggestion[] {
  return suggestions.filter((suggestion) => {
    const preset = presetFor(suggestion.platform)
    const connector =
      suggestion.platform === 'other' || preset
        ? connectors.get(UNIVERSAL_CONNECTOR_ID)
        : connectors.list().find((c) => c.platform === suggestion.platform && c.id !== UNIVERSAL_CONNECTOR_ID)
    if (!connector) return false
    try {
      // A named platform takes a handle too ("@brand"), and the address must be on that platform's own domains.
      const target = preset ? expandHandle(preset, suggestion.target) : suggestion.target
      if (!connector.matches(target)) return false
      const normalized = connector.normalizeTarget(target)
      return preset ? addressOnPlatform(preset, normalized.url) : true
    } catch {
      return false
    }
  })
}

/**
 * What every "suggest with AI" feature needs first: the product, an approved passport and a ready engine, refused with the
 * same codes everywhere (no_approved_passport, engine_unavailable). The claims are the approved ones only: the passport's own
 * rules keep prohibited and unverified statements out of the list.
 */
export async function prepareSuggestion(core: Core, rawProductId: unknown): Promise<{ product: Product; engine: AiEngine; claims: { section: PassportSection; text: string }[] }> {
  const productId = requireText(rawProductId, 'The product')
  const product = found(() => core.repos.product(productId), 'The product')
  const knowledge = core.services.knowledge
  if (!knowledge || knowledge.activeVersionId(product.id) === null) {
    throw new ApiError('no_approved_passport', 'Approve the product passport first so the suggestions fit it')
  }
  const engine = core.engines.selected()
  if (!engine) throw new ApiError('engine_unavailable', 'No AI engine is selected. Choose Codex or Claude Code in Settings.')
  const status = await engine.check()
  if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)
  return { product, engine, claims: knowledge.approvedClaims(product.id).map((claim) => ({ section: claim.section, text: claim.text })) }
}

export class SuggestionService {
  constructor(
    private readonly core: Core,
    private readonly ai: SuggestHelp
  ) {}

  async suggest(args: { productId: string }): Promise<ChannelSuggestion[]> {
    const { product, engine, claims } = await prepareSuggestion(this.core, args.productId)

    const input = {
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      claims,
      platforms: listPlatforms(this.core.connectors),
      connected: this.core.repos
        .listChannels()
        .filter((channel) => channel.productId === product.id)
        .map((channel) => `${channel.platform}: ${channel.target}`)
    }
    try {
      const answered = await this.ai.suggestChannels(engine, input)
      const suggestions = connectableSuggestions(this.core.connectors, answered)
      const dropped = answered.length - suggestions.length
      this.core.log.info(
        'channels',
        `Suggested ${suggestions.length} channel${suggestions.length === 1 ? '' : 's'} for ${product.name}${dropped > 0 ? ` (${dropped} left out: the address could not be read)` : ''}. None is connected or verified.`
      )
      return suggestions
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
  }
}
