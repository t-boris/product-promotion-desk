import type { Capability, CapabilityKey, CapabilityStatus, Channel, MetricReading } from '../../shared/types'
import { isVideoMime } from '../../shared/types'
import type { Db } from '../../core/db/database'
import { HttpNoAnswerError } from '../../core/net/http'
import type {
  ActivityBatch,
  ApiAccess,
  ChannelGuide,
  Clock,
  Connector,
  ConnectorContext,
  HttpFile,
  LoginState,
  NormalizedTarget,
  PublishedRef,
  PublishOutcome,
  PublishRequest,
  RemoteComment,
  RemoteDiscussion,
  SendTicket
} from '../../core/ports'
import { wordsWithLink as wordsOf } from '../text'
import { TelegramApi, looksLikeBotToken, type TelegramAnswer, type TgChat, type TgChatMember, type TgMessage, type TgUpdate, type TgUser } from './api'
import { TelegramStore, bodyOf, type StoredMessage } from './store'

export const TELEGRAM_BOT_CONNECTOR_ID = 'telegram-bot'

const TEXT_LIMIT = 4_096
const CAPTION_LIMIT = 1_024
const ALBUM_LIMIT = 10
/** Telegram hands a bot at most this many updates per call. */
const UPDATES_PER_CALL = 100
/** A stop for the loop that collects updates: more than this in one reading is left for the next one. */
const MAX_UPDATE_CALLS = 20
/** The clocks of this Mac and of Telegram may differ by a little. */
const CLOCK_SKEW_MS = 2 * 60_000

const ADDRESS = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{3,31})\/?$/i
const HANDLE = /^@([A-Za-z][A-Za-z0-9_]{3,31})$/

/** The public name of a channel from what was typed: "@name" or "https://t.me/name". Null for anything else (an invite link, a private channel). */
export function channelName(input: string): string | null {
  const typed = input.trim()
  return (HANDLE.exec(typed) ?? ADDRESS.exec(typed))?.[1] ?? null
}

/** A message's id as the application stores it: the chat and the message, which together are unique for a bot. */
export const externalIdOf = (chatId: string, messageId: number): string => `tg:${chatId}:${messageId}`

export function parseExternalId(id: string | null): { chatId: string; messageId: number } | null {
  const hit = /^tg:(-?\d+):(\d+)$/.exec(id ?? '')
  return hit ? { chatId: hit[1] as string, messageId: Number(hit[2]) } : null
}

const sameWords = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/** What Telegram refused, in words; a "wait" answer says how long. */
function refusal(answer: { code: number; description: string; retryAfterSeconds: number | null }): string {
  if (answer.code === 429) return `Telegram asks to wait${answer.retryAfterSeconds ? ` ${answer.retryAfterSeconds} seconds` : ''} before the next message. Nothing was sent.`
  return `Telegram refused it: ${answer.description}`
}

interface ChatInfo {
  id: string
  linkedId: string | null
}

const API: ApiAccess = {
  accountKind: 'bot',
  keyLabel: 'Bot token',
  steps: [
    {
      text: 'Open @BotFather and sign in to Telegram there (in the Telegram app on your phone: Settings, Devices, Link Desktop Device, then scan the code). If the chat does not open by itself, search for @BotFather, the one with the check mark.',
      url: 'https://web.telegram.org/k/#@BotFather',
      link: 'Open BotFather'
    },
    { text: 'Send /newbot and follow it: it gives the bot a name and shows the bot token.' },
    { text: 'Add the bot to your channel as an administrator with the right to post messages (open the channel, press its name, Administrators, Add Administrator).' },
    {
      text: 'To read and answer comments: the channel needs a discussion group (channel settings, Discussion), the bot must be added to that group, and in @BotFather its group privacy must be turned off (/setprivacy, Disable) so it receives the comments.'
    },
    { text: 'Paste the bot token below. It is kept in the vault of this Mac and is never shown again. A new bot needs these steps again: each bot is an account of its own.' }
  ],
  keyLooksValid: looksLikeBotToken
}

/**
 * A Telegram channel worked through a bot (DEC-055): posts with words, pictures, an album or a video; comments read from the channel's
 * discussion group as Telegram delivers them; replies inside a post's thread. A bot sees only what arrives while it is connected: nothing
 * older, and nothing that waited uncollected for more than 24 hours. Views of a post are not given to a bot.
 */
export class TelegramBotConnector implements Connector {
  readonly id = TELEGRAM_BOT_CONNECTOR_ID
  readonly platform = 'telegram'
  readonly version = '1'
  readonly label = 'Telegram'
  readonly api = API

  private storage: { store: TelegramStore; clock: Clock } | null = null
  /** One reading of a bot's updates at a time: two would hand the same updates to both. */
  private readonly reading = new Map<string, Promise<void>>()

  bindStorage(storage: { db: Db; clock: Clock }): void {
    this.storage = { store: new TelegramStore(storage.db), clock: storage.clock }
  }

  private get store(): TelegramStore {
    if (!this.storage) throw new Error('The Telegram connector has no storage yet.')
    return this.storage.store
  }

  matches(input: string): boolean {
    return channelName(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const name = channelName(input)
    if (!name) throw new Error('Give the public address of the channel: @name or https://t.me/name. A channel without a public name cannot be connected through a bot.')
    return { target: `@${name}`, url: `https://t.me/${name}` }
  }

  loginUrl(): string {
    return 'https://t.me/BotFather'
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://t.me/', example: '@yourchannel', hint: 'The public name of a channel the bot administers: @name or https://t.me/name.' }
  }

  readsChannel(_channel: Channel): boolean {
    return true
  }

  private async client(ctx: ConnectorContext): Promise<TelegramApi | null> {
    const token = await ctx.apiKey()
    return token ? new TelegramApi(ctx.http, token) : null
  }

  private async requireClient(ctx: ConnectorContext): Promise<TelegramApi> {
    const api = await this.client(ctx)
    // The name makes the monitor read it as a sign-in problem of the account, which it is.
    if (!api) throw Object.assign(new Error('No bot token is saved for this account. Save it on the account\'s page.'), { name: 'LoginRequiredError' })
    return api
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    const api = await this.client(ctx)
    if (!api) return { loggedIn: false, identity: null, captcha: false, signal: 'no bot token is saved' }
    const me = await api.call<TgUser>('getMe')
    if (!me.ok) return { loggedIn: false, identity: null, captcha: false, signal: me.code === 401 ? 'Telegram does not accept the bot token (it may have been revoked in @BotFather)' : refusal(me) }
    return { loggedIn: true, identity: me.result.username ? `@${me.result.username}` : String(me.result.id), captcha: false }
  }

  /** The channel's numeric id and its discussion group, asked from Telegram and remembered. */
  private async chat(ctx: ConnectorContext, api: TelegramApi, refresh = false): Promise<ChatInfo> {
    const key = `chat:${ctx.channel.target.toLowerCase()}`
    const kept = refresh ? null : this.store.state(ctx.account.id, key)
    if (kept) return JSON.parse(kept) as ChatInfo
    const chat = await api.call<TgChat>('getChat', { chat_id: ctx.channel.target })
    if (!chat.ok) throw new Error(`The bot does not see ${ctx.channel.target}: ${chat.description}. Add the bot to the channel as an administrator.`)
    const info: ChatInfo = { id: String(chat.result.id), linkedId: chat.result.linked_chat_id !== undefined ? String(chat.result.linked_chat_id) : null }
    this.store.setState(ctx.account.id, key, JSON.stringify(info))
    return info
  }

  /** Collects what Telegram holds for the bot and records it. One reading per bot at a time. */
  private sync(ctx: ConnectorContext, api: TelegramApi): Promise<void> {
    const accountId = ctx.account.id
    const running = this.reading.get(accountId)
    if (running) return running
    const work = (async () => {
      for (let call = 0; call < MAX_UPDATE_CALLS; call++) {
        const offset = Number(this.store.state(accountId, 'offset') ?? '0')
        const updates = await api.call<TgUpdate[]>('getUpdates', { offset, limit: UPDATES_PER_CALL, timeout: 0, allowed_updates: ['channel_post', 'edited_channel_post', 'message', 'edited_message'] })
        if (!updates.ok) {
          if (updates.code === 409) throw new Error('Telegram delivers this bot\'s messages somewhere else (a webhook is set, or another program reads them). Only one reader can receive them.')
          if (updates.code === 401) throw Object.assign(new Error('Telegram does not accept the bot token.'), { name: 'LoginRequiredError' })
          throw new Error(refusal(updates))
        }
        for (const update of updates.result) this.store.apply(accountId, update)
        const last = updates.result.at(-1)
        if (last) this.store.setState(accountId, 'offset', String(last.update_id + 1))
        if (updates.result.length < UPDATES_PER_CALL) break
      }
    })().finally(() => this.reading.delete(accountId))
    this.reading.set(accountId, work)
    return work
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const all = (status: CapabilityStatus, detail: string): Capability[] =>
      (['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics'] as CapabilityKey[]).map((key) => cap(key, status, detail)).concat(notOffered(cap))
    const api = await this.client(ctx)
    if (!api) return all('needs_user', 'Save the bot token on the account\'s page first.')
    const me = await api.call<TgUser>('getMe')
    if (!me.ok) return all('needs_user', me.code === 401 ? 'Telegram does not accept the bot token. Save a new one on the account\'s page.' : refusal(me))
    let chat: ChatInfo
    try {
      chat = await this.chat(ctx, api, true)
    } catch (error) {
      return all('needs_user', error instanceof Error ? error.message : String(error))
    }
    const member = await api.call<TgChatMember>('getChatMember', { chat_id: chat.id, user_id: me.result.id })
    const posts = member.ok && (member.result.status === 'creator' || (member.result.status === 'administrator' && member.result.can_post_messages === true))
    const inGroup = chat.linkedId ? await api.call<TgChatMember>('getChatMember', { chat_id: chat.linkedId, user_id: me.result.id }) : null
    const talks = inGroup?.ok === true && !['left', 'kicked'].includes(inGroup.result.status)
    const noTalk = !chat.linkedId
      ? 'The channel has no discussion group, so its posts have no comments to read. Add one in the channel\'s settings (Discussion) and add the bot to it.'
      : 'The bot is not in the channel\'s discussion group. Add it there, and turn its group privacy off in @BotFather (/setprivacy, Disable).'
    return [
      cap('read_posts', 'verified', 'Posts made from now on are read as Telegram delivers them to the bot. Older posts are not available to a bot.'),
      cap('read_comments', talks ? 'verified' : 'needs_user', talks ? 'Comments are read from the discussion group as they arrive. What waits uncollected for more than 24 hours is lost: keep the app running.' : noTalk),
      cap('detect_changes', 'verified', 'New posts and comments arrive by themselves.'),
      cap('publish_post', posts ? 'verified' : 'needs_user', posts ? 'The bot is an administrator and may post.' : 'Make the bot an administrator of the channel with the right to post messages.'),
      cap('publish_reply', talks ? 'verified' : 'needs_user', talks ? 'The bot answers inside the post\'s thread in the discussion group.' : noTalk),
      cap('verify_send', 'verified', 'Telegram returns the message it made.'),
      cap('metrics', 'verified', 'The number of subscribers. Views of a post are not given to a bot.'),
      ...notOffered(cap)
    ]
  }

  private discussion(ctx: ConnectorContext, post: StoredMessage): RemoteDiscussion {
    const name = ctx.channel.target.replace(/^@/, '')
    const postId = externalIdOf(post.chatId, post.messageId)
    const comments: RemoteComment[] = this.store.comments(ctx.account.id, post.chatId, post.messageId).map((c) => ({
      externalId: externalIdOf(c.chatId, c.messageId),
      parentExternalId: c.parentId !== null ? externalIdOf(c.chatId, c.parentId) : postId,
      author: c.author,
      body: c.body,
      url: `https://t.me/${name}/${post.messageId}?comment=${c.messageId}`,
      postedAt: c.postedAt
    }))
    const firstLine = post.body.split('\n')[0] ?? ''
    return {
      externalId: postId,
      url: `https://t.me/${name}/${post.messageId}`,
      title: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine,
      // Every post of the channel is the channel's own, whoever of its administrators wrote it: none is somebody to answer.
      author: ctx.account.identity ?? post.author,
      body: post.body,
      postedAt: post.postedAt,
      comments
    }
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const api = await this.requireClient(ctx)
    const chat = await this.chat(ctx, api)
    await this.sync(ctx, api)
    return { discussions: this.store.posts(ctx.account.id, chat.id, options.limit).map((post) => this.discussion(ctx, post)), fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const api = await this.requireClient(ctx)
    const ref = parseExternalId(discussionExternalId)
    if (!ref) return null
    await this.sync(ctx, api)
    const post = this.store.get(ctx.account.id, ref.chatId, ref.messageId)
    return post?.kind === 'post' ? this.discussion(ctx, post) : null
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const api = await this.requireClient(ctx)
    const count = await api.call<number>('getChatMemberCount', { chat_id: ctx.channel.target })
    return [{ key: 'subscribers', label: 'Subscribers', value: count.ok ? count.result : null, available: count.ok }]
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    const api = await this.client(ctx)
    if (!api) return { status: 'failed', error: 'No bot token is saved for this account. Nothing was sent.' }
    const words = wordsOf(request)
    try {
      return request.kind === 'reply' ? await this.reply(ctx, api, request, words) : await this.post(ctx, api, request, words)
    } catch (error) {
      // No answer at all: Telegram may or may not have made the message.
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `Telegram did not answer (${error.message}), so it is not known whether it was published.` }
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async post(ctx: ConnectorContext, api: TelegramApi, request: PublishRequest, words: string): Promise<PublishOutcome> {
    const files = request.attachments
    const chatId = ctx.channel.target
    if (files.length === 0 && !words) return { status: 'failed', error: 'The post is empty. Nothing was sent.' }
    if (files.length === 0 && [...words].length > TEXT_LIMIT) return { status: 'failed', error: `Telegram takes at most ${TEXT_LIMIT} characters in a message. Nothing was sent.` }
    if (files.length > 0 && [...words].length > CAPTION_LIMIT) return { status: 'failed', error: `Telegram takes at most ${CAPTION_LIMIT} characters with a picture or a video. Nothing was sent.` }
    if (files.length > ALBUM_LIMIT) return { status: 'failed', error: `Telegram takes at most ${ALBUM_LIMIT} pictures or videos in one post. Nothing was sent.` }

    let answer: TelegramAnswer<TgMessage | TgMessage[]>
    if (files.length === 0) {
      answer = await api.call<TgMessage>('sendMessage', { chat_id: chatId, text: words })
    } else if (files.length === 1) {
      const file = files[0]!
      const video = isVideoMime(file.mime)
      const part: HttpFile = { path: file.path, name: file.name, mime: file.mime }
      answer = await api.upload<TgMessage>(video ? 'sendVideo' : 'sendPhoto', { chat_id: chatId, ...(words ? { caption: words } : {}), [video ? 'video' : 'photo']: part })
    } else {
      const form: Record<string, string | HttpFile> = { chat_id: chatId }
      const media = files.map((file, index) => {
        form[`file${index}`] = { path: file.path, name: file.name, mime: file.mime }
        return { type: isVideoMime(file.mime) ? 'video' : 'photo', media: `attach://file${index}`, ...(index === 0 && words ? { caption: words } : {}) }
      })
      form.media = JSON.stringify(media)
      answer = await api.upload<TgMessage[]>('sendMediaGroup', form)
    }
    if (!answer.ok) return answer.code >= 500 ? { status: 'unknown', error: `Telegram answered with an error of its own (${answer.description}), so it is not known whether it was published.` } : { status: 'failed', error: refusal(answer) }
    const made = Array.isArray(answer.result) ? answer.result[0] : answer.result
    if (!made) return { status: 'unknown', error: 'Telegram accepted the post and returned no message, so it is not known whether it was published.' }
    // The bot is not sent its own posts: this is the only record of the one it just made.
    this.store.put(ctx.account.id, { chatId: String(made.chat.id), messageId: made.message_id, kind: 'post', rootChatId: null, rootId: null, parentId: null, groupChatId: null, groupMessageId: null, author: ctx.account.identity ?? '', body: words || bodyOf(made), postedAt: new Date(made.date * 1000).toISOString() })
    return { status: 'confirmed', url: `https://t.me/${chatId.replace(/^@/, '')}/${made.message_id}`, externalId: externalIdOf(String(made.chat.id), made.message_id) }
  }

  private async reply(ctx: ConnectorContext, api: TelegramApi, request: PublishRequest, words: string): Promise<PublishOutcome> {
    if (request.attachments.length > 0) return { status: 'failed', error: 'A reply through the bot carries words only. Take the picture off, or answer in Telegram yourself. Nothing was sent.' }
    if (!words) return { status: 'failed', error: 'The reply is empty. Nothing was sent.' }
    if ([...words].length > TEXT_LIMIT) return { status: 'failed', error: `Telegram takes at most ${TEXT_LIMIT} characters in a message. Nothing was sent.` }
    const ref = parseExternalId(request.parentExternalId)
    const parent = ref ? this.store.get(ctx.account.id, ref.chatId, ref.messageId) : null
    if (!parent) return { status: 'failed', error: 'The message this reply answers is not among those Telegram delivered to the bot. Nothing was sent.' }
    // A comment is answered where it stands; a post is answered under its copy in the discussion group.
    const target = parent.kind === 'comment' ? { chatId: parent.chatId, messageId: parent.messageId } : parent.groupChatId && parent.groupMessageId !== null ? { chatId: parent.groupChatId, messageId: parent.groupMessageId } : null
    if (!target) return { status: 'failed', error: 'This post has no thread in a discussion group that the bot is in, so there is nowhere to answer. Nothing was sent.' }
    const answer = await api.call<TgMessage>('sendMessage', { chat_id: target.chatId, text: words, reply_parameters: { message_id: target.messageId } })
    if (!answer.ok) return answer.code >= 500 ? { status: 'unknown', error: `Telegram answered with an error of its own (${answer.description}), so it is not known whether it was published.` } : { status: 'failed', error: refusal(answer) }
    const root = parent.kind === 'comment' ? { chatId: parent.rootChatId as string, messageId: parent.rootId as number } : { chatId: parent.chatId, messageId: parent.messageId }
    this.store.put(ctx.account.id, { chatId: target.chatId, messageId: answer.result.message_id, kind: 'comment', rootChatId: root.chatId, rootId: root.messageId, parentId: parent.kind === 'comment' ? parent.messageId : null, groupChatId: null, groupMessageId: null, author: ctx.account.identity ?? '', body: words, postedAt: new Date(answer.result.date * 1000).toISOString() })
    return { status: 'confirmed', url: `https://t.me/${ctx.channel.target.replace(/^@/, '')}/${root.messageId}?comment=${answer.result.message_id}`, externalId: externalIdOf(target.chatId, answer.result.message_id) }
  }

  /**
   * Looks for a send whose answer was lost. Found among what is recorded: that is it. A post of a channel with a discussion group arrives as its
   * copy there, so not finding it means it was not made. Anything else a bot cannot look for (it reads no history), and saying "not there"
   * would be a guess: it throws, and the item waits for the owner's look.
   */
  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    const api = await this.requireClient(ctx)
    const chat = await this.chat(ctx, api)
    await this.sync(ctx, api)
    const floor = (request.attemptedAt ? Date.parse(request.attemptedAt) : 0) - CLOCK_SKEW_MS
    const fresh = (m: StoredMessage): boolean => m.postedAt !== null && Date.parse(m.postedAt) >= floor && sameWords(m.body, wordsOf(request))
    const name = ctx.channel.target.replace(/^@/, '')
    if (request.kind === 'post') {
      const hit = this.store.posts(ctx.account.id, chat.id, 50).filter(fresh).at(-1)
      if (hit) return { url: `https://t.me/${name}/${hit.messageId}`, externalId: externalIdOf(hit.chatId, hit.messageId) }
      if (chat.linkedId) return null
    }
    throw new Error('A bot cannot look through a chat for a message it did not get an answer about. Look at the channel and say whether it is there.')
  }
}

/** What a bot has no way to do: said, not left out, so the channel's card shows it. */
function notOffered(cap: (key: CapabilityKey, status: CapabilityStatus, detail: string) => Capability): Capability[] {
  return [cap('membership', 'unavailable', 'A bot is added to a channel by its owner.'), cap('read_inbox', 'unavailable', 'Comments arrive as comments of the channel\'s posts.')]
}
