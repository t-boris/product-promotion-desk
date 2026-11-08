import { useState, type FormEvent } from 'react'
import type { Account, PlatformInfo, Product, Profile } from '../../../../shared/types'
import { profileLine } from '../../../../shared/profile'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Field } from '../../ui'
import { ProfileDetail } from './ProfileDetail'
import { platformLabel } from './model'

/**
 * The profiles (DEC-019): people the owner makes once, each for a purpose. Beside each is its list of accounts: its logins on platforms,
 * one per platform; a platform can hold the logins of many profiles.
 */
export function ProfilesPanel({
  profiles,
  accounts,
  platforms,
  products,
  selectedId,
  onSelect,
  onOpenAccount
}: {
  profiles: Profile[]
  accounts: Account[]
  platforms: PlatformInfo[]
  products: Product[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenAccount: (accountId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0]
  const showForm = adding || profiles.length === 0

  return (
    <div className="accounts-layout" data-testid="profiles-panel">
      <aside className="stack">
        <Button variant="primary" onClick={() => setAdding(true)} data-testid="profile-add">
          New profile
        </Button>
        <div className="stack" data-testid="profile-list">
          {profiles.map((profile) => {
            const own = accounts.filter((a) => a.profileId === profile.id)
            return (
              <div
                key={profile.id}
                className={`list-row selectable ${!showForm && profile.id === selected?.id ? 'active' : ''}`}
                onClick={() => (setAdding(false), onSelect(profile.id))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (setAdding(false), onSelect(profile.id))}
                data-testid={`profile-row-${profile.id}`}
              >
                <div className="acct-list-name">
                  <strong>{profile.label}</strong>
                  <div className="muted small">{profile.displayName ? profileLine(profile, new Date()) : 'No person yet'}</div>
                  <div className="muted small">{own.length === 0 ? 'no accounts' : own.map((a) => platformLabel(a.platform, platforms)).join(', ')}</div>
                </div>
                <Badge tone={profile.displayName === '' ? 'neutral' : profile.status === 'approved' ? 'good' : 'warn'}>{profile.displayName === '' ? 'New' : profile.status === 'approved' ? 'Approved' : 'Proposed'}</Badge>
              </div>
            )
          })}
        </div>
      </aside>
      <div className="acct-detail-wrap">
        {showForm ? (
          <Card title="New profile">
            <NewProfile
              platforms={platforms}
              products={products}
              freeAccounts={accounts.filter((a) => a.profileId === null)}
              onCreated={(profile) => (setAdding(false), onSelect(profile.id))}
              onCancel={profiles.length > 0 ? () => setAdding(false) : undefined}
            />
          </Card>
        ) : selected ? (
          <ProfileDetail
            key={selected.id}
            profile={selected}
            accounts={accounts.filter((a) => a.profileId === selected.id)}
            platforms={platforms}
            products={products}
            onOpenAccount={onOpenAccount}
            onRemoved={() => onSelect(null)}
          />
        ) : (
          <EmptyState title="Select a profile">Pick a profile to see its person and its accounts.</EmptyState>
        )}
      </div>
    </div>
  )
}

/** Names a profile and says what it is for; the AI proposes the person afterwards. */
function NewProfile({ platforms, products, freeAccounts, onCreated, onCancel }: { platforms: PlatformInfo[]; products: Product[]; freeAccounts: Account[]; onCreated: (profile: Profile) => void; onCancel?: () => void }) {
  const [label, setLabel] = useState('')
  const [purpose, setPurpose] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [productId, setProductId] = useState('')
  const [taken, setTaken] = useState<string[]>([])
  const [create, state] = useAction((args: { label: string; purpose?: string; platforms: string[]; productId: string | null; accountIds: string[] }) => call('profiles.create', args))
  const takenPlatforms = new Set(freeAccounts.filter((a) => taken.includes(a.id)).map((a) => a.platform))

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
                {p.name}
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
          <div className="row" data-testid="new-profile-accounts">
            {freeAccounts.map((a) => {
              const on = taken.includes(a.id)
              const blocked = !on && takenPlatforms.has(a.platform)
              return (
                <Button key={a.id} variant={on ? 'primary' : undefined} disabled={blocked} onClick={() => setTaken((t) => (on ? t.filter((x) => x !== a.id) : [...t, a.id]))} aria-pressed={on} data-testid={`new-profile-account-${a.id}`}>
                  {a.label} · {platformLabel(a.platform, platforms)}
                </Button>
              )
            })}
          </div>
        </Field>
      )}
      <Field label="Platforms (optional)" hint="Where this person will have accounts. You can change it later.">
        <div className="row">
          {platforms.map((p) => (
            <Button key={p.platform} variant={chosen.includes(p.platform) ? 'primary' : undefined} onClick={() => setChosen((c) => (c.includes(p.platform) ? c.filter((x) => x !== p.platform) : [...c, p.platform]))} aria-pressed={chosen.includes(p.platform)} data-testid={`new-profile-platform-${p.platform}`}>
              {p.label}
            </Button>
          ))}
        </div>
      </Field>
      <div className="row">
        <Button variant="primary" type="submit" disabled={!label.trim() || state.busy} data-testid="profile-create">
          {state.busy ? 'Making…' : 'Make the profile'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
      <p className="muted small">After making it, the AI proposes the person, and you decide.</p>
      <ErrorNote error={state.error} />
    </form>
  )
}
