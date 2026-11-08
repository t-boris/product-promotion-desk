// Language-independent guards for replies that go out WITHOUT the owner reading them (REQ-003 criterion 4).
//
// Automatic mode leans on the AI's own label of a comment ("thanks", "product question") and on the English-only
// patterns in safety.ts. Neither can be trusted alone: comment text is untrusted input that can steer the model's
// label, and the patterns know nothing about other languages. These checks look only at the SHAPE of the texts -
// links, numbers, length, mentions - and at whether the reply is supported by the claims it cites, using nothing
// but letters and digits, so they work the same in every language. Anything doubtful goes to the owner, which
// costs one click; a wrong automatic reply cannot be taken back.

import type { AutoCategory } from '../../shared/types'
import type { ClaimView } from './context'

/** An automatic reply is short. A longer one is not "simple" and the owner reads it first. */
export const AUTO_MAX_REPLY_CHARS = 400
/** A thank-you has no content to speak of. */
export const AUTO_THANKS_MAX_CHARS = 200
/** Incoming comments beyond this are not handled without the owner (they hide more than one request). */
export const AUTO_MAX_COMMENT_CHARS = 600
/** A thank-you is answered automatically only when the comment itself is short. */
export const AUTO_THANKS_MAX_COMMENT_CHARS = 300

/** At least this share of the reply's content words must come from the claims it cites. */
const MIN_SUPPORT_RATIO = 0.6

// Anything that looks like an address, a handle or markup: a scheme, "www.", a markdown link, an @mention or
// e-mail, a path, or any "word.word" token (bit.ly/x, example.co, name.name). Deliberately broad: a false alarm
// only sends the reply to the owner.
const LINK_LIKE = [/:\/\//, /\bwww\./i, /\]\s*\(/, /@/, /\S+\.\S{2,}/u, /\//]
const NUMBER_OR_CURRENCY = /[\p{N}\p{Sc}]/u
const QUESTION_MARK = /[?？¿؟;]/u

export const hasLinkLike = (text: string): boolean => LINK_LIKE.some((pattern) => pattern.test(text))
export const hasNumberOrCurrency = (text: string): boolean => NUMBER_OR_CURRENCY.test(text)
export const asksQuestion = (text: string): boolean => QUESTION_MARK.test(text)

// Function words that would make unrelated texts look alike. The check still works without them in other
// languages; it is only less forgiving there, which errs towards the owner.
const FUNCTION_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'are', 'you', 'your', 'our', 'can', 'from', 'has', 'have', 'not', 'but', 'all', 'any', 'its', 'was',
  'were', 'will', 'one', 'use', 'get', 'how', 'what', 'does', 'yes', 'also', 'they', 'them', 'there', 'here', 'just', 'very', 'been', 'would', 'could'
])

const contentWords = (text: string): string[] => [...new Set((text.toLowerCase().match(/[\p{L}\p{M}]{3,}/gu) ?? []).filter((w) => !FUNCTION_WORDS.has(w)))]

/** Same word, or the same stem: a shared 5-letter beginning ("builds"/"building") counts. Works for most scripts. */
const sameWord = (a: string, b: string): boolean => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5))

const sharedWith = (words: string[], pool: string[]): string[] => words.filter((w) => pool.some((p) => sameWord(w, p)))

/** Why a factual answer is not supported by the claims it cites, or null when it clearly is. */
function unsupportedAnswer(reply: string, comment: string, claims: ClaimView[]): string | null {
  const claimWords = contentWords(claims.map((c) => c.text).join(' '))
  const replyWords = contentWords(reply)
  if (replyWords.length === 0) return 'the answer says nothing that can be checked against the cited claims'
  const shared = sharedWith(replyWords, claimWords)
  if (shared.length < Math.min(2, replyWords.length) || shared.length / replyWords.length < MIN_SUPPORT_RATIO) {
    return 'the answer goes beyond what the cited claims say'
  }
  // The claims must also be about what was asked, not merely about the product.
  if (sharedWith(contentWords(comment), claimWords).length === 0) return 'the cited claims do not address what was asked'
  return null
}

export interface AutoReplyCheck {
  category: AutoCategory
  reply: string
  comment: string
  /** The approved claims the reply cites. */
  claims: ClaimView[]
}

/** The reason a reply may not be sent automatically, or null when every language-independent check passes. */
export function autoReplyProblem(input: AutoReplyCheck): string | null {
  const { reply, comment } = input
  if (hasLinkLike(comment)) return 'the comment contains a link or an address'
  if (comment.length > AUTO_MAX_COMMENT_CHARS) return 'the comment is long and may hold more than one request'
  if (hasLinkLike(reply)) return 'the reply contains a link, an address or a mention'
  if (hasNumberOrCurrency(reply)) return 'the reply contains a number or an amount'
  if (reply.length > AUTO_MAX_REPLY_CHARS) return 'the reply is long enough to deserve your review'

  if (input.category === 'thanks') {
    if (input.claims.length > 0) return 'a thank-you that relies on product facts is not a plain thank-you'
    if (reply.length > AUTO_THANKS_MAX_CHARS) return 'a thank-you reply should be short'
    if (comment.length > AUTO_THANKS_MAX_COMMENT_CHARS) return 'the comment is too long to be a plain thank-you'
    if (asksQuestion(comment)) return 'the comment asks a question'
    return null
  }
  return unsupportedAnswer(reply, comment, input.claims)
}
