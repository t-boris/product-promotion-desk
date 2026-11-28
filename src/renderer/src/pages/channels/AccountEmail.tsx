import { useState, type FormEvent } from 'react'
import type { Account, Mailbox, VerificationLookup } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Field, useMainVariant, useOpenForm } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { CopyButton } from './CopyButton'
import type { NextStep } from './next-step'

/**
 * The e-mail address of one account (DEC-015): what it signs up with and where the platform writes to it. An address can be
 * typed, or proposed from a base mailbox, which gives every account an address of its own.
 */
export function AccountEmail({
  account,
  mailboxes,
  next,
  onOpenMail
}: {
  account: Account
  mailboxes: Mailbox[]
  /** The step the account needs next: "Set an address" is the filled button only when it is this one. */
  next: NextStep['block']
  onOpenMail?: (accountId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  // The open form owns the filled button while it is the form opened last; the resting "Set an address" is filled only while it is the account's next step.
  const saveVariant = useOpenForm(editing)
  const main = useMainVariant()
  const [address, setAddress] = useState(account.email ?? '')
  const [chosenMailbox, setChosenMailbox] = useState<string>(account.mailboxId ?? '')
  // Derived, not copied at mount: the mailbox list can arrive after this block was first drawn.
  const mailboxId = mailboxes.some((m) => m.id === chosenMailbox) ? chosenMailbox : (mailboxes[0]?.id ?? '')
  const [fromMailbox, setFromMailbox] = useState<string | null>(null)
  const [save, saving] = useAction(async () => {
    await call('accounts.setEmail', { accountId: account.id, email: address.trim() || null, mailboxId: fromMailbox })
    setEditing(false)
  })
  const [clear, clearing] = useAction(async () => {
    await call('accounts.setEmail', { accountId: account.id, email: null })
    setEditing(false)
  })
  const [propose, proposing] = useAction(async () => {
    const result = await call('accounts.proposeEmail', { mailboxId, platform: account.platform })
    setAddress(result.address)
    setFromMailbox(mailboxId)
  })
  const [lookup, setLookup] = useState<VerificationLookup | null>(null)
  const [checkCodes, checkingCodes] = useAction(async () => {
    const res = await call('mail.codes', { accountId: account.id })
    setLookup(res)
  })
  const [openLink, openingLink] = useAction((url: string) => call('accounts.openAddress', { url }))
  const unreadQuery = useQuery('mail.list', { accountId: account.id, unreadOnly: true, limit: 20 }, ['accounts'])
  const unreadForAccount = account.email ? (unreadQuery.data?.length ?? 0) : 0
  const hasImapMailbox = mailboxes.some((m) => m.imapHost && m.hasPassword)
  const error = saving.error ?? clearing.error ?? proposing.error ?? checkingCodes.error ?? openingLink.error
  const mailbox = mailboxes.find((m) => m.id === account.mailboxId)

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (address.trim() !== '') void save()
  }

  const summary = account.email ? (
    <span data-testid={`email-state-${account.id}`}>
      <strong>{account.email}</strong>
      {mailbox ? <span className="muted"> · an address of {mailbox.address}</span> : null}
    </span>
  ) : (
    <span className="muted" data-testid={`email-state-${account.id}`}>
      No address yet. The platform writes to it, and mail for this account can be told apart from the others.
    </span>
  )

  return (
    <AccountBlock
      step={3}
      title="E-mail"
      summary={summary}
      testId={`email-${account.id}`}
      actions={
        !editing && (
          <>
            {account.email && <CopyButton text={account.email} testId={`email-copy-${account.id}`} />}
            <Button
              variant={next === 'email' ? main : 'ghost'}
              onClick={() => {
                setAddress(account.email ?? '')
                setFromMailbox(account.mailboxId)
                setEditing(true)
              }}
              data-testid={`email-edit-${account.id}`}
            >
              {account.email ? 'Change' : 'Set an address'}
            </Button>
          </>
        )
      }
    >
      {editing && (
        <form onSubmit={submit} className="stack" data-testid={`email-form-${account.id}`}>
          <Field label="Address of this account" hint="Each account should have an address of its own.">
            <input
              className="input"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                setFromMailbox(null)
              }}
              autoComplete="off"
              data-testid={`email-input-${account.id}`}
            />
          </Field>
          {mailboxes.length > 0 ? (
            <div className="pick-row">
              <select className="input" value={mailboxId} onChange={(e) => setChosenMailbox(e.target.value)} aria-label="Base mailbox" data-testid={`email-mailbox-${account.id}`}>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => void propose()} disabled={proposing.busy || mailboxId === ''} data-testid={`email-propose-${account.id}`}>
                Propose an address from this mailbox
              </Button>
            </div>
          ) : (
            <p className="muted small">To get proposed addresses, add your own mailbox in Settings.</p>
          )}
          <div className="row">
            <Button variant={saveVariant} type="submit" disabled={saving.busy || address.trim() === ''} data-testid={`email-save-${account.id}`}>
              {saving.busy ? 'Saving…' : 'Save address'}
            </Button>
            {account.email && (
              <Button onClick={() => void clear()} disabled={clearing.busy} data-testid={`email-clear-${account.id}`}>
                Remove address
              </Button>
            )}
            <Button
              onClick={() => {
                setEditing(false)
                setAddress(account.email ?? '')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!editing && account.email && (hasImapMailbox || unreadForAccount > 0) && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }} data-testid={`account-mail-bar-${account.id}`}>
          {unreadForAccount > 0 && <Badge tone="info">{unreadForAccount} unread</Badge>}
          {hasImapMailbox && (
            <Button variant="secondary" onClick={() => void checkCodes()} disabled={checkingCodes.busy} data-testid={`account-check-code-${account.id}`}>
              {checkingCodes.busy ? 'Checking mail…' : 'Check verification code'}
            </Button>
          )}
          {onOpenMail && (
            <Button variant="quiet" onClick={() => onOpenMail(account.id)} data-testid={`account-open-mail-${account.id}`}>
              View mail
            </Button>
          )}
        </div>
      )}
      {lookup && (
        <div className="note stack" style={{ marginTop: 'var(--space-2)', gap: 'var(--space-1)' }} data-testid={`account-code-result-${account.id}`}>
          {lookup.matches.length === 0 ? (
            <span className="muted small">No verification code or confirmation link found in mail to {lookup.email} from the last 30 minutes.</span>
          ) : (
            lookup.matches.map((match) => (
              <div key={match.messageId} className="stack" style={{ gap: 'var(--space-1)' }}>
                <div className="small">
                  <strong>{match.subject}</strong> <span className="muted">from {match.fromAddress}</span>
                </div>
                {match.codes.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                    {match.codes.map((code) => (
                      <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                        <code style={{ fontWeight: 'var(--fw-semibold)' }}>{code}</code>
                        <CopyButton text={code} />
                      </span>
                    ))}
                  </div>
                )}
                {match.links.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                    {match.links.slice(0, 2).map((link) => (
                      <Button key={link} variant="secondary" onClick={() => void openLink(link)} disabled={openingLink.busy}>
                        Open confirmation link
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </AccountBlock>
  )
}
