import { describe, expect, it } from 'vitest'
import type { BrowserSession } from '../core/ports'
import type { Account, PageReport } from '../shared/types'
import { RoutingBrowserService, type FullBrowserService } from './routing-browser-service'

const account = (id: string, browser: 'internal' | 'chrome' = 'internal', platform = 'facebook'): Account => ({ id, platform, browser, signsInVia: null, label: id, identity: null, partition: `persist:${id}`, status: 'login_required', createdAt: '2026-01-01T00:00:00.000Z' }) as Account

/** A browser service that remembers what it was asked. */
function fake(name: string): FullBrowserService & { calls: string[] } {
  const calls: string[] = []
  const service: FullBrowserService & { calls: string[] } = {
    calls,
    onUserWindowChange: undefined,
    onPageNote: undefined,
    session: (a) => (calls.push(`session:${a.id}`), { who: name } as unknown as BrowserSession),
    openForUser: async (a, url) => (calls.push(`open:${a.id}:${url ?? ''}`), { tabId: name }),
    showAgentBrowser: (a, focus) => void calls.push(`show:${a.id}:${String(focus)}`),
    hasUserWindow: (a) => (calls.push(`has:${a.id}`), name === 'chrome'),
    showUserWindow: (a) => (calls.push(`front:${a.id}`), true),
    closeUserWindow: (a) => void calls.push(`close:${a.id}`),
    pageReport: async (a) => (calls.push(`report:${a.id}`), { address: name } as unknown as PageReport),
    forgetAccount: async (a) => void calls.push(`forget:${a.id}`)
  }
  return service
}

function make(options: { chromeFound?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const internal = fake('internal')
  const chrome = fake('chrome')
  const routing = new RoutingBrowserService(internal, chrome, { chromeFound: () => options.chromeFound ?? true, env: options.env ?? {} })
  return { routing, internal, chrome }
}

describe('RoutingBrowserService', () => {
  it('serves an account with the browser the account names, whatever the platform', async () => {
    const { routing, internal, chrome } = make()
    expect(routing.session(account('a', 'internal', 'facebook'))).toMatchObject({ who: 'internal' })
    expect(routing.session(account('b', 'chrome', 'reddit'))).toMatchObject({ who: 'chrome' })
    expect(await routing.openForUser(account('c', 'chrome'), 'https://www.facebook.com/')).toEqual({ tabId: 'chrome' })
    expect(await routing.openForUser(account('d', 'internal'))).toEqual({ tabId: 'internal' })
    expect(chrome.calls).toEqual(['session:b', 'open:c:https://www.facebook.com/'])
    expect(internal.calls).toEqual(['session:a', 'open:d:'])
  })

  it('serves an account that has no setting with the internal browser', () => {
    const { routing } = make()
    expect(routing.session({ id: 'x', platform: 'reddit' } as Account)).toMatchObject({ who: 'internal' })
  })

  it('follows a change of the setting at the very next call', () => {
    const { routing } = make()
    expect(routing.session(account('a', 'internal'))).toMatchObject({ who: 'internal' })
    expect(routing.session(account('a', 'chrome'))).toMatchObject({ who: 'chrome' })
    expect(routing.session(account('a', 'internal'))).toMatchObject({ who: 'internal' })
  })

  it('sends every question about an account to the browser that serves it', async () => {
    const { routing, internal, chrome } = make()
    const fb = account('f', 'chrome')
    routing.showAgentBrowser(fb, true)
    expect(routing.hasUserWindow(fb)).toBe(true)
    expect(routing.showUserWindow(fb)).toBe(true)
    routing.closeUserWindow(fb)
    expect(await routing.pageReport(fb)).toMatchObject({ address: 'chrome' })
    expect(chrome.calls).toEqual(['show:f:true', 'has:f', 'front:f', 'close:f', 'report:f'])
    expect(internal.calls).toEqual([])
  })

  it('does not fall back to the other browser when Chrome is not installed: it only says so', () => {
    const { routing, internal, chrome } = make({ chromeFound: false })
    expect(routing.chromeFound()).toBe(false)
    expect(routing.session(account('f', 'chrome'))).toMatchObject({ who: 'chrome' })
    expect(internal.calls).toEqual([])
    expect(chrome.calls).toEqual(['session:f'])
  })

  it('obeys PPD_BROWSER, either way, for every account', () => {
    expect(make({ env: { PPD_BROWSER: 'internal' } }).routing.session(account('f', 'chrome'))).toMatchObject({ who: 'internal' })
    expect(make({ env: { PPD_BROWSER: 'chrome' } }).routing.session(account('r', 'internal', 'reddit'))).toMatchObject({ who: 'chrome' })
  })

  it('lets go of the browser the account leaves, and only that one', async () => {
    const { routing, internal, chrome } = make()
    chrome.releaseAccount = async (a) => void chrome.calls.push(`release:${a.id}`)
    internal.releaseAccount = async (a) => void internal.calls.push(`release:${a.id}`)
    await routing.releaseAccount(account('a', 'chrome'))
    expect(chrome.calls).toEqual(['release:a'])
    expect(internal.calls).toEqual([])
    await routing.releaseAccount(account('b', 'internal'))
    expect(internal.calls).toEqual(['release:b'])
  })

  it('does not mind a browser that has nothing to release', async () => {
    const { routing } = make()
    await expect(routing.releaseAccount(account('a', 'chrome'))).resolves.toBeUndefined()
  })

  it('passes what either browser reports to the one listener of the core', () => {
    const { internal, chrome, routing } = make()
    const seen: string[] = []
    routing.onUserWindowChange = (id, change) => void seen.push(`${id}:${change}`)
    internal.onUserWindowChange?.('r', 'opened')
    chrome.onUserWindowChange?.('f', 'closed')
    expect(seen).toEqual(['r:opened', 'f:closed'])
    const noted: string[] = []
    routing.onPageNote = (id, note) => void noted.push(`${id}:${note}`)
    internal.onPageNote?.('r', 'x')
    chrome.onPageNote?.('f', 'y')
    expect(noted).toEqual(['r:x', 'f:y'])
  })

  it('forgets an account in the browser that serves it and in the other', async () => {
    const { routing, internal, chrome } = make()
    await routing.forgetAccount(account('f', 'chrome'))
    expect(chrome.calls).toContain('forget:f')
    expect(internal.calls).toContain('forget:f')
  })

  it('does not hide a failure of the other browser (cookies could stay on disk), after trying both', async () => {
    const { routing, internal, chrome } = make()
    internal.forgetAccount = async () => {
      internal.calls.push('forget:f')
      throw new Error('could not clear the old session')
    }
    await expect(routing.forgetAccount(account('f', 'chrome'))).rejects.toThrow('could not clear the old session')
    expect(chrome.calls).toContain('forget:f')
    expect(internal.calls).toContain('forget:f')
  })

  it('does not hide a failure of the browser that serves the account', async () => {
    const { routing, internal, chrome } = make()
    chrome.forgetAccount = async () => {
      throw new Error('could not remove the profile')
    }
    await expect(routing.forgetAccount(account('f', 'chrome'))).rejects.toThrow('could not remove the profile')
    // the other browser was still asked to forget it
    expect(internal.calls).toContain('forget:f')
  })
})
