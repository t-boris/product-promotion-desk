// The launch path of a product (BUG-012): Product → Passport → Goal → Channel → Publication, each stage done, current
// (the first one not done, the next step) or not yet. Pure, so the rules are tested from src/main/renderer-logic.test.ts.

import type { Channel, Id, Opportunity, OpportunityState } from '../../../../shared/types'
import { productHref, publicationsHref } from '../../route'

export type LaunchStageId = 'product' | 'passport' | 'goal' | 'channel' | 'publication'
export type LaunchStageState = 'done' | 'current' | 'todo'

/** What the path is computed from. The channel and publication counts come from channels.list and opportunities.list. */
export interface LaunchFacts {
  /**
   * At least one source. products.create and products.update refuse a product without one, but removing sources one by one
   * (sources.remove) can still empty it. The product page counts its sources; the product list, which has no sources, assumes one.
   */
  hasSources: boolean
  passportApproved: boolean
  goals: number
  channels: number
  /** Publications the owner approved: ready to send, sending or sent. */
  approvedPublications: number
}

export interface LaunchStage {
  id: LaunchStageId
  label: string
  state: LaunchStageState
  /** Where the stage is worked on: its product tab, or Publications filtered by the product. */
  href: string
  /** What finishing the stage means, for the tooltip of a stage that is not done. */
  todo: string
}

/** A publication counts once the owner approved it. */
export const APPROVED_PUBLICATION_STATES: readonly OpportunityState[] = ['ready', 'sending', 'confirmed']

const STAGES: { id: LaunchStageId; label: string; todo: string; done: (facts: LaunchFacts) => boolean; href: (productId: Id) => string }[] = [
  { id: 'product', label: 'Product', todo: 'Add a source: a website or a description.', done: (f) => f.hasSources, href: (id) => productHref(id, 'sources') },
  { id: 'passport', label: 'Passport', todo: 'Approve the passport.', done: (f) => f.passportApproved, href: (id) => productHref(id, 'passport') },
  { id: 'goal', label: 'Goal', todo: 'Write a goal.', done: (f) => f.goals > 0, href: (id) => productHref(id, 'goal') },
  { id: 'channel', label: 'Channel', todo: 'Connect a channel.', done: (f) => f.channels > 0, href: (id) => productHref(id, 'channels') },
  { id: 'publication', label: 'Publication', todo: 'Approve a publication.', done: (f) => f.approvedPublications > 0, href: (id) => publicationsHref(id) }
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
    return { id: stage.id, label: stage.label, state, href: stage.href(productId), todo: stage.todo }
  })
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
