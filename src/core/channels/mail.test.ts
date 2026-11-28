// Mailboxes IMAP connectivity, header-only mail sync, unified Mail Inbox, verification code lookup,
// and secret-leakage invariants (REQ-013, DEC-100). Tested against an in-memory FakeMailClient.

import { describe, expect, it } from 'vitest'
import { extractVerification, guessImapPreset, isOutlookPersonal, OUTLOOK_OAUTH_NOTE, redactPreview, webmailLinkFor } from '../../shared/mail'
import type { ImapConfig, MailPort, RemoteMailBody, RemoteMailHeader } from '../ports'
import { makeTestCore } from '../testing/fakes'
import { FakeConnector } from '../testing/fake-connector'
import { mailboxPasswordKey } from '../vault'

interface FakeServerMessage {
  uid: number
  messageId: string | null
  from: string
  to: string[]
  subject: string
  body: string
  receivedAt: string
  seen: boolean
}

class FakeMailClient implements MailPort {
  failTest: string | null = null
  failFetch: string | null = null
  readonly messages: FakeServerMessage[] = []
  readonly calls: { op: string; config: ImapConfig; detail?: unknown }[] = []

  async testConnection(config: ImapConfig): Promise<void> {
    this.calls.push({ op: 'test', config })
    if (this.failTest) throw new Error(this.failTest)
  }

  async fetchHeaders(config: ImapConfig, options: { limit: number; sinceUid?: number }): Promise<RemoteMailHeader[]> {
    this.calls.push({ op: 'headers', config, detail: options })
    if (this.failFetch) throw new Error(this.failFetch)
    const filtered = this.messages.filter((m) => (options.sinceUid ? m.uid > options.sinceUid : true))
    return filtered.slice(-options.limit).map((m) => ({
      uid: m.uid,
      messageId: m.messageId,
      from: m.from,
      to: m.to,
      subject: m.subject,
      previewSource: m.body,
      receivedAt: m.receivedAt,
      seen: m.seen
    }))
  }

  async fetchBody(config: ImapConfig, uid: number): Promise<RemoteMailBody | null> {
    this.calls.push({ op: 'body', config, detail: uid })
    if (this.failFetch) throw new Error(this.failFetch)
    const found = this.messages.find((m) => m.uid === uid)
    if (!found) return null
    return { uid: found.uid, subject: found.subject, from: found.from, to: found.to, receivedAt: found.receivedAt, text: found.body }
  }
}

function makeMailWorld(mail = new FakeMailClient()) {
  const reddit = new FakeConnector({ id: 'reddit', platform: 'reddit' })
  const instagram = new FakeConnector({ id: 'instagram', platform: 'instagram' })
  const t = makeTestCore({ connectors: [reddit, instagram], mail })
  const call = t.core.router.call.bind(t.core.router) as typeof t.core.router.call
  return { ...t, mail, call }
}

describe('shared mail helpers (REQ-013, DEC-100)', () => {
  it('guesses common IMAP presets and flags personal Outlook/Hotmail accounts for OAuth2', () => {
    expect(guessImapPreset('owner@gmail.com')).toMatchObject({ label: 'Gmail', host: 'imap.gmail.com', port: 993, secure: true })
    expect(guessImapPreset('owner@icloud.com')).toMatchObject({ label: 'iCloud Mail', host: 'imap.mail.me.com' })
    expect(guessImapPreset('owner@fastmail.com')).toMatchObject({ label: 'Fastmail', host: 'imap.fastmail.com' })
    expect(guessImapPreset('owner@custom-domain.org')).toBeNull()
    expect(isOutlookPersonal('me@outlook.com')).toBe(true)
    expect(isOutlookPersonal('me@hotmail.com')).toBe(true)
    expect(isOutlookPersonal('me@gmail.com')).toBe(false)
    expect(OUTLOOK_OAUTH_NOTE).toMatch(/OAuth2/i)
  })

  it('redacts verification codes, magic links and long tokens from stored previews', () => {
    const raw = 'Your Reddit verification code is 482910 (or 123-456). Confirm here: https://www.reddit.com/verify?token=abc987654321XYZ98765 and token AbCdEf1234567890GhIj.'
    const safe = redactPreview(raw)
    expect(safe).not.toContain('482910')
    expect(safe).not.toContain('123-456')
    expect(safe).not.toContain('https://www.reddit.com/verify')
    expect(safe).not.toContain('AbCdEf1234567890GhIj')
    expect(safe).toContain('[code]')
    expect(safe).toContain('[link]')
  })

  it('extracts verification codes and confirmation links while ignoring years and unsubscribe links', () => {
    const body = [
      'Copyright 2026 Reddit Inc.',
      'Your verification code is 739204.',
      'Or confirm your account: https://www.reddit.com/verification/confirm?t=xyz123',
      'Unsubscribe: https://www.reddit.com/unsubscribe?id=1'
    ].join('\n')
    expect(extractVerification(body)).toEqual({
      codes: ['739204'],
      links: ['https://www.reddit.com/verification/confirm?t=xyz123']
    })
  })

  it('builds Gmail RFC822 message-id deep links and falls back to configured webmail URL', () => {
    expect(webmailLinkFor({ address: 'boris@gmail.com', webmailUrl: null }, '<abc-123@mail.reddit.com>')).toBe(
      'https://mail.google.com/mail/u/0/#search/rfc822msgid%3Aabc-123%40mail.reddit.com'
    )
    expect(webmailLinkFor({ address: 'boris@company.dev', webmailUrl: 'https://webmail.company.dev/' }, '<id@x>')).toBe('https://webmail.company.dev/')
  })
})

describe('Mailboxes IMAP and unified Mail Inbox (REQ-013, DEC-100)', () => {
  it('configures IMAP, keeps passwords exclusively in the vault, tests connection, and redacts leaked passwords in errors', async () => {
    const w = makeMailWorld()
    const SECRET = 'app-pass-super-secret-9988'
    const box = await w.call('mailboxes.add', { address: 'boris@gmail.com' })
    expect(box).toMatchObject({ imapHost: null, imapPort: 993, imapSecure: true, imapStatus: 'unconfigured', hasPassword: false })

    const configured = await w.call('mailboxes.configureImap', {
      id: box.id,
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      user: 'boris@gmail.com',
      webmailUrl: 'https://mail.google.com/'
    })
    expect(configured).toMatchObject({ imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, imapUser: 'boris@gmail.com', hasPassword: false })

    const withPass = await w.call('mailboxes.savePassword', { id: box.id, password: SECRET })
    expect(withPass.hasPassword).toBe(true)
    expect(w.secrets.values.get(mailboxPasswordKey(box.id))).toBe(SECRET)

    // Test connection failure that quotes the password must redact it everywhere (DB, API, logs).
    w.mail.failTest = `AUTHENTICATIONFAILED for password ${SECRET}`
    const failed = await w.call('mailboxes.testImap', { id: box.id })
    expect(failed.imapStatus).toBe('error')
    expect(failed.imapError).toContain('[redacted]')
    expect(failed.imapError).not.toContain(SECRET)

    // Successful connection test sets status to ready.
    w.mail.failTest = null
    const ready = await w.call('mailboxes.testImap', { id: box.id })
    expect(ready).toMatchObject({ imapStatus: 'ready', imapError: null })

    // Verify password NEVER appears anywhere in SQLite tables or logs.
    const dbDump = JSON.stringify({
      mailboxes: w.core.db.prepare('SELECT * FROM mailboxes').all(),
      messages: w.core.db.prepare('SELECT * FROM mail_messages').all(),
      logs: w.core.db.prepare('SELECT * FROM log_events').all()
    })
    expect(dbDump).not.toContain(SECRET)

    // Removing the password clears vault entry and resets status.
    const cleared = await w.call('mailboxes.removePassword', { id: box.id })
    expect(cleared).toMatchObject({ hasPassword: false, imapStatus: 'unconfigured' })
    expect(w.secrets.has(mailboxPasswordKey(box.id))).toBe(false)
  })

  it('syncs redacted headers incrementally, attributes messages to accounts, fetches bodies on demand, and looks up verification codes without storing secrets', async () => {
    const w = makeMailWorld()
    const SECRET = 'imap-vault-only-pass-7744'
    const CODE = '592841'
    const MAGIC_LINK = 'https://www.reddit.com/verification/confirm?secret=magicToken999999'

    const box = await w.call('mailboxes.add', { address: 'boris@gmail.com' })
    await w.call('mailboxes.configureImap', { id: box.id, host: 'imap.gmail.com', port: 993, secure: true })
    await w.call('mailboxes.savePassword', { id: box.id, password: SECRET })

    const redditAcc = await w.call('accounts.create', { platform: 'reddit', label: 'Natal Reddit', email: 'boris+reddit@gmail.com', mailboxId: box.id })
    const igAcc = await w.call('accounts.create', { platform: 'instagram', label: 'Natal Instagram', email: 'boris+instagram@gmail.com', mailboxId: box.id })

    w.mail.messages.push(
      {
        uid: 10,
        messageId: '<msg-10@reddit.com>',
        from: 'noreply@reddit.com',
        to: ['boris+reddit@gmail.com'],
        subject: 'Verify your Reddit account',
        body: `Hello! Your Reddit verification code is ${CODE}.\nConfirm here: ${MAGIC_LINK}`,
        receivedAt: '2026-11-08T11:55:00.000Z',
        seen: false
      },
      {
        uid: 11,
        messageId: '<msg-11@instagram.com>',
        from: 'security@mail.instagram.com',
        to: ['boris+instagram@gmail.com'],
        subject: 'New login alert',
        body: 'We noticed a new sign-in from macOS.',
        receivedAt: '2026-11-08T11:58:00.000Z',
        seen: true
      }
    )

    // Sync headers
    const sync1 = await w.call('mailboxes.sync', { id: box.id })
    expect(sync1).toEqual({ synced: 1, added: 2, errors: [] })

    // Verify NO code, magic link, or raw body is stored in SQLite mail_messages!
    const storedRows = JSON.stringify(w.core.db.prepare('SELECT * FROM mail_messages').all())
    expect(storedRows).not.toContain(CODE)
    expect(storedRows).not.toContain(MAGIC_LINK)
    expect(storedRows).not.toContain(SECRET)

    // Unified list attributes messages to accounts and supports filtering.
    const all = await w.call('mail.list', undefined)
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({ subject: 'New login alert', accountId: igAcc.id, platform: 'instagram', unread: false })
    expect(all[1]).toMatchObject({
      subject: 'Verify your Reddit account',
      accountId: redditAcc.id,
      platform: 'reddit',
      unread: true,
      webmailUrl: 'https://mail.google.com/mail/u/0/#search/rfc822msgid%3Amsg-10%40reddit.com'
    })
    expect(await w.call('mail.list', { accountId: redditAcc.id })).toHaveLength(1)
    expect(await w.call('mail.list', { platform: 'instagram' })).toHaveLength(1)
    expect(await w.call('mail.list', { unreadOnly: true })).toHaveLength(1)

    // Read body on demand: returns full plain text, extracted code & link, and marks read.
    const verifyMsg = all[1]!
    const body = await w.call('mail.readBody', { messageId: verifyMsg.id })
    expect(body.text).toContain(CODE)
    expect(body.codes).toEqual([CODE])
    expect(body.links).toEqual([MAGIC_LINK])
    expect(body.message.unread).toBe(false)

    // Mark unread again
    const unreadAgain = await w.call('mail.markRead', { messageId: verifyMsg.id, unread: true })
    expect(unreadAgain.unread).toBe(true)

    // Incremental sync fetches only UIDs > 11
    w.mail.messages.push({
      uid: 12,
      messageId: '<msg-12@reddit.com>',
      from: 'noreply@reddit.com',
      to: ['boris+reddit@gmail.com'],
      subject: 'Second security code',
      body: 'Your security code is 884422.',
      receivedAt: '2026-11-08T11:59:00.000Z',
      seen: false
    })
    const sync2 = await w.call('mailboxes.sync', undefined)
    expect(sync2).toEqual({ synced: 1, added: 1, errors: [] })
    expect(w.mail.calls.filter((c) => c.op === 'headers').at(-1)?.detail).toEqual({ limit: 50, sinceUid: 11 })

    // Verification code lookup filters by account email and time window.
    const lookup = await w.call('mail.codes', { accountId: redditAcc.id, sinceMinutes: 30 })
    expect(lookup.email).toBe('boris+reddit@gmail.com')
    expect(lookup.matches.map((m) => m.codes)).toEqual([['884422'], [CODE]])

    // Removing the mailbox deletes its vault password and synced message index.
    await w.call('mailboxes.remove', { id: box.id })
    expect(w.secrets.has(mailboxPasswordKey(box.id))).toBe(false)
    expect(await w.call('mail.list', undefined)).toEqual([])
  })
})
