// The AI agent on an account (DEC-018): what a mission needs, what it never shows the AI, how it asks the owner, how it ends.

import { describe, expect, it } from 'vitest'
import type { AgentRun } from '../../shared/types'
import { AiError } from '../ports'
import type { McpToolHost } from '../mcp/protocol'
import { OWNER_HAS_BROWSER } from '../browser-agent/toolbox'
import { makeReadyWorld, type World } from './test-helpers'

const PASSWORD = 'S3cret-Pa$$w0rd!'
const EMAIL = 'natal.mystic@example.com'

const form = {
  url: 'https://fake.test/signup',
  title: 'Sign up',
  text: 'Create your account',
  alerts: [],
  humanCheck: '',
  elements: [
    { ref: 'e1', role: 'input:text', name: 'E-mail' },
    { ref: 'e2', role: 'input:password', name: 'Password' },
    { ref: 'e3', role: 'button', name: 'Sign up' }
  ]
}
const home = { ...form, url: 'https://fake.test/home', title: 'Home', elements: [{ ref: 'e9', role: 'button', name: 'Profile' }] }

/** An account with an e-mail and a saved password, and a page that shows the form. */
async function ready(): Promise<World> {
  const w = await makeReadyWorld()
  await w.call('accounts.setEmail', { accountId: w.account.id, email: EMAIL })
  await w.call('vault.savePassword', { accountId: w.account.id, loginName: EMAIL, password: PASSWORD })
  w.t.browser.page(w.account.id).responses = [{ match: 'agent-snapshot', value: form }]
  return w
}
const page = (w: World) => w.t.browser.page(w.account.id)
const start = (w: World) => w.call('agent.start', { accountId: w.account.id, kind: 'signup' })
const state = (w: World) => w.call('agent.state', { accountId: w.account.id })
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** What the AI does: a script that uses the tools through the host the application offered, as the engine would. */
const asTheAI = (w: World, work: (tools: McpToolHost, call: (name: string, args?: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>) => Promise<string | void>): void => {
  w.t.engine.on('agent.signup', async () => {
    const tools = w.t.bridge.host
    return (await work(tools, (name, args = {}) => tools.call(name, args))) ?? 'Done.'
  })
}

/** The mission goes on in the background: wait until it is no longer running. */
async function finished(w: World): Promise<AgentRun> {
  for (let i = 0; i < 400; i++) {
    const run = await state(w)
    if (run && run.status !== 'running') return run
    await tick()
  }
  throw new Error('the run did not finish')
}

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await condition()) return
    await tick()
  }
  throw new Error('the condition never held')
}

describe('what a mission needs before it starts', () => {
  it('needs the e-mail of the account', async () => {
    const w = await makeReadyWorld()
    await w.call('vault.savePassword', { accountId: w.account.id, loginName: 'x', password: PASSWORD })
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('no_email')
  })

  it('needs a saved password', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.setEmail', { accountId: w.account.id, email: EMAIL })
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('no_password')
  })

  it('needs an engine that can work the browser, and says which ones can', async () => {
    const w = await ready()
    w.t.engine.supportsAgent = false
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('engine_cannot_drive')
    expect(page(w).log).toEqual([])
    w.t.engine.supportsAgent = true
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('no_engine')
  })

  it('does not need a tool-free engine any more: Codex can do it too', async () => {
    const w = await ready()
    w.t.engine.toolFree = false
    expect(await w.call('agent.canStart', { accountId: w.account.id, kind: 'signup' })).toEqual({ ready: true, reason: null })
  })

  it('needs an engine that is installed and ready', async () => {
    const w = await ready()
    w.t.engine.installed = false
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('engine_unavailable')
  })

  it('has no state before a mission, and refuses an account that does not exist', async () => {
    const w = await ready()
    expect(await state(w)).toBeNull()
    expect(await w.refusal('agent.start', { accountId: 'nope', kind: 'signup' })).toBe('not_found')
  })
})

describe('what the screen is told before the click', () => {
  const can = (w: World) => w.call('agent.canStart', { accountId: w.account.id, kind: 'signup' })

  it('says ready when everything is there, and does nothing else', async () => {
    const w = await ready()
    expect(await can(w)).toEqual({ ready: true, reason: null })
    expect(w.t.engine.calls).toEqual([])
    expect(page(w).log).toEqual([])
    expect(await state(w)).toBeNull()
  })

  it('says what is missing, in words, one thing at a time', async () => {
    const w = await makeReadyWorld()
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringContaining('e-mail') })
    await w.call('accounts.setEmail', { accountId: w.account.id, email: EMAIL })
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringContaining('saved for') })
    await w.call('vault.savePassword', { accountId: w.account.id, loginName: EMAIL, password: PASSWORD })
    w.t.engine.installed = false
    expect(await can(w)).toMatchObject({ ready: false })
    w.t.engine.installed = true
    w.t.engine.supportsAgent = false
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringContaining('cannot work the browser') })
    w.core.settings.updateApp({ engineId: null })
    expect(await can(w)).toEqual({ ready: false, reason: 'No AI engine is selected. Choose Claude Code or Codex in Settings.' })
  })
})

describe('a mission', () => {
  it('registers: the AI works the browser itself, the password never reaches it, and the site\'s own login check says it worked', async () => {
    const w = await ready()
    asTheAI(w, async (tools, call) => {
      expect(tools.tools.map((t) => t.name)).toContain('ask_owner')
      await call('browser_navigate', { url: 'https://fake.test/signup' })
      await call('browser_snapshot')
      await call('browser_type', { ref: 'e1', value: '{{EMAIL}}' })
      await call('browser_type', { ref: 'e2', value: '{{PASSWORD}}' })
      page(w).responses = [{ match: 'agent-snapshot', value: home }]
      await call('browser_click', { ref: 'e3' })
      await call('note_value', { label: 'Birth date', value: '14 March 1988' })
      await call('report_result', { status: 'done', reason: 'The account is created' })
      return 'The account is created.'
    })
    const started = await start(w)
    expect(started).toMatchObject({ status: 'running', kind: 'signup', accountId: w.account.id, question: null })
    expect(w.t.browser.agentShown).toEqual([w.account.id])

    const run = await finished(w)
    expect(run.status).toBe('done')
    expect(run.summary).toBe('The account was created and signed in as brand_account.')
    expect(run.finishedAt).not.toBeNull()
    expect(page(w).log[0]).toBe('goto https://fake.test/signup')
    expect(page(w).steps.map((s) => s.step)).toEqual([
      { do: 'type', ref: 'e1', text: EMAIL },
      { do: 'type', ref: 'e2', text: PASSWORD },
      { do: 'click', ref: 'e3' }
    ])
    expect(page(w).steps.every((s) => s.hosts.join() === 'fake.test')).toBe(true)
    expect(w.fake.calls).toContain('checkLogin')
    expect(run.typed).toEqual(expect.arrayContaining([{ label: 'Birth date', value: '14 March 1988' }]))
    expect(run.lines).toContain('Typed the password into "Password"')
    expect(run.lines.some((line) => line.startsWith('The AI: The account is created.'))).toBe(true)
    expect(w.t.bridge.closed).toBe(1)

    // The password is typed and nowhere else: not in what the AI was told, not in what the owner sees, not in the log.
    const everything = JSON.stringify([w.t.engine.calls, run, w.core.db.prepare('SELECT * FROM log_events').all(), w.core.db.prepare('SELECT * FROM accounts').all()])
    expect(everything).not.toContain(PASSWORD)
    expect(JSON.stringify(w.t.engine.calls)).toContain('{{PASSWORD}}')
  })

  it('gives the engine a goal and the MCP server, not a list of steps', async () => {
    const w = await ready()
    await w.call('accounts.setRole', { accountId: w.account.id, role: { name: 'astrologer', voice: 'warm and curious' } })
    asTheAI(w, async (_tools, call) => void (await call('report_result', { status: 'needs_owner', reason: 'stop' })))
    await start(w)
    await finished(w)
    const task = w.t.engine.calls[0]
    expect(task.agent).toEqual({ server: 'ppd', launch: { command: '/fake/ppd', args: ['/fake/shim.js'], env: { PPD_MCP_TOKEN: 'fake-token' } } })
    expect(task.timeoutMs).toBe(30 * 60 * 1000)
    expect(task.prompt).toContain('GOAL: Create a new account')
    expect(task.prompt).toContain('Natal Mystic Reddit')
    expect(task.prompt).toContain('astrologer')
    expect(task.prompt).toContain('warm and curious')
    expect(task.prompt).toContain('Natal Mystic')
    expect(task.prompt).toContain('{{EMAIL}}')
    expect(task.prompt).toContain('browser_navigate to https://fake.test/login')
    expect(task.prompt).not.toContain(EMAIL)
    expect(task.prompt).not.toContain(PASSWORD)
  })

  it('does not call it done when the AI says so but the site does not show a signed-in account', async () => {
    const w = await ready()
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    asTheAI(w, async (_tools, call) => void (await call('report_result', { status: 'done', reason: 'I think it is created' })))
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('needs_owner')
    expect(run.summary).toMatch(/does not show a signed-in account yet/)
  })

  it('hands over what the AI says only a person can do', async () => {
    const w = await ready()
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    asTheAI(w, async (_tools, call) => void (await call('report_result', { status: 'needs_owner', reason: 'The site sent a code to the e-mail' })))
    await start(w)
    expect(await finished(w)).toMatchObject({ status: 'needs_owner', summary: 'The site sent a code to the e-mail' })
  })

  it('trusts the site over the AI when the AI gave up but the account is signed in', async () => {
    const w = await ready()
    asTheAI(w, async (_tools, call) => void (await call('report_result', { status: 'failed', reason: 'I could not tell' })))
    await start(w)
    expect(await finished(w)).toMatchObject({ status: 'done' })
  })

  it('does not take an engine that ended without a word for success', async () => {
    const w = await ready()
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    asTheAI(w, async () => 'Hello.')
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('needs_owner')
    expect(run.summary).toMatch(/ended without saying how it went/)
  })
})

describe('the AI asks the owner', () => {
  it('shows the question as a pop-up, waits, and passes the answer back; the owner may use the browser meanwhile', async () => {
    const w = await ready()
    let answeredWith = ''
    asTheAI(w, async (_tools, call) => {
      const reply = await call('ask_owner', { question: 'Please solve the CAPTCHA, then say done.' })
      answeredWith = reply.text
      await call('report_result', { status: 'done', reason: 'ok' })
    })
    await start(w)
    await until(async () => (await state(w))?.question !== null)

    const asks = await w.call('agent.questions', undefined)
    expect(asks).toEqual([expect.objectContaining({ accountId: w.account.id, accountLabel: w.account.label, text: 'Please solve the CAPTCHA, then say done.' })])
    expect(await state(w)).toMatchObject({ status: 'running', summary: 'The AI asks you: Please solve the CAPTCHA, then say done.' })

    // While the question is open the owner takes the browser, solves the CAPTCHA and gives it back.
    w.t.browser.session(w.account).takeControl()
    w.t.browser.session(w.account).releaseControl()
    const after = await w.call('agent.answer', { accountId: w.account.id, answer: 'done' })
    expect(after?.question).toBeNull()
    const run = await finished(w)
    expect(answeredWith).toBe('The owner answered: done')
    expect(run.status).toBe('done')
    expect(await w.call('agent.questions', undefined)).toEqual([])
  })

  it('puts the open question on the attention list (so a notification reaches the owner), and takes it off when answered', async () => {
    const w = await ready()
    asTheAI(w, async (_tools, call) => void (await call('ask_owner', { question: 'Enter the code from the e-mail' })))
    await start(w)
    await until(async () => (await state(w))?.question !== null)
    const items = await w.call('attention.list', undefined)
    const item = items.find((i) => i.id === `agent-question:${w.account.id}`)
    expect(item).toMatchObject({ kind: 'question', refType: 'account', refId: w.account.id, detail: 'Enter the code from the e-mail' })
    expect(item?.title).toContain(w.account.label)
    await w.call('agent.answer', { accountId: w.account.id, answer: 'done' })
    await finished(w)
    expect((await w.call('attention.list', undefined)).some((i) => i.id.startsWith('agent-question:'))).toBe(false)
  })

  it('brings the browser the AI works in to the front on request, and only while the AI works', async () => {
    const w = await ready()
    asTheAI(w, async (_tools, call) => void (await call('ask_owner', { question: 'Solve the CAPTCHA' })))
    expect(await w.call('agent.showBrowser', { accountId: w.account.id })).toEqual({ shown: false })
    await start(w)
    await until(async () => (await state(w))?.question !== null)
    expect(await w.call('agent.showBrowser', { accountId: w.account.id })).toEqual({ shown: true })
    expect(w.t.browser.agentFocused).toEqual([w.account.id])
    await w.call('agent.stop', { accountId: w.account.id })
    expect(await w.call('agent.showBrowser', { accountId: w.account.id })).toEqual({ shown: false })
  })

  it('tells the AI to wait with ask_owner when the owner has the browser, and lets it work again when they are done', async () => {
    const w = await ready()
    const seen: string[] = []
    asTheAI(w, async (_tools, call) => {
      w.t.browser.session(w.account).takeControl()
      seen.push((await call('browser_snapshot')).text)
      w.t.browser.session(w.account).releaseControl()
      seen.push((await call('browser_snapshot')).text)
      await call('report_result', { status: 'done', reason: 'ok' })
    })
    await start(w)
    await finished(w)
    expect(seen[0]).toBe(OWNER_HAS_BROWSER)
    expect(seen[1]).toContain('Address: https://fake.test/signup')
  })

  it('stops the waiting AI when the owner presses Stop', async () => {
    const w = await ready()
    let reply: { text: string; isError?: boolean } = { text: '' }
    asTheAI(w, async (_tools, call) => {
      reply = await call('ask_owner', { question: 'Code?' })
    })
    await start(w)
    await until(async () => (await state(w))?.question !== null)
    const stopped = await w.call('agent.stop', { accountId: w.account.id })
    expect(stopped).toMatchObject({ status: 'stopped', question: null })
    expect(stopped?.summary).toMatch(/You stopped the AI/)
    await until(() => reply.text !== '')
    expect(reply.isError).toBe(true)
    expect(await w.call('agent.questions', undefined)).toEqual([])
  })
})

describe('stopping and failing', () => {
  it('can be stopped, and what the AI does afterwards is not shown or done', async () => {
    const w = await ready()
    let late: { text: string; isError?: boolean } | null = null
    let release = (): void => undefined
    asTheAI(w, async (_tools, call) => {
      await new Promise<void>((resolve) => (release = resolve))
      late = await call('browser_click', { ref: 'e3' })
    })
    await start(w)
    await tick(5)
    const stopped = await w.call('agent.stop', { accountId: w.account.id })
    expect(stopped).toMatchObject({ status: 'stopped' })
    release()
    await tick(10)
    expect(await state(w)).toMatchObject({ status: 'stopped' })
    expect(late).toMatchObject({ isError: true, text: expect.stringContaining('stopped') })
    expect(page(w).steps).toEqual([])
  })

  it('does not start a second mission for the same account while one is going', async () => {
    const w = await ready()
    w.t.engine.on('agent.signup', () => new Promise<string>(() => undefined))
    await start(w)
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('agent_running')
  })

  it('hands over to the owner when the owner holds the browser at the end', async () => {
    const w = await ready()
    asTheAI(w, async (_tools, call) => {
      await call('report_result', { status: 'done', reason: 'ok' })
      w.t.browser.session(w.account).takeControl()
    })
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('needs_owner')
    expect(run.summary).toMatch(/in your hands/)
  })

  it('reports an engine that failed, without any secret', async () => {
    const w = await ready()
    w.t.engine.on('agent.signup', () => {
      throw new Error(`engine crashed while holding ${PASSWORD}`)
    })
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('failed')
    expect(w.t.bridge.closed).toBe(1)
  })

  it('stops a mission that runs out of time and hands it to the owner', async () => {
    const w = await ready()
    w.t.engine.on('agent.signup', () => {
      throw new AiError('timeout', 'did not finish in time')
    })
    await start(w)
    expect(await finished(w)).toMatchObject({ status: 'needs_owner', summary: expect.stringContaining('half an hour') })
  })
})
