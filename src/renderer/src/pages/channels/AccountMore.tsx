import { useState } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ConfirmAction, ErrorNote } from '../../ui'
import { AccountBlock } from './AccountBlock'

const CONTROL_FREE = 'The AI opens a window of its own for every task and closes it when it is done. While it works you can take control to finish something in that window yourself (a CAPTCHA, a question from the AI): the AI then stops using it.'
const CONTROL_TAKEN = 'You have control of the AI’s page. The AI does not use it, and the app cannot sign in or check this account, until you give control back.'

/**
 * The rare controls of an account, the "More" tab (DEC-037, DEC-038): open another page in a window of the account's browser, take or give back
 * the AI's own page, remove the account. Opening a window takes nothing from the AI. Take control is the only thing that stops its page, and
 * only for one case: the owner finishes something in it. Giving control back closes no window of the owner's.
 */
export function AccountMore({ account }: { account: Account }) {
  const [address, setAddress] = useState('')
  const browser = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
  const taken = browser.data?.holder === 'user'
  const [open, opening] = useAction(() => call('accounts.openBrowser', { accountId: account.id, url: address.trim() }))
  const [take, taking] = useAction(() => call('accounts.takeControl', { accountId: account.id }))
  const [release, releasing] = useAction(() => call('accounts.releaseControl', { accountId: account.id }))
  const [remove, removing] = useAction(() => call('accounts.remove', { id: account.id }))
  const error = opening.error ?? taking.error ?? releasing.error ?? removing.error

  return (
    <div className="stack" data-testid={`account-more-${account.id}`}>
      <AccountBlock title="Another page" summary="Opens a window of this account’s browser on the address you type; the AI keeps working in its own page.">
        <div className="pick-row">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Another page to open in this account’s browser" aria-label={`Page to open for ${account.label}`} data-testid={`account-address-${account.id}`} />
          <Button onClick={() => void open()} disabled={opening.busy || address.trim() === ''} data-testid={`account-open-page-${account.id}`}>
            Open page
          </Button>
        </div>
      </AccountBlock>
      <AccountBlock title="The AI’s page" summary={<span data-testid={`account-control-state-${account.id}`}>{taken ? CONTROL_TAKEN : CONTROL_FREE}</span>}>
        <div className="row">
          <Button onClick={() => void take()} disabled={taking.busy || taken} data-testid={`account-take-${account.id}`} title="The AI stops using its page of this account until you give it back">
            Take control
          </Button>
          <Button onClick={() => void release()} disabled={releasing.busy || !taken} data-testid={`account-release-${account.id}`} title="The app may use its page of this account again">
            Give control back to the app
          </Button>
        </div>
      </AccountBlock>
      <AccountBlock title="Remove" summary="Removes the account and erases its saved sign-in from this Mac.">
        <div className="row">
          <ConfirmAction
            label="Remove account"
            question="Removes the account and erases its saved sign-in from this Mac."
            confirmLabel="Remove"
            onConfirm={() => remove()}
            testId={`account-remove-${account.id}`}
            confirmTestId={`account-remove-confirm-${account.id}`}
          />
        </div>
      </AccountBlock>
      <ErrorNote error={error} />
    </div>
  )
}
