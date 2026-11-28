// A LinkedIn that lives in a test: one member behind the self-serve products "Share on LinkedIn" and "Sign In with LinkedIn using OpenID
// Connect", in the shapes LinkedIn's pages show. One fake answers for both hosts: api.linkedin.com and the host of a video's upload.
import { HttpNoAnswerError } from '../../core/net/http'
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'

export const FAKE_LI_TOKEN = `AQV${'fakeLinkedInAccessTokenOfTheTokenGenerator0123456789_-'.repeat(4)}`
export const LI_MEMBER_ID = '782bbtaQ'

interface FakeAsset {
  urn: string
  id: string
  kind: 'image' | 'video'
  /** The name of the file that was uploaded for it; null until it is. */
  file: string | null
  /** What the asset says of itself the next times it is asked, then AVAILABLE. */
  states: string[]
}

interface FakePost {
  urn: string
  text: string
  category: string
  /** The uploaded files' names in their order, or the address of an article share. */
  media: string[]
  visibility: string
}

export class FakeLinkedIn implements HttpPort {
  member = { sub: LI_MEMBER_ID, name: 'Ann Lee', given_name: 'Ann', family_name: 'Lee', locale: 'en-US' }
  readonly tokens = new Set<string>([FAKE_LI_TOKEN])
  /** The next request that makes or registers something fails this way, once: an error answer, or no answer at all after LinkedIn acted. */
  failNext: { status: number; message: string; on?: 'register' | 'upload' | 'post' } | 'lost' | null = null
  /** What a new video says of itself the first times it is asked. */
  videoStates: string[] = []
  /** False makes LinkedIn answer a new post with no id. */
  namesPosts = true
  readonly calls: { method: string; host: string; path: string; body: unknown; auth: boolean; headers: Record<string, string> }[] = []
  readonly assets: FakeAsset[] = []
  readonly posts: FakePost[] = []
  private next = 7000

  private json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
    return { status, headers, text: body === null ? '' : JSON.stringify(body) }
  }

  private error(status: number, message: string): HttpResponse {
    return this.json(status, { message, serviceErrorCode: status === 401 ? 65600 : 100, status })
  }

  private fails(on: 'register' | 'upload' | 'post'): HttpResponse | null {
    const fail = this.failNext
    if (!fail || fail === 'lost' || (fail.on ?? 'post') !== on) return null
    this.failNext = null
    return this.error(fail.status, fail.message)
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    const path = `${url.pathname.replace(/^\//, '')}${url.search}`
    const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null
    this.calls.push({ method: req.method, host: url.host, path, body: req.json ?? (req.file ? { file: req.file.name } : null), auth: bearer !== null, headers })

    // The upload of a file to the address LinkedIn named for it.
    const upload = /^(?:mediaUpload|dms-uploads)\/([^/]+)\//.exec(url.pathname.replace(/^\//, ''))
    if (upload && req.method === 'PUT') {
      const asset = this.assets.find((a) => a.id === upload[1])
      if (!asset || !req.file) return this.error(404, 'No such upload')
      const refused = this.fails('upload')
      if (refused) return refused
      if (asset.kind === 'image' && (bearer === null || !this.tokens.has(bearer))) return this.error(401, 'Empty oauth2_access_token')
      // A video's upload must carry no token, and carries the header LinkedIn named.
      if (asset.kind === 'video' && (bearer !== null || headers['media-type-family'] !== 'VIDEO')) return this.error(400, 'Bad upload request')
      asset.file = req.file.name
      return this.json(asset.kind === 'image' ? 201 : 200, null)
    }

    if (url.host !== 'api.linkedin.com') return this.error(404, 'Not found')
    if (bearer === null) return this.error(401, 'Empty oauth2_access_token')
    if (!this.tokens.has(bearer)) return this.error(401, 'The token used in the request has expired')
    if (headers['x-restli-protocol-version'] !== '2.0.0') return this.error(400, 'The protocol version header is missing')

    if (req.method === 'GET' && path === 'v2/userinfo') return this.json(200, this.member)

    if (req.method === 'POST' && path === 'v2/assets?action=registerUpload') {
      const refused = this.fails('register')
      if (refused) return refused
      const ask = (req.json as { registerUploadRequest?: { recipes?: string[]; owner?: string; serviceRelationships?: { relationshipType?: string; identifier?: string }[] } }).registerUploadRequest
      const recipe = ask?.recipes?.[0] ?? ''
      const kind = recipe === 'urn:li:digitalmediaRecipe:feedshare-video' ? 'video' : recipe === 'urn:li:digitalmediaRecipe:feedshare-image' ? 'image' : null
      if (!kind || ask?.owner !== `urn:li:person:${this.member.sub}` || ask.serviceRelationships?.[0]?.identifier !== 'urn:li:userGeneratedContent') return this.error(400, 'Invalid registerUploadRequest')
      const id = `C55${this.next++}`
      const asset: FakeAsset = { urn: `urn:li:digitalmediaAsset:${id}`, id, kind, file: null, states: kind === 'video' ? [...this.videoStates] : [] }
      this.assets.push(asset)
      const uploadUrl = kind === 'image' ? `https://api.linkedin.com/mediaUpload/${id}/feedshare-uploadedImage/0?ca=vector_feedshare&cn=uploads&sync=1` : `https://www.linkedin.com/dms-uploads/${id}/uploadedVideo/0?ca=vector_feedshare&cn=uploads_secure`
      return this.json(200, {
        value: {
          uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { headers: kind === 'video' ? { 'media-type-family': 'VIDEO' } : {}, uploadUrl } },
          mediaArtifact: `urn:li:digitalmediaMediaArtifact:(${asset.urn},urn:li:digitalmediaMediaArtifactClass:uploaded)`,
          asset: asset.urn
        }
      })
    }

    const asked = /^v2\/assets\/([^/?]+)$/.exec(path)
    if (req.method === 'GET' && asked) {
      const asset = this.assets.find((a) => a.id === asked[1])
      if (!asset) return this.error(404, 'No such asset')
      const status = asset.file === null ? 'WAITING_UPLOAD' : (asset.states.shift() ?? 'AVAILABLE')
      return this.json(200, { id: asset.id, recipes: [{ recipe: `urn:li:digitalmediaRecipe:feedshare-${asset.kind}`, status }] })
    }

    if (req.method === 'POST' && path === 'v2/ugcPosts') {
      const refused = this.fails('post')
      if (refused) return refused
      const body = req.json as {
        author?: string
        lifecycleState?: string
        specificContent?: { 'com.linkedin.ugc.ShareContent'?: { shareCommentary?: { text?: string }; shareMediaCategory?: string; media?: { status?: string; media?: string; originalUrl?: string }[] } }
        visibility?: { 'com.linkedin.ugc.MemberNetworkVisibility'?: string }
      }
      const content = body.specificContent?.['com.linkedin.ugc.ShareContent']
      const category = content?.shareMediaCategory ?? ''
      if (body.author !== `urn:li:person:${this.member.sub}` || body.lifecycleState !== 'PUBLISHED' || !content || typeof content.shareCommentary?.text !== 'string') return this.error(400, 'Invalid ugcPost')
      if ([...content.shareCommentary.text].length > 3000) return this.error(422, 'The text of the post is too long')
      const media: string[] = []
      for (const item of content.media ?? []) {
        if (item.status !== 'READY') return this.error(400, 'Media must be READY')
        if (category === 'ARTICLE') {
          if (!item.originalUrl) return this.error(400, 'An article needs originalUrl')
          media.push(item.originalUrl)
          continue
        }
        const asset = this.assets.find((a) => a.urn === item.media)
        if (!asset || asset.file === null || (category === 'IMAGE') !== (asset.kind === 'image')) return this.error(400, 'The media of the post does not match its category')
        media.push(asset.file)
      }
      if ((category === 'NONE') !== (media.length === 0)) return this.error(400, 'The media of the post does not match its category')
      const urn = `urn:li:share:${this.next++}`
      this.posts.unshift({ urn, text: content.shareCommentary.text, category, media, visibility: body.visibility?.['com.linkedin.ugc.MemberNetworkVisibility'] ?? '' })
      if (this.failNext === 'lost') {
        this.failNext = null
        throw new HttpNoAnswerError('the connection failed')
      }
      return this.namesPosts ? this.json(201, { id: urn }, { 'x-restli-id': urn }) : this.json(201, {})
    }
    return this.error(404, 'Not found')
  }
}
