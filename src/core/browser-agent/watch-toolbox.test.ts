// DEC-042: the tools of a watch mission. The AI has six tools and every one of them only reads: a page is opened by the application itself from a link
// the AI was shown (a goto, never a click), what it judged is recorded as findings, and nothing can be clicked, typed, selected, run, uploaded or asked.

import { describe, expect, it } from 'vitest'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult } from '../ports'
import { FakeClock, FakePage } from '../testing/fakes'
import { TicketAuthority } from '../tickets'
import { BrowserToolbox, type Rhythm, type ToolboxDeps } from './toolbox'
import { NOTE_LEFT_OUT } from '../pipeline/triage-prompt'
import { WATCH_COMMENT_DEPTH_MAX, WATCH_COMMENT_MAX, WATCH_MAX_ITEMS_PER_CALL, WATCH_THREAD_ITEMS_MAX, WATCH_THREAD_TEXT_MAX, WATCH_REPLY_PREFIX, WATCH_SKIP_RELATION, WATCH_TOOL_NAMES, canonicalWatchUrl, openProblem, readWatchItems, type WatchItem } from './watch'

interface Item {
  ref: string
  role: string
  name: string
  to?: string
  href?: string
}

const LIST = 'https://www.instagram.com/explore/search/keyword/?q=astrology'
const POST = 'https://www.instagram.com/p/Abc123/?igsh=xyz'

/** A list page that behaves like a site: it has posts, a Follow button and links that lead away. */
class ListPage extends FakePage {
  items: Item[] = [
    { ref: 'e1', role: 'link', name: 'A post about natal charts', to: '/p/Abc123/', href: POST },
    { ref: 'e2', role: 'button', name: 'Follow' },
    { ref: 'e3', role: 'link', name: 'Elsewhere', to: 'evil.example', href: 'https://evil.example/p/1' },
    { ref: 'e4', role: 'link', name: 'Click me', href: 'javascript:alert(1)' },
    { ref: 'e5', role: 'link', name: 'Log out', to: '/accounts/logout/', href: 'https://www.instagram.com/accounts/logout/' },
    { ref: 'e6', role: 'input:text', name: 'Search' },
    { ref: 'e7', role: 'link', name: 'Another post', to: '/reel/Zz9/', href: 'https://www.instagram.com/reel/Zz9/' },
    { ref: 'e8', role: 'link', name: 'No address' },
    { ref: 'e9', role: 'link', name: 'Insecure', to: '/p/Http1/', href: 'http://www.instagram.com/p/Http1/' },
    { ref: 'e10', role: 'link', name: 'Another site of the platform', to: 'help.instagram.com', href: 'https://help.instagram.com/x' },
    { ref: 'e11', role: 'link', name: 'Mail', href: 'mailto:a@b.c' }
  ]
  humanCheck = ''
  override async read<T>(script: string): Promise<T> {
    this.log.push(`read ${script.slice(0, 40)}`)
    if (script.includes('agent-snapshot')) return { url: this.currentUrl, title: 'Page', text: 'Some posts', alerts: [], humanCheck: this.humanCheck, elements: this.items.map((i) => ({ ...i })) } as T
    return undefined as T
  }
  override async pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult> {
    this.steps.push({ step, hosts })
    this.log.push(`pageStep ${step.do}`)
    return { status: 'done', detail: 'ok' }
  }
}

function setup(over: Partial<ToolboxDeps> = {}, shared: { time?: { now: number }; sleeps?: number[] } = {}) {
  const page = new ListPage()
  page.currentUrl = LIST
  const clock = new FakeClock()
  const session = new ControlledSession('acc', async () => page, new TicketAuthority(clock))
  const time = shared.time ?? { now: 10_000 }
  const sleeps = shared.sleeps ?? []
  const reports: { status: string; reason: string }[] = []
  const recorded: WatchItem[] = []
  const said: string[] = []
  const known = new Set<string>()
  const toolbox = new BrowserToolbox({
    withPage: (work) => session.withAgentControl('watch', work),
    hosts: ['instagram.com'],
    values: {},
    sleep: async (ms) => {
      sleeps.push(ms)
      time.now += ms
    },
    say: (line) => said.push(line),
    ask: async () => 'done',
    note: () => undefined,
    report: (result) => reports.push(result),
    askWaitMs: 20,
    watch: {
      places: ['https://www.instagram.com/brand/', LIST],
      record: (items) => {
        let stored = 0
        let dup = 0
        for (const item of items) {
          if (known.has(item.url)) dup += 1
          else {
            known.add(item.url)
            recorded.push(item)
            stored += 1
          }
        }
        return { stored, known: dup }
      },
      maxFindings: 60,
      minGapMs: 2000,
      now: () => time.now
    },
    ...over
  })
  return { page, session, toolbox, time, sleeps, reports, recorded, known, said }
}

type Setup = ReturnType<typeof setup>
const look = (t: Setup) => t.toolbox.call('browser_snapshot', {})
const open = (t: Setup, args: Record<string, unknown>) => t.toolbox.call('watch_open', args)
const record = (t: Setup, items: unknown) => t.toolbox.call('watch_record', { items })
const post = (over: Record<string, unknown> = {}) => ({ url: 'https://www.instagram.com/p/Abc123/', title: 'A post about natal charts', author: 'someone', label: 'notice', relation: 'Astrology fans talk about birth charts.', ...over })
/** What the AI says when it opened a post worth a reply and read the thread. */
const READ = { about: 'The author asks how to read the houses of a natal chart.', thread: 'Two commenters link calculators; nobody explains the houses.', reply_to: 'The author: the question is still open.', comment: 'Houses divide the sky by the time and place of birth.' }
const gotos = (t: Setup): string[] => t.page.log.filter((line) => line.startsWith('goto ')).map((line) => line.slice(5))
/** Nothing was clicked, typed, chosen or run on the page. */
const untouched = (t: Setup): boolean => t.page.steps.length === 0 && !t.page.log.some((line) => /^(click|fill|upload|pageStep (click|type|select|key|upload))/.test(line))

describe('the tools of a watch mission', () => {
  it('are exactly these six, so that a tool cannot be added by accident', () => {
    const t = setup()
    expect(t.toolbox.tools.map((tool) => tool.name)).toEqual([...WATCH_TOOL_NAMES])
    expect(WATCH_TOOL_NAMES).toEqual(['browser_snapshot', 'browser_scroll', 'watch_open', 'watch_back', 'watch_record', 'report_result'])
    // and the brief of the tools does not send the AI to a tool it does not have
    expect(JSON.stringify(t.toolbox.tools)).not.toMatch(/browser_click|browser_navigate|ask_owner/)
    expect(t.toolbox.instructions).toMatch(/Nobody can be asked/)
  })

  it.each([
    ['browser_click', { ref: 'e2' }],
    ['browser_type', { ref: 'e6', value: 'hello' }],
    ['browser_select', { ref: 'e6', option: 'x' }],
    ['browser_press_key', { key: 'Enter' }],
    ['browser_evaluate', { script: 'return document.cookie' }],
    ['browser_upload', { ref: 'e6', file: 'PICTURE' }],
    ['browser_attach', { ref: 'e6' }],
    ['browser_submit', { submit_ref: 'e2' }],
    ['browser_navigate', { url: 'https://www.instagram.com/accounts/logout/' }],
    ['browser_wait_for', { ms: 10 }],
    ['ask_owner', { question: 'May I?' }],
    ['note_value', { label: 'a', value: 'b' }],
    ['remember_lesson', { rule: 'Always shrink pictures first.' }],
    ['made_up_tool', {}]
  ])('refuses %s and does nothing on the page', async (name, args) => {
    const t = setup()
    await look(t)
    const before = t.page.log.length
    const result = await t.toolbox.call(name, args)
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/There is no tool called/)
    expect(untouched(t)).toBe(true)
    expect(t.page.log.slice(before)).toEqual([])
  })

  it('cannot be a post or a join mission as well', () => {
    expect(() => setup({ join: { community: 'x', destination: 'https://www.instagram.com/x/', minGapMs: 0 } })).toThrow(/never more than one/)
  })

  it('does not offer its tools to a mission that is not a watch', async () => {
    const t = setup({ watch: undefined })
    for (const name of ['watch_open', 'watch_back', 'watch_record']) expect((await t.toolbox.call(name, { ref: 'e1', items: [post()] })).isError).toBe(true)
    expect(t.page.log.filter((line) => line.startsWith('goto'))).toEqual([])
    expect(t.toolbox.tools.some((tool) => tool.name.startsWith('watch_'))).toBe(false)
  })

  it('lists a link by its whole address, so that it can be recorded', async () => {
    const t = setup()
    const result = await look(t)
    expect(result.text).toContain(`[e1] link "A post about natal charts" -> ${POST}`)
  })
})

describe('watch_open', () => {
  it('opens a link of the platform that the last snapshot showed, with a goto and never a click', async () => {
    const t = setup()
    await look(t)
    const result = await open(t, { ref: 'e1' })
    expect(result.isError).toBeFalsy()
    expect(gotos(t)).toEqual([POST])
    expect(untouched(t)).toBe(true)
    expect(result.text).toContain('Opened www.instagram.com/p/Abc123/')
  })

  it('opens a link of the platform whatever its sub-domain, and an http one of the platform', async () => {
    const t = setup()
    await look(t)
    expect((await open(t, { ref: 'e10' })).isError).toBeFalsy()
    await look(t)
    expect((await open(t, { ref: 'e9' })).isError).toBeFalsy()
    expect(gotos(t)).toEqual(['https://help.instagram.com/x', 'http://www.instagram.com/p/Http1/'])
  })

  it.each([
    ['a button', 'e2', /not a link with an address/],
    ['a field', 'e6', /not a link with an address/],
    ['a link with no address', 'e8', /not a link with an address/],
    ['a link off the platform', 'e3', /Only pages of instagram.com/],
    ['a javascript: link', 'e4', /Only http and https/],
    ['a mailto: link', 'e11', /Only http and https/],
    ['a link that signs the account out', 'e5', /signs the account out/],
    ['a label the snapshot never showed', 'e99', /not in your last browser_snapshot/],
    ['something that is not a label', 'the first post', /ref must be a label/]
  ])('refuses %s', async (_what, ref, reason) => {
    const t = setup()
    await look(t)
    const result = await open(t, { ref })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(reason)
    expect(gotos(t)).toEqual([])
    expect(untouched(t)).toBe(true)
  })

  it('refuses any label before the page was looked at, and a label of a page that was left behind', async () => {
    const t = setup()
    expect((await open(t, { ref: 'e1' })).text).toMatch(/not in your last browser_snapshot/)
    await look(t)
    await open(t, { ref: 'e1' })
    // the page changed: the labels of the old list are not the labels of this page until it is looked at again
    const stale = await open(t, { ref: 'e7' })
    expect(stale.isError).toBe(true)
    expect(stale.text).toMatch(/not in your last browser_snapshot/)
    expect(gotos(t)).toEqual([POST])
  })

  it('refuses a link the page changed into a button after it was shown: the snapshot the AI saw decides', async () => {
    const t = setup()
    await look(t)
    ;(t.page.items[0] as Item).role = 'button'
    // the page changed after the snapshot, but what counts is what the AI was shown: the application never trusts a label it did not show
    expect((await open(t, { ref: 'e1' })).isError).toBeFalsy()
    await look(t)
    expect((await open(t, { ref: 'e1' })).isError).toBe(true)
  })

  it('opens one of the pages of the brief by its number, and nothing else by a number', async () => {
    const t = setup()
    expect((await open(t, { place: 1 })).isError).toBeFalsy()
    expect((await open(t, { place: 2 })).isError).toBeFalsy()
    expect(gotos(t)).toEqual(['https://www.instagram.com/brand/', LIST])
    for (const place of [0, 3, -1, 1.5]) {
      const result = await open(t, { place })
      expect(result.isError).toBe(true)
      expect(result.text).toMatch(/place must be a whole number from 1 to 2/)
    }
    expect(gotos(t)).toHaveLength(2)
  })

  it('wants exactly one of ref and place', async () => {
    const t = setup()
    await look(t)
    for (const args of [{}, { ref: 'e1', place: 1 }]) {
      const result = await open(t, args)
      expect(result.isError).toBe(true)
      expect(result.text).toMatch(/exactly one of ref/)
    }
    expect(gotos(t)).toEqual([])
  })

  it('refuses a page of the brief that is not on the platform', async () => {
    const t = setup({ watch: { places: ['https://evil.example/brand'], record: () => ({ stored: 0, known: 0 }), maxFindings: 60, minGapMs: 0 } })
    const result = await open(t, { place: 1 })
    expect(result.isError).toBe(true)
    expect(gotos(t)).toEqual([])
  })

  it('waits between two openings, like a person', async () => {
    const t = setup()
    await open(t, { place: 1 })
    t.sleeps.length = 0
    await open(t, { place: 2 })
    expect(t.sleeps).toContain(2000)
  })

  it('waits between two openings of two looks of one account too: the pace is the account\'s, not the look\'s', async () => {
    const shared = { time: { now: 10_000 }, sleeps: [] as number[] }
    const rhythm: Rhythm = { at: null, reserved: null }
    const first = setup({ rhythm }, shared)
    const second = setup({ rhythm }, shared)

    const paces = (): number => shared.sleeps.filter((ms) => ms === 2000).length
    await open(first, { place: 1 }) // the first opening of the account: no pause
    expect(paces()).toBe(0)
    await open(second, { place: 1 }) // another look, at once: it pauses for the account's pace, though it has opened nothing yet itself
    expect(paces()).toBe(1)
    await open(first, { place: 2 })
    expect(paces()).toBe(2)
  })
})

describe('the allowance of tool calls', () => {
  /** A look with `calls` tool calls in all, and all of them used on snapshots. */
  async function usedUp(calls: number) {
    const t = setup({ maxCalls: calls })
    for (let i = 0; i < calls; i++) await t.toolbox.call('browser_snapshot', {})
    return t
  }

  it('lets the AI save what it judged and say how it went after the last call, and nothing else', async () => {
    const t = await usedUp(2)
    const refused = await t.toolbox.call('browser_snapshot', {})
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/used all 2 tool calls\. Only watch_record \(save what you judged\) and report_result \(say how it went\) still work/)
    expect(t.toolbox.progress.outOfCalls).toBe(true)

    const saved = await record(t, [post()])
    expect(saved.isError).toBeFalsy()
    expect(t.recorded).toHaveLength(1)
    const reported = await t.toolbox.call('report_result', { status: 'failed', reason: 'Ran out of calls.' })
    expect(reported.isError).toBeFalsy()
    expect(t.reports).toEqual([{ status: 'failed', reason: 'Ran out of calls.' }])
    // a look that opened nothing more, and the page was not touched after the limit
    expect((await open(t, { place: 1 })).isError).toBe(true)
  })

  it('does not call a look out of calls when it reports with the last call it had', async () => {
    const t = setup({ maxCalls: 2 })
    await t.toolbox.call('browser_snapshot', {})
    await t.toolbox.call('report_result', { status: 'done', reason: 'Looked.' })
    expect(t.toolbox.progress.outOfCalls).toBe(false)
  })

  it('reminds the AI to save after three screens without a record, and again when only a few calls are left', async () => {
    const t = setup({ maxCalls: 40 })
    const texts: string[] = []
    for (let i = 0; i < 4; i++) texts.push((await t.toolbox.call('browser_snapshot', {})).text)
    expect(texts[0]).not.toMatch(/without recording anything/)
    expect(texts[1]).not.toMatch(/without recording anything/)
    expect(texts[2]).toMatch(/You have looked at 3 screens without recording anything\. Call watch_record now/)
    expect(texts[3]).toMatch(/looked at 4 screens/)
    await record(t, [post()])
    expect((await t.toolbox.call('browser_snapshot', {})).text).not.toMatch(/without recording anything/)

    const tight = setup({ maxCalls: 25 })
    let last = ''
    for (let i = 0; i < 6; i++) last = (await tight.toolbox.call('browser_snapshot', {})).text
    expect(last).toMatch(/Only 19 tool calls left: call watch_record with what you judged and then report_result/)
  })
})

describe('watch_back', () => {
  it('goes back to the list the post was opened from, and not further', async () => {
    const t = setup()
    await open(t, { place: 2 })
    await look(t)
    await open(t, { ref: 'e1' })
    const back = await t.toolbox.call('watch_back', {})
    expect(back.isError).toBeFalsy()
    expect(gotos(t)).toEqual([LIST, POST, LIST])
    const again = await t.toolbox.call('watch_back', {})
    expect(again.isError).toBe(true)
    expect(again.text).toMatch(/no list to go back to/)
    expect(gotos(t)).toHaveLength(3)
  })

  it('keeps the first list when the AI opens a link from a post', async () => {
    const t = setup()
    await open(t, { place: 2 })
    await look(t)
    await open(t, { ref: 'e1' })
    await look(t)
    await open(t, { ref: 'e7' })
    await t.toolbox.call('watch_back', {})
    expect(gotos(t).at(-1)).toBe(LIST)
  })

  it('has nowhere to go before any post was opened', async () => {
    const t = setup()
    expect((await t.toolbox.call('watch_back', {})).isError).toBe(true)
    await open(t, { place: 1 })
    expect((await t.toolbox.call('watch_back', {})).isError).toBe(true)
    expect(gotos(t)).toEqual(['https://www.instagram.com/brand/'])
  })
})

describe('watch_record', () => {
  it('stores a post as it was judged, under its canonical address, and touches nothing on the page', async () => {
    const t = setup()
    const result = await record(t, [post({ url: 'https://www.instagram.com/p/Abc123/?igsh=xyz#c1' })])
    expect(result.isError).toBeFalsy()
    expect(result.text).toMatch(/Recorded 1 post\./)
    expect(t.recorded).toEqual([{ url: 'https://www.instagram.com/p/Abc123', title: 'A post about natal charts', author: 'someone', label: 'notice', relation: 'Astrology fans talk about birth charts.', about: '', thread: '', replyTo: '', comment: '', comments: [] }])
    expect(t.page.log).toEqual([])
  })

  it('stores a reply as a notice that says so, and a skip as a skip', async () => {
    const t = setup()
    await record(t, [post({ label: 'reply', relation: 'Asks how to read a chart.', ...READ }), post({ url: 'https://www.instagram.com/p/Two/', label: 'skip', relation: 'About cooking.' }), post({ url: 'https://www.instagram.com/p/Three/', label: 'NOTICE ' })])
    expect(t.recorded.map((i) => [i.label, i.relation])).toEqual([
      ['notice', `${WATCH_REPLY_PREFIX}Asks how to read a chart.`],
      ['skip', 'About cooking.'],
      ['notice', 'Astrology fans talk about birth charts.']
    ])
    // the stored label is only ever notice or skip: nothing a reply could become in this app exists
    expect(t.recorded.every((i) => i.label === 'notice' || i.label === 'skip')).toBe(true)
  })

  describe('a post worth a reply', () => {
    it('is refused unless the AI says what it read: the post, the thread, whom to answer and the comment', async () => {
      const t = setup()
      const bare = await record(t, [post({ label: 'reply', relation: 'Asks how to read a chart.' })])
      expect(bare.isError).toBe(true)
      expect(bare.text).toMatch(/must be opened and its thread read first/)
      expect(bare.text).toMatch(/about .*thread .*reply_to .*comment/)
      for (const missing of ['about', 'thread', 'reply_to', 'comment']) {
        const result = await record(t, [post({ url: `https://www.instagram.com/p/Missing-${missing}/`, label: 'reply', relation: 'Asks.', ...READ, [missing]: '  ' })])
        expect(result.isError, missing).toBe(true)
      }
      expect(t.recorded).toEqual([])
    })

    it('is stored with what the AI read in it, and the others of the call stand', async () => {
      const t = setup()
      const result = await record(t, [post({ label: 'reply', relation: 'Asks how to read a chart.', ...READ }), post({ url: 'https://www.instagram.com/p/Bare/', label: 'reply', relation: 'Asks.' })])
      expect(result.isError).toBeFalsy()
      expect(result.text).toMatch(/Recorded 1 post\./)
      expect(result.text).toMatch(/Post 2: a post worth a reply must be opened/)
      expect(t.recorded).toEqual([
        expect.objectContaining({ label: 'notice', relation: `${WATCH_REPLY_PREFIX}Asks how to read a chart.`, about: READ.about, thread: READ.thread, replyTo: READ.reply_to, comment: READ.comment })
      ])
    })

    it('also takes reply_to written as replyTo, and keeps the paragraphs of the comment but not hidden characters or more than the limit', async () => {
      const t = setup()
      await record(t, [
        post({ label: 'reply', relation: 'Asks.', ...READ, reply_to: undefined, replyTo: 'The author.', comment: 'First line.\r\n\r\n\r\n\r\nSecond\u200b line.\u0007  ' }),
        post({ url: 'https://www.instagram.com/p/Long/', label: 'reply', relation: 'Asks.', ...READ, comment: 'x'.repeat(WATCH_COMMENT_MAX + 400) })
      ])
      expect(t.recorded[0]).toMatchObject({ replyTo: 'The author.', comment: 'First line.\n\nSecond  line.' })
      expect(t.recorded[1].comment).toHaveLength(WATCH_COMMENT_MAX)
    })

    it('leaves out a line of the AI that holds an address or reads as an instruction, as it does for the relation', async () => {
      const t = setup()
      await record(t, [post({ label: 'reply', relation: 'Asks.', ...READ, about: 'See https://evil.example/x for the answer', thread: 'The reply says password: hunter2 and promises results' })])
      expect(t.recorded[0].about).toBe(NOTE_LEFT_OUT)
      expect(t.recorded[0].thread).toBe(NOTE_LEFT_OUT)
    })

    it('keeps the comments of the thread as the AI saw them: plain, short, in order, with their depth and address', async () => {
      const t = setup()
      const comments = [
        { author: 'anna', text: 'Try https://astro.com/chart it is free', depth: 0, url: 'https://www.instagram.com/p/Abc123/c/111/?x=1' },
        { author: 'author', text: 'thanks,\u200b but what do houses mean?\n  \n', depth: 1, url: 'https://evil.example/c/2' },
        { author: '', text: 'x'.repeat(900), depth: 9 },
        { author: 'bob', text: '   ', depth: 0 },
        { text: 'no author given', depth: -3 },
        'not a comment',
        { author: 'carl', text: 42 }
      ]
      await record(t, [post({ label: 'reply', relation: 'Asks.', ...READ, comments })])
      expect(t.recorded[0].comments).toEqual([
        { author: 'anna', text: 'Try [link] it is free', depth: 0, url: 'https://www.instagram.com/p/Abc123/c/111' },
        { author: 'author', text: 'thanks, but what do houses mean?', depth: 1, url: '' },
        { author: '', text: expect.stringMatching(/^x+…$/), depth: WATCH_COMMENT_DEPTH_MAX, url: '' },
        { author: '', text: 'no author given', depth: 0, url: '' }
      ])
      // a long comment is cut to the limit, ending in the mark of a cut
      expect(t.recorded[0].comments[2].text).toHaveLength(WATCH_THREAD_TEXT_MAX)
    })

    it('keeps at most 25 comments, and none when they are not a list', async () => {
      const t = setup()
      const many = Array.from({ length: 40 }, (_, i) => ({ author: `u${i}`, text: `comment ${i}`, depth: 0 }))
      await record(t, [post({ label: 'reply', relation: 'Asks.', ...READ, comments: many }), post({ url: 'https://www.instagram.com/p/Two/', label: 'reply', relation: 'Asks.', ...READ, comments: 'many' })])
      expect(t.recorded[0].comments).toHaveLength(WATCH_THREAD_ITEMS_MAX)
      expect(t.recorded[0].comments[24].text).toBe('comment 24')
      expect(t.recorded[1].comments).toEqual([])
    })

    it('keeps nothing of the four for a notice or a skip, whatever the AI gave', async () => {
      const t = setup()
      const comments = [{ author: 'a', text: 'b', depth: 0 }]
      await record(t, [post({ ...READ, comments }), post({ url: 'https://www.instagram.com/p/Skip/', label: 'skip', relation: 'Cooking.', ...READ, comments })])
      expect(t.recorded.map((i) => [i.about, i.thread, i.replyTo, i.comment, i.comments])).toEqual([
        ['', '', '', '', []],
        ['', '', '', '', []]
      ])
    })
  })

  it('counts a post it has stored before as known and does not store it twice', async () => {
    const t = setup()
    await record(t, [post()])
    const result = await record(t, [post({ url: 'https://www.instagram.com/p/Abc123' }), post({ url: 'https://www.instagram.com/p/Abc123/' }), post({ url: 'https://www.instagram.com/p/New/' })])
    expect(result.text).toMatch(/Recorded 1 post; 2 already known/)
    expect(t.recorded.map((i) => i.url)).toEqual(['https://www.instagram.com/p/Abc123', 'https://www.instagram.com/p/New'])
  })

  it('refuses a post that cannot be read and stores the others of the call', async () => {
    const t = setup()
    const result = await record(t, [
      post({ url: 'https://evil.example/p/1' }),
      post({ url: 'javascript:alert(1)' }),
      post({ url: 'https://www.instagram.com/' }),
      post({ url: 'not an address' }),
      post({ url: 42 }),
      post({ url: 'https://www.instagram.com/p/Label/', label: 'maybe' }),
      post({ url: 'https://www.instagram.com/p/Title/', title: '  ' }),
      post({ url: 'https://www.instagram.com/p/Relation/', relation: '' }),
      'a string',
      post({ url: 'https://www.instagram.com/p/Fine/' })
    ])
    expect(result.isError).toBeFalsy()
    expect(t.recorded.map((i) => i.url)).toEqual(['https://www.instagram.com/p/Fine'])
    expect(result.text).toMatch(/Post 1: url must be the address of a post/)
    expect(result.text).toMatch(/Post 6: label must be reply, notice or skip/)
    expect(result.text).toMatch(/Post 7: title/)
    expect(result.text).toMatch(/Post 8: relation must be one plain line/)
    expect(result.text).toMatch(/Post 9: not an object/)
  })

  it('is an error when nothing in the call could be stored', async () => {
    const t = setup()
    const result = await record(t, [post({ url: 'https://evil.example/p/1' })])
    expect(result.isError).toBe(true)
    expect(t.recorded).toEqual([])
  })

  it.each([undefined, null, 'x', {}, []])('refuses items that are %j', async (items) => {
    const t = setup()
    const result = await record(t, items)
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/items must be a list of 1 to 20 posts/)
  })

  it('takes at most twenty posts in one call, and none of them when there are more', async () => {
    const t = setup()
    const many = (n: number) => Array.from({ length: n }, (_, i) => post({ url: `https://www.instagram.com/p/P${i}/` }))
    expect((await record(t, many(WATCH_MAX_ITEMS_PER_CALL + 1))).isError).toBe(true)
    expect(t.recorded).toEqual([])
    expect((await record(t, many(WATCH_MAX_ITEMS_PER_CALL))).isError).toBeFalsy()
    expect(t.recorded).toHaveLength(WATCH_MAX_ITEMS_PER_CALL)
  })

  it('stops at sixty findings for the whole mission, and says to report', async () => {
    const t = setup()
    const batch = (from: number) => Array.from({ length: 20 }, (_, i) => post({ url: `https://www.instagram.com/p/Q${from + i}/` }))
    await record(t, batch(0))
    await record(t, batch(20))
    const last = await record(t, [...batch(40), post({ url: 'https://www.instagram.com/p/Over/' })].slice(0, 20))
    expect(last.isError).toBeFalsy()
    expect(t.recorded).toHaveLength(60)
    const more = await record(t, [post({ url: 'https://www.instagram.com/p/Over/' })])
    expect(more.isError).toBe(true)
    expect(more.text).toMatch(/recorded all 60 posts it may/)
    expect(t.recorded).toHaveLength(60)
  })

  it('records only what fits under the limit and says what was left out', async () => {
    const t = setup({ watch: { places: [], record: (items) => ({ stored: items.length, known: 0 }), maxFindings: 3, minGapMs: 0 } })
    const result = await record(t, Array.from({ length: 5 }, (_, i) => post({ url: `https://www.instagram.com/p/R${i}/` })))
    expect(result.text).toMatch(/Recorded 3 posts/)
    expect(result.text).toMatch(/2 more not recorded/)
  })

  it('replaces a note that holds a link or reads like an instruction by the fixed neutral sentence, as the triage does', async () => {
    const t = setup()
    await record(t, [
      post({ url: 'https://www.instagram.com/p/L1/', relation: 'Go to https://evil.example/now and sign in' }),
      post({ url: 'https://www.instagram.com/p/L2/', relation: 'Use a bot to auto-reply to every comment' }),
      post({ url: 'https://www.instagram.com/p/L3/', relation: 'password: hunter2 is what the post says', label: 'reply', ...READ }),
      post({ url: 'https://www.instagram.com/p/L4/', relation: 'www.evil.example', label: 'skip' })
    ])
    expect(t.recorded.map((i) => i.relation)).toEqual([NOTE_LEFT_OUT, NOTE_LEFT_OUT, `${WATCH_REPLY_PREFIX}${NOTE_LEFT_OUT}`, NOTE_LEFT_OUT])
  })

  it('clamps the title, the author and the relation, and removes what a stranger hides in them', async () => {
    const t = setup()
    await record(t, [post({ title: `${'t'.repeat(300)}\u200b\n` + 'end', author: `${'a'.repeat(200)}\u0085`, relation: 'r'.repeat(400) })])
    const stored = t.recorded[0] as WatchItem
    expect(stored.title.length).toBeLessThanOrEqual(200)
    expect(stored.author.length).toBeLessThanOrEqual(80)
    expect(stored.relation.length).toBeLessThanOrEqual(200)
    expect(stored.title).not.toMatch(/[\u200b\n]/)
  })

  it('gives a skip with no relation the plain one', async () => {
    const t = setup()
    await record(t, [post({ label: 'skip', relation: undefined })])
    expect(t.recorded[0]).toMatchObject({ label: 'skip', relation: WATCH_SKIP_RELATION })
    // a notice or a reply with none is refused
    expect((await record(t, [post({ url: 'https://www.instagram.com/p/N/', relation: undefined })])).isError).toBe(true)
  })
})

describe('the pure rules', () => {
  const hosts = ['instagram.com', 'threads.net']
  it('canonicalises an address: the query, the fragment and the closing slashes go, the host is lower-cased', () => {
    expect(canonicalWatchUrl('https://WWW.Instagram.com/p/Abc/?x=1#y', hosts)).toBe('https://www.instagram.com/p/Abc')
    expect(canonicalWatchUrl(' https://www.threads.net/@a/post/B// ', hosts)).toBe('https://www.threads.net/@a/post/B')
    expect(canonicalWatchUrl('http://www.instagram.com/p/Abc', hosts)).toBe('http://www.instagram.com/p/Abc')
  })
  it.each(['https://www.instagram.com/', 'https://www.instagram.com', 'https://notinstagram.com/p/1', 'https://instagram.com.evil.example/p/1', 'ftp://www.instagram.com/p/1', 'https://u:p@www.instagram.com/p/1', 'https://www.instagram.com/accounts/logout/', '', 'x'])('does not take %j for a post of the platform', (address) => {
    expect(canonicalWatchUrl(address, hosts)).toBeNull()
  })
  it('judges what may be opened: http and https on the platform, not a page that signs out', () => {
    expect(openProblem('https://help.instagram.com/x', hosts)).toBeNull()
    expect(openProblem('https://www.instagram.com/accounts/logout/', hosts)).not.toBeNull()
    expect(openProblem('https://www.facebook.com/logout.php?h=1', ['facebook.com'])).not.toBeNull()
    expect(openProblem('https://www.instagram.com/sign-out/', hosts)).not.toBeNull()
    expect(openProblem('https://www.instagram.com/p/logout-your-fears/', hosts)).toBeNull()
    expect(openProblem('data:text/html,x', hosts)).not.toBeNull()
  })
  it('reads a list of posts, or says why the call as a whole is no list', () => {
    expect(readWatchItems('x', hosts)).toEqual({ error: expect.stringContaining('items must be a list') })
    expect(readWatchItems([], hosts)).toEqual({ error: expect.stringContaining('items must be a list') })
  })
})

describe('what the owner can do meanwhile', () => {
  it('stops the check at once and for good when the owner takes the browser: it is made again later', async () => {
    const t = setup()
    await look(t)
    t.session.takeControl()
    const result = await open(t, { ref: 'e1' })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/made again later/)
    expect(t.toolbox.watchPaused).toBe(true)
    t.session.releaseControl()
    // nothing is done after that, whatever the AI calls, not even the report
    const after = await look(t)
    expect(after.isError).toBe(true)
    expect((await t.toolbox.call('report_result', { status: 'done', reason: 'ok' })).isError).toBe(true)
    expect(t.reports).toEqual([])
    expect(gotos(t)).toEqual([])
  })

  it('records how the check ended, and nothing else', async () => {
    const t = setup()
    const result = await t.toolbox.call('report_result', { status: 'needs_owner', reason: 'A sign-in page stopped me.' })
    expect(result.isError).toBeFalsy()
    expect(t.reports).toEqual([{ status: 'needs_owner', reason: 'A sign-in page stopped me.' }])
  })
})
