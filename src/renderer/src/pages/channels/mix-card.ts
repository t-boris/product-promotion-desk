// The "Content mix" card of a channel (DEC-033): its words, the state of its form, and the rules that need no screen, so they are tested apart
// from the interface. The mix is the AI preparing DRAFTS of the persona's own posts from time to time; replies are what the monitor does and are
// not a setting of it.

import type { Channel, ChannelMode, ChannelPlan, MixCard, MixKind, MixKindCard, MixSetting, ProductUpdate } from '../../../../shared/types'

/** The three kinds, in the order the card shows them (the core returns them in this order, too). */
export const MIX_KINDS: readonly MixKind[] = ['product_post', 'own_update', 'showcase']

export const MIX_DAYS_MIN = 1
export const MIX_DAYS_MAX = 90
/** A note is a line or two. */
export const NOTE_MAX = 500
/** The count of characters appears when a note comes this close to the limit. */
export const NOTE_COUNT_FROM = 400
/** The used notes are the record of what was told already; only the latest few are shown. */
export const USED_NOTES_SHOWN = 3

/** What a kind shows when the core sent no entry for it (it always does; this only keeps the form total). */
const FALLBACK_DAYS: Record<MixKind, number> = { product_post: 14, own_update: 7, showcase: 30 }

export const KIND_WORDS: Record<MixKind, { label: string; about: string }> = {
  product_post: { label: 'Post about the product', about: 'Written from your approved facts.' },
  own_update: { label: 'My update, from your notes', about: 'Written only from one of your notes, never invented.' },
  showcase: { label: 'Showcase of one feature', about: 'One concrete thing the product does.' }
}

export const REPLIES_TITLE = 'Replies to threads'

/** What the monitor does on a channel in each mode, as a clause that ends the sentence "On this channel: …". */
export const REPLIES_WORDS: Record<ChannelMode, string> = {
  observe: 'it only watches, nothing is drafted',
  draft: 'it saves reply drafts for you to read and use',
  approval: 'it queues each reply for your approval',
  auto: 'it sends only the simple automatic replies you allowed, the rest waits for you'
}

/** The replies line of the mix: what the monitor does on this channel, or that there is nothing to reply to (DEC-034; a channel the AI watches in the browser is still never replied to, DEC-042). */
export const repliesLine = (channel: Pick<Channel, 'mode' | 'reads' | 'watchedInBrowser'>): string => {
  if (channel.reads) return `Not part of the mix: the monitor handles them when someone writes to you. On this channel: ${REPLIES_WORDS[channel.mode]}.`
  const why = channel.watchedInBrowser ? 'the AI only watches it in the browser and never replies' : 'the app does not read it'
  return `Not on this platform: ${why}, so there is nothing to reply to. The mix is only for your own posts.`
}

// ───────────── the form ─────────────

/** One kind as the form edits it: the days stay text while the owner types. */
export interface MixRow {
  kind: MixKind
  enabled: boolean
  days: string
}

/** Always the three kinds, in `MIX_KINDS` order. */
export type MixForm = MixRow[]

/** The saved mix as a form: what the core says each kind is now (an unset kind is off, with its usual rhythm). */
export function formFromCard(card: Pick<MixCard, 'kinds'>): MixForm {
  return MIX_KINDS.map((kind) => {
    const entry = card.kinds.find((k) => k.kind === kind)
    return { kind, enabled: entry?.enabled ?? false, days: String(entry?.everyDays ?? FALLBACK_DAYS[kind]) }
  })
}

/** A whole number of days from 1 to 90 as typed (spaces around it are fine), or null. */
export function parseDays(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,3}$/.test(trimmed)) return null
  const days = Number(trimmed)
  return days >= MIX_DAYS_MIN && days <= MIX_DAYS_MAX ? days : null
}

export const DAYS_PROBLEM = `Use a whole number of days from ${MIX_DAYS_MIN} to ${MIX_DAYS_MAX}.`

/** What is wrong with the days of one row, or null. */
export const daysProblem = (row: Pick<MixRow, 'days'>): string | null => (parseDays(row.days) === null ? DAYS_PROBLEM : null)

export const formValid = (form: MixForm): boolean => form.every((row) => parseDays(row.days) !== null)

/** Whether one row is not what is saved (an unreadable number is a change, too: it is not the saved one). */
export function rowChanged(row: MixRow, saved: MixRow | undefined): boolean {
  return !saved || row.enabled !== saved.enabled || parseDays(row.days) !== parseDays(saved.days)
}

export const formDirty = (form: MixForm, saved: MixForm): boolean => form.some((row) => rowChanged(row, saved.find((s) => s.kind === row.kind)))

/** The two forms say the same thing. */
export const sameForm = (a: MixForm, b: MixForm): boolean => a.length === b.length && a.every((row, i) => row.kind === b[i].kind && row.enabled === b[i].enabled && row.days.trim() === b[i].days.trim())

/** What `channels.updateSettings` takes for the mix: every kind once (a kind that is off keeps its rhythm), or null while a number is not valid. */
export function settingsFromForm(form: MixForm): MixSetting[] | null {
  const out: MixSetting[] = []
  for (const row of form) {
    const everyDays = parseDays(row.days)
    if (everyDays === null) return null
    out.push({ kind: row.kind, enabled: row.enabled, everyDays })
  }
  return out
}

/** Changes one row. */
export const withRow = (form: MixForm, kind: MixKind, change: Partial<Omit<MixRow, 'kind'>>): MixForm => form.map((row) => (row.kind === kind ? { ...row, ...change } : row))

/** What the saved mix looks like, as one string: when it changes (saved here or elsewhere) the form starts again from it. */
export const formSignature = (form: MixForm): string => JSON.stringify(form.map((row) => [row.kind, row.enabled, parseDays(row.days)]))

// ───────────── the AI's proposal ─────────────

/**
 * The proposal in the form: a kind in it is on, with the days it names; a kind that is not in it is off (its days are left as they are, so
 * switching it on later starts from the rhythm the owner had). Nothing is saved by this.
 */
export function applyProposal(form: MixForm, proposal: readonly MixSetting[]): MixForm {
  return form.map((row) => {
    const entry = proposal.find((p) => p.kind === row.kind)
    return entry ? { ...row, enabled: true, days: String(entry.everyDays) } : { ...row, enabled: false }
  })
}

/** What the owner is told while an unsaved proposal is in the form. */
export const PROPOSED_NOTE = 'The AI proposed this from the plan. Read it, change what you like, then save.'
export const PROPOSED_SAME_NOTE = 'The AI proposed what is already saved. Nothing to save.'
export const proposalNote = (changesSomething: boolean): string => (changesSomething ? PROPOSED_NOTE : PROPOSED_SAME_NOTE)

/** The form before the AI's proposal replaced it (null: it was the saved mix), and the form the proposal made. */
export interface Proposal {
  before: MixForm | null
  applied: MixForm
}

/** "Undo" is honest only while the form is still exactly what the AI proposed: once the owner changes it, it is theirs again. */
export const canUndoProposal = (form: MixForm, proposal: Proposal | null): boolean => proposal !== null && sameForm(form, proposal.applied)

/**
 * Whether the plan of the channel already names a kind of post the mix can prepare. Then the proposal needs no AI (the core reads it from
 * the plan); otherwise the core asks the AI for a plan first. Mirrors the core's reading of the plan (`proposalFromPlan`); the core decides.
 */
export function planProposesMix(plan: ChannelPlan | null): boolean {
  return (plan?.steps ?? []).some((step) => step.kind != null && step.kind !== 'replies')
}

/** Why "Let the AI propose a mix" is off: only when it would need the AI (the plan names nothing yet) and the AI cannot be used. */
export const proposeBlock = (plan: ChannelPlan | null, aiBlockedReason: string | null): string | null => (planProposesMix(plan) ? null : aiBlockedReason)

// ───────────── what each kind says about itself ─────────────

const TEXT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

/** "Nov 3", with the year when it is not the current one. */
export function shortDate(iso: string, now: number, options: { locale?: string; timeZone?: string } = {}): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const zone = options.timeZone ? { timeZone: options.timeZone } : {}
  const yearOf = (d: Date): string => d.toLocaleDateString(options.locale, { year: 'numeric', ...zone })
  const sameYear = yearOf(date) === yearOf(new Date(now))
  return date.toLocaleDateString(options.locale, { ...TEXT_DATE, ...(sameYear ? {} : { year: 'numeric' }), ...zone })
}

export const NEXT_SOON = 'Next draft: at the next check, within a few minutes'
export const NOT_SAVED_YET = 'Not saved yet.'

export interface KindStatus {
  /** "Last draft: Nov 3", or null when the mix never prepared one of this kind. */
  last: string | null
  /** "Next draft: about Nov 17", or null when nothing is known to say (off, not saved, held up, or the channel cannot run the mix). */
  next: string | null
  /** What holds this kind up, in the core's words, or null. */
  problem: string | null
  /** The row is not what is saved: what the core says belongs to the saved mix, so it is not shown. */
  unsaved: boolean
}

/**
 * What a kind says under its row. The core's answer (next time, problem) is about the SAVED mix: a row the owner changed says "Not saved
 * yet" instead; a channel the mix cannot run on says why once at the top of the card, not as a next time on each row; a kind that is off has
 * no next time; and a problem replaces the next time (it will not come until the problem is gone).
 */
export function kindStatus(kind: MixKindCard, context: { now: number; changed: boolean; blocked: boolean; locale?: string; timeZone?: string }): KindStatus {
  const dateOptions = { locale: context.locale, timeZone: context.timeZone }
  const last = kind.lastDraftAt ? `Last draft: ${shortDate(kind.lastDraftAt, context.now, dateOptions)}` : null
  if (context.changed) return { last, next: null, problem: null, unsaved: true }
  if (!kind.enabled) return { last, next: null, problem: null, unsaved: false }
  if (kind.problem) return { last, next: null, problem: kind.problem, unsaved: false }
  if (context.blocked || !kind.nextAt) return { last, next: null, problem: null, unsaved: false }
  const due = Date.parse(kind.nextAt)
  const next = Number.isNaN(due) ? null : due <= context.now ? NEXT_SOON : `Next draft: about ${shortDate(kind.nextAt, context.now, dateOptions)}`
  return { last, next, problem: null, unsaved: false }
}

/** The words under a row as one line ("Last draft: Nov 3 · Next draft: about Nov 17"), so a narrow card breaks it between words and never at a separator; null when there are none. */
export function statusLine(status: Pick<KindStatus, 'last' | 'next' | 'unsaved'>): string | null {
  const parts = [status.last, status.next, status.unsaved ? NOT_SAVED_YET : null].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The footer line: drafts only, how many may wait, how many wait now. */
export function draftsOnlyLine(card: Pick<MixCard, 'cap' | 'waiting'>): string {
  const waiting = card.waiting > 0 ? ` (${card.waiting} waiting now)` : ''
  return `Drafts only: at most ${card.cap} wait for you at a time${waiting}, and nothing is sent without your Approve.`
}

// ───────────── the owner's notes ("What's new") ─────────────

export const NOTES_SHARED = 'Notes are shared by all channels of this product.'
export const NOTES_ABOUT = 'Tell what you did, in a line or two. The AI writes “My update” posts only from these notes.'

/** After this many failed tries to make a post from it the core sets a note aside (it never holds the other notes back). Mirrors the core's limit; the core decides. */
export const NOTE_SET_ASIDE_AFTER = 3
export const SET_ASIDE_WORDS = 'The AI could not make a post from this note. Remove it and tell it again in other words.'

/** A note that is not used and that the AI gave up on: it counts as neither used nor waiting to be used. */
export const isSetAside = (note: Pick<ProductUpdate, 'usedInOpportunityId' | 'failedTries'>): boolean => note.usedInOpportunityId === null && note.failedTries >= NOTE_SET_ASIDE_AFTER

/** "3 not used" (what an update can still be written from), plus the notes set aside when there are some. */
export function unusedLabel(usable: number, setAside = 0): string {
  const unused = usable === 0 ? 'none unused' : `${usable} not used`
  return setAside > 0 ? `${unused}, ${setAside} set aside` : unused
}

/**
 * The notes the owner can still remove (not used: the ones an update can be written from, and the ones set aside), and the last few that were
 * used (they stay as the record of what was told). The list comes newest first and keeps its order.
 */
export function splitNotes(notes: readonly ProductUpdate[]): { open: ProductUpdate[]; usable: ProductUpdate[]; setAside: ProductUpdate[]; used: ProductUpdate[] } {
  const open = notes.filter((n) => n.usedInOpportunityId === null)
  return { open, usable: open.filter((n) => !isSetAside(n)), setAside: open.filter(isSetAside), used: notes.filter((n) => n.usedInOpportunityId !== null).slice(0, USED_NOTES_SHOWN) }
}

/** A note as the core keeps it: one line. */
export const normalizeNote = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Why a note cannot be added yet, or null. */
export function noteProblem(text: string): string | null {
  const note = normalizeNote(text)
  if (note === '') return 'Write what you did, in a line or two.'
  if (note.length > NOTE_MAX) return `A note is a line or two: at most ${NOTE_MAX} characters.`
  return null
}

export const showNoteCount = (text: string): boolean => text.length >= NOTE_COUNT_FROM
