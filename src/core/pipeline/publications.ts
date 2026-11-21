// Standalone publications (SRC-001 section 5, REQ-003 criterion 5): written by the owner or proposed by the AI
// from approved knowledge and the channel. They ALWAYS need the owner's own approval (never an automatic rule),
// and what the connector can actually post (text, link, images) is decided by the connector and the channel's
// verified capabilities, not here.

import { ApiError, type DraftInput } from '../../shared/api'
import type { Id, IsoTime, Opportunity } from '../../shared/types'
import type { Core } from '../core'
import { holdsCredential } from '../assist/kit'
import { AiError } from '../ports'
import { loadKnowledge, postChannelView, roleView } from './context'
import { normalizeDraftInput, isHttpUrl } from './draft-input'
import {
  buildPublicationPrompt,
  buildUpdatePrompt,
  parsePublicationProposal,
  parseUpdateProposal,
  PUBLICATION_LABEL,
  PUBLICATION_SYSTEM,
  UPDATE_LABEL,
  UPDATE_SYSTEM,
  type PublicationProposal
} from './draft-prompt'
import { addressesNotInNote, numbersNotInNote } from './update-check'
import { withRole } from './role'
import { allowedHostsFor, checkDraftSafety, hostOf, linksIn } from './safety'
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
    const content = await normalizeDraftInput(input, { productId: channel.productId, media: this.core.services.media! })
    if (!content.text && !content.link && content.attachments.length === 0) {
      throw new ApiError('invalid_input', 'A publication needs text, a link or an image.')
    }
    const opp = this.core.db.transaction(() => {
      const created = this.store.createStandalone(channel, 'draft', 'Written by you')
      this.store.insertDraft(created.id, content, { knowledgeVersionId: null, usedClaimLineageIds: [], rationale: '', author: 'user' })
      return created
    })()
    // The entry says that a draft was written, not what it says, and later edits of it stay out of the log (BUG-066).
    this.core.log.info('pipeline', `Draft written for ${channel.target}`, channel.id)
    this.store.notify()
    return opp
  }

  /**
   * The AI proposes a topic and a draft for the channel. Nothing is published; the owner edits and approves. `focus` and `origin` are for
   * the content mix (DEC-033): what the post is for, and how its card says where it came from.
   */
  async suggest(channelId: Id, options: { focus?: string; origin?: string } = {}): Promise<Opportunity> {
    const channel = this.store.requireChannel(channelId)
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)
    const role = roleView(this.core.repos.account(channel.accountId))
    if (knowledge.approved.length === 0) {
      throw new ApiError('no_knowledge', 'There is no approved product knowledge yet. Approve claims in the product passport first.')
    }

    const previousPosts = this.previousPosts(channelId)
    const recentTitles = (this.core.db.prepare('SELECT title FROM discussions WHERE channel_id = ? ORDER BY last_seen_at DESC LIMIT 10').all(channelId) as { title: string }[]).map((d) => d.title)

    let raw: string
    try {
      raw = await this.core.engines.require().run({
        label: PUBLICATION_LABEL,
        system: PUBLICATION_SYSTEM,
        prompt: buildPublicationPrompt({
          channel: postChannelView(channel),
          product: { name: product.name, website: product.websiteUrl, description: product.description },
          role,
          approved: knowledge.approved,
          prohibited: knowledge.prohibited,
          previousPosts,
          recentTitles,
          focus: options.focus
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
      // Posts always wait for the owner.
      const created = this.store.createStandalone(channel, 'draft', `${options.origin ? `${options.origin}. ` : ''}Suggested topic: ${proposal.topic}`)
      this.store.insertDraft(
        created.id,
        { title: proposal.title, text: proposal.text, link: proposal.link, attachments: [] },
        {
          knowledgeVersionId: knowledge.versionId,
          usedClaimLineageIds: [...new Set(report.usedClaims.map((c) => c.lineageId))],
          rationale: withRole(proposal.rationale, role),
          author: 'ai'
        }
      )
      return created
    })()
    this.store.notify()
    return opp
  }

  /**
   * An own update (DEC-033): the AI writes one post, as the channel's login, from ONE unused note of the owner and from nothing else. The post
   * may state what the note says; a number the note does not contain, an address it does not contain, a fact the model itself says it added,
   * a price, a discount or a prohibited statement refuses it. A draft only: it waits for the owner, as every post does.
   */
  async suggestUpdate(channelId: Id, noteId: Id, options: { origin?: string } = {}): Promise<Opportunity> {
    const channel = this.store.requireChannel(channelId)
    const product = this.core.repos.product(channel.productId)
    const account = this.core.repos.account(channel.accountId)
    const note = this.core.db.prepare('SELECT id, product_id, text, used_in_opportunity_id FROM product_updates WHERE id = ?').get(noteId) as
      | { id: string; product_id: string; text: string; used_in_opportunity_id: string | null }
      | undefined
    if (!note || note.product_id !== channel.productId) throw new ApiError('not_found', 'That note is not one of this product.')
    if (note.used_in_opportunity_id) throw new ApiError('invalid_state', 'This note was used for a post already.')
    const knowledge = loadKnowledge(this.core, channel.productId)
    const role = roleView(account)
    const profile = account.profileId
      ? (this.core.db.prepare("SELECT display_name, about, purpose FROM profiles WHERE id = ? AND status = 'approved'").get(account.profileId) as { display_name: string; about: string; purpose: string } | undefined)
      : undefined

    let raw: string
    try {
      raw = await this.core.engines.require().run({
        label: UPDATE_LABEL,
        system: UPDATE_SYSTEM,
        prompt: buildUpdatePrompt({
          channel: postChannelView(channel),
          product: { name: product.name, website: product.websiteUrl },
          role,
          persona: profile ? { name: profile.display_name, about: profile.about, purpose: profile.purpose } : null,
          note: note.text,
          prohibited: knowledge.prohibited,
          previousPosts: this.previousPosts(channelId)
        }),
        timeoutMs: AI_TIMEOUT_MS
      })
    } catch (error) {
      const why = error instanceof AiError ? error.message : errorMessage(error)
      throw new ApiError('ai_unavailable', `The AI could not write the post: ${why} You can write it yourself.`)
    }

    let proposal
    try {
      proposal = parseUpdateProposal(raw)
    } catch (error) {
      throw new ApiError('ai_invalid', `The AI returned an unusable post (${errorMessage(error)}). Try again or write it yourself.`)
    }
    if (proposal.link && !isHttpUrl(proposal.link)) throw new ApiError('ai_invalid', 'The AI wrote a link that is not a valid address.')

    // Only the note's own addresses (and the product's site) are allowed; no approved fact is cited, so none can back a price or a promise.
    const report = checkDraftSafety({
      title: proposal.title,
      text: proposal.text,
      link: proposal.link,
      usedClaimIds: [],
      approved: knowledge.approved,
      prohibited: knowledge.prohibited,
      allowedHosts: [...allowedHostsFor(product.websiteUrl, []), ...linksIn(note.text).hosts]
    })
    const violations = [...report.violations]
    if (proposal.addsFactsBeyondNote) violations.push('the post says it contains something the note does not')
    // A note is free text and may hold a secret by mistake; a public post must not carry it.
    if (holdsCredential([proposal.title, proposal.text].join('\n'))) violations.push('it holds a credential')
    const strange = numbersNotInNote([proposal.title, proposal.text].join('\n'), note.text)
    if (strange.length > 0) violations.push(`it states ${strange.length === 1 ? 'a number' : 'numbers'} the note does not contain (${strange.slice(0, 3).join(', ')})`)
    const siteHost = product.websiteUrl ? hostOf(product.websiteUrl) : null
    const strayAddresses = addressesNotInNote([proposal.title, proposal.text, proposal.link ?? ''].join('\n'), note.text, siteHost)
    if (strayAddresses.length > 0) violations.push(`it links to ${strayAddresses.slice(0, 2).join(', ')}, which is not the address the note gives`)
    if (violations.length > 0) throw new ApiError('blocked', `The post was blocked by the safety checks: ${violations.join('; ')}.`)

    const opp = this.core.db.transaction(() => {
      const created = this.store.createStandalone(
        channel,
        'draft',
        `${options.origin ? `${options.origin}. ` : ''}Own update, from your note: "${note.text.replace(/\s+/g, ' ').slice(0, 80)}"`
      )
      // The note is used by this post and by no other: a note used meanwhile (a second press) stops this one.
      const taken = this.core.db.prepare('UPDATE product_updates SET used_in_opportunity_id = ? WHERE id = ? AND used_in_opportunity_id IS NULL').run(created.id, note.id)
      if (taken.changes !== 1) throw new ApiError('invalid_state', 'This note was used for a post already.')
      this.store.insertDraft(
        created.id,
        { title: proposal.title, text: proposal.text, link: proposal.link, attachments: [] },
        { knowledgeVersionId: knowledge.versionId, usedClaimLineageIds: [], rationale: withRole(proposal.rationale, role), author: 'ai' }
      )
      return created
    })()
    this.store.notify()
    return opp
  }

  /** What the channel has posted lately, to keep the AI from repeating itself. */
  private previousPosts(channelId: Id): string[] {
    return (
      this.core.db
        .prepare("SELECT d.title, d.text FROM opportunities o JOIN drafts d ON d.opportunity_id = o.id WHERE o.channel_id = ? AND o.kind = 'standalone' AND o.state NOT IN ('cancelled') ORDER BY d.created_at DESC, d.rowid DESC LIMIT 20")
        .all(channelId) as { title: string | null; text: string }[]
    )
      .slice(0, 8)
      .map((d) => d.title || d.text.slice(0, 80))
  }

  /** Sets (or clears) the planned send time. Scheduling does not approve: the item still needs the owner's approval. */
  schedule(id: Id, at: IsoTime | null): Opportunity {
    const opp = this.store.requireOpportunity(id)
    if (opp.kind !== 'standalone') throw new ApiError('invalid_state', 'Only standalone publications can be scheduled.')
    if (SEND_LOCKED_STATES.includes(opp.state)) throw new ApiError('invalid_state', 'This publication has already been sent or is being sent.')
    let scheduledAt: string | null = null
    if (at !== null) {
      // A channel the app cannot read is reached only by the AI browser, which carries a send the owner presses: a scheduled send could never go out.
      if (!this.store.requireChannel(opp.channelId).reads) {
        throw new ApiError('invalid_state', 'A post for this channel goes out by the AI browser, which carries only a send you press yourself, so it cannot be scheduled. Press Send on it when you want it out, or use “Copy post” and publish it by hand.')
      }
      const time = Date.parse(at)
      if (Number.isNaN(time)) throw new ApiError('invalid_input', 'The scheduled time is not a valid date.')
      scheduledAt = new Date(time).toISOString()
    }
    this.store.updateOpportunity(id, { scheduledAt })
    this.store.notify()
    return this.store.requireOpportunity(id)
  }
}
