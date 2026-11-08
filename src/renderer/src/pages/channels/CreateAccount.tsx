import { useState, type FormEvent } from 'react'
import type { Account, AccountRole, Mailbox, PlatformInfo } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { ROLE_NAME_LIMIT, ROLE_VOICE_LIMIT } from './RoleEditor'

/**
 * Adds an account to the library (DEC-015): a platform, a name for the owner, and optionally an e-mail address and a role.
 * The account belongs to no product. Nothing is registered anywhere: the account gets its own empty browser.
 */
export function CreateAccount({
  platforms,
  mailboxes,
  role,
  onCreated,
  onCancel
}: {
  platforms: PlatformInfo[]
  mailboxes: Mailbox[]
  /** A role to start from ("Use this role" on the product page). */
  role: AccountRole | null
  onCreated: (account: Account) => void
  /** Absent while there is no account yet: the form is then the only thing to do. */
  onCancel?: () => void
}) {
  const [chosen, setChosen] = useState('')
  const [label, setLabel] = useState(role ? `${role.name} account` : '')
  const [roleName, setRoleName] = useState(role?.name ?? '')
  const [roleVoice, setRoleVoice] = useState(role?.voice ?? '')
  const [email, setEmail] = useState('')
  const [chosenMailbox, setChosenMailbox] = useState('')
  const [fromMailbox, setFromMailbox] = useState<string | null>(null)
  const [create, state] = useAction((args: { platform: string; label: string; role?: AccountRole; email?: string; mailboxId?: string }) => call('accounts.create', args))
  const mailboxId = mailboxes.some((m) => m.id === chosenMailbox) ? chosenMailbox : (mailboxes[0]?.id ?? '')
  const [propose, proposing] = useAction(async (platformKey: string) => {
    const result = await call('accounts.proposeEmail', { mailboxId, platform: platformKey })
    setEmail(result.address)
    setFromMailbox(mailboxId)
  })
  const platform = chosen || platforms[0]?.platform || ''
  const roleIncomplete = roleName.trim() === '' && roleVoice.trim() !== ''

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!label.trim() || !platform || roleIncomplete) return
    const wanted = roleName.trim() ? { name: roleName.trim(), voice: roleVoice.trim() } : undefined
    const account = await create({
      platform,
      label: label.trim(),
      ...(wanted ? { role: wanted } : {}),
      ...(email.trim() ? { email: email.trim(), ...(fromMailbox ? { mailboxId: fromMailbox } : {}) } : {})
    })
    if (account) onCreated(account)
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
        <Field label="E-mail address (optional)" hint={mailboxes.length > 0 ? 'What the account signs up with. You can also set it later.' : 'What the account signs up with. To get proposed addresses, add your own mailbox on the “Mailboxes” tab.'}>
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
          <Field label="Or propose one from your mailbox" hint="A separate address for this account, made from the mailbox.">
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
        <Field label="Voice (optional)" hint={`How this account writes and what it may talk about. Up to ${ROLE_VOICE_LIMIT} characters.`}>
          <textarea className="input short" value={roleVoice} maxLength={ROLE_VOICE_LIMIT} onChange={(e) => setRoleVoice(e.target.value)} data-testid="account-role-voice" />
        </Field>
      </div>
      {roleIncomplete && <p className="muted small">Give the role a name, or clear the voice.</p>}
      <div className="row">
        <Button variant="primary" type="submit" disabled={!label.trim() || !platform || roleIncomplete || state.busy} data-testid="account-create">
          {state.busy ? 'Adding…' : 'Add account'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
      <p className="muted small" data-testid="account-create-note">
        After adding it you are told what to do next: set the address and the password, then create the account on the platform or sign in.
      </p>
      <ErrorNote error={state.error ?? proposing.error} />
    </form>
  )
}
