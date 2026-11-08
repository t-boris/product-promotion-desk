import { useState, type FormEvent } from 'react'
import type { Account } from '../../../../shared/types'
import { generatePassword } from '../../../../shared/password'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { AccountBlock } from './AccountBlock'

/**
 * The saved password of one account (REQ-012, DEC-014). The password lives in the system keychain's vault, never in the
 * database; this block only ever holds it while the owner types, generates or asks to see it.
 */
export function AccountPassword({ account, vaultAvailable, hasPassword }: { account: Account; vaultAvailable: boolean; hasPassword: boolean }) {
  const [editing, setEditing] = useState(false)
  const [loginName, setLoginName] = useState(account.loginName ?? account.email ?? '')
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const [save, saving] = useAction(async () => {
    await call('vault.savePassword', { accountId: account.id, loginName: loginName.trim(), password })
    setPassword('')
    setEditing(false)
    setRevealed(null)
  })
  const [remove, removing] = useAction(async () => {
    await call('vault.removePassword', { accountId: account.id })
    setConfirmRemove(false)
    setEditing(false)
    setRevealed(null)
  })
  const [reveal, revealing] = useAction(async () => setRevealed((await call('vault.revealPassword', { accountId: account.id })).password))
  const [copy, copying] = useAction(async () => {
    await call('vault.copyPassword', { accountId: account.id })
    setCopied(true)
    setTimeout(() => setCopied(false), 30_000)
  })
  const error = saving.error ?? removing.error ?? revealing.error ?? copying.error

  if (!vaultAvailable) {
    return (
      <AccountBlock
        step={3}
        title="Password"
        testId={`vault-unavailable-${account.id}`}
        summary={<span className="muted">This Mac has no usable system keychain, so the app cannot keep passwords safely and stores none. Sign in on the site itself.</span>}
      />
    )
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (loginName.trim() !== '' && password !== '') void save()
  }

  const summary = hasPassword ? (
    <span data-testid={`password-state-${account.id}`}>
      Saved in the keychain vault · login name <strong>{account.loginName}</strong>
    </span>
  ) : (
    <span className="muted" data-testid={`password-state-${account.id}`}>
      Not saved yet. With a saved password the app can sign this account in by itself.
    </span>
  )

  return (
    <AccountBlock
      step={3}
      title="Password"
      summary={summary}
      testId={`password-${account.id}`}
      actions={
        !editing &&
        (hasPassword ? (
          <>
            <Button onClick={() => (revealed === null ? void reveal() : setRevealed(null))} disabled={revealing.busy} data-testid={`password-show-${account.id}`}>
              {revealed === null ? 'Show' : 'Hide'}
            </Button>
            <Button onClick={() => void copy()} disabled={copying.busy} data-testid={`password-copy-${account.id}`}>
              Copy
            </Button>
            <Button
              onClick={() => {
                setLoginName(account.loginName ?? account.email ?? '')
                setEditing(true)
              }}
              data-testid={`password-edit-${account.id}`}
            >
              Change
            </Button>
          </>
        ) : (
          <Button
            onClick={() => {
              setLoginName(account.loginName ?? account.email ?? '')
              setEditing(true)
            }}
            data-testid={`password-edit-${account.id}`}
          >
            Save a password
          </Button>
        ))
      }
    >
      {editing && (
        <form onSubmit={submit} className="stack" data-testid={`password-form-${account.id}`}>
          <div className="form-row">
            <Field label="Login name or e-mail" hint="What you type in the sign-in form.">
              <input className="input" value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="off" data-testid={`password-login-${account.id}`} />
            </Field>
            <Field label="Password" hint="Stored encrypted by the macOS keychain, only on this Mac.">
              <input
                className="input"
                type={password !== '' && revealed === '' ? 'text' : 'password'}
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
            <span className="muted small">It is shown here until you save it. Use the same one when you create the account on the site.</span>
          </div>
          <div className="row">
            <Button variant="primary" type="submit" disabled={saving.busy || loginName.trim() === '' || password === ''} data-testid={`password-save-${account.id}`}>
              {saving.busy ? 'Saving…' : 'Save password'}
            </Button>
            {hasPassword &&
              (confirmRemove ? (
                <>
                  <span className="muted small">Forgets the password; the account stays.</span>
                  <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`password-remove-confirm-${account.id}`}>
                    Remove password
                  </Button>
                </>
              ) : (
                <Button onClick={() => setConfirmRemove(true)} data-testid={`password-remove-${account.id}`}>
                  Remove password
                </Button>
              ))}
            <Button
              onClick={() => {
                setEditing(false)
                setPassword('')
                setRevealed(null)
                setConfirmRemove(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!editing && revealed !== null && revealed !== '' && (
        <div className="secret-value" data-testid={`password-revealed-${account.id}`}>
          {revealed}
        </div>
      )}
      {copied && (
        <div className="note good" role="status" data-testid={`password-copied-${account.id}`}>
          Copied. It leaves the clipboard in 30 seconds.
        </div>
      )}
      <ErrorNote error={error} />
    </AccountBlock>
  )
}
