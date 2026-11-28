import { useState, type FormEvent } from 'react'
import { keyNameOf, type Account, type PlatformInfo, type VaultUnavailable } from '../../../../shared/types'
import { vaultUnavailableText } from '../../../../shared/vault-message'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field, useMainVariant, useOpenForm } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { GuideSteps } from './ConnectionGuide'

/**
 * The key of an account that works through its platform's API (a Telegram bot's token, DEC-055): what the owner does on the platform's side,
 * and the one field the key is pasted into. The key goes to the keychain's vault and is never shown again; saving it checks it at once.
 */
export function AccountApiKey({ account, api, unavailable, hasKey, endsAt }: { account: Account; api: NonNullable<PlatformInfo['api']>; unavailable: VaultUnavailable | null; hasKey: boolean; endsAt?: string | null }) {
  const [editing, setEditing] = useState(!hasKey)
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [keyId, setKeyId] = useState('')
  const saveVariant = useOpenForm(editing)
  const main = useMainVariant()
  const [save, saving] = useAction(async () => {
    await call('vault.saveApiKey', { accountId: account.id, key, ...(api.onceSecret && secret.trim() !== '' ? { secret } : {}), ...(api.keyId ? { keyId } : {}) })
    setKeyId('')
    setKey('')
    setSecret('')
    setEditing(false)
  })
  const [check, checking] = useAction(() => call('accounts.checkLogin', { accountId: account.id }))
  const name = keyNameOf(api)

  if (unavailable) {
    return <AccountBlock step={1} title={api.keyLabel} testId={`vault-unavailable-${account.id}`} summary={<span className="muted">{vaultUnavailableText(unavailable)}</span>} />
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (key.trim() !== '' && (!api.keyId || keyId.trim() !== '')) void save()
  }

  const summary = hasKey ? (
    <span data-testid={`api-key-state-${account.id}`}>
      Saved in the keychain vault{account.status === 'ready' && account.identity ? (
        <>
          {' '}
          · connected as <strong>{account.identity}</strong>
          {api.renews && <span data-testid={`api-key-renews-${account.id}`}> · the application renews it by itself before it ends</span>}
          {!api.renews && api.keyDays !== undefined && endsAt && (
            <span data-testid={`api-key-ends-${account.id}`}>
              {' '}
              · it lasts until about {endsAt.slice(0, 10)} ({api.keyDays} days from the day it was saved) and is not renewed: make a new one before then
            </span>
          )}
        </>
      ) : (
        ` · the platform does not accept it now: save a new ${name}, or check again`
      )}
    </span>
  ) : (
    <span className="muted" data-testid={`api-key-state-${account.id}`}>
      Not saved yet. {api.work ?? `The app posts, reads comments and answers through this ${api.accountKind}, with no browser.`}
    </span>
  )

  return (
    <AccountBlock
      step={1}
      title={api.keyLabel}
      summary={summary}
      testId={`api-key-${account.id}`}
      actions={
        !editing && (
          <>
            <Button onClick={() => void check()} disabled={checking.busy} data-testid={`api-key-check-${account.id}`}>
              {checking.busy ? 'Checking…' : 'Check again'}
            </Button>
            <Button variant={account.status === 'ready' ? 'ghost' : main} onClick={() => setEditing(true)} data-testid={`api-key-edit-${account.id}`}>
              Change
            </Button>
          </>
        )
      }
    >
      {editing && (
        <form onSubmit={submit} className="stack" data-testid={`api-key-form-${account.id}`}>
          <GuideSteps account={account} steps={api.steps} testId={`api-key-steps-${account.id}`} />
          {api.keyId && (
            <Field label={api.keyId.label} hint={api.keyId.hint}>
              <input className="input" value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} data-testid={`api-key-id-${account.id}`} />
            </Field>
          )}
          <Field label={api.keyLabel} hint="Stored encrypted by the macOS keychain, only on this Mac. It is checked with the platform when you save it.">
            <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} data-testid={`api-key-input-${account.id}`} />
          </Field>
          {api.onceSecret && (
            <Field label={`${api.onceSecret.label} (optional)`} hint={api.onceSecret.hint}>
              <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} data-testid={`api-key-secret-${account.id}`} />
            </Field>
          )}
          <div className="row">
            <Button variant={saveVariant} type="submit" disabled={key.trim() === '' || (api.keyId !== undefined && keyId.trim() === '') || saving.busy} data-testid={`api-key-save-${account.id}`}>
              {saving.busy ? 'Saving…' : `Save the ${name}`}
            </Button>
            {hasKey && <Button onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </form>
      )}
      <ErrorNote error={saving.error ?? checking.error} />
    </AccountBlock>
  )
}
