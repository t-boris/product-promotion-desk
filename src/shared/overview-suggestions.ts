// "The AI suggests" on the Overview screen (UI-redesign phase C, DEC-037). The first version is rules over data the application
// already has: no model is asked, nothing is predicted, and every suggestion says which fact it comes from. A later version may
// ask the AI; the rules stay as its input.

import type { AttentionItem, Channel, Id, OverviewView } from './types'

/** A channel that sent nothing for this many days is worth a nudge. */
export const SILENT_DAYS = 14
/** The Overview shows at most this many suggestions. */
export const MAX_SUGGESTIONS = 5

const DAY_MS = 86_400_000

/** Where a suggestion's one action leads; the screen maps it to a route, so this module knows no route. */
export type SuggestionAction =
  | { kind: 'inbox' }
  | { kind: 'posts' }
  | { kind: 'channel'; channelId: Id; tab: 'plan' | 'mix' }

export interface Suggestion {
  /** Stable for the same fact, so a re-render does not reshuffle the list. */
  id: string
  /** What to do, in one sentence. */
  text: string
  /** The fact it comes from, in one sentence. */
  why: string
  actionLabel: string
  action: SuggestionAction
}

export interface SuggestionInput {
  overview: OverviewView
  channels: Channel[]
  /** Notes of the owner's own updates that no draft has used yet. */
  unusedNotes: number
  now: Date
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Channels the AI may work on now: running, not paused, not waiting for the owner. */
const isActive = (channel: Channel): boolean => channel.status === 'active'

function daysSince(at: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(at)) / DAY_MS)
}

export function overviewSuggestions(input: SuggestionInput): Suggestion[] {
  const { overview, channels, unusedNotes, now } = input
  const attention: AttentionItem[] = overview.attention
  const out: Suggestion[] = []

  const unconfirmed = attention.filter((item) => item.kind === 'unknown_result').length
  if (unconfirmed > 0) {
    out.push({
      id: 'unconfirmed',
      text: `Check ${plural(unconfirmed, 'result', 'results')} the app could not confirm`,
      why: 'A message may or may not have been published, and it is not sent again until you say what happened.',
      actionLabel: 'Open the Inbox',
      action: { kind: 'inbox' }
    })
  }

  const waiting = overview.channels.reduce((sum, channel) => sum + channel.waiting, 0)
  if (waiting > 0) {
    out.push({
      id: 'waiting',
      text: `Decide on ${plural(waiting, 'draft', 'drafts')} that ${waiting === 1 ? 'waits' : 'wait'} for you`,
      why: 'Nothing is sent until you approve it.',
      actionLabel: 'Open the Inbox',
      action: { kind: 'inbox' }
    })
  }

  const live = channels.filter((channel) => channel.productId === overview.productId && isActive(channel))

  for (const channel of live.filter((c) => c.plan === null)) {
    out.push({
      id: `plan:${channel.id}`,
      text: `Ask the AI for a plan for ${channel.target}`,
      why: 'This channel has no plan yet: no goals, no rhythm, no rules the AI could follow.',
      actionLabel: 'Open the plan',
      action: { kind: 'channel', channelId: channel.id, tab: 'plan' }
    })
  }

  for (const channel of live.filter((c) => !c.settings.mix.some((setting) => setting.enabled))) {
    out.push({
      id: `mix:${channel.id}`,
      text: `Choose a content mix for ${channel.target}`,
      why: 'No kind of own post is switched on there, so the AI prepares replies only.',
      actionLabel: 'Open the content mix',
      action: { kind: 'channel', channelId: channel.id, tab: 'mix' }
    })
  }

  if (unusedNotes > 0 && live.length > 0) {
    out.push({
      id: 'notes',
      text: `${plural(unusedNotes, 'note of yours is', 'notes of yours are')} waiting to become a post`,
      why: 'The AI writes about your own work only from what you tell it.',
      actionLabel: 'Open the content mix',
      action: { kind: 'channel', channelId: live[0].id, tab: 'mix' }
    })
  }

  for (const channel of live) {
    const tile = overview.channels.find((c) => c.channelId === channel.id)
    // A channel that never sent anything is silent since it was made; one that was made today is not.
    const since = tile?.lastSentAt ?? channel.createdAt
    const silent = daysSince(since, now)
    if (silent >= SILENT_DAYS) {
      out.push({
        id: `silent:${channel.id}`,
        text: `Nothing was sent on ${channel.target} for ${silent} days`,
        why: tile?.lastSentAt ? 'Its last confirmed send was that long ago.' : 'Nothing was ever sent there.',
        actionLabel: 'Write a post',
        action: { kind: 'posts' }
      })
    }
  }

  return out.slice(0, MAX_SUGGESTIONS)
}
