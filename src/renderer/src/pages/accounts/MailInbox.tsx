import { useEffect, useMemo, useState } from 'react'
import type { Account, Id, MailBodyView, Mailbox, MailMessage, PlatformInfo } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, EmptyState, ErrorNote, Field, Loading, formatTime } from '../../ui'
import { CopyButton } from '../channels/CopyButton'
import { platformLabel } from '../channels/model'

/**
 * Unified Mail Inbox across all IMAP-connected base mailboxes (REQ-013, DEC-100).
 * Filters by account, platform, mailbox, and unread status; fetches plain-text bodies on demand over IMAP
 * (never stored on disk); extracts verification codes/links with one-click copy; opens webmail in the
 * application's own browser (never the system browser).
 */
export function MailInbox({
  accounts,
  mailboxes,
  platforms,
  initialAccountId = null,
  onClearInitialAccount
}: {
  accounts: Account[]
  mailboxes: Mailbox[]
  platforms: PlatformInfo[]
  initialAccountId?: Id | null
  onClearInitialAccount?: () => void
}) {
  const [accountId, setAccountId] = useState<Id | null>(initialAccountId)
  const [platform, setPlatform] = useState<string | null>(null)
  const [mailboxId, setMailboxId] = useState<Id | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [bodyView, setBodyView] = useState<MailBodyView | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  useEffect(() => {
    if (initialAccountId) {
      setAccountId(initialAccountId)
      onClearInitialAccount?.()
    }
  }, [initialAccountId])

  const queryArgs = useMemo(
    () => ({
      ...(accountId ? { accountId } : {}),
      ...(platform ? { platform } : {}),
      ...(mailboxId ? { mailboxId } : {}),
      unreadOnly
    }),
    [accountId, platform, mailboxId, unreadOnly]
  )
  const messagesQuery = useQuery('mail.list', queryArgs, ['accounts'])
  const messages: MailMessage[] = messagesQuery.data ?? []

  const selected = messages.find((m) => m.id === selectedId) ?? messages[0] ?? null

  const [readBody, readingBody] = useAction(async (messageId: Id) => {
    const view = await call('mail.readBody', { messageId })
    setBodyView(view)
  })
  const [markRead, marking] = useAction(async (messageId: Id, unread: boolean) => {
    await call('mail.markRead', { messageId, unread })
  })
  const [syncAll, syncing] = useAction(async () => {
    const res = await call('mailboxes.sync', mailboxId ? { id: mailboxId } : undefined)
    if (res.errors.length > 0) setSyncNote(res.errors.map((e) => e.error).join(' · '))
    else setSyncNote(`Synced ${res.synced} mailbox${res.synced === 1 ? '' : 'es'} (${res.added} new).`)
  })
  const [openWebmail, openingWebmail] = useAction(async (url: string) => {
    await call('accounts.openAddress', { url })
  })

  useEffect(() => {
    if (!selected) {
      setBodyView(null)
      return
    }
    if (bodyView?.message.id === selected.id) return
    setBodyView(null)
    void readBody(selected.id)
  }, [selected?.id])

  const configuredCount = mailboxes.filter((m) => m.imapHost && m.hasPassword).length
  const availablePlatforms = [...new Set(accounts.map((a) => a.platform))]
  const error = messagesQuery.error ?? syncing.error ?? marking.error ?? openingWebmail.error

  return (
    <div className="stack" style={{ flex: 1, minHeight: 0 }} data-testid="mail-inbox">
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <Field label="Account">
          <select className="input" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)} data-testid="mail-filter-account">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Platform">
          <select className="input" value={platform ?? ''} onChange={(e) => setPlatform(e.target.value || null)} data-testid="mail-filter-platform">
            <option value="">All platforms</option>
            {availablePlatforms.map((p) => (
              <option key={p} value={p}>
                {platformLabel(p, platforms)}
              </option>
            ))}
          </select>
        </Field>
        {mailboxes.length > 1 && (
          <Field label="Mailbox">
            <select className="input" value={mailboxId ?? ''} onChange={(e) => setMailboxId(e.target.value || null)} data-testid="mail-filter-mailbox">
              <option value="">All mailboxes</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', height: 32, padding: '0 var(--space-1)' }}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} data-testid="mail-filter-unread" />
          <span>Unread only</span>
        </label>
        <Button variant="secondary" onClick={() => void syncAll()} disabled={syncing.busy || configuredCount === 0} data-testid="mail-sync-all">
          {syncing.busy ? 'Syncing…' : 'Sync mail'}
        </Button>
      </div>

      {syncNote && (
        <p className="muted small" data-testid="mail-sync-note">
          {syncNote}
        </p>
      )}
      <ErrorNote error={error} />

      {messagesQuery.loading && !messagesQuery.data ? (
        <Loading what="Loading mail" />
      ) : configuredCount === 0 && messages.length === 0 ? (
        <EmptyState
          fill
          title="No IMAP mailbox connected"
          action={
            <a className="btn btn-primary" href="#/settings" data-testid="mail-open-settings">
              Set up IMAP in Settings
            </a>
          }
        >
          Add your base mailbox and enter its IMAP server and app password in Settings to read account mail and verification codes here.
        </EmptyState>
      ) : messages.length === 0 ? (
        <EmptyState fill title="No messages match">
          {unreadOnly || accountId || platform || mailboxId
            ? 'Clear one of the filters or press Sync mail to fetch new headers.'
            : 'Press Sync mail to check your connected mailboxes.'}
        </EmptyState>
      ) : (
        <div className="accounts-split" style={{ flex: 1, minHeight: 0 }}>
          <div className="posts-list" role="listbox" aria-label="Mail messages" data-testid="mail-list">
            {messages.map((msg) => {
              const isSelected = selected?.id === msg.id
              return (
                <button
                  key={msg.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`posts-row${isSelected ? ' selected' : ''}`}
                  onClick={() => setSelectedId(msg.id)}
                  data-testid={`mail-row-${msg.id}`}
                  data-unread={msg.unread ? 'true' : 'false'}
                >
                  <span className="posts-row-main">
                    <span className="posts-row-top">
                      <span className="posts-row-title" style={{ fontWeight: msg.unread ? 'var(--fw-semibold)' : 'var(--fw-regular)' }}>
                        {msg.subject}
                      </span>
                      {msg.unread && <Badge tone="info">New</Badge>}
                    </span>
                    <span className="posts-row-line">
                      {msg.fromAddress || 'Unknown sender'}
                      {msg.accountLabel ? ` · ${msg.accountLabel}` : ''}
                      {msg.platform ? ` (${platformLabel(msg.platform, platforms)})` : ''}
                    </span>
                    <span className="posts-row-line posts-row-when">
                      {formatTime(msg.receivedAt)}
                      {msg.preview ? ` · ${msg.preview}` : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="accounts-detail-pane" data-testid="mail-detail">
            {selected && (
              <div
                className="pane stack"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-lg)'
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <div className="stack" style={{ gap: 'var(--space-half)', minWidth: 0 }}>
                    <h3 style={{ margin: 0 }} data-testid="mail-detail-subject">
                      {selected.subject}
                    </h3>
                    <div className="muted small">
                      From <strong>{selected.fromAddress || 'Unknown'}</strong> → <code>{selected.toAddress}</code> · {formatTime(selected.receivedAt)}
                    </div>
                    {selected.accountLabel && (
                      <div className="row" style={{ gap: 'var(--space-1)' }}>
                        <Badge>{selected.accountLabel}</Badge>
                        {selected.platform && <Badge>{platformLabel(selected.platform, platforms)}</Badge>}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                    <Button
                      variant="quiet"
                      onClick={() => void markRead(selected.id, !selected.unread)}
                      disabled={marking.busy}
                      data-testid="mail-toggle-read"
                    >
                      {selected.unread ? 'Mark read' : 'Mark unread'}
                    </Button>
                    {selected.webmailUrl && (
                      <Button
                        variant="secondary"
                        onClick={() => void openWebmail(selected.webmailUrl as string)}
                        disabled={openingWebmail.busy}
                        data-testid="mail-open-webmail"
                      >
                        Open in webmail
                      </Button>
                    )}
                  </div>
                </div>

                {readingBody.busy && <Loading what="Fetching message body over IMAP…" />}
                {readingBody.error && <ErrorNote error={readingBody.error} />}

                {bodyView && bodyView.message.id === selected.id && (
                  <>
                    {(bodyView.codes.length > 0 || bodyView.links.length > 0) && (
                      <div className="note good stack" style={{ gap: 'var(--space-2)' }} data-testid="mail-verification-box">
                        <strong>Verification details found (not stored on disk)</strong>
                        {bodyView.codes.length > 0 && (
                          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                            {bodyView.codes.map((code) => (
                              <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                                <code style={{ fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-semibold)' }} data-testid={`mail-code-${code}`}>
                                  {code}
                                </code>
                                <CopyButton text={code} testId={`mail-code-copy-${code}`} />
                              </span>
                            ))}
                          </div>
                        )}
                        {bodyView.links.length > 0 && (
                          <div className="stack" style={{ gap: 'var(--space-1)' }}>
                            {bodyView.links.map((link) => (
                              <div key={link} className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                <code style={{ wordBreak: 'break-all', flex: '1 1 240px' }}>{link}</code>
                                <Button variant="secondary" onClick={() => void openWebmail(link)} disabled={openingWebmail.busy}>
                                  Open in browser
                                </Button>
                                <CopyButton text={link} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'inherit',
                        fontSize: 'var(--fs-body)',
                        lineHeight: 1.5,
                        background: 'var(--surface-2)',
                        padding: 'var(--space-3)',
                        borderRadius: 'var(--radius-md)'
                      }}
                      data-testid="mail-body-text"
                    >
                      {bodyView.text || '(Empty plain-text body)'}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
