import { useState, type FormEvent } from 'react'
import { guessImapPreset, isOutlookPersonal, OUTLOOK_OAUTH_NOTE } from '../../../../shared/mail'
import type { Mailbox } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ConfirmAction, ErrorNote, Field, Hint, formatTime, type Tone } from '../../ui'

const IMAP_STATUS_LABEL: Record<Mailbox['imapStatus'], string> = {
  unconfigured: 'Not configured',
  ready: 'Connected',
  error: 'Error'
}

const IMAP_STATUS_TONE: Record<Mailbox['imapStatus'], Tone> = {
  unconfigured: 'neutral',
  ready: 'good',
  error: 'bad'
}

function MailboxImapRow({ mailbox }: { mailbox: Mailbox }) {
  const preset = guessImapPreset(mailbox.address)
  const outlook = isOutlookPersonal(mailbox.address)
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState(mailbox.imapHost ?? preset?.host ?? '')
  const [port, setPort] = useState(String(mailbox.imapPort ?? preset?.port ?? 993))
  const [secure, setSecure] = useState(mailbox.imapSecure ?? preset?.secure ?? true)
  const [user, setUser] = useState(mailbox.imapUser ?? mailbox.address)
  const [webmailUrl, setWebmailUrl] = useState(mailbox.webmailUrl ?? preset?.webmailUrl ?? '')
  const [password, setPassword] = useState('')
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const [remove, removing] = useAction(() => call('mailboxes.remove', { id: mailbox.id }))
  const [saveImap, savingImap] = useAction(async () => {
    await call('mailboxes.configureImap', {
      id: mailbox.id,
      host: host.trim() || null,
      port: Number(port) || 993,
      secure,
      user: user.trim() || null,
      webmailUrl: webmailUrl.trim() || null
    })
    if (password !== '') {
      await call('mailboxes.savePassword', { id: mailbox.id, password })
      setPassword('')
    }
    setSyncNote('IMAP settings saved.')
  })
  const [removePass, removingPass] = useAction(async () => {
    await call('mailboxes.removePassword', { id: mailbox.id })
    setSyncNote('App password removed from vault.')
  })
  const [testImap, testing] = useAction(async () => {
    const updated = await call('mailboxes.testImap', { id: mailbox.id })
    setSyncNote(updated.imapStatus === 'ready' ? 'IMAP connection succeeded.' : null)
  })
  const [syncNow, syncing] = useAction(async () => {
    const res = await call('mailboxes.sync', { id: mailbox.id })
    if (res.errors.length > 0) setSyncNote(null)
    else setSyncNote(`Synced: ${res.added} new message${res.added === 1 ? '' : 's'}.`)
  })

  const error = removing.error ?? savingImap.error ?? removingPass.error ?? testing.error ?? syncing.error
  const busy = removing.busy || savingImap.busy || removingPass.busy || testing.busy || syncing.busy

  return (
    <div className="stack" data-testid={`mailbox-${mailbox.id}`} style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--line)' }}>
      <div className="group-row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div className="row-main" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
          <strong>{mailbox.address}</strong>
          <Badge tone={IMAP_STATUS_TONE[mailbox.imapStatus]} data-testid={`mailbox-imap-status-${mailbox.id}`}>
            {IMAP_STATUS_LABEL[mailbox.imapStatus]}
          </Badge>
          {mailbox.hasPassword && <Badge>Password saved</Badge>}
          {mailbox.lastSyncedAt && <span className="muted small">Synced {formatTime(mailbox.lastSyncedAt)}</span>}
        </div>
        <div className="row" style={{ gap: 'var(--space-1)' }}>
          {mailbox.imapHost && mailbox.hasPassword && (
            <Button variant="secondary" onClick={() => void syncNow()} disabled={busy} data-testid={`mailbox-sync-${mailbox.id}`}>
              {syncing.busy ? 'Syncing…' : 'Sync'}
            </Button>
          )}
          <Button
            variant="quiet"
            onClick={() => {
              setOpen((v) => !v)
              setSyncNote(null)
            }}
            data-testid={`mailbox-imap-toggle-${mailbox.id}`}
          >
            {open ? 'Hide IMAP' : 'IMAP setup'}
          </Button>
          <ConfirmAction
            label="Remove"
            question="Removes this mailbox and its synced message index. Addresses already given to accounts stay."
            confirmLabel="Remove mailbox"
            onConfirm={() => void remove()}
            testId={`mailbox-remove-${mailbox.id}`}
            confirmTestId={`mailbox-remove-confirm-${mailbox.id}`}
          />
        </div>
      </div>

      {mailbox.imapError && (
        <div className="note bad" data-testid={`mailbox-imap-error-${mailbox.id}`}>
          {mailbox.imapError}
        </div>
      )}
      {syncNote && (
        <p className="muted small" data-testid={`mailbox-sync-note-${mailbox.id}`}>
          {syncNote}
        </p>
      )}

      {open && (
        <div className="stack" style={{ paddingLeft: 'var(--space-3)' }} data-testid={`mailbox-imap-panel-${mailbox.id}`}>
          {outlook && (
            <div className="note warn" data-testid={`mailbox-outlook-note-${mailbox.id}`}>
              {OUTLOOK_OAUTH_NOTE}
            </div>
          )}
          {preset && !outlook && (
            <Hint>
              {preset.label}: {preset.hint}
            </Hint>
          )}
          <div className="form-row">
            <Field label="IMAP server">
              <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" disabled={busy} data-testid={`mailbox-host-${mailbox.id}`} />
            </Field>
            <Field label="Port">
              <input className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} disabled={busy} data-testid={`mailbox-port-${mailbox.id}`} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="IMAP username" hint="Usually your full e-mail address.">
              <input className="input" value={user} onChange={(e) => setUser(e.target.value)} placeholder={mailbox.address} disabled={busy} data-testid={`mailbox-user-${mailbox.id}`} />
            </Field>
            <Field label="Webmail URL (optional)" hint="Opened in the app's browser when you press Open in webmail.">
              <input className="input" value={webmailUrl} onChange={(e) => setWebmailUrl(e.target.value)} placeholder="https://mail.google.com/" disabled={busy} data-testid={`mailbox-webmail-${mailbox.id}`} />
            </Field>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-body)' }}>
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} disabled={busy} data-testid={`mailbox-secure-${mailbox.id}`} />
            <span>Use TLS / SSL (recommended, port 993)</span>
          </label>
          <Field
            label={mailbox.hasPassword ? 'Replace IMAP app password (optional)' : 'IMAP app password'}
            hint="Stored only in your encrypted system keychain vault — never in the database, logs, or AI prompts."
          >
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mailbox.hasPassword ? 'Leave blank to keep saved password' : 'Paste app password'}
              autoComplete="off"
              disabled={busy}
              data-testid={`mailbox-password-${mailbox.id}`}
            />
          </Field>
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <Button variant="secondary" onClick={() => void saveImap()} disabled={busy} data-testid={`mailbox-imap-save-${mailbox.id}`}>
              {savingImap.busy ? 'Saving…' : 'Save IMAP settings'}
            </Button>
            <Button onClick={() => void testImap()} disabled={busy || !mailbox.imapHost || !mailbox.hasPassword} data-testid={`mailbox-imap-test-${mailbox.id}`}>
              {testing.busy ? 'Testing…' : 'Test connection'}
            </Button>
            {mailbox.hasPassword && (
              <Button variant="quiet" className="danger" onClick={() => void removePass()} disabled={busy} data-testid={`mailbox-password-remove-${mailbox.id}`}>
                Remove password
              </Button>
            )}
          </div>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  )
}

/**
 * The owner's base mailboxes (DEC-015, REQ-013, DEC-100): an ordinary mailbox from which every account gets an address of its own,
 * with optional read-only IMAP connection so verification mail and platform notices can be read inside Accounts → Mail.
 */
export function MailboxesCard({ mailboxes }: { mailboxes: Mailbox[] }) {
  const [address, setAddress] = useState('')
  const [add, adding] = useAction(async () => {
    await call('mailboxes.add', { address: address.trim() })
    setAddress('')
  })

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (address.trim() !== '') void add()
  }

  return (
    <Card title="Base mailboxes & IMAP">
      <p className="muted">
        Your own mailbox (Gmail, iCloud, Fastmail…). From it the app proposes a separate address for each account, for example <strong>you+reddit@gmail.com</strong>. Optionally connect read-only IMAP with an app password to read account mail and verification codes in <strong>Accounts → Mail</strong>.
      </p>
      {mailboxes.length > 0 && (
        <div className="rows" data-testid="mailbox-list">
          {mailboxes.map((m) => (
            <MailboxImapRow key={m.id} mailbox={m} />
          ))}
        </div>
      )}
      <form onSubmit={submit} className="add-form" data-testid="mailbox-form">
        <Field label="Add a mailbox" hint="Register an address first; IMAP setup is optional.">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="you@gmail.com" autoComplete="off" data-testid="mailbox-address" />
        </Field>
        <div className="row">
          <Button type="submit" disabled={adding.busy || address.trim() === ''} data-testid="mailbox-add">
            {adding.busy ? 'Adding…' : 'Add mailbox'}
          </Button>
          {address.trim() === '' && <Hint data-testid="mailbox-add-reason">Type the address of your mailbox.</Hint>}
        </div>
      </form>
      <ErrorNote error={adding.error} />
    </Card>
  )
}
