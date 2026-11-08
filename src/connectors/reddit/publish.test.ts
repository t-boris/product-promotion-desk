import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { TicketError, type PublishRequest } from '../../core/ports'
import { authIssueOf, CaptchaRequiredError, LoginRequiredError } from '../errors'
import { commentThing, isoAt, listing, postThing, routeHealthyReddit, seedChannel, T0, threadJson } from '../test-helpers'
import { RedditConnector } from './connector'
import { SEL } from './selectors'

const connector = new RedditConnector({ sleep: async () => undefined, pacingMs: 0 })

const THREAD_URL = 'https://www.reddit.com/r/test/comments/p1/post/c1/'

function setup() {
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  routeHealthyReddit(seeded.page)
  const ticketFor = (destination: string) => t.core.tickets.issue({ actionId: 'act-1', contentHash: 'hash', accountId: seeded.accountId, destination })
  return { ...t, ...seeded, ticketFor }
}

const replyRequest = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  kind: 'reply',
  destination: THREAD_URL,
  parentExternalId: 't1_c1',
  title: null,
  text: 'Thanks for the question!',
  link: null,
  attachments: [],
  ...over
})

const postRequest = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  kind: 'post',
  destination: 'https://www.reddit.com/r/test/',
  parentExternalId: null,
  title: 'A useful birth chart tip',
  text: 'Body of the post',
  link: null,
  attachments: [],
  ...over
})

/** Arrange the page so that a reply to t1_c1 succeeds and reads back. */
function armReply(h: ReturnType<typeof setup>): void {
  h.page.selectors.add('div.thing[data-fullname="t1_c1"]').add(SEL.replyText('t1_c1'))
  h.page.postedReply = { fullname: 't1_new1', permalink: '/r/test/comments/p1/post/new1/' }
  h.page.route('/api/info.json?id=t1_new1', listing([commentThing({ id: 'new1', author: 'natal_bot', parent: 't1_c1', body: 'Thanks for the question!' })]))
}

function armPost(h: ReturnType<typeof setup>, over: { title?: string } = {}): void {
  h.page.afterSubmitUrl = 'https://old.reddit.com/r/test/comments/n1/a_useful_birth_chart_tip/'
  h.page.route('/api/info.json?id=t3_n1', listing([postThing({ id: 'n1', author: 'natal_bot', title: over.title ?? 'A useful birth chart tip' })]))
}

describe('Reddit publishing: authorization', () => {
  it('refuses without any ticket and touches nothing', async () => {
    const h = setup()
    await expect(connector.publish(h.ctx, undefined as never, replyRequest())).rejects.toBeInstanceOf(TicketError)
    expect(h.page.log).toEqual([])
  })

  it('refuses a ticket issued for another destination', async () => {
    const h = setup()
    const ticket = h.ticketFor('https://www.reddit.com/r/test/comments/other/post/')
    await expect(connector.publish(h.ctx, ticket, replyRequest())).rejects.toThrow(/destination/)
    expect(h.page.writes).toEqual([])
  })

  it('refuses a forged ticket', async () => {
    const h = setup()
    const forged = { ...h.ticketFor(THREAD_URL), signature: '00'.repeat(32) }
    await expect(connector.publish(h.ctx, forged, replyRequest())).rejects.toBeInstanceOf(TicketError)
  })

  it('refuses an expired ticket', async () => {
    const h = setup()
    const ticket = h.ticketFor(THREAD_URL)
    h.clock.advance(10 * 60 * 1000)
    await expect(connector.publish(h.ctx, ticket, replyRequest())).rejects.toThrow(/expired/)
  })

  it('does not publish while the user holds the browser, and reports a definite failure', async () => {
    const h = setup()
    armReply(h)
    h.ctx.session.takeControl()
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome.status).toBe('failed')
    expect(h.page.writes).toEqual([])
  })

  it('stops with a definite failure if the user takes over before the submit click', async () => {
    const h = setup()
    armReply(h)
    h.page.waitForSelector = async (selector: string) => {
      if (selector.includes('textarea')) h.ctx.session.takeControl()
      return true
    }
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome.status).toBe('failed')
    expect(h.page.log.some((l) => l.startsWith('click form[id^="form-t1_c1"] button.save'))).toBe(false)
  })
})

describe('Reddit publishing: replies', () => {
  it('sends a reply through the form and confirms it by reading it back', async () => {
    const h = setup()
    armReply(h)
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome).toEqual({ status: 'confirmed', url: 'https://www.reddit.com/r/test/comments/p1/post/new1/', externalId: 't1_new1' })
    expect(h.page.writes.map((w) => w.split(' ')[0])).toEqual(['click', 'fill', 'click'])
    expect(h.page.writes[1]).toContain('Thanks for the question!')
  })

  it('replies to a post (top-level comment) without clicking a reply link', async () => {
    const h = setup()
    h.page.selectors.add('div.thing[data-fullname="t3_p1"]').add(SEL.replyText('t3_p1'))
    h.page.postedReply = { fullname: 't1_top1', permalink: '/x' }
    h.page.route('/api/info.json?id=t1_top1', listing([commentThing({ id: 'top1', author: 'natal_bot', parent: 't3_p1', body: 'Top-level answer' })]))
    const request = replyRequest({ parentExternalId: 't3_p1', text: 'Top-level answer', destination: 'https://www.reddit.com/r/test/comments/p1/post/' })
    const outcome = await connector.publish(h.ctx, h.ticketFor(request.destination), request)
    expect(outcome.status).toBe('confirmed')
    expect(h.page.writes.map((w) => w.split(' ')[0])).toEqual(['fill', 'click'])
  })

  it('rejects before submitting when the thread is locked', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/r/test/comments/p1.json', threadJson({ id: 'p1', locked: true }, [commentThing({ id: 'c1' })]))
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/locked/) })
    expect(h.page.writes).toEqual([])
  })

  it('rejects before submitting when the answered comment no longer exists', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/r/test/comments/p1.json', threadJson({ id: 'p1' }, [commentThing({ id: 'other' })]))
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/no longer exists/) })
    expect(h.page.writes).toEqual([])
  })

  it('maps a rate-limit message shown by the form to a definite failure', async () => {
    const h = setup()
    armReply(h)
    h.page.postedReply = null
    h.page.formErrors = ['you are doing that too much. try again in 9 minutes.']
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/too much/) })
  })

  it('reports unknown when the reply never shows up after the save click', async () => {
    const h = setup()
    armReply(h)
    h.page.postedReply = null
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome.status).toBe('unknown')
  })

  it('reports unknown (not failed) when something breaks after the save click', async () => {
    const h = setup()
    armReply(h)
    h.page.failOnSubmitClick = new Error('webContents destroyed')
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome).toMatchObject({ status: 'unknown', error: expect.stringMatching(/destroyed/) })
  })

  it('reports unknown when the reply appears but cannot be read back from Reddit', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/api/info.json?id=t1_new1', {}, 500)
    expect((await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())).status).toBe('unknown')
  })

  it('does not confirm a comment whose text differs from what was sent', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/api/info.json?id=t1_new1', listing([commentThing({ id: 'new1', author: 'natal_bot', parent: 't1_c1', body: 'something else entirely' })]))
    expect((await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())).status).toBe('unknown')
  })

  it('does not confirm a comment written by another account', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/api/info.json?id=t1_new1', listing([commentThing({ id: 'new1', author: 'someone_else', parent: 't1_c1', body: 'Thanks for the question!' })]))
    expect((await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())).status).toBe('unknown')
  })

  it('refuses when the signed-in account is not the configured one', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/api/me.json', { name: 'another_user' })
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/another_user/) })
    expect(h.page.writes).toEqual([])
  })

  it('refuses while the identity of the account is not confirmed yet, instead of sending as whoever is signed in', async () => {
    const t = makeTestCore({ connectors: [connector] })
    const seeded = seedChannel(t, { identity: null })
    routeHealthyReddit(seeded.page)
    const ticket = t.core.tickets.issue({ actionId: 'act-1', contentHash: 'hash', accountId: seeded.accountId, destination: THREAD_URL })
    const outcome = await connector.publish(seeded.ctx, ticket, replyRequest())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/identity/) })
    expect(seeded.page.writes).toEqual([])
  })

  it.each([
    ['a destination in another community', replyRequest({ destination: 'https://www.reddit.com/r/other/comments/p1/post/' })],
    ['a missing parent id', replyRequest({ parentExternalId: null })],
    ['an empty text', replyRequest({ text: '   ' })],
    ['a malformed parent id', replyRequest({ parentExternalId: 'c1; drop' })]
  ])('rejects %s before touching the page', async (_label, request) => {
    const h = setup()
    const outcome = await connector.publish(h.ctx, h.ticketFor(request.destination), request)
    expect(outcome.status).toBe('failed')
    expect(h.page.log).toEqual([])
  })
})

describe('Reddit publishing: posts', () => {
  it('submits a text post and confirms it from the permalink read back', async () => {
    const h = setup()
    armPost(h)
    const outcome = await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest())
    expect(outcome).toEqual({ status: 'confirmed', url: 'https://www.reddit.com/r/test/comments/n1/post/', externalId: 't3_n1' })
    expect(h.page.writes.map((w) => w.split(' ')[0])).toEqual(['fill', 'fill', 'click'])
    expect(h.page.log).toContain('goto https://old.reddit.com/r/test/submit?selftext=true')
  })

  it('submits a link post through the link field and not the text field', async () => {
    const h = setup()
    armPost(h)
    const request = postRequest({ text: '', link: 'https://example.com/natal' })
    expect((await connector.publish(h.ctx, h.ticketFor(request.destination), request)).status).toBe('confirmed')
    expect(h.page.writes.some((w) => w.includes('input[name="url"]') && w.includes('https://example.com/natal'))).toBe(true)
    expect(h.page.log).toContain('goto https://old.reddit.com/r/test/submit')
  })

  it('does not confirm when Reddit shows a different post than the one that was sent', async () => {
    const h = setup()
    armPost(h, { title: 'Totally different title' })
    expect((await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest())).status).toBe('unknown')
  })

  it('maps a validation error to a definite failure', async () => {
    const h = setup()
    h.page.formErrors = ['this community requires a flair']
    const outcome = await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/flair/) })
  })

  it('fails safely before typing when the submit form is not found', async () => {
    const h = setup()
    h.page.selectors = new Set()
    const outcome = await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest())
    expect(outcome.status).toBe('failed')
    expect(h.page.writes).toEqual([])
  })

  it.each([
    ['no title', postRequest({ title: ' ' })],
    ['link and text together', postRequest({ link: 'https://example.com' })],
    ['a non-http link', postRequest({ text: '', link: 'javascript:alert(1)' })],
    ['two images', postRequest({ text: '', attachments: [{ name: 'a.png', path: '/x/a.png', mime: 'image/png', sha256: 'aa' }, { name: 'b.png', path: '/x/b.png', mime: 'image/png', sha256: 'bb' }] })]
  ])('rejects %s', async (_label, request) => {
    const h = setup()
    const outcome = await connector.publish(h.ctx, h.ticketFor(request.destination), request)
    expect(outcome.status).toBe('failed')
    expect(h.page.log).toEqual([])
  })
})

describe('Reddit publishing: images', () => {
  function writeImage(content: string) {
    const path = join(mkdtempSync(join(tmpdir(), 'ppd-img-')), 'chart.png')
    writeFileSync(path, content)
    return { name: 'chart.png', path, mime: 'image/png', sha256: createHash('sha256').update(content).digest('hex') }
  }

  it('uploads the approved file through the file input and confirms the post', async () => {
    const h = setup()
    armPost(h)
    h.page.selectors.add(SEL.imageFile)
    const attachment = writeImage('png-bytes')
    const request = postRequest({ text: '', attachments: [attachment] })
    const outcome = await connector.publish(h.ctx, h.ticketFor(request.destination), request)
    expect(outcome.status).toBe('confirmed')
    expect(h.page.writes[0]).toBe(`upload ${SEL.imageFile} ${attachment.path}`)
  })

  it('refuses a file that changed after approval', async () => {
    const h = setup()
    armPost(h)
    h.page.selectors.add(SEL.imageFile)
    const attachment = { ...writeImage('png-bytes'), sha256: 'f'.repeat(64) }
    const request = postRequest({ text: '', attachments: [attachment] })
    const outcome = await connector.publish(h.ctx, h.ticketFor(request.destination), request)
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/changed after/) })
    expect(h.page.writes).toEqual([])
  })

  it('refuses a missing file and a non-image', async () => {
    const h = setup()
    const missing = { name: 'x.png', path: '/definitely/not/here.png', mime: 'image/png', sha256: 'aa' }
    expect((await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest({ text: '', attachments: [missing] }))).status).toBe('failed')
    const notImage = { ...writeImage('x'), mime: 'application/pdf' }
    expect((await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest({ text: '', attachments: [notImage] }))).status).toBe('failed')
    expect(h.page.writes).toEqual([])
  })
})

describe('Reddit publishing: not signed in and CAPTCHA', () => {
  it('reports a signed-out account as a recognizable sign-in problem before any write', async () => {
    const h = setup()
    armReply(h)
    h.page.route('/api/me.json', { message: 'Forbidden', error: 403 }, 403)
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome.status).toBe('failed')
    expect(authIssueOf(outcome.status === 'failed' ? outcome.error : '')).toBe('login')
    expect(h.page.writes).toEqual([])
  })

  it('reports a CAPTCHA wall as a recognizable CAPTCHA problem before any write', async () => {
    const h = setup()
    armReply(h)
    h.page.gate = { captcha: true, blocked: false, title: 'Prove your humanity' }
    const outcome = await connector.publish(h.ctx, h.ticketFor(THREAD_URL), replyRequest())
    expect(outcome.status).toBe('failed')
    expect(authIssueOf(outcome.status === 'failed' ? outcome.error : '')).toBe('captcha')
    expect(h.page.writes).toEqual([])
  })

  it('classifies a CAPTCHA demanded by the form after typing as a CAPTCHA problem, still a definite failure', async () => {
    const h = setup()
    armPost(h)
    h.page.afterSubmitUrl = null
    h.page.formErrors = ['please fill out the CAPTCHA']
    const outcome = await connector.publish(h.ctx, h.ticketFor(postRequest().destination), postRequest())
    expect(outcome.status).toBe('failed')
    expect(authIssueOf(outcome.status === 'failed' ? outcome.error : '')).toBe('captcha')
  })

  it('has stable error classes the flow worker can recognize by name', () => {
    expect(new LoginRequiredError('x').name).toBe('LoginRequiredError')
    expect(new CaptchaRequiredError('x').name).toBe('CaptchaRequiredError')
    expect(authIssueOf(new LoginRequiredError('x'))).toBe('login')
    expect(authIssueOf(Object.assign(new Error('boom'), { name: 'CaptchaRequiredError' }))).toBe('captcha')
    expect(authIssueOf(new Error('rate limited'))).toBeNull()
  })
})

describe('Reddit: resolving unknown outcomes', () => {
  /** The send attempt started 1000 s after the fixtures' base time; anything older cannot be its result. */
  const attemptedAt = isoAt(1000)
  const reply = (over: Partial<PublishRequest> = {}): PublishRequest => replyRequest({ attemptedAt, ...over })
  const post = (over: Partial<PublishRequest> = {}): PublishRequest => postRequest({ attemptedAt, ...over })
  const mine = (over: { id?: string; parent?: string; body?: string; created?: number } = {}) =>
    commentThing({ id: over.id ?? 'zz', author: 'natal_bot', parent: over.parent ?? 't1_c1', body: over.body ?? 'Thanks for the question!', created: over.created ?? T0 + 1060 })

  it('finds an own reply that matches the request body and parent', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine({ body: 'Thanks  for the\nquestion!' })]))
    expect(await connector.findPublished(h.ctx, reply())).toEqual({ url: 'https://www.reddit.com/r/test/comments/p1/post/zz/', externalId: 't1_zz' })
  })

  it('does not match a similar text under a different parent', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine({ parent: 't1_other' })]))
    expect(await connector.findPublished(h.ctx, reply())).toBeNull()
  })

  it('never matches an older comment with identical text (a common reply like "Thanks!")', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine({ id: 'old', body: 'Thanks!', created: T0 + 60 })]))
    expect(await connector.findPublished(h.ctx, reply({ text: 'Thanks!' }))).toBeNull()
  })

  it('picks the comment created after the attempt, not an older identical one', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine({ id: 'new', created: T0 + 1100 }), mine({ id: 'old', created: T0 + 60 })]))
    expect(await connector.findPublished(h.ctx, reply())).toMatchObject({ externalId: 't1_new' })
  })

  it('tolerates a few minutes of clock skew between this computer and Reddit', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine({ created: T0 + 1000 - 120 })])) // 2 minutes "before" the local attempt time
    expect(await connector.findPublished(h.ctx, reply())).toMatchObject({ externalId: 't1_zz' })
    h.page.route('/user/natal_bot/comments.json', listing([mine({ created: T0 + 1000 - 600 })])) // 10 minutes before: too old
    expect(await connector.findPublished(h.ctx, reply())).toBeNull()
  })

  it('refuses to guess when the time of the attempt is unknown', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine()]))
    await expect(connector.findPublished(h.ctx, replyRequest())).rejects.toThrow(/time of the send attempt/)
    await expect(connector.findPublished(h.ctx, reply({ attemptedAt: 'not a date' }))).rejects.toThrow(/time of the send attempt/)
  })

  it('finds an own post by title in this community, created after the attempt', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/submitted.json', listing([postThing({ id: 'n1', author: 'natal_bot', title: 'A useful birth chart tip', selftext: 'Body of the post', created: T0 + 1100 })]))
    expect(await connector.findPublished(h.ctx, post())).toMatchObject({ externalId: 't3_n1' })
    expect(await connector.findPublished(h.ctx, post({ title: 'Other title' }))).toBeNull()
  })

  it('does not match an older post with the same title, or one in another community', async () => {
    const h = setup()
    h.page.route(
      '/user/natal_bot/submitted.json',
      listing([
        postThing({ id: 'old', author: 'natal_bot', title: 'A useful birth chart tip', selftext: 'Body of the post', created: T0 + 60 }),
        postThing({ id: 'elsewhere', author: 'natal_bot', title: 'A useful birth chart tip', selftext: 'Body of the post', created: T0 + 1100, subreddit: 'other' })
      ])
    )
    expect(await connector.findPublished(h.ctx, post())).toBeNull()
  })

  it('refuses a request whose destination is not in this channel community', async () => {
    const h = setup()
    await expect(connector.findPublished(h.ctx, post({ destination: 'https://www.reddit.com/r/other/' }))).rejects.toThrow(/r\/test/)
  })

  it('throws instead of returning null when the history cannot be read, so "unreadable" is never "not published"', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', {}, 403)
    await expect(connector.findPublished(h.ctx, reply())).rejects.toThrow(/could not be read/)
  })

  it('throws a recognizable sign-in error when the history is refused because the session is signed out', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', {}, 403)
    h.page.route('/api/me.json', { message: 'Forbidden', error: 403 }, 403)
    await expect(connector.findPublished(h.ctx, reply())).rejects.toBeInstanceOf(LoginRequiredError)
  })
})
