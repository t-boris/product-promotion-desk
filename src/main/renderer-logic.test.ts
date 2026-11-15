// The renderer has no test runner of its own (vitest excludes src/renderer), so its pure routing rules are
// tested from here. The modules under test import only src/shared, which keeps these plain unit tests.

import { describe, expect, it, vi } from 'vitest'
import type { ApiEvent } from '../shared/api'
import type { Account, AgentRun, AnalysisStage, AttentionItem, Channel, ChannelPlan, Claim, GroupChannelOption, MixCard, MixKindCard, MixSetting, OpportunityCard, OpportunityState, PlatformInfo, PostGroup, PostGroupResult, PostVersion, Product, ProductUpdate } from '../shared/types'
import { createFanOut } from '../renderer/src/fan-out'
import { closeForm, mainForm, openForm, type OpenFormIds } from '../renderer/src/open-forms'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from '../renderer/src/menu-state'
import { connectChannelHref, fixLinkFor } from '../renderer/src/pages/attention-links'
import { KIND_TONE, attentionCountTone } from '../renderer/src/pages/attention-tone'
import { startHeadline, startSteps } from '../renderer/src/pages/attention-start'
import { engineChoiceVariant, recommendedEngineId, splitEngineDetail } from '../renderer/src/pages/engine-detail'
import { describeSources, planStages, progressOf } from '../renderer/src/pages/products/analysis-plan'
import { TAB_STAGE, launchCounts, launchProgress, launchStages, nextStage, tabAccent, type LaunchFacts } from '../renderer/src/pages/products/launch-path'
import { approvableClaims } from '../renderer/src/pages/products/model'
import { productLabels } from '../renderer/src/pages/products/product-labels'
import { deleteBlocker, nextProductStep, passportStatus, websiteHost } from '../renderer/src/pages/products/product-status'
import { resolveSelected } from '../renderer/src/pages/products/product-selection'
import { isMirroredSource } from '../renderer/src/pages/products/source-view'
import { suggestionBlock } from '../renderer/src/pages/channels/suggestion-block'
import { activateBlocker, canActivate, canPause, neverAssessed, setupStage } from '../renderer/src/pages/channels/setup-stage'
import { afterCreateNote, nextStep } from '../renderer/src/pages/channels/next-step'
import { chosenVia, contactLine, eligibleVia, viaBlocker, viaOption } from '../renderer/src/pages/channels/account-link'
import { ACCOUNT_NAME_LIMIT, normalizeName, renameProblem } from '../renderer/src/pages/channels/account-name'
import { CAPABILITY_LABEL, CAPABILITY_ORDER, abilityNeedsDecision, abilityStatusLabel, capabilityRows, membershipWord } from '../renderer/src/pages/channels/capability-words'
import { JOIN_NOTE, JOIN_OTHER_RUN, JOIN_OWNER_HOLDS, isJoinRunOf, joinButton, joinLabel } from '../renderer/src/pages/channels/join-control'
import { approveLabels } from '../renderer/src/pages/review/approve-labels'
import { removalWords } from '../renderer/src/pages/review/removal-words'
import {
  CANNOT_POST_REASON,
  CHOOSE_A_CHANNEL,
  NOT_APPROVED_YET,
  alsoPostAllowed,
  approveAllLabel,
  channelCount,
  draftInputOf,
  extendLabel,
  groupMain,
  groupStamp,
  groupTitle,
  hasWarnings,
  reasonBeside,
  resultsHeadline,
  saveIntent,
  saveLabel,
  seenOf,
  sendAllLabel,
  sendBlocker,
  stepBlocker,
  stepLabel,
  toggled,
  versionLabel,
  wayLine,
  whereRows
} from '../renderer/src/pages/review/post-group'
import { mainOwner } from '../renderer/src/pages/review/main-action'
import { channelLabel } from '../renderer/src/pages/review/channel-label'
import { platformMismatch } from '../renderer/src/pages/channels/platform-hint'
import {
  AI_WORKING,
  NO_BROWSE_PAGE,
  NO_PAGE_OPEN,
  OPEN_ALREADY,
  TYPE_ADDRESS_FIRST,
  accountForIdea,
  browseAddress,
  browseBlocker,
  browseHint,
  holdingNote,
  openBlocker,
  blockHolder,
  openMode,
  pageResult,
  ADDRESS_SHORTENED,
  rowBlocker
} from '../renderer/src/pages/channels/open-browser'
import {
  DAYS_PROBLEM,
  KIND_WORDS,
  MIX_KINDS,
  NEXT_SOON,
  NOTE_MAX,
  NOTE_SET_ASIDE_AFTER,
  NOT_SAVED_YET,
  PROPOSED_NOTE,
  PROPOSED_SAME_NOTE,
  REPLIES_WORDS,
  SET_ASIDE_WORDS,
  applyProposal,
  canUndoProposal,
  daysProblem,
  draftsOnlyLine,
  formDirty,
  formFromCard,
  formSignature,
  formValid,
  isSetAside,
  kindStatus,
  noteProblem,
  normalizeNote,
  parseDays,
  planProposesMix,
  proposalNote,
  proposeBlock,
  repliesLine,
  rowChanged,
  sameForm,
  settingsFromForm,
  shortDate,
  showNoteCount,
  statusLine,
  splitNotes,
  unusedLabel,
  withRow
} from '../renderer/src/pages/channels/mix-card'
import { MOVED_PAGES, PRODUCT_TABS, accountHref, accountsNewHref, channelsAccountOf, navigateHashOf, parseAccountsHash, parseHash, productHref, publicationsHref, publicationsProductOf } from '../renderer/src/route'
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
  const account = (over: Partial<Account>): Account => ({ id: 'a', platform: 'reddit', label: 'A', identity: null, partition: 'p', status: 'login_required', createdAt: '', productId: null, role: null, loginName: null, email: null, mailboxId: null, browser: 'internal', signsInVia: null, profileId: null, ...over })

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

describe('an account that signs in through another account (DEC-027)', () => {
  const base = { id: 'a', platform: 'reddit', label: 'A', identity: null, partition: 'p', status: 'login_required' as const, createdAt: '', productId: null, role: null, loginName: null, email: null, mailboxId: null, browser: 'internal' as const, signsInVia: null, profileId: null }
  const account = (over: Partial<Account>): Account => ({ ...base, ...over })
  const threads = (over: Partial<Account> = {}): Account => account({ id: 't', platform: 'threads', label: 'Brand on Threads', signsInVia: 'i', ...over })
  const instagram = (over: Partial<Account> = {}): Account => account({ id: 'i', platform: 'instagram', label: 'Brand on Instagram', email: 'brand@example.com', loginName: 'brand', ...over })

  describe('nextStep', () => {
    it('asks for the account to sign in through first, and never for an address or a password', () => {
      const step = nextStep(threads({ signsInVia: null }), false, true, { account: null, label: 'Instagram', hasPassword: false })
      expect(step.block).toBe('via')
      expect(step.text).toMatch(/choose the Instagram account/)
      expect(step.text).not.toMatch(/e-mail address|save its password/)
    })

    it('then goes straight to the sign-in, whatever the account itself holds', () => {
      const through = { account: instagram(), label: 'Instagram', hasPassword: true }
      const step = nextStep(threads(), false, true, through)
      expect(step.block).toBe('signin')
      expect(step.text).toMatch(/step 4/)
      expect(step.text).toMatch(/Brand on Instagram/)
    })

    it('says what the account it signs in through is missing, because it signs in through it', () => {
      const noPassword = nextStep(threads(), false, true, { account: instagram(), label: 'Instagram', hasPassword: false })
      expect(noPassword.block).toBe('via')
      expect(noPassword.text).toMatch(/Brand on Instagram needs its login/)
      expect(noPassword.text).toMatch(/saved password/)
      expect(noPassword.text).toMatch(/Brand on Threads signs in through it/)
      const noLogin = nextStep(threads(), false, true, { account: instagram({ email: null, loginName: null }), label: 'Instagram', hasPassword: true })
      expect(noLogin.text).toMatch(/needs its login/)
    })

    it('asks to solve a check, and is done once signed in', () => {
      const through = { account: instagram(), label: 'Instagram', hasPassword: true }
      expect(nextStep(threads({ status: 'captcha' }), false, true, through).text).toMatch(/solve the check/)
      expect(nextStep(threads({ status: 'ready' }), false, true, through)).toMatchObject({ block: null })
    })

    it('leaves every other account exactly as it was', () => {
      expect(nextStep(account({}), false, true).block).toBe('email')
      expect(nextStep(account({ email: 'a@b.co' }), false, true).block).toBe('password')
      expect(nextStep(account({ email: 'a@b.co' }), true, true).text).toMatch(/step 5/)
    })

    it('has a note after "Add account" that promises no address and no password', () => {
      expect(afterCreateNote(null, true)).toMatch(/sign in through the account you chose/)
      expect(afterCreateNote(null, true)).not.toMatch(/set the address/)
      expect(afterCreateNote({ name: 'Natal Mystic' }, true)).toContain('Channels tab of Natal Mystic')
      expect(afterCreateNote(null, false)).toBe(afterCreateNote(null))
    })
  })

  describe('which accounts it may sign in through', () => {
    const accounts = [
      instagram({ id: 'i1', label: 'Brand', profileId: 'p1' }),
      instagram({ id: 'i2', label: 'Founder', profileId: 'p2' }),
      instagram({ id: 'i3', label: 'Loose', profileId: null }),
      account({ id: 'r1', platform: 'reddit', label: 'Not Instagram', profileId: 'p1' })
    ]

    it('lists only the accounts of that platform', () => {
      expect(eligibleVia(accounts, 'instagram', null).map((a) => a.id)).toEqual(['i1', 'i2', 'i3'])
    })

    it('leaves out accounts of another profile than the login\'s own, and keeps those without a profile', () => {
      expect(eligibleVia(accounts, 'instagram', 'p1').map((a) => a.id)).toEqual(['i1', 'i3'])
      expect(eligibleVia(accounts, 'instagram', 'p3').map((a) => a.id)).toEqual(['i3'])
    })

    it('says the state of an account beside its name', () => {
      expect(viaOption(instagram({ status: 'ready' }))).toBe('Brand on Instagram · Signed in')
    })

    it('preselects the only candidate, keeps a choice that is still possible, and never guesses between several', () => {
      const one = [instagram({ id: 'i1' })]
      const two = [instagram({ id: 'i1' }), instagram({ id: 'i2' })]
      expect(chosenVia(one, '')).toBe('i1')
      expect(chosenVia(two, '')).toBe('')
      expect(chosenVia(two, 'i2')).toBe('i2')
      expect(chosenVia(two, 'gone')).toBe('')
      expect(chosenVia([], 'i1')).toBe('')
    })

    it('says why the account cannot be added yet', () => {
      expect(viaBlocker('Threads', 'Instagram', [], '')).toBe('Threads signs in with an Instagram account. Add the Instagram account first.')
      expect(viaBlocker('Pinterest', 'Facebook', [], '')).toBe('Pinterest signs in with a Facebook account. Add the Facebook account first.')
      expect(viaBlocker('Threads', 'Instagram', [instagram(), instagram({ id: 'i2' })], '')).toBe('Choose the Instagram account Threads signs in through.')
      expect(viaBlocker('Threads', 'Instagram', [instagram()], 'i')).toBeNull()
    })

    it('says how a list line reaches such an account, never "no e-mail address yet"', () => {
      expect(contactLine(account({ email: 'a@b.co' }), false)).toBe('a@b.co')
      expect(contactLine(account({}), false)).toBe('no e-mail address yet')
      expect(contactLine(threads(), true)).toBe('signs in through another account')
      expect(contactLine(threads({ signsInVia: null }), true)).toBe('no account to sign in through yet')
    })
  })
})

describe('the name of an account', () => {
  it('is spaces folded and trimmed, as the core keeps it', () => {
    expect(normalizeName('  Brand   on  Reddit ')).toBe('Brand on Reddit')
  })

  it('cannot be saved empty, unchanged or too long', () => {
    expect(renameProblem('Brand', '   ')).toBe('empty')
    expect(renameProblem('Brand', '')).toBe('empty')
    expect(renameProblem('Brand', 'Brand')).toBe('unchanged')
    expect(renameProblem('Brand', '  Brand ')).toBe('unchanged')
    expect(renameProblem('Brand', 'B'.repeat(ACCOUNT_NAME_LIMIT + 1))).toBe('too_long')
  })

  it('can be saved when it is a new name, up to the limit', () => {
    expect(renameProblem('Brand', 'Brand on Reddit')).toBeNull()
    expect(renameProblem('Brand', 'brand')).toBeNull()
    expect(renameProblem('Brand', 'B'.repeat(ACCOUNT_NAME_LIMIT))).toBeNull()
    expect(ACCOUNT_NAME_LIMIT).toBe(80)
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

  it('Attention: the getting-started steps follow the state of the app, and the first open one is the next step (with no launch stage in the way)', () => {
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

  it('Attention (BUG-058): the newest product\'s next stage leads the checklist, ahead of the account and the automation, and is the step the path and the button name', () => {
    const stageOf = (over: Partial<LaunchFacts>) => nextStage(launchStages('p1', { hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0, ...over }))
    // Products but no account, automation paused (the report): the passport is the first open step, the account comes after it.
    const passport = startSteps({ products: 3, accounts: 0, paused: true, stage: stageOf({}) })
    expect(passport.map((x) => x.id)).toEqual(['product', 'launch', 'account', 'resume'])
    expect(passport.map((x) => x.done)).toEqual([true, false, false, false])
    expect(passport.find((x) => !x.done)).toMatchObject({ id: 'launch', title: 'Build the passport', action: 'Build the passport', hint: 'Build and approve the passport.', href: '#/products/p1/passport' })
    expect(startSteps({ products: 3, accounts: 0, paused: true, stage: stageOf({ passportApproved: true }) }).find((x) => !x.done)).toMatchObject({ id: 'launch', action: 'Write a goal', href: '#/products/p1/goal' })
    expect(startSteps({ products: 3, accounts: 0, paused: true, stage: stageOf({ passportApproved: true, goals: 1 }) }).find((x) => !x.done)).toMatchObject({ id: 'launch', action: 'Connect a channel', href: '#/products/p1/channels' })
    // An account and a running automation do not move the path's stage out of the first place.
    expect(startSteps({ products: 1, accounts: 1, paused: false, stage: stageOf({}) }).find((x) => !x.done)?.id).toBe('launch')
    // With every setup stage done (the Publication stage is the work, not the setup) or no stage, the three steps stay as they were.
    for (const stage of [stageOf({ passportApproved: true, goals: 1, channels: 1 }), stageOf({ passportApproved: true, goals: 1, channels: 1, approvedPublications: 1 }), null, undefined]) {
      expect(startSteps({ products: 2, accounts: 0, paused: true, stage }).map((x) => x.id)).toEqual(['product', 'account', 'resume'])
    }
    // The first open step, the filled button under the card and the path's "Next" tag are one step: the same action as nextStage.
    for (const over of [{}, { passportApproved: true }, { passportApproved: true, goals: 1 }]) {
      const stages = launchStages('p1', { hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0, ...over })
      const first = startSteps({ products: 1, accounts: 0, paused: true, stage: nextStage(stages) }).find((x) => !x.done)
      expect({ action: first?.action, href: first?.href }).toEqual({ action: nextStage(stages)?.action, href: nextStage(stages)?.href })
    }
  })

  it('Attention (BUG-058): the headline names the product the path is about, and asks for the first product when there is none', () => {
    expect(startHeadline(null)).toBe('Launch your first product')
    expect(startHeadline('Northwind Notes')).toBe('Launch Northwind Notes')
    // A label that tells products of one name apart (BUG-054) is named as it is.
    expect(startHeadline('Lumen Reader · 14 Nov 13:46')).toBe('Launch Lumen Reader · 14 Nov 13:46')
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

  it('product list: the next step is the next stage of the launch path, in the words of its action, and is gone once the path is complete (BUG-014, BUG-064)', () => {
    const rowOf = (facts: Partial<LaunchFacts>) => nextProductStep(launchStages('p1', { hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0, ...facts }))
    // No approved passport: the row names the stage, never the analysis, whatever the analysis or a hand-built draft did (the row has no say in it).
    expect(rowOf({})).toBe('Next: build the passport')
    expect(rowOf({ passportApproved: true })).toBe('Next: write a goal')
    expect(rowOf({ passportApproved: true, goals: 1 })).toBe('Next: connect a channel')
    // A product with a channel no longer asks for one.
    expect(rowOf({ passportApproved: true, goals: 1, channels: 1 })).toBe('Next: write a publication')
    expect(rowOf({ passportApproved: true, goals: 1, channels: 1, draftPublications: 2 })).toBe('Next: approve a draft')
    expect(rowOf({ passportApproved: true, goals: 1, channels: 1, approvedPublications: 1, draftPublications: 2 })).toBeNull()
    // The stage that is not done decides, whatever stands behind it: a channel connected before the goal was written leaves the goal next.
    expect(rowOf({ passportApproved: true, channels: 1 })).toBe('Next: write a goal')
    // The row and the header path read the same stages, so they name the same step.
    for (const facts of [{}, { passportApproved: true }, { passportApproved: true, goals: 1 }, { passportApproved: true, goals: 1, channels: 1 }]) {
      const stages = launchStages('p1', { hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0, ...facts })
      expect(nextProductStep(stages)?.toLowerCase()).toBe(`next: ${nextStage(stages)?.action.toLowerCase()}`)
    }
  })

  it('review buttons (BUG-057): an edited draft says "Save, approve and send", never "Save and approve and send"', () => {
    expect(approveLabels(false)).toEqual({ approve: 'Approve', approveAndSend: 'Approve and send' })
    expect(approveLabels(true)).toEqual({ approve: 'Save and approve', approveAndSend: 'Save, approve and send' })
    // The send button names its steps with commas; two "and"s in a row are gone.
    for (const dirty of [false, true]) expect(approveLabels(dirty).approveAndSend).not.toMatch(/ and .* and /)
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

  it('Launch path (BUG-064): the passport stage asks to build and approve it, and every stage has the words of its button', () => {
    const stages = launchStages('p1', { hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0 })
    expect(stages.find((s) => s.id === 'passport')?.todo).toBe('Build and approve the passport.')
    expect(stages.map((s) => s.action)).toEqual(['Add a source', 'Build the passport', 'Write a goal', 'Connect a channel', 'Write a publication'])
    // The Publication stage reads the drafts: with one waiting, the step is to approve it.
    expect(launchStages('p1', { hasSources: true, passportApproved: true, goals: 1, channels: 1, approvedPublications: 0, draftPublications: 1 }).at(-1)?.action).toBe('Approve a draft')
    expect(launchStages('p1', { hasSources: true, passportApproved: true, goals: 1, channels: 1, approvedPublications: 0, draftPublications: 0 }).at(-1)?.action).toBe('Write a publication')
  })

  it('Launch path (BUG-064, BUG-065): the next stage is the first stage that is not done, and none once every stage is done', () => {
    const facts = { hasSources: false, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0 }
    // Every stage in turn is the next one while the stages before it are done.
    expect(nextStage(launchStages('p1', facts))?.id).toBe('product')
    expect(nextStage(launchStages('p1', { ...facts, hasSources: true }))?.id).toBe('passport')
    expect(nextStage(launchStages('p1', { ...facts, hasSources: true, passportApproved: true }))?.id).toBe('goal')
    expect(nextStage(launchStages('p1', { ...facts, hasSources: true, passportApproved: true, goals: 1 }))?.id).toBe('channel')
    const publication = nextStage(launchStages('p1', { ...facts, hasSources: true, passportApproved: true, goals: 1, channels: 1 }))
    expect(publication).toMatchObject({ id: 'publication', href: '#/publications/p1', action: 'Write a publication' })
    expect(nextStage(launchStages('p1', { hasSources: true, passportApproved: true, goals: 1, channels: 1, approvedPublications: 1 }))).toBeNull()
    // A done stage in the middle does not move the next step: the first stage that is not done keeps it.
    const middle = nextStage(launchStages('p1', { ...facts, hasSources: true, passportApproved: true, channels: 1 }))
    expect(middle).toMatchObject({ id: 'goal', state: 'current', href: '#/products/p1/goal', action: 'Write a goal' })
    expect(nextStage(launchStages('p1', { ...facts, hasSources: true, goals: 1, channels: 1 }))?.id).toBe('passport')
    expect(nextStage([])).toBeNull()
  })

  it('Product tabs (BUG-065): a tab keeps its filled action only while its own stage is the next one; every other tab points at the next stage', () => {
    const facts = { hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0 }
    const accents = (over: Partial<LaunchFacts>) => {
      const stages = launchStages('p1', { ...facts, ...over })
      return Object.fromEntries(PRODUCT_TABS.map((tab) => [tab, (({ own, next }) => (own ? 'own' : (next?.id ?? 'none')))(tabAccent(stages, tab))]))
    }
    // A product with a source and no passport: Passport (and the Analysis that builds it) hold the accent; the finished Sources tab does not.
    expect(accents({})).toEqual({ sources: 'passport', passport: 'own', analysis: 'own', goal: 'passport', channels: 'passport', results: 'passport' })
    // Approved passport: the Goal tab is next, and the Passport and Analysis tabs hand the accent on.
    expect(accents({ passportApproved: true })).toEqual({ sources: 'goal', passport: 'goal', analysis: 'goal', goal: 'own', channels: 'goal', results: 'goal' })
    // Saved goal: Channels (and the Results tab, whose one action is "Connect a channel") hold it.
    expect(accents({ passportApproved: true, goals: 1 })).toEqual({ sources: 'channel', passport: 'channel', analysis: 'channel', goal: 'channel', channels: 'own', results: 'own' })
    // A connected channel: the Channels tab hands it on (its "Assess channel" and "Activate" are bezels); only Publication is left, and no tab is its own.
    expect(accents({ passportApproved: true, goals: 1, channels: 1 })).toEqual({ sources: 'publication', passport: 'publication', analysis: 'publication', goal: 'publication', channels: 'publication', results: 'publication' })
    // A product without a source: Sources holds it.
    expect(accents({ hasSources: false }).sources).toBe('own')
    // A done stage in the middle: a channel connected before the goal was written leaves the Goal tab as the owner.
    expect(accents({ passportApproved: true, channels: 1 })).toMatchObject({ goal: 'own', channels: 'goal' })
    // The path is complete: nothing is next, so no tab holds a filled button.
    expect(accents({ passportApproved: true, goals: 1, channels: 1, approvedPublications: 1 })).toEqual({ sources: 'none', passport: 'none', analysis: 'none', goal: 'none', channels: 'none', results: 'none' })
    expect(tabAccent(launchStages('p1', facts), 'goal').next).toMatchObject({ id: 'passport', href: '#/products/p1/passport', action: 'Build the passport' })
  })

  it('Product tabs (BUG-065): whatever the facts, each tab either holds the filled action or points at the path\'s next stage, never both and never neither while a stage is left', () => {
    for (let n = 0; n < 32; n++) {
      const facts: LaunchFacts = { hasSources: (n & 1) === 1, passportApproved: (n & 2) === 2, goals: (n & 4) === 4 ? 1 : 0, channels: (n & 8) === 8 ? 1 : 0, approvedPublications: (n & 16) === 16 ? 1 : 0 }
      const stages = launchStages('p1', facts)
      const next = nextStage(stages)
      for (const tab of PRODUCT_TABS) {
        const accent = tabAccent(stages, tab)
        expect(accent.own && accent.next !== null).toBe(false)
        if (!accent.own) expect(accent.next).toEqual(next)
        if (!accent.own && next !== null) expect(accent.next?.state).toBe('current')
      }
      // At most one stage is next, so the owners are all tabs of that one stage: never two stages' accents on a screen.
      const owners = PRODUCT_TABS.filter((tab) => tabAccent(stages, tab).own)
      expect(owners.length).toBeLessThanOrEqual(2)
      for (const tab of owners) expect(TAB_STAGE[tab]).toBe(next?.id)
    }
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

describe('the website a product row shows (BUG-062)', () => {
  it('shows the host: no scheme, no "www.", no trailing slash, no path', () => {
    expect(websiteHost('https://northwind.example.com/')).toBe('northwind.example.com')
    expect(websiteHost('http://www.northwind.example.com')).toBe('northwind.example.com')
    expect(websiteHost('https://northwind-notes-team-workspace.example.com/products/meeting-notes?ref=1#top')).toBe('northwind-notes-team-workspace.example.com')
  })

  it('keeps a port, which tells two sites on one host apart', () => {
    expect(websiteHost('http://localhost:3000/')).toBe('localhost:3000')
  })

  it('keeps the raw text when it is not an address', () => {
    expect(websiteHost('northwind.example.com')).toBe('northwind.example.com')
    expect(websiteHost('not a url')).toBe('not a url')
    expect(websiteHost('')).toBe('')
  })
})

describe('the labels that tell products of one name apart (BUG-054)', () => {
  // Local time on purpose: the label shows the owner's clock, so a fixture built in local time reads the same in any time zone.
  const at = (hour: number, minute: number, second = 0): string => new Date(2026, 10, 14, hour, minute, second).toISOString()
  const product = (id: string, name: string, createdAt: string) => ({ id, name, createdAt })

  it('leaves a name that only one product has exactly as it is', () => {
    const labels = productLabels([product('p1', 'Northwind Notes', at(13, 46)), product('p2', 'Lumen Reader', at(14, 2))])
    expect(labels.get('p1')).toBe('Northwind Notes')
    expect(labels.get('p2')).toBe('Lumen Reader')
  })

  it('gives every product of a shared name its creation time, and leaves the others alone', () => {
    const labels = productLabels([product('p1', 'Natal charts', at(13, 46)), product('p2', 'Natal charts', at(15, 5)), product('p3', 'Lumen Reader', at(14, 2))])
    expect(labels.get('p1')).toBe('Natal charts · 14 Nov 13:46')
    expect(labels.get('p2')).toBe('Natal charts · 14 Nov 15:05')
    expect(labels.get('p3')).toBe('Lumen Reader')
  })

  it('compares names without case and without the spaces around them, and keeps each product\'s own spelling', () => {
    const labels = productLabels([product('p1', 'Natal Charts', at(9, 0)), product('p2', '  natal charts ', at(10, 0))])
    expect(labels.get('p1')).toBe('Natal Charts · 14 Nov 09:00')
    expect(labels.get('p2')).toBe('natal charts · 14 Nov 10:00')
  })

  it('gives the same labels whatever the order of the list', () => {
    const list = [product('p1', 'Twin', at(8, 0)), product('p2', 'Solo', at(8, 1)), product('p3', 'Twin', at(8, 2)), product('p4', 'Twin', at(8, 2, 30))]
    const forward = productLabels(list)
    const backward = productLabels([...list].reverse())
    for (const p of list) expect(backward.get(p.id)).toBe(forward.get(p.id))
  })

  it('adds a short id when two products of one name were created in the same minute', () => {
    const labels = productLabels([product('aaaa1111', 'Twin', at(8, 2)), product('bbbb2222', 'Twin', at(8, 2, 40)), product('cccc3333', 'Twin', at(9, 0))])
    expect(labels.get('aaaa1111')).toBe('Twin · 14 Nov 08:02 · #aaaa')
    expect(labels.get('bbbb2222')).toBe('Twin · 14 Nov 08:02 · #bbbb')
    expect(labels.get('cccc3333')).toBe('Twin · 14 Nov 09:00')
  })

  it('tells products apart by id when createdAt is the same too, and lengthens the id until it differs', () => {
    const same = at(8, 2)
    const labels = productLabels([product('abcd0001', 'Twin', same), product('abcd0002', 'Twin', same)])
    expect(labels.get('abcd0001')).toBe('Twin · 14 Nov 08:02 · #abcd0001')
    expect(labels.get('abcd0002')).toBe('Twin · 14 Nov 08:02 · #abcd0002')
  })

  it('never gives two products of the list one label', () => {
    const list = [
      product('a1', 'Same', at(7, 0)),
      product('a2', 'same', at(7, 0)),
      product('a3', 'SAME ', at(7, 0, 59)),
      product('b1', 'Other', at(7, 0)),
      product('b2', 'Other', 'not a date')
    ]
    const labels = [...productLabels(list).values()]
    expect(new Set(labels).size).toBe(list.length)
  })
})

describe('the on-demand form that owns the filled button (BUG-040)', () => {
  const open = (...ids: string[]): OpenFormIds => ids.reduce<OpenFormIds>((forms, id) => openForm(forms, id), [])

  it('nobody owns it while no form is open', () => {
    expect(mainForm([])).toBeNull()
  })

  it('the form opened last owns it, and a form opened before it does not', () => {
    expect(mainForm(open('a'))).toBe('a')
    expect(mainForm(open('a', 'b'))).toBe('b')
    expect(mainForm(open('a', 'b', 'c'))).toBe('c')
  })

  it('closing the form that owns it hands it to the one opened before', () => {
    expect(mainForm(closeForm(open('a', 'b', 'c'), 'c'))).toBe('b')
    expect(mainForm(closeForm(closeForm(open('a', 'b', 'c'), 'c'), 'b'))).toBe('a')
    expect(mainForm(closeForm(open('a'), 'a'))).toBeNull()
  })

  it('closing a form that does not own it leaves the owner as it is', () => {
    expect(mainForm(closeForm(open('a', 'b', 'c'), 'a'))).toBe('c')
    expect(mainForm(closeForm(open('a', 'b', 'c'), 'b'))).toBe('c')
  })

  it('registering a form again does not duplicate it and does not take the button from a newer form', () => {
    const forms = open('a', 'b')
    expect(openForm(forms, 'a')).toEqual(['a', 'b'])
    expect(mainForm(openForm(forms, 'a'))).toBe('b')
    expect(openForm(forms, 'b')).toBe(forms)
  })

  it('an id is in the list once, however often it is registered', () => {
    expect(open('a', 'a', 'b', 'a', 'b')).toEqual(['a', 'b'])
  })

  it('closing a form that is not open changes nothing', () => {
    const forms = open('a', 'b')
    expect(closeForm(forms, 'x')).toBe(forms)
  })

  it('a form that was closed and opens again is the newest', () => {
    expect(mainForm(openForm(closeForm(open('a', 'b'), 'a'), 'a'))).toBe('a')
    expect(open('a', 'b').length).toBe(2)
  })
})

describe('why a product cannot be deleted yet (BUG-046)', () => {
  it('says nothing while the product has no channel, so the confirm may be asked', () => {
    expect(deleteBlocker(0)).toBeNull()
  })

  it('names the one channel in the singular and says where to remove it', () => {
    expect(deleteBlocker(1)).toBe('This product still has 1 connected channel. Remove it on the Channels tab first.')
  })

  it('writes the plural properly, never "channel(s)"', () => {
    expect(deleteBlocker(2)).toBe('This product still has 2 connected channels. Remove them on the Channels tab first.')
    expect(deleteBlocker(12)).toBe('This product still has 12 connected channels. Remove them on the Channels tab first.')
    expect(deleteBlocker(2)).not.toMatch(/\(s\)/)
  })
})

describe('"Open browser" where channels are chosen or shown (DEC-028)', () => {
  const info = (over: Partial<PlatformInfo>): PlatformInfo => ({ connectorId: 'x', platform: 'reddit', label: 'Reddit', prepared: true, loginUrl: 'https://www.reddit.com/login', ...over })
  const reddit = info({ browseUrl: 'https://www.reddit.com/subreddits/', handleUrl: undefined })
  const facebook = info({ platform: 'facebook', label: 'Facebook', prepared: false, browseUrl: 'https://www.facebook.com/groups/discover/', handleUrl: 'https://www.facebook.com/{handle}' })
  const site = info({ platform: 'web', label: 'Other website', prepared: false })
  const platforms = [reddit, facebook, site]
  const account = (id: string, platform: string): Account =>
    ({ id, platform, label: id, identity: null, partition: 'p', status: 'ready', createdAt: '', productId: null, role: null, loginName: null, email: null, mailboxId: null, browser: 'internal', signsInVia: null, profileId: null }) as Account

  describe('what a control shows', () => {
    it('is the button unless the owner holds the account\'s browser', () => {
      expect(openMode(undefined, false)).toBe('closed')
      expect(openMode('none', true)).toBe('closed')
      expect(openMode('agent', true)).toBe('closed')
    })

    it('is the block in the control that shows it while the owner holds the browser, and the button switched off in the others', () => {
      expect(openMode('user', true)).toBe('open')
      expect(openMode('user', false)).toBe('elsewhere')
    })

    it('shows the block once for an account: in the pressed control, or in the first one when the pressed one is not on the screen', () => {
      expect(blockHolder('b', ['a', 'b', 'c'])).toBe('b')
      expect(blockHolder(null, ['a', 'b'])).toBe('a')
      expect(blockHolder('gone', ['a', 'b'])).toBe('a')
      expect(blockHolder('a', [])).toBeNull()
      expect(blockHolder(null, [])).toBeNull()
    })
  })

  describe('why the button is off', () => {
    it('is on when nothing speaks against it', () => {
      expect(openBlocker({ aiWorking: false, mode: 'closed' })).toBeNull()
      expect(openBlocker({ aiWorking: false, mode: 'closed', hostReason: null })).toBeNull()
    })

    it('says the AI works on the account, because its browser cannot be taken from under it', () => {
      expect(openBlocker({ aiWorking: true, mode: 'closed' })).toBe(AI_WORKING)
      expect(AI_WORKING).toContain('AI is working on this account')
    })

    it('says the browser is open already when another control of the screen opened it', () => {
      expect(openBlocker({ aiWorking: false, mode: 'elsewhere' })).toBe(OPEN_ALREADY)
    })

    it('says the screen\'s own reason when there is no other', () => {
      expect(openBlocker({ aiWorking: false, mode: 'closed', hostReason: TYPE_ADDRESS_FIRST })).toBe(TYPE_ADDRESS_FIRST)
    })

    it('puts the account\'s own state before the screen\'s reason', () => {
      expect(openBlocker({ aiWorking: true, mode: 'closed', hostReason: TYPE_ADDRESS_FIRST })).toBe(AI_WORKING)
      expect(openBlocker({ aiWorking: true, mode: 'elsewhere', hostReason: TYPE_ADDRESS_FIRST })).toBe(OPEN_ALREADY)
    })
  })

  describe('the Connect form', () => {
    it('opens a platform that has a browse page with nothing typed', () => {
      expect(browseBlocker(reddit, '')).toBeNull()
      expect(browseAddress(reddit, '')).toBeUndefined()
      expect(browseAddress(reddit, '   ')).toBeUndefined()
    })

    it('has nothing to open on an unknown site until an address is typed', () => {
      expect(browseBlocker(site, '')).toBe(TYPE_ADDRESS_FIRST)
      expect(browseBlocker(site, '  ')).toBe(TYPE_ADDRESS_FIRST)
      expect(browseBlocker(site, 'https://forum.example.com/c/general')).toBeNull()
    })

    it('treats a platform with an empty browse page as one without', () => {
      expect(browseBlocker(info({ browseUrl: '' }), '')).toBe(TYPE_ADDRESS_FIRST)
    })

    it('does not say "type the address" before the platform list has arrived', () => {
      expect(browseBlocker(undefined, '')).toBeNull()
    })

    it('hands the core what was typed, trimmed, and a handle as the address it stands for', () => {
      expect(browseAddress(reddit, '  r/astrology ')).toBe('r/astrology')
      expect(browseAddress(facebook, '@natalmystic')).toBe('https://www.facebook.com/natalmystic')
    })

    it('names the platform, and the one button that brings the address back', () => {
      expect(browseHint(reddit)).toBe('Opens Reddit in this account’s own browser, signed in as it. Find the place there, then press “Use the page I’m on”.')
      expect(browseHint(undefined)).toContain('Opens the site in')
    })
  })

  describe('an account row', () => {
    it('can be opened where the platform has a browse page', () => {
      expect(rowBlocker(reddit)).toBeNull()
      expect(rowBlocker(undefined)).toBeNull()
    })

    it('says an unknown site has no page that lists channels, and where to type its address', () => {
      expect(rowBlocker(site)).toBe(NO_BROWSE_PAGE)
      expect(NO_BROWSE_PAGE).toContain('connect a channel')
    })

    it('treats a platform with an empty browse page as one without', () => {
      expect(rowBlocker(info({ browseUrl: '' }))).toBe(NO_BROWSE_PAGE)
    })
  })

  describe('"Use the page I\'m on"', () => {
    it('hands over the address of the page', () => {
      expect(pageResult({ url: 'https://www.reddit.com/r/astrology/', title: 'Astrology', trimmed: false })).toEqual({ address: 'https://www.reddit.com/r/astrology/', note: null })
      expect(pageResult({ url: 'https://www.reddit.com/r/astrology/', title: 'Astrology', trimmed: true })).toEqual({ address: 'https://www.reddit.com/r/astrology/', note: ADDRESS_SHORTENED })
    })

    it('says no page is open when the core answers with none, or an empty address', () => {
      expect(pageResult(null)).toEqual({ note: NO_PAGE_OPEN })
      expect(pageResult({ url: '  ', title: '' })).toEqual({ note: NO_PAGE_OPEN })
      expect(NO_PAGE_OPEN).toBe('No page is open in the browser yet.')
    })
  })

  describe('which account looks at a suggested channel', () => {
    const idea = (platform: string, target = 'r/astrology') => ({ platform, target, reason: 'x' })

    it('is the first account on the idea\'s platform, the product\'s own before the rest of the library', () => {
      const accounts = [account('mine-fb', 'facebook'), account('mine-reddit', 'reddit'), account('lib-reddit', 'reddit')]
      expect(accountForIdea(idea('reddit'), platforms, accounts)?.id).toBe('mine-reddit')
      expect(accountForIdea(idea('facebook'), platforms, accounts)?.id).toBe('mine-fb')
    })

    it('falls back to the rest of the library when the product has none there', () => {
      const accounts = [account('mine-fb', 'facebook'), account('lib-reddit', 'reddit')]
      expect(accountForIdea(idea('reddit'), platforms, accounts)?.id).toBe('lib-reddit')
    })

    it('offers nothing when no account is on that platform', () => {
      expect(accountForIdea(idea('reddit'), platforms, [account('fb', 'facebook')])).toBeUndefined()
      expect(accountForIdea(idea('reddit'), platforms, [])).toBeUndefined()
    })

    it('looks at a site the app has no connector for with an account of the universal platform', () => {
      expect(accountForIdea(idea('other', 'https://forum.example.com/'), platforms, [account('w', 'web'), account('r', 'reddit')])?.id).toBe('w')
      expect(accountForIdea(idea('some-unknown-key', 'https://forum.example.com/'), platforms, [account('r', 'reddit')])).toBeUndefined()
    })
  })

  describe('while the owner works in the window', () => {
    it('says the app waits, and what ends it', () => {
      expect(holdingNote(true)).toContain('so the app waits')
      expect(holdingNote(true)).toContain('Done, close the window')
    })

    it('says the browser was taken over when there is no window to show', () => {
      expect(holdingNote(false)).toContain('took over')
      expect(holdingNote(false)).not.toContain('Done, close the window')
    })
  })
})

describe('the Membership row of "What this account can do here" (DEC-029)', () => {
  const STATUSES = ['verified', 'needs_check', 'needs_user', 'unavailable', 'restricted'] as const

  it('puts Membership first, since it explains what the rows below it can read', () => {
    expect(CAPABILITY_ORDER[0]).toBe('membership')
    expect(CAPABILITY_LABEL.membership).toBe('Membership')
    expect(new Set(CAPABILITY_ORDER).size).toBe(CAPABILITY_ORDER.length)
    expect(CAPABILITY_ORDER).toHaveLength(9)
  })

  it('says Member, Not joined, Needs you, Unavailable and Banned for its states, and nothing else changes its words', () => {
    expect(STATUSES.map((s) => abilityStatusLabel('membership', s))).toEqual(['Member', 'Not joined', 'Needs you', 'Unavailable', 'Banned'])
    expect(STATUSES.map((s) => abilityStatusLabel('read_posts', s))).toEqual(['Verified', 'Needs verification', 'Needs you', 'Unavailable', 'Restricted by rules'])
    for (const key of CAPABILITY_ORDER.filter((k) => k !== 'membership')) {
      expect(abilityStatusLabel(key, 'verified')).toBe('Verified')
      expect(abilityStatusLabel(key, 'needs_check')).toBe('Needs verification')
    }
  })

  it('makes only "Not joined" a tag for the owner to decide on', () => {
    expect(abilityNeedsDecision('membership', 'needs_check')).toBe(true)
    expect(abilityNeedsDecision('membership', 'needs_check', '2026-11-15T10:00:00.000Z')).toBe(true)
    // a row nobody checked is not an account found to be outside the community
    expect(abilityNeedsDecision('membership', 'needs_check', null)).toBe(false)
    expect(abilityStatusLabel('membership', 'needs_check', null)).toBe('Not checked yet')
    expect(abilityStatusLabel('membership', 'needs_check', '2026-11-15T10:00:00.000Z')).toBe('Not joined')
    expect(abilityStatusLabel('read_posts', 'needs_check', null)).toBe('Needs verification')
    for (const status of ['verified', 'needs_user', 'unavailable', 'restricted'] as const) expect(abilityNeedsDecision('membership', status)).toBe(false)
    for (const key of CAPABILITY_ORDER.filter((k) => k !== 'membership')) expect(abilityNeedsDecision(key, 'needs_check')).toBe(false)
  })

  it('shows the row only for a platform that can tell whether the account joined', () => {
    expect(capabilityRows({ canJoin: true })).toEqual(CAPABILITY_ORDER)
    expect(capabilityRows({ canJoin: false })).not.toContain('membership')
    expect(capabilityRows({})).not.toContain('membership')
    expect(capabilityRows(undefined)).not.toContain('membership')
    expect(capabilityRows(undefined)).toEqual(CAPABILITY_ORDER.filter((k) => k !== 'membership'))
  })

  it('says "Not checked yet" for a channel that was never assessed, and the word of the state otherwise', () => {
    expect(membershipWord(undefined)).toBe('Not checked yet')
    expect(membershipWord({ status: 'needs_check', checkedAt: null })).toBe('Not checked yet')
    expect(membershipWord({ status: 'needs_check', checkedAt: '2026-11-15T10:00:00.000Z' })).toBe('Not joined')
    expect(membershipWord({ status: 'verified', checkedAt: '2026-11-15T10:00:00.000Z' })).toBe('Member')
    expect(membershipWord({ status: 'restricted', checkedAt: '2026-11-15T10:00:00.000Z' })).toBe('Banned')
  })
})

describe('"Let the AI join" on the channel card (DEC-029)', () => {
  const run = (over: Partial<AgentRun> = {}): AgentRun => ({
    accountId: 'a1',
    kind: 'join',
    channelId: 'c1',
    status: 'running',
    summary: 'The AI is opening the community page.',
    lines: [],
    typed: [],
    question: null,
    learned: [],
    startedAt: '2026-11-15T10:00:00.000Z',
    finishedAt: null,
    ...over
  })
  const base = { platformCanJoin: true, membershipStatus: 'needs_check' as const, readiness: { ready: true, reason: null }, run: null, channelId: 'c1', ownerHolds: false }

  it('names the community the way the card does, once', () => {
    expect(joinLabel('r/astrology')).toBe('Let the AI join r/astrology')
    expect(joinLabel('  r/astrology ')).toBe('Let the AI join r/astrology')
    expect(joinLabel('r/astrology')).not.toContain('r/r/')
  })

  it('says what it does, and that the app never joins on its own', () => {
    expect(JOIN_NOTE).toContain('presses Join, nothing else')
    expect(JOIN_NOTE).toContain('You can stop it any time')
    expect(JOIN_NOTE).toContain('never joins on its own')
  })

  it('is on, with no reason, for an account that has not joined and can start', () => {
    expect(joinButton(base)).toEqual({ show: true, enabled: true, reason: null, runPanel: false })
  })

  it('is on for a channel that was never assessed (its membership is not known yet), and while the readiness is still loading', () => {
    expect(joinButton({ ...base, membershipStatus: undefined }).show).toBe(true)
    expect(joinButton({ ...base, membershipStatus: null }).show).toBe(true)
    expect(joinButton({ ...base, readiness: undefined })).toMatchObject({ show: true, enabled: true, reason: null })
  })

  it('is not there for a platform that cannot tell whether the account joined, nor for a member', () => {
    expect(joinButton({ ...base, platformCanJoin: false })).toEqual({ show: false, enabled: false, reason: null, runPanel: false })
    expect(joinButton({ ...base, membershipStatus: 'verified' })).toEqual({ show: false, enabled: false, reason: null, runPanel: false })
  })

  it('is there, off, with the reason the core gives for a banned account or one that cannot start', () => {
    const banned = joinButton({ ...base, membershipStatus: 'restricted', readiness: { ready: false, reason: 'Boris is banned from r/x.' } })
    expect(banned).toEqual({ show: true, enabled: false, reason: 'Boris is banned from r/x.', runPanel: false })
    expect(joinButton({ ...base, readiness: { ready: false, reason: 'No AI engine is selected.' } }).reason).toBe('No AI engine is selected.')
  })

  it('is off while the owner holds the browser of the account, and says to close the window first', () => {
    expect(joinButton({ ...base, ownerHolds: true })).toEqual({ show: true, enabled: false, reason: JOIN_OWNER_HOLDS, runPanel: false })
    expect(JOIN_OWNER_HOLDS).toContain('Done')
  })

  it('is off while another run works on the account, with that as the reason', () => {
    const other = run({ kind: 'profile', channelId: undefined })
    expect(joinButton({ ...base, run: other })).toEqual({ show: true, enabled: false, reason: JOIN_OTHER_RUN, runPanel: false })
    const elsewhere = run({ channelId: 'c2' })
    expect(joinButton({ ...base, run: elsewhere })).toEqual({ show: true, enabled: false, reason: JOIN_OTHER_RUN, runPanel: false })
  })

  it('shows the run of this channel in a panel instead of a reason, off while it works', () => {
    expect(joinButton({ ...base, run: run() })).toEqual({ show: true, enabled: false, reason: null, runPanel: true })
  })

  it('keeps how the run of the channel ended on the screen after the button went (the channel was assessed again and the account is a member)', () => {
    const done = run({ status: 'done', summary: 'Joined r/astrology.', finishedAt: '2026-11-15T10:01:00.000Z' })
    expect(joinButton({ ...base, membershipStatus: 'verified', run: done })).toEqual({ show: false, enabled: false, reason: null, runPanel: true })
    // and a finished run that did not join leaves the button on, ready to be pressed again
    const needsYou = run({ status: 'needs_owner', summary: 'The community asks for a request to join.' })
    expect(joinButton({ ...base, run: needsYou })).toEqual({ show: true, enabled: true, reason: null, runPanel: true })
  })

  it('does not show a run panel on a platform that cannot join, and does not take the run of another channel or another kind for its own', () => {
    expect(joinButton({ ...base, platformCanJoin: false, run: run() }).runPanel).toBe(false)
    expect(isJoinRunOf(run(), 'c1')).toBe(true)
    expect(isJoinRunOf(run({ channelId: 'c2' }), 'c1')).toBe(false)
    expect(isJoinRunOf(run({ kind: 'signin' }), 'c1')).toBe(false)
    expect(isJoinRunOf(null, 'c1')).toBe(false)
    expect(isJoinRunOf(undefined, 'c1')).toBe(false)
  })
})

describe('taking an item out of the queue', () => {
  it('deletes a post of the owner and rejects a reply, each in its own words', () => {
    expect(removalWords('standalone')).toMatchObject({ label: 'Delete', list: 'Deleted' })
    expect(removalWords('standalone').question).toMatch(/Nothing was sent/)
    expect(removalWords('reply')).toMatchObject({ label: 'Reject', list: 'Rejected' })
  })
})

describe('one post for several channels: the group card and its main action (DEC-032)', () => {
  /** A version as the screen gets it: only what the rules read. */
  const version = (id: string, state: OpportunityState, extra: { approved?: boolean; draftId?: string | null; platform?: string; target?: string } = {}): PostVersion =>
    ({
      card: {
        opportunity: { id, state, kind: 'standalone', groupId: 'g1' },
        channelPlatform: extra.platform ?? 'reddit',
        channelTarget: extra.target ?? 'r/test',
        draft: extra.draftId === null ? null : { id: extra.draftId ?? `d-${id}` },
        approval: extra.approved ? { id: `a-${id}` } : null
      } as unknown as OpportunityCard,
      problems: [],
      edited: false,
      way: 'connector'
    }) as PostVersion
  const approved = (id: string): PostVersion => version(id, 'ready', { approved: true })
  const open = (id: string): PostVersion => version(id, 'awaiting_approval')
  const group = (master: Partial<PostGroup['master']>): PostGroup => ({ id: 'g1', productId: 'p1', createdAt: '2026-11-15T10:00:00.000Z', master: { title: null, text: '', link: null, attachments: [], markup: 'markdown', ...master } })

  it('names a group by the title of the master, else by its first words', () => {
    expect(groupTitle(group({ title: ' Launch day ', text: 'ignored' }))).toBe('Launch day')
    expect(groupTitle(group({ text: 'We are live today.\n\nCome and see it' }))).toBe('We are live today. Come and see it')
    expect(groupTitle(group({ text: 'one two three four five six seven eight nine ten' }))).toBe('one two three four five six seven eight…')
    expect(groupTitle(group({ text: '' }))).toBe('Post for several channels')
    expect(groupTitle(group({ text: 'x'.repeat(200) })).length).toBeLessThanOrEqual(81)
  })

  it('counts channels and names a version by its platform and place, as the core names it in its reports', () => {
    expect(channelCount(1)).toBe('1 channel')
    expect(channelCount(3)).toBe('3 channels')
    expect(versionLabel(version('a', 'draft', { platform: 'threads', target: '@brand' }).card)).toBe('Threads @brand')
  })

  it('says how a version goes out, in the words of the screen', () => {
    expect(wayLine('connector')).toBe('Goes out by: connector')
    expect(wayLine('ai_browser')).toBe("Goes out by: the AI in the account's browser: you press Send")
  })

  it('builds `seen` from the draft each card on the screen shows, and leaves out a version with no draft', () => {
    const versions = [version('a', 'draft', { draftId: 'da' }), version('b', 'draft', { draftId: 'db' }), version('c', 'draft', { draftId: null })]
    expect(seenOf(versions)).toEqual({ a: 'da', b: 'db' })
    expect(seenOf([])).toEqual({})
  })

  it('offers "Send all now" once every version that can still go is approved, "Approve all" otherwise, and nothing once all are out', () => {
    expect(groupMain([open('a'), open('b')])).toBe('approve')
    expect(groupMain([approved('a'), open('b')])).toBe('approve')
    expect(groupMain([approved('a'), approved('b')])).toBe('send')
    // a version that is out does not hold the others back from "Send all now"
    expect(groupMain([approved('a'), version('b', 'confirmed')])).toBe('send')
    expect(groupMain([open('a'), version('b', 'confirmed')])).toBe('approve')
    expect(groupMain([version('a', 'confirmed'), version('b', 'sending')])).toBeNull()
    expect(groupMain([])).toBeNull()
  })

  it('does not count a version as approved unless it is ready and carries its approval', () => {
    expect(groupMain([version('a', 'ready', { approved: false })])).toBe('approve')
    expect(groupMain([version('a', 'awaiting_approval', { approved: true })])).toBe('approve')
  })

  it('counts what the buttons say: the versions that can still be approved, and the ones that would go', () => {
    const versions = [approved('a'), open('b'), version('c', 'confirmed'), approved('d')]
    expect(approveAllLabel(versions)).toBe('Approve all 3')
    expect(sendAllLabel(versions)).toBe('Send all now (2)')
    expect(sendAllLabel([open('a')])).toBe('Send all now (0)')
  })

  it('refuses to approve, adapt or send while a step runs or a version holds changes that are not saved, and says so', () => {
    expect(stepBlocker({ working: false, unsaved: [] })).toBeNull()
    expect(stepBlocker({ working: true, unsaved: [] })).toMatch(/step that is running/)
    expect(stepBlocker({ working: false, unsaved: ['Reddit r/test'] })).toBe('Save your changes to Reddit r/test first.')
    expect(stepBlocker({ working: false, unsaved: ['Reddit r/test', 'Threads @brand'] })).toBe('Save your changes to Reddit r/test and Threads @brand first.')
    expect(stepBlocker({ working: false, unsaved: ['A', 'B', 'C'] })).toBe('Save your changes to A, B and C first.')
    const calm = { working: false, unsaved: [] }
    expect(sendBlocker([open('a'), open('b')], calm)).toBe(NOT_APPROVED_YET)
    expect(sendBlocker([approved('a'), open('b')], calm)).toBeNull()
    expect(sendBlocker([approved('a')], { working: false, unsaved: ['Reddit r/test'] })).toMatch(/Save your changes/)
    expect(sendBlocker([approved('a')], { working: true, unsaved: [] })).toMatch(/step that is running/)
  })

  it('shows one reason beside the buttons: the one that holds back the first button that is off', () => {
    expect(reasonBeside(null, NOT_APPROVED_YET)).toBe(NOT_APPROVED_YET)
    expect(reasonBeside('Save your changes to A first.', NOT_APPROVED_YET)).toBe('Save your changes to A first.')
    expect(reasonBeside(null, null)).toBeNull()
  })

  it('says which step a slow call is on', () => {
    const versions = [approved('a'), approved('b'), open('c')]
    expect(stepLabel('send', versions)).toMatch(/^Sending to 2 channels…/)
    expect(stepLabel('send', [approved('a')])).toMatch(/^Sending to 1 channel…/)
    expect(stepLabel('adapt', versions)).toBe('Adapting for 3 channels…')
    expect(stepLabel('approve', versions)).toBe('Approving 3 versions…')
  })

  it('writes a headline for what a step did, and counts warnings so a skipped or failed version is never silent', () => {
    const result = (status: PostGroupResult['status']): PostGroupResult => ({ opportunityId: status, channelLabel: 'Reddit r/test', status, reason: 'why' })
    expect(resultsHeadline('approve', [result('done'), result('skipped')])).toBe('Approved 1 of 2 versions.')
    expect(resultsHeadline('send', [result('done')])).toBe('Sent 1 of 1 version.')
    expect(resultsHeadline('adapt', [result('failed'), result('failed')])).toBe('Adapted 0 of 2 versions.')
    expect(resultsHeadline('adapt', [])).toBe('Nothing was adapted.')
    expect(hasWarnings([result('done')])).toBe(false)
    expect(hasWarnings([result('done'), result('skipped')])).toBe(true)
    expect(hasWarnings([result('failed')])).toBe(true)
  })

  it('stamps a group so a report is dropped once any version changes its state or its draft', () => {
    const before = [approved('a'), open('b')]
    expect(groupStamp(before)).toBe(groupStamp([approved('a'), open('b')]))
    expect(groupStamp(before)).not.toBe(groupStamp([approved('a'), approved('b')]))
    expect(groupStamp(before)).not.toBe(groupStamp([approved('a'), version('b', 'awaiting_approval', { draftId: 'newer' })]))
  })

  it('a group takes part in the one filled button like a card: the first in the order that offers one owns it, and a group that offers none hands it on', () => {
    // the order the screen gives: its groups first, then its single posts
    const order = ['group-1', 'group-2', 'post-1', 'post-2']
    expect(mainOwner(order, new Set(['group-1', 'post-1']))).toBe('group-1')
    expect(mainOwner(order, new Set(['group-2', 'post-1']))).toBe('group-2')
    expect(mainOwner(order, new Set(['post-2', 'post-1']))).toBe('post-1')
    // every version of a group is outside the order, so none of them can ever own it, whatever it offers
    expect(mainOwner(order, new Set(['version-of-group-1']))).toBeUndefined()
    expect(mainOwner(order, new Set())).toBeUndefined()
  })

  it('"Also post to…" is offered on a post of the owner that has text and is not in a group, not on a reply, a group version or a post in flight', () => {
    const card = (state: OpportunityState, extra: Record<string, unknown> = {}): Pick<OpportunityCard, 'opportunity' | 'draft'> =>
      ({ opportunity: { state, kind: 'standalone', groupId: null, ...extra }, draft: { id: 'd' } }) as unknown as Pick<OpportunityCard, 'opportunity' | 'draft'>
    for (const state of ['draft', 'awaiting_approval', 'ready', 'confirmed'] as OpportunityState[]) expect(alsoPostAllowed(card(state))).toBe(true)
    for (const state of ['sending', 'unknown_result', 'cancelled', 'analyzing'] as OpportunityState[]) expect(alsoPostAllowed(card(state))).toBe(false)
    expect(alsoPostAllowed(card('draft', { kind: 'reply' }))).toBe(false)
    expect(alsoPostAllowed(card('draft', { groupId: 'g1' }))).toBe(false)
    expect(alsoPostAllowed({ ...card('draft'), draft: null })).toBe(false)
  })

  it("asks about the post's own text as the draft", () => {
    const draft = { id: 'd', title: 'T', text: 'Body', link: 'https://example.com', attachments: [], markup: 'markdown' } as unknown as Parameters<typeof draftInputOf>[0]
    expect(draftInputOf(draft)).toEqual({ title: 'T', text: 'Body', link: 'https://example.com', attachments: [], markup: 'markdown' })
  })
})

describe('"Where to post": the ticks and what Save does with them (DEC-032)', () => {
  const option = (channelId: string, extra: Partial<GroupChannelOption> = {}): GroupChannelOption => ({
    channelId,
    platform: 'reddit',
    target: `r/${channelId}`,
    accountLabel: `account ${channelId}`,
    fits: true,
    reason: 'Reddit takes it as written.',
    suggested: true,
    ...extra
  })
  const own = { channelId: 'a', platform: 'reddit', target: 'r/a', accountLabel: 'me' }

  it('lists nothing until the core has answered', () => {
    expect(whereRows(undefined, ['a'], own)).toBeUndefined()
  })

  it('keeps the order the core ranked, marks as suggested only a channel that fits and is not ticked, and ticks nothing', () => {
    const rows = whereRows([option('a'), option('b'), option('c', { fits: false, suggested: false, reason: 'Instagram needs a picture.' })], ['a'], own) ?? []
    expect(rows.map((r) => r.channelId)).toEqual(['a', 'b', 'c'])
    expect(rows.map((r) => r.suggested)).toEqual([false, true, false])
    expect(rows[2]).toMatchObject({ fits: false, reason: 'Instagram needs a picture.', listed: true })
    // the owner ticks b: it is no longer a suggestion
    expect((whereRows([option('a'), option('b')], ['a', 'b'], own) ?? []).map((r) => r.suggested)).toEqual([false, false])
  })

  it("shows the screen's own channel as a row of its own when posting is off there, and never when it is listed or left out on purpose", () => {
    const rows = whereRows([option('b')], ['a'], own) ?? []
    expect(rows.map((r) => r.channelId)).toEqual(['a', 'b'])
    expect(rows[0]).toMatchObject({ listed: false, fits: false, reason: CANNOT_POST_REASON, suggested: false, accountLabel: 'me' })
    expect(whereRows([option('a'), option('b')], ['a'], own)?.filter((r) => r.channelId === 'a')).toHaveLength(1)
    // "Also post to…" does not offer the channel the post is already in
    expect((whereRows([option('a'), option('b')], [], undefined, ['a']) ?? []).map((r) => r.channelId)).toEqual(['b'])
    expect((whereRows([option('b')], [], own, ['a']) ?? []).map((r) => r.channelId)).toEqual(['b'])
  })

  it('one tick saves one post of its own channel, as before; two or more save one post for several channels', () => {
    const rows = whereRows([option('a'), option('b'), option('c')], [], own)
    expect(saveIntent(['a'], rows)).toEqual({ kind: 'single', channelId: 'a' })
    expect(saveIntent(['b'], rows)).toEqual({ kind: 'single', channelId: 'b' })
    expect(saveIntent(['a', 'c'], rows)).toEqual({ kind: 'group', channelIds: ['a', 'c'] })
    expect(saveIntent(['c', 'a', 'b'], rows)).toEqual({ kind: 'group', channelIds: ['c', 'a', 'b'] })
    expect(saveIntent([], rows)).toEqual({ kind: 'none', reason: CHOOSE_A_CHANNEL })
  })

  it('before the channels are known the form still saves for the channel it opened on', () => {
    expect(saveIntent(['a'], undefined)).toEqual({ kind: 'single', channelId: 'a' })
  })

  it('a channel that cannot post now may still be saved alone as a draft, but is never silently dropped from a group', () => {
    const rows = whereRows([option('b')], [], own)
    expect(saveIntent(['a'], rows)).toEqual({ kind: 'single', channelId: 'a' })
    const refused = saveIntent(['a', 'b'], rows)
    expect(refused.kind).toBe('none')
    expect(refused.kind === 'none' && refused.reason).toBe('Reddit r/a cannot be part of a post for several channels now. Untick it.')
    // unticked, the others go as a group
    expect(saveIntent(['b'], rows)).toEqual({ kind: 'single', channelId: 'b' })
  })

  it('ignores a tick for a channel that is not listed any more, and counts a channel once', () => {
    const rows = whereRows([option('a'), option('b')], [], own)
    expect(saveIntent(['a', 'gone'], rows)).toEqual({ kind: 'single', channelId: 'a' })
    expect(saveIntent(['a', 'a'], rows)).toEqual({ kind: 'single', channelId: 'a' })
  })

  it('the one button slot says what it does with the number of channels', () => {
    expect(saveLabel({ kind: 'single', channelId: 'a' })).toBe('Save as draft')
    expect(saveLabel({ kind: 'none', reason: CHOOSE_A_CHANNEL })).toBe('Save as draft')
    expect(saveLabel({ kind: 'group', channelIds: ['a', 'b'] })).toBe('Save for 2 channels')
    expect(saveLabel({ kind: 'group', channelIds: ['a', 'b', 'c'] })).toBe('Save for 3 channels')
    expect(extendLabel(0)).toBe('Save for more channels')
    expect(extendLabel(1)).toBe('Save for 1 more channel')
    expect(extendLabel(2)).toBe('Save for 2 more channels')
  })

  it('a tick toggles one channel and keeps the order of the others', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggled(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(toggled([], 'a')).toEqual(['a'])
  })
})


describe('the content mix card of a channel (DEC-033)', () => {
  const NOW = Date.parse('2026-11-15T12:00:00.000Z')
  const kind = (patch: Partial<MixKindCard> & Pick<MixKindCard, 'kind'>): MixKindCard => ({ enabled: false, everyDays: 14, lastDraftAt: null, nextAt: null, problem: null, ...patch })
  /** What the core sends for a channel that never had a mix: all three kinds, off, each with its usual rhythm. */
  const emptyCard = (): Pick<MixCard, 'kinds'> => ({ kinds: [kind({ kind: 'product_post', everyDays: 14 }), kind({ kind: 'own_update', everyDays: 7 }), kind({ kind: 'showcase', everyDays: 30 })] })
  const saved = formFromCard(emptyCard())
  const options = { locale: 'en-US', timeZone: 'UTC' }

  describe('the form', () => {
    it('has the three kinds in the card order, off, with the rhythm the core gives each', () => {
      expect(MIX_KINDS).toEqual(['product_post', 'own_update', 'showcase'])
      expect(saved).toEqual([
        { kind: 'product_post', enabled: false, days: '14' },
        { kind: 'own_update', enabled: false, days: '7' },
        { kind: 'showcase', enabled: false, days: '30' }
      ])
    })

    it('shows the saved kinds as they are, whatever order the core lists them in', () => {
      const form = formFromCard({ kinds: [kind({ kind: 'showcase', enabled: true, everyDays: 21 }), kind({ kind: 'product_post', enabled: true, everyDays: 3 }), kind({ kind: 'own_update', everyDays: 7 })] })
      expect(form.map((r) => r.kind)).toEqual(['product_post', 'own_update', 'showcase'])
      expect(form).toEqual([
        { kind: 'product_post', enabled: true, days: '3' },
        { kind: 'own_update', enabled: false, days: '7' },
        { kind: 'showcase', enabled: true, days: '21' }
      ])
    })

    it('stays total when the core leaves a kind out: the kind is off with its usual rhythm', () => {
      expect(formFromCard({ kinds: [] })).toEqual(saved)
    })

    it('is not dirty while it is the saved mix, and is dirty when a kind or its days change', () => {
      expect(formDirty(saved, saved)).toBe(false)
      expect(formDirty(withRow(saved, 'showcase', { enabled: true }), saved)).toBe(true)
      expect(formDirty(withRow(saved, 'showcase', { days: '31' }), saved)).toBe(true)
      expect(formDirty(withRow(withRow(saved, 'showcase', { days: '31' }), 'showcase', { days: '30' }), saved)).toBe(false)
    })

    it('reads the days as a number, so " 14 " and "014" are the saved 14, not a change', () => {
      expect(formDirty(withRow(saved, 'product_post', { days: ' 14 ' }), saved)).toBe(false)
      expect(formDirty(withRow(saved, 'product_post', { days: '014' }), saved)).toBe(false)
    })

    it('an unreadable number is a change from the saved one, so it is never hidden as "nothing changed"', () => {
      const bad = withRow(saved, 'product_post', { days: '' })
      expect(formDirty(bad, saved)).toBe(true)
      expect(rowChanged(bad[0], saved[0])).toBe(true)
    })

    it('accepts whole days from 1 to 90 and nothing else', () => {
      for (const ok of ['1', '7', '90', ' 30 ', '007']) expect(parseDays(ok)).not.toBeNull()
      for (const bad of ['', ' ', '0', '91', '100', '1000', '-1', '1.5', '1,5', '7d', 'abc', '1e1', '+7']) expect(parseDays(bad)).toBeNull()
      expect(parseDays('90')).toBe(90)
      expect(parseDays('1')).toBe(1)
      expect(daysProblem({ days: '0' })).toBe(DAYS_PROBLEM)
      expect(daysProblem({ days: '12' })).toBeNull()
      expect(DAYS_PROBLEM).toBe('Use a whole number of days from 1 to 90.')
    })

    it('is valid only while every row is valid, a kind that is off included (the core checks all of them)', () => {
      expect(formValid(saved)).toBe(true)
      expect(formValid(withRow(saved, 'showcase', { days: '91' }))).toBe(false)
      expect(formValid(withRow(withRow(saved, 'showcase', { enabled: true }), 'own_update', { days: 'x' }))).toBe(false)
    })

    it('becomes the settings the core takes: every kind once, off ones with their rhythm, whole numbers', () => {
      const form = withRow(withRow(saved, 'product_post', { enabled: true, days: ' 10 ' }), 'own_update', { enabled: true })
      expect(settingsFromForm(form)).toEqual<MixSetting[]>([
        { kind: 'product_post', enabled: true, everyDays: 10 },
        { kind: 'own_update', enabled: true, everyDays: 7 },
        { kind: 'showcase', enabled: false, everyDays: 30 }
      ])
      expect(settingsFromForm(withRow(form, 'showcase', { days: '0' }))).toBeNull()
    })

    it('the settings sent for the saved mix read back as the saved mix (a save and a reload change nothing)', () => {
      const form = withRow(saved, 'product_post', { enabled: true })
      const sent = settingsFromForm(form)
      expect(sent).not.toBeNull()
      const reloaded = formFromCard({ kinds: (sent ?? []).map((entry) => kind(entry)) })
      expect(sameForm(reloaded, form)).toBe(true)
      expect(formDirty(form, reloaded)).toBe(false)
    })

    it('has a signature that changes with what is saved and ignores how the number was typed', () => {
      expect(formSignature(saved)).toBe(formSignature(withRow(saved, 'product_post', { days: ' 14 ' })))
      expect(formSignature(saved)).not.toBe(formSignature(withRow(saved, 'product_post', { enabled: true })))
      expect(formSignature(saved)).not.toBe(formSignature(withRow(saved, 'showcase', { days: '31' })))
    })

    it('withRow changes one kind and leaves the rest and the order alone', () => {
      const next = withRow(saved, 'own_update', { enabled: true })
      expect(next.map((r) => r.enabled)).toEqual([false, true, false])
      expect(next.map((r) => r.kind)).toEqual(['product_post', 'own_update', 'showcase'])
      expect(saved[1].enabled).toBe(false)
    })
  })

  describe('the AI proposal', () => {
    const proposal: MixSetting[] = [
      { kind: 'product_post', enabled: true, everyDays: 10 },
      { kind: 'showcase', enabled: true, everyDays: 21 }
    ]

    it('switches on the kinds it names with its days and switches off the others, keeping their days', () => {
      const start = withRow(withRow(saved, 'own_update', { enabled: true }), 'own_update', { days: '5' })
      expect(applyProposal(start, proposal)).toEqual([
        { kind: 'product_post', enabled: true, days: '10' },
        { kind: 'own_update', enabled: false, days: '5' },
        { kind: 'showcase', enabled: true, days: '21' }
      ])
    })

    it('is only a form: applying it makes the form dirty, and nothing is saved by it', () => {
      const applied = applyProposal(saved, proposal)
      expect(formDirty(applied, saved)).toBe(true)
      expect(formValid(applied)).toBe(true)
    })

    it('switches a kind on even when the proposal lists it as off, because a kind in the proposal is a kind to prepare', () => {
      const applied = applyProposal(saved, [{ kind: 'showcase', enabled: false, everyDays: 12 }])
      expect(applied.find((r) => r.kind === 'showcase')).toEqual({ kind: 'showcase', enabled: true, days: '12' })
    })

    it('an empty proposal switches every kind off', () => {
      const on = withRow(withRow(saved, 'product_post', { enabled: true }), 'showcase', { enabled: true })
      expect(applyProposal(on, []).every((r) => !r.enabled)).toBe(true)
    })

    it('says what it is, and says so when it changes nothing', () => {
      expect(PROPOSED_NOTE).toBe('The AI proposed this from the plan. Read it, change what you like, then save.')
      expect(proposalNote(true)).toBe(PROPOSED_NOTE)
      expect(proposalNote(false)).toBe(PROPOSED_SAME_NOTE)
    })

    it('"Undo" is offered only while the form is still exactly the proposal', () => {
      const applied = applyProposal(saved, proposal)
      const record = { before: null, applied }
      expect(canUndoProposal(applied, record)).toBe(true)
      expect(canUndoProposal(withRow(applied, 'product_post', { days: '11' }), record)).toBe(false)
      expect(canUndoProposal(applied, null)).toBe(false)
    })

    it('the proposal needs no AI when the plan already names a kind of post, and needs one when it does not', () => {
      const step = (patch: Partial<ChannelPlan['steps'][number]>): ChannelPlan['steps'][number] => ({ title: 't', detail: 'd', format: 'text', youPrepare: null, frequency: null, ...patch })
      const plan = (...steps: ChannelPlan['steps']): ChannelPlan => ({ generatedAt: '2026-11-15T00:00:00.000Z', engineId: 'claude', summary: 's', steps, watchOut: [] })
      expect(planProposesMix(null)).toBe(false)
      expect(planProposesMix(plan())).toBe(false)
      expect(planProposesMix(plan(step({})))).toBe(false)
      expect(planProposesMix(plan(step({ kind: null })))).toBe(false)
      expect(planProposesMix(plan(step({ kind: 'replies' })))).toBe(false)
      expect(planProposesMix(plan(step({ kind: 'replies' }), step({ kind: 'showcase', everyDays: 30 })))).toBe(true)
      expect(planProposesMix(plan(step({ kind: 'product_post' })))).toBe(true)
    })

    it('"Let the AI propose a mix" is off with the reason only when it would need the AI and the AI cannot be used', () => {
      const withKinds = { generatedAt: '2026-11-15T00:00:00.000Z', engineId: 'claude' as const, summary: 's', steps: [{ title: 't', detail: 'd', format: 'text' as const, youPrepare: null, frequency: null, kind: 'product_post' as const, everyDays: 14 }], watchOut: [] }
      expect(proposeBlock(withKinds, 'Choose an AI engine in Settings first.')).toBeNull()
      expect(proposeBlock(null, 'Choose an AI engine in Settings first.')).toBe('Choose an AI engine in Settings first.')
      expect(proposeBlock(null, null)).toBeNull()
    })
  })

  describe('what each kind says about itself', () => {
    const base = { now: NOW, changed: false, blocked: false, ...options }

    it('says when the last draft was prepared and about when the next is due', () => {
      const status = kindStatus(kind({ kind: 'product_post', enabled: true, lastDraftAt: '2026-11-03T09:00:00.000Z', nextAt: '2026-11-17T09:00:00.000Z' }), base)
      expect(status).toEqual({ last: 'Last draft: Nov 3', next: 'Next draft: about Nov 17', problem: null, unsaved: false })
    })

    it('says "at the next check" when the due time has come (it is not later than now)', () => {
      const soon = kindStatus(kind({ kind: 'product_post', enabled: true, nextAt: new Date(NOW).toISOString() }), base)
      expect(soon.next).toBe(NEXT_SOON)
      expect(NEXT_SOON).toBe('Next draft: at the next check, within a few minutes')
      expect(kindStatus(kind({ kind: 'product_post', enabled: true, nextAt: new Date(NOW - 5 * 60_000).toISOString() }), base).next).toBe(NEXT_SOON)
      expect(kindStatus(kind({ kind: 'product_post', enabled: true, nextAt: new Date(NOW + 1000).toISOString() }), base).next).toBe('Next draft: about Nov 15')
    })

    it('a kind that is off has no next line, and still says when it last gave a draft', () => {
      const off = kindStatus(kind({ kind: 'showcase', lastDraftAt: '2026-10-01T09:00:00.000Z' }), base)
      expect(off).toEqual({ last: 'Last draft: Oct 1', next: null, problem: null, unsaved: false })
    })

    it('a kind that never gave a draft has no last line', () => {
      expect(kindStatus(kind({ kind: 'showcase', enabled: true, nextAt: new Date(NOW).toISOString() }), base).last).toBeNull()
    })

    it('shows the core\'s problem in place of the next time', () => {
      const status = kindStatus(kind({ kind: 'own_update', enabled: true, nextAt: new Date(NOW).toISOString(), problem: 'Waiting for a note: tell what is new.' }), base)
      expect(status.problem).toBe('Waiting for a note: tell what is new.')
      expect(status.next).toBeNull()
    })

    it('a row the owner changed says it is not saved, and shows nothing the core said about the saved one', () => {
      const status = kindStatus(kind({ kind: 'own_update', enabled: true, lastDraftAt: '2026-11-03T09:00:00.000Z', nextAt: '2026-11-17T09:00:00.000Z', problem: 'Waiting for a note: tell what is new.' }), { ...base, changed: true })
      expect(status).toEqual({ last: 'Last draft: Nov 3', next: null, problem: null, unsaved: true })
      expect(NOT_SAVED_YET).toBe('Not saved yet.')
    })

    it('on a channel the mix cannot run on, no next time is promised (the card says why once)', () => {
      const status = kindStatus(kind({ kind: 'product_post', enabled: true, nextAt: new Date(NOW).toISOString() }), { ...base, blocked: true })
      expect(status.next).toBeNull()
    })

    it('puts last, next and "not saved" in one line, so a narrow card breaks it between words; nothing to say gives no line', () => {
      expect(statusLine({ last: 'Last draft: Nov 3', next: 'Next draft: about Nov 17', unsaved: false })).toBe('Last draft: Nov 3 · Next draft: about Nov 17')
      expect(statusLine({ last: 'Last draft: Nov 3', next: null, unsaved: true })).toBe('Last draft: Nov 3 · Not saved yet.')
      expect(statusLine({ last: null, next: null, unsaved: true })).toBe('Not saved yet.')
      expect(statusLine({ last: null, next: NEXT_SOON, unsaved: false })).toBe(NEXT_SOON)
      expect(statusLine({ last: null, next: null, unsaved: false })).toBeNull()
    })

    it('writes the year only when it is not the current one, and a dash for a date it cannot read', () => {
      expect(shortDate('2026-11-03T09:00:00.000Z', NOW, options)).toBe('Nov 3')
      expect(shortDate('2025-12-31T12:00:00.000Z', NOW, options)).toBe('Dec 31, 2025')
      expect(shortDate('2027-01-02T12:00:00.000Z', NOW, options)).toBe('Jan 2, 2027')
      expect(shortDate('not a date', NOW, options)).toBe('—')
    })

    it('has plain words for each kind, none of them a setting of replies', () => {
      expect(MIX_KINDS.map((k) => KIND_WORDS[k].label)).toEqual(['Post about the product', 'My update, from your notes', 'Showcase of one feature'])
      for (const k of MIX_KINDS) expect(KIND_WORDS[k].about).toMatch(/\.$/)
    })

    it('says what the monitor does with replies in each mode, as a line and not a setting', () => {
      expect(Object.keys(REPLIES_WORDS).sort()).toEqual(['approval', 'auto', 'draft', 'observe'])
      expect(repliesLine('observe')).toBe('Not part of the mix: the monitor handles them when someone writes to you. On this channel: it only watches, nothing is drafted.')
      expect(repliesLine('draft')).toContain('saves reply drafts')
      expect(repliesLine('approval')).toContain('your approval')
      expect(repliesLine('auto')).toContain('automatic replies')
    })

    it('says drafts only, how many may wait, and how many wait now', () => {
      expect(draftsOnlyLine({ cap: 3, waiting: 0 })).toBe('Drafts only: at most 3 wait for you at a time, and nothing is sent without your Approve.')
      expect(draftsOnlyLine({ cap: 3, waiting: 2 })).toBe('Drafts only: at most 3 wait for you at a time (2 waiting now), and nothing is sent without your Approve.')
    })
  })

  describe('the notes', () => {
    const note = (id: string, createdAt: string, used = false, failedTries = 0): ProductUpdate => ({ id, productId: 'p', text: `note ${id}`, createdAt, usedInOpportunityId: used ? `op-${id}` : null, failedTries })

    it('separates the notes that can still be removed from the last three that were used, newest first', () => {
      const list = [note('a', '2026-11-14T10:00:00.000Z'), note('b', '2026-11-13T10:00:00.000Z', true), note('c', '2026-11-12T10:00:00.000Z'), note('d', '2026-11-11T10:00:00.000Z', true), note('e', '2026-11-10T10:00:00.000Z', true), note('f', '2026-11-09T10:00:00.000Z', true)]
      const { open, usable, setAside, used } = splitNotes(list)
      expect(open.map((n) => n.id)).toEqual(['a', 'c'])
      expect(usable.map((n) => n.id)).toEqual(['a', 'c'])
      expect(setAside).toEqual([])
      expect(used.map((n) => n.id)).toEqual(['b', 'd', 'e'])
    })

    it('shows no used notes when there are none, and none at all for no notes', () => {
      expect(splitNotes([])).toEqual({ open: [], usable: [], setAside: [], used: [] })
      expect(splitNotes([note('a', '2026-11-14T10:00:00.000Z')]).used).toEqual([])
    })

    it('a note the AI gave up on is not used and not usable: it stays removable, apart from the ones the AI can still write from', () => {
      const list = [note('a', '2026-11-14T10:00:00.000Z', false, NOTE_SET_ASIDE_AFTER), note('b', '2026-11-13T10:00:00.000Z', false, NOTE_SET_ASIDE_AFTER - 1), note('c', '2026-11-12T10:00:00.000Z', true, NOTE_SET_ASIDE_AFTER)]
      const { open, usable, setAside, used } = splitNotes(list)
      expect(open.map((n) => n.id)).toEqual(['a', 'b'])
      expect(usable.map((n) => n.id)).toEqual(['b'])
      expect(setAside.map((n) => n.id)).toEqual(['a'])
      expect(used.map((n) => n.id)).toEqual(['c'])
      expect(isSetAside(list[0])).toBe(true)
      expect(isSetAside(list[1])).toBe(false)
      // a used note is never "set aside", whatever it cost on the way
      expect(isSetAside(list[2])).toBe(false)
      expect(NOTE_SET_ASIDE_AFTER).toBe(3)
      expect(SET_ASIDE_WORDS).toMatch(/Remove it/)
    })

    it('counts the notes that are not used, and the ones set aside apart', () => {
      expect(unusedLabel(0)).toBe('none unused')
      expect(unusedLabel(3)).toBe('3 not used')
      expect(unusedLabel(2, 1)).toBe('2 not used, 1 set aside')
      expect(unusedLabel(0, 2)).toBe('none unused, 2 set aside')
    })

    it('a note is one line of at most 500 characters, and an empty one is refused with a reason', () => {
      expect(noteProblem('')).toBe('Write what you did, in a line or two.')
      expect(noteProblem('   \n  ')).toBe('Write what you did, in a line or two.')
      expect(noteProblem('Fixed the bug that put the birth time in the wrong place')).toBeNull()
      expect(noteProblem('x'.repeat(NOTE_MAX))).toBeNull()
      expect(noteProblem('x'.repeat(NOTE_MAX + 1))).toBe('A note is a line or two: at most 500 characters.')
      expect(NOTE_MAX).toBe(500)
    })

    it('counts a note as the core keeps it: spaces and line breaks run together, ends trimmed', () => {
      expect(normalizeNote('  Fixed   the\n bug  ')).toBe('Fixed the bug')
      // 498 + one space (the three typed ones run together) + 1 = exactly 500 as kept; one more character is over.
      expect(noteProblem(`${'x'.repeat(NOTE_MAX - 2)}   y`)).toBeNull()
      expect(noteProblem(`${'x'.repeat(NOTE_MAX - 1)}   y`)).toBe('A note is a line or two: at most 500 characters.')
    })

    it('shows the count of characters only near the limit', () => {
      expect(showNoteCount('x'.repeat(100))).toBe(false)
      expect(showNoteCount('x'.repeat(399))).toBe(false)
      expect(showNoteCount('x'.repeat(400))).toBe(true)
      expect(showNoteCount('x'.repeat(500))).toBe(true)
    })
  })
})
