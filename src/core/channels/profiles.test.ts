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
  readonly authoring: ProfileAuthoring = {
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

async function setup(options: { site?: Record<string, SiteSpec>; redirects?: Record<string, string>; ai?: ConstructorParameters<typeof ProfileService>[2]; now?: () => number } = {}): Promise<Setup> {
  const connector = new SiteConnector()
  const w = makeWorld({ extra: [connector] })
  const web = await w.call('accounts.create', { productId: w.productId, platform: 'web', label: 'Forum login' })
  const page = new SitePage(options.site ?? FORUM_SITE, options.redirects)
  w.t.browser.pages.set(web.id, page)
  const store = new ChannelsStore(w.core.db, w.core.clock, w.core.repos)
  const profiles = new ProfileService(w.core, new AccountsService(w.core, store), options.ai ?? { draftSiteProfile }, { now: options.now })
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
