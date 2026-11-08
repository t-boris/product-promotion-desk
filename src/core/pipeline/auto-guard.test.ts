import { describe, expect, it } from 'vitest'
import { DEFAULT_CHANNEL_SETTINGS, type Channel, type ChannelMode } from '../../shared/types'
import { asksQuestion, autoReplyProblem, hasLinkLike, hasNumberOrCurrency } from './auto-guard'
import type { ClaimView } from './context'
import { autoEligibility, TOOL_FREE_REQUIRED_REASON } from './modes'
import { verifiedCapabilities } from './test-fixture'

const claim = (id: string, text: string): ClaimView => ({ id, lineageId: `lin-${id}`, text, section: 'offer', unconfirmedAvailability: false })
const CHART = claim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.')
const PLATFORMS = claim('c2', 'The app works on iPhone and Android.')
const APPROVED = [CHART, PLATFORMS]

const channel = (mode: ChannelMode = 'auto'): Channel =>
  ({
    id: 'ch',
    mode,
    settings: { ...DEFAULT_CHANNEL_SETTINGS, autoCategories: ['thanks', 'faq'] },
    capabilities: verifiedCapabilities()
  }) as unknown as Channel

function eligible(over: Partial<Parameters<typeof autoEligibility>[0]> = {}) {
  return autoEligibility({
    channel: channel(),
    category: 'product_question',
    decision: 'reply',
    commentBody: 'Does it work on Android?',
    reply: 'It works on iPhone and Android.',
    usedClaimIds: ['c2'],
    approved: APPROVED,
    engineToolFree: true,
    productName: 'Natal Mystic',
    disclosesConnection: false,
    ...over
  })
}

describe('shape checks that do not depend on a language', () => {
  it.each([
    ['a shortened link', 'bit.ly/x'],
    ['a bare domain with a short TLD', 'visit example.co'],
    ['a domain on any TLD', 'see natal.mystic.zzz for details'],
    ['a scheme', 'try https://evil.test/a'],
    ['www', 'try www.evil'],
    ['a markdown link', 'click [here](evil)'],
    ['an e-mail address', 'write to someone@example'],
    ['an @mention', 'thanks @bob'],
    ['a reddit handle', 'ask u/someone'],
    ['a path', 'see the docs/page'],
    ['a dotted token glued to a word', 'works great.thanks']
  ])('treats %s as a link or address', (_name, text) => {
    expect(hasLinkLike(text)).toBe(true)
  })

  it.each(['Thanks, glad you like it!', 'It builds a chart from your birth data. Enjoy.', 'Gracias, con gusto.', 'Yes. It does. Really.'])('does not take plain prose for a link: %s', (text) => {
    expect(hasLinkLike(text)).toBe(false)
  })

  it('errs on the side of the owner: an ellipsis glued to a word counts as a dotted token', () => {
    expect(hasLinkLike('Wait...really')).toBe(true)
  })

  it.each(['$5', 'only 5', '€ten 10', '99%', '٣ dollars', '½ price', '¥100'])('finds a number or an amount in %s', (text) => {
    expect(hasNumberOrCurrency(text)).toBe(true)
  })

  it.each(['?', 'what?', '¿qué?', 'なに？', 'ما هذا؟'])('recognises a question mark in %s', (text) => {
    expect(asksQuestion(text)).toBe(true)
  })
})

describe('automatic eligibility: the label of the AI is not enough (REQ-003 criterion 4)', () => {
  it('accepts a short, supported, link-free factual answer', () => {
    expect(eligible()).toEqual({ eligible: true, ruleId: 'auto:faq:v1' })
  })

  it('accepts a plain thank-you', () => {
    expect(eligible({ category: 'thanks', commentBody: 'Thanks, this is great!', reply: 'Glad you like it, enjoy!', usedClaimIds: [] })).toEqual({ eligible: true, ruleId: 'auto:thanks:v1' })
  })

  it.each([
    ['a shortened link', 'Details at bit.ly/x', /link, an address or a mention/],
    ['a bare domain', 'Visit example.co for the app on Android and iPhone', /link, an address or a mention/],
    ['an amount', 'It works on iPhone and Android for $5', /number or an amount/],
    ['a digit', 'It works on iPhone and Android 14', /number or an amount/],
    ['an @mention', '@bob it works on iPhone and Android', /link, an address or a mention/],
    ['too much text', `It works on iPhone and Android. ${'And it works well. '.repeat(30)}`, /deserve your review/]
  ])('sends a reply with %s to the owner', (_name, reply, why) => {
    const result = eligible({ reply })
    expect(result.eligible).toBe(false)
    expect((result as { why: string }).why).toMatch(why)
  })

  it('sends a factual answer that the cited claims do not support to the owner, whatever its language', () => {
    const spanish = eligible({ commentBody: 'Quiero que me devuelvan mi dinero', reply: 'Le devolveremos todo su dinero hoy mismo' })
    expect(spanish.eligible).toBe(false)
    expect((spanish as { why: string }).why).toMatch(/goes beyond what the cited claims say/)

    const invented = eligible({ reply: 'It also supports Windows, Linux and a lifetime guarantee with unlimited support' })
    expect(invented.eligible).toBe(false)
    expect((invented as { why: string }).why).toMatch(/goes beyond/)
  })

  it('does not accept an answer that merely repeats a few words of an unrelated claim', () => {
    const result = eligible({ commentBody: 'Does it work on Android?', reply: 'Yes the app delivers everything astrologers dream about, builds charts' })
    expect(result.eligible).toBe(false)
  })

  it('sends an answer to the owner when the cited claim is about something else than what was asked', () => {
    const result = eligible({ commentBody: 'Is there a desktop version for Windows?', reply: 'It builds a natal chart from your birth date, time and place.', usedClaimIds: ['c1'] })
    // "natal chart" is supported by c1 but nothing in c1 relates to the question.
    expect(result.eligible).toBe(false)
    expect((result as { why: string }).why).toMatch(/do not address what was asked/)
  })

  it('requires a cited claim for a factual answer', () => {
    expect(eligible({ usedClaimIds: [] }).eligible).toBe(false)
  })

  it('never auto-handles a comment that contains a link, or a very long one', () => {
    const withLink = eligible({ commentBody: 'Does it work on Android? Compare with https://rival.example/app' })
    expect(withLink.eligible).toBe(false)
    expect((withLink as { why: string }).why).toMatch(/comment contains a link/)

    const bareDomain = eligible({ commentBody: 'Does it work on Android like rival.app does' })
    expect(bareDomain.eligible).toBe(false)

    const long = eligible({ commentBody: `Does it work on Android? ${'I have many other things to say about this. '.repeat(20)}` })
    expect(long.eligible).toBe(false)
    expect((long as { why: string }).why).toMatch(/comment is long/)
  })

  it('treats a thank-you as plain: no facts cited, short, and the comment is not a question', () => {
    const base = { category: 'thanks' as const, commentBody: 'Thanks, great app!', reply: 'Glad you like it!', usedClaimIds: [] }
    expect(eligible(base).eligible).toBe(true)
    expect(eligible({ ...base, usedClaimIds: ['c2'] }).eligible).toBe(false)
    expect(eligible({ ...base, reply: `Thank you so much for the kind words, it really means a lot to everyone. ${'Enjoy! '.repeat(20)}` }).eligible).toBe(false)
    expect(eligible({ ...base, commentBody: 'Thanks! But can you also fix my other problem?' }).eligible).toBe(false)
    expect(eligible({ ...base, commentBody: 'Gracias, ¿puedo cancelar?' }).eligible).toBe(false)
    expect(eligible({ ...base, commentBody: `Thanks! ${'More and more thoughts. '.repeat(20)}` }).eligible).toBe(false)
    expect(eligible({ ...base, reply: 'Glad you like it, version 2 is coming!' }).eligible).toBe(false)
    expect(eligible({ ...base, reply: 'Glad you like it, see natalmystic.com' }).eligible).toBe(false)
  })

  it('keeps the English sensitive-topic list as an additional layer', () => {
    const result = eligible({ commentBody: 'Does it work on Android? Also I want a refund' })
    expect(result.eligible).toBe(false)
    expect((result as { why: string }).why).toMatch(/sensitive/)
  })

  it('requires a tool-free engine', () => {
    const result = eligible({ engineToolFree: false })
    expect(result).toEqual({ eligible: false, why: TOOL_FREE_REQUIRED_REASON })
  })

  it('is never eligible outside automatic mode', () => {
    expect(eligible({ channel: channel('approval') }).eligible).toBe(false)
  })

  it('exposes the same verdict as the direct check', () => {
    expect(autoReplyProblem({ category: 'faq', reply: 'It works on iPhone and Android.', comment: 'Does it work on Android?', claims: [PLATFORMS] })).toBeNull()
    expect(autoReplyProblem({ category: 'faq', reply: 'It works on iPhone and Android.', comment: 'Does it work on Android?', claims: [CHART] })).not.toBeNull()
  })
})
