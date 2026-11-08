import { useState } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote, Field } from '../../ui'

export const ROLE_NAME_LIMIT = 40
export const ROLE_VOICE_LIMIT = 280

/**
 * The role of a login (DEC-010): a short name and a voice. Drafts for the channels of this login are written in that voice.
 * Without a role the login uses the channel's reply style. Setting, changing and removing a role changes nothing on any platform.
 */
export function RoleEditor({ account }: { account: Account }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.role?.name ?? '')
  const [voice, setVoice] = useState(account.role?.voice ?? '')
  const [save, saving] = useAction((role: { name: string; voice: string } | null) => call('accounts.setRole', { accountId: account.id, role }))

  function open(): void {
    setName(account.role?.name ?? '')
    setVoice(account.role?.voice ?? '')
    setEditing(true)
  }

  async function submit(role: { name: string; voice: string } | null): Promise<void> {
    if (await save(role)) setEditing(false)
  }

  return (
    <div className="role-editor" data-testid={`account-role-${account.id}`}>
      {account.role ? (
        <div>
          <Badge tone="info">Role: {account.role.name}</Badge> <span className="small">{account.role.voice || 'No voice written yet.'}</span>
        </div>
      ) : (
        <div className="muted small">No role. Drafts for this login use the channel’s reply style.</div>
      )}
      {editing ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) void submit({ name: name.trim(), voice: voice.trim() })
          }}
          data-testid={`account-role-form-${account.id}`}
        >
          <Field label="Role name" hint="For example astrologer or developer.">
            <input className="input" value={name} maxLength={ROLE_NAME_LIMIT} onChange={(e) => setName(e.target.value)} data-testid={`account-role-name-${account.id}`} />
          </Field>
          <Field label="Voice" hint={`How this login writes and what it may talk about. Up to ${ROLE_VOICE_LIMIT} characters.`}>
            <textarea className="input short" value={voice} maxLength={ROLE_VOICE_LIMIT} onChange={(e) => setVoice(e.target.value)} data-testid={`account-role-voice-${account.id}`} />
          </Field>
          <div className="row">
            <Button variant="primary" type="submit" disabled={!name.trim() || saving.busy} data-testid={`account-role-save-${account.id}`}>
              {saving.busy ? 'Saving…' : 'Save role'}
            </Button>
            {account.role && (
              <Button onClick={() => void submit(null)} disabled={saving.busy} data-testid={`account-role-remove-${account.id}`}>
                Remove role
              </Button>
            )}
            <Button onClick={() => setEditing(false)} disabled={saving.busy}>
              Cancel
            </Button>
          </div>
          <ErrorNote error={saving.error} />
        </form>
      ) : (
        <div className="row">
          <Button onClick={open} data-testid={`account-role-edit-${account.id}`}>
            {account.role ? 'Edit role' : 'Add a role'}
          </Button>
        </div>
      )}
    </div>
  )
}
