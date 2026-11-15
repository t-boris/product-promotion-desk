// Whether the app can read a channel (DEC-034). The answer is the connector's, asked now; the channel stores it (`channels.reads`) so the screen and the
// scheduler need not ask. A channel the app cannot read is a channel for the owner's own posts: no first read, no monitoring, no replies.

import type { Channel } from '../../shared/types'
import type { Core } from '../core'
import { handleOf, presetFor } from './presets'
import type { ChannelsStore } from './store'

/** What the channel says about itself while the app does not read it. */
export const OWN_POSTS_DETAIL = 'Your own posts only.'

/** Asks the channel's connector. A connector that does not say can read, as every connector did before this question existed. */
export function channelReads(core: Core, channel: Channel): boolean {
  const connector = core.connectors.get(channel.connectorId)
  return connector?.readsChannel ? connector.readsChannel(channel) : true
}

/** Asks again and stores a changed answer: a site profile added since makes a channel readable, and a profile removed makes it unread. */
export function refreshReads(core: Core, store: ChannelsStore, channel: Channel): Channel {
  const reads = channelReads(core, channel)
  return reads === channel.reads ? channel : store.updateChannel(channel.id, { reads })
}

/**
 * At start: every channel is told again whether the app can read it (a site profile may have been added or removed since), and a page of one
 * handle that was named by its address ("www.instagram.com/yourbrand") is called by its handle ("@yourbrand"). Both are safe to repeat. The
 * name is not part of anything an approval binds: the destination of a post is the channel's address, which this never touches.
 */
export function reconcileChannels(core: Core, store: ChannelsStore): void {
  for (const channel of core.repos.listChannels()) {
    try {
      const current = refreshReads(core, store, channel)
      const preset = presetFor(current.platform)
      const handle = preset ? handleOf(preset, current.url) : null
      if (!handle || handle === current.target || store.findDuplicate(current.productId, current.accountId, handle)) continue
      // Only a name that was made from the address is replaced; one the owner or a connector chose stays.
      const page = new URL(current.url)
      if (current.target !== `${page.hostname}${page.pathname.replace(/\/+$/, '')}`) continue
      store.updateChannel(current.id, { target: handle })
      core.events.changed('channels')
    } catch (error) {
      core.log.warn('channels', `Could not bring ${channel.target} up to date: ${error instanceof Error ? error.message : String(error)}`, channel.id)
    }
  }
}
