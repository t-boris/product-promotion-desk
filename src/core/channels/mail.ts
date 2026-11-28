// IMAP mailbox configuration, header-only syncing, unified Mail Inbox, and verification code lookup (REQ-013, DEC-100).
//
// Security invariants:
// - Mailbox app passwords live ONLY in the encrypted SecretStore under `mailbox:<id>`, never in SQLite, logs, API outputs, or AI prompts.
// - `mail_messages` stores ONLY headers and redacted previews (`redactPreview`): NO bodies, NO verification codes, NO magic links on disk.
// - Full plain-text bodies and verification codes are fetched on demand over IMAP in memory for the owner only, and never passed to AI.

import { ApiError } from '../../shared/api'
import { extractVerification, redactPreview, sanitizeMailError, webmailLinkFor } from '../../shared/mail'
import type { Account, Id, MailBodyView, MailMessage, MailSyncResult, Mailbox, VerificationLookup } from '../../shared/types'
import { vaultUnavailableText } from '../../shared/vault-message'
import type { Core } from '../core'
import { SecretOpenError, type ImapConfig, type MailPort } from '../ports'
import { mailboxPasswordKey } from '../vault'
import { requireText } from './errors'
import type { MailboxService } from './mailboxes'
import type { ChannelsStore, StoredMailRow } from './store'

const MAX_HOST = 253
const MAX_USER = 254
const MAX_PASSWORD = 256
const MAX_URL = 500
const SYNC_LIMIT = 50
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 300
const DEFAULT_CODE_MINUTES = 30
const MAX_CODE_MESSAGES = 5

const HOST_PATTERN = /^[a-z0-9.-]+$/i

function cleanHost(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'string') throw new ApiError('invalid_input', 'The IMAP host must be a server name.')
  const trimmed = input.trim().toLowerCase()
  if (trimmed === '') return null
  if (trimmed.length > MAX_HOST || !HOST_PATTERN.test(trimmed) || !trimmed.includes('.')) {
    if (trimmed !== 'localhost') throw new ApiError('invalid_input', 'The IMAP host must be a valid hostname (for example, imap.gmail.com).')
  }
  return trimmed
}

function cleanPort(input: unknown, fallback = 993): number {
  if (input === undefined || input === null) return fallback
  const n = Number(input)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ApiError('invalid_input', 'The IMAP port must be a whole number between 1 and 65535.')
  return n
}

function cleanWebmailUrl(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'string') throw new ApiError('invalid_input', 'The webmail address must be an http(s) URL.')
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (trimmed.length > MAX_URL || !/^https?:\/\//i.test(trimmed)) throw new ApiError('invalid_input', 'The webmail address must start with http:// or https://.')
  try {
    const parsed = new URL(trimmed)
    if (parsed.username || parsed.password) throw new ApiError('invalid_input', 'The webmail address must not contain credentials.')
    return parsed.toString()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('invalid_input', 'The webmail address is not a valid URL.')
  }
}

export class MailService {
  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore,
    private readonly mailboxes: MailboxService
  ) {}

  private requireMailPort(): MailPort {
    if (!this.core.mail) throw new ApiError('unavailable', 'IMAP mail reading is not available in this environment.')
    return this.core.mail
  }

  private async requireVaultAvailable(): Promise<void> {
    if (await this.core.secrets.available()) return
    this.core.events.changed('accounts')
    throw new ApiError('vault_unavailable', vaultUnavailableText(this.core.secrets.blocked() ?? 'no_keychain'))
  }

  private async mailboxPassword(mailbox: Mailbox): Promise<string | null> {
    try {
      return await this.core.secrets.get(mailboxPasswordKey(mailbox.id))
    } catch (error) {
      if (!(error instanceof SecretOpenError)) throw error
      this.core.events.changed('accounts')
      const why = error.blocked ? vaultUnavailableText(error.blocked) : `The saved IMAP password of ${mailbox.address} cannot be opened with this keychain. Save it again.`
      throw new ApiError('vault_unavailable', why)
    }
  }

  private async imapConfigOf(mailbox: Mailbox): Promise<ImapConfig> {
    if (!mailbox.imapHost) throw new ApiError('invalid_state', `IMAP host is not configured for ${mailbox.address}.`)
    const password = await this.mailboxPassword(mailbox)
    if (!password) throw new ApiError('invalid_state', `No IMAP app password is saved for ${mailbox.address}. Save one in Settings first.`)
    return {
      host: mailbox.imapHost,
      port: mailbox.imapPort,
      secure: mailbox.imapSecure,
      user: mailbox.imapUser || mailbox.address,
      password
    }
  }

  configureImap(args: { id: Id; host: string | null; port?: number; secure?: boolean; user?: string | null; webmailUrl?: string | null }): Mailbox {
    const mailbox = this.mailboxes.mailbox(args.id)
    const host = cleanHost(args.host)
    const port = cleanPort(args.port, mailbox.imapPort)
    const secure = args.secure === undefined ? mailbox.imapSecure : Boolean(args.secure)
    const rawUser = args.user === undefined ? mailbox.imapUser : args.user === null ? null : String(args.user).trim() || null
    if (rawUser && rawUser.length > MAX_USER) throw new ApiError('invalid_input', `The IMAP username is too long (limit ${MAX_USER} characters).`)
    const webmailUrl = args.webmailUrl === undefined ? mailbox.webmailUrl : cleanWebmailUrl(args.webmailUrl)
    const nextStatus = host ? (mailbox.imapStatus === 'ready' && host === mailbox.imapHost && port === mailbox.imapPort && secure === mailbox.imapSecure && rawUser === mailbox.imapUser ? 'ready' : 'unconfigured') : 'unconfigured'
    this.store.updateMailboxImap(mailbox.id, { host, port, secure, user: rawUser, webmailUrl, status: nextStatus, error: null })
    this.core.log.info('accounts', host ? `IMAP settings updated for ${mailbox.address} (${host}:${port}).` : `IMAP settings cleared for ${mailbox.address}.`)
    this.core.events.changed('accounts')
    return this.mailboxes.mailbox(mailbox.id)
  }

  async savePassword(args: { id: Id; password: string }): Promise<Mailbox> {
    const mailbox = this.mailboxes.mailbox(args.id)
    const password = typeof args.password === 'string' ? args.password : ''
    if (password === '') throw new ApiError('invalid_input', 'The IMAP app password is required.')
    if (password.length > MAX_PASSWORD) throw new ApiError('invalid_input', `The IMAP password is too long (limit ${MAX_PASSWORD} characters).`)
    if ([...password].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
      throw new ApiError('invalid_input', 'The IMAP password contains a control character or line break. Check what was pasted.')
    }
    await this.requireVaultAvailable()
    try {
      await this.core.secrets.set(mailboxPasswordKey(mailbox.id), password)
    } catch {
      throw new ApiError('vault_failed', 'The IMAP password could not be saved to the vault.')
    }
    this.core.log.info('accounts', `An IMAP password was saved for ${mailbox.address}.`)
    this.core.events.changed('accounts')
    return this.mailboxes.mailbox(mailbox.id)
  }

  removePassword(id: Id): Mailbox {
    const mailbox = this.mailboxes.mailbox(id)
    this.core.secrets.delete(mailboxPasswordKey(mailbox.id))
    this.store.setMailboxImapStatus(mailbox.id, 'unconfigured', null)
    this.core.log.info('accounts', `The IMAP password for ${mailbox.address} was removed.`)
    this.core.events.changed('accounts')
    return this.mailboxes.mailbox(mailbox.id)
  }

  async testImap(id: Id): Promise<Mailbox> {
    const mail = this.requireMailPort()
    const mailbox = this.mailboxes.mailbox(id)
    const config = await this.imapConfigOf(mailbox)
    try {
      await mail.testConnection(config)
      this.store.setMailboxImapStatus(mailbox.id, 'ready', null)
      this.core.log.info('accounts', `IMAP connection succeeded for ${mailbox.address} (${config.host}:${config.port}).`)
    } catch (error) {
      const safe = sanitizeMailError(error instanceof Error ? error.message : String(error), config.password)
      this.store.setMailboxImapStatus(mailbox.id, 'error', safe)
      this.core.log.warn('accounts', `IMAP connection failed for ${mailbox.address}: ${safe}`)
    }
    this.core.events.changed('accounts')
    return this.mailboxes.mailbox(mailbox.id)
  }

  async sync(id?: Id): Promise<MailSyncResult> {
    const mail = this.requireMailPort()
    const targets = id ? [this.mailboxes.mailbox(id)] : this.mailboxes.list().filter((m) => m.imapHost !== null && m.hasPassword)
    let synced = 0
    let added = 0
    const errors: { mailboxId: Id; error: string }[] = []

    for (const mailbox of targets) {
      let secret: string | null = null
      try {
        const config = await this.imapConfigOf(mailbox)
        secret = config.password
        const sinceUid = this.store.latestMailboxUid(mailbox.id)
        const headers = await mail.fetchHeaders(config, { limit: SYNC_LIMIT, ...(sinceUid !== null ? { sinceUid } : {}) })
        const now = this.core.clock.now().toISOString()
        for (const h of headers) {
          const toAddress = h.to.join(', ').toLowerCase() || mailbox.address
          const preview = redactPreview(h.previewSource)
          const inserted = this.store.upsertMailMessage({
            mailboxId: mailbox.id,
            uid: h.uid,
            messageId: h.messageId,
            fromAddress: h.from.toLowerCase(),
            toAddress,
            subject: h.subject,
            preview,
            receivedAt: h.receivedAt,
            unread: !h.seen,
            fetchedAt: now
          })
          if (inserted) added += 1
        }
        this.store.setMailboxImapStatus(mailbox.id, 'ready', null, now)
        synced += 1
      } catch (error) {
        const safe = sanitizeMailError(error instanceof Error ? error.message : String(error), secret)
        this.store.setMailboxImapStatus(mailbox.id, 'error', safe)
        errors.push({ mailboxId: mailbox.id, error: safe })
        this.core.log.warn('accounts', `Mail sync failed for ${mailbox.address}: ${safe}`)
      }
    }

    if (targets.length > 0) this.core.events.changed('accounts')
    return { synced, added, errors }
  }

  /** Attributes a message to the account whose e-mail matches one of its `toAddress` recipients (or mailbox owner when unmatched). */
  private matchAccount(toAddress: string, accounts: readonly Account[]): Account | null {
    const recipients = toAddress
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    for (const recipient of recipients) {
      const exact = accounts.find((a) => a.email?.toLowerCase() === recipient)
      if (exact) return exact
    }
    return null
  }

  private hydrate(row: StoredMailRow, mailboxes: Map<Id, Mailbox>, accounts: readonly Account[]): MailMessage {
    const mailbox = mailboxes.get(row.mailboxId)
    const account = this.matchAccount(row.toAddress, accounts)
    return {
      id: row.id,
      mailboxId: row.mailboxId,
      mailboxAddress: mailbox?.address ?? '',
      uid: row.uid,
      messageId: row.messageId,
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      subject: row.subject,
      preview: row.preview,
      receivedAt: row.receivedAt,
      unread: row.unread,
      accountId: account?.id ?? null,
      accountLabel: account?.label ?? null,
      platform: account?.platform ?? null,
      webmailUrl: mailbox ? webmailLinkFor(mailbox, row.messageId) : null
    }
  }

  list(filter: { mailboxId?: Id; accountId?: Id; platform?: string; unreadOnly?: boolean; limit?: number } = {}): MailMessage[] {
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, typeof filter.limit === 'number' && Number.isFinite(filter.limit) ? Math.floor(filter.limit) : DEFAULT_LIST_LIMIT))
    const accounts = this.core.repos.listAccounts()
    const mailboxes = new Map(this.mailboxes.list().map((m) => [m.id, m]))
    const rows = this.store.listMailMessages({ mailboxId: filter.mailboxId, unreadOnly: filter.unreadOnly === true, limit: MAX_LIST_LIMIT })
    let messages = rows.map((row) => this.hydrate(row, mailboxes, accounts))
    if (filter.accountId) messages = messages.filter((m) => m.accountId === filter.accountId)
    if (filter.platform) messages = messages.filter((m) => m.platform === filter.platform)
    return messages.slice(0, limit)
  }

  markRead(args: { messageId: Id; unread: boolean }): MailMessage {
    const id = requireText(args.messageId, 'The message')
    const updated = this.store.setMailUnread(id, Boolean(args.unread))
    if (!updated) throw new ApiError('not_found', 'The mail message was not found.')
    this.core.events.changed('accounts')
    const mailboxes = new Map(this.mailboxes.list().map((m) => [m.id, m]))
    return this.hydrate(updated, mailboxes, this.core.repos.listAccounts())
  }

  async readBody(messageId: Id): Promise<MailBodyView> {
    const mail = this.requireMailPort()
    const id = requireText(messageId, 'The message')
    const row = this.store.getMailMessage(id)
    if (!row) throw new ApiError('not_found', 'The mail message was not found.')
    const mailbox = this.mailboxes.mailbox(row.mailboxId)
    const config = await this.imapConfigOf(mailbox)
    let bodyText: string
    try {
      const body = await mail.fetchBody(config, row.uid)
      if (!body) throw new ApiError('not_found', 'The message is no longer present on the mail server.')
      bodyText = body.text
    } catch (error) {
      if (error instanceof ApiError) throw error
      const safe = sanitizeMailError(error instanceof Error ? error.message : String(error), config.password)
      throw new ApiError('unavailable', `Could not fetch the message body: ${safe}`)
    }
    const updated = this.store.setMailUnread(row.id, false) ?? row
    this.core.events.changed('accounts')
    const mailboxes = new Map(this.mailboxes.list().map((m) => [m.id, m]))
    const message = this.hydrate(updated, mailboxes, this.core.repos.listAccounts())
    const { codes, links } = extractVerification(bodyText)
    return { message, text: bodyText, codes, links }
  }

  /**
   * Checks recent mail addressed to an account's e-mail for verification codes and confirmation links (REQ-013, DEC-100).
   * Fetches message bodies on demand over IMAP and extracts codes/links in memory only — never stored on disk and never passed to AI.
   */
  async lookupCodes(args: { accountId: Id; sinceMinutes?: number }): Promise<VerificationLookup> {
    const mail = this.requireMailPort()
    const accountId = requireText(args.accountId, 'The account')
    const account = this.core.repos.account(accountId)
    if (!account.email) throw new ApiError('invalid_state', `${account.label} has no e-mail address set.`)
    const email = account.email.toLowerCase()
    const sinceMin = Math.max(1, Math.min(24 * 60, typeof args.sinceMinutes === 'number' && Number.isFinite(args.sinceMinutes) ? args.sinceMinutes : DEFAULT_CODE_MINUTES))
    const cutoffMs = this.core.clock.now().getTime() - sinceMin * 60_000

    // Sync the linked mailbox (or any configured mailbox matching the domain) first so newly arrived codes are found.
    const mailboxes = this.mailboxes.list()
    const linked = account.mailboxId ? mailboxes.find((m) => m.id === account.mailboxId) : undefined
    const targetMailboxes = linked && linked.imapHost && linked.hasPassword ? [linked] : mailboxes.filter((m) => m.imapHost && m.hasPassword)
    if (targetMailboxes.length === 0) {
      throw new ApiError('invalid_state', 'No mailbox has IMAP configured and a password saved. Set up IMAP under Settings → Base mailbox first.')
    }
    for (const m of targetMailboxes) await this.sync(m.id)

    const recent = this.list({ accountId: account.id, limit: 20 }).filter((msg) => Date.parse(msg.receivedAt) >= cutoffMs).slice(0, MAX_CODE_MESSAGES)
    const matches: VerificationLookup['matches'] = []
    for (const msg of recent) {
      const mailbox = mailboxes.find((m) => m.id === msg.mailboxId)
      if (!mailbox || !mailbox.imapHost || !mailbox.hasPassword) continue
      const config = await this.imapConfigOf(mailbox)
      const body = await mail.fetchBody(config, msg.uid).catch(() => null)
      if (!body) continue
      const { codes, links } = extractVerification(`${body.subject}\n${body.text}`)
      if (codes.length > 0 || links.length > 0) {
        matches.push({
          messageId: msg.id,
          subject: msg.subject,
          fromAddress: msg.fromAddress,
          receivedAt: msg.receivedAt,
          codes,
          links
        })
      }
    }
    return { accountId: account.id, email, checkedAt: this.core.clock.now().toISOString(), matches }
  }
}
