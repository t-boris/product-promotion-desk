// Capability assessment for a subreddit. Read-only: no ticket is available here, so nothing can be sent.
// A capability is 'verified' only when it was actually observed; sending abilities are never verified here.

import { TakeoverError, type BrowserPage, type ConnectorContext } from '../../core/ports'
import type { Capability, CapabilityStatus } from '../../shared/types'
import { CapabilityBuilder } from '../capabilities'
import { gateProbeScript, type GateProbe } from '../page-scripts'
import { analyzeRules, quoteRule, type RulesAnalysis } from '../rules-text'
import { errorMessage } from '../text'
import { RedditApi } from './api'
import { membershipOf, type AboutInfo, type MappedThread, type RedditPost } from './mapping'
import { oldSubmitUrl, oldThreadUrl, SEL } from './selectors'
import { parseSubreddit, stripPrefix } from './target'

export interface Verdict {
  status: 'needs_check' | 'restricted' | 'unavailable'
  detail: string
}

/** What the community settings and rules allow, before looking at any page. Pure. */
export function postingVerdicts(sub: string, about: AboutInfo | null, rules: RulesAnalysis | null): { post: Verdict; reply: Verdict } {
  const pending = (what: string): Verdict => ({
    status: 'needs_check',
    detail: `No restriction found for ${what}. It is confirmed by the first authorized send, never by a test message.`
  })
  let post = pending('posting')
  let reply = pending('replying')

  if (about?.subredditType === 'archived') {
    const archived: Verdict = { status: 'unavailable', detail: `r/${sub} is archived and read-only.` }
    return { post: archived, reply: archived }
  }
  if (about?.userIsBanned) {
    const banned: Verdict = { status: 'restricted', detail: `This account is banned from r/${sub}.` }
    return { post: banned, reply: banned }
  }
  if (about?.subredditType === 'restricted' && !about.userIsContributor) {
    post = { status: 'restricted', detail: `Only approved users can post in r/${sub}; this account is not approved.` }
  }
  if (about && about.submissionType === 'link' && post.status === 'needs_check') {
    post = { status: 'needs_check', detail: `r/${sub} accepts link posts only. ${post.detail}` }
  }
  if (rules?.automationForbidden) {
    const why = `Community rules appear to forbid automation or AI-generated content — ${quoteRule(rules.automationForbidden)}`
    post = { status: 'restricted', detail: why }
    reply = { status: 'restricted', detail: why }
  } else if (rules && rules.promotionRules.length > 0 && post.status === 'needs_check') {
    post = { ...post, detail: `Rules mention promotion — read them before posting: ${quoteRule(rules.promotionRules[0])}. ${post.detail}` }
  }
  return { post, reply }
}

/**
 * What the owner is told when Reddit did not give the post list: what it said, and what else the same sign-in could read, so a refusal of
 * one call is not taken for a broken sign-in. `member` false points at the Membership row. Pure.
 */
export function listingRefusal(sub: string, why: string, read: { about: boolean; rules: boolean }, member: boolean | null): string {
  const said = `Reddit did not give the r/${sub} post list: ${why}.`
  const others =
    read.about && read.rules
      ? " The community's rules and numbers were read with the same sign-in, so the sign-in works; only the post list was refused."
      : read.about || read.rules
        ? ' Part of the community (its rules or its numbers) was read with the same sign-in; only the post list was refused.'
        : " The community's other pages were refused too."
  return `${said}${others}${member === false ? ` This account has not joined r/${sub} yet (see Membership).` : ''}`
}

/** The Membership row (DEC-029): whether the account has joined, in words that say what it means for this community. Pure. */
export function membershipRow(sub: string, about: AboutInfo | null, aboutReason: string): { status: CapabilityStatus; detail: string } {
  if (!about) return { status: 'needs_check', detail: `Membership is not known: the community's page could not be read (${aboutReason || 'no reason given'}).` }
  const { member, banned, access } = membershipOf(about)
  if (banned) return { status: 'restricted', detail: `This account is banned from r/${sub}.` }
  if (member === true) return { status: 'verified', detail: `This account is a member of r/${sub}.` }
  if (member === null) return { status: 'needs_check', detail: `Reddit did not say whether this account is a member of r/${sub}.` }
  if (access === 'private') {
    return { status: 'needs_user', detail: `r/${sub} is private: joining needs an invitation or approval, and the AI does not ask for it. Do it yourself in the account's browser.` }
  }
  return {
    status: 'needs_check',
    detail: `This account has not joined r/${sub}. Reading a public community does not need it; some communities want it for posting. Join in the account's browser, or press "Let the AI join".`
  }
}

async function attempt<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    if (error instanceof TakeoverError) throw error
    return { ok: false, reason: errorMessage(error) }
  }
}

async function reachable(page: BrowserPage, url: string, selector: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const loaded = await attempt(() => page.goto(url, { timeoutMs: 30_000 }))
  if (!loaded.ok) return { ok: false, reason: `could not open ${url}: ${loaded.reason}` }
  return (await page.waitForSelector(selector, 8_000)) ? { ok: true } : { ok: false, reason: `the form was not found on ${url}` }
}

/** Opens `url` and looks for `selector`. Reaching a form is not proof that sending works, so success keeps 'needs_check'. */
async function checkForm(page: BrowserPage, base: Verdict, url: string, selector: string, label: string): Promise<Verdict> {
  const check = await attempt(() => reachable(page, url, selector))
  if (check.ok && check.value.ok) return { status: 'needs_check', detail: `The ${label} is reachable. ${base.detail}` }
  const why = check.ok ? (check.value.ok ? '' : check.value.reason) : check.reason
  return { status: 'unavailable', detail: `The ${label} is not usable: ${why}.` }
}

export function needsUser(ctx: ConnectorContext, detail: string): Capability[] {
  return new CapabilityBuilder(ctx.clock.now()).fillRemaining('needs_user', detail).build()
}

export async function assessSubreddit(ctx: ConnectorContext): Promise<Capability[]> {
  const sub = parseSubreddit(ctx.channel.target)
  if (!sub) throw new Error(`Channel target is not a subreddit: ${ctx.channel.target}`)
  const b = new CapabilityBuilder(ctx.clock.now())

  return ctx.session.withAgentControl(`assess:${ctx.channel.id}`, async (page) => {
    const api = new RedditApi(page)
    await page.goto(ctx.channel.url, { timeoutMs: 30_000 })
    const gate = await page.read<GateProbe>(gateProbeScript())
    if (gate.captcha) return needsUser(ctx, 'Reddit shows a CAPTCHA. Open the browser, complete it on the page, then assess again.')
    if (gate.blocked) return b.fillRemaining('needs_check', 'Reddit is throttling or blocking this browser right now. Try again later.').build()

    const identity = await api.me()
    if (!identity) return needsUser(ctx, 'The account is not signed in to Reddit. Open the browser, sign in on the page, then assess again.')

    // ── The community's own pages: its settings (and so whether the account joined) and its rules. Read first: a refused post list is
    // explained by what else the same sign-in could read. ──
    const about = await attempt(() => api.about(sub))
    const rulesResult = await attempt(() => api.rules(sub))
    const aboutInfo = about.ok && about.value.ok ? about.value.value : null
    const rulesList = rulesResult.ok && rulesResult.value.ok ? rulesResult.value.value : null
    const aboutWhy = about.ok && !about.value.ok ? about.value.reason : about.ok ? '' : about.reason
    const joined = membershipRow(sub, aboutInfo, aboutWhy)
    b.set('membership', joined.status, joined.detail)

    // ── Reading ──
    const listing = await attempt(() => api.listing(sub, 10))
    let posts: RedditPost[] = []
    let thread: MappedThread | null = null
    if (!listing.ok || !listing.value.ok) {
      const denied = listing.ok && !listing.value.ok && [401, 403, 404].includes(listing.value.status)
      const why = listing.ok && !listing.value.ok ? listing.value.reason : listing.ok ? '' : listing.reason
      const status = denied ? 'unavailable' : 'needs_check'
      b.set('read_posts', status, listingRefusal(sub, why || 'no reason given', { about: aboutInfo !== null, rules: rulesList !== null }, aboutInfo ? aboutInfo.userIsSubscriber : null))
      // One refused call is one problem: the rows that wait for it say so, and do not say it again.
      b.set('read_comments', status, 'Not tried: comments are found through the posts, and the post list could not be read (see Read posts).')
      b.set('detect_changes', 'needs_check', 'Not examined: it needs the post list (see Read posts).')
    } else {
      posts = listing.value.value.filter((p) => !p.removed)
      b.set(
        'read_posts',
        'verified',
        posts.length > 0 ? `Read ${posts.length} recent posts from r/${sub}.` : `The r/${sub} listing is readable but the community has no visible posts yet.`
      )
      const withComments = posts.find((p) => (p.numComments ?? 0) > 0)
      if (!withComments) {
        b.set('read_comments', 'needs_check', 'No recent post with comments was found to read.')
      } else {
        const result = await attempt(() => api.thread(sub, withComments.fullname))
        if (result.ok && result.value.ok && result.value.value.mapped.comments.length > 0) {
          thread = result.value.value
          b.set('read_comments', 'verified', `Read ${thread.mapped.comments.length} comments from "${thread.post.title.slice(0, 60)}".`)
        } else {
          const why = result.ok ? (result.value.ok ? 'the thread had no readable comments' : result.value.reason) : result.reason
          b.set('read_comments', 'needs_check', `Comments could not be read: ${why}.`)
        }
      }
      const postsStable = posts.length > 0 && posts.every((p) => p.fullname && p.createdAt)
      const commentsStable = thread !== null && thread.mapped.comments.every((c) => c.externalId && c.postedAt)
      if (postsStable && commentsStable) {
        b.set('detect_changes', 'verified', 'Posts and comments carry stable ids and creation times, so new activity can be detected by comparing them.')
      } else if (postsStable) {
        b.set('detect_changes', 'needs_check', 'Posts carry stable ids and creation times; comment ids were not observed yet (no thread with comments was readable).')
      } else {
        b.set('detect_changes', 'needs_check', 'No posts were available to examine stable ids and timestamps.')
      }
    }

    // ── Rules and posting restrictions ──
    const analysis = rulesList ? analyzeRules(rulesList) : null
    if (rulesList) {
      const notes: string[] = []
      if (analysis?.automationForbidden) notes.push(`automation/AI rule found — ${quoteRule(analysis.automationForbidden)}`)
      if (analysis && analysis.promotionRules.length > 0) notes.push(`${analysis.promotionRules.length} rule(s) mention promotion`)
      b.set('rules', 'verified', `Read ${rulesList.length} community rules${notes.length ? ` (${notes.join('; ')})` : '; none about automation was found'}. Automatic reading is a heuristic: read the rules yourself too.`)
    } else {
      const why = rulesResult.ok && !rulesResult.value.ok ? rulesResult.value.reason : rulesResult.ok ? '' : rulesResult.reason
      b.set('rules', 'needs_check', `The community rules could not be read (${why}). Read them manually before enabling sending.`)
    }
    const verdicts = postingVerdicts(sub, aboutInfo, analysis)

    // ── Own history (verification path) ──
    const ownPosts = await attempt(() => api.ownSubmitted(identity, 5))
    const ownComments = await attempt(() => api.ownComments(identity, 5))
    if (ownPosts.ok && ownPosts.value.ok && ownComments.ok && ownComments.value.ok) {
      b.set('verify_send', 'verified', `The account's own posts and comments can be read back (u/${identity}). The first real send will be matched against them.`)
    } else {
      b.set('verify_send', 'needs_check', `The account's own submissions could not be read back (u/${identity}); send results would stay unconfirmed.`)
    }

    // ── Metrics ──
    const scored = posts.filter((p) => p.score !== null)
    const seen: string[] = []
    if (aboutInfo?.subscribers != null) seen.push('subscribers')
    if (scored.length > 0) seen.push('post scores', 'comment counts')
    if (aboutInfo?.activeUsers != null) seen.push('active users')
    b.set(
      'metrics',
      seen.length > 0 ? 'verified' : 'needs_check',
      seen.length > 0 ? `Readable: ${seen.join(', ')}. Anything Reddit hides is shown as unavailable, never as zero.` : 'No platform metric was observable yet.'
    )

    // ── The account's inbox (DEC-039): read-only, one small listing. A refusal of it never touches the other rows. ──
    const inbox = await attempt(() => api.inbox('inbox', 1))
    if (inbox.ok && inbox.value.ok) {
      b.set('read_inbox', 'verified', 'The account\'s inbox can be read, so replies to it and mentions of it can be collected.')
    } else {
      const status = inbox.ok && !inbox.value.ok ? inbox.value.status : 0
      const why = inbox.ok && !inbox.value.ok ? inbox.value.reason : inbox.ok ? '' : inbox.reason
      b.set('read_inbox', [401, 403, 404].includes(status) ? 'unavailable' : 'needs_check', `The account's inbox could not be read (${why || 'no reason given'}), so replies to it and mentions of it are not collected.`)
    }

    // ── Publishing UI (reachability only, nothing is typed or clicked) ──
    const sample = posts.find((p) => !p.locked && !p.archived)
    const finalPost = verdicts.post.status === 'needs_check' ? await checkForm(page, verdicts.post, oldSubmitUrl(sub, 'self'), SEL.postForm, 'submit form') : verdicts.post
    const replyUrl = sample ? oldThreadUrl(sub, stripPrefix(sample.fullname)) : null
    const finalReply =
      verdicts.reply.status !== 'needs_check'
        ? verdicts.reply
        : replyUrl
          ? await checkForm(page, verdicts.reply, replyUrl, SEL.commentBox, 'comment form')
          : { ...verdicts.reply, detail: `No open thread was available to inspect the comment form. ${verdicts.reply.detail}` }
    b.set('publish_post', finalPost.status, finalPost.detail)
    b.set('publish_reply', finalReply.status, finalReply.detail)

    return b.build()
  })
}

