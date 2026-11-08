import { useState } from 'react'
import type { Account, PageReport, PlatformInfo, SignInResult } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { CopyButton } from './CopyButton'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from './model'
import { PageReportView } from './PageReportView'

/**
 * Signing in (REQ-012, DEC-014, DEC-015): create the account on the platform if it does not exist yet, sign in in the account's own
 * browser or with the saved password, and check the result. The app fills in nothing on a registration page; every check on a
 * site (a CAPTCHA, a code, a phone number) is the owner's.
 */
export function AccountSignIn({ account, info, vaultAvailable, hasPassword }: { account: Account; info: PlatformInfo | undefined; vaultAvailable: boolean; hasPassword: boolean }) {
  const [signedIn, setSignedIn] = useState<SignInResult | null>(null)
  const [pageReport, setPageReport] = useState<{ report: PageReport | null } | null>(null)
  const [open, opening] = useAction(() => call('accounts.openBrowser', { accountId: account.id }))
  const [check, checking] = useAction(() => call('accounts.checkLogin', { accountId: account.id }))
  const [signIn, signingIn] = useAction(async () => {
    setSignedIn(null)
    setSignedIn(await call('accounts.signIn', { accountId: account.id }))
  })
  const [signUp, signingUp] = useAction(() => call('accounts.openBrowser', { accountId: account.id, url: info?.signupUrl }))
  const [copyPassword, copying] = useAction(() => call('vault.copyPassword', { accountId: account.id }))
  const browser = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
  const [show, showing] = useAction(() => call('accounts.showBrowser', { accountId: account.id }))
  const [done, finishing] = useAction(() => call('accounts.releaseControl', { accountId: account.id }))
  const [look, looking] = useAction(async () => setPageReport({ report: await call('accounts.pageReport', { accountId: account.id }) }))
  const error = opening.error ?? checking.error ?? signingIn.error ?? signingUp.error ?? copying.error ?? showing.error ?? finishing.error ?? looking.error
  // While the person holds the browser the app waits, so nothing that needs the browser is offered: the screen says what to do instead.
  const yours = browser.data?.holder === 'user'
  const windowOpen = browser.data?.windowOpen === true
  const ready = account.status === 'ready'

  const summary = (
    <>
      <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>{' '}
      <span data-testid={`account-identity-${account.id}`} className="muted">
        {account.identity ? `Signed in as ${account.identity}` : ready ? 'The site does not show the account name, so the app cannot read it.' : 'The account name on the platform is not confirmed yet.'}
      </span>
    </>
  )

  return (
    <AccountBlock step={4} title="Sign-in" summary={summary} testId={`signin-${account.id}`}>
      {yours ? (
        <>
          <div className="note warn" role="status" data-testid={`browser-state-${account.id}`}>
            {windowOpen
              ? 'The browser window of this account is open and you are working in it, so the app waits. When you are done, press “Done, close this window” in that window (or close it): the app then checks the sign-in by itself.'
              : 'You took over this account’s browser, so the app does not use it. Give it back when you are done.'}
          </div>
          <div className="row">
            {windowOpen && (
              <Button variant="primary" onClick={() => void show()} disabled={showing.busy} data-testid={`browser-show-${account.id}`}>
                Show the window
              </Button>
            )}
            {windowOpen && (
              <Button onClick={() => void look()} disabled={looking.busy} data-testid={`page-report-${account.id}`}>
                {looking.busy ? 'Looking…' : 'What does the page show?'}
              </Button>
            )}
            <Button onClick={() => void done()} disabled={finishing.busy} data-testid={`browser-done-${account.id}`}>
              {windowOpen ? 'Done, close the window' : 'Give control back'}
            </Button>
          </div>
          {pageReport && <PageReportView report={pageReport.report} testId={`page-report-view-${account.id}`} />}
        </>
      ) : (
        <div className="row">
          {hasPassword && (
            <Button variant={ready ? 'ghost' : 'primary'} onClick={() => void signIn()} disabled={signingIn.busy} data-testid={`password-signin-${account.id}`}>
              {signingIn.busy ? 'Signing in…' : 'Sign in with saved password'}
            </Button>
          )}
          <Button variant={ready || hasPassword ? 'ghost' : 'primary'} onClick={() => void open()} disabled={opening.busy} data-testid={`account-open-${account.id}`}>
            Open browser to sign in
          </Button>
          <Button onClick={() => void check()} disabled={checking.busy} data-testid={`account-check-${account.id}`}>
            {checking.busy ? 'Checking…' : 'Check sign-in'}
          </Button>
          {info?.signupUrl && !ready && (
            <Button onClick={() => void signUp()} disabled={signingUp.busy} data-testid={`signup-open-${account.id}`}>
              {signingUp.busy ? 'Opening…' : `Create account on ${info.label}`}
            </Button>
          )}
        </div>
      )}
      <p className="muted small">A CAPTCHA, a code or any other check on the site is always yours: the app stops and tells you.</p>
      {!ready && info && (info.signupUrl || info.signupNote) && (
        <div className="stack" data-testid={`signup-help-${account.id}`}>
          <strong className="small">No account on {info.label} yet?</strong>
          {info.signupUrl ? (
            <ol className="plain-lines" data-testid={`signup-steps-${account.id}`}>
              <li>Press “Create account on {info.label}”: its registration page opens in this account’s own window.</li>
              <li>
                {account.email ? (
                  <>
                    Use the address <strong>{account.email}</strong> <CopyButton text={account.email} testId={`signup-copy-email-${account.id}`} />
                  </>
                ) : (
                  'Give the account an e-mail address first (step 2), then use it on the site.'
                )}
              </li>
              <li>
                {hasPassword && vaultAvailable ? (
                  <>
                    Use the saved password{' '}
                    <Button onClick={() => void copyPassword()} disabled={copying.busy} data-testid={`signup-copy-password-${account.id}`}>
                      Copy password
                    </Button>{' '}
                    <span className="muted small">(it leaves the clipboard in 30 seconds)</span>
                  </>
                ) : vaultAvailable ? (
                  'Save a password first (step 3), then use it on the site.'
                ) : (
                  'Choose a password yourself and keep it somewhere safe.'
                )}
              </li>
              <li>Pass the site’s checks yourself (a CAPTCHA, a code sent to the e-mail). When you are in, press “Done, close this window” in that window: the app then checks the sign-in by itself.</li>
            </ol>
          ) : (
            <p className="muted small" data-testid={`signup-note-${account.id}`}>
              {info.signupNote}
            </p>
          )}
        </div>
      )}
      {signedIn && (
        <div className={`note ${signedIn.outcome === 'signed_in' ? 'good' : 'warn'}`} role="status" data-testid={`password-signin-result-${account.id}`}>
          {signedIn.detail}
        </div>
      )}
      <ErrorNote error={error} />
    </AccountBlock>
  )
}
