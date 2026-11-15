// API handlers of the discussion → draft → approval → sending flow. Handlers stay thin: they validate state,
// call the flow services and return the shapes of src/shared/api.ts.

import { ApiError } from '../../shared/api'
import type { Channel, Id, Run } from '../../shared/types'
import type { Core } from '../core'
import { requireText } from '../channels/errors'
import { OWN_POSTS_DETAIL, channelReads } from '../channels/reads'
import { buildCard } from './cards'
import type { DraftingFlow } from './drafting'
import { checkIds, checkLabels, type FindingStore } from './findings'
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
  findings: FindingStore
}

export function registerFlowApi({ core, store, review, monitor, drafting, sending, publications, findings }: FlowServices): void {
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

  const setChannelStatus = (channel: Channel, status: Channel['status'], statusDetail: string, nextCheckAt?: string): Channel => {
    store.updateChannel(channel.id, { status, statusDetail, ...(nextCheckAt ? { nextCheckAt } : {}) })
    core.events.changed('attention')
    return core.repos.channel(channel.id)
  }

  /**
   * A channel the app cannot read is activated without a first read (DEC-034): there is nothing to read and no baseline to store. It is active
   * so that the owner's own posts can go out; the monitor and the scheduler leave it alone, and no reply is ever prepared for it. One that the app
   * looks at in the account's browser (DEC-042) is active with nothing to say about itself, and its first look is planned: the scheduler makes it
   * (a look takes minutes, so it is not made inside this call).
   */
  const activateOwnPosts = (channel: Channel): Channel => {
    const account = core.repos.account(channel.accountId)
    if (account.status !== 'ready') throw new ApiError('account_not_ready', `${account.label} is not signed in. Sign in first, then activate the channel.`)
    const post = channel.capabilities.find((c) => c.key === 'publish_post')
    if (post && (post.status === 'unavailable' || post.status === 'restricted')) {
      throw new ApiError('publish_unavailable', `Posts cannot be made on this channel (${post.status}${post.detail ? `: ${post.detail}` : ''}).`)
    }
    if (channel.watchedInBrowser) return setChannelStatus(channel, 'active', '', core.clock.now().toISOString())
    return setChannelStatus(channel, 'active', OWN_POSTS_DETAIL)
  }

  core.router.register({
    // ───────────── channel observation ─────────────
    'channels.discussions': ({ channelId }) => {
      store.requireChannel(channelId)
      return listDiscussions(core, channelId)
    },
    'channels.selectOlder': ({ channelId, discussionIds, selected }) => selectOlder(core, store, channelId, discussionIds, selected),

    'channels.activate': async ({ channelId }) => {
      let channel = store.requireChannel(channelId)
      if (channel.status === 'paused') throw new ApiError('channel_paused', 'The channel is paused. Resume it first.')
      // Asked of the connector now, not read from what was stored: a site profile added or removed since changes what the app can read (DEC-034).
      const reads = channelReads(core, channel)
      if (reads !== channel.reads) {
        store.updateChannel(channelId, { reads })
        channel = store.requireChannel(channelId)
      }
      if (!reads) return activateOwnPosts(channel)
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
      if (!channel.reads && !channel.watchedInBrowser) throw new ApiError('not_read', 'The app does not read this channel: it is for your own posts, so there is nothing to check.')
      await core.runs.track('monitor', { channelId, productId: channel.productId }, async () => {
        const outcome = await monitor.runChannel(channelId)
        // What the AI finds in a channel it only looks at in the browser is a finding: nothing is drafted for it (DEC-042).
        const prepared = channel.watchedInBrowser ? { prepared: 0, needsUser: 0, autoSent: 0 } : await drafting.processChannel(channelId)
        const extra = prepared.prepared + prepared.needsUser + prepared.autoSent > 0 ? `; ${prepared.prepared} draft(s) prepared, ${prepared.autoSent} sent automatically, ${prepared.needsUser} need you` : ''
        return { status: outcome.status, summary: `${outcome.summary}${extra}` }
      })
      const run: Run | undefined = core.runs.list({ channelId, limit: 5 }).find((r) => r.kind === 'monitor')
      if (!run) throw new ApiError('internal', 'The check ran but its record is missing.')
      return run
    },

    'channels.setPaused': ({ channelId, paused }) => {
      const channel = store.requireChannel(channelId)
      if (paused) {
        // Pausing is for a channel that was started. A channel in setup has nothing to pause, and "resume" must never be a way round Activate
        // (its checks of the account and of posting), least of all for a channel the app does not read, which has no baseline to tell it apart.
        if (channel.status === 'setup') throw new ApiError('invalid_state', 'The channel has not been activated yet, so there is nothing to pause.')
        return setChannelStatus(channel, 'paused', 'Paused by you')
      }
      // "Resume" never leaves setup: that is what Activate is for, with its checks of the account and of posting. A channel the app does not read has
      // no first read to tell a started channel from a new one, so a started one is told by having left setup.
      const next = channel.baselineDoneAt || (channel.status !== 'setup' && !channel.reads) ? 'active' : 'setup'
      return setChannelStatus(channel, next, next === 'active' && !channel.reads && !channel.watchedInBrowser ? OWN_POSTS_DETAIL : '')
    },

    // ───────────── review queues ─────────────
    'opportunities.list': (args) => {
      const filter = args ?? {}
      return store.list({ channelId: filter.channelId, productId: filter.productId, kind: filter.kind, source: filter.source, states: filter.states }).map((opp) => buildCard(core, store, opp))
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
    'opportunities.resolveUnknown': async ({ id, outcome, url }) => {
      await sending.resolveUnknown(id, outcome, url)
      return card(id)
    },

    // ───────────── what the AI triage judged of a channel's posts (DEC-040) ─────────────
    // Ids are global: marking a finding seen needs no product, and an id that is not a finding is ignored.
    'findings.list': ({ productId, channelId, labels, limit }) => findings.list({ productId: requireText(productId, 'The product'), channelId: channelId || undefined, labels: checkLabels(labels), limit }),
    'findings.counts': ({ productId, channelId }) => findings.counts(requireText(productId, 'The product'), channelId || undefined),
    'findings.markSeen': ({ ids }) => {
      if (findings.markSeen(checkIds(ids)) > 0) findings.notify()
    },

    // ───────────── standalone publications ─────────────
    'publications.suggest': async ({ channelId }) => card((await publications.suggest(channelId)).id),
    'publications.create': async ({ channelId, draft }) => card((await publications.create(channelId, draft)).id),
    'publications.schedule': ({ id, at }) => card(publications.schedule(id, at).id)
  })
}
