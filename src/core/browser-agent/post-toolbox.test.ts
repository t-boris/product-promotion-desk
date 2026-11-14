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
  submits?: boolean
  form?: number
  parent?: string
}

/** A compose form that behaves like a site: typed text lands in fields, a press of the submit control posts what the fields hold. */
class FormPage extends FakePage {
  items: Item[] = [
    { ref: 'e1', role: 'textarea', name: 'Add a comment' },
    { ref: 'e2', role: 'input:text', name: 'Title' },
    { ref: 'e3', role: 'input:url', name: 'Link' },
    { ref: 'e4', role: 'button', name: 'Reply' },
    { ref: 'e5', role: 'link', name: 'Cancel' },
    { ref: 'e6', role: 'button', name: 'Post (disabled)', disabled: true },
    // A control whose name does not say that it publishes, and whose press submits the form all the same: what the held-text guard is for.
    { ref: 'e8', role: 'button', name: 'Continue' }
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
  /** Runs before a script is read (a test stops the mission, or changes the page, at a moment of its choice). */
  beforeRead: ((script: string) => void) | null = null
  /** An address that carries its content: `?title=` and `?text=` fill the title and the text of the form when the page loads. */
  prefillFromAddress = false
  /** Text the site puts back into fields every time a page loads (a restored draft), by label. */
  restore: Record<string, string> = {}
  /** Text in places the snapshot does not list (a hidden field, a field beyond the first 160 elements). */
  hidden: string[] = []
  /** A page whose fields cannot be read. */
  fieldsUnreadable = false
  /** A page on which the script that reads the fields fails (it throws). */
  readThrows = false
  private stepNumber = 0

  /** Loads a page like a browser does: a new document starts empty, except what the address or the site fills in; a change of the fragment only keeps the document and what its fields hold. */
  override async goto(url: string): Promise<void> {
    const previous = this.currentUrl
    await super.goto(url)
    this.currentUrl = url
    if (url.includes('#') && url.split('#')[0] === previous.split('#')[0]) return
    this.fields.clear()
    this.hidden = []
    if (this.prefillFromAddress) {
      const query = new URL(url).searchParams
      const title = query.get('title')
      const text = query.get('text')
      if (title) this.fields.set('e2', title)
      if (text) this.fields.set('e1', text)
    }
    for (const [ref, text] of Object.entries(this.restore)) this.fields.set(ref, text)
  }
  override async read<T>(script: string): Promise<T> {
    this.log.push(`read ${script.slice(0, 40)}`)
    this.beforeRead?.(script)
    if (script.includes('ppd-form-text')) {
      if (this.readThrows) throw new Error('the script failed')
      if (this.fieldsUnreadable) return 'not an answer' as T
      const blank = (text: string): boolean => text.replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '') === ''
      const typed = [...this.fields].filter(([, text]) => !blank(text)).map(([ref, text]) => ({ ref, text }))
      return [...typed, ...this.hidden.map((text) => ({ ref: null, text }))] as T
    }
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
      if (['e4', 'e8', 'e21'].includes(step.ref)) {
        this.posted.push(Object.fromEntries(this.fields))
        // A site empties its form once the comment is posted.
        this.fields.clear()
      }
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
      page.log.push('sleep')
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

describe('a click of the AI\'s own publishes nothing: the form is empty until the application types', () => {
  it('leaves every field empty and posts nothing when the AI presses the control itself', async () => {
    const t = setup()
    await look(t)
    const result = await t.toolbox.call('browser_click', { ref: 'e8' })
    expect(result.isError).toBeUndefined()
    // The page received a press, but no field holds anything: there was nothing to publish.
    expect(t.page.posted).toEqual([{}])
    expect(t.page.fields.size).toBe(0)
    expect(t.authority.leases).toBe(0)
    expect(t.authority.committed).toBe(false)
  })

  const HOLDS_TEXT = { isError: true, text: expect.stringContaining('holds text') }
  /** Both ways the AI has to click: a click, and a choice in a list, which is a click on anything that is not a list. */
  const handsOff = async (t: Setup, leases = 0) => {
    expect(await t.toolbox.call('browser_click', { ref: 'e8' })).toMatchObject(HOLDS_TEXT)
    expect(await t.toolbox.call('browser_select', { ref: 'e8', option: 'anything' })).toMatchObject(HOLDS_TEXT)
    expect(t.page.clicked).toEqual([])
    expect(t.page.posted).toEqual([])
    expect(t.authority.leases).toBe(leases)
    expect(t.authority.committed).toBe(false)
  }

  it('is refused while an address has prefilled the form: opening a compose page with the text in its query, then pressing Post', async () => {
    const t = setup(POST)
    t.page.prefillFromAddress = true
    await look(t)
    expect((await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/submit?title=Buy+now&text=Text+nobody+approved' })).isError).toBeUndefined()
    expect(t.page.fields.get('e1')).toBe('Text nobody approved')
    await look(t)
    await handsOff(t)
  })

  it('is refused while a failed read-back has left the approved text in the form, also after a navigation that keeps the document (the same address with a fragment)', async () => {
    const t = setup()
    t.page.alter = (_ref, value) => value.replace('Natal Mystic', '***')
    await look(t)
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('does not hold exactly the approved text') })
    expect(t.page.fields.get('e1')).toContain('***')

    expect((await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/#' })).isError).toBeUndefined()
    expect(t.page.fields.get('e1')).toContain('***') // the document is the same, so is what its field holds
    await handsOff(t, 1)

    // Only a new document is an empty form: the address as it was, loaded again.
    t.page.alter = null
    await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/' })
    expect(t.page.fields.size).toBe(0)
    await look(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e5' })).isError).toBeUndefined()
  })

  it('is refused for a draft the site restores, for text the owner left there, and for text in a field the snapshot does not list', async () => {
    const restored = setup()
    restored.page.restore = { e1: 'A draft of an earlier visit' }
    await look(restored)
    await restored.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/' })
    await handsOff(restored)

    const owner = setup()
    await look(owner)
    owner.page.fields.set('e1', 'Typed by the owner in the window')
    await handsOff(owner)

    const hidden = setup()
    await look(hidden)
    hidden.page.hidden = ['text in a hidden field']
    await handsOff(hidden)
  })

  it('is refused when the fields of the page cannot be read: what is not seen is not known to be empty', async () => {
    const t = setup()
    await look(t)
    t.page.fieldsUnreadable = true
    expect(await t.toolbox.call('browser_click', { ref: 'e8' })).toMatchObject({ isError: true, text: expect.stringContaining('could not be read') })
    expect(await t.toolbox.call('browser_select', { ref: 'e8', option: 'x' })).toMatchObject({ isError: true, text: expect.stringContaining('could not be read') })
    expect(t.page.clicked).toEqual([])
  })

  it('does not take a field of the form for text the AI typed: blanks and zero-width characters are an empty form', async () => {
    const t = setup()
    await look(t)
    t.page.fields.set('e1', '  \u200b ')
    expect((await t.toolbox.call('browser_click', { ref: 'e5' })).isError).toBeUndefined()
  })
})

describe('a control that publishes is never clicked or chosen by the AI itself, whatever the page holds', () => {
  const NAMES = ['Post', 'Reply', 'Comment', 'Submit', 'Send', 'Publish', 'Save', 'Add a comment', 'Post comment', 'Опубликовать', 'Ответить', 'Отправить']
  const PUBLISHING = { isError: true, text: expect.stringContaining('only browser_submit presses') }

  it.each(NAMES)('refuses a click and a choice on a button named "%s" on a page whose forms are empty, and sends nothing to the page', async (name) => {
    const t = setup()
    t.page.items.push({ ref: 'e9', role: 'button', name })
    await look(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e9' })).toMatchObject(PUBLISHING)
    expect(await t.toolbox.call('browser_select', { ref: 'e9', option: 'x' })).toMatchObject(PUBLISHING)
    expect(t.page.steps).toEqual([])
    expect(t.page.clicked).toEqual([])
    expect(t.authority.leases).toBe(0)
  })

  it('refuses a control that submits its form natively, whatever its name says (the page marks it, not the words)', async () => {
    const t = setup()
    t.page.items.push({ ref: 'e9', role: 'button', name: 'Continue', submits: true }, { ref: 'e10', role: 'input:submit', name: 'Go' })
    await look(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e9' })).toMatchObject(PUBLISHING)
    expect(await t.toolbox.call('browser_click', { ref: 'e10' })).toMatchObject(PUBLISHING)
    expect(t.page.steps).toEqual([])
  })

  it('judges the element by the last look too: a page that renumbered its elements cannot turn the Reply button of the AI\'s snapshot into something else', async () => {
    const t = setup()
    await look(t)
    // After the look the page is rebuilt: e4 is now a harmless link, but the AI was shown "Reply" as e4.
    t.page.items = t.page.items.map((i) => (i.ref === 'e4' ? { ref: 'e4', role: 'link', name: 'Show more' } : i))
    expect(await t.toolbox.call('browser_click', { ref: 'e4' })).toMatchObject(PUBLISHING)
    expect(t.page.steps).toEqual([])
  })

  it('judges the element by the fresh look too: a page that renumbered its elements can turn the harmless control of the AI\'s snapshot into the one that publishes', async () => {
    const t = setup()
    await look(t) // e8 is "Continue" here
    t.page.items = t.page.items.map((i) => (i.ref === 'e8' ? { ref: 'e8', role: 'button', name: 'Post' } : i))
    expect(await t.toolbox.call('browser_click', { ref: 'e8' })).toMatchObject(PUBLISHING)
    expect(await t.toolbox.call('browser_select', { ref: 'e8', option: 'x' })).toMatchObject(PUBLISHING)
    expect(t.page.steps).toEqual([])
  })

  it('refuses a ref that is not on the page now, shown or not: what cannot be judged is not clicked', async () => {
    const GONE = { isError: true, text: expect.stringContaining('is not on the page now') }
    const t = setup()
    await look(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e77' })).toMatchObject(GONE) // never on the page
    expect(await t.toolbox.call('browser_select', { ref: 'e77', option: 'x' })).toMatchObject(GONE)
    t.page.items = t.page.items.filter((i) => i.ref !== 'e5') // shown to the AI, gone from the page now
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject(GONE)
    expect(t.page.steps).toEqual([])
    expect(t.page.clicked).toEqual([])
  })

  it('does not refuse what is not a publishing control: a link, a text box, a button of another purpose', async () => {
    const t = setup()
    t.page.items.push({ ref: 'e9', role: 'button', name: 'Expand comment' }, { ref: 'e10', role: 'link', name: 'Reply' }, { ref: 'e11', role: 'button', name: 'Add flair' })
    await look(t)
    for (const ref of ['e5', 'e9', 'e10', 'e11', 'e1']) expect((await t.toolbox.call('browser_click', { ref })).isError).toBeUndefined()
    expect(t.page.clicked).toEqual(['e5', 'e9', 'e10', 'e11', 'e1'])
  })
})

describe('a click or a choice of the AI\'s own is made only on the approved destination, and never on a control that does something else to the account', () => {
  const NOT_HERE = { isError: true, text: expect.stringContaining('not where the approved') }

  it.each([
    ['a reply on another thread', REPLY, 'https://fake.test/r/test/comments/zzz/other/'],
    ['a reply on another community', REPLY, 'https://fake.test/r/elsewhere/comments/abc/slug/'],
    ['a post in another community', POST, 'https://fake.test/r/elsewhere/submit'],
    ['a post on a page of the platform that is no community page', POST, 'https://fake.test/settings/profile']
  ])('refuses a click and a choice on %s, and sends nothing to the page', async (_what, content, url) => {
    const t = setup(content)
    await look(t)
    t.page.currentUrl = url
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject(NOT_HERE)
    expect(await t.toolbox.call('browser_select', { ref: 'e5', option: 'x' })).toMatchObject(NOT_HERE)
    expect(t.page.steps).toEqual([])
  })

  it('refuses a click and a choice on a page that is not on the platform at all', async () => {
    const t = setup()
    await look(t)
    t.page.currentUrl = 'https://evil.example/r/test/comments/abc/slug/'
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('not on the platform') })
    expect(await t.toolbox.call('browser_select', { ref: 'e5', option: 'x' })).toMatchObject({ isError: true, text: expect.stringContaining('not on the platform') })
    expect(t.page.steps).toEqual([])
  })

  it('clicks on the approved page, on its fragment and on its trailing slash', async () => {
    const t = setup()
    for (const url of ['https://fake.test/r/test/comments/abc/slug/', 'https://fake.test/r/test/comments/abc/slug/def#c', 'https://fake.test/r/test/comments/abc/slug/def/?context=3']) {
      t.page.currentUrl = url
      await look(t)
      expect((await t.toolbox.call('browser_click', { ref: 'e5' })).isError).toBeUndefined()
    }
  })

  it('refuses a click while a human check or a warning of the site is on the page: only a person can go on', async () => {
    const t = setup()
    t.page.humanCheck = 'a visible check frame (recaptcha)'
    await look(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('human check') })
    t.page.humanCheck = ''
    t.page.alerts = ["You're doing that too much. Try again in 9 minutes."]
    expect(await t.toolbox.call('browser_select', { ref: 'e5', option: 'x' })).toMatchObject({ isError: true, text: expect.stringContaining('The site shows a warning') })
    expect(t.page.steps).toEqual([])
  })

  const NEVER = [
    'Join', 'Join r/test', 'Joined', 'Follow', 'Following', 'Unfollow', 'Subscribe', 'Unsubscribe', 'Upvote', 'Downvote', 'Vote', 'Block user', 'Unblock', 'Mute',
    'Delete', 'Delete comment', 'Remove', 'Report', 'Report comment', 'Flag', 'Allow', 'Allow access', 'Authorize app', 'Authorise', 'Grant access', 'Log out', 'Sign out',
    'Вступить', 'Присоединиться', 'Подписаться', 'Отписаться', 'Проголосовать', 'Заблокировать', 'Удалить', 'Пожаловаться', 'Разрешить', 'Авторизовать', 'Выйти'
  ]
  it.each(NEVER)('never clicks or chooses a control named "%s", whatever its role', async (name) => {
    for (const role of ['button', 'link', 'menuitem', 'div']) {
      const t = setup()
      t.page.items.push({ ref: 'e9', role, name })
      await look(t)
      expect(await t.toolbox.call('browser_click', { ref: 'e9' })).toMatchObject({ isError: true, text: expect.stringContaining('joins, follows, votes') })
      expect(await t.toolbox.call('browser_select', { ref: 'e9', option: 'x' })).toMatchObject({ isError: true, text: expect.stringContaining('joins, follows, votes') })
      expect(t.page.steps).toEqual([])
    }
  })

  it.each(['Expand comment', 'Show more', 'Cancel', 'Add flair', 'Followers', 'Reportage', 'Blockquote', 'Allowance', 'Comments', 'Sort by: Best', 'Отмена', 'Показать ещё', 'Пожалуйста, подождите'])('does not take "%s" for one of them', async (name) => {
    const t = setup()
    t.page.items.push({ ref: 'e9', role: 'link', name })
    await look(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e9' })).isError).toBeUndefined()
  })

  it('takes a name that has the word in it for one of them, on purpose: the refusal errs on the side of not clicking', async () => {
    const t = setup()
    t.page.items.push({ ref: 'e9', role: 'link', name: 'Votes tab' })
    await look(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e9' })).isError).toBe(true)
  })
})

describe('what is not known about the form is not taken for empty', () => {
  const UNREADABLE = { isError: true, text: expect.stringContaining('could not be read') }

  it('refuses a click and a choice when the script that reads the fields fails, not only when it answers nonsense', async () => {
    const t = setup()
    await look(t)
    t.page.readThrows = true
    expect(await t.toolbox.call('browser_click', { ref: 'e8' })).toMatchObject(UNREADABLE)
    expect(await t.toolbox.call('browser_select', { ref: 'e8', option: 'x' })).toMatchObject(UNREADABLE)
    expect(t.page.clicked).toEqual([])
    expect(t.page.posted).toEqual([])
  })

  it('refuses browser_submit before it asks for a ticket when the fields cannot be read: an unknown form is not an empty one', async () => {
    for (const how of ['fieldsUnreadable', 'readThrows'] as const) {
      const t = setup()
      await look(t)
      t.page[how] = true
      expect(await submitReply(t)).toMatchObject(UNREADABLE)
      expect(t.authority.leases).toBe(0)
      expect(t.page.steps).toEqual([])
      expect(t.page.fields.size).toBe(0)
    }
  })

  it('does not press when the fields can no longer be read after the typing: the form may hold what nobody approved', async () => {
    const t = setup()
    await look(t)
    t.page.beforeRead = (script) => {
      // The read-back of the field has been answered; the next look at the fields fails.
      if (script.includes('ppd-form-text') && t.page.fields.size > 0) t.page.readThrows = true
    }
    const result = await submitReply(t)
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('could not be read') })
    expect(t.page.clicked).toEqual([])
    expect(t.page.posted).toEqual([])
    expect(t.authority.committed).toBe(false)
  })
})

describe('calls that arrive together are taken in turn, and each one is decided when its turn comes', () => {
  it('a click sent together with browser_submit is refused after the press, and presses nothing a second time', async () => {
    const t = setup()
    await look(t)
    const [submitted, clicked] = await Promise.all([submitReply(t), t.toolbox.call('browser_click', { ref: 'e8' })])
    expect(submitted.isError).toBeUndefined()
    expect(clicked).toMatchObject({ isError: true, text: expect.stringContaining('nothing more may be clicked') })
    expect(t.page.clicked).toEqual(['e4']) // the application's own press, once
    expect(t.page.posted).toEqual([{ e1: REPLY.text }])
    expect(t.authority.leases).toBe(1)
  })

  it('a click sent together with a browser_submit that failed its read-back finds the text in the form and presses nothing', async () => {
    const t = setup()
    t.page.alter = (_ref, value) => value.replace('Natal Mystic', '***')
    await look(t)
    const [submitted, clicked] = await Promise.all([submitReply(t), t.toolbox.call('browser_click', { ref: 'e8' })])
    expect(submitted).toMatchObject({ isError: true, text: expect.stringContaining('does not hold exactly the approved text') })
    expect(clicked).toMatchObject({ isError: true, text: expect.stringContaining('holds text') })
    expect(t.page.clicked).toEqual([])
    expect(t.page.posted).toEqual([])
  })

  it('a choice sent together with browser_submit, and a second browser_submit, are refused after the press', async () => {
    const t = setup()
    await look(t)
    const [first, chosen, second] = await Promise.all([submitReply(t), t.toolbox.call('browser_select', { ref: 'e8', option: 'x' }), submitReply(t)])
    expect(first.isError).toBeUndefined()
    expect(chosen).toMatchObject({ isError: true })
    expect(second).toMatchObject({ isError: true, text: expect.stringContaining('submitted') })
    expect(t.page.clicked).toEqual(['e4'])
    expect(t.authority.leases).toBe(1)
  })

  it('a navigation sent together with browser_submit waits for it and is then refused: the page it would replace has been published', async () => {
    const t = setup()
    await look(t)
    const [submitted, opened] = await Promise.all([submitReply(t), t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test' })])
    expect(submitted.isError).toBeUndefined()
    expect(opened).toMatchObject({ isError: true, text: expect.stringContaining('submitted') })
    expect(t.page.log.filter((l) => l.startsWith('goto'))).toEqual([])
  })

  it('keeps the pause between actions for calls that arrive together: they are spaced as if they came one after the other', async () => {
    const t = setup()
    await look(t)
    await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/' })
    const before = t.sleeps.length
    await Promise.all([t.toolbox.call('browser_click', { ref: 'e5' }), t.toolbox.call('browser_click', { ref: 'e5' })])
    // Each of the two clicks waits out the gap after the one before it (the 1000 is the page settling after each).
    expect(t.sleeps.slice(before).filter((ms) => ms !== 1000)).toEqual([2000, 2000])
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
    // What the last look showed: the human check was gone by then (see the next test).
    expect(t.toolbox.observed).toEqual({ humanCheck: null, warning: "You're doing that too much. Try again in 9 minutes." })
  })

  it('reports a human check or a warning only while the last look still shows it: a later failure is not a CAPTCHA once the owner solved it', async () => {
    const t = setup()
    t.page.humanCheck = 'a visible check frame (recaptcha)'
    t.page.alerts = ["You're doing that too much."]
    await look(t)
    expect(t.toolbox.observed).toEqual({ humanCheck: 'a visible check frame (recaptcha)', warning: "You're doing that too much." })

    // The owner solved the check, and the warning went away with the next page.
    t.page.humanCheck = ''
    t.page.alerts = []
    await look(t)
    expect(t.toolbox.observed).toEqual({ humanCheck: null, warning: null })

    // A failure that has nothing to do with them, after that, is classified by what the page shows now.
    t.page.items = t.page.items.filter((i) => i.ref !== 'e4')
    expect((await submitReply(t)).isError).toBe(true)
    expect(t.toolbox.observed).toEqual({ humanCheck: null, warning: null })

    // And one that appears again is seen again.
    t.page.humanCheck = 'a visible check frame (hcaptcha)'
    await look(t)
    expect(t.toolbox.observed.humanCheck).toContain('hcaptcha')
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

describe('browser_submit types only into a text box, presses only a control that can publish, and only what the AI was shown', () => {
  const refusedBeforeTheTicket = async (t: Setup, result: Promise<{ isError?: boolean; text: string }>, why: string | RegExp) => {
    expect(await result).toMatchObject({ isError: true, text: expect.stringMatching(why) })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
  }

  it.each(['div', 'summary', 'tab', 'menuitem', 'combobox', 'select', 'checkbox', 'input:password', 'input:hidden', 'img'])('does not type into an element that is a %s, whichever label the AI gives it', async (role) => {
    const t = setup()
    t.page.items.push({ ref: 'e7', role, name: 'Add a comment' })
    await look(t)
    await refusedBeforeTheTicket(t, submitReply(t, { text_ref: 'e7' }), /not a field/)
  })

  it.each(['textarea', 'textbox', 'input:text', 'input:search', 'input:url', 'input:email'])('types into a %s', async (role) => {
    const t = setup()
    t.page.items = t.page.items.filter((i) => i.ref !== 'e1') // the page's only box is this one
    t.page.items.push({ ref: 'e7', role, name: 'Add a comment' })
    await look(t)
    expect((await submitReply(t, { text_ref: 'e7' })).isError).toBeUndefined()
    expect(t.page.posted).toEqual([{ e7: REPLY.text }])
  })

  it.each([
    ['button', 'Delete comment'],
    ['button', 'Report'],
    ['button', 'Comment as u/someone'],
    ['button', 'Report comment'],
    ['button', ''],
    ['link', 'Cancel'],
    ['link', 'Log out'],
    // A link opens something, it does not submit a form, and a hostile comment can carry one named "Reply".
    ['link', 'Reply'],
    ['link', 'save'],
    ['link', 'Post'],
    ['div', 'Post'],
    ['input:checkbox', 'Post'],
    ['textarea', 'Reply']
  ])('does not press a %s named "%s": it is not a control that publishes', async (role, name) => {
    const t = setup()
    t.page.items.push({ ref: 'e7', role, name })
    await look(t)
    await refusedBeforeTheTicket(t, submitReply(t, { submit_ref: 'e7' }), /not a control that publishes/)
  })

  it.each([
    ['button', 'Comment'],
    ['button', 'Reply'],
    ['button', 'Post'],
    ['button', 'Add a comment'],
    ['button', 'Post comment'],
    ['input:submit', 'Submit'],
    ['button', 'Publish'],
    ['button', 'Опубликовать']
  ])('presses a %s named "%s"', async (role, name) => {
    const t = setup()
    t.page.items.push({ ref: 'e7', role, name })
    await look(t)
    expect((await submitReply(t, { submit_ref: 'e7' })).isError).toBeUndefined()
    expect(t.page.clicked).toEqual(['e7'])
  })

  it('refuses a label that is not what the AI was shown when the page was numbered again (a reload by another flow on the same browser)', async () => {
    const renamed = setup()
    await look(renamed)
    renamed.page.items = renamed.page.items.map((i) => (i.ref === 'e4' ? { ...i, name: 'Delete comment' } : i))
    await refusedBeforeTheTicket(renamed, submitReply(renamed), /not what it was when you looked/)

    const otherKind = setup()
    await look(otherKind)
    otherKind.page.items = otherKind.page.items.map((i) => (i.ref === 'e1' ? { ...i, role: 'button', name: 'Reply' } : i))
    await refusedBeforeTheTicket(otherKind, submitReply(otherKind), /not what it was when you looked/)
  })

  it('judges the labels by what the AI saw, not by what the application saw last: a step after its look may have numbered the page again', async () => {
    const t = setup()
    await look(t)
    // The click of the AI is answered with a page that has been numbered again: the application looks at it (`afterStep`), the AI does not.
    t.page.beforeStep = (step) => {
      if (step.do === 'click' && step.ref === 'e5') t.page.items = t.page.items.map((i) => (i.ref === 'e4' ? { ...i, name: 'Delete comment' } : i))
    }
    expect((await t.toolbox.call('browser_click', { ref: 'e5' })).isError).toBeUndefined()
    t.page.beforeStep = null
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringMatching(/not what it was when you looked/) })
    expect(t.page.steps.map((s) => s.step)).toEqual([{ do: 'click', ref: 'e5' }]) // only the AI's own click: nothing was typed or pressed
    expect(t.authority.leases).toBe(0)
    expect(t.page.posted).toEqual([])
  })

  it('does not press when the control became another one while the application was typing', async () => {
    const t = setup()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type') t.page.items = t.page.items.map((i) => (i.ref === 'e4' ? { ...i, name: 'Delete comment' } : i))
    }
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('not what it was when you looked') })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('does not press when the control was disabled while the application was typing', async () => {
    const t = setup()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type') t.page.items = t.page.items.map((i) => (i.ref === 'e4' ? { ...i, disabled: true } : i))
    }
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('is disabled') })
    expect(t.page.clicked).toEqual([])
  })
})

describe('browser_submit publishes a new post only from the community\'s submit page', () => {
  const refused = async (t: Setup, why: RegExp) => {
    expect(await submitPost(t)).toMatchObject({ isError: true, text: expect.stringMatching(why) })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
  }

  it.each([
    'https://fake.test/r/test',
    'https://fake.test/r/test/',
    'https://fake.test/r/test/new',
    'https://fake.test/r/test/comments/abc/slug/',
    'https://fake.test/r/test/submit/extra',
    'https://fake.test/r/test/submitted'
  ])('refuses on %s, which is a page of the community and not its submit page', async (url) => {
    const t = setup(POST)
    await look(t)
    t.page.currentUrl = url
    await refused(t, /submit page/)
  })

  it.each([
    'https://fake.test/r/test/submit',
    'https://fake.test/r/test/submit/',
    'https://fake.test/r/Test/submit?selftext=true',
    'https://fake.test/r/test/submit/?type=IMAGE',
    'https://fake.test/r/test/submit#form'
  ])('publishes on %s', async (url) => {
    const t = setup(POST)
    t.page.currentUrl = url
    await look(t)
    expect((await submitPost(t)).isError).toBeUndefined()
    expect(t.page.posted).toHaveLength(1)
  })

  it('refuses when the page moves off the submit page while the application types: the last look decides, before the press', async () => {
    const t = setup(POST)
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type' && step.ref === 'e1') t.page.currentUrl = 'https://fake.test/r/test'
    }
    expect(await submitPost(t)).toMatchObject({ isError: true, text: expect.stringMatching(/submit page/) })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('does not guess where another kind of site keeps its compose page: a destination that is not of the /r/<community> shape keeps the rule of the community prefix', async () => {
    const t = setup({ ...POST, destination: 'https://fake.test/c/general' })
    t.page.currentUrl = 'https://fake.test/c/general/new'
    await look(t)
    expect((await submitPost(t)).isError).toBeUndefined()
  })

  it('does not apply to a reply, which is written on the thread', async () => {
    const t = setup()
    await look(t)
    expect((await submitReply(t)).isError).toBeUndefined()
  })
})

describe('browser_submit: the elements are the ones the AI saw, by role and by name, and they are one form', () => {
  const refusedBeforeTyping = async (t: Setup, result: Promise<{ isError?: boolean; text: string }>, why: RegExp) => {
    expect(await result).toMatchObject({ isError: true, text: expect.stringMatching(why) })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
  }

  it('refuses a field that has the role of what the AI saw and another name: after a reload, e1 can be another text box', async () => {
    const t = setup()
    await look(t)
    t.page.items = t.page.items.map((i) => (i.ref === 'e1' ? { ...i, name: 'Message the moderators' } : i))
    await refusedBeforeTyping(t, submitReply(t), /not what it was when you looked/)
  })

  it('refuses a title and a link field with another name too', async () => {
    const t = setup(POST)
    await look(t)
    t.page.items = t.page.items.map((i) => (i.ref === 'e3' ? { ...i, name: 'Search' } : i))
    await refusedBeforeTyping(t, submitPost(t), /e3 is not what it was/)
  })

  it('does not hold the name of a field against it after the typing: an editor built on a div is named by what it holds', async () => {
    const t = setup()
    t.page.items = t.page.items.map((i) => (i.ref === 'e1' ? { ref: 'e1', role: 'textbox', name: '' } : i))
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type' && step.ref === 'e1') t.page.items = t.page.items.map((i) => (i.ref === 'e1' ? { ...i, name: step.text } : i))
    }
    expect((await submitReply(t)).isError).toBeUndefined()
    expect(t.page.posted).toEqual([{ e1: REPLY.text }])
  })

  it('refuses a control that belongs to another form than the fields', async () => {
    const t = setup(POST)
    t.page.items = t.page.items.map((i) => (['e1', 'e2', 'e3'].includes(i.ref) ? { ...i, form: 1 } : i.ref === 'e4' ? { ...i, form: 2 } : i))
    await look(t)
    await refusedBeforeTyping(t, submitPost(t), /not in one form/)
  })

  it('refuses a control that is in no form when the fields are in one, and a field that is in no form when the control is in one', async () => {
    const a = setup()
    a.page.items = a.page.items.map((i) => (i.ref === 'e1' ? { ...i, form: 1 } : i))
    await look(a)
    await refusedBeforeTyping(a, submitReply(a), /not in one form/)
    const b = setup()
    b.page.items = b.page.items.map((i) => (i.ref === 'e4' ? { ...i, form: 1 } : i))
    await look(b)
    await refusedBeforeTyping(b, submitReply(b), /not in one form/)
  })

  it('publishes when the fields and the control are one form, and when the page marks no forms at all', async () => {
    const a = setup(POST)
    a.page.items = a.page.items.map((i) => (['e1', 'e2', 'e3', 'e4'].includes(i.ref) ? { ...i, form: 1 } : { ...i, form: 2 }))
    await look(a)
    expect((await submitPost(a)).isError).toBeUndefined()
    const b = setup()
    await look(b)
    expect((await submitReply(b)).isError).toBeUndefined()
  })
})

describe('browser_submit: a reply goes only into the reply box of the approved comment', () => {
  const COMMENT = { ...REPLY, destination: 'https://fake.test/r/test/comments/abc/slug/def' }
  const THREAD = { ...REPLY, destination: 'https://fake.test/r/test/comments/abc/slug/' }
  /** A thread as old Reddit lays it out: the box of the thread, and a reply box under each comment that was opened, each in a form of its own. */
  const layout = (t: Setup, boxes: { form: number; parent?: string }[]) => {
    t.page.items = [
      { ref: 'e1', role: 'textarea', name: 'Add a comment', form: boxes[0]?.form, parent: boxes[0]?.parent },
      { ref: 'e4', role: 'button', name: 'Reply', form: boxes[0]?.form, parent: boxes[0]?.parent },
      { ref: 'e5', role: 'link', name: 'reply', parent: 'T1_DEF' },
      ...boxes.slice(1).flatMap((box, index) => [
        { ref: `e${20 + index * 2}`, role: 'textarea', name: 'Add a comment', form: box.form, parent: box.parent },
        { ref: `e${21 + index * 2}`, role: 'button', name: 'Reply', form: box.form, parent: box.parent }
      ])
    ]
  }
  const refused = async (t: Setup, call: Promise<{ isError?: boolean; text: string }>, why: RegExp) => {
    expect(await call).toMatchObject({ isError: true, text: expect.stringMatching(why) })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
  }

  it('publishes into the box that sits under the approved comment', async () => {
    const t = setup(COMMENT)
    layout(t, [{ form: 1, parent: 't1_def' }])
    await look(t)
    expect((await submitReply(t)).isError).toBeUndefined()
  })

  it('refuses the box that sits under another comment, and the box of the thread itself, when the approved reply answers one comment', async () => {
    const other = setup(COMMENT)
    layout(other, [{ form: 1, parent: 't1_zzz' }])
    other.page.items.push({ ref: 'e30', role: 'link', name: 'reply', parent: 't1_def' })
    await look(other)
    await refused(other, submitReply(other), /answers another thing/)

    const top = setup(COMMENT)
    layout(top, [{ form: 1 }, { form: 2, parent: 't1_def' }])
    await look(top)
    await refused(top, submitReply(top), /answers the post/)
    // The box under the approved comment, in the same page, is the one that works.
    expect((await submitReply(top, { text_ref: 'e20', submit_ref: 'e21' })).isError).toBeUndefined()
    expect(top.page.posted).toEqual([{ e20: REPLY.text }])
  })

  it('refuses a text box of one form with the button of the other, though both of them look right alone', async () => {
    const t = setup(COMMENT)
    layout(t, [{ form: 1 }, { form: 2, parent: 't1_def' }])
    await look(t)
    await refused(t, submitReply(t, { text_ref: 'e20', submit_ref: 'e4' }), /not in one form|answers/)
  })

  it('for a reply to the thread itself accepts the box of the thread and refuses a box under a comment', async () => {
    const top = setup(THREAD)
    layout(top, [{ form: 1 }])
    await look(top)
    expect((await submitReply(top)).isError).toBeUndefined()

    const under = setup(THREAD)
    layout(under, [{ form: 1, parent: 't1_zzz' }])
    await look(under)
    await refused(under, submitReply(under), /answers another thing/)

    const post = setup(THREAD)
    layout(post, [{ form: 1, parent: 't3_abc' }])
    await look(post)
    expect((await submitReply(post)).isError).toBeUndefined()
  })

  it('on a page that marks no comments, accepts the only text box, and refuses when there is more than one', async () => {
    const one = setup(COMMENT)
    await look(one)
    expect((await submitReply(one)).isError).toBeUndefined()

    for (const second of ['textarea', 'textbox']) {
      const two = setup(COMMENT)
      two.page.items.push({ ref: 'e30', role: second, name: 'Add a comment' })
      await look(two)
      await refused(two, submitReply(two), /More than one text box/)
    }
  })
})

describe('a line break is typed only into a field that holds several lines', () => {
  const refusedBeforeTyping = async (t: Setup, result: Promise<{ isError?: boolean; text: string }>) => {
    expect(await result).toMatchObject({ isError: true, text: expect.stringContaining('line break') })
    expect(t.authority.leases).toBe(0)
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
  }

  it.each(['\n', '\r\n', '\u2028', 'a\nb'])('refuses a title with %j, which a single-line field takes for Enter', async (breaks) => {
    const t = setup({ ...POST, title: `Why I built${breaks}a chart app` })
    await look(t)
    await refusedBeforeTyping(t, submitPost(t))
  })

  it('refuses a link with a line break, and a text that goes into a single-line field', async () => {
    const t = setup({ ...POST, link: 'https://natal.example/\nhttps://other.example/' })
    await look(t)
    await refusedBeforeTyping(t, submitPost(t))
    const reply = setup({ ...REPLY, text: 'First line.\nSecond line. I work on Natal Mystic.' })
    reply.page.items = reply.page.items.map((i) => (i.ref === 'e1' ? { ...i, role: 'input:text' } : i))
    await look(reply)
    await refusedBeforeTyping(reply, submitReply(reply))
  })

  it('types a text with line breaks into a text area and into an editor built on a div', async () => {
    for (const role of ['textarea', 'textbox']) {
      const t = setup(POST)
      t.page.items = t.page.items.map((i) => (i.ref === 'e1' ? { ...i, role } : i))
      await look(t)
      expect((await submitPost(t)).isError).toBeUndefined()
      expect(t.page.posted[0]?.e1).toContain('\n')
    }
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
    expect(await t.toolbox.call('browser_click', { ref: 'e8' })).toMatchObject({ isError: true, text: expect.stringContaining('holds text') })
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

  it('does not type or press when a field the approved content does not use already holds text: a link an address put into the form', async () => {
    const t = setup()
    await look(t)
    t.page.fields.set('e3', 'https://evil.example/buy')
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('not part of the approved content') })
    expect(t.page.steps).toEqual([])
    expect(t.page.posted).toEqual([])
    expect(t.authority.leases).toBe(0)
  })

  it('does not press when a field the approved content does not use got text while the application typed (a site that fills in a field itself)', async () => {
    const t = setup()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type') t.page.fields.set('e3', 'https://evil.example/buy')
    }
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('not part of the approved content') })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('does not take a hidden mirror of the approved text, kept by an editor, for foreign text', async () => {
    const t = setup()
    await look(t)
    t.page.hidden = [REPLY.text]
    expect((await submitReply(t)).isError).toBeUndefined()
    expect(t.authority.committed).toBe(true)
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

  it('takes the point of no return back when the page was not there at all (the host), too', async () => {
    const t = setup()
    await look(t)
    t.page.forced.set(1, { status: 'wrong_host', detail: 'the page is not one of this platform' })
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('could not be pressed') })
    expect(t.authority.committed).toBe(false)
  })

  it('keeps the point of no return when the press could not be confirmed after input that landed: a full-page navigation replaced the document', async () => {
    const t = setup()
    await look(t)
    // The mouse press reached the page and the comment was posted; the page then replaced its own document, so the step could not find
    // its marker and answered "refused". Nothing in that answer says that nothing happened.
    t.page.forced.set(1, { status: 'refused', detail: 'e4 could not be clicked.' })
    t.page.beforeStep = (step) => {
      if (step.do === 'click') t.page.posted.push(Object.fromEntries(t.page.fields))
    }

    const first = await submitReply(t)

    expect(first).toMatchObject({ isError: true, text: expect.stringContaining('may have been') })
    expect(first.text).not.toContain('Nothing was submitted')
    expect(t.authority.committed).toBe(true)
    // No second ticket, no second press: a fresh submit is refused by the authority itself, and so is every click.
    expect(await submitReply(t)).toMatchObject({ isError: true })
    expect(t.authority.leases).toBe(1)
    expect((await t.toolbox.call('browser_click', { ref: 'e4' })).isError).toBe(true)
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

describe('stopping a submit that is running', () => {
  const stopped = { isError: true, text: expect.stringContaining('The owner stopped this task') }
  const arm = (): { abort: AbortController; t: Setup } => {
    const abort = new AbortController()
    return { abort, t: setup(REPLY, { signal: abort.signal }) }
  }

  it('does not press when the owner pressed Stop while the application was looking at the page just before the press', async () => {
    const { abort, t } = arm()
    await look(t)
    let looks = 0
    // The second look of the submit is the one right before the press (the first is the one before the typing).
    t.page.beforeRead = (script) => {
      if (script.includes('agent-snapshot') && ++looks === 2) abort.abort()
    }
    expect(await submitReply(t)).toMatchObject(stopped)
    expect(t.page.clicked).toEqual([])
    expect(t.page.posted).toEqual([])
    expect(t.authority.committed).toBe(false)
    // The ticket of that submit is gone.
    expect(() => t.tickets.assertValid(t.authority.issued[0] as SendTicket)).toThrow()
  })

  it('does not type the rest of the content after Stop, and presses nothing', async () => {
    const abort = new AbortController()
    const t = setup(POST, { signal: abort.signal })
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'type' && step.ref === 'e2') abort.abort()
    }
    expect(await submitPost(t)).toMatchObject(stopped)
    expect(t.page.steps.filter((s) => s.step.do === 'type').map((s) => s.step)).toEqual([{ do: 'type', ref: 'e2', text: POST.title }])
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('does not start the typing when Stop came while it waited for its turn, or for the pause between actions', async () => {
    const { abort, t } = arm()
    await look(t)
    await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/comments/abc/slug/' })
    // The submit queues behind another call, and Stop comes while it waits.
    const slow = t.toolbox.call('browser_wait_for', { ms: 10 })
    const queued = submitReply(t)
    abort.abort()
    await slow
    expect(await queued).toMatchObject(stopped)
    expect(t.page.steps).toEqual([])
    expect(t.authority.leases).toBe(0)
  })

  it('does not press when the mission was ended meanwhile (the engine ended or died): the authority is sealed, and its answer is what counts', async () => {
    const t = setup()
    await look(t)
    let looks = 0
    t.page.beforeRead = (script) => {
      if (script.includes('agent-snapshot') && ++looks === 2) t.authority.seal()
    }
    expect(await submitReply(t)).toMatchObject({ isError: true, text: expect.stringContaining('This mission is over') })
    expect(t.page.clicked).toEqual([])
    expect(t.authority.committed).toBe(false)
    // Every call after the end is refused, looking included: nothing is going on any more.
    expect(await look(t)).toMatchObject({ isError: true, text: expect.stringContaining('This mission is over') })
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject({ isError: true })
  })

  it('still reports the press when Stop came after the point of no return: committed is the authority\'s word and it does not go back', async () => {
    const { abort, t } = arm()
    await look(t)
    t.page.beforeStep = (step) => {
      if (step.do === 'click') abort.abort()
    }
    const result = await submitReply(t)
    expect(result.isError).toBeUndefined() // the press was made, and the call says so
    expect(t.page.posted).toEqual([{ e1: REPLY.text }])
    expect(t.authority.committed).toBe(true)
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

  it('does not wait between the last look at the page and the press: what was checked is what is pressed', async () => {
    // Also on a clock that does not move: there every wait that is asked for is taken, so a wait added after the last look would show.
    for (const [content, frozen] of [[REPLY, false], [POST, false], [REPLY, true], [POST, true]] as const) {
      const t = setup(content)
      if (frozen) Object.defineProperty(t.time, 'now', { get: () => 10_000, set: () => undefined })
      await look(t)
      await t.toolbox.call('browser_click', { ref: 'e5' })
      expect((content.kind === 'post' ? await submitPost(t) : await submitReply(t)).isError).toBeUndefined()
      const press = t.page.log.lastIndexOf('pageStep click')
      const lastLook = t.page.log.slice(0, press).reduce((last, entry, i) => (entry.startsWith('read') ? i : last), -1)
      expect(lastLook).toBeGreaterThan(-1)
      expect(t.page.log.slice(lastLook + 1, press)).toEqual([]) // nothing at all, not a wait, not another read, between the look and the press
      expect(t.page.log.slice(lastLook, press)).not.toContain('sleep')
      // The wait is still taken, just before that look: the typing of the last field is followed by one.
      expect(t.page.log.slice(0, lastLook)).toContain('sleep')
    }
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
