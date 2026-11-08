import { useState, type FormEvent } from 'react'
import type { Account, Mailbox } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { CopyButton } from './CopyButton'

/**
 * The e-mail address of one account (DEC-015): what it signs up with and where the platform writes to it. An address can be
 * typed, or proposed from a base mailbox, which gives every account an address of its own.
 */
export function AccountEmail({ account, mailboxes }: { account: Account; mailboxes: Mailbox[] }) {
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState(account.email ?? '')
  const [chosenMailbox, setChosenMailbox] = useState<string>(account.mailboxId ?? '')
  // Derived, not copied at mount: the mailbox list can arrive after this row was first drawn.
  const mailboxId = mailboxes.some((m) => m.id === chosenMailbox) ? chosenMailbox : (mailboxes[0]?.id ?? '')
  const [fromMailbox, setFromMailbox] = useState<string | null>(null)
  const [save, saving] = useAction(async () => {
    await call('accounts.setEmail', { accountId: account.id, email: address.trim() || null, mailboxId: fromMailbox })
    setEditing(false)
  })
  const [clear, clearing] = useAction(() => call('accounts.setEmail', { accountId: account.id, email: null }))
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

  return (
    <div className="password-box" data-testid={`email-${account.id}`}>
      <div className="password-head">
        <strong>E-mail</strong>
        {account.email ? (
          <span className="muted small" data-testid={`email-state-${account.id}`}>
            <strong>{account.email}</strong>
            {mailbox ? ` · an address of ${mailbox.address}` : ''}
          </span>
        ) : (
          <span className="muted small" data-testid={`email-state-${account.id}`}>
            No address yet. Give one so the platform can write to this account.
          </span>
        )}
      </div>
      {editing ? (
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
          {mailboxes.length > 0 && (
            <div className="pick-row">
              <select className="input" value={mailboxId} onChange={(e) => setChosenMailbox(e.target.value)} aria-label="Base mailbox" data-testid={`email-mailbox-${account.id}`}>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </select>
              <Button onClick={() => void propose()} disabled={proposing.busy || mailboxId === ''} data-testid={`email-propose-${account.id}`}>
                Propose an address
              </Button>
            </div>
          )}
          <div className="row">
            <Button variant="primary" type="submit" disabled={saving.busy || address.trim() === ''} data-testid={`email-save-${account.id}`}>
              {saving.busy ? 'Saving…' : 'Save address'}
            </Button>
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
      ) : (
        <div className="row">
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
          {account.email && (
            <Button variant="danger" onClick={() => void clear()} disabled={clearing.busy} data-testid={`email-clear-${account.id}`}>
              Remove address
            </Button>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
