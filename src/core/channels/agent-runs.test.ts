// The browser agent on an account (DEC-017): what a run needs, what it never shows the AI, how it ends.

import { describe, expect, it } from 'vitest'
import type { AgentRun } from '../../shared/types'
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
const answer = (status: string, steps: unknown[] = [], reason = 'ok') => JSON.stringify({ status, reason, steps })

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

/** The run goes on in the background: wait until it is no longer running. */
async function finished(w: World): Promise<AgentRun> {
  for (let i = 0; i < 400; i++) {
    const run = await state(w)
    if (run && run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('the run did not finish')
}

describe('what a run needs before it starts', () => {
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

  it('needs an engine that cannot use tools on this computer, and says to choose Claude Code', async () => {
    const w = await ready()
    w.t.engine.toolFree = false
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('engine_not_tool_free')
    expect(page(w).log).toEqual([])
    w.t.engine.toolFree = true
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('no_engine')
  })

  it('needs an engine that is installed and ready', async () => {
    const w = await ready()
    w.t.engine.installed = false
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('engine_unavailable')
  })

  it('has no state before a run, and refuses an account that does not exist', async () => {
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
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringMatching(/Choose Claude Code|e-mail/) })
    w.t.engine.toolFree = false
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringContaining('Choose Claude Code in Settings') })
    w.t.engine.toolFree = true
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringContaining('e-mail') })
    await w.call('accounts.setEmail', { accountId: w.account.id, email: EMAIL })
    expect(await can(w)).toMatchObject({ ready: false, reason: expect.stringContaining('saved for') })
    w.t.engine.installed = false
    expect(await can(w)).toMatchObject({ ready: false })
    w.core.settings.updateApp({ engineId: null })
    expect(await can(w)).toEqual({ ready: false, reason: 'No AI engine is selected. Choose Claude Code in Settings.' })
  })

  it('names the engine that cannot be used, so the owner sees why their choice does not work', async () => {
    const w = await ready()
    w.t.engine.toolFree = false
    const answer = await can(w)
    expect(answer.reason).toContain(`${w.t.engine.label} can use tools on this computer`)
  })
})

describe('a run', () => {
  it('registers: the AI fills the form, the password never reaches it, and the site\'s own login check says it worked', async () => {
    const w = await ready()
    const answers = [
      answer('continue', [{ do: 'type', ref: 'e1', value: '{{EMAIL}}' }, { do: 'type', ref: 'e2', value: '{{PASSWORD}}' }, { do: 'click', ref: 'e3' }], 'Filling the form'),
      answer('done', [], 'The account is created')
    ]
    w.t.engine.on('agent.round', () => {
      const next = answers.shift() as string
      if (answers.length === 0) page(w).responses = [{ match: 'agent-snapshot', value: home }]
      return next
    })
    const started = await start(w)
    expect(started).toMatchObject({ status: 'running', kind: 'signup', accountId: w.account.id })

    const run = await finished(w)
    expect(run.status).toBe('done')
    expect(run.summary).toBe('The account was created and signed in as brand_account.')
    expect(run.finishedAt).not.toBeNull()
    expect(page(w).log[0]).toBe('goto https://fake.test/login')
    expect(page(w).steps.map((s) => s.step)).toEqual([
      { do: 'type', ref: 'e1', text: EMAIL },
      { do: 'type', ref: 'e2', text: PASSWORD },
      { do: 'click', ref: 'e3' }
    ])
    expect(page(w).steps.every((s) => s.hosts.join() === 'fake.test')).toBe(true)
    expect(w.fake.calls).toContain('checkLogin')

    // The password is typed and nowhere else: not in what the AI saw, not in what the owner sees, not in the log.
    const everything = JSON.stringify([w.t.engine.calls, run, w.core.db.prepare('SELECT * FROM log_events').all(), w.core.db.prepare('SELECT * FROM accounts').all()])
    expect(everything).not.toContain(PASSWORD)
    expect(JSON.stringify(w.t.engine.calls)).toContain('{{PASSWORD}}')
    expect(run.lines).toContain('Typed the password into "Password"')
  })

  it('tells the AI who the account is, which product it is for and what the site must not be given', async () => {
    const w = await ready()
    await w.call('accounts.setRole', { accountId: w.account.id, role: { name: 'astrologer', voice: 'warm and curious' } })
    w.t.engine.on('agent.round', () => answer('needs_owner', [], 'stop'))
    await start(w)
    await finished(w)
    const prompt = w.t.engine.calls[0].prompt
    expect(prompt).toContain('Natal Mystic Reddit')
    expect(prompt).toContain('astrologer')
    expect(prompt).toContain('warm and curious')
    expect(prompt).toContain('Natal Mystic')
    expect(prompt).toContain('{{EMAIL}}')
    expect(prompt).not.toContain(EMAIL)
    expect(prompt).not.toContain(PASSWORD)
  })

  it('does not call it done when the AI says so but the site does not show a signed-in account', async () => {
    const w = await ready()
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    w.t.engine.on('agent.round', () => answer('done', [], 'I think it is created'))
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('needs_owner')
    expect(run.summary).toMatch(/does not show a signed-in account yet/)
  })

  it('hands over what the AI says only a person can do', async () => {
    const w = await ready()
    w.t.engine.on('agent.round', () => answer('needs_owner', [], 'The site sent a code to the e-mail'))
    await start(w)
    const run = await finished(w)
    expect(run).toMatchObject({ status: 'needs_owner', summary: 'The site sent a code to the e-mail' })
    expect(w.fake.calls).not.toContain('checkLogin')
  })

  it('can be stopped, and what the AI does afterwards is not shown', async () => {
    const w = await ready()
    let release = (): void => undefined
    w.t.engine.on('agent.round', () => new Promise<string>((resolve) => (release = () => resolve(answer('continue', [{ do: 'click', ref: 'e3' }])))))
    await start(w)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const stopped = await w.call('agent.stop', { accountId: w.account.id })
    expect(stopped).toMatchObject({ status: 'stopped' })
    expect(stopped?.summary).toMatch(/You stopped the AI/)
    release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await state(w)).toMatchObject({ status: 'stopped' })
    expect(page(w).steps).toEqual([])
  })

  it('does not start a second run for the same account while one is going', async () => {
    const w = await ready()
    w.t.engine.on('agent.round', () => new Promise<string>(() => undefined))
    await start(w)
    expect(await w.refusal('agent.start', { accountId: w.account.id, kind: 'signup' })).toBe('agent_running')
  })

  it('stops for the owner when the owner holds the browser', async () => {
    const w = await ready()
    w.t.browser.session(w.account).takeControl()
    w.t.engine.on('agent.round', () => answer('done'))
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('needs_owner')
    expect(run.summary).toMatch(/in your hands/)
    expect(w.t.engine.calls).toEqual([])
  })

  it('reports an engine that failed, without any secret', async () => {
    const w = await ready()
    w.t.engine.on('agent.round', () => {
      throw new Error(`engine crashed while holding ${PASSWORD}`)
    })
    await start(w)
    const run = await finished(w)
    expect(run.status).toBe('failed')
  })
})
