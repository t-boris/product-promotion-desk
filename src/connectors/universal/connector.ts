import type { Db } from '../../core/db/database'
import {
  TakeoverError,
  type ActivityBatch,
  type BrowserPage,
  type Clock,
  type Connector,
  type ConnectorContext,
  type LoginState,
  type NormalizedTarget,
  type ProfileAuthoring,
  type PublishedRef,
  type PublishOutcome,
  type PublishRequest,
  type RemoteComment,
  type RemoteDiscussion,
  type SendTicket
} from '../../core/ports'
import type { Capability, MetricReading } from '../../shared/types'
import { CapabilityBuilder } from '../capabilities'
import { CaptchaRequiredError, LoginRequiredError } from '../errors'
import { gateProbeScript, type GateProbe } from '../page-scripts'
import { createdMs, earliestCreation } from '../reconcile'
import { analyzeRules, quoteRule } from '../rules-text'
import { comparableText, errorMessage, sameText } from '../text'
import { describeProfileFormat, summarizeProfile } from './format'
import { hostBelongsTo, matchGlob, matchesAnyGlob } from './glob'
import type { ItemReader, PublishFlow, SiteProfile, Step } from './profile'
import { elementTextScript, extractItemsScript, loginProbeScript, pageTextScript, parseCount, visibleTextScript, type RawItem } from './reader'
import { ProfileStore, type ProfileProvider, type StoredProfile } from './store'
import { renderTemplate, type PlaceholderValues } from './templates'
import { validateProfile } from './validate'

export const UNIVERSAL_VERSION = '1'

export interface UniversalOptions {
  sleep?: (ms: number) => Promise<void>
  /** Pause between page loads while collecting activity. */
  pacingMs?: number
  verifyTimeoutMs?: number
  pollMs?: number
}

/** Raised when a profile no longer matches the site (container missing): the affected operation stops. */
class LayoutChanged extends Error {}

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

/**
 * Connector for sites without a prepared connector. It works only from a validated declarative profile and
 * claims a capability only when it was actually observed. Without a valid profile every capability stays
 * 'needs_check' with guidance — never 'verified'.
 */
export class UniversalConnector implements Connector {
  readonly id = 'universal'
  readonly platform = 'web'
  readonly version = UNIVERSAL_VERSION
  readonly label = 'Other website'

  /** Lets the core describe, validate and store site profiles (DEC-009) without importing this connector's code. */
  readonly authoring: ProfileAuthoring = {
    describeFormat: () => describeProfileFormat(),
    validateDefinition: (definition) => {
      const result = validateProfile(definition)
      const rawHost = typeof (definition as { host?: unknown } | null)?.host === 'string' ? (definition as { host: string }).host.trim().toLowerCase() : ''
      return { valid: result.valid, errors: result.errors, summary: result.profile ? summarizeProfile(result.profile) : [], host: result.profile?.host ?? (rawHost || null) }
    },
    saveDefinition: (host, definition) => {
      if (!this.store) throw new Error('Profile storage is not available')
      const declared = typeof (definition as { host?: unknown } | null)?.host === 'string' ? (definition as { host: string }).host.trim().toLowerCase() : ''
      if (declared !== host.trim().toLowerCase()) throw new Error(`The profile is for ${declared || 'no host'}, not for ${host}.`)
      const saved = this.store.save(definition)
      return { id: saved.id, host: saved.host, version: saved.version, valid: saved.valid, errors: saved.errors }
    },
    hasValidProfile: (host) => Boolean(this.profiles?.forHost(host).valid)
  }

  private profiles: ProfileProvider | null = null
  private store: ProfileStore | null = null
  private readonly sleep: (ms: number) => Promise<void>
  private readonly pacingMs: number
  private readonly verifyTimeoutMs: number
  private readonly pollMs: number

  constructor(options: UniversalOptions = {}) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.pacingMs = options.pacingMs ?? 500
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? 15_000
    this.pollMs = options.pollMs ?? 500
  }

  /** Called by the core's channels module: profiles live in the application database (connector_profiles). */
  bindStorage(storage: { db: Db; clock: Clock }): void {
    this.store = new ProfileStore(storage.db, storage.clock)
    this.profiles = this.store
  }

  /** Validates and stores a profile definition as the next version of its host. */
  saveProfile(definition: unknown): StoredProfile {
    if (!this.store) throw new Error('Profile storage is not available')
    return this.store.save(definition)
  }

  listProfiles(host?: string): StoredProfile[] {
    return this.store?.list(host) ?? []
  }

  matches(input: string): boolean {
    return /^https?:\/\//i.test(input.trim())
  }

  normalizeTarget(input: string): NormalizedTarget {
    const text = input.trim()
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) throw new Error('Only http and https addresses are supported')
    if (/^(javascript|data|file|blob|about|mailto|vbscript):/i.test(text)) throw new Error('Only http and https addresses are supported')
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    } catch {
      throw new Error(`Not a valid web address: ${input}`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https addresses are supported')
    if (url.username || url.password) throw new Error('Addresses with embedded credentials are not accepted')
    url.hash = ''
    const path = url.pathname.replace(/\/+$/, '')
    return { target: `${url.hostname}${path}`, url: url.href }
  }

  /** The login page depends on the site's profile; the channels module falls back to the channel address. */
  loginUrl(): string {
    return ''
  }

  // ───────────────────────────── Profile lookup ─────────────────────────────

  private lookup(ctx: ConnectorContext): { valid: StoredProfile | null; latest: StoredProfile | null } {
    const hostname = new URL(ctx.channel.url).hostname
    return this.profiles?.forHost(hostname) ?? { valid: null, latest: null }
  }

  private requireProfile(ctx: ConnectorContext): SiteProfile {
    const { valid, latest } = this.lookup(ctx)
    if (valid?.profile) return valid.profile
    throw new Error(
      latest && !latest.valid
        ? `The newest site profile for this site is invalid (${latest.errors[0] ?? 'see validation errors'}); fix it first.`
        : 'There is no site profile for this site yet, so nothing can be read or sent automatically.'
    )
  }

  // ───────────────────────────── Login ─────────────────────────────

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    const profile = this.requireProfile(ctx)
    return ctx.session.withAgentControl(`login:${ctx.account.id}`, async (page) => {
      await page.goto(ctx.channel.url, { timeoutMs: 30_000 })
      const gate = await page.read<GateProbe>(gateProbeScript())
      const probe = await page.read<{ loggedIn: boolean; identity: string; captcha: boolean }>(loginProbeScript(profile.login))
      if (gate.captcha || probe.captcha) return { loggedIn: false, identity: null, captcha: true }
      return { loggedIn: probe.loggedIn, identity: probe.loggedIn && probe.identity ? probe.identity : null, captcha: false }
    })
  }

  // ───────────────────────────── Assessment ─────────────────────────────

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const b = new CapabilityBuilder(ctx.clock.now())
    const { valid, latest } = this.lookup(ctx)
    const host = new URL(ctx.channel.url).hostname
    if (!valid?.profile) {
      const why =
        latest && !latest.valid
          ? `The newest stored profile for ${host} (v${latest.version}) is invalid: ${latest.errors.slice(0, 2).join('; ')}.`
          : `There is no site profile for ${host}.`
      return b
        .fillRemaining(
          'needs_check',
          `${why} A prepared connector does not exist for this site, so nothing is read or sent automatically. Add a validated site profile (addresses, selectors, navigation steps), then assess again. You can still open the site in the account's browser.`
        )
        .build()
    }
    const profile = valid.profile
    if (!matchesAnyGlob(profile.channelUrls, ctx.channel.url)) {
      return b.fillRemaining('needs_check', `The channel address does not match any channel pattern of the "${profile.name}" profile (v${valid.version}).`).build()
    }

    return ctx.session.withAgentControl(`assess:${ctx.channel.id}`, async (page) => {
      await page.goto(ctx.channel.url, { timeoutMs: 30_000 })
      const gate = await page.read<GateProbe>(gateProbeScript())
      const login = await page.read<{ loggedIn: boolean; identity: string; captcha: boolean }>(loginProbeScript(profile.login))
      if (gate.captcha || login.captcha) return b.fillRemaining('needs_user', 'The site shows a CAPTCHA. Open the browser, complete it on the page, then assess again.').build()
      if (!login.loggedIn) return b.fillRemaining('needs_user', 'The account is not signed in on this site. Open the browser, sign in on the page, then assess again.').build()

      // Reading: every claim below comes from selectors that actually matched on the live page.
      let discussions: RawItem[] = []
      let comments: RawItem[] = []
      try {
        discussions = (await this.readItems(page, profile, profile.discussions, ctx.channel.url, 10)).filter((i) => i.id)
        b.set(
          'read_posts',
          discussions.length > 0 ? 'verified' : 'needs_check',
          discussions.length > 0 ? `Read ${discussions.length} discussions with the profile selectors.` : 'The discussion list container was found but no discussion matched the item selector yet.'
        )
      } catch (error) {
        const detail = errorMessage(error)
        b.set('read_posts', 'needs_check', `Discussions could not be read: ${detail}. The site layout may have changed; review the profile.`)
        if (error instanceof TakeoverError) throw error
      }
      const withLink = discussions.find((d) => this.trustedUrl(profile, d.permalink))
      if (withLink) {
        try {
          comments = (await this.readItems(page, profile, profile.comments, withLink.permalink, 30)).filter((i) => i.id)
          b.set(
            'read_comments',
            comments.length > 0 ? 'verified' : 'needs_check',
            comments.length > 0 ? `Read ${comments.length} comments from "${withLink.title.slice(0, 60)}".` : 'The comment container was found but the sampled discussion has no comments to verify the selectors on.'
          )
        } catch (error) {
          if (error instanceof TakeoverError) throw error
          b.set('read_comments', 'needs_check', `Comments could not be read: ${errorMessage(error)}.`)
        }
      } else {
        b.set('read_comments', 'needs_check', discussions.length > 0 ? 'No discussion exposed a trusted permalink to open.' : 'No discussion was available to open.')
      }
      const ids = [...discussions, ...comments].map((i) => i.id)
      const stable = ids.length > 0 && new Set(ids).size === ids.length
      const timed = [...discussions, ...comments].some((i) => i.time && !Number.isNaN(Date.parse(i.time)))
      b.set(
        'detect_changes',
        stable && timed && comments.length > 0 ? 'verified' : 'needs_check',
        stable && timed && comments.length > 0
          ? 'Discussions and comments expose unique ids and timestamps, so new activity can be detected.'
          : 'Unique ids and timestamps were not observed for both discussions and comments yet.'
      )

      // Rules.
      let automationForbidden = false
      let automationDetail = ''
      if (profile.rulesUrl && profile.rulesSelector) {
        try {
          await page.goto(profile.rulesUrl, { timeoutMs: 30_000 })
          const text = await page.read<string | null>(elementTextScript(profile.rulesSelector))
          if (text) {
            const analysis = analyzeRules([{ name: 'Community rules', text }])
            automationForbidden = analysis.automationForbidden !== null
            automationDetail = analysis.automationForbidden ? quoteRule(analysis.automationForbidden) : ''
            b.set('rules', 'verified', automationForbidden ? `Rules appear to forbid automation — ${automationDetail}` : 'Rules were read; no automation ban was found. Read them yourself too.')
          } else b.set('rules', 'needs_check', 'The rules element was not found on the page.')
        } catch (error) {
          if (error instanceof TakeoverError) throw error
          b.set('rules', 'needs_check', `Rules could not be read: ${errorMessage(error)}.`)
        }
      } else {
        b.set('rules', 'needs_check', 'The profile does not say where the rules are. Read the community rules manually before enabling sending.')
      }

      // Sending abilities are never verified here (no ticket exists during an assessment).
      const sample: PlaceholderValues = {
        channelUrl: ctx.channel.url,
        target: ctx.channel.target,
        destination: withLink?.permalink || ctx.channel.url,
        parentId: comments[0]?.id ?? discussions[0]?.id ?? 'x',
        identity: login.identity || ctx.account.identity || 'x'
      }
      for (const [key, flow, label] of [
        ['publish_post', profile.publish?.post, 'post'],
        ['publish_reply', profile.publish?.reply, 'reply']
      ] as const) {
        if (!flow) b.set(key, 'unavailable', `The site profile defines no steps for publishing a ${label}.`)
        else if (automationForbidden) b.set(key, 'restricted', `Community rules appear to forbid automation — ${automationDetail}`)
        else b.set(key, 'needs_check', await this.probeFlow(page, profile, flow, sample, label))
      }

      // Read-back of own content.
      if (profile.ownContent) {
        try {
          const own = await this.readItems(page, profile, profile.ownContent.reader, renderTemplate(profile.ownContent.url, sample, 'url'), 5)
          if (profile.ownContent.reader.time) b.set('verify_send', 'verified', `The account's own content list is readable (${own.length} items), so a sent message can be looked up.`)
          else b.set('verify_send', 'needs_check', `The account's own content list is readable (${own.length} items) but exposes no time, so an unconfirmed send could not be told from older content. Add a time field to the profile.`)
        } catch (error) {
          if (error instanceof TakeoverError) throw error
          b.set('verify_send', 'needs_check', `The account's own content could not be read: ${errorMessage(error)}.`)
        }
      } else if (profile.publish?.post?.verify || profile.publish?.reply?.verify) {
        b.set('verify_send', 'needs_check', 'The profile describes how a result is recognized on the result page; it is proven by the first authorized send.')
      } else b.set('verify_send', 'unavailable', 'The profile defines no way to verify a send.')

      // Metrics.
      if (profile.metrics && profile.metrics.length > 0) {
        const readings = await this.readMetrics(page, profile, ctx.channel.url)
        const seen = readings.filter((r) => r.available).map((r) => r.label)
        b.set('metrics', seen.length > 0 ? 'verified' : 'needs_check', seen.length > 0 ? `Readable: ${seen.join(', ')}.` : 'No metric from the profile could be read on the page.')
      } else b.set('metrics', 'unavailable', 'The profile defines no metrics.')

      return b.build()
    })
  }

  /** Runs the read-only prefix of a flow (goto / waitFor up to the first write step) to see whether the UI is reachable. */
  private async probeFlow(page: BrowserPage, profile: SiteProfile, flow: PublishFlow, sample: PlaceholderValues, label: string): Promise<string> {
    try {
      for (const step of flow.steps) {
        if (step.type === 'fill' || step.type === 'click') break
        if (step.type === 'goto') await page.goto(this.renderUrl(profile, step.url, sample), { timeoutMs: 30_000 })
        else if (!(await page.waitForSelector(renderTemplate(step.selector, sample, 'selector'), step.timeoutMs ?? 8_000))) {
          return `The ${label} flow is defined, but its element "${step.selector}" was not found. Sending is confirmed only by the first authorized send.`
        }
      }
    } catch (error) {
      if (error instanceof TakeoverError) throw error
      return `The ${label} flow could not be opened: ${errorMessage(error)}.`
    }
    return `The ${label} flow is defined and its starting page is reachable. It is confirmed by the first authorized send, never by a test message.`
  }

  // ───────────────────────────── Reading ─────────────────────────────

  private trustedUrl(profile: SiteProfile, url: string): boolean {
    try {
      const parsed = new URL(url)
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && hostBelongsTo(parsed.hostname, profile.host)
    } catch {
      return false
    }
  }

  private renderUrl(profile: SiteProfile, template: string, values: PlaceholderValues): string {
    const url = renderTemplate(template, values, 'url')
    if (!this.trustedUrl(profile, url)) throw new Error(`The address ${url} is outside the profile host ${profile.host}`)
    return url
  }

  /** What the profile's login probe sees on the loaded page. */
  private async probeSession(page: BrowserPage, profile: SiteProfile): Promise<{ loggedIn: boolean; identity: string; captcha: boolean }> {
    const gate = await page.read<GateProbe>(gateProbeScript())
    const probe = await page.read<{ loggedIn: boolean; identity: string; captcha: boolean }>(loginProbeScript(profile.login))
    return { loggedIn: probe.loggedIn, identity: probe.identity, captcha: gate.captcha || probe.captcha }
  }

  /** A sign-in or CAPTCHA wall on the loaded page as a recognizable error, or null when the page is not one. */
  private async wallError(page: BrowserPage, profile: SiteProfile): Promise<Error | null> {
    const seen = await this.probeSession(page, profile)
    if (seen.captcha) return new CaptchaRequiredError(`${profile.name} shows a human check. Complete it in the account browser, then try again.`)
    if (!seen.loggedIn) return new LoginRequiredError(`the account is not signed in on ${profile.name}. Sign in in the account browser, then try again.`)
    return null
  }

  private async readItems(page: BrowserPage, profile: SiteProfile, reader: ItemReader, url: string, limit: number): Promise<RawItem[]> {
    await page.goto(url, { timeoutMs: 30_000 })
    if (!(await page.waitForSelector(reader.containerSelector, 10_000))) {
      // A missing container is either a changed layout or a wall in front of the content; the person must be told which.
      throw (await this.wallError(page, profile)) ?? new LayoutChanged(`"${reader.containerSelector}" was not found on ${url}`)
    }
    await page.waitForSelector(reader.itemSelector, 3_000) // items may load after their container
    const items = await page.read<RawItem[] | null>(extractItemsScript(reader, limit))
    if (!Array.isArray(items)) throw new LayoutChanged(`the items on ${url} could not be extracted`)
    return items
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const profile = this.requireProfile(ctx)
    return ctx.session.withAgentControl(`monitor:${ctx.channel.id}`, async (page) => {
      const items = (await this.readItems(page, profile, profile.discussions, ctx.channel.url, options.limit)).filter((i) => i.id)
      const discussions: RemoteDiscussion[] = []
      const seen = new Set<string>()
      for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const url = this.trustedUrl(profile, item.permalink) ? item.permalink : ctx.channel.url
        let comments: RemoteComment[] = []
        if (url !== ctx.channel.url) {
          if (this.pacingMs > 0) await this.sleep(this.pacingMs)
          // A thread that cannot be read fails the batch: a partial baseline would make old comments look new.
          comments = this.toComments(profile, await this.readItems(page, profile, profile.comments, url, 500), url)
        }
        discussions.push({ externalId: item.id, url, title: item.title, author: item.author, body: item.body, postedAt: isoTime(item.time), comments })
      }
      return { discussions, fetchedAt: ctx.clock.now().toISOString() }
    })
  }

  private toComments(profile: SiteProfile, items: RawItem[], discussionUrl: string): RemoteComment[] {
    const seen = new Set<string>()
    const out: RemoteComment[] = []
    for (const item of items) {
      if (!item.id || seen.has(item.id) || !item.body) continue
      seen.add(item.id)
      out.push({
        externalId: item.id,
        parentExternalId: item.parentId || null,
        author: item.author,
        body: item.body,
        url: this.trustedUrl(profile, item.permalink) ? item.permalink : `${discussionUrl}#${item.id}`,
        postedAt: isoTime(item.time)
      })
    }
    return out
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    // Threads are located through the channel listing: the profile does not promise stable per-thread addresses.
    const batch = await this.fetchActivity(ctx, { limit: 100 })
    return batch.discussions.find((d) => d.externalId === discussionExternalId) ?? null
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const profile = this.requireProfile(ctx)
    if (!profile.metrics || profile.metrics.length === 0) return []
    return ctx.session.withAgentControl(`metrics:${ctx.channel.id}`, (page) => this.readMetrics(page, profile, ctx.channel.url))
  }

  private async readMetrics(page: BrowserPage, profile: SiteProfile, url: string): Promise<MetricReading[]> {
    await page.goto(url, { timeoutMs: 30_000 })
    const out: MetricReading[] = []
    for (const metric of profile.metrics ?? []) {
      const value = parseCount(await page.read<string | null>(elementTextScript(metric.selector, metric.attr)))
      out.push({ key: metric.key, label: metric.label, value, available: value !== null })
    }
    return out
  }

  // ───────────────────────────── Publishing ─────────────────────────────

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    let profile: SiteProfile
    try {
      profile = this.requireProfile(ctx)
    } catch (error) {
      return failed(errorMessage(error))
    }
    const flow = request.kind === 'post' ? profile.publish?.post : profile.publish?.reply
    if (!flow) return failed(`The site profile defines no steps for publishing a ${request.kind}.`)
    if (request.attachments.length > 0) return failed('Attachments are not supported by site profiles.')
    if (!this.trustedUrl(profile, request.destination)) return failed(`The destination is outside the profile host ${profile.host}.`)
    if (request.kind === 'post' && !request.title?.trim() && !request.text.trim() && !request.link) return failed('Nothing to publish.')
    if (request.kind === 'reply' && !request.text.trim()) return failed('The reply text is empty.')

    const values: PlaceholderValues = {
      text: request.text,
      title: request.title ?? '',
      link: request.link ?? '',
      parentId: request.parentExternalId ?? '',
      destination: request.destination,
      channelUrl: ctx.channel.url,
      target: ctx.channel.target,
      identity: ctx.account.identity ?? ''
    }
    try {
      return await ctx.session.withAgentControl(`publish:${ctx.channel.id}`, async (page) => {
        let submitted = false
        try {
          // Read-only: confirm the session and who is signed in before anything is typed or clicked.
          await page.goto(request.destination, { timeoutMs: 30_000 })
          const problem = await this.sessionProblem(page, profile, ctx.account.identity)
          if (problem) return failed(problem)
          const lastClick = flow.steps.map((s) => s.type).lastIndexOf('click')
          for (const [index, step] of flow.steps.entries()) {
            if (index === lastClick) submitted = true
            await this.runStep(page, profile, step, values, ticket)
          }
          return await this.verifyResult(page, flow, values)
        } catch (error) {
          // After the submit click an exception proves nothing about whether the site accepted the content.
          if (submitted) return { status: 'unknown', error: `The submission was made but its result could not be confirmed: ${errorMessage(error)}` } as const
          return failed(error instanceof TakeoverError ? 'The user took control of the browser before anything was submitted.' : errorMessage(error))
        }
      })
    } catch (error) {
      return failed(errorMessage(error))
    }
  }

  /**
   * Why sending as this account must not start (a message ready to show, recognizable by `authIssueOf` when it is a
   * sign-in or CAPTCHA problem), or null when the right account is signed in. When the account has a confirmed
   * identity, the page must prove it: a site whose signed-in name cannot be read cannot be trusted with a send.
   */
  private async sessionProblem(page: BrowserPage, profile: SiteProfile, expected: string | null): Promise<string | null> {
    const seen = await this.probeSession(page, profile)
    if (seen.captcha) return new CaptchaRequiredError(`${profile.name} shows a human check. Complete it in the account browser, then try again.`).message
    if (!seen.loggedIn) return new LoginRequiredError(`the account is not signed in on ${profile.name}. Sign in in the account browser, then try again.`).message
    if (!expected) return null
    const actual = comparableText(seen.identity)
    if (!profile.login.identitySelector || !actual) {
      return `The site does not show who is signed in, so the account ${expected} cannot be confirmed before sending. Nothing was sent.`
    }
    if (actual.toLowerCase() !== comparableText(expected).toLowerCase()) {
      return `Signed in as ${seen.identity.trim()}, not the configured account ${expected}. Nothing was sent.`
    }
    return null
  }

  private async runStep(page: BrowserPage, profile: SiteProfile, step: Step, values: PlaceholderValues, ticket: SendTicket): Promise<void> {
    switch (step.type) {
      case 'goto':
        return page.goto(this.renderUrl(profile, step.url, values), { timeoutMs: 30_000 })
      case 'waitFor': {
        const selector = renderTemplate(step.selector, values, 'selector')
        if (!(await page.waitForSelector(selector, step.timeoutMs ?? 8_000))) throw new Error(`The element "${selector}" did not appear (the site layout may have changed).`)
        return
      }
      case 'fill':
        return page.fill(renderTemplate(step.selector, values, 'selector'), renderTemplate(step.value, values, 'value'), ticket)
      case 'click':
        return page.click(renderTemplate(step.selector, values, 'selector'), ticket)
    }
  }

  /** Every verification condition the profile declares must hold; a rejection message turns the result into 'failed'. */
  private async verifyResult(page: BrowserPage, flow: PublishFlow, values: PlaceholderValues): Promise<PublishOutcome> {
    const { verify } = flow
    const needle = verify.textIncludes ? renderTemplate(verify.textIncludes, values, 'value').slice(0, 200) : null
    for (let waited = 0; waited <= this.verifyTimeoutMs; waited += this.pollMs) {
      const url = await page.url()
      if (verify.errorSelector) {
        const errors = await page.read<string[] | null>(visibleTextScript(verify.errorSelector))
        if (Array.isArray(errors) && errors.length > 0) return failed(`The site rejected the submission: ${errors.join('; ')}`)
      }
      const captures = verify.urlGlob ? matchGlob(verify.urlGlob, url) : {}
      const urlOk = verify.urlGlob ? captures !== null : true
      const selectorOk = verify.selector ? Boolean(await page.waitForSelector(verify.selector, 200)) : true
      let textOk = true
      if (needle) textOk = (await page.read<string>(pageTextScript())).replace(/\s+/g, ' ').includes(needle.replace(/\s+/g, ' '))
      if (urlOk && selectorOk && textOk) return { status: 'confirmed', url, externalId: captures?.id ?? url }
      await this.sleep(this.pollMs)
    }
    return { status: 'unknown', error: 'The submit button was pressed but the result page described by the profile was not recognized.' }
  }

  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    const profile = this.requireProfile(ctx)
    if (!profile.ownContent) {
      // Not being able to look is different from "not published": throw so the outcome stays unresolved.
      throw new Error('The site profile cannot look up the account’s own publications; check the site manually.')
    }
    const own = profile.ownContent
    // Without these fields an old item with the same text cannot be told from the new one, and "not found" would be a guess.
    const floor = earliestCreation(request)
    if (!own.reader.time) throw new Error('The profile’s own-content reader has no time field, so new content cannot be told from older content; check the site manually.')
    if (request.kind === 'reply' && !own.reader.parentId) throw new Error('The profile’s own-content reader has no parent field, so a reply cannot be tied to the comment it answers; check the site manually.')
    if (request.kind === 'post' && request.title && !own.reader.title) throw new Error('The profile’s own-content reader has no title field, so a post cannot be recognized; check the site manually.')

    return ctx.session.withAgentControl(`find:${ctx.channel.id}`, async (page) => {
      const url = this.renderUrl(profile, own.url, { identity: ctx.account.identity ?? '', channelUrl: ctx.channel.url, target: ctx.channel.target })
      const items = await this.readItems(page, profile, own.reader, url, 50)
      const hits = items
        .filter((i) => i.id && createdMs(i.time) >= floor)
        .filter((i) => {
          if (request.kind === 'reply') return i.parentId === request.parentExternalId && sameText(i.body, request.text)
          return (!request.title || sameText(i.title, request.title)) && (!request.text.trim() || !i.body || sameText(i.body, request.text))
        })
        .sort((a, b) => createdMs(a.time) - createdMs(b.time)) // the first thing created after the attempt is the likeliest result of it
      const hit = hits[0]
      return hit ? { url: this.trustedUrl(profile, hit.permalink) ? hit.permalink : ctx.channel.url, externalId: hit.id } : null
    })
  }
}

function isoTime(value: string): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}
