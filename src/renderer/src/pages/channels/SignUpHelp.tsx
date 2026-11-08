import { useState } from 'react'
import type { Account, PlatformInfo } from '../../../../shared/types'
import { generatePassword } from '../../../../shared/password'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote } from '../../ui'
import { CopyButton } from './CopyButton'

/**
 * "Create account on the platform" (DEC-015): opens the platform's registration page in the account's own browser and puts the
 * address and a password within reach. The app fills in nothing and submits nothing; every check on the site is the owner's.
 */
export function SignUpHelp({ account, info, vaultAvailable, hasPassword }: { account: Account; info: PlatformInfo; vaultAvailable: boolean; hasPassword: boolean }) {
  const [opened, setOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const [open, opening] = useAction(async () => {
    await call('accounts.openBrowser', { accountId: account.id, url: info.signupUrl })
    setOpened(true)
  })
  const [makePassword, making] = useAction(async () => {
    await call('vault.savePassword', { accountId: account.id, loginName: account.email ?? account.loginName ?? '', password: generatePassword() })
  })
  const [copy, copying] = useAction(async () => {
    await call('vault.copyPassword', { accountId: account.id })
    setCopied(true)
    setTimeout(() => setCopied(false), 30_000)
  })
  const error = opening.error ?? making.error ?? copying.error
  const loginName = account.email ?? account.loginName ?? ''

  return (
    <div className="password-box" data-testid={`signup-${account.id}`}>
      <div className="password-head">
        <strong>New account on {info.label}</strong>
        <span className="muted small">The app opens the registration page; you fill it in and pass the site’s checks.</span>
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => void open()} disabled={opening.busy} data-testid={`signup-open-${account.id}`}>
          {opening.busy ? 'Opening…' : `Create account on ${info.label}`}
        </Button>
      </div>
      {opened && (
        <ol className="plain-lines" data-testid={`signup-steps-${account.id}`}>
          <li>
            The registration page is open in this account’s window.{' '}
            {account.email ? (
              <>
                Use the address <strong>{account.email}</strong> <CopyButton text={account.email} testId={`signup-copy-email-${account.id}`} />
              </>
            ) : (
              'Give the account an e-mail address first (above), then use it on the site.'
            )}
          </li>
          <li>
            Password:{' '}
            {!vaultAvailable ? (
              'this Mac has no usable keychain, so choose a password yourself and keep it somewhere safe.'
            ) : hasPassword ? (
              <>
                a password is saved for this account.{' '}
                <Button onClick={() => void copy()} disabled={copying.busy} data-testid={`signup-copy-password-${account.id}`}>
                  Copy password
                </Button>{' '}
                {copied && <span className="muted small">Copied. It leaves the clipboard in 30 seconds.</span>}
              </>
            ) : (
              <>
                <Button onClick={() => void makePassword()} disabled={making.busy || loginName === ''} data-testid={`signup-password-${account.id}`}>
                  Generate and save a strong password
                </Button>{' '}
                <span className="muted small">{loginName === '' ? 'Needs the e-mail address first.' : 'Stored encrypted by the macOS keychain; then copy it into the form.'}</span>
              </>
            )}
          </li>
          <li>Pass the checks (a code, a CAPTCHA, a phone number) yourself. When you are in, press “Give control back to the app”, then “Check sign-in”.</li>
        </ol>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
