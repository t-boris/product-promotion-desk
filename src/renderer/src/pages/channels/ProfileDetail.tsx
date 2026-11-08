import { useEffect, useState } from 'react'
import type { Account, PlatformInfo, Product, Profile, ProfileFields, ProfileGender } from '../../../../shared/types'
import { fieldsOf, profileLine, sameFields } from '../../../../shared/profile'
import { AiProgressPanel } from '../../AiProgress'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field } from '../../ui'
import { ProfileAccounts } from './ProfileAccounts'
import { ROLE_NAME_LIMIT, ROLE_VOICE_LIMIT } from './RoleEditor'
import { platformLabel } from './model'

const GENDER_LABEL: Record<ProfileGender, string> = { female: 'Female', male: 'Male', other: 'Other' }
export const PURPOSE_LIMIT = 400

/** What the owner is editing: the person, and the few settings around it. */
interface Draft {
  label: string
  purpose: string
  roleName: string
  roleVoice: string
  platforms: string[]
  productId: string
  fields: ProfileFields
}

const draftOf = (profile: Profile): Draft => ({
  label: profile.label,
  purpose: profile.purpose,
  roleName: profile.role?.name ?? '',
  roleVoice: profile.role?.voice ?? '',
  platforms: profile.platforms,
  productId: profile.productId ?? '',
  fields: fieldsOf(profile)
})

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((item) => b.includes(item))

/**
 * One profile (DEC-019): a person made once, for a purpose. The AI proposes the whole person as a strategy (name, age, place, about-text,
 * picture), every choice with its reason; the owner edits and approves it once. The accounts of this profile are its logins on platforms
 * (one per platform); a mission types only what is approved here.
 */
export function ProfileDetail({
  profile,
  accounts,
  platforms,
  products,
  onOpenAccount,
  onRemoved
}: {
  profile: Profile
  accounts: Account[]
  platforms: PlatformInfo[]
  products: Product[]
  onOpenAccount: (accountId: string) => void
  onRemoved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile))
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [path, setPath] = useState('')
  const [picture, setPicture] = useState<string | null>(null)

  // What the screen holds follows what is stored whenever that changes (a proposal, a save, a new picture); only a new stored version resets what the owner is typing.
  const version = `${profile.id}:${profile.updatedAt}`
  useEffect(() => {
    setDraft(draftOf(profile))
  }, [version])

  const hasPicture = profile.hasPicture
  useEffect(() => {
    let current = true
    if (!hasPicture) setPicture(null)
    else void call('profiles.picture', { id: profile.id }).then((result) => current && setPicture(result?.dataUrl ?? null))
    return () => {
      current = false
    }
  }, [profile.id, hasPicture, version])

  const stored = draftOf(profile)
  const dirty = draft.label.trim() !== stored.label || draft.purpose.trim() !== stored.purpose || draft.roleName.trim() !== stored.roleName || draft.roleVoice.trim() !== stored.roleVoice || draft.productId !== stored.productId || !sameList(draft.platforms, stored.platforms) || !sameFields(draft.fields, stored.fields)
  const roleIncomplete = draft.roleName.trim() === '' && draft.roleVoice.trim() !== ''

  const persist = async (): Promise<void> => {
    if (!dirty) return
    await call('profiles.save', {
      id: profile.id,
      profile: draft.fields,
      label: draft.label.trim(),
      purpose: draft.purpose.trim(),
      role: draft.roleName.trim() ? { name: draft.roleName.trim(), voice: draft.roleVoice.trim() } : null,
      platforms: draft.platforms,
      productId: draft.productId || null
    })
  }

  const [propose, proposing] = useAction(async () => {
    await persist()
    await call('profiles.propose', { id: profile.id, purpose: draft.purpose.trim() || undefined })
    setEditing(false)
  })
  const [save, saving] = useAction(() => persist())
  const [approve, approving] = useAction(async () => {
    await persist()
    await call('profiles.approve', { id: profile.id })
    setEditing(false)
  })
  const [makePicture, making] = useAction(async () => {
    await persist()
    await call('profiles.makePicture', { id: profile.id })
  })
  const [useFile, usingFile] = useAction(async () => {
    await persist()
    await call('profiles.setPicture', { id: profile.id, path: path.trim() })
    setPicking(false)
    setPath('')
  })
  const [remove, removing] = useAction(async () => {
    await call('profiles.remove', { id: profile.id })
    onRemoved()
  })

  const busy = proposing.busy || saving.busy || approving.busy || making.busy || usingFile.busy
  const error = proposing.error ?? saving.error ?? approving.error ?? making.error ?? usingFile.error ?? removing.error
  const approved = profile.status === 'approved'
  const hasPerson = profile.displayName !== '' || profile.strategy !== ''
  const open = !hasPerson || !approved || editing

  const setField = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void => setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }))
  const togglePlatform = (key: string): void => setDraft((d) => ({ ...d, platforms: d.platforms.includes(key) ? d.platforms.filter((p) => p !== key) : [...d.platforms, key] }))
  /** The reason the AI gave for a value, shown only while the value is still the one it proposed. */
  const why = (key: keyof ProfileFields): string | undefined => (draft.fields[key] === profile[key] ? profile.reasons[key] : undefined)
  const input = (key: Exclude<keyof ProfileFields, 'gender'>, label: string, limit: number, placeholder?: string, long = false) => (
    <Field label={label} hint={why(key)}>
      {long ? (
        <textarea className="input short" value={draft.fields[key]} maxLength={limit} onChange={(e) => setField(key, e.target.value)} data-testid={`profile-${key}-${profile.id}`} />
      ) : (
        <input className="input" value={draft.fields[key]} maxLength={limit} placeholder={placeholder} onChange={(e) => setField(key, e.target.value)} data-testid={`profile-${key}-${profile.id}`} />
      )}
    </Field>
  )

  return (
    <div className="stack" data-testid={`profile-${profile.id}`}>
      <Card
        title={profile.label}
        actions={
          <>
            <Badge tone={!hasPerson ? 'neutral' : approved ? 'good' : 'warn'}>{!hasPerson ? 'No person yet' : approved ? 'Approved' : 'Proposed'}</Badge>
            {hasPerson && approved && !editing && (
              <Button onClick={() => setEditing(true)} data-testid={`profile-edit-${profile.id}`}>
                Change
              </Button>
            )}
          </>
        }
      >
        <p data-testid={`profile-state-${profile.id}`}>
          {hasPerson ? (
            <>
              <strong>{profileLine(profile, new Date())}</strong>
              {!approved && <span className="muted"> · waits for your decision</span>}
            </>
          ) : (
            <span className="muted">The AI proposes the whole person (name, age, place, about-text, picture) from what the profile is for, and you decide.</span>
          )}
        </p>

        {open && (
          <div className="stack" data-testid={`profile-form-${profile.id}`}>
            <div className="form-row">
              <Field label="Name of the profile" hint="Only for you.">
                <input className="input" value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} data-testid={`profile-label-${profile.id}`} />
              </Field>
              <Field label="Product (optional)" hint="Its approved passport feeds the proposal.">
                <select className="input" value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })} data-testid={`profile-product-${profile.id}`}>
                  <option value="">No product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="What this profile is for" hint="Your words: the AI plans the person around it. Change it and press “Propose again” for a new person.">
              <textarea className="input short" value={draft.purpose} maxLength={PURPOSE_LIMIT} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} data-testid={`profile-purpose-${profile.id}`} />
            </Field>
            <Field label="Platforms (optional)" hint="Where this person will have accounts. The AI plans the person for all of them; an account is made for each below.">
              <div className="row" data-testid={`profile-platforms-${profile.id}`}>
                {platforms.map((p) => (
                  <Button key={p.platform} variant={draft.platforms.includes(p.platform) ? 'primary' : undefined} onClick={() => togglePlatform(p.platform)} aria-pressed={draft.platforms.includes(p.platform)} data-testid={`profile-platform-${p.platform}-${profile.id}`}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </Field>
            <div className="form-row">
              <Field label="Role (optional)" hint="The same voice on every platform, for example astrologer or developer.">
                <input className="input" value={draft.roleName} maxLength={ROLE_NAME_LIMIT} onChange={(e) => setDraft({ ...draft, roleName: e.target.value })} data-testid={`profile-role-name-${profile.id}`} />
              </Field>
              <Field label="Voice (optional)" hint={`How this person writes and what it may talk about. Up to ${ROLE_VOICE_LIMIT} characters.`}>
                <textarea className="input short" value={draft.roleVoice} maxLength={ROLE_VOICE_LIMIT} onChange={(e) => setDraft({ ...draft, roleVoice: e.target.value })} data-testid={`profile-role-voice-${profile.id}`} />
              </Field>
            </div>
            {roleIncomplete && <p className="muted small">Give the role a name, or clear the voice.</p>}
            {profile.strategy && (
              <div className="note" data-testid={`profile-strategy-${profile.id}`}>
                <strong>Strategy of the AI.</strong> {profile.strategy}
              </div>
            )}
            {hasPerson && (
              <div className="profile-grid">
                <div className="profile-picture" data-testid={`profile-picture-${profile.id}`}>
                  <div className="profile-thumb">{picture ? <img src={picture} alt="Profile" /> : <span className="muted small">No picture yet</span>}</div>
                  <Button onClick={() => void makePicture()} disabled={busy || !draft.fields.pictureIdea.trim()} data-testid={`profile-picture-make-${profile.id}`}>
                    {making.busy ? 'Making it…' : hasPicture ? 'Create new' : 'Create picture'}
                  </Button>
                  <Button onClick={() => setPicking(!picking)} disabled={busy} data-testid={`profile-picture-own-${profile.id}`}>
                    Use my own file…
                  </Button>
                  {picking && (
                    <>
                      <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Pictures/face.png" data-testid={`profile-picture-path-${profile.id}`} />
                      <Button onClick={() => void useFile()} disabled={busy || !path.trim()} data-testid={`profile-picture-use-${profile.id}`}>
                        {usingFile.busy ? 'Checking…' : 'Use this file'}
                      </Button>
                    </>
                  )}
                </div>
                <div>
                  <div className="form-row">
                    {input('firstName', 'First name', 40)}
                    {input('lastName', 'Last name', 40)}
                  </div>
                  {input('displayName', 'Name shown on the platform', 60)}
                  {input('username', 'User name', 30)}
                  <div className="form-row">
                    {input('birthDate', 'Birth date', 10, 'YYYY-MM-DD')}
                    <Field label="Gender" hint={why('gender')}>
                      <select className="input" value={draft.fields.gender} onChange={(e) => setField('gender', e.target.value as ProfileGender)} data-testid={`profile-gender-${profile.id}`}>
                        {(Object.keys(GENDER_LABEL) as ProfileGender[]).map((gender) => (
                          <option key={gender} value={gender}>
                            {GENDER_LABEL[gender]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {input('place', 'Place', 80)}
                  {input('about', 'About', 500, undefined, true)}
                  {input('website', 'Website (optional)', 200, 'https://…')}
                  {input('pictureIdea', 'What the picture shows', 300, undefined, true)}
                </div>
              </div>
            )}
            <div className="row">
              <Button variant={hasPerson ? undefined : 'primary'} onClick={() => void propose()} disabled={busy || roleIncomplete} data-testid={`profile-propose-${profile.id}`}>
                {proposing.busy ? 'The AI is thinking…' : hasPerson ? 'Propose again' : 'Propose a profile'}
              </Button>
              <Button onClick={() => void save()} disabled={busy || !dirty || roleIncomplete} data-testid={`profile-save-${profile.id}`}>
                {saving.busy ? 'Saving…' : 'Save changes'}
              </Button>
              {hasPerson && approved && (
                <Button onClick={() => (setDraft(draftOf(profile)), setEditing(false))} disabled={busy} data-testid={`profile-cancel-${profile.id}`}>
                  Cancel
                </Button>
              )}
              {hasPerson && (!approved || dirty) && (
                <Button variant="primary" onClick={() => void approve()} disabled={busy || roleIncomplete} data-testid={`profile-approve-${profile.id}`}>
                  {approving.busy ? 'Approving…' : 'Approve'}
                </Button>
              )}
            </div>
            <p className="muted small">“Propose again” replaces the person above with a new one. A mission types only an approved profile.</p>
          </div>
        )}
        <AiProgressPanel subject={profile.id} />
        <ErrorNote error={error} />
      </Card>

      <ProfileAccounts profile={profile} accounts={accounts} platforms={platforms} onOpenAccount={onOpenAccount} />

      <div className="row">
        <Button onClick={() => void remove()} disabled={removing.busy || accounts.length > 0} data-testid={`profile-remove-${profile.id}`}>
          {removing.busy ? 'Removing…' : 'Remove this profile'}
        </Button>
        {accounts.length > 0 && <span className="muted small">It has {accounts.length} account{accounts.length === 1 ? '' : 's'}: take them out of the profile first ({accounts.map((a) => platformLabel(a.platform, platforms)).join(', ')}).</span>}
      </div>
    </div>
  )
}

