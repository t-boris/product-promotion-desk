// The renderer has no test runner of its own (vitest excludes src/renderer), so its pure routing rules are
// tested from here. The modules under test import only src/shared, which keeps these plain unit tests.

import { describe, expect, it } from 'vitest'
import type { Account, AttentionItem, Channel, Product } from '../shared/types'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from '../renderer/src/menu-state'
import { fixLinkFor } from '../renderer/src/pages/attention-links'
import { nextStep } from '../renderer/src/pages/channels/next-step'
import { platformMismatch } from '../renderer/src/pages/channels/platform-hint'
import { MOVED_PAGES, accountsNewHref, parseAccountsHash, parseHash, productHref } from '../renderer/src/route'
import { accountText, accountsGroupName, automationText, engineGroupName } from '../renderer/src/status-labels'

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

  it('sends the old Channels and Results routes to the product list', () => {
    expect(MOVED_PAGES).toEqual({ channels: 'products', results: 'products' })
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

  it('sends a sign-in problem to the Accounts section and names the products that use the account (DEC-015)', () => {
    expect(fixLinkFor(item('account', 'a1'), sources)).toEqual({ href: '#/accounts', label: 'Open Accounts', productName: 'Natal Mystic' })
    expect(fixLinkFor(item('account', 'legacy'), sources)).toEqual({ href: '#/accounts', label: 'Open Accounts', productName: 'Other' })
  })

  it('names every product that uses a shared account, and none for an account nothing uses', () => {
    const shared = { ...sources, channels: [...sources.channels, { id: 'c4', productId: 'p1', accountId: 'legacy' } as Channel] }
    expect(fixLinkFor(item('account', 'legacy'), shared)).toMatchObject({ productName: 'Other, Natal Mystic' })
    expect(fixLinkFor(item('account', 'unused'), sources)).toEqual({ href: '#/accounts', label: 'Open Accounts', productName: null })
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
    expect(parseAccountsHash('#/accounts')).toEqual({ adding: false, role: null })
    expect(parseAccountsHash('#/accounts/new')).toEqual({ adding: true, role: null })
    expect(parseAccountsHash('#/products/p1/channels')).toEqual({ adding: false, role: null })
  })

  it('carries a role through the address, whatever characters it holds', () => {
    const role = { name: 'Astro & Co', voice: 'Calm, "plain" words: no jargon / no ?marks=1' }
    expect(parseAccountsHash(accountsNewHref(role))).toEqual({ adding: true, role })
    expect(parseAccountsHash('#/accounts/new?name=%20&voice=x')).toEqual({ adding: true, role: null })
    expect(parseAccountsHash('#/accounts?name=Dev')).toEqual({ adding: false, role: null })
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

  it('reads the automation state as one sentence, and shows an ellipsis until the state has arrived', () => {
    expect(automationText({ paused: false })).toBe('Automation running')
    expect(automationText({ paused: true })).toBe('Automation paused')
    expect(automationText(null)).toBe('Automation …')
    expect(automationText(undefined)).toBe('Automation …')
  })
})
