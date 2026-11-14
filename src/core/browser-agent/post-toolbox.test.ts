// The tools of a post mission (B1): what the AI has and has not, and that the only road to a publication is browser_submit, which types the
// approved content and presses the control while the application holds a ticket for it.

import { describe, expect, it } from 'vitest'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult, SendTicket } from '../ports'
import { FakeClock, FakePage } from '../testing/fakes'
import { TicketAuthority } from '../tickets'
import { TestAuthority } from './post-test-helpers'
import type { ApprovedContent } from './post-submit'
import { BrowserToolbox, OWNER_HAS_BROWSER, type ToolboxDeps } from './toolbox'

interface Item {
  ref: string
  role: string
  name: string
  disabled?: boolean
}

/** A compose form that behaves like a site: typed text lands in fields, a press of the submit control posts what the fields hold. */
class FormPage extends FakePage {
  items: Item[] = [
    { ref: 'e1', role: 'textarea', name: 'Add a comment' },
    { ref: 'e2', role: 'input:text', name: 'Title' },
    { ref: 'e3', role: 'input:url', name: 'Link' },
    { ref: 'e4', role: 'button', name: 'Reply' },
    { ref: 'e5', role: 'link', name: 'Cancel' },
    { ref: 'e6', role: 'button', name: 'Post (disabled)', disabled: true }
  ]
  fields = new Map<string, string>()
  alerts: string[] = []
  humanCheck = ''
  /** What a press posted: the content of every field at that moment. */
  readonly posted: Record<string, string>[] = []
  readonly clicked: string[] = []
  /** Forced answers for page steps, by the step's position among all steps (0-based). */
  forced = new Map<number, PageStepResult>()
  /** A page that crashes when a control is pressed. */
  crashOnClick = false
  /** A site that alters what is typed. */
  alter: ((ref: string, value: string) => string) | null = null
  /** Runs before a step is carried out (a test takes the browser here). */
  beforeStep: ((step: PageStep) => void) | null = null
  private stepNumber = 0

  override async goto(url: string): Promise<void> {
    await super.goto(url)
    this.currentUrl = url
    this.fields.clear()
  }
  override async read<T>(script: string): Promise<T> {
    this.log.push(`read ${script.slice(0, 40)}`)
    if (script.includes('agent-snapshot')) {
      return {
        url: this.currentUrl,
        title: 'Thread',
        text: 'A thread',
        alerts: this.alerts,
        humanCheck: this.humanCheck,
        elements: this.items.map((i) => ({ ...i, ...(this.fields.has(i.ref) ? { value: this.fields.get(i.ref)?.slice(0, 60) } : {}) }))
      } as T
    }
    const field = /ppd-field (e\d+)/.exec(script)
    if (field) return (this.fields.has(field[1] as string) ? this.fields.get(field[1] as string) : null) as T
    return undefined as T
  }
  override async pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult> {
    this.log.push(`pageStep ${step.do}`)
    this.steps.push({ step, hosts })
    this.beforeStep?.(step)
    const forced = this.forced.get(this.stepNumber++)
    if (forced) return forced
    if (step.do === 'key') return { status: 'done', detail: 'key' }
    if (!('ref' in step)) return { status: 'done', detail: 'ok' }
    const item = this.items.find((i) => i.ref === step.ref)
    if (!item) return { status: 'not_found', detail: 'no such element' }
    if (step.do === 'type') {
      this.fields.set(step.ref, this.alter ? this.alter(step.ref, step.text) : step.text)
      return { status: 'done', detail: 'typed' }
    }
    if (step.do === 'click') {
      if (this.crashOnClick) throw new Error('the page crashed')
      if (item.disabled) return { status: 'refused', detail: 'disabled' }
      this.clicked.push(step.ref)
      if (step.ref === 'e4') this.posted.push(Object.fromEntries(this.fields))
      return { status: 'done', detail: 'clicked' }
    }
    return { status: 'done', detail: 'ok' }
  }
}

const REPLY: ApprovedContent = { kind: 'reply', title: null, text: 'Glad it helps. I work on Natal Mystic, so I am biased.', link: null, destination: 'https://fake.test/r/test/comments/abc/slug/def' }
const POST: ApprovedContent = { kind: 'post', title: 'Why I built a chart app', text: 'It started with a spreadsheet.\nDisclosure: I am the developer.', link: 'https://natal.example/', destination: 'https://fake.test/r/test' }

function setup(content: ApprovedContent = REPLY, over: Partial<ToolboxDeps> = {}) {
  const clock = new FakeClock()
  const tickets = new TicketAuthority(clock)
  const page = new FormPage()
  if (content.kind === 'post') page.currentUrl = 'https://fake.test/r/test/submit'
  else page.currentUrl = 'https://fake.test/r/test/comments/abc/slug/'
  const session = new ControlledSession('acc', async () => page, tickets)
  const authority = new TestAuthority(tickets, content)
  const time = { now: 10_000 }
  const sleeps: number[] = []
  const said: string[] = []
  const reports: { status: string; reason: string }[] = []
  const toolbox = new BrowserToolbox({
    withPage: (work) => session.withAgentControl('post', work),
    hosts: ['fake.test'],
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
    post: { authority, minGapMs: 2000, now: () => time.now },
    ...over
  })
  return { clock, tickets, page, session, authority, toolbox, time, sleeps, said, reports }
}

type Setup = ReturnType<typeof setup>
const look = (t: Setup) => t.toolbox.call('browser_snapshot', {})
const submitReply = (t: Setup, extra: Record<string, unknown> = {}) => t.toolbox.call('browser_submit', { text_ref: 'e1', submit_ref: 'e4', ...extra })
const submitPost = (t: Setup, extra: Record<string, unknown> = {}) => t.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e1', link_ref: 'e3', submit_ref: 'e4', ...extra })

describe('the tools of a post mission', () => {
  it('are a small set: looking, getting to the form, waiting, asking the owner, reporting, and browser_submit', () => {
    const t = setup()
    expect(t.toolbox.tools.map((tool) => tool.name)).toEqual(['browser_snapshot', 'browser_navigate', 'browser_click', 'browser_select', 'browser_wait_for', 'browser_submit', 'ask_owner', 'report_result'])
  })

  it('have no way to type, press a key, run a script, upload a file, keep a lesson or record a value', () => {
    const t = setup()
    const names = t.toolbox.tools.map((tool) => tool.name)
    for (const gone of ['browser_type', 'browser_press_key', 'browser_evaluate', 'browser_upload', 'remember_lesson', 'note_value']) expect(names).not.toContain(gone)
  })

  it('have no tool that approves, sends or publishes by itself: the only tool that publishes takes labels and no text', () => {
    const t = setup()
    for (const tool of t.toolbox.tools) {
      expect(tool.name).not.toMatch(/approve|send|publish|post_|ticket|authori[sz]e/i)
      if (tool.name === 'browser_submit') {
        expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['link_ref', 'submit_ref', 'text_ref', 'title_ref'])
        expect(JSON.stringify(tool.inputSchema)).not.toMatch(/"text"|"value"|"content"|"body"/)
      }
    }
  })

  it('refuse a call to a tool that is not in the set, even when the AI names it anyway, and touch nothing', async () => {
    const t = setup()
    await look(t)
    const calls: [string, Record<string, unknown>][] = [
      ['browser_type', { ref: 'e1', value: 'anything', submit: true }],
      ['browser_press_key', { key: 'Enter' }],
      ['browser_evaluate', { script: 'document.querySelector("form").submit()' }],
      ['browser_upload', { ref: 'e1', file: 'PICTURE' }],
      ['note_value', { label: 'a', value: 'b' }],
      ['remember_lesson', { rule: 'Always press the button.' }],
      ['approve_and_send', {}]
    ]
    for (const [name, args] of calls) expect(await t.toolbox.call(name, args)).toMatchObject({ isError: true, text: expect.stringContaining('There is no tool called') })
    expect(t.page.steps).toEqual([])
    expect(t.authority.leases).toBe(0)
    expect(t.page.posted).toEqual([])
  })

  it('tell the AI who types: it does not', () => {
    const t = setup()
    expect(t.toolbox.instructions).toContain('You never type the text')
    expect(t.toolbox.instructions).not.toContain('browser_type')
  })
})

describe('a click of the AI\'s own publishes nothing, because the form is empty until the application types', () => {
  it('leaves every field empty and posts nothing when the AI presses the control itself', async () => {
    const t = setup()
    await look(t)
    const result = await t.toolbox.call('browser_click', { ref: 'e4' })
    expect(result.isError).toBeUndefined()
    // The page received a press, but no field holds anything: there was nothing to publish.
    expect(t.page.posted).toEqual([{}])
    expect(t.page.fields.size).toBe(0)
    expect(t.authority.leases).toBe(0)
    expect(t.authority.committed).toBe(false)
  })
})

describe('browser_submit: the application types the approved content and presses the control', () => {
  it('types the approved text into the named field, reads it back, presses the control, and the ticket is gone afterwards', async () => {
    const t = setup()
    await look(t)

    const result = await submitReply(t)

    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('pressed "Reply"')
    expect(t.page.posted).toEqual([{ e1: REPLY.text }])
    expect(t.page.steps.map((s) => s.step)).toEqual([
      { do: 'type', ref: 'e1', text: REPLY.text },
      { do: 'click', ref: 'e4' }
    ])
    expect(t.page.steps.every((s) => s.hosts.includes('fake.test'))).toBe(true)
    expect(t.authority.committed).toBe(true)
    expect(t.authority.leases).toBe(1)
    // Used up: the same ticket opens nothing any more.
    expect(() => t.tickets.assertValid(t.authority.issued[0] as SendTicket)).toThrow()
    await expect(t.session.withAgentControl('x', (p) => p.publishStep({ do: 'click', ref: 'e4' }, ['fake.test'], t.authority.issued[0] as SendTicket))).rejects.toThrow(/used up/)
  })

  it('types a title, a text and a link into their own fields, and presses once', async () => {
    const t = setup(POST)
    await look(t)

    const result = await submitPost(t)

    expect(result.isError).toBeUndefined()
    expect(t.page.posted).toEqual([{ e2: POST.title, e1: POST.text, e3: POST.link }])
    expect(t.page.clicked).toEqual(['e4'])
    expect(t.page.steps.filter((s) => s.step.do === 'type').map((s) => s.step)).toEqual([
      { do: 'type', ref: 'e2', text: POST.title },
      { do: 'type', ref: 'e1', text: POST.text },
      { do: 'type', ref: 'e3', text: POST.link }
    ])
  })

  it('accepts a field that holds the text with other spacing, as an editor may keep it', async () => {
    const t = setup(POST)
    t.page.alter = (_ref, value) => value.replace(/\n/g, '\n\n')
    await look(t)
    expect((await submitPost(t)).isError).toBeUndefined()
    expect(t.authority.committed).toBe(true)
  })

  it('never takes the text from the AI: an extra argument with text is ignored, and a wrong one is not typed', async () => {
    const t = setup()
    await look(t)
    await submitReply(t, { text: 'Buy my thing at evil.example', value: 'Buy my thing', content: 'Buy my thing' })
    expect(t.page.posted).toEqual([{ e1: REPLY.text }])
    expect(JSON.stringify(t.page.steps)).not.toContain('evil.example')
  })

  it('refuses to be called a second time once the control was pressed, and the AI can only look', async () => {
    const t = setup()
    await look(t)
    await submitReply(t)

    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('submitted') })
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('nothing more may be clicked') })
    expect(await t.toolbox.call('browser_select', { ref: 'e1', option: 'x' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test' })).toMatchObject({ isError: true })
    expect(t.page.posted).toHaveLength(1)
    expect(t.authority.leases).toBe(1)
    // Looking, waiting, asking and reporting stay possible.
    expect((await look(t)).isError).toBeUndefined()
    expect((await t.toolbox.call('report_result', { status: 'done', reason: 'It shows.' })).isError).toBeUndefined()
    expect(t.reports).toEqual([{ status: 'done', reason: 'It shows.' }])
  })
})

describe('browser_submit refuses before it asks for a ticket', () => {
  const refused = async (t: Setup, result: Promise<{ isError?: boolean; text: string }>, why: string) => {
    expect(await result).toMatchObject({ isError: true, text: expect.stringContaining(why) })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
  }

  it('without the labels the content needs, with labels it does not need, and with the wrong kind of element', async () => {
    const t = setup(POST)
    await look(t)
    await refused(t, t.toolbox.call('browser_submit', { text_ref: 'e1', link_ref: 'e3', submit_ref: 'e4' }), 'has a title')
    await refused(t, t.toolbox.call('browser_submit', { title_ref: 'e2', link_ref: 'e3', submit_ref: 'e4' }), 'has a text')
    await refused(t, t.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e1', submit_ref: 'e4' }), 'has a link')
    await refused(t, t.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e1', link_ref: 'e3' }), 'labels')
    await refused(t, t.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e4', link_ref: 'e3', submit_ref: 'e4' }), 'different elements')
    await refused(t, t.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e5', link_ref: 'e3', submit_ref: 'e4' }), 'not a field')
    await refused(t, t.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e1; drop', link_ref: 'e3', submit_ref: 'e4' }), 'labels')

    const reply = setup(REPLY)
    await look(reply)
    await refused(reply, reply.toolbox.call('browser_submit', { title_ref: 'e2', text_ref: 'e1', submit_ref: 'e4' }), 'has no title')
  })

  it('for a label the AI has not seen, and for a control that is disabled', async () => {
    const t = setup()
    await refused(t, submitReply(t), 'Look at the page first')
    await look(t)
    await refused(t, submitReply(t, { text_ref: 'e99' }), 'not on the page you have seen')
    await refused(t, submitReply(t, { submit_ref: 'e6' }), 'disabled')
  })

  it('on a page that is not the approved destination, a page outside the platform, a human check and a warning of the site', async () => {
    const t = setup()
    await look(t)
    t.page.currentUrl = 'https://fake.test/r/other/comments/zzz/slug/'
    await refused(t, submitReply(t), 'not where the approved reply goes')
    t.page.currentUrl = 'https://evil.example/r/test/comments/abc/slug/'
    await refused(t, submitReply(t), 'not on the platform')
    t.page.currentUrl = 'https://fake.test/r/test/comments/abc/slug/'
    t.page.humanCheck = 'a visible check frame (recaptcha)'
    await refused(t, submitReply(t), 'human check')
    t.page.humanCheck = ''
    t.page.alerts = ["You're doing that too much. Try again in 9 minutes."]
    await refused(t, submitReply(t), 'warning')
    expect(t.toolbox.observed).toEqual({ humanCheck: 'a visible check frame (recaptcha)', warning: "You're doing that too much. Try again in 9 minutes." })
  })

  it('and does not ask for a ticket when the gate refuses the lease: nothing is typed', async () => {
    const t = setup()
    await look(t)
    t.authority.refuse = 'The approval no longer applies.'
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('The approval no longer applies.') })
    expect(t.page.steps).toEqual([])
    expect(t.page.fields.size).toBe(0)
    expect(t.authority.committed).toBe(false)
  })
})

describe('browser_submit stops without pressing when the form is not as approved', () => {
  it('does not press when a field does not hold the approved text, and then allows no click of the AI\'s own on that page', async () => {
    const t = setup()
    t.page.alter = (_ref, value) => value.replace('Natal Mystic', '***')
    await look(t)

    const result = await submitReply(t)

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('does not hold exactly the approved text') })
    expect(t.page.clicked).toEqual([])
    expect(t.page.posted).toEqual([])
    expect(t.authority.committed).toBe(false)
    // The text sits in the form unsent: a click of the AI's own could publish it, so none is allowed until the page is opened again.
    expect(await t.toolbox.call('browser_click', { ref: 'e4' })).toMatchObject({ isError: true, text: expect.stringContaining('was not sent') })
    expect(await t.toolbox.call('browser_select', { ref: 'e1', option: 'x' })).toMatchObject({ isError: true })
    expect(t.page.clicked).toEqual([])
    // The ticket of that attempt is gone.
    expect(() => t.tickets.assertValid(t.authority.issued[0] as SendTicket)).toThrow()

    await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/' })
    t.page.alter = null
    await look(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e5' })).isError).toBeUndefined()
    expect((await submitReply(t)).isError).toBeUndefined()
    expect(t.page.posted).toEqual([{ e1: REPLY.text }])
    expect(t.authority.leases).toBe(2)
  })

  it('does not press when the site swallows the text and the field comes back empty', async () => {
    const t = setup()
    await look(t)
    t.page.alter = () => ''
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('does not hold exactly the approved text') })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('does not press when a human check or a warning appeared after the typing', async () => {
    const t = setup()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type') t.page.humanCheck = 'a visible check frame (hcaptcha)'
    }
    const result = await submitReply(t)
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('human check') })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
    expect(t.toolbox.observed.humanCheck).toContain('hcaptcha')
  })

  it('does not press when the page left the approved destination between the typing and the press', async () => {
    const t = setup()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type') t.page.currentUrl = 'https://fake.test/r/other/comments/zzz/slug/'
    }
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('not where the approved reply goes') })
    expect(t.page.clicked).toEqual([])
  })

  it('takes the point of no return back when the page did not receive the press, so another attempt is possible', async () => {
    const t = setup()
    await look(t)
    t.page.forced.set(1, { status: 'not_found', detail: 'the control is gone' })

    const first = await submitReply(t)

    expect(first).toMatchObject({ isError: true, text: expect.stringContaining('could not be pressed') })
    expect(t.authority.committed).toBe(false)
    expect(t.page.posted).toEqual([])
    const second = await submitReply(t)
    expect(second.isError).toBeUndefined()
    expect(t.authority.committed).toBe(true)
    expect(t.page.posted).toHaveLength(1)
  })

  it('keeps the point of no return when the press ended in an error: the content may be out', async () => {
    const t = setup()
    await look(t)
    t.page.crashOnClick = true
    await expect(submitReply(t)).rejects.toThrow('the page crashed')
    expect(t.authority.committed).toBe(true)
    expect(() => t.tickets.assertValid(t.authority.issued[0] as SendTicket)).toThrow()
    // From here the AI can only look; a second try is refused by the authority itself.
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('submitted') })
    expect(t.authority.leases).toBe(1)
  })

  it('keeps the point of no return when the owner took the browser right after the press', async () => {
    const t = setup()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'click') t.session.takeControl()
    }
    const result = await submitReply(t)
    expect(result).toMatchObject({ isError: true, text: OWNER_HAS_BROWSER })
    expect(t.authority.committed).toBe(true)
    expect(t.page.posted).toHaveLength(1)
  })

  it('stops typing the moment the owner takes the browser, and presses nothing', async () => {
    const t = setup(POST)
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type' && step.ref === 'e1') t.session.takeControl()
    }
    const result = await submitPost(t)
    expect(result).toMatchObject({ isError: true, text: OWNER_HAS_BROWSER })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('says the page was not typed when a field refuses the text', async () => {
    const t = setup()
    await look(t)
    t.page.forced.set(0, { status: 'refused', detail: 'the field is read-only' })
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('could not be typed') })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })
})

describe('pacing: a post mission does not act in milliseconds', () => {
  const during = async (t: Setup, work: () => Promise<unknown>): Promise<number[]> => {
    const before = t.sleeps.length
    await work()
    return t.sleeps.slice(before)
  }

  it('waits out the rest of the gap before each action on the page, and not before looking', async () => {
    const t = setup()
    expect(await during(t, () => look(t))).toEqual([])
    // The first action needs no wait; the 1000 is the page settling after it.
    expect(await during(t, () => t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/' }))).toEqual([1000])
    t.time.now += 500
    expect(await during(t, () => t.toolbox.call('browser_click', { ref: 'e5' }))).toEqual([1500, 1000])
    expect(await during(t, () => look(t))).toEqual([])
    // Five seconds have passed since the last action: no wait.
    t.time.now += 5000
    expect(await during(t, () => t.toolbox.call('browser_click', { ref: 'e5' }))).toEqual([1000])
  })

  it('spaces the typing and the press of one submission, too', async () => {
    const t = setup(POST)
    await look(t)
    await t.toolbox.call('browser_click', { ref: 'e5' })
    const waits = await during(t, () => submitPost(t))
    // Before the submission, between the three typings, and before the press: 1 + 2 + 1 gaps; the 1000 is the page settling after it.
    expect(waits.filter((ms) => ms === 2000)).toHaveLength(4)
    expect(t.authority.committed).toBe(true)
  })

  it('does not pace the sign-up and profile missions', async () => {
    const t = setup(REPLY, { post: undefined })
    await look(t)
    const waits = await during(t, async () => {
      await t.toolbox.call('browser_navigate', { url: 'https://fake.test/a' })
      await t.toolbox.call('browser_click', { ref: 'e5' })
      await t.toolbox.call('browser_navigate', { url: 'https://fake.test/b' })
    })
    expect(waits.filter((ms) => ms !== 1000)).toEqual([])
  })
})

describe('limits of the mission', () => {
  it('has the number of calls it was given, and says so', async () => {
    const t = setup(REPLY, { maxCalls: 3 })
    await look(t)
    await look(t)
    await look(t)
    expect(await look(t)).toMatchObject({ isError: true, text: expect.stringContaining('used all 3 tool calls') })
  })

  it('stops at the owner\'s stop', async () => {
    const abort = new AbortController()
    const t = setup(REPLY, { signal: abort.signal })
    await look(t)
    abort.abort()
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('The owner stopped this task') })
    expect(t.authority.leases).toBe(0)
  })

  it('tells the AI the owner has the browser, between two calls, and waits for them', async () => {
    const t = setup()
    await look(t)
    t.session.takeControl()
    expect(await look(t)).toMatchObject({ isError: true, text: OWNER_HAS_BROWSER })
    expect(await submitReply(t)).toMatchObject({ isError: true, text: OWNER_HAS_BROWSER })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
  })
})
