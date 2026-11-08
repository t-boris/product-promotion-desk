import { useState, type FormEvent } from 'react'
import type { Account, Mailbox } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { CopyButton } from './CopyButton'

/**
 * The e-mail address of one account (DEC-015): what it signs up with and where the platform writes to it. An address can be
 * typed, or proposed from a base mailbox, which gives every account an address of its own.
 */
export function AccountEmail({ account, mailboxes }: { account: Account; mailboxes: Mailbox[] }) {
  const [editing, setEditing] = useState(false)
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
  const error = saving.error ?? clearing.error ?? proposing.error
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
              <Button onClick={() => void propose()} disabled={proposing.busy || mailboxId === ''} data-testid={`email-propose-${account.id}`}>
                Propose an address from this mailbox
              </Button>
            </div>
          ) : (
            <p className="muted small">To get proposed addresses, add your own mailbox on the “Mailboxes” tab.</p>
          )}
          <div className="row">
            <Button variant="primary" type="submit" disabled={saving.busy || address.trim() === ''} data-testid={`email-save-${account.id}`}>
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
      <ErrorNote error={error} />
    </AccountBlock>
  )
}
