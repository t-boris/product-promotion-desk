import { useState, type FormEvent } from 'react'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { PLATFORM_OPTIONS } from './model'

/** Creates an account record and its own persistent browser. Nothing is entered here but a name. */
export function CreateAccount({ onCreated }: { onCreated: () => void }) {
  const [platform, setPlatform] = useState(PLATFORM_OPTIONS[0].id)
  const [label, setLabel] = useState('')
  const [create, state] = useAction((args: { platform: string; label: string }) => call('accounts.create', args))

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!label.trim()) return
    const account = await create({ platform, label: label.trim() })
    if (account) {
      setLabel('')
      onCreated()
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-testid="create-account-form">
      <div className="row">
        <Field label="Platform">
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="account-platform">
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name for this account" hint="Only for you, e.g. the brand account.">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Natal Mystic on Reddit" data-testid="account-label" />
        </Field>
        <Button variant="primary" type="submit" disabled={!label.trim() || state.busy} data-testid="account-create">
          {state.busy ? 'Adding…' : 'Add account'}
        </Button>
      </div>
      <ErrorNote error={state.error} />
    </form>
  )
}
