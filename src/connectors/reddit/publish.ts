// Publishing by driving Reddit's real forms through the controlled browser page.
// Authorization is layered: this module checks the ticket first, and every write call on the page
// (fill / click / uploadFile) verifies it again. After the submit click the outcome is always read back
// from Reddit itself; "confirmed" is never assumed from the click.

import { existsSync, statSync } from 'node:fs'
import {
  TakeoverError,
  type BrowserPage,
  type ConnectorContext,
  type PublishedRef,
  type PublishOutcome,
  type PublishRequest,
  type SendTicket
} from '../../core/ports'
import { CaptchaRequiredError, LoginRequiredError } from '../errors'
import { sha256OfFile } from '../files'
import { createdMs, earliestCreation } from '../reconcile'
import { errorMessage, sameText } from '../text'
import { ensureRedditOrigin, RedditApi } from './api'
import { CAPTCHA_HINT, captchaShown, refusalError } from './auth'
import type { OwnComment, RedditPost } from './mapping'
import { formErrorsScript, imageSubmitUrl, oldSubmitUrl, oldThreadUrl, postedReplyScript, SEL } from './selectors'
import { isFullname, parseSubreddit, postIdFromUrl, stripPrefix } from './target'

export interface RedditRuntime {
  sleep(ms: number): Promise<void>
  /** Polling cadence and limits while waiting for Reddit to answer a submission. */
  pollMs: number
  submitTimeoutMs: number
  imageSubmitTimeoutMs: number
  readBackTries: number
  readBackDelayMs: number
}

export const DEFAULT_RUNTIME: RedditRuntime = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs: 750,
  submitTimeoutMs: 20_000,
  imageSubmitTimeoutMs: 60_000,
  readBackTries: 4,
  readBackDelayMs: 2_000
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

/** The form's own error messages as a definite failure; a demanded CAPTCHA is reported as such so the person can solve it. */
function rejection(what: 'post' | 'reply', errors: string[]): string {
  const text = errors.join('; ')
  return /captcha/i.test(text) ? new CaptchaRequiredError(`Reddit asks for a CAPTCHA before it accepts the ${what}: ${text}`).message : `Reddit rejected the ${what}: ${text}`
}
const unknown = (error: string): PublishOutcome => ({ status: 'unknown', error })

/** Validates what can be checked without touching the page. Returns an error message, or null. */
export function validateRequest(request: PublishRequest, sub: string): string | null {
  const destinationSub = parseSubreddit(request.destination)
  if (!destinationSub || destinationSub.toLowerCase() !== sub.toLowerCase()) return `Destination ${request.destination} is not in r/${sub}.`
  if (request.kind === 'reply') {
    if (!request.parentExternalId || !isFullname(request.parentExternalId)) return 'A reply needs the Reddit id of the post or comment being answered.'
    if (!postIdFromUrl(request.destination)) return 'The reply destination must be a thread or comment URL.'
    if (!request.text.trim()) return 'The reply text is empty.'
    if (request.attachments.length > 0 || request.link) return 'Replies cannot carry attachments or links on their own.'
    return null
  }
  if (!request.title?.trim()) return 'A Reddit post needs a title.'
  if (request.attachments.length > 1) return 'Only one image per post is supported.'
  if (request.attachments.length === 1 && (request.link || request.text.trim())) return 'An image post cannot also carry a link or body text on Reddit.'
  if (request.link && request.text.trim()) return 'A link post cannot also carry body text on Reddit.'
  if (request.link && !/^https?:\/\//i.test(request.link)) return 'The link must start with http:// or https://.'
  return null
}

export async function publishToReddit(
  ctx: ConnectorContext,
  ticket: SendTicket,
  request: PublishRequest,
  runtime: RedditRuntime
): Promise<PublishOutcome> {
  // First line of defence (the page methods verify the ticket again on every write).
  ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })

  const sub = parseSubreddit(ctx.channel.target)
  if (!sub) return failed(`Channel target is not a subreddit: ${ctx.channel.target}`)
  const invalid = validateRequest(request, sub)
  if (invalid) return failed(invalid)
  const identity = ctx.account.identity
  if (!identity) return failed('The account identity is not confirmed yet. Check the login first.')

  try {
    return await ctx.session.withAgentControl(`publish:${ctx.channel.id}`, async (page) => {
      let submitted = false
      const markSubmitted = (): void => {
        submitted = true
      }
      try {
        await ensureRedditOrigin(page, ctx.channel.url)
        const api = new RedditApi(page)
        // Nothing has been typed yet, so a wall in front of Reddit is a definite, recognizable failure.
        if (await captchaShown(page)) return failed(new CaptchaRequiredError(CAPTCHA_HINT).message)
        const signedIn = await api.me()
        if (!signedIn) return failed(new LoginRequiredError('the account is not signed in to Reddit.').message)
        if (signedIn.toLowerCase() !== identity.toLowerCase()) return failed(`Signed in as u/${signedIn}, not the configured account u/${identity}.`)
        return request.kind === 'reply'
          ? await sendReply(page, api, ticket, request, sub, identity, runtime, markSubmitted)
          : await sendPost(page, api, ticket, request, sub, identity, runtime, markSubmitted)
      } catch (error) {
        // After the submit click an exception proves nothing: the post may or may not exist.
        if (submitted) return unknown(`The submission was made but its result could not be confirmed: ${errorMessage(error)}`)
        if (error instanceof TakeoverError) return failed('The user took control of the browser before anything was submitted.')
        return failed(errorMessage(error))
      }
    })
  } catch (error) {
    // withAgentControl itself refused (user holds the browser) or could not open the page: nothing was sent.
    return failed(errorMessage(error))
  }
}

// ───────────────────────────── Posts ─────────────────────────────

async function sendPost(
  page: BrowserPage,
  api: RedditApi,
  ticket: SendTicket,
  request: PublishRequest,
  sub: string,
  identity: string,
  runtime: RedditRuntime,
  markSubmitted: () => void
): Promise<PublishOutcome> {
  const title = (request.title ?? '').trim()
  const image = request.attachments[0]

  if (image) {
    const problem = await checkAttachment(image)
    if (problem) return failed(problem)
    await page.goto(imageSubmitUrl(sub), { timeoutMs: 30_000 })
    if (!(await page.waitForSelector(SEL.imageFile, 12_000))) {
      return failed('The image upload form was not found (the Reddit page layout may have changed).')
    }
    await page.uploadFile(SEL.imageFile, image.path, ticket)
    await page.fill(SEL.imageTitle, title, ticket)
    markSubmitted()
    await page.click(SEL.imageSubmit, ticket)
    return confirmPost(page, api, request, sub, identity, runtime, runtime.imageSubmitTimeoutMs, 'body')
  }

  const kind = request.link ? 'link' : 'self'
  await page.goto(oldSubmitUrl(sub, kind), { timeoutMs: 30_000 })
  if (!(await page.waitForSelector(SEL.postForm, 10_000))) {
    return failed('The submit form was not found (posting may not be allowed here, or the Reddit page layout changed).')
  }
  await page.fill(SEL.postTitle, title, ticket)
  if (request.link) await page.fill(SEL.postUrl, request.link, ticket)
  else if (request.text.trim()) await page.fill(SEL.postText, request.text, ticket)
  markSubmitted()
  await page.click(SEL.postSubmit, ticket)
  return confirmPost(page, api, request, sub, identity, runtime, runtime.submitTimeoutMs, 'form#newlink')
}

async function checkAttachment(attachment: PublishRequest['attachments'][number]): Promise<string | null> {
  if (!attachment.mime.startsWith('image/')) return `Attachment ${attachment.name} is not an image.`
  if (!existsSync(attachment.path) || !statSync(attachment.path).isFile()) return `Attachment file is missing: ${attachment.name}.`
  if (statSync(attachment.path).size > MAX_IMAGE_BYTES) return `Attachment ${attachment.name} is larger than 20 MB.`
  // The approval is bound to the exact bytes; refuse if the file changed afterwards (REQ-004).
  if ((await sha256OfFile(attachment.path)) !== attachment.sha256) return `Attachment ${attachment.name} changed after it was approved.`
  return null
}

/** Reads the form's visible error messages, tolerating a page that is mid-navigation. */
async function visibleErrors(page: BrowserPage, scope: string): Promise<string[]> {
  try {
    const errors = await page.read<string[] | null>(formErrorsScript(scope))
    return Array.isArray(errors) ? errors : []
  } catch (error) {
    if (error instanceof TakeoverError) throw error
    return []
  }
}

async function confirmPost(
  page: BrowserPage,
  api: RedditApi,
  request: PublishRequest,
  sub: string,
  identity: string,
  runtime: RedditRuntime,
  timeoutMs: number,
  errorScope: string
): Promise<PublishOutcome> {
  let postId: string | null = null
  for (let waited = 0; waited <= timeoutMs; waited += runtime.pollMs) {
    const url = await page.url()
    if (/\/comments\//.test(url)) {
      postId = postIdFromUrl(url)
      if (postId) break
    }
    const errors = await visibleErrors(page, errorScope)
    if (errors.length > 0) return failed(rejection('post', errors))
    await runtime.sleep(runtime.pollMs)
  }
  if (!postId) return unknown('The submit button was pressed but Reddit showed neither the new post nor an error.')

  const wanted = `t3_${postId}`
  for (let attempt = 0; attempt < runtime.readBackTries; attempt += 1) {
    if (attempt > 0) await runtime.sleep(runtime.readBackDelayMs)
    const info = await api.info(wanted)
    const post = info.ok ? info.value.posts[0] : undefined
    if (post && matchesOwnPost(post, request, sub, identity)) return { status: 'confirmed', url: post.permalink, externalId: post.fullname }
    if (post) return unknown(`Reddit shows post ${wanted} but it does not match what was sent.`)
  }
  return unknown(`The post page ${wanted} opened but the post could not be read back from Reddit.`)
}

function matchesOwnPost(post: RedditPost, request: PublishRequest, sub: string, identity: string): boolean {
  return (
    post.author.toLowerCase() === identity.toLowerCase() &&
    post.subreddit.toLowerCase() === sub.toLowerCase() &&
    sameText(post.title, request.title ?? '')
  )
}

// ───────────────────────────── Replies ─────────────────────────────

interface PostedReply {
  fullname: string | null
  permalink: string | null
}

async function sendReply(
  page: BrowserPage,
  api: RedditApi,
  ticket: SendTicket,
  request: PublishRequest,
  sub: string,
  identity: string,
  runtime: RedditRuntime,
  markSubmitted: () => void
): Promise<PublishOutcome> {
  const parent = request.parentExternalId as string // validated by validateRequest
  const postId = postIdFromUrl(request.destination) as string

  // Current thread state (REQ-004): a locked or archived thread, or a vanished comment, is rejected up front.
  const thread = await api.thread(sub, postId)
  if (!thread.ok) return failed(`The thread could not be checked before replying: ${thread.reason}.`)
  if (thread.value.post.locked) return failed('The thread is locked; replies are not accepted.')
  if (thread.value.post.archived) return failed('The thread is archived; replies are not accepted.')
  if (thread.value.post.removed) return failed('The post was removed.')
  if (parent.startsWith('t1_')) {
    const known = thread.value.mapped.comments.some((c) => c.externalId === parent)
    if (!known && thread.value.mapped.moreIds.length === 0) return failed('The comment being answered no longer exists or was removed.')
  }

  const commentId = parent.startsWith('t1_') ? stripPrefix(parent) : undefined
  await page.goto(oldThreadUrl(sub, postId, commentId), { timeoutMs: 30_000 })
  if (!(await page.waitForSelector(`div.thing[data-fullname="${parent}"]`, 10_000))) {
    return failed('The thread page did not show the item being answered.')
  }
  if (commentId) await page.click(SEL.replyLink(parent), ticket)
  if (!(await page.waitForSelector(SEL.replyText(parent), 8_000))) {
    return failed('The reply form did not open (the Reddit page layout may have changed, or the thread does not accept replies).')
  }
  await page.fill(SEL.replyText(parent), request.text, ticket)
  markSubmitted()
  await page.click(SEL.replySave(parent), ticket)

  let found: PostedReply | null = null
  for (let waited = 0; waited <= runtime.submitTimeoutMs; waited += runtime.pollMs) {
    const errors = await visibleErrors(page, `form[id^="form-${parent}"]`)
    if (errors.length > 0) return failed(rejection('reply', errors))
    try {
      found = await page.read<PostedReply | null>(postedReplyScript(parent, identity))
    } catch (error) {
      if (error instanceof TakeoverError) throw error
    }
    if (found?.fullname) break
    await runtime.sleep(runtime.pollMs)
  }
  if (!found?.fullname) return unknown('The save button was pressed but the new reply did not appear on the page.')

  for (let attempt = 0; attempt < runtime.readBackTries; attempt += 1) {
    if (attempt > 0) await runtime.sleep(runtime.readBackDelayMs)
    const info = await api.info(found.fullname)
    const comment = info.ok ? info.value.comments[0] : undefined
    if (comment && matchesOwnComment(comment, request, identity)) {
      return { status: 'confirmed', url: comment.permalink, externalId: comment.fullname }
    }
    if (comment) return unknown(`Reddit shows comment ${found.fullname} but it does not match what was sent.`)
  }
  return unknown(`The reply ${found.fullname} appeared on the page but could not be read back from Reddit.`)
}

function matchesOwnComment(comment: OwnComment, request: PublishRequest, identity: string): boolean {
  return (
    comment.author.toLowerCase() === identity.toLowerCase() &&
    comment.parentFullname === request.parentExternalId &&
    sameText(comment.body, request.text)
  )
}

// ───────────────────────────── Resolving unknown outcomes ─────────────────────────────

/** The oldest of the candidates (the first thing created after the attempt is the most likely result of it). */
function oldest<T extends { createdAt: string | null }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => createdMs(a.createdAt) - createdMs(b.createdAt))[0]
}

/**
 * Looks through the account's own recent posts or comments for the request. `null` means "looked and found
 * nothing"; a failure to look at all throws, so an unreadable history is never mistaken for "not published".
 *
 * A match must have been created at or after the attempt (minus a few minutes of clock skew), and must be bound to
 * the target: a reply to exactly the requested parent; a post in the requested community with the requested title.
 * Text alone never matches, so an older identical "Thanks!" cannot be mistaken for the new reply.
 */
export async function findOwnPublication(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
  const sub = parseSubreddit(ctx.channel.target)
  if (!sub) throw new Error(`Channel target is not a subreddit: ${ctx.channel.target}`)
  const destinationSub = parseSubreddit(request.destination)
  if (!destinationSub || destinationSub.toLowerCase() !== sub.toLowerCase()) {
    throw new Error(`The destination ${request.destination} is not in r/${sub}, so this channel cannot look for it.`)
  }
  const floor = earliestCreation(request)
  return ctx.session.withAgentControl(`find:${ctx.channel.id}`, async (page) => {
    await ensureRedditOrigin(page, ctx.channel.url)
    const api = new RedditApi(page)
    const identity = ctx.account.identity ?? (await api.me())
    if (!identity) throw new LoginRequiredError('the account is not signed in, so its own submissions cannot be searched.')

    if (request.kind === 'reply') {
      const own = await api.ownComments(identity, 50)
      if (!own.ok) throw await refusalError(page, api, own, `Own comments could not be read: ${own.reason}`)
      const hit = oldest(own.value.filter((c) => createdMs(c.createdAt) >= floor && c.parentFullname === request.parentExternalId && sameText(c.body, request.text)))
      return hit ? { url: hit.permalink, externalId: hit.fullname } : null
    }
    const own = await api.ownSubmitted(identity, 50)
    if (!own.ok) throw await refusalError(page, api, own, `Own posts could not be read: ${own.reason}`)
    const hit = oldest(
      own.value.filter(
        (p) =>
          createdMs(p.createdAt) >= floor &&
          p.subreddit.toLowerCase() === sub.toLowerCase() &&
          sameText(p.title, request.title ?? '') &&
          (!request.text.trim() || sameText(p.body, request.text))
      )
    )
    return hit ? { url: hit.permalink, externalId: hit.fullname } : null
  })
}
