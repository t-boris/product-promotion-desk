import { useState, type FormEvent } from 'react'
import type { PlatformInfo } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'

/** Creates a login for this product with its own persistent browser. Nothing is entered here but a name. */
export function CreateAccount({ productId, platforms }: { productId: string; platforms: PlatformInfo[] }) {
  const [chosen, setChosen] = useState('')
  const [label, setLabel] = useState('')
  const [create, state] = useAction((args: { productId: string; platform: string; label: string }) => call('accounts.create', args))
  const platform = chosen || platforms[0]?.platform || ''

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!label.trim() || !platform) return
    const account = await create({ productId, platform, label: label.trim() })
    if (account) setLabel('')
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-testid="create-account-form">
      <div className="row">
        <Field label="Platform">
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
        <Button variant="primary" type="submit" disabled={!label.trim() || !platform || state.busy} data-testid="account-create">
          {state.busy ? 'Adding…' : 'Add account'}
        </Button>
      </div>
      <ErrorNote error={state.error} />
    </form>
  )
}
