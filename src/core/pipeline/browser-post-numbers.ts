// Numbers under the owner's posts on a channel worked in the browser (DEC-075, changing DEC-056 on the owner's order: "they must be read").
// Where the channel's connector cannot read them (Instagram, Facebook, Threads, any site), the AI opens the account's own page in the account's
// browser, finds the posts the owner sent and records the numbers shown under each. It only reads. The application keeps what it can check:
// a post of the brief, whole counts, and, when the page of the post itself was looked at, that the page shows the text that was sent.
import { ApiError } from '../../shared/api'
import { platformLabel } from '../../shared/post-format'
import type { Channel, Id, SendAction } from '../../shared/types'
import { NUMBERS_MAX_CALLS, NUMBERS_MAX_POSTS, type OwnPostBrief, type PostNumbersItem } from '../browser-agent/post-numbers'
import { WATCH_TIMEOUT_MS, openProblem, type WatchBrief, type WatchOutcome } from '../browser-agent/watch'
import { webPlaces } from '../channels/web-places'
import type { Core } from '../core'
import { NOT_STARTED } from './browser-watch'
import type { FlowStore } from './store'

/** A channel is looked at for its numbers at most this often by itself: a look is an AI working a browser, not a request. */
export const BROWSER_NUMBERS_GAP_MS = 20 * 3_600_000

const letters = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Whether a page's own text is the text that was sent: the first words of the sent text are in it. A sent text too short to tell by is taken as the same. */
export function sameWords(sent: string, pageText: string): boolean {
  const probe = letters(sent).slice(0, 24)
  return probe.length < 12 || letters(pageText).includes(probe)
}

/** Whether the numbers under a channel's posts are read by the AI in the account's browser: its connector has no reader, and the account works in a browser on a web address. */
export function readsNumbersInBrowser(core: Core, channel: Channel): boolean {
  if (!core.services.watchMissions) return false
  if (typeof core.connectors.get(channel.connectorId)?.readPostNumbers === 'function') return false
  return core.repos.account(channel.accountId).access === 'browser' && /^https?:\/\//i.test(channel.url)
}

export class BrowserPostNumbers {
  /** When each channel was last looked at (a look that ran, whatever it found). */
  private readonly lastLook = new Map<Id, number>()
  private readonly failureLogged = new Set<Id>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  can(channel: Channel): boolean {
    return readsNumbersInBrowser(this.core, channel)
  }

  /** Whether the scheduler may look at the channel now. */
  due(channelId: Id, nowMs: number): boolean {
    const last = this.lastLook.get(channelId)
    return last === undefined || nowMs - last >= BROWSER_NUMBERS_GAP_MS
  }

  private cannot(byOwner: boolean, reason: string): number {
    if (byOwner) throw new ApiError('read_failed', reason)
    return 0
  }

  /**
   * One look: the newest posts of `actions`, at most `NUMBERS_MAX_POSTS`. Returns how many posts got a reading. On the owner's press a look that
   * could not be made, or found nothing, throws with the reason in words; by itself it returns 0 and writes one line to the log.
   */
  async read(channel: Channel, actions: SendAction[], byOwner: boolean): Promise<number> {
    const missions = this.core.services.watchMissions
    if (!missions) return this.cannot(byOwner, 'The AI browser is not available in this version.')
    if (channel.status === 'paused') return this.cannot(byOwner, 'This channel is paused. Resume it to let the AI read the numbers under its posts.')
    const account = this.core.repos.account(channel.accountId)
    const ready = await missions.watchReady(account.id)
    if (!ready.ready) return this.cannot(byOwner, ready.reason ?? 'The AI cannot work in this account now.')
    const site = webPlaces(channel)
    const chosen = [...actions].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, NUMBERS_MAX_POSTS)
    if (chosen.length === 0) return 0
    const sentText = (action: SendAction): string => this.core.repos.draft(action.draftId).text
    const posts: OwnPostBrief[] = chosen.map((action, index) => {
      const draft = this.core.repos.draft(action.draftId)
      const url = action.resultUrl && openProblem(action.resultUrl, site.hosts) === null ? action.resultUrl : null
      return { n: index + 1, sentAt: action.completedAt as string, text: [draft.title?.trim(), draft.text.trim()].filter(Boolean).join(' / ').slice(0, 260), url }
    })
    const product = this.core.repos.product(channel.productId)
    const now = this.core.clock.now()
    const brief: WatchBrief = {
      platform: platformLabel(channel.platform),
      channelTarget: channel.target,
      channelUrl: channel.url,
      accountLabel: account.label,
      accountIdentity: account.identity,
      product: { name: product.name, websiteUrl: product.websiteUrl, description: null },
      goals: [],
      topics: [],
      queries: [],
      languages: channel.settings.languages,
      places: [{ label: `The account's own page, ${channel.target}`, url: channel.url }, ...posts.filter((post) => post.url !== null).map((post) => ({ label: `Post ${post.n}`, url: post.url as string }))],
      mode: 'numbers',
      ownPosts: posts,
      firstLook: false,
      lookBackDays: 0,
      since: now.toISOString(),
      known: [],
      maxPosts: posts.length,
      maxCalls: NUMBERS_MAX_CALLS
    }
    const recordedPosts = new Set<number>()
    const record = (items: PostNumbersItem[]): { stored: number; refused: string[] } => {
      const refused: string[] = []
      let stored = 0
      for (const item of items) {
        const action = chosen[item.post - 1]
        if (!action) continue
        // The application read that page's text itself: a page that shows other words is another post, whatever the AI says.
        if (item.body !== null && !sameWords(sentText(action), item.body)) {
          refused.push(`Post ${item.post}: the page at that address shows another text, so its numbers were not kept. Find the post whose text is in your brief.`)
          continue
        }
        this.store.saveNumbers(action.id, { likes: item.likes, comments: item.comments, views: item.views }, now.toISOString())
        // The address is kept only when the application saw the sent text on that very page.
        if (item.url && item.body !== null && !action.resultUrl) this.store.setResultUrl(action.id, item.url)
        if (!recordedPosts.has(item.post)) stored += 1
        recordedPosts.add(item.post)
      }
      return { stored, refused }
    }
    let outcome: WatchOutcome
    try {
      outcome = await missions.watch({ accountId: account.id, channelId: channel.id, hosts: site.hosts, brief, record: () => ({ stored: 0, known: 0 }), numbers: { posts: posts.length, record } })
    } catch (error) {
      if (error instanceof ApiError && NOT_STARTED.has(error.code)) return this.cannot(byOwner, error.message)
      throw error
    }
    if (outcome.ended !== 'busy') this.lastLook.set(channel.id, now.getTime())
    if (recordedPosts.size > 0) {
      this.failureLogged.delete(channel.id)
      this.core.log.info('results', `The AI read the numbers under ${recordedPosts.size} of ${posts.length} post${posts.length === 1 ? '' : 's'} in ${channel.target}.`, channel.id)
      this.core.events.changed('results', 'opportunities')
      return recordedPosts.size
    }
    const why = whyNothing(outcome)
    if (byOwner) throw new ApiError('read_failed', why)
    if (outcome.ended !== 'busy' && !this.failureLogged.has(channel.id)) {
      this.failureLogged.add(channel.id)
      this.core.log.warn('results', `The numbers under the posts in ${channel.target} were not read: ${why}`, channel.id)
    }
    return 0
  }
}

function whyNothing(outcome: WatchOutcome): string {
  const { reported } = outcome
  if (outcome.ended === 'busy') return 'The browser was in use (another task of the account, or you), so the numbers were not read. Try again in a moment.'
  if (outcome.ended === 'stopped') return 'You stopped the AI.'
  if (outcome.ended === 'timeout') return `The AI did not finish in ${WATCH_TIMEOUT_MS / 60_000} minutes and was stopped.`
  if (outcome.ended === 'error') return `The AI stopped because of an error: ${outcome.error ?? 'unknown error'}`
  if (outcome.humanCheck) return `The site shows a human check (${outcome.humanCheck}): solve it in the account's browser, then try again.`
  if (reported?.status === 'needs_owner') return `The AI needs you: ${reported.reason || 'the site asks for something only a person can do.'}`
  if (reported?.status === 'failed') return `The AI could not read the numbers: ${reported.reason || 'it gave no reason.'}`
  return `The AI found none of the posts on the account's page${reported?.reason ? ` (${reported.reason})` : outcome.said ? ` (its last words: "${outcome.said}")` : ''}.`
}
