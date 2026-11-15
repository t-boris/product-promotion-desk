// An account that signs in through another account (DEC-027): Threads through its Instagram account. It is made only with that account,
// has no credentials of its own, and is signed in by a mission that uses the Instagram login, with the password bound to Instagram's hosts.

import { describe, expect, it } from 'vitest'
import type { McpToolHost } from '../mcp/protocol'
import type { NormalizedTarget } from '../ports'
import { FakeConnector } from '../testing/fake-connector'
import { passwordKey } from '../vault'
import { makeReadyWorld, type World } from './test-helpers'

/** Stands in for the universal connector: the named platforms (Instagram, Threads) are served by it. */
class FakeUniversal extends FakeConnector {
  readonly label = 'Other website'
  constructor() {
    super({ id: 'universal', platform: 'web' })
  }
  override matches(input: string): boolean {
    return /^https?:\/\//i.test(input.trim())
  }
  override normalizeTarget(input: string): NormalizedTarget {
    const url = new URL(input.trim())
    return { target: `${url.hostname}${url.pathname}`.replace(/\/+$/, ''), url: url.toString() }
  }
  override loginUrl(): string {
    return ''
  }
}

const PASSWORD = 'Insta-Pa$$w0rd-123'
const LOGIN = 'selena.builds'
const world = () => makeReadyWorld({ extra: [new FakeUniversal()] })

async function instagram(w: World, label = 'Brand on Instagram') {
  return w.call('accounts.create', { productId: w.productId, platform: 'instagram', label })
}
async function threads(w: World, signsInVia: string | null | undefined, label = 'Brand on Threads') {
  return w.call('accounts.create', { productId: w.productId, platform: 'threads', label, signsInVia })
}

describe('making an account that signs in through another', () => {
  it('needs the Instagram account first, and says so', async () => {
    const w = await world()
    await expect(threads(w, undefined)).rejects.toMatchObject({ code: 'needs_login_account', message: expect.stringContaining('Add the Instagram account first') })
    await expect(threads(w, null)).rejects.toMatchObject({ code: 'needs_login_account' })
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
  })

  it('is made with an Instagram account, and keeps the link', async () => {
    const w = await world()
    const ig = await instagram(w)
    const th = await threads(w, ig.id)
    expect(th).toMatchObject({ platform: 'threads', signsInVia: ig.id, browser: 'internal' })
    expect((await w.call('accounts.list', undefined)).find((a) => a.id === th.id)?.signsInVia).toBe(ig.id)
  })

  it('refuses an account that is not an Instagram account, or is not there', async () => {
    const w = await world()
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'threads', label: 'T', signsInVia: w.account.id })).toBe('invalid_input')
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'threads', label: 'T', signsInVia: 'nope' })).toBe('not_found')
  })

  it('does not let a platform with its own credentials sign in through another account', async () => {
    const w = await world()
    const ig = await instagram(w)
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Second', signsInVia: ig.id })).toBe('invalid_input')
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'fake', label: 'Fake', signsInVia: ig.id })).toBe('invalid_input')
  })

  it('does not take an account of another person (profile)', async () => {
    const w = await world()
    const ig = await instagram(w)
    const person = await w.call('profiles.create', { label: 'Selena', productId: w.productId, accountIds: [ig.id] })
    const other = await w.call('profiles.create', { label: 'Someone else', productId: w.productId, accountIds: [] })
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'threads', label: 'T', signsInVia: ig.id, profileId: other.id })).toBe('invalid_input')
    expect(await w.call('accounts.create', { productId: w.productId, platform: 'threads', label: 'T', signsInVia: ig.id, profileId: person.id })).toMatchObject({ signsInVia: ig.id, profileId: person.id })
  })

  it('can be moved to another Instagram account, and only for a platform that signs in through one', async () => {
    const w = await world()
    const first = await instagram(w, 'First')
    const second = await instagram(w, 'Second')
    const th = await threads(w, first.id)
    expect((await w.call('accounts.setSignInVia', { accountId: th.id, viaAccountId: second.id })).signsInVia).toBe(second.id)
    expect(await w.refusal('accounts.setSignInVia', { accountId: th.id, viaAccountId: w.account.id })).toBe('invalid_input')
    expect(await w.refusal('accounts.setSignInVia', { accountId: first.id, viaAccountId: second.id })).toBe('invalid_input')
  })

  it('is not moved to another Instagram account while the AI works on it (the mission has taken the password of the first)', async () => {
    const w = await world()
    const first = await instagram(w, 'First')
    const second = await instagram(w, 'Second')
    const th = await threads(w, first.id)
    w.core.services.agent = { questions: () => [], working: (id) => id === th.id }
    expect(await w.refusal('accounts.setSignInVia', { accountId: th.id, viaAccountId: second.id })).toBe('agent_running')
    expect((await w.call('accounts.list', undefined)).find((a) => a.id === th.id)?.signsInVia).toBe(first.id)
  })

  it('keeps the Instagram account until nobody signs in through it', async () => {
    const w = await world()
    const ig = await instagram(w)
    const th = await threads(w, ig.id)
    await expect(w.call('accounts.remove', { id: ig.id })).rejects.toMatchObject({ code: 'in_use', message: expect.stringContaining('Brand on Threads signs in through Brand on Instagram') })
    await w.call('accounts.remove', { id: th.id })
    await w.call('accounts.remove', { id: ig.id })
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
  })
})

describe('no password of its own', () => {
  it('keeps no password for it: the vault refuses to save one', async () => {
    const w = await world()
    const th = await threads(w, (await instagram(w)).id)
    expect(await w.refusal('vault.savePassword', { accountId: th.id, loginName: 'x', password: PASSWORD })).toBe('signs_in_through_another')
    expect(w.t.secrets.touches).toBe(0)
  })

  it('never tries a saved password on it when it is found signed out (an old account that had one)', async () => {
    const universal = new FakeUniversal()
    const w = await makeReadyWorld({ extra: [universal] })
    const th = await threads(w, (await instagram(w)).id)
    await w.core.secrets.set(passwordKey(th.id), PASSWORD)
    w.core.db.prepare('UPDATE accounts SET login_name = ? WHERE id = ?').run(LOGIN, th.id)
    universal.login = { loggedIn: false, identity: null, captcha: false }
    await w.call('accounts.checkLogin', { accountId: th.id })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(w.t.browser.page(th.id).signIns).toEqual([])
  })

  it('refuses the sign-in with a saved password, and says how to sign in', async () => {
    const w = await world()
    const th = await threads(w, (await instagram(w)).id)
    await expect(w.call('accounts.signIn', { accountId: th.id })).rejects.toMatchObject({ code: 'signs_in_through_another', message: expect.stringContaining('signs in through Brand on Instagram') })
    expect(w.t.browser.page(th.id).signIns).toEqual([])
  })
})

describe('the sign-in mission', () => {
  async function ready(): Promise<{ w: World; ig: Awaited<ReturnType<typeof instagram>>; th: Awaited<ReturnType<typeof threads>> }> {
    const w = await world()
    const ig = await instagram(w)
    await w.call('vault.savePassword', { accountId: ig.id, loginName: LOGIN, password: PASSWORD })
    const th = await threads(w, ig.id)
    return { w, ig, th }
  }
  const state = (w: World, id: string) => w.call('agent.state', { accountId: id })
  async function finished(w: World, id: string) {
    for (let i = 0; i < 400; i++) {
      const run = await state(w, id)
      if (run && run.status !== 'running') return run
      await new Promise((resolve) => setTimeout(resolve))
    }
    throw new Error('the run did not finish')
  }

  it('needs what the Instagram account has to give: a login and a saved password', async () => {
    const w = await world()
    const ig = await instagram(w)
    const th = await threads(w, ig.id)
    expect(await w.refusal('agent.start', { accountId: th.id, kind: 'signin' })).toBe('no_email')
    await w.call('accounts.setEmail', { accountId: ig.id, email: 'selena@example.com' })
    expect(await w.refusal('agent.start', { accountId: th.id, kind: 'signin' })).toBe('no_password')
    expect(await w.call('agent.canStart', { accountId: th.id, kind: 'signin' })).toMatchObject({ ready: false, reason: expect.stringContaining('Brand on Instagram') })
    await w.call('vault.savePassword', { accountId: ig.id, loginName: 'selena@example.com', password: PASSWORD })
    expect(await w.call('agent.canStart', { accountId: th.id, kind: 'signin' })).toEqual({ ready: true, reason: null })
  })

  it('says to choose the Instagram account, not to use a password, for a Threads account that has none chosen yet (made before the link existed)', async () => {
    const w = await world()
    const ig = await instagram(w)
    const th = await threads(w, ig.id)
    w.core.db.prepare('UPDATE accounts SET via_account_id = NULL WHERE id = ?').run(th.id)
    expect(await w.refusal('agent.start', { accountId: th.id, kind: 'signin' })).toBe('no_via')
    expect(await w.call('agent.canStart', { accountId: th.id, kind: 'signin' })).toMatchObject({ ready: false, reason: expect.stringContaining('Choose it in the account first') })
  })

  it('is refused for an account that has credentials of its own', async () => {
    const { w, ig } = await ready()
    expect(await w.refusal('agent.start', { accountId: ig.id, kind: 'signin' })).toBe('invalid_input')
  })

  it('opens the Threads sign-in page, works on Threads and Instagram, and never shows the AI the password', async () => {
    const { w, th } = await ready()
    w.t.browser.page(th.id).responses = [
      {
        match: 'agent-snapshot',
        value: {
          url: 'https://www.instagram.com/accounts/login/',
          title: 'Log in',
          text: 'Log in',
          alerts: [],
          humanCheck: '',
          elements: [
            { ref: 'e1', role: 'input:text', name: 'Username' },
            { ref: 'e2', role: 'input:password', name: 'Password' },
            { ref: 'e3', role: 'button', name: 'Log in' }
          ]
        }
      }
    ]
    w.t.engine.on('agent.signin', async () => {
      const tools: McpToolHost = w.t.bridge.host
      await tools.call('browser_snapshot', {})
      await tools.call('browser_type', { ref: 'e1', value: '{{LOGIN}}' })
      await tools.call('browser_type', { ref: 'e2', value: '{{PASSWORD}}' })
      await tools.call('report_result', { status: 'done', reason: 'Signed in.' })
      return 'Done.'
    })
    await w.call('agent.start', { accountId: th.id, kind: 'signin' })
    await finished(w, th.id)

    const call = w.t.engine.calls.find((c) => c.label === 'agent.signin')
    expect(call?.prompt).toContain('https://www.threads.net/login')
    expect(call?.prompt).toContain('Continue with Instagram')
    expect(call?.prompt).toContain('{{PASSWORD}}')
    expect(JSON.stringify(w.t.engine.calls)).not.toContain(PASSWORD)

    const steps = w.t.browser.page(th.id).steps
    const login = steps.find((s) => s.step.do === 'type' && s.step.ref === 'e1')
    const secret = steps.find((s) => s.step.do === 'type' && s.step.ref === 'e2')
    expect(login?.hosts).toEqual(expect.arrayContaining(['threads.net', 'threads.com', 'instagram.com']))
    // The password is typed only on Instagram's pages: the step is given Instagram's hosts alone, so a Threads page is refused.
    expect(secret?.hosts).toEqual(['instagram.com'])
    expect(secret?.step).toMatchObject({ do: 'type', text: PASSWORD })
    expect(login?.step).toMatchObject({ do: 'type', text: LOGIN })
  })

  it('tells the AI, and types nothing, when the page is not an Instagram page', async () => {
    const { w, th } = await ready()
    const page = w.t.browser.page(th.id)
    page.responses = [{ match: 'agent-snapshot', value: { url: 'https://www.threads.net/login', title: 'Threads', text: '', alerts: [], humanCheck: '', elements: [{ ref: 'e2', role: 'input:password', name: 'Password' }] } }]
    page.stepAnswers = [{ status: 'wrong_host', detail: 'The page is on www.threads.net, which is not a page of this platform, so nothing was done.' }]
    let answer = ''
    w.t.engine.on('agent.signin', async () => {
      const tools: McpToolHost = w.t.bridge.host
      await tools.call('browser_snapshot', {})
      const result = await tools.call('browser_type', { ref: 'e2', value: '{{PASSWORD}}' })
      answer = result.text
      return 'Stopped.'
    })
    await w.call('agent.start', { accountId: th.id, kind: 'signin' })
    await finished(w, th.id)
    expect(answer).toContain('typed only on pages of instagram.com')
    expect(page.steps[0].hosts).toEqual(['instagram.com'])
  })

  it('shows the account\'s own browser while it works, and works the account\'s own page', async () => {
    const { w, th } = await ready()
    w.t.engine.on('agent.signin', async () => 'Done.')
    await w.call('agent.start', { accountId: th.id, kind: 'signin' })
    await finished(w, th.id)
    expect(w.t.browser.agentShown).toContain(th.id)
  })
})
