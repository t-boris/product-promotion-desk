// Site profiles (DEC-009): saving a reviewed profile, and preparing a draft by reading a site READ-ONLY.

import { describe, expect, it } from 'vitest'
import type { SiteProfileDraft } from '../../shared/types'
import { AiError, type ProfileAuthoring } from '../ports'
import { FakeConnector } from '../testing/fake-connector'
import { FakePage } from '../testing/fakes'
import { AccountsService } from './accounts'
import { draftSiteProfile } from './ai-help'
import { ProfileService } from './profiles'
import { OUTLINE_MAX_CHARS } from './site-outline'
import { ChannelsStore } from './store'
import { makeWorld, type World } from './test-helpers'

// ───────────── a connector that works from site profiles, with a small stand-in validator ─────────────

const GOOD = { schema: 1, name: 'Example forum', host: 'forum.example.com' }

class SiteConnector extends FakeConnector {
  readonly saved: { host: string; definition: unknown; version: number }[] = []
  readonly authoring: ProfileAuthoring & { partsOnPage(definition: unknown, url: string): { discussions: string | null; comments: string | null } } = {
    // The stand-in profile may name the item selectors it relies on; comments only matter on pages like /t/1.
    partsOnPage: (definition, url) => {
      const d = (typeof definition === 'object' && definition !== null ? definition : {}) as { discussions?: unknown; comments?: unknown }
      const pick = (value: unknown): string | null => (typeof value === 'string' ? value : null)
      return { discussions: pick(d.discussions), comments: url.includes('/t/') ? pick(d.comments) : null }
    },
    describeFormat: () => 'FORMAT: a profile has schema, name and host. Never include code.',
    validateDefinition: (definition) => {
      const d = typeof definition === 'object' && definition !== null ? (definition as Record<string, unknown>) : null
      if (!d) return { valid: false, errors: ['profile: must be an object'], summary: [], host: null }
      const errors: string[] = []
      if (d.schema !== 1) errors.push('profile.schema: must be 1')
      if (typeof d.name !== 'string') errors.push('profile.name: required')
      const host = typeof d.host === 'string' ? d.host : null
      if (host === null) errors.push('profile.host: required')
      return { valid: errors.length === 0, errors, summary: errors.length === 0 ? [`Site: ${String(d.name)} (${host})`, 'Reads discussions'] : [], host }
    },
    saveDefinition: (host, definition) => {
      const check = this.authoring.validateDefinition(definition)
      const version = this.saved.length + 1
      this.saved.push({ host, definition, version })
      return { id: `profile-${version}`, host, version, valid: check.valid, errors: check.errors }
    },
    hasValidProfile: (host) => this.saved.some((p) => p.host === host)
  }
  constructor() {
    super({ id: 'sites', platform: 'web' })
  }
}

interface SiteSpec {
  title?: string
  outline: string
  links?: { href: string; text: string }[]
}

/** A page that serves a scripted site and records every call. */
class SitePage extends FakePage {
  readonly timeouts: (number | undefined)[] = []
  onGoto: () => void = () => undefined
  failOn = new Set<string>()
  /** url → selector → how many elements match; a selector that is not listed matches nothing. */
  matches: Record<string, Record<string, number>> = {}
  /** What a count answers instead of a number (to see how an unusable answer is handled). */
  countAnswer: unknown = undefined
  constructor(readonly site: Record<string, SiteSpec>, readonly redirects: Record<string, string> = {}) {
    super()
  }
  override async goto(url: string, options?: { timeoutMs?: number }): Promise<void> {
    this.log.push(`goto ${url}`)
    this.timeouts.push(options?.timeoutMs)
    this.onGoto()
    if (this.failOn.has(url)) throw new Error(`net::ERR_FAILED ${url}`)
    this.currentUrl = this.redirects[url] ?? url
  }
  override async read<T>(script: string): Promise<T> {
    this.log.push(`read ${script.slice(0, 20)}`)
    if (script.includes('querySelectorAll(cfg.selector)')) {
      this.log.push('count')
      if (this.countAnswer !== undefined) return this.countAnswer as T
      const selector = JSON.parse(/\}\)\(\{"selector":("(?:[^"\\]|\\.)*")\}\)$/.exec(script)?.[1] ?? '""') as string
      return (this.matches[this.currentUrl]?.[selector] ?? 0) as T
    }
    const spec = this.site[this.currentUrl]
    return (spec ? { title: spec.title ?? 'Page', outline: spec.outline, links: spec.links ?? [] } : null) as T
  }
}

const HOME = 'https://forum.example.com/'
const FORUM_SITE: Record<string, SiteSpec> = {
  [HOME]: {
    title: 'Example forum',
    outline: 'body\n  nav\n    a[href=/c/general] "General"\n  ul.topics\n    li.topic',
    links: [
      { href: 'https://forum.example.com/c/general', text: 'General discussion' },
      { href: 'https://forum.example.com/new-topic', text: 'New topic' },
      { href: 'https://forum.example.com/logout', text: 'Log out' },
      { href: 'https://forum.example.com/t/9/delete', text: 'Delete my topic' },
      { href: 'https://elsewhere.example.org/forum', text: 'Partner forum' },
      { href: 'https://forum.example.com/latest', text: 'Latest' }
    ]
  },
  'https://forum.example.com/c/general': { title: 'General', outline: 'body\n  div.posts\n    div.post' },
  'https://forum.example.com/new-topic': { title: 'New topic', outline: 'body\n  form#new\n    textarea[name=text]\n    button.submit "Post"' },
  'https://forum.example.com/latest': { title: 'Latest', outline: 'body\n  ul.latest' }
}

interface Setup {
  w: World
  connector: SiteConnector
  accountId: string
  page: SitePage
  profiles: ProfileService
}

async function setup(options: { site?: Record<string, SiteSpec>; redirects?: Record<string, string>; ai?: ConstructorParameters<typeof ProfileService>[2]; now?: () => number; groundingBudgetMs?: number } = {}): Promise<Setup> {
  const connector = new SiteConnector()
  const w = makeWorld({ extra: [connector] })
  const web = await w.call('accounts.create', { productId: w.productId, platform: 'web', label: 'Forum login' })
  const page = new SitePage(options.site ?? FORUM_SITE, options.redirects)
  w.t.browser.pages.set(web.id, page)
  const store = new ChannelsStore(w.core.db, w.core.clock, w.core.repos)
  const profiles = new ProfileService(w.core, new AccountsService(w.core, store), options.ai ?? { draftSiteProfile }, { now: options.now, groundingBudgetMs: options.groundingBudgetMs })
  return { w, connector, accountId: web.id, page, profiles }
}

const draftArgs = (s: Setup, url = HOME) => ({ productId: s.w.productId, accountId: s.accountId, url })
const writes = (page: FakePage): string[] => page.log.filter((entry) => /^(fill|click|upload)\b/.test(entry))
const opened = (page: FakePage): string[] => page.log.filter((entry) => entry.startsWith('goto ')).map((entry) => entry.slice(5))
const refused = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  throw new Error('expected a refusal')
}

// ───────────────────────────── channels.saveProfile ─────────────────────────────

describe('channels.saveProfile', () => {
  it('saves a valid profile as a new version, logs it and announces the change', async () => {
    const w = makeWorld({ extra: [new SiteConnector()] })
    const connector = w.core.connectors.list().find((c) => c.authoring) as SiteConnector
    w.changes.length = 0
    const first = await w.call('channels.saveProfile', { host: 'forum.example.com', definition: GOOD })
    const second = await w.call('channels.saveProfile', { host: 'Forum.Example.com', definition: { ...GOOD, name: 'Renamed' } })
    expect(first).toMatchObject({ host: 'forum.example.com', version: 1, valid: true, errors: [] })
    expect(second.version).toBe(2)
    expect(connector.saved.map((p) => p.version)).toEqual([1, 2])
    expect(w.changes).toContain('channels')
    expect(w.core.log.list(20).some((e) => e.source === 'channels' && /forum\.example\.com.*version 2/.test(e.message))).toBe(true)
  })

  it('refuses an invalid profile with all problems joined, and stores nothing', async () => {
    const w = makeWorld({ extra: [new SiteConnector()] })
    const connector = w.core.connectors.list().find((c) => c.authoring) as SiteConnector
    const error = await w.call('channels.saveProfile', { host: 'forum.example.com', definition: { name: 5 } }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'profile_invalid' })
    expect((error as Error).message).toBe('profile.schema: must be 1; profile.name: required; profile.host: required')
    expect(connector.saved).toEqual([])
    expect(await w.refusal('channels.saveProfile', { host: 'forum.example.com', definition: 'x' })).toBe('profile_invalid')
  })

  it('refuses a profile written for another site than the one named', async () => {
    const w = makeWorld({ extra: [new SiteConnector()] })
    expect(await w.refusal('channels.saveProfile', { host: 'other.example.org', definition: GOOD })).toBe('invalid_input')
    expect(await w.refusal('channels.saveProfile', { host: '  ', definition: GOOD })).toBe('invalid_input')
  })

  it('says so when no connector works from profiles', async () => {
    const w = makeWorld()
    expect(await w.refusal('channels.saveProfile', { host: 'forum.example.com', definition: GOOD })).toBe('no_connector')
  })

  it('a saved profile claims nothing: capabilities stay "needs verification" until a channel is assessed', async () => {
    const w = makeWorld({ extra: [new SiteConnector()] })
    await w.call('channels.saveProfile', { host: 'forum.example.com', definition: GOOD })
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM channels').get()).toEqual({ n: 0 })
  })
})

// ───────────────────────────── channels.draftProfile ─────────────────────────────

describe('channels.draftProfile: reading the site', () => {
  it('reads the address and up to two same-site links with goto and read only, then returns the checked draft', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))

    expect(draft).toEqual({ host: 'forum.example.com', definition: GOOD, valid: true, problems: [], summary: ['Site: Example forum (forum.example.com)', 'Reads discussions'], instructions: [] })
    expect(opened(s.page)).toEqual([HOME, 'https://forum.example.com/new-topic', 'https://forum.example.com/c/general'])
    expect(writes(s.page)).toEqual([])
    expect(s.page.log.every((entry) => /^(goto|read|wait|url)\b/.test(entry))).toBe(true)
    expect(s.connector.saved).toEqual([]) // a draft is not saved
  })

  it('gives the AI the outline of each page, the format rules and the address, as data', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    await s.w.call('channels.draftProfile', draftArgs(s))
    const [call] = s.w.t.engine.calls
    expect(call.label).toBe('channels.site_profile')
    expect(call.prompt).toContain('FORMAT: a profile has schema, name and host.')
    expect(call.prompt).toContain('Site address: https://forum.example.com/')
    expect(call.prompt).toContain('a[href=/c/general] "General"')
    expect(call.prompt).toContain('textarea[name=text]')
    expect(call.prompt).not.toContain('Delete my topic')
  })

  it('never follows logout or delete links, links to other sites, or more than two extra pages', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    await s.w.call('channels.draftProfile', draftArgs(s))
    const visited = opened(s.page).join(' ')
    expect(visited).not.toMatch(/logout|delete|elsewhere/)
    expect(opened(s.page)).toHaveLength(3)
  })

  it('works for an unassigned (legacy) account, and for the www form of a site', async () => {
    const s = await setup({ site: { ...FORUM_SITE, [HOME]: { ...FORUM_SITE[HOME], links: [] } }, redirects: { [HOME]: 'https://www.forum.example.com/' } })
    s.page.site['https://www.forum.example.com/'] = FORUM_SITE[HOME]
    s.w.core.db.prepare('UPDATE accounts SET product_id = NULL WHERE id = ?').run(s.accountId)
    s.w.t.engine.on('channels.site_profile', JSON.stringify({ ...GOOD, host: 'www.forum.example.com' }))
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft).toMatchObject({ host: 'www.forum.example.com', valid: true })
  })

  it('stops reading when the 60 second budget is used up', async () => {
    let clock = 0
    const s = await setup({ now: () => clock })
    s.page.onGoto = () => (clock += 61_000)
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    const draft = await s.profiles.draftProfile(draftArgs(s))
    expect(opened(s.page)).toEqual([HOME])
    expect(draft.valid).toBe(true)
  })

  it('never lets one page take longer than what is left of the budget', async () => {
    let clock = 0
    const s = await setup({ now: () => clock })
    s.page.onGoto = () => (clock += 25_000)
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    await s.profiles.draftProfile(draftArgs(s))
    expect(s.page.timeouts).toEqual([30_000, 30_000, 10_000])
  })

  it('keeps going when one extra page does not load', async () => {
    const s = await setup()
    s.page.failOn.add('https://forum.example.com/new-topic')
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(true)
    expect(s.w.t.engine.calls[0].prompt).toContain('Page 2')
    expect(s.w.t.engine.calls[0].prompt).not.toContain('Page 3')
  })

  it('bounds and cleans what the site says before the AI sees it', async () => {
    const huge = `body\n${'  div.row[data-x=1] "text"\n'.repeat(5000)}\u0007hidden control`
    const s = await setup({ site: { [HOME]: { outline: huge, links: [] } } })
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    await s.w.call('channels.draftProfile', draftArgs(s))
    const prompt = s.w.t.engine.calls[0].prompt
    expect(prompt).not.toContain('\u0007')
    expect(prompt.length).toBeLessThan(OUTLINE_MAX_CHARS) // ai-help keeps only the head of each page
  })
})

describe('channels.draftProfile: what is checked first', () => {
  it('refuses unknown products and accounts', async () => {
    const s = await setup()
    expect(await refused(s.w.call('channels.draftProfile', { ...draftArgs(s), productId: 'nope' }))).toBe('not_found')
    expect(await refused(s.w.call('channels.draftProfile', { ...draftArgs(s), accountId: 'nope' }))).toBe('not_found')
    expect(s.page.log).toEqual([])
  })

  it('refuses a login that belongs to another product, and one of another platform', async () => {
    const s = await setup()
    const second = s.w.addProduct('Tarot Deck')
    expect(await refused(s.w.call('channels.draftProfile', { ...draftArgs(s), productId: second }))).toBe('account_other_product')
    const fakeAccount = await s.w.addAccount('Fake platform login')
    expect(await refused(s.w.call('channels.draftProfile', { ...draftArgs(s), accountId: fakeAccount.id }))).toBe('platform_mismatch')
    expect(s.page.log).toEqual([])
  })

  it.each(['', 'forum.example.com', 'ftp://forum.example.com/', 'javascript:alert(1)', 'file:///etc/hosts', 'http://127.0.0.1/', 'http://192.168.0.5/admin', 'http://localhost:8080/', 'http://[::1]/', 'https://u:p@forum.example.com/'])(
    'refuses the address "%s" without opening anything',
    async (url) => {
      const s = await setup()
      expect(await refused(s.w.call('channels.draftProfile', draftArgs(s, url)))).toBe('invalid_input')
      expect(s.page.log).toEqual([])
      expect(s.w.t.engine.calls).toEqual([])
    }
  )
})

describe('channels.draftProfile: when no draft can be made, the owner gets steps to follow', () => {
  const noWrites = (s: Setup) => expect(writes(s.page)).toEqual([])

  it('without a selected engine: explains to select one in Settings, and opens nothing', async () => {
    const s = await setup()
    s.w.core.settings.updateApp({ engineId: null })
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft).toMatchObject({ host: 'forum.example.com', definition: null, valid: false, problems: [], summary: [] })
    expect(draft.instructions[0]).toMatch(/No AI engine is selected.*Settings/)
    expect(draft.instructions.length).toBeGreaterThan(3)
    expect(s.page.log).toEqual([])
  })

  it('with an engine that is not installed: says so, and opens nothing', async () => {
    const s = await setup()
    s.w.t.engine.installed = false
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.instructions[0]).toMatch(/not installed/)
    expect(s.page.log).toEqual([])
    expect(s.w.t.engine.calls).toEqual([])
  })

  it('with an engine that is not tool-free: the site is neither opened nor shown to it', async () => {
    const s = await setup()
    s.w.t.engine.toolFree = false
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft).toMatchObject({ definition: null, valid: false })
    expect(draft.instructions[0]).toMatch(/can use tools on this computer/)
    expect(s.page.log).toEqual([])
    expect(s.w.t.engine.calls).toEqual([])
    noWrites(s)
  })

  it('when the AI answer is not a valid profile twice: the problems and the steps, nothing saved', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', JSON.stringify({ schema: 2, name: 7 }))
    s.w.t.engine.on('channels.site_profile.repair', JSON.stringify({ schema: 2, name: 7 }))
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.problems).toEqual(expect.arrayContaining(['profile.schema: must be 1', 'profile.name: required']))
    expect(draft.instructions.length).toBeGreaterThan(0)
    expect(draft.summary).toEqual([])
    expect(s.connector.saved).toEqual([])
  })

  it('when the AI fixes its answer on the second try: a valid draft', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', '{"schema": 2}')
    s.w.t.engine.on('channels.site_profile.repair', JSON.stringify(GOOD))
    expect(await s.w.call('channels.draftProfile', draftArgs(s))).toMatchObject({ valid: true, definition: GOOD, instructions: [] })
  })

  it('when the engine fails: steps with the reason, not an error', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', () => {
      throw new AiError('failed', 'process exited with code 1')
    })
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.instructions[0]).toMatch(/AI engine failed/)
  })

  it('when the site cannot be read: steps with the reason, and the AI is not asked', async () => {
    const s = await setup()
    s.page.failOn.add(HOME)
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.instructions[0]).toMatch(/could not be read/)
    expect(s.w.t.engine.calls).toEqual([])
  })

  it('when the address leads to a different site: says so instead of drafting for the wrong site', async () => {
    const s = await setup({ redirects: { [HOME]: 'https://evil.example.net/' } })
    s.page.site['https://evil.example.net/'] = { outline: 'body' }
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.instructions[0]).toMatch(/leads to evil\.example\.net, which is a different site/)
    expect(s.w.t.engine.calls).toEqual([])
  })

  it('when the page gives nothing usable: steps, and the AI is not asked', async () => {
    const s = await setup({ site: {} })
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.instructions[0]).toMatch(/did not load/)
    expect(s.w.t.engine.calls).toEqual([])
  })

  it('does not wait for a person who holds the browser: it says the browser is busy', async () => {
    const s = await setup()
    await s.w.call('accounts.takeControl', { accountId: s.accountId })
    expect(await refused(s.w.call('channels.draftProfile', draftArgs(s)))).toBe('browser_busy')
    expect(s.page.log).toEqual([])
  })
})

describe('channels.draftProfile: the answer is checked again here', () => {
  const claimed = (over: Partial<SiteProfileDraft>): ConstructorParameters<typeof ProfileService>[2] => ({
    draftSiteProfile: async () => ({ host: 'forum.example.com', definition: GOOD, valid: true, problems: [], summary: ['AI says fine'], instructions: [], ...over })
  })

  it('a draft the AI helper calls valid but the connector rejects is shown as invalid', async () => {
    const s = await setup({ ai: claimed({ definition: { name: 'x' } }) })
    const draft = await s.profiles.draftProfile(draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.problems).toContain('profile.schema: must be 1')
    expect(draft.summary).toEqual([])
    expect(draft.instructions.length).toBeGreaterThan(0)
  })

  it('a valid draft for a different site than the one that was read is shown as invalid', async () => {
    const s = await setup({ ai: claimed({ definition: { ...GOOD, host: 'other.example.org' }, host: 'other.example.org' }) })
    const draft = await s.profiles.draftProfile(draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.problems.join(' ')).toMatch(/for other\.example\.org, but the site that was read is forum\.example\.com/)
  })

  it('the summary the owner reads comes from the connector, not from the AI', async () => {
    const s = await setup({ ai: claimed({ summary: ['Sends 1000 posts a day'] }) })
    const draft = await s.profiles.draftProfile(draftArgs(s))
    expect(draft.valid).toBe(true)
    expect(draft.summary).toEqual(['Site: Example forum (forum.example.com)', 'Reads discussions'])
  })

  it('an AI helper that throws gives steps, not an error', async () => {
    const s = await setup({
      ai: {
        draftSiteProfile: async () => {
          throw new Error('boom')
        }
      }
    })
    const draft = await s.profiles.draftProfile(draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.instructions[0]).toMatch(/could not prepare a profile \(boom\)/)
  })

  it('a draft can then be saved with channels.saveProfile', async () => {
    const s = await setup()
    s.w.t.engine.on('channels.site_profile', JSON.stringify(GOOD))
    const draft = await s.w.call('channels.draftProfile', draftArgs(s))
    const saved = await s.w.call('channels.saveProfile', { host: draft.host, definition: draft.definition })
    expect(saved).toMatchObject({ host: 'forum.example.com', version: 1, valid: true })
  })
})

// ───────────────────────────── the draft must be about this site (grounding) ─────────────────────────────

describe('channels.draftProfile: a draft must name parts that exist on the pages that were read', () => {
  const THREAD = 'https://forum.example.com/t/1'
  const GROUNDED = { ...GOOD, discussions: '[data-discussion]', comments: '[data-comment]' }
  const reads = (page: FakePage): number => page.log.filter((entry) => entry === 'count').length

  /** The forum's front page (with a topic link) and one thread, so a discussion page is read as well. */
  const withThread = (): Record<string, SiteSpec> => ({
    [HOME]: { title: 'Example forum', outline: 'body\n  ul.topics', links: [{ href: THREAD, text: 'Topic one' }] },
    [THREAD]: { title: 'Topic one', outline: 'body\n  div.posts' }
  })

  async function drafted(s: Setup, definition: unknown = GROUNDED) {
    s.w.t.engine.on('channels.site_profile', JSON.stringify(definition))
    return s.profiles.draftProfile(draftArgs(s))
  }

  it('a page with no discussions at all: selectors that match nothing make the draft invalid, with the reason first', async () => {
    const s = await setup({ site: { 'https://example.com/': { title: 'Example Domain', outline: 'body\n  div\n    h1 "Example Domain"\n    p "This domain is for use in documentation."' } } })
    const definition = { ...GROUNDED, host: 'example.com', discussions: '[data-discussion]', comments: '[data-comment]', login: '[data-logged-in=true]' }
    s.w.t.engine.on('channels.site_profile', JSON.stringify(definition))
    const draft = await s.w.call('channels.draftProfile', draftArgs(s, 'https://example.com/'))

    const reason = 'The draft names parts of the page that do not exist on the pages that were read: [data-discussion]'
    expect(draft).toMatchObject({ host: 'example.com', definition, valid: false, problems: [reason], summary: [] })
    expect(draft.instructions[0]).toBe(reason)
    expect(draft.instructions.length).toBeGreaterThan(3)
    expect(s.connector.saved).toEqual([]) // nothing is saved
    expect(writes(s.page)).toEqual([])
    expect(s.w.core.log.list(10, 'warn').some((e) => e.message.includes(reason))).toBe(true)
  })

  it('selectors that match give a summary line the owner can check, and the draft stays valid', async () => {
    const s = await setup()
    s.page.matches[HOME] = { '[data-discussion]': 12 }
    const draft = await drafted(s)
    expect(draft).toMatchObject({ valid: true, problems: [], instructions: [] })
    expect(draft.summary).toEqual(['Site: Example forum (forum.example.com)', 'Reads discussions', 'Found 12 discussions on the page that was read.'])
    expect(writes(s.page)).toEqual([])
    expect(s.page.log.every((entry) => /^(goto|read|wait|url|count)\b/.test(entry))).toBe(true)
  })

  it('says "1 discussion" for one match', async () => {
    const s = await setup()
    s.page.matches[HOME] = { '[data-discussion]': 1 }
    expect((await drafted(s)).summary).toContain('Found 1 discussion on the page that was read.')
  })

  it('a selector that matches on any one of the pages that were read is enough', async () => {
    const s = await setup()
    s.page.matches['https://forum.example.com/c/general'] = { '[data-discussion]': 3 }
    const draft = await drafted(s)
    expect(draft.valid).toBe(true)
    expect(draft.summary).toContain('Found 3 discussions on the page that was read.')
  })

  it('looks at the pages that were read again, and only those', async () => {
    const s = await setup()
    s.page.matches[HOME] = { '[data-discussion]': 2 }
    await drafted(s)
    const visits = opened(s.page)
    expect(visits.slice(0, 3)).toEqual([HOME, 'https://forum.example.com/new-topic', 'https://forum.example.com/c/general'])
    expect(visits.slice(3)).toEqual([HOME, 'https://forum.example.com/new-topic', 'https://forum.example.com/c/general'])
    expect(reads(s.page)).toBe(3)
  })

  it('counts comments on a discussion page that was read', async () => {
    const s = await setup({ site: withThread() })
    s.page.matches[HOME] = { '[data-discussion]': 4 }
    s.page.matches[THREAD] = { '[data-comment]': 7 }
    const draft = await drafted(s)
    expect(draft.valid).toBe(true)
    expect(draft.summary).toEqual(expect.arrayContaining(['Found 4 discussions on the page that was read.', 'Found 7 comments on the discussion page that was read.']))
  })

  it('a discussion page without comments is said, not held against the draft (a thread without replies is normal)', async () => {
    const s = await setup({ site: withThread() })
    s.page.matches[HOME] = { '[data-discussion]': 4 }
    const draft = await drafted(s)
    expect(draft.valid).toBe(true)
    expect(draft.summary.at(-1)).toMatch(/^No comments were visible on the discussion page that was read/)
  })

  it('does not look for comments when no discussion page was read', async () => {
    const s = await setup()
    s.page.matches[HOME] = { '[data-discussion]': 4 }
    const draft = await drafted(s)
    expect(draft.summary.join(' ')).not.toMatch(/comment/i)
  })

  it('a profile that names no selectors is left as it is, and the pages are not opened again', async () => {
    const s = await setup()
    const draft = await drafted(s, GOOD)
    expect(draft.valid).toBe(true)
    expect(opened(s.page)).toHaveLength(3)
    expect(reads(s.page)).toBe(0)
  })

  it('a selector the page rejects matches nothing', async () => {
    const s = await setup()
    s.page.countAnswer = -1
    const draft = await drafted(s)
    expect(draft.valid).toBe(false)
    expect(draft.problems).toEqual(['The draft names parts of the page that do not exist on the pages that were read: [data-discussion]'])
  })

  it('does not call a draft wrong when it could not be checked: an unusable answer, a page that will not load, a site that moved', async () => {
    const unusable = await setup()
    unusable.page.countAnswer = 'about:blank'
    expect((await drafted(unusable)).problems).toEqual(['The draft could not be checked against the site. Try again.'])

    const broken = await setup()
    let gotos = 0
    broken.page.onGoto = () => {
      gotos += 1
      if (gotos > 3) throw new Error('net::ERR_FAILED')
    }
    const draft = await drafted(broken)
    expect(draft.valid).toBe(false)
    expect(draft.problems).toEqual(['The draft could not be checked against the site. Try again.'])
    expect(draft.instructions[0]).toBe(draft.problems[0])

    const moved = await setup()
    moved.page.onGoto = () => {
      if (opened(moved.page).length > 3) moved.page.redirects[HOME] = 'https://elsewhere.example.org/'
    }
    moved.page.matches[HOME] = { '[data-discussion]': 5 }
    moved.page.matches['https://elsewhere.example.org/'] = { '[data-discussion]': 5 }
    const redirected = await drafted(moved)
    expect(redirected.valid).toBe(false) // a count on another site proves nothing about this one
  })

  it('when the person takes the browser while the draft is checked, the draft is held back, not accepted', async () => {
    const s = await setup()
    s.page.matches[HOME] = { '[data-discussion]': 5 }
    s.page.onGoto = () => {
      if (opened(s.page).length === 4) s.w.t.browser.sessions.get(s.accountId)?.takeControl()
    }
    const draft = await drafted(s)
    expect(draft.valid).toBe(false)
    expect(draft.problems[0]).toMatch(/could not be checked against the site/)
    expect(s.connector.saved).toEqual([])
  })

  it('checking has its own budget: when it is used up before anything was counted, the draft is reported as not checked', async () => {
    const s = await setup({ groundingBudgetMs: 500 })
    s.page.matches[HOME] = { '[data-discussion]': 5 }
    const draft = await drafted(s)
    expect(draft.valid).toBe(false)
    expect(draft.problems).toEqual(['The draft could not be checked against the site. Try again.'])
    expect(reads(s.page)).toBe(0)
  })

  it('a match found before the checking budget ran out is enough', async () => {
    let clock = 0
    const s = await setup({ now: () => clock })
    s.page.matches[HOME] = { '[data-discussion]': 5 }
    s.page.onGoto = () => (clock += 20_000) // reading takes 60 s in all; checking has 30 s, so only two pages are reached
    const draft = await drafted(s)
    expect(draft.valid).toBe(true)
    expect(draft.summary).toContain('Found 5 discussions on the page that was read.')
  })

  it('what the AI says about its own check is not trusted: a draft it calls valid is still checked', async () => {
    const s = await setup({
      ai: { draftSiteProfile: async () => ({ host: 'forum.example.com', definition: GROUNDED, valid: true, problems: [], summary: ['The AI says it found 40 discussions'], instructions: [] }) }
    })
    const draft = await s.profiles.draftProfile(draftArgs(s))
    expect(draft.valid).toBe(false)
    expect(draft.summary).toEqual([])
  })
})
