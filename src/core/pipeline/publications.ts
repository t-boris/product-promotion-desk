// Standalone publications (SRC-001 section 5, REQ-003 criterion 5): written by the owner or proposed by the AI
// from approved knowledge and the channel. They ALWAYS need the owner's own approval (never an automatic rule),
// and what the connector can actually post (text, link, images) is decided by the connector and the channel's
// verified capabilities, not here.

import { ApiError, type DraftInput } from '../../shared/api'
import type { Id, IsoTime, Opportunity } from '../../shared/types'
import type { Core } from '../core'
import { AiError } from '../ports'
import { channelView, loadKnowledge } from './context'
import { normalizeDraftInput, isHttpUrl } from './draft-input'
import { buildPublicationPrompt, parsePublicationProposal, PUBLICATION_LABEL, PUBLICATION_SYSTEM, type PublicationProposal } from './draft-prompt'
import { allowedHostsFor, checkDraftSafety } from './safety'
import { SEND_LOCKED_STATES, type FlowStore } from './store'
import { errorMessage } from './util'

const AI_TIMEOUT_MS = 180_000

export class PublicationsFlow {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  /** The owner writes a publication by hand. */
  async create(channelId: Id, input: DraftInput): Promise<Opportunity> {
    const channel = this.store.requireChannel(channelId)
    const content = await normalizeDraftInput(input)
    if (!content.text && !content.link && content.attachments.length === 0) {
      throw new ApiError('invalid_input', 'A publication needs text, a link or an image.')
    }
    const opp = this.core.db.transaction(() => {
      const created = this.store.createStandalone(channel, 'draft', 'Written by you')
      this.store.insertDraft(created.id, content, { knowledgeVersionId: null, usedClaimLineageIds: [], rationale: '', author: 'user' })
      return created
    })()
    this.store.notify()
    return opp
  }

  /** The AI proposes a topic and a draft for the channel. Nothing is published; the owner edits and approves. */
  async suggest(channelId: Id): Promise<Opportunity> {
    const channel = this.store.requireChannel(channelId)
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)
    if (knowledge.approved.length === 0) {
      throw new ApiError('no_knowledge', 'There is no approved product knowledge yet. Approve claims in the product passport first.')
    }

    const previousPosts = (
      this.core.db
        .prepare("SELECT d.title, d.text FROM opportunities o JOIN drafts d ON d.opportunity_id = o.id WHERE o.channel_id = ? AND o.kind = 'standalone' AND o.state NOT IN ('cancelled') ORDER BY d.created_at DESC, d.rowid DESC LIMIT 20")
        .all(channelId) as { title: string | null; text: string }[]
    )
      .slice(0, 8)
      .map((d) => d.title || d.text.slice(0, 80))
    const recentTitles = (this.core.db.prepare('SELECT title FROM discussions WHERE channel_id = ? ORDER BY last_seen_at DESC LIMIT 10').all(channelId) as { title: string }[]).map((d) => d.title)

    let raw: string
    try {
      raw = await this.core.engines.require().run({
        label: PUBLICATION_LABEL,
        system: PUBLICATION_SYSTEM,
        prompt: buildPublicationPrompt({
          channel: channelView(channel),
          product: { name: product.name, website: product.websiteUrl, description: product.description },
          approved: knowledge.approved,
          prohibited: knowledge.prohibited,
          previousPosts,
          recentTitles
        }),
        timeoutMs: AI_TIMEOUT_MS
      })
    } catch (error) {
      const why = error instanceof AiError ? error.message : errorMessage(error)
      throw new ApiError('ai_unavailable', `The AI could not prepare a suggestion: ${why} You can write the publication yourself.`)
    }

    let proposal: PublicationProposal
    try {
      proposal = parsePublicationProposal(raw)
    } catch (error) {
      throw new ApiError('ai_invalid', `The AI returned an unusable suggestion (${errorMessage(error)}). Try again or write it yourself.`)
    }
    if (proposal.link && !isHttpUrl(proposal.link)) throw new ApiError('ai_invalid', 'The AI suggested a link that is not a valid address.')

    const report = checkDraftSafety({
      title: proposal.title,
      text: proposal.text,
      link: proposal.link,
      usedClaimIds: proposal.usedClaimIds,
      approved: knowledge.approved,
      prohibited: knowledge.prohibited,
      allowedHosts: allowedHostsFor(product.websiteUrl, knowledge.approved)
    })
    const violations = [...report.violations]
    if (report.usedClaims.length === 0) violations.push('a publication about the product must cite at least one approved claim')
    if (violations.length > 0) {
      throw new ApiError('blocked', `The suggestion was blocked by the safety checks: ${violations.join('; ')}.`)
    }

    const opp = this.core.db.transaction(() => {
      const created = this.store.createStandalone(channel, 'draft', `Suggested topic: ${proposal.topic}`)
      this.store.insertDraft(
        created.id,
        { title: proposal.title, text: proposal.text, link: proposal.link, attachments: [] },
        {
          knowledgeVersionId: knowledge.versionId,
          usedClaimLineageIds: [...new Set(report.usedClaims.map((c) => c.lineageId))],
          rationale: proposal.rationale,
          author: 'ai'
        }
      )
      return created
    })()
    this.store.notify()
    return opp
  }

  /** Sets (or clears) the planned send time. Scheduling does not approve: the item still needs the owner's approval. */
  schedule(id: Id, at: IsoTime | null): Opportunity {
    const opp = this.store.requireOpportunity(id)
    if (opp.kind !== 'standalone') throw new ApiError('invalid_state', 'Only standalone publications can be scheduled.')
    if (SEND_LOCKED_STATES.includes(opp.state)) throw new ApiError('invalid_state', 'This publication has already been sent or is being sent.')
    let scheduledAt: string | null = null
    if (at !== null) {
      const time = Date.parse(at)
      if (Number.isNaN(time)) throw new ApiError('invalid_input', 'The scheduled time is not a valid date.')
      scheduledAt = new Date(time).toISOString()
    }
    this.store.updateOpportunity(id, { scheduledAt })
    this.store.notify()
    return this.store.requireOpportunity(id)
  }
}
