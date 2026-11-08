// API handlers of the discussion → draft → approval → sending flow. Handlers stay thin: they validate state,
// call the flow services and return the shapes of src/shared/api.ts.

import { ApiError } from '../../shared/api'
import type { Channel, Id, Run } from '../../shared/types'
import type { Core } from '../core'
import { buildCard } from './cards'
import type { DraftingFlow } from './drafting'
import { SendBlockedError } from './gate'
import type { MonitorFlow } from './monitor'
import type { PublicationsFlow } from './publications'
import type { ReviewFlow } from './review'
import { listDiscussions, selectOlder } from './selection'
import type { SendingFlow } from './sending'
import type { FlowStore } from './store'

export interface FlowServices {
  core: Core
  store: FlowStore
  review: ReviewFlow
  monitor: MonitorFlow
  drafting: DraftingFlow
  sending: SendingFlow
  publications: PublicationsFlow
}

export function registerFlowApi({ core, store, review, monitor, drafting, sending, publications }: FlowServices): void {
  const card = (id: Id) => buildCard(core, store, store.requireOpportunity(id))

  /** A blocked send becomes a readable API error carrying the gate's reasons. */
  const sendManually = async (id: Id): Promise<void> => {
    try {
      await sending.send(id)
    } catch (error) {
      if (error instanceof SendBlockedError) throw new ApiError('send_blocked', error.message)
      throw error
    }
  }

  const setChannelStatus = (channel: Channel, status: Channel['status'], statusDetail: string): Channel => {
    store.updateChannel(channel.id, { status, statusDetail })
    core.events.changed('attention')
    return core.repos.channel(channel.id)
  }

  core.router.register({
    // ───────────── channel observation ─────────────
    'channels.discussions': ({ channelId }) => {
      store.requireChannel(channelId)
      return listDiscussions(core, channelId)
    },
    'channels.selectOlder': ({ channelId, discussionIds, selected }) => selectOlder(core, store, channelId, discussionIds, selected),

    'channels.activate': async ({ channelId }) => {
      const channel = store.requireChannel(channelId)
      if (channel.status === 'paused') throw new ApiError('channel_paused', 'The channel is paused. Resume it first.')
      const read = channel.capabilities.find((c) => c.key === 'read_comments')
      if (read && (read.status === 'unavailable' || read.status === 'restricted')) {
        throw new ApiError('read_unavailable', `Comments cannot be read on this channel (${read.status}${read.detail ? `: ${read.detail}` : ''}), so it cannot be monitored.`)
      }
      if (channel.baselineDoneAt === null) {
        // The first cycle stores what exists today as the baseline; it prepares no replies for it.
        const result = await core.runs.track('monitor', { channelId, productId: channel.productId }, async () => {
          const outcome = await monitor.runChannel(channelId)
          return { status: outcome.status, summary: `Baseline: ${outcome.summary}` }
        })
        const after = core.repos.channel(channelId)
        if (!result || result.status !== 'ok' || after.baselineDoneAt === null) {
          throw new ApiError('activation_failed', result?.summary ?? 'The first observation cycle failed.')
        }
      }
      return setChannelStatus(core.repos.channel(channelId), 'active', '')
    },

    'channels.checkNow': async ({ channelId }) => {
      const channel = store.requireChannel(channelId)
      if (channel.status === 'paused') throw new ApiError('channel_paused', 'The channel is paused. Resume it first.')
      await core.runs.track('monitor', { channelId, productId: channel.productId }, async () => {
        const outcome = await monitor.runChannel(channelId)
        const prepared = await drafting.processChannel(channelId)
        const extra = prepared.prepared + prepared.needsUser + prepared.autoSent > 0 ? `; ${prepared.prepared} draft(s) prepared, ${prepared.autoSent} sent automatically, ${prepared.needsUser} need you` : ''
        return { status: outcome.status, summary: `${outcome.summary}${extra}` }
      })
      const run: Run | undefined = core.runs.list({ channelId, limit: 5 }).find((r) => r.kind === 'monitor')
      if (!run) throw new ApiError('internal', 'The check ran but its record is missing.')
      return run
    },

    'channels.setPaused': ({ channelId, paused }) => {
      const channel = store.requireChannel(channelId)
      if (paused) return setChannelStatus(channel, 'paused', 'Paused by you')
      return setChannelStatus(channel, channel.baselineDoneAt ? 'active' : 'setup', '')
    },

    // ───────────── review queues ─────────────
    'opportunities.list': (args) => {
      const filter = args ?? {}
      return store.list({ channelId: filter.channelId, kind: filter.kind, states: filter.states }).map((opp) => buildCard(core, store, opp))
    },
    'opportunities.get': ({ id }) => card(id),
    'opportunities.prepareDraft': async ({ id }) => {
      await drafting.prepareOne(id, { explicit: true })
      return card(id)
    },
    'opportunities.saveDraft': async ({ id, draft }) => {
      await review.saveDraft(id, draft)
      return card(id)
    },
    'opportunities.approve': async ({ id }) => {
      await review.approve(id)
      return card(id)
    },
    'opportunities.reject': ({ id, reason }) => {
      review.reject(id, reason)
      return card(id)
    },
    'opportunities.defer': ({ id }) => {
      review.defer(id)
      return card(id)
    },
    'opportunities.send': async ({ id }) => {
      await sendManually(id)
      return card(id)
    },
    'opportunities.reconcile': async ({ id }) => {
      await sending.reconcile(id)
      return card(id)
    },

    // ───────────── standalone publications ─────────────
    'publications.suggest': async ({ channelId }) => card((await publications.suggest(channelId)).id),
    'publications.create': async ({ channelId, draft }) => card((await publications.create(channelId, draft)).id),
    'publications.schedule': ({ id, at }) => card(publications.schedule(id, at).id)
  })
}
