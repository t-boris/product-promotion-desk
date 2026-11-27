// A Telegram Bot API that lives in a test: one channel with a discussion group, a bot, and the updates Telegram would deliver.
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'
import { HttpNoAnswerError } from '../../core/net/http'
import type { TgMessage, TgUpdate } from './api'

export const FAKE_TOKEN = '123456789:AAHfakeTokenForTests_abcdefghijklmnopqrstu'
export const CHANNEL_ID = -1001000000001
export const GROUP_ID = -1001000000002
const BOT_ID = 123456789

export class FakeTelegram implements HttpPort {
  token = FAKE_TOKEN
  channelName = 'natalmystic'
  /** Whether the channel has a discussion group, and whether the bot is in it. */
  linked = true
  botInGroup = true
  botMayPost = true
  /** The next send fails this way, once: an error answer, or no answer at all after Telegram acted. */
  failNext: { code: number; description: string } | 'lost' | null = null
  readonly calls: { method: string; params: Record<string, unknown>; files: string[] }[] = []
  readonly updates: TgUpdate[] = []
  private nextMessage = 10
  private nextUpdate = 500
  nowSeconds = Math.floor(Date.parse('2026-12-01T10:00:00.000Z') / 1000)

  private message(chatId: number, extra: Partial<TgMessage>): TgMessage {
    return { message_id: this.nextMessage++, date: this.nowSeconds, chat: { id: chatId, type: chatId === CHANNEL_ID ? 'channel' : 'supergroup' }, ...extra }
  }

  private push(update: Omit<TgUpdate, 'update_id'>): void {
    this.updates.push({ update_id: this.nextUpdate++, ...update })
  }

  /** A post appears in the channel; Telegram copies it into the discussion group, and the bot is told of the copy (never of its own post). */
  private channelPost(text: string, byBot: boolean): TgMessage {
    const post = this.message(CHANNEL_ID, { text, sender_chat: { id: CHANNEL_ID, type: 'channel', title: 'Natal Mystic', username: this.channelName } })
    if (!byBot) this.push({ channel_post: post })
    if (this.linked && this.botInGroup) {
      this.push({ message: this.message(GROUP_ID, { text, is_automatic_forward: true, forward_origin: { type: 'channel', chat: { id: CHANNEL_ID, type: 'channel' }, message_id: post.message_id }, from: { id: 777000, first_name: 'Telegram' }, sender_chat: { id: CHANNEL_ID, type: 'channel', title: 'Natal Mystic', username: this.channelName } }) })
    }
    return post
  }

  /** The owner writes a post by hand in Telegram. */
  ownerPosts(text: string): TgMessage {
    return this.channelPost(text, false)
  }

  /** Somebody comments under a post (given by its id in the channel), or answers another comment (its id in the group). */
  comment(postId: number, text: string, from: { username?: string; first_name?: string }, replyTo?: number): TgMessage {
    const copy = this.updates.map((u) => u.message).find((m) => m?.is_automatic_forward && m.forward_origin?.message_id === postId)
    if (!copy) throw new Error('The post has no copy in the discussion group.')
    const message = this.message(GROUP_ID, { text, from: { id: 42, ...from }, message_thread_id: copy.message_id, reply_to_message: { message_id: replyTo ?? copy.message_id, date: this.nowSeconds, chat: { id: GROUP_ID, type: 'supergroup' } } })
    this.push({ message })
    return message
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const hit = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(req.url)
    if (!hit) throw new Error(`Not a Telegram address: ${req.url.replace(this.token, '[token]')}`)
    const method = hit[2] as string
    const params: Record<string, unknown> = {}
    const files: string[] = []
    if (req.json) Object.assign(params, req.json)
    for (const [name, value] of Object.entries(req.form ?? {})) {
      if (typeof value === 'string') params[name] = value
      else files.push(`${name}:${value.name}`)
    }
    this.calls.push({ method, params, files })
    const ok = (result: unknown): HttpResponse => ({ status: 200, headers: {}, text: JSON.stringify({ ok: true, result }) })
    const no = (code: number, description: string): HttpResponse => ({ status: code, headers: {}, text: JSON.stringify({ ok: false, error_code: code, description }) })
    if (hit[1] !== this.token) return no(401, 'Unauthorized')
    const sending = method.startsWith('send')
    if (sending && this.failNext && this.failNext !== 'lost') {
      const failure = this.failNext
      this.failNext = null
      return no(failure.code, failure.description)
    }
    const lose = sending && this.failNext === 'lost'
    if (lose) this.failNext = null
    const answer = this.answer(method, params, ok, no)
    if (lose) throw new HttpNoAnswerError('no answer within 30 seconds')
    return answer
  }

  private answer(method: string, params: Record<string, unknown>, ok: (r: unknown) => HttpResponse, no: (c: number, d: string) => HttpResponse): HttpResponse {
    const isChannel = (id: unknown): boolean => id === `@${this.channelName}` || id === CHANNEL_ID || id === String(CHANNEL_ID)
    switch (method) {
      case 'getMe':
        return ok({ id: BOT_ID, is_bot: true, username: 'natal_mystic_bot', first_name: 'Natal Mystic' })
      case 'getChat':
        return isChannel(params.chat_id) ? ok({ id: CHANNEL_ID, type: 'channel', title: 'Natal Mystic', username: this.channelName, ...(this.linked ? { linked_chat_id: GROUP_ID } : {}) }) : no(400, 'Bad Request: chat not found')
      case 'getChatMember':
        if (isChannel(params.chat_id)) return ok({ status: 'administrator', can_post_messages: this.botMayPost })
        return ok({ status: this.botInGroup ? 'member' : 'left' })
      case 'getChatMemberCount':
        return ok(1234)
      case 'getUpdates': {
        const offset = Number(params.offset ?? 0)
        return ok(this.updates.filter((u) => u.update_id >= offset).slice(0, Number(params.limit ?? 100)))
      }
      case 'sendMessage': {
        if (isChannel(params.chat_id)) return ok(this.channelPost(String(params.text), true))
        return ok(this.message(GROUP_ID, { text: String(params.text), from: { id: BOT_ID, is_bot: true, username: 'natal_mystic_bot' } }))
      }
      case 'sendPhoto':
      case 'sendVideo':
        return ok(this.channelPost(String(params.caption ?? ''), true))
      case 'sendMediaGroup': {
        const media = JSON.parse(String(params.media)) as { caption?: string }[]
        return ok(media.map((item, index) => (index === 0 ? this.channelPost(item.caption ?? '', true) : this.message(CHANNEL_ID, {}))))
      }
      default:
        return no(404, `Not Found: method ${method}`)
    }
  }
}
