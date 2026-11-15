// The browser an account works in (DEC-026), and the name of an account.

import { describe, expect, it } from 'vitest'
import { makeReadyWorld } from './test-helpers'

describe('the name of an account', () => {
  it('can be changed, with the rules of the name at creation', async () => {
    const w = await makeReadyWorld()
    const renamed = await w.call('accounts.rename', { accountId: w.account.id, label: '  Brand   on   Reddit ' })
    expect(renamed.label).toBe('Brand on Reddit')
    expect((await w.call('accounts.list', undefined)).find((a) => a.id === w.account.id)?.label).toBe('Brand on Reddit')
    expect(w.changes).toEqual(expect.arrayContaining(['accounts', 'attention']))
  })

  it('is refused empty, too long, or for an account that is not there', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('accounts.rename', { accountId: w.account.id, label: '   ' })).toBe('invalid_input')
    expect(await w.refusal('accounts.rename', { accountId: w.account.id, label: 'x'.repeat(81) })).toBe('invalid_input')
    expect(await w.refusal('accounts.rename', { accountId: 'nope', label: 'A' })).toBe('not_found')
    expect((await w.call('accounts.list', undefined))[0].label).toBe(w.account.label)
  })

  it('does nothing, and announces nothing, when the name is the same', async () => {
    const w = await makeReadyWorld()
    w.changes.length = 0
    await w.call('accounts.rename', { accountId: w.account.id, label: w.account.label })
    expect(w.changes).toEqual([])
  })
})

describe('the browser of an account', () => {
  it('is the internal browser until the owner chooses another', async () => {
    const w = await makeReadyWorld()
    expect(w.account.browser).toBe('internal')
  })

  it('moves to Chrome: the old browser is let go of, the account is signed out until it signs in there, and the identity is remembered', async () => {
    const w = await makeReadyWorld()
    w.core.db.prepare("UPDATE accounts SET status = 'ready', identity = 'natal', last_identity = 'natal' WHERE id = ?").run(w.account.id)
    const moved = await w.call('accounts.setBrowser', { accountId: w.account.id, browser: 'chrome' })
    expect(moved).toMatchObject({ browser: 'chrome', status: 'login_required', identity: null })
    expect(w.t.browser.released).toEqual([w.account.id])
    expect(w.core.db.prepare('SELECT last_identity AS v FROM accounts WHERE id = ?').get(w.account.id)).toEqual({ v: 'natal' })
    expect(w.changes).toEqual(expect.arrayContaining(['accounts', 'attention']))
    const back = await w.call('accounts.setBrowser', { accountId: w.account.id, browser: 'internal' })
    expect(back.browser).toBe('internal')
    expect(w.t.browser.released).toEqual([w.account.id, w.account.id])
  })

  it('does nothing when it is the browser it already has', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.setBrowser', { accountId: w.account.id, browser: 'internal' })
    expect(w.t.browser.released).toEqual([])
  })

  it('refuses a browser that is not one of the two', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('accounts.setBrowser', { accountId: w.account.id, browser: 'firefox' as 'chrome' })).toBe('invalid_input')
  })

  it('refuses Chrome when Chrome is not installed, and says what to do', async () => {
    const w = await makeReadyWorld()
    w.t.browser.chromeInstalled = false
    await expect(w.call('accounts.setBrowser', { accountId: w.account.id, browser: 'chrome' })).rejects.toMatchObject({ code: 'chrome_missing', message: expect.stringContaining('Install it') })
    expect((await w.call('accounts.list', undefined))[0].browser).toBe('internal')
  })

  it('is not changed while the owner holds the account\'s browser', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.openBrowser', { accountId: w.account.id })
    expect(await w.refusal('accounts.setBrowser', { accountId: w.account.id, browser: 'chrome' })).toBe('browser_busy')
    expect(w.t.browser.released).toEqual([])
    expect((await w.call('accounts.list', undefined))[0].browser).toBe('internal')
  })

  it('is not changed while the AI works on the account', async () => {
    const w = await makeReadyWorld()
    w.core.services.agent = { questions: () => [], working: (id) => id === w.account.id }
    expect(await w.refusal('accounts.setBrowser', { accountId: w.account.id, browser: 'chrome' })).toBe('agent_running')
    expect(w.t.browser.released).toEqual([])
  })

  it('stores the new setting before the old browser is let go of, and lets go of the one the account had', async () => {
    const w = await makeReadyWorld()
    const seen: Array<{ stored: unknown; passed: string }> = []
    w.t.browser.releaseAccount = async (a) => {
      seen.push({ stored: (w.core.db.prepare('SELECT browser AS v FROM accounts WHERE id = ?').get(a.id) as { v: string }).v, passed: a.browser })
    }
    await w.call('accounts.setBrowser', { accountId: w.account.id, browser: 'chrome' })
    // Anything that arrives while the old browser is closing already routes to the new one; the account it is told about still names the old one.
    expect(seen).toEqual([{ stored: 'chrome', passed: 'internal' }])
  })

  it('still changes when the old browser would not let go cleanly', async () => {
    const w = await makeReadyWorld()
    w.t.browser.releaseAccount = async () => {
      throw new Error('window would not close')
    }
    expect((await w.call('accounts.setBrowser', { accountId: w.account.id, browser: 'chrome' })).browser).toBe('chrome')
  })

  it('says in the browser state whether Chrome is installed', async () => {
    const w = await makeReadyWorld()
    expect(await w.call('accounts.browser', { accountId: w.account.id })).toMatchObject({ chromeFound: true })
    w.t.browser.chromeInstalled = false
    expect(await w.call('accounts.browser', { accountId: w.account.id })).toMatchObject({ chromeFound: false })
  })
})
