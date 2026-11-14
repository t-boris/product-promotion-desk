// The renderer has no test runner of its own (vitest excludes src/renderer), so its pure routing rules are
// tested from here. The modules under test import only src/shared, which keeps these plain unit tests.

import { describe, expect, it, vi } from 'vitest'
import type { ApiEvent } from '../shared/api'
import type { Account, AnalysisStage, AttentionItem, Channel, Claim, Product } from '../shared/types'
import { createFanOut } from '../renderer/src/fan-out'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from '../renderer/src/menu-state'
import { connectChannelHref, fixLinkFor } from '../renderer/src/pages/attention-links'
import { KIND_TONE, attentionCountTone } from '../renderer/src/pages/attention-tone'
import { startSteps } from '../renderer/src/pages/attention-start'
import { engineChoiceVariant, recommendedEngineId, splitEngineDetail } from '../renderer/src/pages/engine-detail'
import { describeSources, planStages, progressOf } from '../renderer/src/pages/products/analysis-plan'
import { launchCounts, launchProgress, launchStages } from '../renderer/src/pages/products/launch-path'
import { approvableClaims } from '../renderer/src/pages/products/model'
import { nextProductStep, passportStatus } from '../renderer/src/pages/products/product-status'
import { resolveSelected } from '../renderer/src/pages/products/product-selection'
import { isMirroredSource } from '../renderer/src/pages/products/source-view'
import { suggestionBlock } from '../renderer/src/pages/channels/suggestion-block'
import { activateBlocker, canActivate, canPause, neverAssessed, setupStage } from '../renderer/src/pages/channels/setup-stage'
import { afterCreateNote, nextStep } from '../renderer/src/pages/channels/next-step'
import { channelLabel } from '../renderer/src/pages/review/channel-label'
import { platformMismatch } from '../renderer/src/pages/channels/platform-hint'
import { MOVED_PAGES, accountHref, accountsNewHref, channelsAccountOf, navigateHashOf, parseAccountsHash, parseHash, productHref, publicationsHref, publicationsProductOf } from '../renderer/src/route'
import { accountText, accountsGroupName, accountsSummary, automationText, engineGroupName } from '../renderer/src/status-labels'

describe('hash routes (DEC-009)', () => {
  it('reads plain pages and ignores the leading characters', () => {
    expect(parseHash('')).toEqual({ page: '', productId: null, tab: null })
    expect(parseHash('#/attention')).toEqual({ page: 'attention', productId: null, tab: null })
    expect(parseHash('#products')).toEqual({ page: 'products', productId: null, tab: null })
  })

  it('reads a product and its tab from #/products/<productId>/<tab>', () => {
    expect(parseHash('#/products/p1')).toEqual({ page: 'products', productId: 'p1', tab: null })
    for (const tab of ['sources', 'passport', 'analysis', 'goal', 'channels', 'results'] as const) {
      expect(parseHash(`#/products/p1/${tab}`)).toEqual({ page: 'products', productId: 'p1', tab })
    }
  })

  it('treats an unknown tab as no tab, and a product id only as meaningful on the product page', () => {
    expect(parseHash('#/products/p1/billing').tab).toBeNull()
    expect(parseHash('#/opportunities/p1/channels')).toEqual({ page: 'opportunities', productId: null, tab: null })
  })

  it('round-trips ids that need escaping', () => {
    const href = productHref('a b/c', 'channels')
    expect(parseHash(href)).toEqual({ page: 'products', productId: 'a b/c', tab: 'channels' })
  })

  it('builds links, falling back to the product list', () => {
    expect(productHref('p1', 'channels')).toBe('#/products/p1/channels')
    expect(productHref('p1')).toBe('#/products/p1')
    expect(productHref(null, 'channels')).toBe('#/products')
    expect(productHref(undefined)).toBe('#/products')
  })

  it('carries the account a Channels tab should choose in "Connect a channel" (BUG-063)', () => {
    expect(productHref('p1', 'channels', 'a1')).toBe('#/products/p1/channels?account=a1')
    // The query is not part of the path: the product and the tab are read as before.
    expect(parseHash('#/products/p1/channels?account=a1')).toEqual({ page: 'products', productId: 'p1', tab: 'channels' })
    expect(channelsAccountOf(productHref('p1', 'channels', 'a1'))).toBe('a1')
    // Ids that need escaping round-trip, in the product and in the account.
    const href = productHref('a b/c', 'channels', 'x y/z&w=1')
    expect(parseHash(href)).toEqual({ page: 'products', productId: 'a b/c', tab: 'channels' })
    expect(channelsAccountOf(href)).toBe('x y/z&w=1')
    // No account, a blank one or another tab: the old link and no choice.
    expect(productHref('p1', 'channels', '')).toBe('#/products/p1/channels')
    expect(productHref('p1', 'goal', 'a1')).toBe('#/products/p1/goal')
    expect(productHref(null, 'channels', 'a1')).toBe('#/products')
    expect(channelsAccountOf('#/products/p1/channels')).toBeNull()
    expect(channelsAccountOf('#/products/p1/channels?account=%20')).toBeNull()
    expect(channelsAccountOf('#/products/p1/channels?other=1')).toBeNull()
    expect(channelsAccountOf('#/products/p1/goal?account=a1')).toBeNull()
    expect(channelsAccountOf('#/products/p1?account=a1')).toBeNull()
    expect(channelsAccountOf('#/accounts/p1/channels?account=a1')).toBeNull()
    expect(channelsAccountOf('')).toBeNull()
  })

  it('sends the old Channels and Results routes to the product list', () => {
    expect(MOVED_PAGES).toEqual({ channels: 'products', results: 'products' })
  })
})

describe('the navigate event of the native menu (BUG-048)', () => {
  it('asks for a page only through a navigate event with a hash route', () => {
    expect(navigateHashOf({ type: 'navigate', hash: '#/settings' })).toBe('#/settings')
    expect(navigateHashOf({ type: 'navigate', hash: '#/products/p1/channels' })).toBe('#/products/p1/channels')
  })

  it('ignores every other event and a hash that is not a route', () => {
    expect(navigateHashOf({ type: 'changed', scope: 'settings' })).toBeNull()
    for (const hash of ['', '#', 'settings', 'https://example.com/#/settings', '#/set tings']) {
      expect(navigateHashOf({ type: 'navigate', hash } satisfies ApiEvent)).toBeNull()
    }
  })

  it('names a page that the shell knows', () => {
    expect(parseHash(navigateHashOf({ type: 'navigate', hash: '#/settings' }) ?? '').page).toBe('settings')
  })
})

describe('one bridge subscription for every screen (BUG-061)', () => {
  /** The preload bridge: each onEvent call adds one ipcRenderer listener, which Node warns about from the 11th. */
  const fakeBridge = () => {
    const listeners = new Set<(event: ApiEvent) => void>()
    const remove = vi.fn()
    const onEvent = vi.fn((handler: (event: ApiEvent) => void) => {
      listeners.add(handler)
      return () => {
        remove()
        listeners.delete(handler)
      }
    })
    return { onEvent, remove, listeners, push: (event: ApiEvent) => [...listeners].forEach((listener) => listener(event)) }
  }
  const changed: ApiEvent = { type: 'changed', scope: 'accounts' }
  const paused: ApiEvent = { type: 'changed', scope: 'settings' }

  it('makes one onEvent call for twenty subscribers, so the bridge holds one listener', () => {
    const bridge = fakeBridge()
    const subscribe = createFanOut<ApiEvent>(bridge.onEvent)
    for (let i = 0; i < 20; i++) subscribe(() => undefined)
    expect(bridge.onEvent).toHaveBeenCalledTimes(1)
    expect(bridge.listeners.size).toBe(1)
  })

  it('hands every event to every handler once, in order', () => {
    const bridge = fakeBridge()
    const subscribe = createFanOut<ApiEvent>(bridge.onEvent)
    const handlers = Array.from({ length: 20 }, () => vi.fn())
    handlers.forEach((handler) => subscribe(handler))
    bridge.push(changed)
    bridge.push(paused)
    for (const handler of handlers) {
      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenNthCalledWith(1, changed)
      expect(handler).toHaveBeenNthCalledWith(2, paused)
    }
  })

  it('stops only the handler that unsubscribed', () => {
    const bridge = fakeBridge()
    const subscribe = createFanOut<ApiEvent>(bridge.onEvent)
    const [first, second] = [vi.fn(), vi.fn()]
    const stopFirst = subscribe(first)
    subscribe(second)
    stopFirst()
    bridge.push(changed)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(bridge.remove).not.toHaveBeenCalled()
    expect(bridge.listeners.size).toBe(1)
  })

  it('removes the bridge listener when the last handler leaves, and registers again on the next subscribe', () => {
    const bridge = fakeBridge()
    const subscribe = createFanOut<ApiEvent>(bridge.onEvent)
    const stopA = subscribe(() => undefined)
    const stopB = subscribe(() => undefined)
    stopA()
    expect(bridge.remove).not.toHaveBeenCalled()
    stopB()
    expect(bridge.remove).toHaveBeenCalledTimes(1)
    expect(bridge.listeners.size).toBe(0)

    const late = vi.fn()
    subscribe(late)
    expect(bridge.onEvent).toHaveBeenCalledTimes(2)
    bridge.push(changed)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('treats a second unsubscribe as nothing, and lets a handler leave while an event is being handed out', () => {
    const bridge = fakeBridge()
    const subscribe = createFanOut<ApiEvent>(bridge.onEvent)
    const calls: string[] = []
    let stopB = (): void => undefined
    subscribe(() => {
      calls.push('a')
      stopB()
    })
    stopB = subscribe(() => calls.push('b'))
    const stopC = subscribe(() => calls.push('c'))
    bridge.push(changed)
    // b left during the event, before its turn: it does not get that event.
    expect(calls).toEqual(['a', 'c'])
    stopB()
    stopC()
    stopC()
    expect(bridge.remove).toHaveBeenCalledTimes(0)
    expect(bridge.listeners.size).toBe(1)
  })

  it('removes the bridge listener exactly once however often the last handler is unsubscribed', () => {
    const bridge = fakeBridge()
    const subscribe = createFanOut<ApiEvent>(bridge.onEvent)
    const stop = subscribe(() => undefined)
    stop()
    stop()
    expect(bridge.remove).toHaveBeenCalledTimes(1)
  })
})

describe('attention links to the product page (DEC-009)', () => {
  const products = [{ id: 'p1', name: 'Natal Mystic' }, { id: 'p2', name: 'Other' }] as Product[]
  const channels = [
    { id: 'c1', productId: 'p1', accountId: 'a1' },
    { id: 'c2', productId: 'p2', accountId: 'a2' }
  ] as Channel[]
  const sources = { channels: [...channels, { id: 'c3', productId: 'p2', accountId: 'legacy' } as Channel], products }
  const item = (refType: AttentionItem['refType'], refId: string): AttentionItem => ({ id: `x:${refId}`, kind: 'login', title: '', detail: '', refType, refId, createdAt: '2026-11-08T00:00:00.000Z' })

  it('sends a channel problem to that product\'s Channels tab', () => {
    expect(fixLinkFor(item('channel', 'c2'), sources)).toEqual({ href: '#/products/p2/channels', label: 'Open Other channels', productName: 'Other' })
  })

  it('sends a sign-in problem to the account it names in the Accounts section, and names the products that use it (DEC-015, BUG-043)', () => {
    expect(fixLinkFor(item('account', 'a1'), sources)).toEqual({ href: '#/accounts/a1', label: 'Open Accounts', productName: 'Natal Mystic' })
    expect(fixLinkFor(item('account', 'legacy'), sources)).toEqual({ href: '#/accounts/legacy', label: 'Open Accounts', productName: 'Other' })
  })

  it('names every product that uses a shared account, and none for an account nothing uses', () => {
    const shared = { ...sources, channels: [...sources.channels, { id: 'c4', productId: 'p1', accountId: 'legacy' } as Channel] }
    expect(fixLinkFor(item('account', 'legacy'), shared)).toMatchObject({ productName: 'Other, Natal Mystic' })
    expect(fixLinkFor(item('account', 'unused'), sources)).toEqual({ href: '#/accounts/unused', label: 'Open Accounts', productName: null })
  })

  it('falls back to the product list when the product cannot be resolved, and has no link for decisions', () => {
    expect(fixLinkFor(item('channel', 'gone'), sources)).toEqual({ href: '#/products', label: 'Open Products', productName: null })
    expect(fixLinkFor(item('opportunity', 'o1'), sources)).toBeNull()
    expect(fixLinkFor(item('action', 'x1'), sources)).toBeNull()
  })

  it('opens the product itself for product items', () => {
    expect(fixLinkFor(item('product', 'p1'), sources)).toEqual({ href: '#/products/p1', label: 'Open product', productName: 'Natal Mystic' })
  })
})

describe('the main menu can be hidden and the choice is remembered', () => {
  const memory = (): MenuStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
  }

  it('is shown until the owner hides it, then stays hidden until shown again', () => {
    const storage = memory()
    expect(readMenuOpen(storage)).toBe(true)
    saveMenuOpen(storage, false)
    expect(readMenuOpen(storage)).toBe(false)
    saveMenuOpen(storage, true)
    expect(readMenuOpen(storage)).toBe(true)
  })

  it('is shown whenever the browser gives no usable storage', () => {
    const broken: MenuStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      }
    }
    expect(readMenuOpen(undefined)).toBe(true)
    expect(readMenuOpen(broken)).toBe(true)
    expect(() => saveMenuOpen(broken, false)).not.toThrow()
    expect(() => saveMenuOpen(undefined, false)).not.toThrow()
  })
})

describe('the new-account form of the Accounts section', () => {
  it('is reached by a link, with or without a role', () => {
    expect(accountsNewHref()).toBe('#/accounts/new')
    expect(parseAccountsHash('#/accounts')).toEqual({ adding: false, accountId: null, productId: null, role: null })
    expect(parseAccountsHash('#/accounts/new')).toEqual({ adding: true, accountId: null, productId: null, role: null })
    expect(parseAccountsHash('#/products/p1/channels')).toEqual({ adding: false, accountId: null, productId: null, role: null })
  })

  it('names an account by #/accounts/<id>, whatever characters the id holds, and "new" stays the form (BUG-043)', () => {
    expect(accountHref('a1')).toBe('#/accounts/a1')
    expect(parseAccountsHash('#/accounts/a1')).toEqual({ adding: false, accountId: 'a1', productId: null, role: null })
    expect(accountHref('a b/c')).toBe('#/accounts/a%20b%2Fc')
    expect(parseAccountsHash(accountHref('a b/c'))).toEqual({ adding: false, accountId: 'a b/c', productId: null, role: null })
    // An id that is not valid percent-encoding is taken as written instead of throwing.
    expect(parseAccountsHash('#/accounts/100%')).toEqual({ adding: false, accountId: '100%', productId: null, role: null })
    // Only the Accounts page reads an account id; the form is never an account.
    expect(parseAccountsHash('#/products/a1')).toEqual({ adding: false, accountId: null, productId: null, role: null })
    expect(parseAccountsHash('#/accounts/new').accountId).toBeNull()
    // The page is still Accounts for the shell.
    expect(parseHash(accountHref('a1')).page).toBe('accounts')
  })

  it('carries the product it was opened from, alone or together with a role (BUG-063)', () => {
    expect(accountsNewHref(undefined, 'p1')).toBe('#/accounts/new?product=p1')
    expect(parseAccountsHash(accountsNewHref(undefined, 'p1'))).toEqual({ adding: true, accountId: null, productId: 'p1', role: null })
    // An id that needs escaping round-trips.
    expect(parseAccountsHash(accountsNewHref(undefined, 'a b/c&d=1'))).toMatchObject({ adding: true, productId: 'a b/c&d=1' })
    // The role and the product travel together, and the role-only link is unchanged.
    const role = { name: 'Astro & Co', voice: 'Calm, plain words' }
    expect(parseAccountsHash(accountsNewHref(role, 'p1'))).toEqual({ adding: true, accountId: null, productId: 'p1', role })
    expect(accountsNewHref(role)).toBe(`#/accounts/new?${new URLSearchParams({ name: role.name, voice: role.voice }).toString()}`)
    expect(parseAccountsHash(accountsNewHref(role))).toMatchObject({ productId: null, role })
    // No product: no query. An empty or blank product is no product, and only the form reads one.
    expect(accountsNewHref(undefined, '')).toBe('#/accounts/new')
    expect(parseAccountsHash('#/accounts/new?product=%20')).toMatchObject({ adding: true, productId: null })
    expect(parseAccountsHash('#/accounts?product=p1')).toMatchObject({ adding: false, productId: null })
    expect(parseAccountsHash('#/accounts/a1?product=p1')).toMatchObject({ adding: false, accountId: 'a1', productId: null })
  })

  it('carries a role through the address, whatever characters it holds', () => {
    const role = { name: 'Astro & Co', voice: 'Calm, "plain" words: no jargon / no ?marks=1' }
    expect(parseAccountsHash(accountsNewHref(role))).toEqual({ adding: true, accountId: null, productId: null, role })
    expect(parseAccountsHash('#/accounts/new?name=%20&voice=x')).toEqual({ adding: true, accountId: null, productId: null, role: null })
    expect(parseAccountsHash('#/accounts?name=Dev')).toEqual({ adding: false, accountId: null, productId: null, role: null })
  })
})

describe('the next step of an account', () => {
  const account = (over: Partial<Account>): Account => ({ id: 'a', platform: 'reddit', label: 'A', identity: null, partition: 'p', status: 'login_required', createdAt: '', productId: null, role: null, loginName: null, email: null, mailboxId: null, profileId: null, ...over })

  it('goes through address, password and sign-in, in that order', () => {
    expect(nextStep(account({}), false, true).block).toBe('email')
    expect(nextStep(account({ email: 'a@b.co' }), false, true).block).toBe('password')
    expect(nextStep(account({ email: 'a@b.co' }), true, true)).toMatchObject({ block: 'signin' })
    expect(nextStep(account({ email: 'a@b.co', status: 'captcha' }), true, true).text).toMatch(/check/)
    expect(nextStep(account({ email: 'a@b.co', status: 'ready' }), true, true)).toMatchObject({ block: null })
  })

  it('does not ask for a password where the Mac keeps none', () => {
    expect(nextStep(account({ email: 'a@b.co' }), false, false).block).toBe('signin')
  })

  it('the note under "Add account" tells where the owner goes next, and from a product that is back to its channels, not into sign-in setup (BUG-063)', () => {
    expect(afterCreateNote(null)).toMatch(/^After adding it you are told what to do next: set the address and the password/)
    const fromProduct = afterCreateNote({ name: 'Natal Mystic' })
    expect(fromProduct).toContain('Channels tab of Natal Mystic')
    expect(fromProduct).toMatch(/connect a channel/i)
    // The address, the password and the sign-in are named as later work, not as the next step.
    expect(fromProduct).not.toMatch(/you are told what to do next/)
    expect(fromProduct).toMatch(/later/i)
    // A product whose name has not arrived yet is still a product.
    expect(afterCreateNote({ name: undefined })).toContain('Channels tab of this product')
  })
})

describe('platformMismatch: an account whose name says one platform while it is on another', () => {
  const platforms = [
    { platform: 'reddit', label: 'Reddit' },
    { platform: 'facebook', label: 'Facebook' },
    { platform: 'x', label: 'X' },
    { platform: 'web', label: 'Website' }
  ]

  it('says so when the name mentions another platform (the account the owner added as "Facebook" was on Reddit)', () => {
    const text = platformMismatch('Natal Mystic @ Facebook', 'reddit', platforms)
    expect(text).toContain('mentions Facebook')
    expect(text).toContain('on Reddit')
    expect(text).toContain('add it again')
  })

  it('is quiet when the name matches the platform, mentions none, or mentions both', () => {
    expect(platformMismatch('Natal Mystic @ Facebook', 'facebook', platforms)).toBeNull()
    expect(platformMismatch('Brand account', 'reddit', platforms)).toBeNull()
    expect(platformMismatch('Reddit and Facebook voice', 'reddit', platforms)).toBeNull()
  })

  it('matches whole words in any case and ignores platforms with one- or two-letter names', () => {
    expect(platformMismatch('natal mystic facebook', 'reddit', platforms)).not.toBeNull()
    expect(platformMismatch('Facebooking account', 'reddit', platforms)).toBeNull()
    expect(platformMismatch('Natal Mystic X', 'reddit', platforms)).toBeNull()
    expect(platformMismatch('Natal Mystic @ Facebook', 'unknown', platforms)).toContain('on unknown')
  })
})

describe('status row words (BUG-003)', () => {
  // The top bar names its state in the accessibility tree with these strings, and a UI test tool reads them from there.
  it('names the AI engine as one statement, with or without an engine', () => {
    expect(engineGroupName({ label: 'Codex' })).toBe('AI engine: Codex')
    expect(engineGroupName(undefined)).toBe('AI engine: None selected')
  })

  it('names the accounts as one statement, with the login name after the account name', () => {
    expect(accountsGroupName(undefined)).toBe('Accounts: None connected')
    expect(accountsGroupName([])).toBe('Accounts: None connected')
    expect(accountsGroupName([{ label: 'Brand', identity: 'brand_user' }, { label: 'Second', identity: null }])).toBe(
      'Accounts: Brand · brand_user, Second'
    )
    expect(accountText({ label: 'Brand' })).toBe('Brand')
  })

  it('Top bar (BUG-023): one badge sums up the accounts, its tooltip lists every one, and none keeps "None connected"', () => {
    const acc = (label: string, status: 'ready' | 'login_required' | 'captcha' | 'suspended', identity: string | null = null) => ({ label, identity, status })
    expect(accountsSummary([])).toBeNull()
    expect(accountsSummary([acc('A', 'ready'), acc('B', 'ready'), acc('C', 'ready')])).toMatchObject({ text: '3 ready', tone: 'good' })
    expect(accountsSummary([acc('A', 'ready'), acc('B', 'login_required'), acc('C', 'ready')])).toMatchObject({ text: '3 · 1 needs sign-in', tone: 'warn' })
    expect(accountsSummary([acc('A', 'login_required'), acc('B', 'login_required')])).toMatchObject({ text: '2 · 2 need sign-in', tone: 'warn' })
    expect(accountsSummary([acc('A', 'captcha'), acc('B', 'ready')])).toMatchObject({ text: '2 · 1 needs you', tone: 'warn' })
    expect(accountsSummary([acc('A', 'suspended')])).toMatchObject({ text: '1 · 1 needs you', tone: 'bad' })
    expect(accountsSummary([acc('Brand', 'ready', 'brand_user'), acc('Second', 'login_required')])?.title).toBe('Brand · brand_user: Signed in\nSecond: Sign-in needed')
  })

  it('reads the automation state as one sentence, and shows an ellipsis until the state has arrived', () => {
    expect(automationText({ paused: false })).toBe('Automation running')
    expect(automationText({ paused: true })).toBe('Automation paused')
    expect(automationText(null)).toBe('Automation …')
    expect(automationText(undefined)).toBe('Automation …')
  })
})

describe('QA clarity batch: what the screens say', () => {
  const claim = (over: Partial<Claim>): Claim => ({
    id: 'c', lineageId: 'l', passportVersionId: 'v', section: 'offer', text: 't', kind: 'fact', status: 'proposed', sources: [], verifiedAt: null, unconfirmedAvailability: false, conflictsWith: [], createdAt: '', updatedAt: '', ...over
  })
  const stage = (name: AnalysisStage['name'], status: AnalysisStage['status'] = 'pending'): AnalysisStage => ({ productId: 'p', name, status, detail: '', updatedAt: '' })
  const ALL_STAGES = [stage('read_site'), stage('analyze_documents'), stage('scan_code'), stage('synthesize'), stage('find_contradictions')]

  it('Attention: the getting-started steps follow the state of the app, and the first open one is the next step', () => {
    const fresh = startSteps({ products: 0, accounts: 0, paused: true })
    expect(fresh.map((x) => x.done)).toEqual([false, false, false])
    expect(fresh.find((x) => !x.done)?.id).toBe('product')
    const noAccount = startSteps({ products: 2, accounts: 0, paused: true })
    expect(noAccount.find((x) => !x.done)).toMatchObject({ id: 'account', href: '#/accounts/new' })
    expect(startSteps({ products: 2, accounts: 1, paused: true }).find((x) => !x.done)?.id).toBe('resume')
    expect(startSteps({ products: 2, accounts: 1, paused: false }).every((x) => x.done)).toBe(true)
    // Until the state of the automation arrived nothing claims it is running.
    expect(startSteps({ products: 1, accounts: 1, paused: undefined }).find((x) => x.id === 'resume')?.done).toBe(false)
  })

  it('Attention (BUG-029): the "Resume automation" hint follows the state, the title stays', () => {
    const resume = (paused: boolean | undefined) => startSteps({ products: 1, accounts: 1, paused }).find((x) => x.id === 'resume')
    expect(resume(false)).toMatchObject({ title: 'Resume automation', done: true })
    expect(resume(false)?.hint).toMatch(/^Running: your channels are checked on schedule\./)
    expect(resume(true)?.hint).toMatch(/^While it is paused, nothing is checked or sent\./)
    expect(resume(undefined)?.hint).not.toMatch(/^Running/)
  })

  it('product header: approved, approved with a draft waiting, and not approved agree with the Passport tab', () => {
    const none = { activePassportVersionId: null }
    const active = { activePassportVersionId: 'v1' }
    const draft = { status: 'draft' as const, version: 2 }
    const claims = [claim({ status: 'approved' }), claim({ id: 'd' }), claim({ id: 'e' })]
    expect(passportStatus(active, { status: 'approved', version: 1 }, claims)).toEqual({ tone: 'good', label: 'Passport approved' })
    expect(passportStatus(active, draft, claims)).toMatchObject({ tone: 'info', label: 'Passport approved', detail: 'Draft in progress: 2 to review' })
    expect(passportStatus(none, { status: 'draft', version: 1 }, claims)).toMatchObject({ tone: 'warn', label: 'No approved passport', detail: 'Draft: 1 approved, 2 to review' })
    expect(passportStatus(none, null, [])).toEqual({ tone: 'warn', label: 'No approved passport' })
  })

  it('product list: the next step goes passport, goal, channel, publication, and is gone once the path is complete (BUG-014)', () => {
    const none = { channels: 0, approvedPublications: 0, draftPublications: 0 }
    const goals = [{ id: 'g', targetAction: 'a', successMetrics: [], notes: '' }]
    expect(nextProductStep({ activePassportVersionId: null, analysisStatus: 'idle', goals: [] }, none)).toBe('Next: run the analysis')
    expect(nextProductStep({ activePassportVersionId: null, analysisStatus: 'complete', goals: [] }, none)).toBe('Next: approve the passport')
    expect(nextProductStep({ activePassportVersionId: 'v', analysisStatus: 'complete', goals: [] }, none)).toBe('Next: write a goal')
    const ready = { activePassportVersionId: 'v', analysisStatus: 'complete' as const, goals }
    expect(nextProductStep(ready, none)).toBe('Next: connect a channel')
    // A product with a channel no longer asks for one.
    expect(nextProductStep(ready, { ...none, channels: 1 })).toBe('Next: write a publication')
    expect(nextProductStep(ready, { ...none, channels: 1, draftPublications: 2 })).toBe('Next: approve a draft')
    expect(nextProductStep(ready, { channels: 1, approvedPublications: 1, draftPublications: 2 })).toBeNull()
  })

  it('Analysis: a step with nothing to work on says why instead of "Waiting", and is not counted', () => {
    const planned = planStages(ALL_STAGES, [{ kind: 'text' }])
    expect(planned.map((p) => p.needed)).toEqual([false, true, false, true, true])
    expect(planned[0].reason).toBe('No website to read.')
    expect(planned[2].reason).toBe('No project folder to scan.')
    expect(progressOf(planned)).toEqual({ done: 0, total: 3 })
    // With every kind of source all five steps apply.
    expect(progressOf(planStages(ALL_STAGES, [{ kind: 'url' }, { kind: 'document' }, { kind: 'code_folder' }])).total).toBe(5)
    // A step that already ran keeps what the core says, even without a source of its kind now.
    const ran = planStages([stage('read_site', 'done'), ...ALL_STAGES.slice(1)], [{ kind: 'text' }])
    expect(ran[0].needed).toBe(true)
    expect(progressOf(ran).done).toBe(1)
  })

  it('Analysis: says what will be read', () => {
    expect(describeSources([])).toBe('nothing yet')
    expect(describeSources([{ kind: 'text' }, { kind: 'text' }, { kind: 'url' }])).toBe('1 website, 2 texts')
    expect(describeSources([{ kind: 'code_folder' }])).toBe('1 project folder')
  })

  it('Sources: only the description and the website of the product are marked as mirrored, a text of the owner never', () => {
    const product = { websiteUrl: 'https://a.example/', description: 'About it' }
    expect(isMirroredSource({ kind: 'text', ref: 'About it', label: 'Description' }, product)).toBe(true)
    expect(isMirroredSource({ kind: 'text', ref: 'About it', label: 'My notes' }, product)).toBe(false)
    expect(isMirroredSource({ kind: 'url', ref: 'https://a.example/', label: 'a.example' }, product)).toBe(true)
    expect(isMirroredSource({ kind: 'url', ref: 'https://b.example/', label: 'b' }, product)).toBe(false)
    expect(isMirroredSource({ kind: 'text', ref: 'x', label: 'Description' }, { websiteUrl: null, description: null })).toBe(false)
  })

  it('Passport: "Approve all" takes proposed facts and assumptions, and leaves what needs a look', () => {
    const list = [
      claim({ id: 'fact' }),
      claim({ id: 'guess', kind: 'assumption' }),
      claim({ id: 'unknown', kind: 'unknown' }),
      claim({ id: 'conflict', kind: 'contradiction' }),
      claim({ id: 'code', unconfirmedAvailability: true }),
      claim({ id: 'done', status: 'approved' }),
      claim({ id: 'no', status: 'rejected' })
    ]
    const { approve, needLook } = approvableClaims(list)
    expect(approve.map((c) => c.id)).toEqual(['fact', 'guess'])
    expect(needLook.map((c) => c.id)).toEqual(['unknown', 'conflict', 'code'])
  })

  it('Settings: an engine status is split into lines, and "not used for automatic replies" is flagged as a limit', () => {
    const codex = splitEngineDetail(
      'Codex 0.169.0 is installed and answers. Writing: not tool-free (it can read files on this computer), so it is not used for automatic replies. Account missions: it works the account’s browser with full access.'
    )
    expect(codex.summary).toBe('Codex 0.169.0 is installed and answers.')
    expect(codex.writing).toMatch(/^Writing: not tool-free/)
    expect(codex.missions).toMatch(/^Account missions: /)
    expect(codex.limits).toBe(true)
    const claude = splitEngineDetail('Claude Code 2.1.325 is installed and answers. Writing: tool-free, it can only return text. Account missions: it works the account’s browser with full access.')
    expect(claude.limits).toBe(false)
    expect(splitEngineDetail('Codex was not found.')).toEqual({ summary: 'Codex was not found.', writing: null, missions: null, limits: false })
  })

  it('Launch path (BUG-012): five stages, the first one not done is the next step, each links to where it is worked on', () => {
    const facts = { hasSources: true, passportApproved: true, goals: 0, channels: 0, approvedPublications: 0 }
    const stages = launchStages('p1', facts)
    expect(stages.map((s) => s.id)).toEqual(['product', 'passport', 'goal', 'channel', 'publication'])
    expect(stages.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(stages.map((s) => s.href)).toEqual(['#/products/p1/sources', '#/products/p1/passport', '#/products/p1/goal', '#/products/p1/channels', '#/publications/p1'])
    expect(launchProgress(stages)).toBe('2 of 5 done')
    // A stage is done by its own fact: a channel connected before the goal was written is done, the goal is still next.
    expect(launchStages('p1', { ...facts, channels: 1 }).map((s) => s.state)).toEqual(['done', 'done', 'current', 'done', 'todo'])
    expect(launchStages('p1', { hasSources: true, passportApproved: true, goals: 1, channels: 2, approvedPublications: 1 }).every((s) => s.state === 'done')).toBe(true)
    expect(launchStages('p1', { ...facts, passportApproved: false }).find((s) => s.state === 'current')?.id).toBe('passport')
  })

  it('Launch path (BUG-012): channels, approved publications and drafts are counted per product; replies do not count', () => {
    const pub = (productId: string, state: string, kind = 'standalone') => ({ opportunity: { productId, state, kind } }) as Parameters<typeof launchCounts>[1][number]
    const counts = launchCounts(
      [{ productId: 'a' }, { productId: 'a' }, { productId: 'b' }],
      [pub('a', 'ready'), pub('a', 'confirmed'), pub('a', 'sending'), pub('a', 'awaiting_approval'), pub('b', 'draft'), pub('b', 'confirmed', 'reply')]
    )
    expect(counts.get('a')).toEqual({ channels: 2, approvedPublications: 3, draftPublications: 1 })
    expect(counts.get('b')).toEqual({ channels: 1, approvedPublications: 0, draftPublications: 1 })
    expect(counts.get('c')).toBeUndefined()
  })

  it('Launch path (BUG-012): the Publication stage opens Publications filtered by the product', () => {
    expect(publicationsHref('p 1')).toBe('#/publications/p%201')
    expect(publicationsHref(null)).toBe('#/publications')
    expect(publicationsProductOf('#/publications/p%201')).toBe('p 1')
    expect(publicationsProductOf('#/publications')).toBeNull()
    expect(publicationsProductOf('#/products/p1')).toBeNull()
    // The shell still routes the link to the Publications page.
    expect(parseHash('#/publications/p1').page).toBe('publications')
  })

  it('Publications and Opportunities (BUG-017, BUG-018): "Connect a channel" opens the chosen product\'s Channels tab, or Products', () => {
    expect(connectChannelHref('p 1')).toBe('#/products/p%201/channels')
    expect(connectChannelHref('')).toBe('#/products')
    expect(connectChannelHref(null)).toBe('#/products')
  })

  it('Publications and Opportunities (BUG-067): the Channel pop-up names the product only while no product is chosen', () => {
    expect(channelLabel('Northwind Notes', 'r/test_sandbox', false)).toBe('Northwind Notes · r/test_sandbox')
    expect(channelLabel('Northwind Notes', 'r/test_sandbox', true)).toBe('r/test_sandbox')
    // A channel whose product is not known yet is named by its target in both cases.
    expect(channelLabel(undefined, 'r/test_sandbox', false)).toBe('r/test_sandbox')
    expect(channelLabel('', 'r/test_sandbox', false)).toBe('r/test_sandbox')
  })

  it('Menu (BUG-016): the Attention count is amber, and red only while one of the items is a failure', () => {
    expect(attentionCountTone([])).toBeNull()
    expect(attentionCountTone(['draft', 'approval', 'question', 'login', 'captcha', 'connection'])).toBe('attention')
    expect(attentionCountTone(['draft', 'error'])).toBe('error')
    expect(attentionCountTone(['unknown_result'])).toBe('error')
    // Only failures are red on the page too; a sign-in or a CAPTCHA waits for the owner, it is not an error.
    expect(Object.entries(KIND_TONE).filter(([, tone]) => tone === 'bad').map(([kind]) => kind)).toEqual(['error', 'unknown_result'])
  })

  it('Settings (BUG-015): only the recommended engine is filled, and only while no engine is in use', () => {
    const codex = { id: 'codex', installed: true, detail: 'Codex 0.169.0 is installed and answers. Writing: not tool-free (it can read files on this computer), so it is not used for automatic replies.' }
    const claude = { id: 'claude', installed: true, detail: 'Claude Code 2.1.325 is installed and answers. Writing: tool-free, it can only return text.' }
    // Codex is listed first, but it is not tool-free, so the tool-free Claude Code is the recommended one.
    expect(recommendedEngineId([codex, claude])).toBe('claude')
    expect(recommendedEngineId([codex, { ...claude, installed: false }])).toBeNull()
    expect(recommendedEngineId([])).toBeNull()
    expect(engineChoiceVariant('claude', 'claude', false)).toBe('primary')
    expect(engineChoiceVariant('codex', 'claude', false)).toBe('ghost')
    // Once an engine is in use, nothing on the card is filled any more.
    expect(engineChoiceVariant('claude', 'claude', true)).toBe('secondary')
    expect(engineChoiceVariant('codex', null, false)).toBe('ghost')
  })

  it('Channels (BUG-009): the reason the AI buttons are off names the place that fixes it', () => {
    const engines = [{ id: 'codex', ready: true, detail: '', label: 'Codex' }, { id: 'claude', ready: false, detail: 'Claude Code was not found.', label: 'Claude Code' }]
    const base = { productId: 'p1', approved: true, engineId: 'codex', engines, ready: true }
    expect(suggestionBlock(base)).toBeNull()
    expect(suggestionBlock({ ...base, approved: false })).toMatchObject({ text: 'Approve the product passport first so the suggestions fit it.', fix: { href: '#/products/p1/passport' } })
    expect(suggestionBlock({ ...base, engineId: null })).toMatchObject({ text: 'Choose an AI engine in Settings first.', fix: { href: '#/settings' } })
    expect(suggestionBlock({ ...base, engineId: 'claude' })).toMatchObject({ text: 'Claude Code was not found.', fix: { href: '#/settings' } })
    // Nothing is blocked on a guess while the settings are still loading.
    expect(suggestionBlock({ ...base, engineId: undefined, ready: false })).toBeNull()
    expect(suggestionBlock({ ...base, approved: null })).toBeNull()
  })
})

describe('Channels tab: one step at a time (DEC-023)', () => {
  const channel = (over: Partial<Channel>): Channel =>
    ({ status: 'setup', baselineDoneAt: null, capabilities: [{ key: 'read_posts', status: 'unknown', detail: '', checkedAt: null }], ...over }) as Channel
  const assessed = [{ key: 'read_posts', status: 'verified', detail: '', checkedAt: '2026-11-14T00:00:00.000Z' }] as Channel['capabilities']

  it('the Channels tab asks for one step at a time, in order', () => {
    expect(setupStage({ hasAccount: false, channelCount: 0, selected: undefined })).toBe('account')
    // An account is asked for first, even when channels exist.
    expect(setupStage({ hasAccount: false, channelCount: 2, selected: channel({}) })).toBe('account')
    expect(setupStage({ hasAccount: true, channelCount: 0, selected: undefined })).toBe('connect')
    // Several channels and none picked: the owner chooses, nothing is filled.
    expect(setupStage({ hasAccount: true, channelCount: 2, selected: undefined })).toBe('choose')
    expect(setupStage({ hasAccount: true, channelCount: 1, selected: channel({}) })).toBe('assess')
    expect(setupStage({ hasAccount: true, channelCount: 1, selected: channel({ capabilities: assessed }) })).toBe('activate')
    expect(setupStage({ hasAccount: true, channelCount: 1, selected: channel({ capabilities: assessed, status: 'active' }) })).toBe('running')
    // Nothing is left to start: a paused channel, and one that needed the owner after its baseline was read.
    expect(setupStage({ hasAccount: true, channelCount: 1, selected: channel({ capabilities: assessed, status: 'paused' }) })).toBe('running')
    expect(
      setupStage({ hasAccount: true, channelCount: 1, selected: channel({ capabilities: assessed, status: 'needs_user', baselineDoneAt: '2026-11-14T00:00:00.000Z' }) })
    ).toBe('running')
  })

  it('a channel counts as assessed once any of its abilities was checked', () => {
    expect(neverAssessed(channel({}))).toBe(true)
    expect(neverAssessed(channel({ capabilities: [] }))).toBe(true)
    expect(neverAssessed(channel({ capabilities: assessed }))).toBe(false)
  })

  it('a channel that needed the owner before its first baseline can be started, one that had a baseline can be paused', () => {
    expect(canActivate(channel({ status: 'setup' }))).toBe(true)
    expect(canActivate(channel({ status: 'needs_user' }))).toBe(true)
    expect(canActivate(channel({ status: 'error' }))).toBe(true)
    expect(canActivate(channel({ status: 'needs_user', baselineDoneAt: '2026-11-14T00:00:00.000Z' }))).toBe(false)
    expect(canActivate(channel({ status: 'active' }))).toBe(false)
    expect(canActivate(channel({ status: 'paused' }))).toBe(false)
    expect(canPause(channel({ status: 'active' }))).toBe(true)
    expect(canPause(channel({ status: 'error' }))).toBe(true)
    expect(canPause(channel({ status: 'needs_user', baselineDoneAt: '2026-11-14T00:00:00.000Z' }))).toBe(true)
    expect(canPause(channel({ status: 'needs_user' }))).toBe(false)
    expect(canPause(channel({ status: 'setup' }))).toBe(false)
    expect(canPause(channel({ status: 'paused' }))).toBe(false)
  })

  it('Activate waits for the assessment, and the sentence that says so is the one that disables it (BUG-055)', () => {
    const baselineDone = '2026-11-14T00:00:00.000Z'
    // A channel in setup that was never assessed: Activate is off and the reason is the next step.
    expect(activateBlocker(channel({ status: 'setup' }))).toMatch(/^Assess the channel first to see what this account can do here\./)
    // Once any ability was checked there is nothing to wait for.
    expect(activateBlocker(channel({ status: 'setup', capabilities: assessed }))).toBeNull()
    // A channel that is not to be started has no Activate, so nothing blocks it.
    expect(activateBlocker(channel({ status: 'active' }))).toBeNull()
    expect(activateBlocker(channel({ status: 'paused' }))).toBeNull()
    // needs_user: without a baseline it can still be started, so it waits for the assessment too; with a baseline it cannot be started at all.
    expect(activateBlocker(channel({ status: 'needs_user' }))).not.toBeNull()
    expect(activateBlocker(channel({ status: 'needs_user', capabilities: assessed }))).toBeNull()
    expect(activateBlocker(channel({ status: 'needs_user', baselineDoneAt: baselineDone }))).toBeNull()
    // The button and its reason come from one rule: a blocked channel is exactly an activatable, never assessed one.
    for (const status of ['setup', 'needs_user', 'error', 'active', 'paused'] as const) {
      for (const baselineDoneAt of [null, baselineDone]) {
        for (const capabilities of [channel({}).capabilities, assessed]) {
          const c = channel({ status, baselineDoneAt, capabilities })
          expect(activateBlocker(c) !== null).toBe(canActivate(c) && neverAssessed(c))
        }
      }
    }
  })
})

describe('the product that is open on the Products page (BUG-042)', () => {
  const ids = ['p1', 'p2']

  it('a product in the list is the selected one', () => {
    expect(resolveSelected(ids, 'p2', null)).toBe('p2')
    expect(resolveSelected(ids, 'p1', 'p3')).toBe('p1')
  })

  it('a product that was just created stays selected before the list has loaded it', () => {
    // After "Create product" the route names the new product while `products.list` still holds the old rows.
    expect(resolveSelected(ids, 'p3', 'p3')).toBe('p3')
    expect(resolveSelected([], 'p3', 'p3')).toBe('p3')
  })

  it('an id that is neither in the list nor the one just created selects nothing', () => {
    expect(resolveSelected(ids, 'gone', null)).toBeNull()
    expect(resolveSelected(ids, 'gone', 'p3')).toBeNull()
    expect(resolveSelected(ids, null, 'p3')).toBeNull()
    expect(resolveSelected(ids, null, null)).toBeNull()
  })

  it('the "always open" effect does not fire for a created product: it acts only on a null selection', () => {
    // Products.tsx re-selects the last or first product only when this is null. A created product must not be null, or
    // the effect replaces the route with an old product (the defect behind BUG-042, BUG-068 and BUG-069).
    expect(resolveSelected(ids, 'p3', 'p3')).not.toBeNull()
    // Once the list holds it, the normal rule applies and the created id no longer matters.
    expect(resolveSelected(['p1', 'p2', 'p3'], 'p3', 'p3')).toBe('p3')
    expect(resolveSelected(ids, 'p3', null)).toBeNull()
  })
})
