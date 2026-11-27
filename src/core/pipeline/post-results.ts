// Results per post: what the site shows under each post the owner sent (likes or points, comments, views), read again by the application on a
// schedule that follows the post's age, kept over time. Where the channel's connector can read them, it does. Where it cannot (a channel worked
// in the browser), the AI reads them on the account's own page (DEC-075, `browser-post-numbers.ts`), about once a day. Nothing is guessed and
// nothing is drawn as a zero.
import { ApiError } from '../../shared/api'
import { NUMBERS_WINDOW_MS, numbersDue, type PostNumbers } from '../../shared/post-numbers'
import type { Id, PostResult, PostResultsView, SendAction } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError } from '../ports'
import { BrowserPostNumbers } from './browser-post-numbers'
import type { FlowStore } from './store'

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class PostResults {
  /** Channels whose failed reading was already written to the log: one line, not one per scan. */
  private readonly failureLogged = new Set<Id>()

  private readonly browser: BrowserPostNumbers

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {
    this.browser = new BrowserPostNumbers(core, store)
  }

  /** How the numbers of the channel's posts are read: by its connector, by the AI in the account's browser (DEC-075), or not at all. */
  way(channelId: Id): 'connector' | 'browser' | null {
    const channel = this.core.repos.channel(channelId)
    if (typeof this.core.connectors.get(channel.connectorId)?.readPostNumbers === 'function') return 'connector'
    return this.browser.can(channel) ? 'browser' : null
  }

  /** Reads the posts that are due, one reading per channel. Returns how many posts got a reading. `stop` ends the scan between channels. */
  async readDue(stop?: () => boolean): Promise<number> {
    const nowMs = this.core.clock.now().getTime()
    const since = new Date(nowMs - NUMBERS_WINDOW_MS).toISOString()
    const byChannel = new Map<Id, SendAction[]>()
    for (const action of this.store.confirmedSince(since)) {
      const opp = this.store.requireOpportunity(action.opportunityId)
      if (opp.kind !== 'standalone' || action.standing === 'removed' || !action.completedAt) continue
      if (!numbersDue(Date.parse(action.completedAt), action.numbers ? Date.parse(action.numbers.readAt) : this.lastTry.get(action.id) ?? null, nowMs)) continue
      byChannel.set(opp.channelId, [...(byChannel.get(opp.channelId) ?? []), action])
    }
    let read = 0
    for (const [channelId, actions] of byChannel) {
      if (stop?.()) break
      const way = this.way(channelId)
      if (way === 'connector') {
        const withId = actions.filter((a) => a.resultExternalId !== null)
        if (withId.length > 0) read += await this.readChannel(channelId, withId, false)
      } else if (way === 'browser' && this.browser.due(channelId, nowMs)) {
        // A post is due as its age says, but a look is an AI working a browser: one per channel in most of a day, for every post of it that is due.
        try {
          read += await this.browser.read(this.core.repos.channel(channelId), actions, false)
        } catch (error) {
          this.core.log.warn('results', `The look at the numbers stopped unexpectedly: ${errorText(error)}`, channelId)
        }
      }
    }
    return read
  }

  /** When a post was last tried and nothing came back (the site did not list it): it is not asked again before its next time. */
  private readonly lastTry = new Map<Id, number>()

  private async readChannel(channelId: Id, actions: SendAction[], rethrow: boolean): Promise<number> {
    const now = this.core.clock.now()
    try {
      const { connector, ctx } = this.core.connectorContext(channelId)
      if (!connector.readPostNumbers) return 0
      const found = await connector.readPostNumbers(ctx, actions.map((a) => ({ externalId: a.resultExternalId as string, url: a.resultUrl })))
      let read = 0
      for (const action of actions) {
        const numbers = found[action.resultExternalId as string]
        this.lastTry.set(action.id, now.getTime())
        if (!numbers || (numbers.likes === null && numbers.comments === null && numbers.views === null)) continue
        this.store.saveNumbers(action.id, clean(numbers), now.toISOString())
        read += 1
      }
      this.failureLogged.delete(channelId)
      if (read > 0) this.core.events.changed('results', 'opportunities')
      return read
    } catch (error) {
      // The owner holds the account's browser: the reading waits for the next scan and says nothing.
      if (error instanceof TakeoverError && !rethrow) return 0
      for (const action of actions) this.lastTry.set(action.id, now.getTime())
      if (rethrow) throw new ApiError('read_failed', `The numbers of the posts could not be read: ${errorText(error)}`)
      if (!this.failureLogged.has(channelId)) {
        this.failureLogged.add(channelId)
        this.core.log.warn('results', `The numbers of the posts could not be read: ${errorText(error)}`, channelId)
      }
      return 0
    }
  }

  /** The owner's "Read now": every sent post of the channel inside the window, whatever its schedule says. */
  async readNow(channelId: Id): Promise<PostResultsView> {
    const way = this.way(channelId)
    if (way === null) throw new ApiError('invalid_input', 'The application cannot read the numbers of posts on this channel.')
    const since = new Date(this.core.clock.now().getTime() - NUMBERS_WINDOW_MS).toISOString()
    const actions = this.store.sentPostsOfChannel(channelId, since, way === 'browser').filter((a) => a.standing !== 'removed')
    if (actions.length > 0) {
      if (way === 'browser') await this.browser.read(this.core.repos.channel(channelId), actions, true)
      else await this.readChannel(channelId, actions, true)
    }
    return this.view(channelId)
  }

  /** The sent posts of a channel with what the site shows under each, newest first, and each one's readings over time. */
  view(channelId: Id): PostResultsView {
    const channel = this.core.repos.channel(channelId)
    const way = this.way(channelId)
    const posts: PostResult[] = this.store.sentPostsOfChannel(channelId, '', way === 'browser').map((action) => {
      const draft = this.core.repos.draft(action.draftId)
      const words = (draft.title?.trim() || draft.text.trim().split('\n')[0] || '').trim()
      return {
        actionId: action.id,
        opportunityId: action.opportunityId,
        title: words.length > 90 ? `${words.slice(0, 89)}…` : words,
        url: action.resultUrl,
        sentAt: action.completedAt as string,
        removed: action.standing === 'removed',
        numbers: action.numbers,
        readings: this.store.numberReadings(action.id)
      }
    })
    return { channelId, platform: channel.platform, readable: way !== null, byAi: way === 'browser', posts }
  }
}

/** A count is a whole number that is not negative below zero for views and comments; a platform's points may be negative. Anything else is "not shown". */
function clean(numbers: PostNumbers): PostNumbers {
  const whole = (value: number | null, mayBeNegative: boolean): number | null => (typeof value === 'number' && Number.isFinite(value) && (mayBeNegative || value >= 0) ? Math.round(value) : null)
  return { likes: whole(numbers.likes, true), comments: whole(numbers.comments, false), views: whole(numbers.views, false) }
}
