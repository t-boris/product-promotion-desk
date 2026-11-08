import { useState } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote } from '../../ui'

/** The rare controls of an account, out of the way: take or give back the browser, open another page, remove the account. */
export function AccountMore({ account }: { account: Account }) {
  const [address, setAddress] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [open, opening] = useAction(() => call('accounts.openBrowser', { accountId: account.id, url: address.trim() }))
  const [take, taking] = useAction(() => call('accounts.takeControl', { accountId: account.id }))
  const [release, releasing] = useAction(() => call('accounts.releaseControl', { accountId: account.id }))
  const [remove, removing] = useAction(() => call('accounts.remove', { id: account.id }))
  const error = opening.error ?? taking.error ?? releasing.error ?? removing.error

  return (
    <details className="acct-more" data-testid={`account-more-${account.id}`}>
      <summary>More</summary>
      <div className="acct-more-body">
        <div className="pick-row">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Another page to open in this account’s browser" aria-label={`Page to open for ${account.label}`} data-testid={`account-address-${account.id}`} />
          <Button onClick={() => void open()} disabled={opening.busy || address.trim() === ''} data-testid={`account-open-page-${account.id}`}>
            Open page
          </Button>
        </div>
        <div className="row">
          <Button onClick={() => void take()} disabled={taking.busy} data-testid={`account-take-${account.id}`} title="Stops the app from using this browser until you give it back">
            Take control
          </Button>
          <Button onClick={() => void release()} disabled={releasing.busy} data-testid={`account-release-${account.id}`} title="The app may use this browser again">
            Give control back to the app
          </Button>
        </div>
        <div className="row">
          {confirmRemove ? (
            <>
              <span className="muted small">Removes the account and erases its saved sign-in from this Mac.</span>
              <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`account-remove-confirm-${account.id}`}>
                Remove
              </Button>
              <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmRemove(true)} data-testid={`account-remove-${account.id}`}>
              Remove account
            </Button>
          )}
        </div>
        <ErrorNote error={error} />
      </div>
    </details>
  )
}
