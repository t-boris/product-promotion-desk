import { describe, expect, it } from 'vitest'
import { TakeoverError, type BrowserPage } from '../ports'
import { FakePage } from '../testing/fakes'
import { BrowserToolbox, OWNER_HAS_BROWSER, type ToolboxDeps } from './toolbox'
import type { SnapshotElement } from './snapshot'

class ScriptedPage extends FakePage {
  snapshots: unknown[] = []
  scripts: string[] = []
  waitAnswers: boolean[] = [true]
  override async read<T>(script: string): Promise<T> {
    if (script.includes('agent-snapshot')) return (this.snapshots.length > 1 ? this.snapshots.shift() : this.snapshots[0]) as T
    this.scripts.push(script)
    if (script.includes('innerText.toLowerCase().includes')) return (this.waitAnswers.length > 1 ? this.waitAnswers.shift() : this.waitAnswers[0]) as T
    return { title: 'Facebook' } as T
  }
}

const browserPage = (raw: ScriptedPage): BrowserPage => ({
  goto: (url) => raw.goto(url),
  url: () => raw.url(),
  read: <T>(script: string) => raw.read<T>(script),
  waitForSelector: (selector) => raw.waitForSelector(selector),
  fill: async () => undefined,
  click: async () => undefined,
  uploadFile: async () => undefined,
  signIn: (form) => raw.signIn(form),
  pageStep: (step, hosts) => raw.pageStep(step, hosts)
})

const form = (over: Partial<{ url: string; elements: SnapshotElement[]; alerts: string[]; humanCheck: string; text: string }> = {}) => ({
  url: 'https://www.facebook.com/r.php',
  title: 'Facebook',
  text: 'Create a new account',
  alerts: [],
  humanCheck: '',
  elements: [
    { ref: 'e1', role: 'input:text', name: 'First name' },
    { ref: 'e2', role: 'input:password', name: 'Password' },
    { ref: 'e3', role: 'button', name: 'Sign Up' },
    { ref: 'e4', role: 'combobox', name: 'Month' },
    { ref: 'e5', role: 'option', name: 'March' }
  ] as SnapshotElement[],
  ...over
})

function setup(over: Partial<ToolboxDeps> = {}) {
  const raw = new ScriptedPage()
  raw.snapshots = [form()]
  const said: string[] = []
  const notes: [string, string][] = []
  const reports: { status: string; reason: string }[] = []
  const asked: string[] = []
  const answers: ((text: string) => void)[] = []
  const toolbox = new BrowserToolbox({
    withPage: (work) => work(browserPage(raw)),
    hosts: ['facebook.com'],
    values: {
      EMAIL: { value: 'natal+fb@example.com', describe: 'the e-mail address', secret: false },
      PASSWORD: { value: 'S3cret-Pass!', describe: 'the password', secret: true }
    },
    sleep: async () => undefined,
    say: (line) => said.push(line),
    ask: (question) => {
      asked.push(question)
      return new Promise<string>((resolve) => answers.push(resolve))
    },
    note: (label, value) => notes.push([label, value]),
    report: (result) => reports.push(result),
    askWaitMs: 20,
    ...over
  })
  return { raw, toolbox, said, notes, reports, asked, answers }
}

describe('toolbox: looking', () => {
  it('lists the elements with their labels and fences the page text', async () => {
    const t = setup()
    const result = await t.toolbox.call('browser_snapshot', {})
    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('Address: https://www.facebook.com/r.php')
    expect(result.text).toContain('[e1] input:text "First name"')
    expect(result.text).toContain('<page>')
    expect(result.text).toContain('Create a new account')
  })

  it('shows a human check and the site\'s messages, and warns when the page left the platform', async () => {
    const t = setup()
    t.raw.snapshots = [form({ url: 'https://example.org/x', humanCheck: 'a visible check frame (google.com)', alerts: ['Choose a stronger password'] })]
    const text = (await t.toolbox.call('browser_snapshot', {})).text
    expect(text).toContain('not on the platform')
    expect(text).toContain('Human check on the page: a visible check frame (google.com)')
    expect(text).toContain('- Choose a stronger password')
  })

  it('answers that the page shows nothing when it stays empty', async () => {
    const t = setup()
    t.raw.snapshots = [form({ elements: [] })]
    expect(await t.toolbox.call('browser_snapshot', {})).toMatchObject({ isError: true })
  })
})

describe('toolbox: typing', () => {
  it('types the real password into a password field and never shows it', async () => {
    const t = setup()
    await t.toolbox.call('browser_snapshot', {})
    const result = await t.toolbox.call('browser_type', { ref: 'e2', value: '{{PASSWORD}}' })
    expect(result.isError).toBeUndefined()
    expect(t.raw.steps.at(-1)?.step).toEqual({ do: 'type', ref: 'e2', text: 'S3cret-Pass!' })
    expect(t.said).toContain('Typed the password into "Password"')
    expect(JSON.stringify([result, t.said, t.notes])).not.toContain('S3cret-Pass!')
    expect(t.notes).toEqual([])
  })

  it('refuses a secret in a text field, an unknown name, a name inside text, and a secret into an element it has not seen', async () => {
    const t = setup()
    await t.toolbox.call('browser_snapshot', {})
    expect(await t.toolbox.call('browser_type', { ref: 'e1', value: '{{PASSWORD}}' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('browser_type', { ref: 'e1', value: '{{SECRET}}' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('browser_type', { ref: 'e1', value: 'my {{EMAIL}}' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('browser_type', { ref: 'e9', value: '{{PASSWORD}}' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('browser_type', { ref: 'not-a-ref', value: 'x' })).toMatchObject({ isError: true })
    expect(t.raw.steps).toEqual([])
  })

  it('types a plain value, records it for the owner and can press Enter afterwards', async () => {
    const t = setup()
    await t.toolbox.call('browser_snapshot', {})
    const result = await t.toolbox.call('browser_type', { ref: 'e1', value: 'Natalia', submit: true })
    expect(result.isError).toBeUndefined()
    expect(t.raw.steps.map((s) => s.step)).toEqual([{ do: 'type', ref: 'e1', text: 'Natalia' }, { do: 'key', key: 'Enter' }])
    expect(t.notes).toEqual([['First name', 'Natalia']])
    expect(t.raw.steps.every((s) => s.hosts.join() === 'facebook.com')).toBe(true)
  })

  it('types the e-mail by name', async () => {
    const t = setup()
    await t.toolbox.call('browser_snapshot', {})
    await t.toolbox.call('browser_type', { ref: 'e1', value: '{{EMAIL}}' })
    expect(t.raw.steps.at(-1)?.step).toEqual({ do: 'type', ref: 'e1', text: 'natal+fb@example.com' })
    expect(t.said).toContain('Typed the e-mail address into "First name"')
  })
})

describe('toolbox: acting', () => {
  it('clicks and says what the page shows afterwards', async () => {
    const t = setup()
    t.raw.snapshots = [form(), form({ url: 'https://www.facebook.com/', alerts: ['Welcome'] })]
    await t.toolbox.call('browser_snapshot', {})
    const result = await t.toolbox.call('browser_click', { ref: 'e3' })
    expect(t.raw.steps.at(-1)?.step).toEqual({ do: 'click', ref: 'e3' })
    expect(result.text).toContain('Clicked "Sign Up"')
    expect(result.text).toContain('- Welcome')
  })

  it('reports a step the page could not take, and a page outside the platform, as errors', async () => {
    const t = setup()
    await t.toolbox.call('browser_snapshot', {})
    t.raw.stepAnswers = [{ status: 'not_found', detail: 'the element is gone' }]
    expect(await t.toolbox.call('browser_click', { ref: 'e3' })).toMatchObject({ isError: true, text: expect.stringContaining('the element is gone') })
    t.raw.stepAnswers = [{ status: 'wrong_host', detail: 'x' }]
    expect(await t.toolbox.call('browser_click', { ref: 'e3' })).toMatchObject({ isError: true, text: expect.stringContaining('not on the platform') })
  })

  it('chooses an option in a drop-down opened by a click and records the choice', async () => {
    const t = setup()
    await t.toolbox.call('browser_snapshot', {})
    await t.toolbox.call('browser_click', { ref: 'e4' })
    await t.toolbox.call('browser_click', { ref: 'e5' })
    expect(t.notes).toEqual([['Month', 'March']])
    await t.toolbox.call('browser_select', { ref: 'e4', option: 'April' })
    expect(t.raw.steps.at(-1)?.step).toEqual({ do: 'select', ref: 'e4', text: 'April' })
    expect(t.notes.at(-1)).toEqual(['Month', 'April'])
  })

  it('opens only addresses on the platform', async () => {
    const t = setup()
    expect(await t.toolbox.call('browser_navigate', { url: 'https://evil.example/login' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('browser_navigate', { url: 'file:///etc/passwd' })).toMatchObject({ isError: true })
    expect((await t.toolbox.call('browser_navigate', { url: 'https://www.facebook.com/r.php' })).isError).toBeUndefined()
    expect(t.raw.log).toContain('goto https://www.facebook.com/r.php')
  })

  it('presses only Enter, Tab and Escape', async () => {
    const t = setup()
    expect(await t.toolbox.call('browser_press_key', { key: 'F5' })).toMatchObject({ isError: true })
    expect((await t.toolbox.call('browser_press_key', { key: 'Tab' })).isError).toBeUndefined()
  })

  it('runs a script as an async function body and returns JSON, cut when long', async () => {
    const t = setup()
    const result = await t.toolbox.call('browser_evaluate', { script: 'return document.title' })
    expect(result.text).toBe('{"title":"Facebook"}')
    expect(t.raw.scripts.at(-1)).toContain('return document.title')
  })

  it('waits for a text on the page', async () => {
    const t = setup()
    t.raw.waitAnswers = [false, false, true]
    expect((await t.toolbox.call('browser_wait_for', { text: 'Welcome' })).text).toContain('shows "Welcome"')
    t.raw.waitAnswers = [false]
    expect(await t.toolbox.call('browser_wait_for', { text: 'Welcome', ms: 600 })).toMatchObject({ isError: true })
  })
})

describe('toolbox: the person', () => {
  it('asks once, tells the AI to call again while the person has not answered, then returns the answer', async () => {
    const t = setup()
    const first = await t.toolbox.call('ask_owner', { question: 'Please solve the CAPTCHA' })
    expect(first.text).toContain('not answered yet')
    const second = t.toolbox.call('ask_owner', { question: 'Please solve the CAPTCHA' })
    t.answers[0]?.('done')
    expect((await second).text).toBe('The owner answered: done')
    expect(t.asked).toEqual(['Please solve the CAPTCHA'])
    expect(t.said).toContain('The AI asks you: Please solve the CAPTCHA')
  })

  it('tells the AI to stop when the question is dropped because the owner stopped the task', async () => {
    let rejectAsk: (e: Error) => void = () => undefined
    const t = setup({ ask: () => new Promise<string>((_resolve, reject) => (rejectAsk = reject)) })
    const waiting = t.toolbox.call('ask_owner', { question: 'Code?' })
    rejectAsk(new Error('stopped'))
    expect(await waiting).toMatchObject({ isError: true, text: expect.stringContaining('stopped') })
  })

  it('records noted values and the reported result, and validates both', async () => {
    const t = setup()
    expect(await t.toolbox.call('note_value', { label: 'Birth date', value: '14 March 1988' })).toMatchObject({ text: 'Recorded.' })
    expect(await t.toolbox.call('note_value', { label: 'Password', value: '{{PASSWORD}}' })).toMatchObject({ isError: true })
    expect(await t.toolbox.call('report_result', { status: 'maybe', reason: 'x' })).toMatchObject({ isError: true })
    await t.toolbox.call('report_result', { status: 'done', reason: 'The account exists' })
    expect(t.notes).toEqual([['Birth date', '14 March 1988']])
    expect(t.reports).toEqual([{ status: 'done', reason: 'The account exists' }])
  })
})

describe('toolbox: limits and control', () => {
  it('tells the AI to wait with ask_owner when the person holds the browser', async () => {
    const t = setup({
      withPage: async () => {
        throw new TakeoverError()
      }
    })
    const result = await t.toolbox.call('browser_snapshot', {})
    expect(result).toEqual({ text: OWNER_HAS_BROWSER, isError: true })
  })

  it('stops after the allowed number of calls and after Stop', async () => {
    const t = setup({ maxCalls: 2 })
    await t.toolbox.call('browser_snapshot', {})
    await t.toolbox.call('browser_snapshot', {})
    expect(await t.toolbox.call('browser_snapshot', {})).toMatchObject({ isError: true, text: expect.stringContaining('report_result') })

    const abort = new AbortController()
    const stopped = setup({ signal: abort.signal })
    abort.abort()
    expect(await stopped.toolbox.call('browser_snapshot', {})).toMatchObject({ isError: true, text: expect.stringContaining('stopped') })
  })

  it('refuses an unknown tool', async () => {
    expect(await setup().toolbox.call('shell', {})).toMatchObject({ isError: true })
  })
})
