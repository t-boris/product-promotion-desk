import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import type { Account } from '../../shared/types'
import { FakeConnector } from '../testing/fake-connector'
import { makeReadyWorld, makeWorld, OtherConnector, OverlapProbe } from './test-helpers'

describe('accounts.create', () => {
  it('gives every account its own persistent browser partition', async () => {
    const w = makeWorld()
    const accounts = await Promise.all([w.addAccount('One'), w.addAccount('Two'), w.addAccount('Three')])
    const partitions = accounts.map((a) => a.partition)
    expect(new Set(partitions).size).toBe(3)
    expect(partitions.every((p) => /^persist:ppd-account-[0-9a-f-]{36}$/.test(p))).toBe(true)
    expect(accounts.every((a) => a.status === 'login_required' && a.identity === null)).toBe(true)
    expect(await w.call('accounts.list', undefined)).toHaveLength(3)
  })

  it('accepts only platforms that a connector exists for, and sensible names', async () => {
    const w = makeWorld()
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'myspace', label: 'Old' })).toBe('invalid_input')
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'fake', label: '   ' })).toBe('invalid_input')
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'fake', label: 'x'.repeat(81) })).toBe('invalid_input')
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'FAKE', label: '  Brand   account ' })
    expect(account).toMatchObject({ platform: 'fake', label: 'Brand account' })
  })

  it('announces the change so the UI and the attention list refresh', async () => {
    const w = makeWorld()
    await w.addAccount()
    expect(w.changes).toEqual(expect.arrayContaining(['accounts', 'attention']))
  })
})

describe('login hand-off (REQ-002: the person types passwords on the site)', () => {
  it('opens the account browser at the platform sign-in page and gives the person control', async () => {
    const w = await makeReadyWorld()
    const { tabId } = await w.call('accounts.openBrowser', { accountId: w.account.id })
    expect(tabId).toBeTruthy()
    expect(w.t.browser.opened).toEqual([{ accountId: w.account.id, url: 'https://fake.test/login' }])
    expect(w.t.browser.session(w.account).control().holder).toBe('user')
  })

  it('opens a given address, adding https for bare hosts', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.openBrowser', { accountId: w.account.id, url: 'fake.test/settings' })
    expect(w.t.browser.opened[0].url).toBe('https://fake.test/settings')
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://fake.test/', 'https://me:hunter2@fake.test/'])('refuses to open %s', async (url) => {
    const w = await makeReadyWorld()
    expect(await w.refusal('accounts.openBrowser', { accountId: w.account.id, url })).toBe('invalid_input')
    expect(w.t.browser.opened).toEqual([])
    expect(w.t.browser.session(w.account).control().holder).toBe('none')
  })

  it('falls back to a channel address when the platform has no standard sign-in page', async () => {
    class NoLoginPage extends FakeConnector {
      override loginUrl(): string {
        return ''
      }
    }
    const w = await makeReadyWorld({ fake: new NoLoginPage() })
    expect(await w.refusal('accounts.openBrowser', { accountId: w.account.id })).toBe('invalid_input')
    await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
    await w.call('accounts.openBrowser', { accountId: w.account.id })
    expect(w.t.browser.opened[0].url).toBe('https://fake.test/r/astrology')
  })

  it('lets the person take and give back control, and automation yields at once', async () => {
    const w = await makeReadyWorld()
    const session = w.t.browser.session(w.account)
    await w.call('accounts.takeControl', { accountId: w.account.id })
    expect(session.control().holder).toBe('user')
    await expect(session.withAgentControl('monitor', async () => 1)).rejects.toMatchObject({ name: 'TakeoverError' })
    await w.call('accounts.releaseControl', { accountId: w.account.id })
    await expect(session.withAgentControl('monitor', async () => 1)).resolves.toBe(1)
  })

  describe('while the account window is open', () => {
    /** The Electron service tells whether the account window is open; the test double is given the same method. */
    const withWindow = (w: Awaited<ReturnType<typeof makeReadyWorld>>, open: { value: boolean }): void => {
      Object.assign(w.t.browser, { hasUserWindow: () => open.value })
    }

    it('refuses to hand control to the agent: the window and its toolbar would still show user control', async () => {
      const w = await makeReadyWorld()
      const open = { value: true }
      withWindow(w, open)
      await w.call('accounts.openBrowser', { accountId: w.account.id })
      const session = w.t.browser.session(w.account)
      expect(session.control().holder).toBe('user')
      const error = await w.call('accounts.releaseControl', { accountId: w.account.id }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ code: 'user_window_open', message: 'Close the account window or press "Give control back to the app" in it first.' })
      expect(session.control().holder).toBe('user')
      await expect(session.withAgentControl('monitor', async () => 1)).rejects.toMatchObject({ name: 'TakeoverError' })
    })

    it('releases once the window is closed', async () => {
      const w = await makeReadyWorld()
      const open = { value: true }
      withWindow(w, open)
      await w.call('accounts.openBrowser', { accountId: w.account.id })
      open.value = false
      await w.call('accounts.releaseControl', { accountId: w.account.id })
      expect(w.t.browser.session(w.account).control().holder).toBe('none')
    })
  })

  it('reports an unknown account clearly', async () => {
    const w = makeWorld()
    expect(await w.refusal('accounts.openBrowser', { accountId: 'nope' })).toBe('not_found')
    expect(await w.refusal('accounts.takeControl', { accountId: 'nope' })).toBe('not_found')
    expect(await w.refusal('accounts.checkLogin', { accountId: 'nope' })).toBe('not_found')
  })
})

describe('accounts.checkLogin', () => {
  it('records a confirmed identity when signed in', async () => {
    const w = await makeReadyWorld()
    w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
    const updated = await w.call('accounts.checkLogin', { accountId: w.account.id })
    expect(updated).toMatchObject({ status: 'ready', identity: 'natal_bot' })
    expect(w.fake.calls).toEqual(['checkLogin'])
  })

  it('maps "not signed in" and CAPTCHA to the account status and announces both for the attention list', async () => {
    const w = await makeReadyWorld()
    w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    w.changes.length = 0

    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    expect(await w.call('accounts.checkLogin', { accountId: w.account.id })).toMatchObject({ status: 'login_required', identity: null })
    expect(w.changes).toEqual(expect.arrayContaining(['accounts', 'attention']))

    w.changes.length = 0
    w.fake.login = { loggedIn: false, identity: null, captcha: true }
    expect(await w.call('accounts.checkLogin', { accountId: w.account.id })).toMatchObject({ status: 'captcha', identity: null })
    expect(w.changes).toEqual(expect.arrayContaining(['accounts', 'attention']))
  })

  it('does not trust an identity from a check that found no sign-in', async () => {
    const w = await makeReadyWorld()
    w.fake.login = { loggedIn: false, identity: 'stale_name', captcha: false }
    expect((await w.call('accounts.checkLogin', { accountId: w.account.id })).identity).toBeNull()
  })

  describe('when a different account is signed in than the one confirmed before', () => {
    const CHANGED = 'The signed-in account changed; review before sending'

    async function twoAccountsWithChannels() {
      const w = await makeReadyWorld()
      const other = await w.addAccount('Other')
      const mine = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
      const second = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/tarot' })
      const elsewhere = await w.call('channels.connect', { productId: w.productId, accountId: other.id, target: 'r/astrology' })
      w.core.db.prepare("UPDATE channels SET status = 'active', status_detail = '' WHERE id IN (?, ?, ?)").run(mine.id, second.id, elsewhere.id)
      w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
      await w.call('accounts.checkLogin', { accountId: w.account.id })
      return { w, ids: [mine.id, second.id], elsewhereId: elsewhere.id }
    }

    it('stops every channel of the account for review and announces it', async () => {
      const { w, ids, elsewhereId } = await twoAccountsWithChannels()
      w.changes.length = 0
      w.fake.login = { loggedIn: true, identity: 'someone_else', captcha: false }
      expect(await w.call('accounts.checkLogin', { accountId: w.account.id })).toMatchObject({ status: 'ready', identity: 'someone_else' })
      for (const id of ids) expect(w.core.repos.channel(id)).toMatchObject({ status: 'needs_user', statusDetail: CHANGED })
      expect(w.core.repos.channel(elsewhereId)).toMatchObject({ status: 'active', statusDetail: '' }) // another account is not affected
      expect(w.changes).toEqual(expect.arrayContaining(['channels', 'accounts', 'attention']))
    })

    it('leaves the channels alone when the same account is confirmed again', async () => {
      const { w, ids } = await twoAccountsWithChannels()
      await w.call('accounts.checkLogin', { accountId: w.account.id })
      for (const id of ids) expect(w.core.repos.channel(id)).toMatchObject({ status: 'active', statusDetail: '' })
    })

    it('does not raise an alarm the first time an identity is learned', async () => {
      const w = await makeReadyWorld()
      const channel = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
      w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
      await w.call('accounts.checkLogin', { accountId: w.account.id })
      expect(w.core.repos.channel(channel.id).status).toBe('setup')
    })
  })

  it('hands connectors only the ticket verifier during a sign-in check, so they cannot mint tickets', async () => {
    let seen: Record<string, unknown> | null = null
    class Spy extends FakeConnector {
      override async checkLogin(ctx: Parameters<FakeConnector['checkLogin']>[0]) {
        seen = ctx.tickets as unknown as Record<string, unknown>
        return super.checkLogin(ctx)
      }
    }
    const w = await makeReadyWorld({ fake: new Spy() })
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    expect(seen).not.toBeNull()
    expect(Object.keys(seen as unknown as object)).toEqual(['assertValid'])
    expect('issue' in (seen as unknown as object)).toBe(false)
  })

  it('refuses while the person holds the browser, without changing the account', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.takeControl', { accountId: w.account.id })
    expect(await w.refusal('accounts.checkLogin', { accountId: w.account.id })).toBe('browser_busy')
    expect((await w.call('accounts.list', undefined))[0].status).toBe('login_required')
  })

  it('reports a failing check without changing the account', async () => {
    class Broken extends FakeConnector {
      override async checkLogin(): Promise<never> {
        throw new Error('timeout loading the page')
      }
    }
    const w = await makeReadyWorld({ fake: new Broken() })
    try {
      await w.call('accounts.checkLogin', { accountId: w.account.id })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ code: 'login_check_failed' })
      expect((error as ApiError).message).toContain('timeout loading the page')
    }
    expect((await w.call('accounts.list', undefined))[0].status).toBe('login_required')
  })

  it('asks for a channel first when the platform has no standard sign-in page', async () => {
    class NoLoginPage extends FakeConnector {
      override loginUrl(): string {
        return ''
      }
    }
    const w = await makeReadyWorld({ fake: new NoLoginPage() })
    expect(await w.refusal('accounts.checkLogin', { accountId: w.account.id })).toBe('invalid_input')
  })
})

describe('accounts.remove', () => {
  it('removes an unused account and erases its stored browser session', async () => {
    const w = await makeReadyWorld()
    const wiped: Account[] = []
    Object.assign(w.t.browser, { forgetAccount: async (a: Account) => void wiped.push(a) })
    await w.call('accounts.remove', { id: w.account.id })
    expect(await w.call('accounts.list', undefined)).toEqual([])
    expect(wiped.map((a) => a.id)).toEqual([w.account.id])
  })

  it('refuses while a channel uses the account', async () => {
    const w = await makeReadyWorld()
    await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
    expect(await w.refusal('accounts.remove', { id: w.account.id })).toBe('in_use')
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
  })

  it('keeps the account when its session cannot be erased, so the person can retry', async () => {
    const w = await makeReadyWorld()
    Object.assign(w.t.browser, {
      forgetAccount: async () => {
        throw new Error('disk busy')
      }
    })
    expect(await w.refusal('accounts.remove', { id: w.account.id })).toBe('session_wipe_failed')
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
  })
})

describe('platform and shared accounts', () => {
  it('serializes channels that share one account through one browser session', async () => {
    const probe = new OverlapProbe()
    const w = await makeReadyWorld({ fake: probe })
    const second = w.addProduct('Second product')
    const a = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
    const b = await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot', reuseAccount: true })
    await Promise.all([w.call('channels.assess', { channelId: a.id }), w.call('channels.assess', { channelId: b.id })])
    expect(probe.maxActive).toBe(1)
    expect(probe.order).toHaveLength(4)
    expect(probe.order[0].startsWith('start')).toBe(true)
    expect(probe.order[1].startsWith('end')).toBe(true)
    expect(w.t.browser.sessions.size).toBe(1)
  })

  it('keeps accounts of different platforms apart', async () => {
    const w = makeWorld({ extra: [new OtherConnector()] })
    const other = await w.call('accounts.create', { productId: w.productId, platform: 'other', label: 'Other site' })
    const fakeAccount = await w.addAccount()
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: other.id, target: 'r/astrology' })).toBe('platform_mismatch')
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: fakeAccount.id, target: 'https://other.test/forum' })).toBe('platform_mismatch')
    const channel = await w.call('channels.connect', { productId: w.productId, accountId: other.id, target: 'https://other.test/forum' })
    expect(channel).toMatchObject({ platform: 'other', connectorId: 'other', target: 'forum' })
  })
})
