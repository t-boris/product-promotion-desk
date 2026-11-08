// "Plan with AI" for one channel (DEC-013): what to do on this channel, from the approved passport, the goals and the platform.
// The plan is advice stored with the channel. Nothing is connected, assessed, drafted or published here, and nothing in it is executed.

import { ApiError } from '../../shared/api'
import type { Channel, PlatformInfo } from '../../shared/types'
import type { Core } from '../core'
import { AiError } from '../ports'
import type { planChannel } from './ai-help'
import { found, requireText } from './errors'
import { listPlatforms } from './platforms'
import type { ChannelsStore } from './store'
import { prepareSuggestion } from './suggestions'

/** The AI helper this service calls (ai-help.ts); injectable so tests can script it. */
export interface PlanHelp {
  planChannel: typeof planChannel
}

export class ChannelPlanService {
  constructor(
    private readonly core: Core,
    private readonly ai: PlanHelp,
    private readonly store: ChannelsStore
  ) {}

  /** Asks the AI for a plan and stores it, replacing the previous one. */
  async prepare(args: { channelId: string }): Promise<Channel> {
    const channelId = requireText(args.channelId, 'The channel')
    const channel = found(() => this.core.repos.channel(channelId), 'The channel')
    const { product, engine, claims } = await prepareSuggestion(this.core, channel.productId)

    const platform: PlatformInfo = listPlatforms(this.core.connectors).find((p) => p.platform === channel.platform) ?? {
      connectorId: channel.connectorId,
      platform: channel.platform,
      label: channel.platform,
      prepared: false,
      loginUrl: ''
    }
    const input = {
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      claims,
      goals: product.goals.map((g) => ({ targetAction: g.targetAction, successMetrics: g.successMetrics, notes: g.notes })),
      platform,
      channel: { target: channel.target, url: channel.url },
      roles: this.core.repos.accountsOfProduct(product.id).flatMap((a) => (a.platform === channel.platform && a.role ? [a.role] : [])),
      abilities: channel.capabilities.map((c) => ({ key: c.key, status: c.status }))
    }
    try {
      const draft = await this.ai.planChannel(engine, input)
      const updated = this.store.updateChannel(channel.id, { plan: { ...draft, generatedAt: this.core.clock.now().toISOString(), engineId: engine.id } })
      this.core.log.info('channels', `Plan prepared for ${channel.target} (${draft.steps.length} step${draft.steps.length === 1 ? '' : 's'}). It is advice only: nothing was done or published.`, channel.id)
      this.core.events.changed('channels')
      return updated
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('plan_failed', error.message)
      throw error
    }
  }
}
