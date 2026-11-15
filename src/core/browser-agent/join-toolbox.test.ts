// DEC-029: the tools of a join mission. The AI has seven tools (the mouse wheel is one), one allowed click (the Join button of the community, on its own page, once)
// and nothing else; every other control, page, host and tool is refused by the application.

import { describe, expect, it } from 'vitest'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult } from '../ports'
import { FakePage } from '../testing/fakes'
import { isJoinControl, joinNamesCommunity, JOIN_AMBIGUOUS, JOIN_CHANGED, JOIN_CLICK_ONLY, JOIN_PRESSED, joinMissionPrompt } from './join'
import { TestAuthority } from './post-test-helpers'
import { BrowserToolbox, type ToolboxDeps } from './toolbox'
import { TicketAuthority } from '../tickets'
import { FakeClock } from '../testing/fakes'

interface Item {
  ref: string
  role: string
  name: string
  disabled?: boolean
  submits?: boolean
}

/** A community page that behaves like a site: the Join button becomes "Joined" when it is pressed. */
class CommunityPage extends FakePage {
  items: Item[] = [
    { ref: 'e1', role: 'button', name: 'Join' },
    { ref: 'e2', role: 'input:search', name: 'Search Reddit' },
    { ref: 'e3', role: 'link', name: 'Rules' },
    { ref: 'e4', role: 'button', name: 'Joined' },
    { ref: 'e5', role: 'button', name: 'Leave' },
    { ref: 'e6', role: 'button', name: 'Follow' },
    { ref: 'e7', role: 'button', name: 'Join the conversation' },
    { ref: 'e8', role: 'link', name: 'Join Reddit' },
    { ref: 'e9', role: 'button', name: 'Join r/other' },
    { ref: 'e10', role: 'button', name: 'Create post' },
    { ref: 'e11', role: 'button', name: 'Join', submits: true },
    { ref: 'e12', role: 'button', name: 'Reply' }
  ]
  humanCheck = ''
  /** What the field holds: a search box with the community in it, as the site has it. */
  searchText = 'r/test'
  readonly clicked: string[] = []
  readonly kinds: string[] = []
  /** Runs before the snapshot is read (a test renumbers the page here). */
  beforeSnapshot: (() => void) | null = null
  beforeStep: ((step: PageStep) => void) | null = null
  /** A page that refuses the press (the mouse went down, the site answered with an error). */
  refuseClicks = false

  override async read<T>(script: string): Promise<T> {
    this.log.push(`read ${script.slice(0, 40)}`)
    if (script.includes('ppd-form-text')) return [{ ref: 'e2', text: this.searchText }] as T
    if (script.includes('agent-snapshot')) {
      this.beforeSnapshot?.()
      return { url: this.currentUrl, title: 'Community', text: 'A community', alerts: [], humanCheck: this.humanCheck, elements: this.items.map((i) => ({ ...i })) } as T
    }
    return undefined as T
  }

  override async pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult> {
    this.log.push(`pageStep ${step.do}`)
    this.steps.push({ step, hosts })
    this.beforeStep?.(step)
    this.kinds.push(step.do)
    if (step.do === 'click') {
      this.clicked.push(step.ref)
      if (this.refuseClicks) return { status: 'refused', detail: 'the page refused it' }
      const item = this.items.find((i) => i.ref === step.ref)
      if (item?.ref === 'e1') item.name = 'Joined'
    }
    return { status: 'done', detail: 'ok' }
  }
}

function setup(over: Partial<ToolboxDeps> = {}) {
  const page = new CommunityPage()
  page.currentUrl = 'https://fake.test/r/test/'
  const clock = new FakeClock()
  const session = new ControlledSession('acc', async () => page, new TicketAuthority(clock))
  const time = { now: 10_000 }
  const sleeps: number[] = []
  const reports: { status: string; reason: string }[] = []
  const toolbox = new BrowserToolbox({
    withPage: (work) => session.withAgentControl('join', work),
    hosts: ['fake.test'],
    values: {},
    sleep: async (ms) => {
      sleeps.push(ms)
      time.now += ms
    },
    say: () => undefined,
    ask: async () => 'done',
    note: () => undefined,
    report: (result) => reports.push(result),
    askWaitMs: 20,
    join: { community: 'test', destination: 'https://fake.test/r/test/', minGapMs: 2000, now: () => time.now },
    ...over
  })
  return { page, session, toolbox, time, sleeps, reports }
}

type Setup = ReturnType<typeof setup>
const look = (t: Setup) => t.toolbox.call('browser_snapshot', {})
const press = (t: Setup, ref: string) => t.toolbox.call('browser_click', { ref })

describe('isJoinControl', () => {
  const join = (name: string, role = 'button', extra: Record<string, unknown> = {}) => isJoinControl({ role, name, ...extra }, 'test')

  it.each(['Join', 'join', 'JOIN', ' Join ', 'Join community', 'Join r/test', 'join R/TEST', 'Вступить', 'Присоединиться'])('accepts a button named %j', (name) => {
    expect(join(name)).toBe(true)
  })

  it.each([
    'Joined',
    'Joined r/test',
    'Leave',
    'Leave community',
    'Follow',
    'Following',
    'Subscribe',
    'Join the conversation',
    'Join Reddit',
    'Join r/other',
    'Join r/test and r/other',
    'Join r/testing',
    'Join now',
    'Join and post',
    'Log in to join',
    'Sign up',
    'Rejoin',
    'Join​',
    '',
    '   ',
    'J'.repeat(80),
    'Join community\nLeave'
  ])('refuses a button named %j', (name) => {
    expect(join(name)).toBe(false)
  })

  it('refuses a control that is not a button, whatever it is named', () => {
    for (const role of ['link', 'input:text', 'input:search', 'textbox', 'checkbox', 'combobox', 'option', 'select', 'input:submit', 'input:image', 'input:button']) expect(join('Join', role)).toBe(false)
  })

  it('refuses a button that submits a form: a newsletter\'s "Join" is one', () => {
    expect(join('Join', 'button', { submits: true })).toBe(false)
    expect(join('Join', 'button', { submits: false })).toBe(true)
  })

  it('judges the name against the community it is asked about', () => {
    expect(isJoinControl({ role: 'button', name: 'Join r/astrology' }, 'astrology')).toBe(true)
    expect(isJoinControl({ role: 'button', name: 'Join r/astrology' }, 'test')).toBe(false)
    // a name with regular-expression marks in it is a name, not a pattern
    expect(isJoinControl({ role: 'button', name: 'Join r/a.b' }, 'a.b')).toBe(true)
    expect(isJoinControl({ role: 'button', name: 'Join r/axb' }, 'a.b')).toBe(false)
  })
})

describe('the tools of a join mission', () => {
  it('are six: looking, opening the community, the one click, waiting, asking the owner, reporting', () => {
    expect(setup().toolbox.tools.map((tool) => tool.name)).toEqual(['browser_snapshot', 'browser_navigate', 'browser_click', 'browser_scroll', 'browser_wait_for', 'ask_owner', 'report_result'])
  })

  it('let the AI turn the mouse wheel to find the Join button, which is neither a click nor the one press: it can be done again and again, before and after', async () => {
    const t = setup()
    await look(t)
    expect((await t.toolbox.call('browser_scroll', { direction: 'down' })).isError).toBeFalsy()
    expect((await t.toolbox.call('browser_scroll', { direction: 'down', amount: 'half' })).isError).toBeFalsy()
    expect(t.page.steps.map((s) => s.step)).toEqual([
      { do: 'scroll', direction: 'down', amount: 'screen' },
      { do: 'scroll', direction: 'down', amount: 'half' }
    ])
    expect(t.page.steps.every((s) => s.hosts.join() === 'fake.test')).toBe(true)
    expect((await press(t, 'e1')).text).not.toBe(JOIN_PRESSED) // the click is still the one press, taken after the scrolling
    expect(t.page.clicked).toEqual(['e1'])
    expect((await t.toolbox.call('browser_scroll', { direction: 'up' })).isError).toBeFalsy() // looking is free after the press too
    expect(t.page.clicked).toEqual(['e1'])
  })

  it('have no way to type, choose, press a key, run a script, upload, submit, keep a lesson or record a value', () => {
    const names = setup().toolbox.tools.map((tool) => tool.name)
    for (const gone of ['browser_type', 'browser_select', 'browser_press_key', 'browser_evaluate', 'browser_upload', 'browser_submit', 'remember_lesson', 'note_value']) expect(names).not.toContain(gone)
  })

  it('refuse a tool that is not in the set, even when the AI names it anyway, and touch nothing', async () => {
    const t = setup()
    await look(t)
    for (const name of ['browser_type', 'browser_select', 'browser_press_key', 'browser_evaluate', 'browser_upload', 'browser_submit', 'note_value', 'remember_lesson']) {
      const result = await t.toolbox.call(name, { ref: 'e1', value: 'x', key: 'Enter', script: 'return 1', file: 'F', submit_ref: 'e1', text_ref: 'e2', rule: 'r', label: 'l', option: 'o' })
      expect(result.isError).toBe(true)
      expect(result.text).toMatch(/no tool called/)
    }
    expect(t.page.steps).toEqual([])
  })

  it('say in the brief and in the tool\'s own words that Join is the only click', () => {
    const t = setup()
    expect(t.toolbox.instructions).toMatch(/press the Join button of one community, once/)
    expect(t.toolbox.tools.find((tool) => tool.name === 'browser_click')?.description).toMatch(/only click this mission accepts, and only once/)
    expect(joinMissionPrompt({ platform: 'Reddit', accountLabel: 'Main', community: 'test', destination: 'https://fake.test/r/test/' }, '2026-11-15')).toMatch(/Join r\/test|Join test/)
  })

  it('cannot be made a post mission as well', () => {
    expect(() => setup({ post: { authority: new TestAuthority(new TicketAuthority(new FakeClock()), { kind: 'post', title: 't', text: 'x', link: null, destination: 'https://fake.test/r/test' }), minGapMs: 0 } as never })).toThrow(/never both/)
  })
})

describe('the one click of a join mission', () => {
  it('presses the Join button, once, and the page then shows Joined', async () => {
    const t = setup()
    await look(t)
    const result = await press(t, 'e1')
    expect(result.isError).toBeFalsy()
    expect(t.page.clicked).toEqual(['e1'])
    expect(t.page.items[0]?.name).toBe('Joined')
  })

  it('is not blocked by text in a search box: this mission types nothing, so no form holds text of its making', async () => {
    const t = setup()
    t.page.searchText = 'r/test'
    await look(t)
    expect((await press(t, 'e1')).isError).toBeFalsy()
  })

  it('accepts no second click on anything, and no new page, once the button was pressed; looking is still allowed', async () => {
    const t = setup()
    await look(t)
    await press(t, 'e1')
    for (const ref of ['e1', 'e3', 'e4', 'e10']) {
      const again = await press(t, ref)
      expect(again.isError).toBe(true)
      expect(again.text).toBe(JOIN_PRESSED)
    }
    const nav = await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/about' })
    expect(nav.isError).toBe(true)
    expect(nav.text).toBe(JOIN_PRESSED)
    expect(t.page.clicked).toEqual(['e1'])
    expect((await look(t)).isError).toBeFalsy()
  })

  it('uses up its one press when the press is tried, also when the page failed it', async () => {
    const t = setup()
    t.page.refuseClicks = true
    await look(t)
    expect((await press(t, 'e1')).isError).toBe(true)
    t.page.items[0]!.name = 'Join'
    await look(t)
    expect((await press(t, 'e1')).text).toBe(JOIN_PRESSED)
  })

  it.each([
    ['a link', 'e3'],
    ['a field', 'e2'],
    ['Joined', 'e4'],
    ['Leave', 'e5'],
    ['Follow', 'e6'],
    ['Join the conversation', 'e7'],
    ['a link named Join Reddit', 'e8'],
    ['Join of another community', 'e9'],
    ['Create post', 'e10'],
    ['a Join that submits a form', 'e11'],
    ['Reply', 'e12']
  ])('refuses %s, and presses nothing', async (_what, ref) => {
    const t = setup()
    await look(t)
    const result = await press(t, ref)
    expect(result.isError).toBe(true)
    expect(result.text).toBe(JOIN_CLICK_ONLY)
    expect(t.page.clicked).toEqual([])
  })

  it('refuses a label the AI was never shown, and one that is not on the page now', async () => {
    const t = setup()
    expect((await press(t, 'e1')).text).toMatch(/was not shown to you/)
    await look(t)
    expect((await press(t, 'e99')).text).toMatch(/is not on the page now/)
    expect((await press(t, 'not a ref')).text).toMatch(/must be a label/)
    expect(t.page.clicked).toEqual([])
  })

  it('judges the control as it is now: a page that renumbers its controls cannot turn a Leave into a Join', async () => {
    const t = setup()
    await look(t)
    // the AI saw e1 as "Join"; the page now has "Leave" under that label
    t.page.items[0]!.name = 'Leave'
    const result = await press(t, 'e1')
    expect(result.text).toBe(JOIN_CLICK_ONLY)
    expect(t.page.clicked).toEqual([])
  })

  it('judges the control as it was shown: a Leave shown to the AI is not a Join because the page changed its name', async () => {
    const t = setup()
    t.page.items[0]!.name = 'Leave'
    await look(t)
    t.page.items[0]!.name = 'Join'
    const result = await press(t, 'e1')
    expect(result.text).toBe(JOIN_CLICK_ONLY)
    expect(t.page.clicked).toEqual([])
  })

  it('presses nothing on another community\'s page, on another host, or while a human check is shown', async () => {
    const t = setup()
    await look(t)
    t.page.currentUrl = 'https://fake.test/r/other/'
    expect((await press(t, 'e1')).text).toMatch(/is not the page of test/)
    t.page.currentUrl = 'https://evil.example/r/test/'
    expect((await press(t, 'e1')).text).toMatch(/is not on the platform/)
    t.page.currentUrl = 'https://fake.test/r/test/'
    t.page.humanCheck = 'a CAPTCHA'
    expect((await press(t, 'e1')).text).toMatch(/Human check on the page/)
    expect(t.page.clicked).toEqual([])
  })

  it('presses on a page of the community that is not its front page, and not on a look-alike path', async () => {
    const t = setup()
    t.page.currentUrl = 'https://fake.test/r/test/about'
    await look(t)
    expect((await press(t, 'e1')).isError).toBeFalsy()
    const u = setup()
    u.page.currentUrl = 'https://fake.test/r/testing/'
    await look(u)
    expect((await press(u, 'e1')).text).toMatch(/is not the page of test/)
  })

  it('waits between two actions, like a person', async () => {
    const t = setup()
    await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/' })
    await look(t)
    await press(t, 'e1')
    expect(t.sleeps).toContain(2000)
  })
})

describe('a page with more than one Join button', () => {
  const add = (t: Setup, ...items: Item[]): void => void t.page.items.push(...items)

  it('presses none of two bare "Join" buttons: a sidebar\'s Join for another community looks like the header\'s', async () => {
    const t = setup()
    add(t, { ref: 'e20', role: 'button', name: 'Join' })
    await look(t)
    for (const ref of ['e1', 'e20']) {
      const result = await press(t, ref)
      expect(result.isError).toBe(true)
      expect(result.text).toBe(JOIN_AMBIGUOUS('test'))
    }
    expect(t.page.clicked).toEqual([])
  })

  it('presses only the one named after the community when there is one, and not the bare ones', async () => {
    const t = setup()
    add(t, { ref: 'e20', role: 'button', name: 'Join r/test' })
    await look(t)
    expect((await press(t, 'e1')).text).toBe(JOIN_AMBIGUOUS('test'))
    expect((await press(t, 'e20')).isError).toBeFalsy()
    expect(t.page.clicked).toEqual(['e20'])
  })

  it('presses none when two are named after the community: it cannot tell which is the page\'s', async () => {
    const t = setup()
    add(t, { ref: 'e20', role: 'button', name: 'Join r/test' }, { ref: 'e21', role: 'button', name: 'Join r/test' })
    await look(t)
    for (const ref of ['e1', 'e20', 'e21']) expect((await press(t, ref)).text).toBe(JOIN_AMBIGUOUS('test'))
    expect(t.page.clicked).toEqual([])
  })

  it('does not count a Join that submits a form, or one of another community, as a second one', async () => {
    const t = setup()
    add(t, { ref: 'e20', role: 'button', name: 'Join', submits: true }, { ref: 'e21', role: 'button', name: 'Join r/other' })
    await look(t)
    expect((await press(t, 'e1')).isError).toBeFalsy()
  })

  it('looks again when the control was renamed between the look and the press, even to another Join name', async () => {
    const t = setup()
    await look(t)
    t.page.items[0]!.name = 'Join community'
    const result = await press(t, 'e1')
    expect(result.text).toBe(JOIN_CHANGED('e1'))
    expect(t.page.clicked).toEqual([])
    await look(t)
    expect((await press(t, 'e1')).isError).toBeFalsy()
  })

  it('knows a name that says the community from one that does not', () => {
    expect(joinNamesCommunity({ name: 'Join r/test' }, 'test')).toBe(true)
    expect(joinNamesCommunity({ name: ' join  R/TEST ' }, 'test')).toBe(true)
    for (const name of ['Join', 'Join community', 'Join r/testing', 'Join r/other', 'Joined r/test']) expect(joinNamesCommunity({ name }, 'test')).toBe(false)
    // a name with regular-expression marks in it is a name, not a pattern
    expect(joinNamesCommunity({ name: 'Join r/a.b' }, 'a.b')).toBe(true)
    expect(joinNamesCommunity({ name: 'Join r/axb' }, 'a.b')).toBe(false)
  })
})

describe('where a join mission goes', () => {
  it('opens the community\'s own pages and nothing else, on its host only', async () => {
    const t = setup()
    for (const url of ['https://fake.test/r/test/', 'https://fake.test/r/test/about', 'https://fake.test/r/test/?sort=new']) {
      expect((await t.toolbox.call('browser_navigate', { url })).isError).toBeFalsy()
    }
    for (const url of ['https://fake.test/r/other/', 'https://fake.test/logout', 'https://fake.test/settings', 'https://fake.test/r/testing/', 'https://evil.example/r/test/', 'javascript:alert(1)', 'file:///etc/passwd']) {
      const result = await t.toolbox.call('browser_navigate', { url })
      expect(result.isError, url).toBe(true)
    }
  })

  it('stops at once when the owner presses Stop', async () => {
    const controller = new AbortController()
    const t = setup({ signal: controller.signal })
    await look(t)
    controller.abort()
    const result = await press(t, 'e1')
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/stopped/)
    expect(t.page.clicked).toEqual([])
  })

  it('records what the AI says at the end, as a note and nothing more', async () => {
    const t = setup()
    await t.toolbox.call('report_result', { status: 'done', reason: 'Joined.' })
    expect(t.reports).toEqual([{ status: 'done', reason: 'Joined.' }])
  })
})

describe('the owner\'s windows share the session with a join mission (DEC-038)', () => {
  it('presses nothing once the owner used a sign-in or sign-out page: the account that joins is the one that was signed in when the mission began', async () => {
    let moved = false
    const t = setup({ join: { community: 'test', destination: 'https://fake.test/r/test/', minGapMs: 2000, sessionMoved: () => moved } })
    await look(t)
    moved = true
    const result = await press(t, 'e1')
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/sign-in or sign-out page was used/)
    expect(t.page.clicked).toEqual([])
    expect(t.toolbox.joinPressed).toBe(false)
  })

  it('presses as before while the owner has only opened windows on other pages', async () => {
    const t = setup({ join: { community: 'test', destination: 'https://fake.test/r/test/', minGapMs: 2000, sessionMoved: () => false } })
    await look(t)
    expect((await press(t, 'e1')).isError).toBeUndefined()
    expect(t.page.clicked).toEqual(['e1'])
  })
})
