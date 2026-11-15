import { useState, type FormEvent } from 'react'
import type { Account, PlatformInfo, Product, Profile } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field, Hint, useOpenForm } from '../../ui'
import { platformLabel } from '../channels/model'
import { productLabels } from '../products/product-labels'

/** Names a profile and says what it is for; the AI proposes the person afterwards. */
export function NewProfile({ platforms, products, freeAccounts, onCreated, onCancel }: { platforms: PlatformInfo[]; products: Product[]; freeAccounts: Account[]; onCreated: (profile: Profile) => void; onCancel?: () => void }) {
  // The form is the next step of the screen while it is open: "Make the profile" is its one filled button unless a form opened after it owns it.
  const submitVariant = useOpenForm()
  const [label, setLabel] = useState('')
  const [purpose, setPurpose] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [productId, setProductId] = useState('')
  const [taken, setTaken] = useState<string[]>([])
  const [create, state] = useAction((args: { label: string; purpose?: string; platforms: string[]; productId: string | null; accountIds: string[] }) => call('profiles.create', args))
  const takenPlatforms = new Set(freeAccounts.filter((a) => taken.includes(a.id)).map((a) => a.platform))
  const labels = productLabels(products)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!label.trim()) return
    const profile = await create({ label: label.trim(), purpose: purpose.trim() || undefined, platforms: chosen, productId: productId || null, accountIds: taken })
    if (profile) onCreated(profile)
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-testid="create-profile-form">
      <div className="form-row">
        <Field label="Name of the profile" hint="Only for you, e.g. the astrologer.">
          <input className="input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} data-testid="new-profile-label" />
        </Field>
        <Field label="Product (optional)" hint="Its approved passport feeds the proposal.">
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)} data-testid="new-profile-product">
            <option value="">No product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {labels.get(p.id) ?? p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="What is this profile for? (optional)" hint="In your words. The AI plans the person around it.">
        <textarea className="input short" value={purpose} maxLength={400} onChange={(e) => setPurpose(e.target.value)} data-testid="new-profile-purpose" />
      </Field>
      {freeAccounts.length > 0 && (
        <Field label="Accounts it already has (optional)" hint="Logins you already made for this person (an Instagram account, any other). They join the profile, and the AI plans the person to fit them: their names and e-mail addresses. One account per platform.">
          <div className="toggle-group" data-testid="new-profile-accounts">
            {freeAccounts.map((a) => {
              const on = taken.includes(a.id)
              const blocked = !on && takenPlatforms.has(a.platform)
              return (
                <Button key={a.id} disabled={blocked} onClick={() => setTaken((t) => (on ? t.filter((x) => x !== a.id) : [...t, a.id]))} aria-pressed={on} data-testid={`new-profile-account-${a.id}`}>
                  {a.label} · {platformLabel(a.platform, platforms)}
                </Button>
              )
            })}
          </div>
        </Field>
      )}
      <Field label="Platforms (optional)" hint="Where this person will have accounts. You can change it later.">
        <div className="toggle-group">
          {platforms.map((p) => (
            <Button key={p.platform} onClick={() => setChosen((c) => (c.includes(p.platform) ? c.filter((x) => x !== p.platform) : [...c, p.platform]))} aria-pressed={chosen.includes(p.platform)} data-testid={`new-profile-platform-${p.platform}`}>
              {p.label}
            </Button>
          ))}
        </div>
      </Field>
      <div className="row">
        <Button variant={submitVariant} type="submit" disabled={!label.trim() || state.busy} data-testid="profile-create">
          {state.busy ? 'Making…' : 'Make the profile'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        {!label.trim() && <Hint data-testid="profile-create-reason">Name the profile first.</Hint>}
      </div>
      <p className="muted small">After making it, the AI proposes the person, and you decide.</p>
      <ErrorNote error={state.error} />
    </form>
  )
}
