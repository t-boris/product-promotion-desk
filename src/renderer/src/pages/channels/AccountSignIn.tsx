import { useState } from 'react'
import type { Account, PlatformInfo, SignInResult } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { CopyButton } from './CopyButton'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from './model'

/**
 * Signing in (REQ-012, DEC-014, DEC-015): create the account on the platform if it does not exist yet, sign in in the account's own
 * browser or with the saved password, and check the result. The app fills in nothing on a registration page; every check on a
 * site (a CAPTCHA, a code, a phone number) is the owner's.
 */
export function AccountSignIn({ account, info, vaultAvailable, hasPassword }: { account: Account; info: PlatformInfo | undefined; vaultAvailable: boolean; hasPassword: boolean }) {
  const [signedIn, setSignedIn] = useState<SignInResult | null>(null)
  const [opened, setOpened] = useState(false)
  const [open, opening] = useAction(() => call('accounts.openBrowser', { accountId: account.id }))
  const [check, checking] = useAction(() => call('accounts.checkLogin', { accountId: account.id }))
  const [signIn, signingIn] = useAction(async () => {
    setSignedIn(null)
    setSignedIn(await call('accounts.signIn', { accountId: account.id }))
  })
  const [signUp, signingUp] = useAction(async () => {
    await call('accounts.openBrowser', { accountId: account.id, url: info?.signupUrl })
    setOpened(true)
  })
  const [copyPassword, copying] = useAction(() => call('vault.copyPassword', { accountId: account.id }))
  const error = opening.error ?? checking.error ?? signingIn.error ?? signingUp.error ?? copying.error
  const ready = account.status === 'ready'

  const summary = (
    <>
      <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>{' '}
      <span data-testid={`account-identity-${account.id}`} className="muted">
        {account.identity ? `Signed in as ${account.identity}` : 'The account name on the platform is not confirmed yet.'}
      </span>
    </>
  )

  return (
    <AccountBlock step={4} title="Sign-in" summary={summary} testId={`signin-${account.id}`}>
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
      <p className="muted small">A CAPTCHA, a code or any other check on the site is always yours: the app stops and tells you.</p>
      {opened && (
        <ol className="plain-lines" data-testid={`signup-steps-${account.id}`}>
          <li>
            The registration page is open in this account’s window.{' '}
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
          <li>Pass the site’s checks yourself. When you are in, press “Give control back to the app” (under More), then “Check sign-in”.</li>
        </ol>
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
