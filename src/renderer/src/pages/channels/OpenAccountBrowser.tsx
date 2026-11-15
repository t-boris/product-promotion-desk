import { useEffect, useRef, useState } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'
import { OPEN_BROWSER, USE_THIS_PAGE, pageResult } from './open-browser'
import './channels.css'

interface Props {
  account: Account
  /** The button's words; "Open browser" unless the place says more ("Open in the account’s browser"). */
  label?: string
  /** Opens the account's browser at the place of this screen (the core refuses what cannot be opened, and the sentence is shown). */
  open: () => Promise<unknown>
  /** A screen with a field to fill: while a window of the owner's is open, "Use the page I’m on" hands the address of that page here. */
  onUsePage?: (url: string) => void
  /** The screen's own reason it cannot open yet (nothing to open), said beside the button. */
  blockedReason?: string | null
  /** One sentence under the button that says what it does. */
  hint?: string
  testId: string
}

/**
 * "Open browser" (DEC-028, DEC-038): a window on the account's own session (the app's browser, or Chrome, as the account is set up), signed in
 * as it, opened where channels are chosen or shown, so the owner can look around with the account's own session. It is a plain button: the
 * window is one more window of the session, the AI keeps working in a page of its own, and neither takes control from the other. The AI gets
 * nothing from this browsing: the only read is the explicit "Use the page I’m on", which hands over the address.
 *
 * It is never the screen's filled button. It renders into the row of the screen that holds it, which must wrap; a sentence or an error of it
 * takes the whole line under the button.
 */
export function OpenAccountBrowser({ account, label = OPEN_BROWSER, open, onUsePage, blockedReason, hint, testId }: Props) {
  const browser = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
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
    browser.reload()
  })
  const [usePage, reading] = useAction(async () => {
    const result = pageResult(await call('accounts.currentPage', { accountId: account.id }))
    // The owner may have moved to another account while the page was being read: its address is not for this form any more.
    if (!alive.current) return
    setPageNote(result.note)
    if ('address' in result) onUsePage?.(result.address)
  })
  const error = starting.error ?? reading.error

  const windowOpen = browser.data?.windowOpen === true
  // The owner closed their last window: what was said about its page is no longer true.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (windowOpen) wasOpen.current = true
    else if (wasOpen.current) {
      wasOpen.current = false
      setPageNote(null)
    }
  }, [windowOpen])

  const reason = blockedReason ?? null
  return (
    <>
      <Button onClick={() => void start()} disabled={reason !== null || starting.busy} aria-describedby={reason ? `${testId}-reason` : undefined} data-testid={testId}>
        {starting.busy ? 'Opening…' : label}
      </Button>
      {onUsePage && windowOpen && (
        <Button variant="secondary" onClick={() => void usePage()} disabled={reading.busy} data-testid={`${testId}-use-page`}>
          {reading.busy ? 'Reading…' : USE_THIS_PAGE}
        </Button>
      )}
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
      {pageNote && (
        <Hint className="open-browser-line" data-testid={`${testId}-page-note`}>
          {pageNote}
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
