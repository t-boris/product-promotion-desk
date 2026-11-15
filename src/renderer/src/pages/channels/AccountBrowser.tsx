import type { Account, BrowserChoice } from '../../../../shared/types'
import { useState } from 'react'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, Hint, SegmentedControl } from '../../ui'
import { AccountBlock } from './AccountBlock'

const BROWSER_LABEL: Record<BrowserChoice, string> = { internal: 'Internal', chrome: 'Google Chrome' }
const BROWSER_NOTE: Record<BrowserChoice, string> = {
  internal: 'The app’s own browser; every operation on this account uses it.',
  chrome: 'Your installed Google Chrome, in a window of its own with a profile of its own for this account; every operation on this account uses it.'
}

/**
 * The browser an account works in (DEC-026): the app's own (the default) or the installed Google Chrome. It is a setting of the account, not
 * a step: the sign-in of an account is kept in the browser it was made in, so after a switch the account signs in again in the other one.
 * Changed only while nobody uses the account's browser (the AI is not working on it, its window is not open); the reason is said beside it.
 * A switch signs the account out and closes its Chrome, so the control only chooses and a button applies it: an arrow key between the two
 * segments never changes anything by itself.
 */
export function AccountBrowser({ account }: { account: Account }) {
  const state = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
  const agent = useQuery('agent.state', { accountId: account.id }, ['accounts'])
  // What the control shows: the choice being made, or the account's own browser when none is being made (or it was just applied).
  const [picked, setPicked] = useState<BrowserChoice | null>(null)
  const shown = picked !== null && picked !== account.browser ? picked : account.browser
  const [apply, applying] = useAction(async () => {
    await call('accounts.setBrowser', { accountId: account.id, browser: shown })
    setPicked(null)
  })
  const chromeMissing = state.data?.chromeFound === false
  const working = agent.data?.status === 'running'
  const inUse = state.data !== undefined && (state.data.holder !== 'none' || state.data.windowOpen)
  const reason = working
    ? 'The AI is working on this account. Change its browser when it is done.'
    : inUse
      ? 'The account’s browser is in use now (its window is open, or you took control). Close it or give control back, then change the browser.'
      : null
  const chromeReason = chromeMissing ? 'Google Chrome was not found on this Mac.' : null

  return (
    <AccountBlock
      title="Browser"
      testId={`account-browser-${account.id}`}
      summary={
        <span data-testid={`account-browser-state-${account.id}`}>
          <strong>{BROWSER_LABEL[account.browser]}</strong> <span className="muted">· {BROWSER_NOTE[account.browser]}</span>
        </span>
      }
    >
      <div className="pick-row">
        <SegmentedControl<BrowserChoice>
          label="Browser of this account"
          name={`browser-${account.id}`}
          testIdPrefix={`account-browser-${account.id}-`}
          value={shown}
          disabled={reason !== null || applying.busy}
          describedBy={(reason ?? chromeReason) ? `account-browser-reason-${account.id}` : undefined}
          options={[
            { value: 'internal', label: BROWSER_LABEL.internal },
            { value: 'chrome', label: BROWSER_LABEL.chrome, disabled: chromeMissing }
          ]}
          onChange={setPicked}
        />
        {shown !== account.browser && (
          <Button onClick={() => void apply()} disabled={reason !== null || applying.busy} data-testid={`account-browser-apply-${account.id}`}>
            {applying.busy ? 'Switching…' : `Use ${BROWSER_LABEL[shown]}`}
          </Button>
        )}
        {(reason ?? chromeReason) && (
          <Hint id={`account-browser-reason-${account.id}`} data-testid={`account-browser-reason-${account.id}`}>
            {reason ?? chromeReason}
          </Hint>
        )}
      </div>
      <p className="muted small" data-testid={`account-browser-note-${account.id}`}>
        The sign-in of an account is kept in the browser it was made in. After you switch, the account signs in again in the other browser; the one in this browser stays where it is. Chrome opens its own window.
      </p>
      <ErrorNote error={applying.error} />
    </AccountBlock>
  )
}
