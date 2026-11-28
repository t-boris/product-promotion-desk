import { statSync } from 'node:fs'
import type { Capability, CapabilityKey, CapabilityStatus, Channel, MetricReading } from '../../shared/types'
import { isVideoMime } from '../../shared/types'
import { HttpNoAnswerError } from '../../core/net/http'
import type { ActivityBatch, ApiAccess, ChannelGuide, Connector, ConnectorContext, LoginState, NormalizedTarget, PublishedRef, PublishOutcome, PublishRequest, RemoteDiscussion, SendTicket } from '../../core/ports'
import { LinkedInApi, looksLikeLinkedInToken, type LinkedInAnswer, type LinkedInAsset, type LinkedInMember, type LinkedInUpload } from './api'

export const LINKEDIN_API_CONNECTOR_ID = 'linkedin-api'

/** What LinkedIn's pages say a post made this way takes: 3000 characters; pictures or one video, never both. */
const MOST_CHARACTERS = 3_000
const MOST_PICTURES = 9
/** A video larger than this must be sent in parts, which this application does not do. */
const MOST_VIDEO_BYTES = 200 * 1024 * 1024
const PICTURES = new Set(['image/jpeg', 'image/png', 'image/gif'])
const VIDEOS = new Set(['video/mp4'])
/** A video is asked about every ten seconds for five minutes after its upload: LinkedIn says it may take a few minutes. */
const VIDEO_LOOKS = 30
const VIDEO_WAIT_MS = 10_000
/** A LinkedIn access token lasts 60 days, and an app with the self-serve products gets no way to renew one. */
const TOKEN_DAYS = 60

const HOST = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\//i

/** The personal profile an address names ("linkedin.com/in/name"), in lower case. Null for anything else: a company page, a post, a group. */
export function profileOf(input: string): string | null {
  const typed = input.trim()
  if (!HOST.test(typed)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'in') return null
  let name: string
  try {
    name = decodeURIComponent(parts[1] as string)
  } catch {
    return null
  }
  return /^[\p{L}\p{N}_-]{3,100}$/u.test(name) ? name.toLowerCase() : null
}

/** A post's id as the application stores it: LinkedIn's own URN of the post ("urn:li:share:1" or "urn:li:ugcPost:1") after "li:". */
export const postIdOf = (urn: string): string => `li:${urn}`

export function parseExternalId(id: string | null): string | null {
  const hit = /^li:(urn:li:(?:share|ugcPost):[A-Za-z0-9_-]+)$/.exec(id ?? '')
  return hit ? (hit[1] as string) : null
}

/** The address of a published post, as LinkedIn's pages give it. */
const addressOf = (urn: string): string => `https://www.linkedin.com/feed/update/${urn}/`

type Refusal = Extract<LinkedInAnswer<unknown>, { ok: false }>

const tokenRefused = (answer: Refusal): boolean => answer.status === 401

/** What LinkedIn refused, in words. */
function refusal(answer: Refusal): string {
  if (tokenRefused(answer)) return 'LinkedIn does not accept the access token: it ended or was withdrawn. Make a new one (the steps on the account\'s page) and save it there.'
  if (answer.status === 429) return `LinkedIn asks to wait before the next request (${answer.message}).`
  if (answer.status === 403) return `LinkedIn does not allow it (${answer.message}). The app needs the products “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect”, and the token the permissions openid, profile and w_member_social.`
  return `LinkedIn refused it: ${answer.message}`
}

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

const NOT_READ = 'LinkedIn gives an app of this kind no reading of a profile\'s posts, comments or numbers.'

const DEVELOPERS = 'https://www.linkedin.com/developers'

const API: ApiAccess = {
  accountKind: 'developer app',
  keyLabel: 'LinkedIn access token',
  keyName: 'LinkedIn access token',
  work: 'The app posts on the personal profile through this developer app, with no browser. LinkedIn lets such an app read no comments and no numbers: those you read and answer on LinkedIn.',
  keyDays: TOKEN_DAYS,
  steps: [
    {
      text: 'A LinkedIn app must belong to a LinkedIn Page, even when it posts on a personal profile. If you have no Page, create one: it is free.',
      url: 'https://www.linkedin.com/company/setup/new/',
      link: 'Open “Create a LinkedIn Page”'
    },
    {
      text: 'Create an app: “Create app”, an app name, the Page in the box “LinkedIn Page”, a privacy policy address, a logo, the checkbox with the terms, then “Create app”.',
      url: `${DEVELOPERS}/apps/new`,
      link: 'Open “Create app”'
    },
    {
      text: 'In the app open the tab “Products” and request two of them: “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect”. If LinkedIn asks to verify the app with its Page first, do that in the app’s “Settings” tab: an administrator of the Page approves it.',
      url: `${DEVELOPERS}/apps`,
      link: 'Open your apps'
    },
    {
      text: 'Open the token generator, choose the app, tick the permissions openid, profile and w_member_social, and allow the app on the profile that will post. Press “Copy token”.',
      url: `${DEVELOPERS}/tools/oauth/token-generator`,
      link: 'Open the token generator'
    },
    {
      text: `Paste the token below. It is kept in the vault of this Mac and is never shown again. It lasts ${TOKEN_DAYS} days and LinkedIn does not renew it for an app of this kind: a week before it ends the Inbox says so, and you make a new one the same way.`
    }
  ],
  keyLooksValid: looksLikeLinkedInToken
}

/**
 * A LinkedIn personal profile worked through LinkedIn's API with the member's own access token (DEC-084): posts of words, pictures or one
 * video, published by itself at their time. LinkedIn lets an app with the self-serve products read nothing of the profile, so the channel is
 * one the application does not read: no comments, no replies, no numbers; it is never watched in a browser, because such an account has none.
 */
export class LinkedInApiConnector implements Connector {
  readonly id = LINKEDIN_API_CONNECTOR_ID
  readonly platform = 'linkedin'
  readonly version = '1'
  readonly label = 'LinkedIn'
  readonly api = API

  /** The member each token belongs to, as LinkedIn named them at the last check. */
  private readonly members = new Map<string, LinkedInMember>()

  matches(input: string): boolean {
    return profileOf(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const name = profileOf(input)
    if (!name) throw new Error('Give the address of the personal profile, like https://www.linkedin.com/in/yourname/. A company page is worked in the account\'s browser, not through this app.')
    return { target: `linkedin.com/in/${name}`, url: `https://www.linkedin.com/in/${encodeURIComponent(name)}/` }
  }

  loginUrl(): string {
    return `${DEVELOPERS}/apps`
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://www.linkedin.com/in/', example: 'https://www.linkedin.com/in/yourname/', hint: 'The address of the personal profile whose access token this account holds.' }
  }

  readsChannel(_channel: Channel): boolean {
    return false
  }

  private async client(ctx: ConnectorContext): Promise<LinkedInApi | null> {
    const token = await ctx.apiKey()
    return token ? new LinkedInApi(ctx.http, token) : null
  }

  /** Whose token it is: asked from LinkedIn, and remembered until the next sign-in check. */
  private async member(ctx: ConnectorContext, api: LinkedInApi): Promise<LinkedInMember & { sub: string }> {
    let kept = this.members.get(ctx.account.id)
    if (!kept) {
      const me = await api.get<LinkedInMember>('v2/userinfo')
      if (!me.ok) throw Object.assign(new Error(refusal(me)), tokenRefused(me) ? { name: 'LoginRequiredError' } : {})
      kept = me.result
      this.members.set(ctx.account.id, kept)
    }
    if (!kept.sub) throw new Error('LinkedIn named no id for the member of this token. The token needs the permissions openid and profile.')
    return { ...kept, sub: kept.sub }
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    this.members.delete(ctx.account.id)
    const api = await this.client(ctx)
    if (!api) return { loggedIn: false, identity: null, captcha: false, signal: 'no LinkedIn access token is saved' }
    const me = await api.get<LinkedInMember>('v2/userinfo')
    if (!me.ok) return { loggedIn: false, identity: null, captcha: false, signal: tokenRefused(me) ? 'LinkedIn does not accept the token (it ended or was withdrawn)' : refusal(me) }
    this.members.set(ctx.account.id, me.result)
    return { loggedIn: true, identity: me.result.name ?? 'LinkedIn member', captcha: false }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const closed = (['read_posts', 'read_comments', 'detect_changes', 'publish_reply', 'verify_send', 'metrics', 'read_inbox'] as CapabilityKey[]).map((key) =>
      cap(key, 'unavailable', key === 'publish_reply' ? `${NOT_READ} Comments are answered on LinkedIn.` : key === 'verify_send' ? 'LinkedIn returns the id of the post it made; the application cannot read the post back.' : NOT_READ)
    )
    const rest = [...closed, cap('membership', 'unavailable', 'A profile is not joined: the token is its own.')]
    const api = await this.client(ctx)
    if (!api) return [cap('publish_post', 'needs_user', 'Save the LinkedIn access token on the account\'s page first.'), ...rest]
    this.members.delete(ctx.account.id)
    let member: LinkedInMember
    try {
      member = await this.member(ctx, api)
    } catch (error) {
      return [cap('publish_post', 'needs_user', error instanceof Error ? error.message : String(error)), ...rest]
    }
    return [
      cap(
        'publish_post',
        // Nothing can be tried without publishing, and LinkedIn does not say which profile address is the member's: the owner sees it on the first post.
        'needs_check',
        `Posts go out as ${member.name ?? 'the member of the token'}, for everybody to see: words up to ${MOST_CHARACTERS} characters with a link in them, 1-${MOST_PICTURES} pictures, or one MP4 video up to 200 MB. LinkedIn does not tell the application the address of the token's profile, so see on the first post that it is ${ctx.channel.url}.`
      ),
      ...rest
    ]
  }

  /** Nothing is read: LinkedIn closes it to such an app. The monitor finds no discussion and asks no more. */
  async fetchActivity(ctx: ConnectorContext, _options: { limit: number }): Promise<ActivityBatch> {
    return { discussions: [], fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(_ctx: ConnectorContext, _discussionExternalId: string): Promise<RemoteDiscussion | null> {
    return null
  }

  async fetchMetrics(_ctx: ConnectorContext): Promise<MetricReading[]> {
    return []
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    if (request.kind === 'reply') return failed(`${NOT_READ} A comment is written on LinkedIn itself. Nothing was sent.`)
    const api = await this.client(ctx)
    if (!api) return failed('No LinkedIn access token is saved for this account. Nothing was sent.')
    const words = request.text.trim()
    const files = request.attachments
    const videos = files.filter((file) => isVideoMime(file.mime))
    if (!words && files.length === 0) return failed('The post is empty. Nothing was sent.')
    if ([...words].length > MOST_CHARACTERS) return failed(`LinkedIn takes at most ${MOST_CHARACTERS} characters in a post; this one has ${[...words].length}. Nothing was sent.`)
    const unfit = files.find((file) => !PICTURES.has(file.mime) && !VIDEOS.has(file.mime))
    if (unfit) return failed(`LinkedIn takes a JPEG, PNG or GIF picture and an MP4 video through its API; “${unfit.name}” is neither. Nothing was sent.`)
    if (videos.length > 0 && files.length > 1) return failed('LinkedIn takes one video, or pictures, in a post: not both and not two videos. Nothing was sent.')
    if (files.length > MOST_PICTURES) return failed(`LinkedIn takes at most ${MOST_PICTURES} pictures in one post; this one has ${files.length}. Nothing was sent.`)
    const video = videos[0]
    if (video) {
      let bytes: number
      try {
        bytes = statSync(video.path).size
      } catch {
        return failed(`The video “${video.name}” could not be read from this Mac. Nothing was sent.`)
      }
      if (bytes > MOST_VIDEO_BYTES) return failed(`LinkedIn takes a video over 200 MB only in parts, which this application does not send; “${video.name}” is ${Math.round(bytes / (1024 * 1024))} MB. Publish it on LinkedIn yourself. Nothing was sent.`)
    }
    let author: string
    const assets: string[] = []
    try {
      author = `urn:li:person:${(await this.member(ctx, api)).sub}`
      for (const file of files) {
        const asset = await this.put(ctx, api, author, file)
        if ('error' in asset) return failed(`${asset.error} Nothing was published.`)
        assets.push(asset.urn)
      }
    } catch (error) {
      // Only the request that makes the post can leave a doubt: anything that fails here failed before it.
      if (error instanceof HttpNoAnswerError) return failed(`No answer came (${error.message}) before anything was published. Nothing was sent.`)
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    // Words that end with an address go as an article share, so LinkedIn shows the page's card as its own composer does.
    const address = files.length === 0 ? (/(?:^|\s)(https?:\/\/\S+)$/.exec(words)?.[1] ?? null) : null
    const category = video ? 'VIDEO' : files.length > 0 ? 'IMAGE' : address ? 'ARTICLE' : 'NONE'
    const media = address ? [{ status: 'READY', originalUrl: address }] : assets.map((urn) => ({ status: 'READY', media: urn }))
    const body = {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: words }, shareMediaCategory: category, ...(media.length > 0 ? { media } : {}) } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    }
    let answer: LinkedInAnswer<{ id?: string }>
    try {
      answer = await api.post<{ id?: string }>('v2/ugcPosts', body)
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `LinkedIn did not answer (${error.message}), so it is not known whether it was published. Look at the profile on LinkedIn and say here whether the post is there.` }
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    if (!answer.ok) {
      if (answer.status >= 500) return { status: 'unknown', error: `LinkedIn answered with an error of its own (${answer.message}), so it is not known whether it was published. Look at the profile on LinkedIn and say here whether the post is there.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    // The id of the new post comes in a header; the body repeats it.
    const urn = answer.header('x-restli-id') ?? answer.result.id ?? null
    if (!urn || !parseExternalId(postIdOf(urn))) return { status: 'unknown', error: 'LinkedIn accepted the post and returned no id for it. Look at the profile on LinkedIn and say here whether the post is there.' }
    return { status: 'confirmed', url: addressOf(urn), externalId: postIdOf(urn) }
  }

  /** Registers one file with LinkedIn, uploads it from this Mac, and for a video waits until LinkedIn has worked on it. Nothing is published by it. */
  private async put(ctx: ConnectorContext, api: LinkedInApi, owner: string, file: { path: string; name: string; mime: string }): Promise<{ urn: string } | { error: string }> {
    const video = isVideoMime(file.mime)
    const registered = await api.post<LinkedInUpload>('v2/assets?action=registerUpload', {
      registerUploadRequest: {
        recipes: [`urn:li:digitalmediaRecipe:feedshare-${video ? 'video' : 'image'}`],
        owner,
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        // A picture is taken in one answer, so the post is never made before LinkedIn has the picture (its own advice).
        ...(video ? {} : { supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'] })
      }
    })
    if (!registered.ok) return { error: refusal(registered) }
    const urn = registered.result.value?.asset
    const how = registered.result.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']
    if (!urn || !how?.uploadUrl) return { error: `LinkedIn gave no address to upload “${file.name}” to.` }
    // A picture's upload carries the token; a video's must not, and carries the headers LinkedIn named for it.
    const sent = await api.upload(how.uploadUrl, { path: file.path, name: file.name, mime: file.mime }, video ? { withToken: false, headers: how.headers ?? {} } : { withToken: true })
    if (!sent.ok) return { error: `LinkedIn did not take “${file.name}”: ${sent.message}.` }
    if (!video) return { urn }
    const id = urn.split(':').pop() as string
    for (let look = 0; look < VIDEO_LOOKS; look += 1) {
      const state = await api.get<LinkedInAsset>(`v2/assets/${encodeURIComponent(id)}`)
      if (!state.ok) return { error: `${refusal(state)} The video was uploaded, and LinkedIn would not say whether it is ready.` }
      const status = state.result.recipes?.[0]?.status
      if (status === 'AVAILABLE') return { urn }
      if (status !== 'PROCESSING' && status !== 'NEW' && status !== 'WAITING_UPLOAD') return { error: `LinkedIn could not prepare the video “${file.name}” (${String(status)}).` }
      await ctx.pause(VIDEO_WAIT_MS)
    }
    return { error: `LinkedIn was still preparing the video “${file.name}” after five minutes. Send the post again.` }
  }

  /** LinkedIn lets such an app read no post, so a post whose answer was lost cannot be looked for: the owner looks and says. */
  async findPublished(_ctx: ConnectorContext, _request: PublishRequest): Promise<PublishedRef | null> {
    throw new Error(`${NOT_READ} Look at the profile on LinkedIn and say here whether the post is there.`)
  }
}
