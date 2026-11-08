// Channel modes and the restricted automatic-reply rule (REQ-003 criteria 3 and 4).
//
// Automatic replies are limited to the categories the owner enabled on the channel AND that are simple:
// a thank-you, or a factual question whose answer is fully supported by approved claims. Everything else -
// complaints, criticism, purchase interest, discounts, refunds, spam, ambiguous requests - always goes to the
// owner, even in automatic mode.
//
// The category is the AI's own label of untrusted comment text, so it is never the only protection: the
// language-independent checks in auto-guard.ts look at the texts themselves (links, numbers, length, support by
// the cited claims), and the engine must be one that cannot use tools.

import type { AutoCategory, Channel, CommentCategory, OpportunityDecision } from '../../shared/types'
import { autoReplyProblem, DISCLOSURE_REASON, mentionsProduct } from './auto-guard'
import type { ClaimView } from './context'

export const TOOL_FREE_REQUIRED_REASON = 'Automatic replies need a tool-free AI engine; the selected engine can use tools, so this reply waits for you'

/** Words that make a comment sensitive regardless of the category the AI picked. */
const SENSITIVE_COMMENT =
  /\b(?:refunds?|money[- ]back|charge\s?back|discounts?|coupons?|promo(?:tional)?\s+codes?|cheaper|price[- ]match|cancel(?:l?ation)?|lawsuits?|lawyers?|legal|scam|fraud|gdpr|privacy|data\s+breach|rip[- ]?off|terrible|awful|worst)\b/i

export function isSensitiveComment(text: string): boolean {
  return SENSITIVE_COMMENT.test(text)
}

/** The channel auto-category a comment category belongs to, or null when it can never be answered automatically. */
export function autoCategoryOf(category: CommentCategory | null): AutoCategory | null {
  if (category === 'thanks') return 'thanks'
  if (category === 'product_question') return 'faq'
  return null
}

export function autoRuleId(category: AutoCategory): string {
  return `auto:${category}:v1`
}

export interface EligibilityInput {
  channel: Channel
  category: CommentCategory
  decision: OpportunityDecision
  commentBody: string
  reply: string
  usedClaimIds: string[]
  approved: ClaimView[]
  /** The selected AI engine cannot use any tools (files, commands, browsing). */
  engineToolFree: boolean
  productName: string
  /** The model's explicit statement that the reply mentions the product and says the author is connected with it. */
  disclosesConnection: boolean
}

export type Eligibility = { eligible: true; ruleId: string } | { eligible: false; why: string }

export function autoEligibility(input: EligibilityInput): Eligibility {
  const no = (why: string): Eligibility => ({ eligible: false, why })
  const { channel } = input
  if (channel.mode !== 'auto') return no('the channel is not in automatic mode')
  if (input.decision !== 'reply') return no('the AI did not propose a reply')
  // Comment text is untrusted input: an engine with tools could be steered into using them.
  if (!input.engineToolFree) return no(TOOL_FREE_REQUIRED_REASON)

  const auto = autoCategoryOf(input.category)
  if (!auto) return no(`"${input.category.replace('_', ' ')}" requests are always reviewed by you`)
  if (!channel.settings.autoCategories.includes(auto)) return no(`automatic replies are not enabled for "${auto}" on this channel`)
  if (isSensitiveComment(input.commentBody)) return no('the comment touches a sensitive topic (refunds, discounts, complaints or legal matters)')

  const approvedById = new Map(input.approved.map((c) => [c.id, c]))
  const cited: ClaimView[] = []
  if (auto === 'faq') {
    // A factual answer must be fully supported by approved, confirmed claims.
    if (input.usedClaimIds.length === 0) return no('the answer is not supported by any approved claim')
    for (const id of input.usedClaimIds) {
      const claim = approvedById.get(id)
      if (!claim) return no('the answer relies on a claim that is not approved')
      if (claim.unconfirmedAvailability) return no('the answer relies on a capability whose availability is unconfirmed')
      cited.push(claim)
    }
  } else {
    for (const id of input.usedClaimIds) {
      const claim = approvedById.get(id)
      if (claim) cited.push(claim)
    }
    if (input.usedClaimIds.length > cited.length) return no('the reply relies on a claim that is not approved')
  }

  // The checks that do not depend on the AI's label or on the language of the texts.
  const problem = autoReplyProblem({ category: auto, reply: input.reply, comment: input.commentBody, claims: cited })
  if (problem) return no(problem)

  // A reply that names the product speaks for the owner's connection to it; only an explicit disclosure passes.
  if (mentionsProduct(input.reply, input.productName) && !input.disclosesConnection) return no(DISCLOSURE_REASON)

  // Automatic sending is allowed only on a reply path that an approved manual send has already proven.
  const capability = channel.capabilities.find((c) => c.key === 'publish_reply')
  if (capability?.status !== 'verified') return no('replying on this channel has not been verified by an approved manual reply yet')

  return { eligible: true, ruleId: autoRuleId(auto) }
}
