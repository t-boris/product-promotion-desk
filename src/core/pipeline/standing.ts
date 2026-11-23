// Is a confirmed post still up? A site can remove a post after it was published (Reddit's own filters, a moderator), and the application confirmed it
// from what the site showed a moment after the press, so it has to look again. Only a platform whose connector can read it is checked
// (`Connector.readStanding`); a read that fails or cannot tell changes nothing but the time of the look.

import type { Id, PostStanding, SendAction } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError } from '../ports'
import type { StandingChange } from '../services'
import type { FlowStore } from './store'
import { STANDING_WINDOW_MS } from '../../shared/standing'
import { MINUTE_MS } from './scheduler-timing'
import { errorMessage } from './util'

/** A post is looked at for this long after it was published (the card says until when, so the rule lives in shared code). */
export { STANDING_WINDOW_MS }
/** The first look is made this long after the publication: the filters of a site act within minutes. */
export const FIRST_LOOK_AFTER_MS = 3 * MINUTE_MS

/** How long after a look the next one is due, by how old the post was at that look: often at first, then hourly, then a few times a day. */
export function nextLookDelayMs(ageAtLookMs: number): number {
  if (ageAtLookMs < 60 * MINUTE_MS) return 10 * MINUTE_MS
  if (ageAtLookMs < 6 * 60 * MINUTE_MS) return 60 * MINUTE_MS
  return 6 * 60 * MINUTE_MS
}

/** Whether a send is due to be looked at: confirmed, with the platform's own id, inside the window, and the time since the last look has passed. */
export function standingDue(action: SendAction, nowMs: number): boolean {
  if (action.state !== 'confirmed' || !action.resultExternalId || !action.completedAt) return false
  const completed = Date.parse(action.completedAt)
  if (Number.isNaN(completed) || nowMs - completed > STANDING_WINDOW_MS) return false
  if (action.standingCheckedAt === null) return nowMs - completed >= FIRST_LOOK_AFTER_MS
  const looked = Date.parse(action.standingCheckedAt)
  return Number.isNaN(looked) || nowMs - looked >= nextLookDelayMs(looked - completed)
}

/** Whether a change of standing is worth telling the owner: a post that was taken down, or one that came back. */
export function worthTelling(from: PostStanding | null, to: PostStanding): boolean {
  return to === 'removed' || (from === 'removed' && to === 'live')
}

export class StandingChecks {
  /** Actions whose failing read was already written to the log: a sign-in that expired would otherwise fill it every ten minutes. */
  private readonly failureLogged = new Set<Id>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  /** Looks at every send that is due. `stop` says the scan must end now (automation paused, the app closing); it is asked between sends. */
  async checkDue(stop?: () => boolean): Promise<StandingChange[]> {
    const nowMs = this.core.clock.now().getTime()
    const since = new Date(nowMs - STANDING_WINDOW_MS).toISOString()
    const changes: StandingChange[] = []
    for (const action of this.store.standingCandidates(since)) {
      if (stop?.()) break
      if (!standingDue(action, nowMs)) continue
      const change = await this.look(action)
      if (change) changes.push(change)
    }
    return changes
  }

  /** One look at one send. Returns the change when the standing changed in a way worth telling. */
  private async look(action: SendAction): Promise<StandingChange | null> {
    const opp = this.store.requireOpportunity(action.opportunityId)
    const channel = this.store.requireChannel(opp.channelId)
    const { connector, ctx } = this.core.connectorContext(opp.channelId)
    // A platform whose connector cannot read a post is not checked, and nothing is written: it has no standing to show.
    if (typeof connector.readStanding !== 'function') return null
    const looked = this.core.clock.now().toISOString()
    let reading
    try {
      reading = await connector.readStanding(ctx, { externalId: action.resultExternalId as string, url: action.resultUrl })
    } catch (error) {
      // The owner took the browser: it is looked at again later, and nothing was wrong.
      if (error instanceof TakeoverError) return null
      if (!this.failureLogged.has(action.id)) {
        this.failureLogged.add(action.id)
        this.core.log.warn('standing', `Could not look at the post again (${errorMessage(error)}); it is tried again later.`, opp.channelId)
      }
      this.store.saveStanding(action.id, action.standing, action.standingNote, action.standingNotice, looked)
      return null
    }
    this.failureLogged.delete(action.id)
    if (reading === null) {
      this.store.saveStanding(action.id, action.standing, action.standingNote, action.standingNotice, looked)
      return null
    }
    // The community's words belong to a removal: a post that is up again has none, and a look that could not read them keeps what was read before.
    const notice = reading.state === 'removed' ? (reading.notice ?? (action.standing === 'removed' ? action.standingNotice : null)) : null
    this.store.saveStanding(action.id, reading.state, reading.note, notice, looked)
    if (reading.state === action.standing) return null
    this.core.log[reading.state === 'removed' ? 'warn' : 'info']('standing', `${channel.target}: ${reading.note}${action.resultUrl ? ` ${action.resultUrl}` : ''}`, opp.channelId)
    // The card and the list show the standing, so they are told; the owner is told only of what matters.
    this.store.notify()
    return worthTelling(action.standing, reading.state)
      ? { actionId: action.id, channelId: opp.channelId, where: channel.target, url: action.resultUrl, from: action.standing, to: reading.state, note: reading.note }
      : null
  }
}
