import { describe, expect, it } from 'vitest'
import type { BrowserSession } from '../core/ports'
import type { Account, PageReport } from '../shared/types'
import { RoutingBrowserService, type FullBrowserService } from './routing-browser-service'

const account = (id: string, platform: string): Account => ({ id, platform, label: id, identity: null, partition: `persist:${id}`, status: 'login_required', createdAt: '2026-01-01T00:00:00.000Z' }) as Account

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
  const app = fake('app')
  const chrome = fake('chrome')
  const routing = new RoutingBrowserService(app, chrome, { chromeFound: () => options.chromeFound ?? true, env: options.env ?? {} })
  const notes: string[] = []
  routing.onPageNote = (id, note) => void notes.push(`${id}:${note}`)
  return { routing, app, chrome, notes }
}

describe('RoutingBrowserService', () => {
  it('serves Facebook with Chrome and every other platform with the built-in browser', async () => {
    const { routing, app, chrome } = make()
    expect(routing.session(account('f', 'facebook'))).toMatchObject({ who: 'chrome' })
    expect(routing.session(account('r', 'reddit'))).toMatchObject({ who: 'app' })
    expect(await routing.openForUser(account('f', 'facebook'), 'https://www.facebook.com/')).toEqual({ tabId: 'chrome' })
    expect(await routing.openForUser(account('r', 'reddit'))).toEqual({ tabId: 'app' })
    expect(chrome.calls).toEqual(['session:f', 'open:f:https://www.facebook.com/'])
    expect(app.calls).toEqual(['session:r', 'open:r:'])
  })

  it('sends every question about an account to the browser that serves it', async () => {
    const { routing, app, chrome } = make()
    const fb = account('f', 'facebook')
    routing.showAgentBrowser(fb, true)
    expect(routing.hasUserWindow(fb)).toBe(true)
    expect(routing.showUserWindow(fb)).toBe(true)
    routing.closeUserWindow(fb)
    expect(await routing.pageReport(fb)).toMatchObject({ address: 'chrome' })
    expect(chrome.calls).toEqual(['show:f:true', 'has:f', 'front:f', 'close:f', 'report:f'])
    expect(app.calls).toEqual([])
  })

  it('keeps an account with the browser it was first served by while the application runs', () => {
    const { routing, chrome } = make({ chromeFound: true })
    routing.session(account('f', 'facebook'))
    const flipping = new RoutingBrowserService(fake('app'), chrome, { chromeFound: (() => { let n = 0; return () => n++ === 0 })(), env: {} })
    expect(flipping.session(account('f', 'facebook'))).toMatchObject({ who: 'chrome' })
    expect(flipping.session(account('f', 'facebook'))).toMatchObject({ who: 'chrome' })
  })

  it('serves Facebook with the built-in browser, and says so once, when Chrome is not installed', () => {
    const { routing, app, chrome, notes } = make({ chromeFound: false })
    const fb = account('f', 'facebook')
    expect(routing.session(fb)).toMatchObject({ who: 'app' })
    routing.session(fb)
    routing.hasUserWindow(fb)
    expect(app.calls).toEqual(['session:f', 'session:f', 'has:f'])
    expect(chrome.calls).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/Chrome/)
  })

  it('obeys PPD_BROWSER, either way', () => {
    expect(make({ env: { PPD_BROWSER: 'app' } }).routing.session(account('f', 'facebook'))).toMatchObject({ who: 'app' })
    expect(make({ env: { PPD_BROWSER: 'chrome' } }).routing.session(account('r', 'reddit'))).toMatchObject({ who: 'chrome' })
  })

  it('passes what either browser reports to the one listener of the core', () => {
    const { app, chrome, routing } = make()
    const seen: string[] = []
    routing.onUserWindowChange = (id, change) => void seen.push(`${id}:${change}`)
    app.onUserWindowChange?.('r', 'opened')
    chrome.onUserWindowChange?.('f', 'closed')
    expect(seen).toEqual(['r:opened', 'f:closed'])
    const noted: string[] = []
    routing.onPageNote = (id, note) => void noted.push(`${id}:${note}`)
    app.onPageNote?.('r', 'x')
    chrome.onPageNote?.('f', 'y')
    expect(noted).toEqual(['r:x', 'f:y'])
  })

  it('forgets an account in the browser that served it and in the other, and a failure in the other is not a failure', async () => {
    const { routing, app, chrome } = make()
    const fb = account('f', 'facebook')
    chrome.forgetAccount = async () => void chrome.calls.push('forget:f')
    app.forgetAccount = async () => {
      app.calls.push('forget:f')
      throw new Error('nothing to forget')
    }
    await expect(routing.forgetAccount(fb)).resolves.toBeUndefined()
    expect(chrome.calls).toContain('forget:f')
    expect(app.calls).toContain('forget:f')
  })

  it('does not hide a failure of the browser that served the account', async () => {
    const { routing, chrome } = make()
    chrome.forgetAccount = async () => {
      throw new Error('could not remove the profile')
    }
    await expect(routing.forgetAccount(account('f', 'facebook'))).rejects.toThrow('could not remove the profile')
  })
})
