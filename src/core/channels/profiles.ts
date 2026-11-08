// Site profiles for the universal connector (DEC-009): saving a reviewed profile, and preparing a draft of one.
//
// A draft is made by reading the site READ-ONLY through the account's own browser session (open a page, describe its
// structure; never type, click or upload), then asking the AI to turn that description into a profile. The AI's answer
// is only ever DATA: it is validated against the connector's schema again here, shown to the owner, and saved only
// when the owner accepts it. Nothing it contains is executed.

import { ApiError } from '../../shared/api'
import type { Account, SavedSiteProfile, SiteProfileDraft } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type BrowserPage, type Connector, type ProfileAuthoring } from '../ports'
import type { AccountsService } from './accounts'
import { manualInstructions, type draftSiteProfile } from './ai-help'
import { browserError, found, requireText } from './errors'
import { chooseLinks, outlineScript, parsePageOutline, publicSite, sameSite } from './site-outline'

/** About how long reading the whole site may take. */
export const DRAFT_BUDGET_MS = 60_000
const PAGE_LOAD_MS = 30_000
const MAX_PAGES = 3

export interface ProfileServiceOptions {
  budgetMs?: number
  /** Milliseconds clock for the reading budget (tests replace it). */
  now?: () => number
}

interface ReadPage {
  url: string
  title: string
  outline: string
}

/** The AI helper this service calls (ai-help.ts); injectable so tests can script it and the module stays free of prompts. */
export interface ProfileHelp {
  draftSiteProfile: typeof draftSiteProfile
}

export class ProfileService {
  private readonly budgetMs: number
  private readonly now: () => number

  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly ai: ProfileHelp,
    options: ProfileServiceOptions = {}
  ) {
    this.budgetMs = options.budgetMs ?? DRAFT_BUDGET_MS
    this.now = options.now ?? Date.now
  }

  /** The connector that works from site profiles, with its authoring capability. */
  private authoringConnector(): Connector & { authoring: ProfileAuthoring } {
    const connector = this.core.connectors.list().find((c): c is Connector & { authoring: ProfileAuthoring } => c.authoring !== undefined)
    if (!connector) throw new ApiError('no_connector', 'This application has no connector that works from site profiles.')
    return connector
  }

  // ───────────── save ─────────────

  saveProfile(args: { host: string; definition: unknown }): SavedSiteProfile {
    const host = requireText(args.host, 'The site').toLowerCase()
    const { authoring } = this.authoringConnector()
    const check = authoring.validateDefinition(args.definition)
    if (!check.valid) throw new ApiError('profile_invalid', check.errors.join('; ') || 'The profile is not valid.')
    if (check.host !== host) throw new ApiError('invalid_input', `The profile is for ${check.host ?? 'no site'}, not for ${host}.`)
    let saved
    try {
      saved = authoring.saveDefinition(host, args.definition)
    } catch (error) {
      throw new ApiError('profile_invalid', error instanceof Error ? error.message : String(error))
    }
    if (!saved.valid) throw new ApiError('profile_invalid', saved.errors.join('; ') || 'The profile is not valid.')
    this.core.log.info('channels', `Site profile for ${saved.host} saved as version ${saved.version}. Nothing is verified yet: assess a channel on this site to see what works.`)
    this.core.events.changed('channels')
    return saved
  }

  // ───────────── draft ─────────────

  async draftProfile(args: { productId: string; accountId: string; url: string }): Promise<SiteProfileDraft> {
    const productId = requireText(args.productId, 'The product')
    const product = found(() => this.core.repos.product(productId), 'The product')
    const account = this.accounts.account(args.accountId)
    if (account.productId !== null && account.productId !== product.id) {
      throw new ApiError('account_other_product', 'This login belongs to another product. Choose a login of this product.')
    }
    const site = publicSite(args.url)
    const connector = this.authoringConnector()
    if (account.platform !== connector.platform) {
      throw new ApiError('platform_mismatch', `${account.label} is a "${account.platform}" account. Site profiles are for "${connector.platform}" accounts.`)
    }
    const { authoring } = connector
    const unusable = (host: string, reason: string): SiteProfileDraft => ({
      host,
      definition: null,
      valid: false,
      problems: [],
      summary: [],
      instructions: manualInstructions(host, reason)
    })

    const engine = this.core.engines.selected()
    if (!engine) return unusable(site.host, 'No AI engine is selected. Select one in Settings (Codex or Claude Code) and try again.')
    const status = await engine.check()
    if (!status.installed || !status.ready) return unusable(site.host, status.detail || `${engine.label} is not available.`)

    // An engine that could use tools on this computer is never shown a website, so the site is not even opened;
    // draftSiteProfile answers such an engine with the manual steps.
    let host = site.host
    let pages: ReadPage[] = []
    if (engine.toolFree) {
      const read = await this.readSite(account, site)
      if ('problem' in read) return unusable(site.host, read.problem)
      host = read.host
      pages = read.pages
      this.core.log.info('channels', `Read ${pages.length} page${pages.length === 1 ? '' : 's'} of ${host} through ${account.label} to prepare a site profile. Nothing was typed, clicked or changed on the site.`)
    }

    let draft: SiteProfileDraft
    try {
      draft = await this.ai.draftSiteProfile(engine, { url: site.url, host, pages, format: authoring.describeFormat() }, (definition) => authoring.validateDefinition(definition))
    } catch (error) {
      return unusable(host, `The AI could not prepare a profile (${error instanceof Error ? error.message : String(error)}).`)
    }
    return this.checked(draft, host, authoring)
  }

  /** The draft as the owner will see it: validated again here, whatever the AI helper claimed, and tied to the site that was read. */
  private checked(draft: SiteProfileDraft, readHost: string, authoring: ProfileAuthoring): SiteProfileDraft {
    if (draft.definition === null || draft.definition === undefined) return { ...draft, host: draft.host || readHost, valid: false, summary: [] }
    const check = authoring.validateDefinition(draft.definition)
    const problems = [...check.errors]
    if (check.host && !sameSite(check.host, readHost)) problems.push(`The profile is for ${check.host}, but the site that was read is ${readHost}.`)
    if (check.valid && problems.length === 0) {
      return { host: check.host ?? readHost, definition: draft.definition, valid: true, problems: [], summary: check.summary, instructions: [] }
    }
    const instructions = draft.instructions.length > 0 ? draft.instructions : manualInstructions(readHost, 'The AI prepared a profile, but it does not pass the checks, so it cannot be saved.')
    return { host: check.host ?? readHost, definition: draft.definition, valid: false, problems, summary: [], instructions }
  }

  // ───────────── reading the site (read-only) ─────────────

  private async readSite(account: Account, site: { url: string; host: string }): Promise<{ host: string; pages: ReadPage[] } | { problem: string }> {
    try {
      return await this.core.browser.session(account).withAgentControl(`draft:${site.host}`, (page) => this.readPages(page, site))
    } catch (error) {
      // The person holding the browser is not a failure of the site: say so instead of drafting from nothing.
      if (error instanceof TakeoverError) throw browserError(error, { code: 'browser_busy', message: (reason) => reason })
      return { problem: `The site could not be read: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Opens the address and at most two same-site links worth looking at. Only goto, url, read and waitForSelector are used. */
  private async readPages(page: BrowserPage, site: { url: string; host: string }): Promise<{ host: string; pages: ReadPage[] } | { problem: string }> {
    const deadline = this.now() + this.budgetMs
    const first = await this.readOne(page, site.url, deadline)
    if (!first) return { problem: 'The site did not load in time.' }
    const landed = hostOf(first.page.url)
    if (!landed || !sameSite(landed, site.host)) {
      return { problem: `The address leads to ${landed ?? 'another place'}, which is a different site. Enter the address of the site itself.` }
    }
    const pages = [first.page]
    for (const link of chooseLinks(first.links, first.page.url, landed, MAX_PAGES - 1)) {
      const next = await this.readOne(page, link, deadline).catch((error: unknown) => {
        if (error instanceof TakeoverError) throw error
        return null // one page that fails to load does not spoil the others
      })
      const nextHost = next ? hostOf(next.page.url) : null
      if (next && nextHost && sameSite(nextHost, landed)) pages.push(next.page)
    }
    return { host: landed, pages }
  }

  private async readOne(page: BrowserPage, url: string, deadline: number): Promise<{ page: ReadPage; links: { href: string; text: string }[] } | null> {
    const remaining = deadline - this.now()
    if (remaining <= 1_000) return null
    await page.goto(url, { timeoutMs: Math.min(PAGE_LOAD_MS, remaining) })
    await page.waitForSelector('body', Math.min(3_000, Math.max(0, deadline - this.now())))
    const outline = parsePageOutline(await page.read<unknown>(outlineScript()))
    if (!outline) return null
    return { page: { url: await page.url(), title: outline.title, outline: outline.outline }, links: outline.links }
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}
