// The renderer has no test runner of its own (vitest excludes src/renderer), so its pure routing rules are
// tested from here. The modules under test import only src/shared, which keeps these plain unit tests.

import { describe, expect, it } from 'vitest'
import type { Account, AnalysisStage, AttentionItem, Channel, Claim, Product } from '../shared/types'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from '../renderer/src/menu-state'
import { connectChannelHref, fixLinkFor } from '../renderer/src/pages/attention-links'
import { KIND_TONE, attentionCountTone } from '../renderer/src/pages/attention-tone'
import { startSteps } from '../renderer/src/pages/attention-start'
import { engineChoiceVariant, recommendedEngineId, splitEngineDetail } from '../renderer/src/pages/engine-detail'
import { describeSources, planStages, progressOf } from '../renderer/src/pages/products/analysis-plan'
import { launchCounts, launchProgress, launchStages } from '../renderer/src/pages/products/launch-path'
import { approvableClaims } from '../renderer/src/pages/products/model'
import { nextProductStep, passportStatus } from '../renderer/src/pages/products/product-status'
import { isMirroredSource } from '../renderer/src/pages/products/source-view'
import { suggestionBlock } from '../renderer/src/pages/channels/suggestion-block'
import { nextStep } from '../renderer/src/pages/channels/next-step'
import { platformMismatch } from '../renderer/src/pages/channels/platform-hint'
import { MOVED_PAGES, accountsNewHref, parseAccountsHash, parseHash, productHref, publicationsHref, publicationsProductOf } from '../renderer/src/route'
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
