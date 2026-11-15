import { useState, type FormEvent } from 'react'
import type { Mailbox } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ConfirmAction, ErrorNote, Field, Hint } from '../../ui'

/**
 * The owner's base mailboxes (DEC-015): an ordinary mailbox from which every account gets an address of its own. It is a card of Settings
 * (DEC-037, phase C5): the screen's filled button is the engine's, so "Add mailbox" is a bezel here.
 */
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
      <p className="muted">
        Your own mailbox (Gmail, iCloud, Fastmail…). From it the app proposes a separate address for each account, for example <strong>you+reddit@gmail.com</strong>: all mail still arrives in your mailbox, and each account has an address of its own. Some platforms refuse addresses with “+”; then type another address for that account. Reading this mail inside the app comes in a later release.
      </p>
      {mailboxes.length > 0 && (
        <div className="rows" data-testid="mailbox-list">
          {mailboxes.map((m) => (
            <div className="group-row" key={m.id} data-testid={`mailbox-${m.id}`}>
              <strong className="row-main">{m.address}</strong>
              <ConfirmAction
                label="Remove"
                question="Removes this mailbox from the list. Addresses already given to accounts stay."
                confirmLabel="Remove mailbox"
                onConfirm={() => remove(m.id)}
                testId={`mailbox-remove-${m.id}`}
                confirmTestId={`mailbox-remove-confirm-${m.id}`}
              />
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="add-form" data-testid="mailbox-form">
        <Field label="Add a mailbox" hint="Only the address is stored. No password is asked here.">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="you@gmail.com" autoComplete="off" data-testid="mailbox-address" />
        </Field>
        <div className="row">
          <Button type="submit" disabled={adding.busy || address.trim() === ''} data-testid="mailbox-add">
            {adding.busy ? 'Adding…' : 'Add mailbox'}
          </Button>
          {address.trim() === '' && <Hint data-testid="mailbox-add-reason">Type the address of your mailbox.</Hint>}
        </div>
      </form>
      <ErrorNote error={adding.error ?? removing.error} />
    </Card>
  )
}
