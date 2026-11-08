import { useState, type FormEvent } from 'react'
import type { Mailbox } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field } from '../../ui'

/** The owner's base mailboxes (DEC-015): an ordinary mailbox from which every account gets an address of its own. */
export function MailboxesCard({ mailboxes }: { mailboxes: Mailbox[] }) {
  const [address, setAddress] = useState('')
  const [add, adding] = useAction(async () => {
    await call('mailboxes.add', { address: address.trim() })
    setAddress('')
  })
  const [remove, removing] = useAction((id: string) => call('mailboxes.remove', { id }))

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (address.trim() !== '') void add()
  }

  return (
    <Card title="Base mailbox">
      <p className="muted small">
        Your own mailbox (Gmail, iCloud, Fastmail…). From it the app proposes a separate address for each account, for example <strong>you+reddit@gmail.com</strong>: all mail still arrives in your mailbox, and each account has an address of its own. Some platforms refuse addresses with “+”; then type another address for that account. Reading this mail inside the app comes in a later release.
      </p>
      {mailboxes.length > 0 && (
        <div className="stack" data-testid="mailbox-list">
          {mailboxes.map((m) => (
            <div className="list-row" key={m.id} data-testid={`mailbox-${m.id}`}>
              <strong>{m.address}</strong>
              <Button variant="danger" onClick={() => void remove(m.id)} disabled={removing.busy} data-testid={`mailbox-remove-${m.id}`}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} data-testid="mailbox-form">
        <Field label="Add a mailbox" hint="Only the address is stored. No password is asked here.">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="you@gmail.com" autoComplete="off" data-testid="mailbox-address" />
        </Field>
        <Button variant="primary" type="submit" disabled={adding.busy || address.trim() === ''} data-testid="mailbox-add">
          {adding.busy ? 'Adding…' : 'Add mailbox'}
        </Button>
      </form>
      <ErrorNote error={adding.error ?? removing.error} />
    </Card>
  )
}
