// What Telegram delivered to a bot, kept in the application database (migration 210): a bot cannot read a chat's history, so this is the only
// record of the channel's posts and of the comments in its discussion group.
import type { Db } from '../../core/db/database'
import type { TgMessage, TgUpdate } from './api'

export interface StoredMessage {
  chatId: string
  messageId: number
  kind: 'post' | 'comment'
  rootChatId: string | null
  rootId: number | null
  parentId: number | null
  groupChatId: string | null
  groupMessageId: number | null
  author: string
  body: string
  postedAt: string | null
}

type Row = Record<string, unknown>

const map = (r: Row): StoredMessage => ({
  chatId: r.chat_id as string,
  messageId: r.message_id as number,
  kind: r.kind === 'comment' ? 'comment' : 'post',
  rootChatId: (r.root_chat_id as string | null) ?? null,
  rootId: (r.root_id as number | null) ?? null,
  parentId: (r.parent_id as number | null) ?? null,
  groupChatId: (r.group_chat_id as string | null) ?? null,
  groupMessageId: (r.group_message_id as number | null) ?? null,
  author: r.author as string,
  body: r.body as string,
  postedAt: (r.posted_at as string | null) ?? null
})

/** The words of a message; one that has none (a sticker, a picture alone) is named by what it is, so it is not mistaken for nothing. */
export function bodyOf(message: TgMessage): string {
  const words = (message.text ?? message.caption ?? '').trim()
  if (words) return words
  return message.photo ? '[picture]' : message.video ? '[video]' : '[a message without words]'
}

/** Who wrote a message, as Telegram shows it: @username, else the name, else the chat it was sent as (a channel, an anonymous administrator). */
export function authorOf(message: TgMessage): string {
  const from = message.from
  if (from?.username) return `@${from.username}`
  // Telegram's own service accounts stand in for "the channel" and "an anonymous administrator": the chat it was sent as is the author.
  if (message.sender_chat) return message.sender_chat.username ? `@${message.sender_chat.username}` : (message.sender_chat.title ?? 'channel')
  return [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'someone'
}

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString()

export class TelegramStore {
  constructor(private readonly db: Db) {}

  state(accountId: string, key: string): string | null {
    const row = this.db.prepare('SELECT value FROM telegram_state WHERE account_id = ? AND key = ?').get(accountId, key) as { value: string } | undefined
    return row?.value ?? null
  }

  setState(accountId: string, key: string, value: string): void {
    this.db.prepare('INSERT INTO telegram_state (account_id, key, value) VALUES (?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value').run(accountId, key, value)
  }

  get(accountId: string, chatId: string, messageId: number): StoredMessage | null {
    const row = this.db.prepare('SELECT * FROM telegram_messages WHERE account_id = ? AND chat_id = ? AND message_id = ?').get(accountId, chatId, messageId) as Row | undefined
    return row ? map(row) : null
  }

  /** The newest posts of a channel, newest first. */
  posts(accountId: string, chatId: string, limit: number): StoredMessage[] {
    return (this.db.prepare("SELECT * FROM telegram_messages WHERE account_id = ? AND chat_id = ? AND kind = 'post' ORDER BY message_id DESC LIMIT ?").all(accountId, chatId, limit) as Row[]).map(map)
  }

  /** The comments under a post, oldest first. */
  comments(accountId: string, rootChatId: string, rootId: number): StoredMessage[] {
    return (this.db.prepare("SELECT * FROM telegram_messages WHERE account_id = ? AND root_chat_id = ? AND root_id = ? AND kind = 'comment' ORDER BY message_id").all(accountId, rootChatId, rootId) as Row[]).map(map)
  }

  /** The post whose copy in the discussion group is this message. */
  postByGroupMessage(accountId: string, groupChatId: string, groupMessageId: number): StoredMessage | null {
    const row = this.db.prepare("SELECT * FROM telegram_messages WHERE account_id = ? AND kind = 'post' AND group_chat_id = ? AND group_message_id = ?").get(accountId, groupChatId, groupMessageId) as Row | undefined
    return row ? map(row) : null
  }

  put(accountId: string, m: StoredMessage): void {
    this.db
      .prepare(
        `INSERT INTO telegram_messages (account_id, chat_id, message_id, kind, root_chat_id, root_id, parent_id, group_chat_id, group_message_id, author, body, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, chat_id, message_id) DO UPDATE SET body = excluded.body, author = excluded.author,
           group_chat_id = COALESCE(excluded.group_chat_id, telegram_messages.group_chat_id), group_message_id = COALESCE(excluded.group_message_id, telegram_messages.group_message_id)`
      )
      .run(accountId, m.chatId, m.messageId, m.kind, m.rootChatId, m.rootId, m.parentId, m.groupChatId, m.groupMessageId, m.author, m.body, m.postedAt)
  }

  /**
   * Records one update. A channel post is a post. In a discussion group, the copy Telegram makes of a channel post ties the post to its thread;
   * every other message of a thread is a comment under that post. A message of a group that belongs to no known post is not kept.
   */
  apply(accountId: string, update: TgUpdate): void {
    const post = update.channel_post ?? update.edited_channel_post
    if (post) {
      this.put(accountId, { chatId: String(post.chat.id), messageId: post.message_id, kind: 'post', rootChatId: null, rootId: null, parentId: null, groupChatId: null, groupMessageId: null, author: authorOf(post), body: bodyOf(post), postedAt: iso(post.date) })
      return
    }
    const message = update.message ?? update.edited_message
    if (!message) return
    const groupId = String(message.chat.id)
    const origin = message.forward_origin
    if (message.is_automatic_forward && origin?.type === 'channel' && origin.chat && typeof origin.message_id === 'number') {
      // The bot does not receive the posts it sends itself, and may have missed one: the copy carries the post's words, so the post is known from it.
      this.put(accountId, { chatId: String(origin.chat.id), messageId: origin.message_id, kind: 'post', rootChatId: null, rootId: null, parentId: null, groupChatId: groupId, groupMessageId: message.message_id, author: authorOf(message), body: bodyOf(message), postedAt: iso(message.date) })
      return
    }
    const parentId = message.reply_to_message?.message_id ?? null
    const threadId = message.message_thread_id ?? parentId
    if (threadId === null) return
    let root = this.postByGroupMessage(accountId, groupId, threadId)
    // A reply to a comment in a group without thread ids: the comment it answers knows its post.
    if (!root && parentId !== null) {
      const parent = this.get(accountId, groupId, parentId)
      root = parent?.kind === 'comment' && parent.rootChatId && parent.rootId !== null ? this.get(accountId, parent.rootChatId, parent.rootId) : null
    }
    if (!root) return
    this.put(accountId, {
      chatId: groupId,
      messageId: message.message_id,
      kind: 'comment',
      rootChatId: root.chatId,
      rootId: root.messageId,
      // A comment written straight under the post answers the post, not another comment.
      parentId: parentId !== null && parentId !== root.groupMessageId ? parentId : null,
      groupChatId: null,
      groupMessageId: null,
      author: authorOf(message),
      body: bodyOf(message),
      postedAt: iso(message.date)
    })
  }
}
