// The launch path of a product (BUG-012): Product → Passport → Goal → Channel → Publication, each stage done, current
// (the first one not done, the next step) or not yet. Pure, so the rules are tested from src/main/renderer-logic.test.ts.

import type { Channel, Id, Opportunity, OpportunityState } from '../../../../shared/types'
import { postsHref, productHref, type ProductTab } from '../../route'

export type LaunchStageId = 'product' | 'passport' | 'goal' | 'channel' | 'publication'
export type LaunchStageState = 'done' | 'current' | 'todo'

/** What the path is computed from. The channel and publication counts come from channels.list and opportunities.list. */
export interface LaunchFacts {
  /**
   * At least one source. products.create and products.update refuse a product without one, but removing sources one by one
   * (sources.remove) can still empty it. Setup counts its sources; the product switcher, which has no sources, assumes one.
   */
  hasSources: boolean
  passportApproved: boolean
  goals: number
  channels: number
  /** Publications the owner approved: ready to send, sending or sent. */
  approvedPublications: number
  /** Publications written but not approved yet; without it none is known, which only decides the words of the Publication stage's action. */
  draftPublications?: number
}

export interface LaunchStage {
  id: LaunchStageId
  label: string
  state: LaunchStageState
  /** Where the stage is worked on: its Setup tab, the Channels screen or Posts, for that product. */
  href: string
  /** What finishing the stage means, for the tooltip of a stage that is not done. */
  todo: string
  /**
   * What the owner does to finish the stage, in the words of a button ("Build the passport"). The one label that the Inbox checklist, the
   * "Next: …" row of the product list and the next-stage button of a product tab all use, so the three never name different steps (BUG-064).
   */
  action: string
}

/** A publication counts once the owner approved it. */
export const APPROVED_PUBLICATION_STATES: readonly OpportunityState[] = ['ready', 'sending', 'confirmed']

const STAGES: { id: LaunchStageId; label: string; todo: string; action: (facts: LaunchFacts) => string; done: (facts: LaunchFacts) => boolean; href: (productId: Id) => string }[] = [
  { id: 'product', label: 'Product', todo: 'Add a source: a website or a description.', action: () => 'Add a source', done: (f) => f.hasSources, href: (id) => productHref(id, 'sources') },
  // The passport is built by the AI from the sources or by hand, then approved; the row, the checklist and the button name the stage, not one route to it.
  { id: 'passport', label: 'Passport', todo: 'Build and approve the passport.', action: () => 'Build the passport', done: (f) => f.passportApproved, href: (id) => productHref(id, 'passport') },
  { id: 'goal', label: 'Goal', todo: 'Write a goal.', action: () => 'Write a goal', done: (f) => f.goals > 0, href: (id) => productHref(id, 'goal') },
  { id: 'channel', label: 'Channel', todo: 'Connect a channel.', action: () => 'Connect a channel', done: (f) => f.channels > 0, href: (id) => productHref(id, 'channels') },
  { id: 'publication', label: 'Publication', todo: 'Approve a publication.', action: (f) => ((f.draftPublications ?? 0) > 0 ? 'Approve a draft' : 'Write a publication'), done: (f) => f.approvedPublications > 0, href: (id) => postsHref(id) }
]

/** The five stages. The first stage that is not done is the current one; the facts decide every other stage on its own. */
export function launchStages(productId: Id, facts: LaunchFacts): LaunchStage[] {
  let currentTaken = false
  return STAGES.map((stage) => {
    let state: LaunchStageState = 'done'
    if (!stage.done(facts)) {
      state = currentTaken ? 'todo' : 'current'
      currentTaken = true
    }
    return { id: stage.id, label: stage.label, state, href: stage.href(productId), todo: stage.todo, action: stage.action(facts) }
  })
}

/**
 * The next step of the path: the first stage that is not done, or null once every stage is done. The one answer the "Next: …" row of the
 * product list, the Getting started checklist and the accent of the product tabs take (BUG-058, BUG-064, BUG-065).
 */
export function nextStage(stages: LaunchStage[]): LaunchStage | null {
  return stages.find((stage) => stage.state === 'current') ?? null
}

/**
 * The stage each place of a product works on: the tabs of Setup, the Channels screen and the Overview. The Analysis tab is the AI's way to the passport and Results is where a channel's
 * numbers appear, so both follow the stage they serve; their one action ("Connect a channel" on an empty Results) is that stage's own.
 */
export const TAB_STAGE: Record<ProductTab, LaunchStageId> = { sources: 'product', passport: 'passport', analysis: 'passport', goal: 'goal', channels: 'channel', results: 'channel' }

export interface TabAccent {
  /** The tab holds the path's current stage, so its own main action is the screen's filled button. */
  own: boolean
  /** Where the filled button points when the tab does not hold the current stage: the next stage, or null once the path is complete. */
  next: LaunchStage | null
}

/**
 * Who owns the one filled button of a product tab (BUG-065). The path's next stage is the owner's next move, so a tab keeps its own
 * filled action only while its own stage is that stage. Every other tab, whether its stage is already done (a finished Sources or
 * Passport tab) or not reached yet, shows its actions as bezels and points the filled button at the next stage. When every stage is
 * done there is no next move and no tab holds a filled button.
 */
export function tabAccent(stages: LaunchStage[], tab: ProductTab | null): TabAccent {
  // A step of Setup that is no stage of the path (Positioning, the audience's words) never owns the filled button: it points at the next stage.
  const own = tab !== null && stages.find((stage) => stage.id === TAB_STAGE[tab])?.state === 'current'
  return own ? { own: true, next: null } : { own: false, next: nextStage(stages) }
}

/** "2 of 5 done", for the name of the path read by a screen reader. */
export function launchProgress(stages: LaunchStage[]): string {
  return `${stages.filter((s) => s.state === 'done').length} of ${stages.length} done`
}

export interface LaunchCounts {
  channels: number
  approvedPublications: number
  /** Publications written but not approved yet: a draft, or waiting for the owner's approval. */
  draftPublications: number
}

export const DRAFT_PUBLICATION_STATES: readonly OpportunityState[] = ['draft', 'awaiting_approval']

/** Channels and approved publications per product, from the lists the pages already load. */
export function launchCounts(channels: Pick<Channel, 'productId'>[], publications: { opportunity: Pick<Opportunity, 'productId' | 'state' | 'kind'> }[]): Map<Id, LaunchCounts> {
  const counts = new Map<Id, LaunchCounts>()
  const of = (id: Id): LaunchCounts => {
    const found = counts.get(id) ?? { channels: 0, approvedPublications: 0, draftPublications: 0 }
    counts.set(id, found)
    return found
  }
  for (const channel of channels) of(channel.productId).channels++
  for (const { opportunity } of publications) {
    if (opportunity.kind !== 'standalone') continue
    if (APPROVED_PUBLICATION_STATES.includes(opportunity.state)) of(opportunity.productId).approvedPublications++
    else if (DRAFT_PUBLICATION_STATES.includes(opportunity.state)) of(opportunity.productId).draftPublications++
  }
  return counts
}
