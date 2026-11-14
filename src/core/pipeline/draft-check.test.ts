// "Check before you approve" (drafts.check): what the rules of an AI draft find in a text the owner wrote, and what they must leave alone.

import { afterEach, describe, expect, it } from 'vitest'
import type { DraftCheckResult, DraftFinding, Opportunity } from '../../shared/types'
import { closeWorld, makeClaim, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const check = (opportunityId: string, form?: { title?: string; text: string; link?: string }): Promise<DraftCheckResult> =>
  world.core.router.call('drafts.check', { opportunityId, ...(form ? { form: { title: form.title ?? '', text: form.text, link: form.link ?? '' } } : {}) } as never)
const rulesOf = async (text: string, extra: { title?: string; link?: string } = {}): Promise<DraftFinding['rule'][]> => {
  const opp = await world.newOpportunity()
  return (await check(opp.id, { text, ...extra })).findings.map((f) => f.rule)
}
const refusal = async (args: Record<string, unknown>): Promise<string> => {
  try {
    await world.core.router.call('drafts.check', args as never)
  } catch (error) {
    return (error as { code?: string }).code ?? 'none'
  }
  return 'accepted'
}
/** Every table a draft, an approval or a card could touch, whole: nothing may differ after a check. */
const counts = (): string =>
  JSON.stringify(['opportunities', 'drafts', 'approvals', 'comments', 'discussions', 'send_actions'].map((table) => world.core.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))

const PLAIN = 'Thanks for asking! Give it your birth date, time and place and it builds the chart.'
const CONNECTED = 'Disclosure: I work on Natal Mystic.'

describe('drafts.check: what is found', () => {
  it('finds nothing in a plain text', async () => {
    world = makeWorld({ mode: 'draft' })
    expect(await rulesOf(PLAIN)).toEqual([])
    expect(await rulesOf('')).toEqual([])
  })

  const cases: [string, string, DraftFinding['rule'], RegExp, RegExp][] = [
    ['a free offer', "Yes, it works on Android. It's free for the first month. Try it.", 'free', /free for the first month/, /No approved fact says that anything is free/],
    ['a price', 'It is $9 a month, which is cheap.', 'price', /\$9 a month/, /No approved fact names \$9/],
    ['a discount', 'Use the coupon NATAL for a better deal.', 'discount', /coupon NATAL/, /No approved fact mentions a discount/],
    ['a short link', 'Details: bit.ly/nm-chart', 'link', /^bit\.ly$/, /Only natalmystic\.com may be linked/],
    ['a link to another site in markdown', 'Read [more](shady.pl/x) here', 'link', /^shady\.pl$/, /Only natalmystic\.com may be linked/],
    ['a link that is not a web address', 'Click [here](javascript:alert(1))', 'unsafe_link', /^javascript:/, /Only web addresses may be linked/],
    ['a password', 'My password: hunter22 if you want to look.', 'credential', /^$/, /public/]
  ]
  for (const [name, text, rule, quote, why] of cases) {
    it(`names ${name}, the words it is about and why, and does not block`, async () => {
      world = makeWorld({ mode: 'draft' })
      const opp = await world.newOpportunity()
      const { findings } = await check(opp.id, { text })
      const found = findings.find((f) => f.rule === rule)
      expect(found, JSON.stringify(findings)).toBeDefined()
      expect(found?.blocks).toBe(false)
      expect(found?.title.length).toBeGreaterThan(5)
      expect(found?.quote ?? '').toMatch(quote)
      expect(found?.why).toMatch(why)
    })
  }

  it('names a prohibited statement and quotes it', async () => {
    world = makeWorld({ mode: 'draft' })
    world.knowledge.prohibited = [makeClaim('p1', 'The readings are guaranteed accurate')]
    const opp = await world.newOpportunity()
    const { findings } = await check(opp.id, { text: 'Yes, and the readings are guaranteed accurate, every time.' })
    expect(findings).toEqual([
      { rule: 'prohibited', title: 'A statement your product knowledge prohibits', quote: 'The readings are guaranteed accurate', why: expect.stringContaining('never be made'), blocks: false }
    ])
  })

  it('reads the title and the link of a post too', async () => {
    world = makeWorld({ mode: 'draft' })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Free for a month', text: PLAIN } })
    expect((await check(opportunity.id)).findings.map((f) => f.rule)).toEqual(['free'])
    expect(await rulesOf(PLAIN, { title: 'A chart', link: 'https://shady.pl/x' })).toEqual(['link'])
    // The product's own address names the product, so the connection has to be said beside it.
    expect(await rulesOf(`${CONNECTED} ${PLAIN}`, { title: 'A chart', link: 'natalmystic.com/pricing' })).toEqual([])
    expect(await rulesOf(PLAIN, { title: 'A chart', link: 'natalmystic.com/pricing' })).toEqual(['connection_unsaid'])
  })

  it('reads the text without its invisible characters and with look-alike forms folded', async () => {
    world = makeWorld({ mode: 'draft' })
    expect(await rulesOf('It is fr\u200Bee today.')).toEqual(['free'])
    expect(await rulesOf('See evil\u200B.com')).toEqual(['link'])
    expect(await rulesOf('Only ＄９ a month')).toEqual(['price'])
    expect(await rulesOf(PLAIN, { link: 'evil\u200B.com' })).toEqual(['link'])
    expect(await rulesOf(PLAIN, { title: 'fr\u200Bee chart' })).toEqual(['free'])
    expect(await rulesOf(PLAIN, { title: 'password: hunter22x' })).toEqual(['credential'])
  })

  it('lets through what the own address and the approved facts allow', async () => {
    world = makeWorld({
      mode: 'draft',
      claims: [makeClaim('c1', 'Natal Mystic costs $9 a month.'), makeClaim('c2', 'The first chart is free.'), makeClaim('c3', 'Docs live at docs.natalmystic.io/start.'), makeClaim('c5', 'It has a Windows build.', { unconfirmedAvailability: true })]
    })
    expect(await rulesOf(`${CONNECTED} It is $9 a month, and the first chart is free.`)).toEqual([])
    expect(await rulesOf(`${CONNECTED} See natalmystic.com/pricing and docs.natalmystic.io/start`)).toEqual([])
    // The owner's text cites nothing, so the rules about citing facts are not theirs: an unconfirmed capability in the knowledge says nothing.
    expect(await rulesOf('It also runs on Windows.')).toEqual([])
    // A price that no approved fact names is still found.
    expect(await rulesOf(`${CONNECTED} It is $12 a month.`)).toEqual(['price'])
  })

  it('does not mistake a file name or an abbreviation for a link', async () => {
    world = makeWorld({ mode: 'draft' })
    expect(await rulesOf('Works with Node.js/Express, e.g. on a Mac, and/or Linux.')).toEqual([])
  })
})

describe('drafts.check: the connection to the product', () => {
  it('blocks a text that names the product and does not say the connection, and puts it first', async () => {
    world = makeWorld({ mode: 'draft' })
    const opp = await world.newOpportunity()
    const { findings } = await check(opp.id, { text: "Natal Mystic is great and it's free for a month." })
    expect(findings.map((f) => [f.rule, f.blocks])).toEqual([
      ['connection_unsaid', true],
      ['free', false]
    ])
    expect(findings[0].title).toBe('The connection to the product is not said')
    expect(findings[0].why).toContain('does not say that you are connected')
  })

  it('blocks a text that denies a connection', async () => {
    world = makeWorld({ mode: 'draft' })
    const opp = await world.newOpportunity()
    const { findings } = await check(opp.id, { text: 'Not affiliated with Natal Mystic, just a happy user.' })
    expect(findings.map((f) => [f.rule, f.blocks])).toEqual([['connection_denied', true]])
    expect(findings[0].title).toBe('The text denies a connection with the product')
  })

  it('finds nothing when the connection is said, or the product is not named', async () => {
    world = makeWorld({ mode: 'draft' })
    expect(await rulesOf(`${CONNECTED} It builds a chart from a birth date.`)).toEqual([])
    expect(await rulesOf(PLAIN)).toEqual([])
  })

  it('blocks exactly what the approval refuses: a blocking finding is refused by approve, the others are approved as before', async () => {
    world = makeWorld({ mode: 'draft' })
    const save = async (text: string): Promise<Opportunity> => {
      const opp = await world.newOpportunity()
      await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text } })
      return opp
    }
    const approveCode = async (opp: Opportunity): Promise<string> => {
      try {
        await world.core.router.call('opportunities.approve', { id: opp.id })
      } catch (error) {
        return (error as { code?: string }).code ?? 'none'
      }
      return 'approved'
    }
    const unsaid = await save('Natal Mystic builds a chart from a birth date.')
    expect((await check(unsaid.id)).findings.map((f) => f.blocks)).toEqual([true])
    expect(await approveCode(unsaid)).toBe('disclosure_missing')

    const advice = await save('Give it your birth date, it is free for a month.')
    expect((await check(advice.id)).findings.map((f) => [f.rule, f.blocks])).toEqual([['free', false]])
    expect(await approveCode(advice)).toBe('approved')
  })
})

describe('drafts.check: the gate', () => {
  it('reads the saved draft when no form is sent, and the form when it is, and the form wins', async () => {
    world = makeWorld({ mode: 'draft' })
    const opp = await world.newOpportunity()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'It is free for a month.' } })
    expect((await check(opp.id)).findings.map((f) => f.rule)).toEqual(['free'])
    expect((await check(opp.id, { text: PLAIN })).findings).toEqual([])
  })

  it('refuses an item that is not there, a draft that is not there, and a form that is not a form, without asking the AI', async () => {
    world = makeWorld({ mode: 'draft' })
    const opp = await world.newOpportunity()
    expect(await refusal({ opportunityId: 'nope' })).toBe('not_found')
    expect(await refusal({})).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id })).toBe('no_draft')
    expect(await refusal({ opportunityId: opp.id, form: 'text' })).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id, form: { title: '', text: 5, link: '' } })).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id, form: { title: '', text: 'hi' } })).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id, form: { title: '', text: 'x'.repeat(20_001), link: '' } })).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id, form: { title: 'x'.repeat(2_000), text: 'hi', link: '' } })).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id, form: { title: '', text: 'hi', link: 'x'.repeat(2_001) } })).toBe('invalid_input')
    expect(await refusal({ opportunityId: opp.id, form: { title: '', text: 'hi', link: '' } })).toBe('accepted')
    expect(world.engine.calls).toEqual([])
  })

  it('stores nothing, asks no engine, and leaves no text in the log', async () => {
    world = makeWorld({ mode: 'draft' })
    const opp = await world.newOpportunity()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'A saved draft with a secret marker ZEBRA9.' } })
    const before = counts()
    const linesBefore = world.core.log.list(200).length
    await check(opp.id, { text: 'It is free, and so is this unique marker QUOKKA7. See bit.ly/q7' })
    await check(opp.id)
    expect(counts()).toBe(before)
    expect(world.engine.calls).toEqual([])
    const lines = world.core.log.list(200)
    expect(lines.length).toBe(linesBefore)
    expect(lines.map((e) => e.message).join('\n')).not.toMatch(/QUOKKA7|ZEBRA9|bit\.ly/)
  })
})
