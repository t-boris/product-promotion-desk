import { describe, expect, it } from 'vitest'
import { AiError, TakeoverError, type BrowserPage } from '../ports'
import { FakeEngine, FakePage } from '../testing/fakes'
import { runBrowserAgent, type BrowserTask } from './agent'
import type { SnapshotElement } from './snapshot'

class ScriptedPage extends FakePage {
  /** What the page reads as, round after round; the last one repeats. */
  snapshots: unknown[] = []
  reads = 0
  override async read<T>(script: string): Promise<T> {
    if (script.includes('agent-snapshot')) {
      this.reads += 1
      return (this.snapshots.length > 1 ? this.snapshots.shift() : this.snapshots[0]) as T
    }
    return super.read<T>(script)
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

const form = (over: Partial<{ url: string; elements: SnapshotElement[]; alerts: string[]; humanCheck: string; title: string }> = {}) => ({
  url: 'https://www.facebook.com/r.php',
  title: 'Facebook',
  text: 'Get started',
  alerts: [],
  humanCheck: '',
  elements: [
    { ref: 'e1', role: 'input:text', name: 'First name' },
    { ref: 'e2', role: 'input:password', name: 'Password' },
    { ref: 'e3', role: 'button', name: 'Submit' }
  ] as SnapshotElement[],
  ...over
})
const welcome = () => form({ url: 'https://www.facebook.com/', title: 'Welcome', elements: [{ ref: 'e9', role: 'button', name: 'Home' }] })

const answer = (status: string, steps: unknown[] = [], reason = 'ok'): string => JSON.stringify({ status, reason, steps })

function setup(task: Partial<BrowserTask> = {}) {
  const raw = new ScriptedPage()
  const engine = new FakeEngine('claude')
  const said: string[] = []
  const answers: string[] = []
  engine.on('agent.round', () => answers.shift() ?? answer('needs_owner', [], 'out of scripted answers'))
  engine.on('agent.round.repair', () => answers.shift() ?? answer('needs_owner', [], 'out of scripted answers'))
  const fullTask: BrowserTask = {
    goal: 'Create the account',
    facts: ['Account: Natal Mystic'],
    startUrl: 'https://www.facebook.com/r.php',
    hosts: ['facebook.com'],
    values: {
      EMAIL: { value: 'natal+fb@example.com', describe: 'the e-mail address of the account', secret: false },
      PASSWORD: { value: 'S3cret-Pass!', describe: 'the password of the account', secret: true }
    },
    ...task
  }
  const run = (signal?: AbortSignal) => runBrowserAgent({ page: browserPage(raw), engine, sleep: async () => undefined, today: '2026-11-08', signal, say: (line) => said.push(line) }, fullTask)
  return { raw, engine, said, answers, run }
}

describe('browser agent: a registration, round by round', () => {
  it('types what the engine names, types the password from the vault, ends the round at a click, and finishes on "done"', async () => {
    const t = setup()
    t.raw.snapshots = [form(), welcome()]
    t.answers.push(answer('continue', [{ do: 'type', ref: 'e1', value: 'Natal' }, { do: 'type', ref: 'e2', value: '{{PASSWORD}}' }, { do: 'click', ref: 'e3' }], 'Filling the form'), answer('done', [], 'The account was created'))
    const result = await t.run()
    expect(result).toEqual({ outcome: 'done', reason: 'The account was created', address: 'www.facebook.com/', typed: [{ label: 'First name', value: 'Natal' }] })
    expect(t.raw.steps.map((s) => s.step)).toEqual([
      { do: 'type', ref: 'e1', text: 'Natal' },
      { do: 'type', ref: 'e2', text: 'S3cret-Pass!' },
      { do: 'click', ref: 'e3' }
    ])
    expect(t.raw.steps.every((s) => s.hosts.join() === 'facebook.com')).toBe(true)
    expect(t.raw.log[0]).toBe('goto https://www.facebook.com/r.php')
  })

  it('records what the AI chose in a drop-down, by select or by clicking the option of the drop-down it opened', async () => {
    const t = setup()
    const withLists = form({
      elements: [
        { ref: 'e1', role: 'combobox', name: 'Select Month' },
        { ref: 'e2', role: 'combobox', name: 'Select Year' },
        { ref: 'e3', role: 'button', name: 'Submit' }
      ]
    })
    const opened = form({ title: 'Opened', elements: [{ ref: 'e1', role: 'combobox', name: 'Select Month' }, { ref: 'e8', role: 'option', name: 'March' }] })
    t.raw.snapshots = [withLists, opened, welcome()]
    t.answers.push(
      answer('continue', [{ do: 'select', ref: 'e2', value: '1990' }, { do: 'click', ref: 'e1' }]),
      answer('continue', [{ do: 'click', ref: 'e8' }]),
      answer('done')
    )
    const result = await t.run()
    expect(result.typed).toEqual([
      { label: 'Select Year', value: '1990' },
      { label: 'Select Month', value: 'March' }
    ])
  })

  it('never shows the password to the engine and never says it to the owner', async () => {
    const t = setup()
    t.raw.snapshots = [form(), welcome()]
    t.answers.push(answer('continue', [{ do: 'type', ref: 'e2', value: '{{PASSWORD}}' }]), answer('done'))
    await t.run()
    expect(JSON.stringify(t.engine.calls)).not.toContain('S3cret-Pass!')
    expect(JSON.stringify(t.engine.calls)).toContain('{{PASSWORD}}')
    expect(t.said.join('\n')).not.toContain('S3cret-Pass!')
    expect(t.said.join('\n')).toContain('Typed the password into "Password"')
  })

  it('carries out only what comes before a click: the page may change after it', async () => {
    const t = setup()
    t.raw.snapshots = [form(), welcome()]
    t.answers.push(answer('continue', [{ do: 'click', ref: 'e3' }, { do: 'type', ref: 'e1', value: 'Late' }]), answer('done'))
    await t.run()
    expect(t.raw.steps.map((s) => s.step.do)).toEqual(['click'])
  })

  it('gives a step the page refused back to the engine and goes on from a fresh look', async () => {
    const t = setup()
    t.raw.snapshots = [form(), form({ title: 'Facebook again' }), welcome()]
    t.raw.stepAnswers = [{ status: 'not_found', detail: 'There is no element e1 on the page now.' }, { status: 'done', detail: 'ok' }]
    t.answers.push(answer('continue', [{ do: 'type', ref: 'e1', value: 'Natal' }]), answer('done'))
    await t.run()
    expect(JSON.stringify(t.engine.calls[1])).toContain('There is no element e1 on the page now.')
  })
})

describe('browser agent: what the engine may not do', () => {
  it('asks once more when a step names an element that is not on the page, and says what was wrong', async () => {
    const t = setup()
    t.raw.snapshots = [form(), welcome()]
    t.answers.push(answer('continue', [{ do: 'click', ref: 'e77' }]), answer('continue', [{ do: 'click', ref: 'e3' }]), answer('done'))
    await t.run()
    expect(t.engine.calls[1].label).toBe('agent.round.repair')
    expect(t.engine.calls[1].prompt).toContain('there is no element "e77"')
    expect(t.raw.steps.map((s) => s.step)).toEqual([{ do: 'click', ref: 'e3' }])
  })

  it('stops with a readable failure when the engine cannot give a usable answer twice', async () => {
    const t = setup()
    t.raw.snapshots = [form()]
    t.answers.push('not json at all', 'still not json')
    const result = await t.run()
    expect(result.outcome).toBe('failed')
    expect(result.reason).toMatch(/could not be used, twice/)
    expect(t.raw.steps).toEqual([])
  })

  it('refuses the password in a text field and an unknown {{NAME}}', async () => {
    const t = setup()
    t.raw.snapshots = [form()]
    t.answers.push(answer('continue', [{ do: 'type', ref: 'e1', value: '{{PASSWORD}}' }]), answer('continue', [{ do: 'type', ref: 'e1', value: '{{SECRET}}' }]))
    const result = await t.run()
    expect(result.outcome).toBe('failed')
    expect(t.engine.calls[1].prompt).toContain('goes only into a password field')
    expect(t.raw.steps).toEqual([])
  })
})

describe('browser agent: when a person is needed or the page does not react', () => {
  it('hands over at a human check without asking the engine', async () => {
    const t = setup()
    t.raw.snapshots = [form({ humanCheck: 'a visible check frame (google.com)' })]
    const result = await t.run()
    expect(result).toMatchObject({ outcome: 'needs_owner', address: 'www.facebook.com/r.php' })
    expect(result.reason).toMatch(/human check/)
    expect(t.engine.calls).toEqual([])
  })

  it('hands over when the page left the platform', async () => {
    const t = setup()
    t.raw.snapshots = [form({ url: 'https://evil.example.net/login' })]
    const result = await t.run()
    expect(result.outcome).toBe('needs_owner')
    expect(result.reason).toMatch(/left the platform/)
    expect(t.engine.calls).toEqual([])
  })

  it('hands over when the engine says a code or a phone is needed', async () => {
    const t = setup()
    t.raw.snapshots = [form()]
    t.answers.push(answer('needs_owner', [], 'The site sent a code to the phone'))
    expect(await t.run()).toMatchObject({ outcome: 'needs_owner', reason: 'The site sent a code to the phone' })
  })

  it('stops after two rounds in which the page did not change', async () => {
    const t = setup()
    t.raw.snapshots = [form()]
    t.answers.push(answer('continue', [{ do: 'click', ref: 'e3' }]), answer('continue', [{ do: 'click', ref: 'e3' }]), answer('continue', [{ do: 'click', ref: 'e3' }]), answer('continue', [{ do: 'click', ref: 'e3' }]))
    const result = await t.run()
    expect(result.outcome).toBe('needs_owner')
    expect(result.reason).toMatch(/did not react to my last two tries/)
    expect(t.engine.calls).toHaveLength(2) // two tries, and the page looked the same after both
    expect(JSON.stringify(t.engine.calls[1])).toContain('The page did not change after my last answer.')
  })

  it('hands over when the page stays empty', async () => {
    const t = setup()
    t.raw.snapshots = [form({ elements: [] })]
    const result = await t.run()
    expect(result.reason).toMatch(/shows nothing the AI can use/)
    expect(t.raw.reads).toBe(3)
  })

  it('hands over when the rounds run out', async () => {
    const t = setup({ maxRounds: 2 })
    t.raw.snapshots = [form(), form({ title: 'B' }), form({ title: 'C' })]
    t.answers.push(answer('continue', [{ do: 'click', ref: 'e3' }]), answer('continue', [{ do: 'click', ref: 'e3' }]))
    expect((await t.run()).reason).toMatch(/used all 2 rounds/)
  })

  it('stops at once when the owner takes the browser or the task is cancelled', async () => {
    const taken = setup()
    taken.raw.read = async () => {
      throw new TakeoverError()
    }
    await expect(taken.run()).rejects.toBeInstanceOf(TakeoverError)

    const cancelled = setup()
    cancelled.raw.snapshots = [form()]
    const controller = new AbortController()
    controller.abort()
    await expect(cancelled.run(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' })
    expect(cancelled.engine.calls).toEqual([])
  })

  it('does not carry out what the engine answered after the owner pressed Stop', async () => {
    const t = setup()
    t.raw.snapshots = [form()]
    const controller = new AbortController()
    t.engine.on('agent.round', () => {
      controller.abort() // Stop pressed while the engine was thinking
      return answer('continue', [{ do: 'click', ref: 'e3' }])
    })
    await expect(t.run(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' })
    expect(t.raw.steps).toEqual([])
  })

  it('reports an engine that failed', async () => {
    const t = setup()
    t.raw.snapshots = [form()]
    t.engine.on('agent.round', () => {
      throw new AiError('failed', 'engine crashed')
    })
    expect(await t.run()).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('engine crashed') })
  })
})
