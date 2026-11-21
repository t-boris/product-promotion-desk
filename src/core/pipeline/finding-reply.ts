// "Reply here" in the Feed: the AI writes (or, on the owner's word, rewrites) the comment for ONE place of a thread it read: the post, or one of the comments
// under it. The owner picks the place, reads the text, says what to change ("shorter", "no link") and asks again, as many times as they like; the text they
// finally agree on is theirs. Nothing is stored and nothing is sent from here.
//
// It is the same help as "Write it / Improve it" of a draft (draft-help.ts): the same rules for the AI (approved facts only, nothing prohibited, no promise,
// links only to the product's own site, the voice of the account), the same checks of the answer, the same
// refusal when the product knowledge changed while the AI wrote. Only the discussion is made from what the AI saw in the browser instead of a stored thread.

import { ApiError } from '../../shared/api'
import type { Channel, Finding, FindingComment, Id } from '../../shared/types'
import { readyEngine } from '../assist/gate'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { AiError } from '../ports'
import { MAX_CURRENT, MAX_INSTRUCTION, knowledgeKey, ownerLine, refineDraft, type DraftHelper, type DraftHelpInput } from './draft-help'
import { channelView, loadKnowledge, roleView, type ContextComment, type ReplyContext } from './context'
import type { FindingStore } from './findings'

export interface FindingReplyArgs {
  id: Id
  /** The place to answer: the position of a comment of the thread, or null for the post itself. */
  place: number | null
  /** The text now (what the owner may have changed); empty to write it from nothing. */
  current?: string
  /** The owner's wish for this text ("shorter", "friendlier"); empty for "make it better". */
  instruction?: string
}

/** How many comments above the one answered are shown to the AI as what it answers to: the chain up to the post, nearest first, at most this many. */
const MAX_CHAIN = 6

/**
 * The discussion as the AI is shown it, for one place. For the post: the post is what is answered (a top-level comment). For a comment: that comment is
 * what is answered, with the chain of comments it sits under (oldest first) as its ancestors. Words of the strangers are the AI's reading of a page:
 * they reach the prompt only inside the fenced data blocks.
 */
export function findingReplyContext(
  finding: Pick<Finding, 'id' | 'externalId' | 'title' | 'author' | 'about' | 'url'>,
  thread: readonly FindingComment[],
  place: number | null,
  base: Pick<ReplyContext, 'channel' | 'product' | 'role' | 'knowledge'>
): ReplyContext {
  const discussion = { title: finding.title, author: finding.author, body: finding.about, url: finding.url }
  if (place === null) {
    const body = [finding.title, finding.about].filter((part) => part.trim() !== '').join('\n\n')
    return { ...base, source: 'new_post', discussion, comment: { id: finding.id, externalId: finding.externalId, author: finding.author, body, url: finding.url, contentHash: '' }, ancestors: [], ownReplies: [] }
  }
  const target = thread.find((c) => c.position === place)
  if (!target) throw new ApiError('invalid_input', 'That comment is not in this thread.')
  // The chain it sits under: walking back through the reading order, each comment shallower than the last one taken is its parent, then its grandparent.
  const ancestors: ContextComment[] = []
  let depth = target.depth
  for (const c of [...thread].reverse().filter((c) => c.position < target.position)) {
    if (depth === 0 || ancestors.length >= MAX_CHAIN) break
    if (c.depth < depth) {
      ancestors.unshift({ author: c.author, body: c.text, own: false, postedAt: null })
      depth = c.depth
    }
  }
  return {
    ...base,
    source: 'comment',
    discussion,
    comment: { id: finding.id, externalId: `${finding.externalId}#${target.position}`, author: target.author, body: target.text, url: target.url || finding.url, contentHash: '' },
    ancestors,
    ownReplies: []
  }
}

export class FindingReply {
  constructor(
    private readonly core: Core,
    private readonly findings: FindingStore,
    private readonly ai: DraftHelper = { refineDraft }
  ) {}

  async write(args: FindingReplyArgs): Promise<{ text: string }> {
    const finding = this.findings.get(requireText(args.id, 'The finding'))
    if (finding.about.trim() === '') throw new ApiError('not_read', 'The AI has not read this post yet. It reads the thread at the next check of the channel.')
    const thread = this.findings.thread(finding.id)
    if (args.place !== null && !(Number.isInteger(args.place) && thread.some((c) => c.position === args.place))) throw new ApiError('invalid_input', 'That comment is not in this thread.')
    const current = typeof args.current === 'string' ? args.current : ''
    if (current.length > MAX_CURRENT) throw new ApiError('invalid_input', `The text is too long for the AI to read whole (up to ${MAX_CURRENT} characters).`)
    const instruction = ownerLine(args.instruction, MAX_INSTRUCTION, 'What to change')

    const channel: Channel = found(() => this.core.repos.channel(finding.channelId), 'The channel')
    const engine = await readyEngine(this.core)
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)
    const productView = { name: product.name, website: product.websiteUrl, description: product.description }
    const role = roleView(this.core.repos.account(channel.accountId))
    const reply = findingReplyContext(finding, thread, args.place, { channel: channelView(channel), product: productView, role, knowledge })
    const input: DraftHelpInput = {
      field: 'text',
      subject: { kind: 'reply', channel: reply.channel, product: productView, role, approved: knowledge.approved, prohibited: knowledge.prohibited, reply },
      form: { title: '', text: current },
      instruction,
      about: ''
    }
    let text: string
    try {
      text = (await this.ai.refineDraft(engine, input)).text ?? ''
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
    // The checks ran against the knowledge the AI was given: if it changed while the AI wrote, the text is not handed over as checked.
    const now = this.core.repos.product(channel.productId)
    if (knowledgeKey(loadKnowledge(this.core, channel.productId), now) !== knowledgeKey(knowledge, product)) {
      throw new ApiError('suggest_failed', 'The product knowledge changed while the AI was writing. Ask again.')
    }
    // The log says that a text was written, never what it says.
    this.core.log.info('pipeline', `The AI ${current.trim() === '' ? 'wrote' : 'improved'} a reply for a post of ${channel.target}. Nothing is saved or sent.`, channel.id)
    return { text }
  }
}
