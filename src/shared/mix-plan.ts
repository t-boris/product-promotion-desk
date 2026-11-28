// What an accepted change of the weekly review does to a channel's plan of drafts (the content mix, DEC-033), on the owner's answer of
// 2026-11-28. The AI names a step in three words (more, less, pause); the application turns it into days. A step is in force while the
// accepted change is, and only while the owner's own setting of that kind is what it was when the step was proposed: the owner's edit wins.

import type { MixKind } from './types'

/** The kinds of own post the content mix prepares drafts of, and how often each is prepared when the owner never set it. */
export const MIX_KINDS: readonly MixKind[] = ['product_post', 'own_update', 'showcase']
export const DEFAULT_EVERY_DAYS: Record<MixKind, number> = { product_post: 14, own_update: 7, showcase: 30 }

export const PLAN_MOVES = ['more', 'less', 'pause'] as const
export type PlanMove = (typeof PLAN_MOVES)[number]
export const MAX_PLAN_STEPS = 4
export const MIX_MIN_DAYS = 1
export const MIX_MAX_DAYS = 90

/** How often a draft of one kind is prepared on a channel. */
export interface Rhythm {
  enabled: boolean
  everyDays: number
}

export interface PlanStep {
  channelId: string
  kind: MixKind
  move: PlanMove
  /** The owner's setting when the step was proposed. */
  from: Rhythm
  /** What it becomes while the step is in force. */
  to: Rhythm
}

/** What a move makes of a setting; null when it would change nothing (pausing or slowing a kind that is off). */
export function moved(own: Rhythm, move: PlanMove): Rhythm | null {
  if (move === 'pause') return own.enabled ? { enabled: false, everyDays: own.everyDays } : null
  if (move === 'less') {
    const everyDays = Math.min(MIX_MAX_DAYS, own.everyDays * 2)
    return own.enabled && everyDays !== own.everyDays ? { enabled: true, everyDays } : null
  }
  // More: a kind that is off is switched on at its own rhythm; one that is on is prepared twice as often.
  if (!own.enabled) return { enabled: true, everyDays: own.everyDays }
  const everyDays = Math.max(MIX_MIN_DAYS, Math.ceil(own.everyDays / 2))
  return everyDays !== own.everyDays ? { enabled: true, everyDays } : null
}

const same = (a: Rhythm, b: Rhythm): boolean => a.enabled === b.enabled && a.everyDays === b.everyDays

/** Whether a step still applies to the owner's setting as it is now. */
export const stepApplies = (own: Rhythm, step: PlanStep): boolean => same(own, step.from)

/** The rhythm in force: the step's while it applies, the owner's own otherwise. */
export function rhythmInForce(own: Rhythm, step: PlanStep | undefined): Rhythm {
  return step && stepApplies(own, step) ? step.to : own
}

const days = (n: number): string => (n === 1 ? 'every day' : `every ${n} days`)

/** A rhythm in words: "a draft every 7 days", or "no drafts". */
export const rhythmWords = (rhythm: Rhythm): string => (rhythm.enabled ? `a draft ${days(rhythm.everyDays)}` : 'no drafts')

/** What the weekly review's change card says under the buttons, by who wrote the change and whether it carries steps. */
export function changeHint(change: { byOwner: boolean; plan: readonly unknown[] } | null): string {
  const direction = 'An accepted change is given to the AI as your direction when it proposes posts for this product, for the two weeks after this one.'
  const nothing = 'Nothing is approved, scheduled or posted because of it.'
  if (change && !change.byOwner && change.plan.length > 0)
    return `${direction} This one also changes how often drafts are prepared, as listed above, for the same two weeks: your own setting is kept, comes back after, and wins at once if you change it. ${nothing}`
  if (change?.byOwner) return `${direction} A change you wrote changes no plan of drafts: set that on the channel’s “Content mix” card. ${nothing}`
  return `${direction} It changes the plan of drafts only when it lists what it changes. ${nothing}`
}

/** One step in words, for the review and the channel's card: what the kind's drafts become, and what they were. */
export function planWords(step: Pick<PlanStep, 'from' | 'to'>): string {
  if (!step.to.enabled) return `no drafts (yours: ${days(step.from.everyDays)})`
  if (!step.from.enabled) return `a draft ${days(step.to.everyDays)} (yours: off)`
  return `a draft ${days(step.to.everyDays)} (yours: ${days(step.from.everyDays)})`
}

/** Reads kept steps back: anything that is not a whole step is left out. */
export function parsePlan(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return []
  const rhythm = (value: unknown): Rhythm | null => {
    const v = value as { enabled?: unknown; everyDays?: unknown } | null
    return v && typeof v.enabled === 'boolean' && typeof v.everyDays === 'number' && Number.isInteger(v.everyDays) && v.everyDays >= MIX_MIN_DAYS && v.everyDays <= MIX_MAX_DAYS ? { enabled: v.enabled, everyDays: v.everyDays } : null
  }
  const steps: PlanStep[] = []
  for (const entry of raw) {
    const e = entry as { channelId?: unknown; kind?: unknown; move?: unknown; from?: unknown; to?: unknown } | null
    const from = rhythm(e?.from)
    const to = rhythm(e?.to)
    if (!e || typeof e.channelId !== 'string' || typeof e.kind !== 'string' || !PLAN_MOVES.includes(e.move as PlanMove) || !from || !to) continue
    steps.push({ channelId: e.channelId, kind: e.kind as MixKind, move: e.move as PlanMove, from, to })
  }
  return steps.slice(0, MAX_PLAN_STEPS)
}
