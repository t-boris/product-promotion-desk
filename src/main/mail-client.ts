// Real read-only IMAP mail client (REQ-013, DEC-100) backed by imapflow + mailparser.
// Lives in src/main so src/core stays pure and testable without network sockets.
// Security: logger is disabled so credentials and message content are NEVER written to stdout/stderr,
// mailbox locks are opened read-only so nothing in the owner's mailbox is ever deleted or altered,
// and only plain-text content is returned (never raw HTML rendered into the app).

import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject } from 'mailparser'
import type { ImapConfig, MailPort, RemoteMailBody, RemoteMailHeader } from '../core/ports'

const CONNECT_TIMEOUT_MS = 15_000
const SOCKET_TIMEOUT_MS = 20_000

function addressList(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return []
  const objects = Array.isArray(field) ? field : [field]
  const out: string[] = []
  for (const obj of objects) {
    for (const entry of obj.value ?? []) {
      const addr = entry.address?.trim().toLowerCase()
      if (addr) out.push(addr)
    }
  }
  return out
}

function envelopeAddresses(entries: { address?: string }[] | undefined): string[] {
  if (!entries) return []
  return entries.map((e) => e.address?.trim().toLowerCase() ?? '').filter((a) => a !== '')
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return text && text !== href ? `${text} (${href})` : href
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function makeClient(config: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS
  })
}

async function withClient<T>(config: ImapConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = makeClient(config)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => {
      try {
        client.close()
      } catch {
        // already closed
      }
    })
  }
}

export class ImapMailClient implements MailPort {
  async testConnection(config: ImapConfig): Promise<void> {
    await withClient(config, async (client) => {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      lock.release()
    })
  }

  async fetchHeaders(config: ImapConfig, options: { limit: number; sinceUid?: number }): Promise<RemoteMailHeader[]> {
    const limit = Math.max(1, Math.min(options.limit, 100))
    return withClient(config, async (client) => {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        const mailbox = client.mailbox
        const total = mailbox && typeof mailbox !== 'boolean' ? mailbox.exists : 0
        if (total === 0) return []

        const sinceUid = typeof options.sinceUid === 'number' && options.sinceUid > 0 ? options.sinceUid : null
        const useUid = sinceUid !== null
        const range = sinceUid !== null ? `${sinceUid + 1}:*` : `${Math.max(1, total - limit + 1)}:*`
        const headers: RemoteMailHeader[] = []

        for await (const msg of client.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true, source: { start: 0, maxLength: 8192 } }, { uid: useUid })) {
          if (sinceUid !== null && msg.uid <= sinceUid) continue
          let previewSource = ''
          let to = envelopeAddresses(msg.envelope?.to)
          let from = envelopeAddresses(msg.envelope?.from)[0] ?? ''
          let subject = msg.envelope?.subject ?? ''
          let messageId = msg.envelope?.messageId ?? null
          if (msg.source) {
            try {
              const parsed = await simpleParser(msg.source)
              previewSource = parsed.text?.trim() || (typeof parsed.html === 'string' ? htmlToPlain(parsed.html) : '')
              if (to.length === 0) to = addressList(parsed.to)
              if (!from) from = addressList(parsed.from)[0] ?? ''
              if (!subject && parsed.subject) subject = parsed.subject
              if (!messageId && parsed.messageId) messageId = parsed.messageId
            } catch {
              // Envelope metadata is still valid if snippet parsing fails on a truncated 8 KB slice.
            }
          }
          const received = msg.internalDate instanceof Date ? msg.internalDate : msg.envelope?.date instanceof Date ? msg.envelope.date : new Date()
          headers.push({
            uid: msg.uid,
            messageId: messageId ? messageId.trim() : null,
            from,
            to,
            subject: subject.trim() || '(no subject)',
            previewSource,
            receivedAt: received.toISOString(),
            seen: msg.flags?.has('\\Seen') === true
          })
          if (headers.length >= limit) break
        }
        return headers
      } finally {
        lock.release()
      }
    })
  }

  async fetchBody(config: ImapConfig, uid: number): Promise<RemoteMailBody | null> {
    return withClient(config, async (client) => {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })
        if (!msg || !msg.source) return null
        const parsed = await simpleParser(msg.source)
        const text = parsed.text?.trim() || (typeof parsed.html === 'string' ? htmlToPlain(parsed.html) : '')
        const received = msg.internalDate instanceof Date ? msg.internalDate : parsed.date instanceof Date ? parsed.date : new Date()
        return {
          uid: msg.uid,
          subject: parsed.subject?.trim() || msg.envelope?.subject?.trim() || '(no subject)',
          from: addressList(parsed.from)[0] ?? envelopeAddresses(msg.envelope?.from)[0] ?? '',
          to: addressList(parsed.to).length > 0 ? addressList(parsed.to) : envelopeAddresses(msg.envelope?.to),
          receivedAt: received.toISOString(),
          text
        }
      } finally {
        lock.release()
      }
    })
  }
}
