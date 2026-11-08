import { useState, type FormEvent } from 'react'
import type { Account, SignInResult } from '../../../../shared/types'
import { generatePassword } from '../../../../shared/password'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'

/**
 * The saved password of one account (REQ-012, DEC-014). The password lives in the system keychain's vault, never in the
 * database; this screen only ever holds it while the owner types, generates or asks to see it.
 */
export function AccountPassword({ account, vaultAvailable, hasPassword }: { account: Account; vaultAvailable: boolean; hasPassword: boolean }) {
  const [editing, setEditing] = useState(false)
  const [loginName, setLoginName] = useState(account.loginName ?? '')
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [signedIn, setSignedIn] = useState<SignInResult | null>(null)

  const [save, saving] = useAction(async () => {
    await call('vault.savePassword', { accountId: account.id, loginName: loginName.trim(), password })
    setPassword('')
    setEditing(false)
    setRevealed(null)
    setSignedIn(null)
  })
  const [remove, removing] = useAction(async () => {
    await call('vault.removePassword', { accountId: account.id })
    setConfirmRemove(false)
    setRevealed(null)
    setSignedIn(null)
  })
  const [reveal, revealing] = useAction(async () => setRevealed((await call('vault.revealPassword', { accountId: account.id })).password))
  const [copy, copying] = useAction(async () => {
    await call('vault.copyPassword', { accountId: account.id })
    setCopied(true)
    setTimeout(() => setCopied(false), 30_000)
  })
  const [signIn, signingIn] = useAction(async () => {
    setSignedIn(null)
    setSignedIn(await call('accounts.signIn', { accountId: account.id }))
  })
  const error = saving.error ?? removing.error ?? revealing.error ?? copying.error ?? signingIn.error

  if (!vaultAvailable) {
    return (
      <div className="note warn" data-testid={`vault-unavailable-${account.id}`}>
        This Mac has no usable system keychain, so the app cannot keep passwords safely and stores none. Sign in on the site itself.
      </div>
    )
  }

  const showForm = editing
  function submit(event: FormEvent): void {
    event.preventDefault()
    if (loginName.trim() !== '' && password !== '') void save()
  }

  return (
    <div className="password-box" data-testid={`password-${account.id}`}>
      <div className="password-head">
        <strong>Password</strong>
        {hasPassword ? (
          <span className="muted small" data-testid={`password-state-${account.id}`}>
            Saved in the keychain vault · login name <strong>{account.loginName}</strong>
          </span>
        ) : (
          <span className="muted small" data-testid={`password-state-${account.id}`}>
            Not saved. The app can sign this account in by itself once you save it.
          </span>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="stack" data-testid={`password-form-${account.id}`}>
          <div className="form-row">
            <Field label="Login name or e-mail" hint="What you type in the sign-in form.">
              <input className="input" value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="off" data-testid={`password-login-${account.id}`} />
            </Field>
            <Field label="Password" hint="Stored encrypted by the macOS keychain, only on this Mac.">
              <input
                className="input"
                type={revealed !== null ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                data-testid={`password-value-${account.id}`}
              />
            </Field>
          </div>
          <div className="row">
            <Button
              onClick={() => {
                setPassword(generatePassword())
                setRevealed('')
              }}
              data-testid={`password-generate-${account.id}`}
            >
              Generate a strong password
            </Button>
            <span className="muted small">The generated password is shown here until you save it. Use the same one when you create the account on the site.</span>
          </div>
          <div className="row">
            <Button variant="primary" type="submit" disabled={saving.busy || loginName.trim() === '' || password === ''} data-testid={`password-save-${account.id}`}>
              {saving.busy ? 'Saving…' : 'Save password'}
            </Button>
            <Button
              onClick={() => {
                setEditing(false)
                setPassword('')
                setRevealed(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!showForm && (
        <div className="row">
          {hasPassword && (
            <Button variant="primary" onClick={() => void signIn()} disabled={signingIn.busy} data-testid={`password-signin-${account.id}`}>
              {signingIn.busy ? 'Signing in…' : 'Sign in with saved password'}
            </Button>
          )}
          {hasPassword && (
            <>
              <Button onClick={() => (revealed === null ? void reveal() : setRevealed(null))} disabled={revealing.busy} data-testid={`password-show-${account.id}`}>
                {revealed === null ? 'Show' : 'Hide'}
              </Button>
              <Button onClick={() => void copy()} disabled={copying.busy} data-testid={`password-copy-${account.id}`}>
                Copy
              </Button>
            </>
          )}
          <Button
            onClick={() => {
              setLoginName(account.loginName ?? '')
              setEditing(true)
            }}
            data-testid={`password-edit-${account.id}`}
          >
            {hasPassword ? 'Change' : 'Save a password'}
          </Button>
          <span className="sep" />
          {hasPassword &&
            (confirmRemove ? (
              <>
                <span className="muted small">Forgets the password; the account stays.</span>
                <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`password-remove-confirm-${account.id}`}>
                  Remove
                </Button>
                <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmRemove(true)} data-testid={`password-remove-${account.id}`}>
                Remove password
              </Button>
            ))}
        </div>
      )}

      {!showForm && revealed !== null && revealed !== '' && (
        <div className="secret-value" data-testid={`password-revealed-${account.id}`}>
          {revealed}
        </div>
      )}
      {copied && (
        <div className="note good" role="status" data-testid={`password-copied-${account.id}`}>
          Copied. It leaves the clipboard in 30 seconds.
        </div>
      )}
      {signedIn && (
        <div className={`note ${signedIn.outcome === 'signed_in' ? 'good' : 'warn'}`} role="status" data-testid={`password-signin-result-${account.id}`}>
          {signedIn.detail}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
