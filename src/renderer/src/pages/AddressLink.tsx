import type { ReactNode } from 'react'
import { call, useAction } from '../hooks'

/**
 * A link to a page of a site (a post, a comment, a result, a page the AI saw). It opens in the app's own browser, as the account the page belongs to
 * (the channel's when `channelId` is given, else the one whose platform owns the address), and never in the system's browser: the `href` is only what a
 * screen reader and a long press show, a click is answered here. A refusal (for example "no account yet") is written next to the link.
 */
export function AddressLink({ url, channelId, accountId, className, testId, children }: { url: string; channelId?: string; accountId?: string; className?: string; testId?: string; children: ReactNode }) {
  const [open, opening] = useAction(() => call('accounts.openAddress', { url, ...(channelId ? { channelId } : {}), ...(accountId ? { accountId } : {}) }))
  return (
    <>
      <a
        className={className}
        href={url}
        rel="noreferrer"
        data-testid={testId}
        aria-busy={opening.busy}
        onClick={(event) => {
          event.preventDefault()
          void open()
        }}
      >
        {children}
      </a>
      {opening.error && (
        <span className="muted small" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {opening.error}
        </span>
      )}
    </>
  )
}
