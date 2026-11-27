// The Telegram Bot API as this application uses it: one call, one answer in Telegram's own shape. The token is part of the address and is
// never put into an error, a log line or a result.
import type { HttpFile, HttpPort } from '../../core/ports'

export type TelegramAnswer<T> = { ok: true; result: T } | { ok: false; code: number; description: string; retryAfterSeconds: number | null }

export interface TgChat {
  id: number
  type: string
  title?: string
  username?: string
  linked_chat_id?: number
}

export interface TgUser {
  id: number
  is_bot?: boolean
  username?: string
  first_name?: string
  last_name?: string
}

export interface TgMessage {
  message_id: number
  date: number
  chat: TgChat
  from?: TgUser
  sender_chat?: TgChat
  text?: string
  caption?: string
  is_automatic_forward?: boolean
  forward_origin?: { type: string; chat?: TgChat; message_id?: number }
  message_thread_id?: number
  reply_to_message?: TgMessage
  photo?: unknown
  video?: unknown
}

export interface TgUpdate {
  update_id: number
  channel_post?: TgMessage
  edited_channel_post?: TgMessage
  message?: TgMessage
  edited_message?: TgMessage
}

export interface TgChatMember {
  status: string
  can_post_messages?: boolean
}

const BASE = 'https://api.telegram.org'

export class TelegramApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  /** A call with plain values. It throws only when Telegram gave no answer (`HttpNoAnswerError`). */
  call<T>(method: string, params: Record<string, unknown> = {}): Promise<TelegramAnswer<T>> {
    return this.send<T>(method, { json: params })
  }

  /** A call that uploads files: every value is a word or a file read from its path. */
  upload<T>(method: string, form: Record<string, string | HttpFile>): Promise<TelegramAnswer<T>> {
    return this.send<T>(method, { form })
  }

  private async send<T>(method: string, body: { json?: unknown; form?: Record<string, string | HttpFile> }): Promise<TelegramAnswer<T>> {
    const response = await this.http.request({ method: 'POST', url: `${BASE}/bot${this.token}/${method}`, ...body })
    let parsed: unknown
    try {
      parsed = JSON.parse(response.text)
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object' && (parsed as { ok?: unknown }).ok === true) return { ok: true, result: (parsed as { result: T }).result }
    const failure = (parsed ?? {}) as { error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } }
    const retry = failure.parameters?.retry_after
    return {
      ok: false,
      code: typeof failure.error_code === 'number' ? failure.error_code : response.status,
      description: typeof failure.description === 'string' ? failure.description.replaceAll(this.token, '[token]') : `HTTP ${response.status}`,
      retryAfterSeconds: typeof retry === 'number' ? retry : null
    }
  }
}

/** A bot token as BotFather gives it: the bot's number, a colon, and a long secret. */
export const looksLikeBotToken = (key: string): boolean => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(key)
