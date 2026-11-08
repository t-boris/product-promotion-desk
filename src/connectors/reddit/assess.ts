// Capability assessment for a subreddit. Read-only: no ticket is available here, so nothing can be sent.
// A capability is 'verified' only when it was actually observed; sending abilities are never verified here.

import { TakeoverError, type BrowserPage, type ConnectorContext } from '../../core/ports'
import type { Capability } from '../../shared/types'
import { CapabilityBuilder } from '../capabilities'
import { gateProbeScript, type GateProbe } from '../page-scripts'
import { analyzeRules, quoteRule, type RulesAnalysis } from '../rules-text'
import { errorMessage } from '../text'
import { RedditApi } from './api'
import type { AboutInfo, MappedThread, RedditPost } from './mapping'
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

    // ── Reading ──
    const listing = await attempt(() => api.listing(sub, 10))
    let posts: RedditPost[] = []
    let thread: MappedThread | null = null
    if (!listing.ok || !listing.value.ok) {
      const denied = listing.ok && !listing.value.ok && [401, 403, 404].includes(listing.value.status)
      const why = listing.ok && !listing.value.ok ? listing.value.reason : listing.ok ? '' : listing.reason
      const status = denied ? 'unavailable' : 'needs_check'
      b.set('read_posts', status, `Could not read the r/${sub} listing: ${why}.`)
      b.set('read_comments', status, 'Comments cannot be read without reading the posts first.')
      b.set('detect_changes', 'needs_check', 'Change detection could not be examined because the listing could not be read.')
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
    const about = await attempt(() => api.about(sub))
    const rulesResult = await attempt(() => api.rules(sub))
    const aboutInfo = about.ok && about.value.ok ? about.value.value : null
    const rulesList = rulesResult.ok && rulesResult.value.ok ? rulesResult.value.value : null
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

