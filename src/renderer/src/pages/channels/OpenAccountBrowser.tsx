import { useEffect, useRef, useState } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'
import { OPEN_BROWSER, USE_THIS_PAGE, holdingNote, openBlocker, openMode, pageResult } from './open-browser'
import { useBlockClaim } from './open-browser-claims'
import './channels.css'

interface Props {
  account: Account
  /** The button's words; "Open browser" unless the place says more ("Open in the account’s browser"). */
  label?: string
  /** Opens the account's browser at the place of this screen (the core refuses what cannot be opened, and the sentence is shown). */
  open: () => Promise<unknown>
  /** A screen with a field to fill: while the owner works in the window, "Use the page I’m on" hands the address of that page here. */
  onUsePage?: (url: string) => void
  /** The screen's own reason it cannot open yet (nothing to open), said beside the button. */
  blockedReason?: string | null
  /** One sentence under the button that says what it does, while it is closed. */
  hint?: string
  testId: string
}

/**
 * "Open browser" (DEC-028): the account's own browser (the app's, or Chrome, as the account is set up), signed in as it, opened where
 * channels are chosen or shown, so the owner can look around with the account's own session. It behaves like "Open browser to sign in":
 * the owner takes control, the AI and the automation for this account wait, and "Done" gives it back; the app then checks the sign-in
 * once. The AI gets nothing from this browsing: the only read is the explicit "Use the page I’m on", which hands over the address.
 *
 * It is never the screen's filled button. Closed, it is a button (with the reason beside it while it is off); open, it is a block of
 * its own line (the note, the window's buttons). It renders into the row of the screen that holds it, which must wrap.
 */
export function OpenAccountBrowser({ account, label = OPEN_BROWSER, open, onUsePage, blockedReason, hint, testId }: Props) {
  const browser = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
  const agent = useQuery('agent.state', { accountId: account.id }, ['accounts'])
  // Several controls of a screen can lead to this account: the block is shown once, by the one that was pressed.
  const block = useBlockClaim(account.id)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [pageNote, setPageNote] = useState<string | null>(null)
  const [start, starting] = useAction(async () => {
    setPageNote(null)
    await open()
    block.claim()
    browser.reload()
  })
  const [show, showing] = useAction(() => call('accounts.showBrowser', { accountId: account.id }))
  const [done, finishing] = useAction(async () => {
    await call('accounts.releaseControl', { accountId: account.id })
    block.release()
  })
  const [usePage, reading] = useAction(async () => {
    const result = pageResult(await call('accounts.currentPage', { accountId: account.id }))
    // The owner may have moved to another account while the page was being read: its address is not for this form any more.
    if (!alive.current) return
    if ('address' in result) {
      setPageNote(result.note)
      onUsePage?.(result.address)
    } else {
      setPageNote(result.note)
    }
  })
  const error = starting.error ?? showing.error ?? finishing.error ?? reading.error

  const yours = browser.data?.holder === 'user'
  const windowOpen = browser.data?.windowOpen === true
  // The window was closed (or control given back) elsewhere: this control is no longer the one that opened it.
  const wasYours = useRef(false)
  useEffect(() => {
    if (yours) wasYours.current = true
    else if (wasYours.current) {
      wasYours.current = false
      block.release()
      setPageNote(null)
    }
  }, [yours])

  const mode = openMode(browser.data?.holder, block.showsBlock)
  if (mode === 'open') {
    return (
      <div className="open-browser-panel" data-testid={`${testId}-state`}>
        <div className="note warn" role="status">
          {holdingNote(windowOpen)}
        </div>
        <div className="row">
          {onUsePage && windowOpen && (
            <Button variant="secondary" onClick={() => void usePage()} disabled={reading.busy} data-testid={`${testId}-use-page`}>
              {reading.busy ? 'Reading…' : USE_THIS_PAGE}
            </Button>
          )}
          {windowOpen && (
            <Button onClick={() => void show()} disabled={showing.busy} data-testid={`${testId}-show`}>
              Show the window
            </Button>
          )}
          <Button onClick={() => void done()} disabled={finishing.busy} data-testid={`${testId}-done`}>
            {windowOpen ? 'Done, close the window' : 'Give control back'}
          </Button>
        </div>
        {pageNote && <Hint data-testid={`${testId}-page-note`}>{pageNote}</Hint>}
        <ErrorNote error={error} />
      </div>
    )
  }

  const reason = openBlocker({ aiWorking: agent.data?.status === 'running', mode, hostReason: blockedReason })
  return (
    <>
      <Button onClick={() => void start()} disabled={reason !== null || starting.busy} aria-describedby={reason ? `${testId}-reason` : undefined} data-testid={testId}>
        {starting.busy ? 'Opening…' : label}
      </Button>
      {reason && (
        <Hint className="row-note" id={`${testId}-reason`} data-testid={`${testId}-reason`}>
          {reason}
        </Hint>
      )}
      {hint && (
        <Hint className="open-browser-line" data-testid={`${testId}-hint`}>
          {hint}
        </Hint>
      )}
      {error && (
        <div className="open-browser-line">
          <ErrorNote error={error} />
        </div>
      )}
    </>
  )
}
