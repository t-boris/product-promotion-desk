import { useEffect, useState, type FormEvent } from 'react'
import type { AccountRole, PlatformInfo, RoleSuggestion } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { ROLE_NAME_LIMIT, ROLE_VOICE_LIMIT } from './RoleEditor'

/** What "Use this role" asks to fill in; a new object each time, so choosing the same idea twice fills the form again. */
export interface RolePrefill {
  suggestion: RoleSuggestion
}

/** Creates a login for this product with its own persistent browser. Nothing is entered here but a name and, if wanted, a role. */
export function CreateAccount({ productId, platforms, prefill }: { productId: string; platforms: PlatformInfo[]; prefill: RolePrefill | null }) {
  const [chosen, setChosen] = useState('')
  const [label, setLabel] = useState('')
  const [roleName, setRoleName] = useState('')
  const [roleVoice, setRoleVoice] = useState('')
  const [create, state] = useAction((args: { productId: string; platform: string; label: string; role?: AccountRole }) => call('accounts.create', args))
  const platform = chosen || platforms[0]?.platform || ''
  const roleIncomplete = roleName.trim() === '' && roleVoice.trim() !== ''

  // "Use this role": fill in the role and, if the name is still empty, a name for the account. Nothing is created.
  useEffect(() => {
    if (!prefill) return
    setRoleName(prefill.suggestion.name)
    setRoleVoice(prefill.suggestion.voice)
    setLabel((current) => current || `${prefill.suggestion.name} login`)
  }, [prefill])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!label.trim() || !platform || roleIncomplete) return
    const role = roleName.trim() ? { name: roleName.trim(), voice: roleVoice.trim() } : undefined
    const account = await create({ productId, platform, label: label.trim(), ...(role ? { role } : {}) })
    if (account) {
      setLabel('')
      setRoleName('')
      setRoleVoice('')
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-testid="create-account-form">
      <div className="form-row">
        <Field label="Platform" hint={platforms.find((p) => p.platform === platform)?.note}>
          <select className="input" value={platform} onChange={(e) => setChosen(e.target.value)} disabled={platforms.length === 0} data-testid="account-platform">
            {platforms.map((p) => (
              <option key={p.connectorId} value={p.platform}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name for this account" hint="Only for you, e.g. the brand account.">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Brand account" data-testid="account-label" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Role (optional)" hint="For example astrologer or developer.">
          <input className="input" value={roleName} maxLength={ROLE_NAME_LIMIT} onChange={(e) => setRoleName(e.target.value)} data-testid="account-role-name" />
        </Field>
        <Field label="Voice (optional)" hint={`How this login writes and what it may talk about. Up to ${ROLE_VOICE_LIMIT} characters.`}>
          <textarea className="input short" value={roleVoice} maxLength={ROLE_VOICE_LIMIT} onChange={(e) => setRoleVoice(e.target.value)} data-testid="account-role-voice" />
        </Field>
      </div>
      {roleIncomplete && <p className="muted small">Give the role a name, or clear the voice.</p>}
      <Button variant="primary" type="submit" disabled={!label.trim() || !platform || roleIncomplete || state.busy} data-testid="account-create">
        {state.busy ? 'Adding…' : 'Add account'}
      </Button>
      <p className="muted small" data-testid="account-create-note">
        You create the real login on the platform yourself: the app does not register accounts for you. Once it exists, save its password under the account so the app can sign it in.
      </p>
      <ErrorNote error={state.error} />
    </form>
  )
}
