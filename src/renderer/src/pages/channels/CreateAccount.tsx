import { useEffect, useState, type FormEvent } from 'react'
import type { AccountRole, Mailbox, PlatformInfo, RoleSuggestion } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { ROLE_NAME_LIMIT, ROLE_VOICE_LIMIT } from './RoleEditor'

/** What "Use this role" asks to fill in; a new object each time, so choosing the same idea twice fills the form again. */
export interface RolePrefill {
  suggestion: RoleSuggestion
}

/**
 * Creates an account with its own persistent browser (DEC-015). It belongs to no product: any product's channel can use it.
 * `productId` only records what it was made for. Nothing is entered here but a name and, if wanted, a role and an address.
 */
export function CreateAccount({ productId, platforms, mailboxes, prefill }: { productId?: string; platforms: PlatformInfo[]; mailboxes: Mailbox[]; prefill: RolePrefill | null }) {
  const [chosen, setChosen] = useState('')
  const [label, setLabel] = useState('')
  const [roleName, setRoleName] = useState('')
  const [roleVoice, setRoleVoice] = useState('')
  const [email, setEmail] = useState('')
  const [chosenMailbox, setChosenMailbox] = useState('')
  const [fromMailbox, setFromMailbox] = useState<string | null>(null)
  const [create, state] = useAction((args: { productId?: string; platform: string; label: string; role?: AccountRole; email?: string; mailboxId?: string }) => call('accounts.create', args))
  const mailboxId = chosenMailbox || mailboxes[0]?.id || ''
  const [propose, proposing] = useAction(async (platformKey: string) => {
    const result = await call('accounts.proposeEmail', { mailboxId, platform: platformKey })
    setEmail(result.address)
    setFromMailbox(mailboxId)
  })
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
    const account = await create({ ...(productId ? { productId } : {}), platform, label: label.trim(), ...(role ? { role } : {}), ...(email.trim() ? { email: email.trim(), ...(fromMailbox ? { mailboxId: fromMailbox } : {}) } : {}) })
    if (account) {
      setLabel('')
      setRoleName('')
      setRoleVoice('')
      setEmail('')
      setFromMailbox(null)
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
        <Field label="E-mail address (optional)" hint="What the account signs up with. You can also set it later.">
          <input
            className="input"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setFromMailbox(null)
            }}
            autoComplete="off"
            data-testid="account-email"
          />
        </Field>
        {mailboxes.length > 0 && (
          <Field label="Or an address from your base mailbox" hint="A separate address for this account, made from the mailbox.">
            <div className="pick-row">
              <select className="input" value={mailboxId} onChange={(e) => setChosenMailbox(e.target.value)} aria-label="Base mailbox" data-testid="account-mailbox">
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </select>
              <Button onClick={() => void propose(platform)} disabled={proposing.busy || platform === ''} data-testid="account-propose-email">
                Propose
              </Button>
            </div>
          </Field>
        )}
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
        This adds the account to your library. If it does not exist on the platform yet, press “Create account on …” on it afterwards: the app opens the registration page and keeps the address and password at hand, and you pass the site’s checks yourself. If it exists already, sign in once and save its password so the app can sign it in.
      </p>
      <ErrorNote error={state.error ?? proposing.error} />
    </form>
  )
}
