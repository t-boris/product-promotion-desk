import { useEffect, useState } from 'react'
import type { Account, ProfileFields, ProfileGender } from '../../../../shared/types'
import { EMPTY_FIELDS, fieldsOf, profileLine, sameFields } from '../../../../shared/profile'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Field } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { AgentRunPanel } from './AgentRunPanel'

const GENDER_LABEL: Record<ProfileGender, string> = { female: 'Female', male: 'Male', other: 'Other' }
export const PURPOSE_LIMIT = 400

/**
 * The profile of an account (DEC-019): who this login is on the platform. The AI proposes the whole person as a strategy for a purpose
 * (name, age, place, about-text, picture), every choice with its reason; the owner edits and approves it once. A mission types only
 * what is approved here. Editing an approved profile makes it a proposal again until it is approved on purpose.
 */
export function AccountProfile({ account }: { account: Account }) {
  const stored = useQuery('profile.get', { accountId: account.id }, ['accounts'])
  const profile = stored.data ?? null
  const agent = useQuery('agent.state', { accountId: account.id }, ['accounts'])
  const canFill = useQuery('agent.canStart', { accountId: account.id, kind: 'profile' }, ['accounts', 'settings'])
  const [form, setForm] = useState<ProfileFields>(EMPTY_FIELDS)
  const [purpose, setPurpose] = useState('')
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [path, setPath] = useState('')
  const [picture, setPicture] = useState<string | null>(null)

  // What the screen holds follows what is stored whenever that changes (a proposal, a save, a new picture); only a new stored version resets what the owner is typing.
  const version = profile ? `${profile.accountId}:${profile.updatedAt}` : ''
  useEffect(() => {
    if (!profile) return
    setForm(fieldsOf(profile))
    setPurpose(profile.purpose)
  }, [version])

  const hasPicture = profile?.hasPicture === true
  useEffect(() => {
    let current = true
    if (!hasPicture) setPicture(null)
    else void call('profile.picture', { accountId: account.id }).then((result) => current && setPicture(result?.dataUrl ?? null))
    return () => {
      current = false
    }
  }, [account.id, hasPicture, version])

  const dirty = profile !== null && (!sameFields(form, profile) || purpose.trim() !== profile.purpose)
  const persist = async (): Promise<void> => {
    if (profile && dirty) await call('profile.save', { accountId: account.id, profile: form, purpose: purpose.trim() })
  }

  const [propose, proposing] = useAction(async () => {
    const proposed = await call('profile.propose', { accountId: account.id, purpose: purpose.trim() || undefined })
    setEditing(false)
    return proposed
  })
  const [save, saving] = useAction(() => persist())
  const [approve, approving] = useAction(async () => {
    await persist()
    await call('profile.approve', { accountId: account.id })
    setEditing(false)
  })
  const [makePicture, making] = useAction(async () => {
    await persist()
    await call('profile.makePicture', { accountId: account.id })
  })
  const [useFile, usingFile] = useAction(async () => {
    await persist()
    await call('profile.setPicture', { accountId: account.id, path: path.trim() })
    setPicking(false)
    setPath('')
  })
  const [fill, filling] = useAction(() => call('agent.start', { accountId: account.id, kind: 'profile' }))
  const [stop, stopping] = useAction(() => call('agent.stop', { accountId: account.id }))

  const busy = proposing.busy || saving.busy || approving.busy || making.busy || usingFile.busy
  const error = proposing.error ?? saving.error ?? approving.error ?? making.error ?? usingFile.error ?? filling.error ?? stopping.error
  const approved = profile?.status === 'approved'
  const open = profile !== null && (!approved || editing)
  const agentRun = agent.data ?? null
  const working = agentRun?.status === 'running'
  const signedIn = account.status === 'ready'
  const fillReason = !signedIn ? 'The account has to be signed in first (step 5).' : canFill.data && !canFill.data.ready ? canFill.data.reason : null

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void => setForm((current) => ({ ...current, [key]: value }))
  /** The reason the AI gave for a value, shown only while the value is still the one it proposed. */
  const why = (key: keyof ProfileFields): string | undefined => (profile && form[key] === profile[key] ? profile.reasons[key] : undefined)
  const input = (key: Exclude<keyof ProfileFields, 'gender'>, label: string, limit: number, placeholder?: string, long = false) => (
    <Field label={label} hint={why(key)}>
      {long ? (
        <textarea className="input short" value={form[key]} maxLength={limit} onChange={(e) => set(key, e.target.value)} data-testid={`profile-${key}-${account.id}`} />
      ) : (
        <input className="input" value={form[key]} maxLength={limit} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} data-testid={`profile-${key}-${account.id}`} />
      )}
    </Field>
  )

  const summary = !profile ? (
    <span className="muted" data-testid={`profile-state-${account.id}`}>
      No profile yet. The AI proposes the whole person for this account (name, age, place, about-text, picture) and you decide.
    </span>
  ) : (
    <span data-testid={`profile-state-${account.id}`}>
      <Badge tone={approved ? 'good' : 'warn'}>{approved ? 'Approved' : 'Proposed'}</Badge> <strong>{profileLine(profile, new Date())}</strong>
      {!approved && <span className="muted"> · waits for your decision</span>}
    </span>
  )

  const actions = !profile ? (
    <Button variant="primary" onClick={() => void propose()} disabled={busy} data-testid={`profile-propose-${account.id}`}>
      {proposing.busy ? 'The AI is thinking…' : 'Propose a profile'}
    </Button>
  ) : approved && !editing ? (
    <>
      <Button onClick={() => setEditing(true)} data-testid={`profile-edit-${account.id}`}>
        Change
      </Button>
      <Button variant={signedIn && !fillReason ? 'primary' : undefined} onClick={() => void fill()} disabled={filling.busy || working || fillReason !== null} data-testid={`profile-fill-${account.id}`}>
        {filling.busy ? 'Starting…' : 'Fill in the profile on the site (AI)'}
      </Button>
    </>
  ) : null

  return (
    <AccountBlock step={2} title="Profile" summary={summary} actions={actions} testId={`account-profile-${account.id}`}>
      {!profile && (
        <Field label="What is this account for? (optional)" hint="In your words. The AI plans the person around it, from the role, the product and the platform.">
          <textarea className="input short" value={purpose} maxLength={PURPOSE_LIMIT} onChange={(e) => setPurpose(e.target.value)} data-testid={`profile-purpose-${account.id}`} />
        </Field>
      )}
      {approved && !editing && fillReason && !working && (
        <p className="muted small" data-testid={`profile-fill-why-${account.id}`}>
          {fillReason}
        </p>
      )}
      {open && profile && (
        <div className="stack" data-testid={`profile-form-${account.id}`}>
          <Field label="What this account is for" hint="Your words: the AI plans the person around it. Change it and press “Propose again” for a new person.">
            <textarea className="input short" value={purpose} maxLength={PURPOSE_LIMIT} onChange={(e) => setPurpose(e.target.value)} data-testid={`profile-purpose-${account.id}`} />
          </Field>
          {profile.strategy && (
            <div className="note" data-testid={`profile-strategy-${account.id}`}>
              <strong>Strategy of the AI.</strong> {profile.strategy}
            </div>
          )}
          <div className="profile-grid">
            <div className="profile-picture" data-testid={`profile-picture-${account.id}`}>
              <div className="profile-thumb">{picture ? <img src={picture} alt="Profile" /> : <span className="muted small">No picture yet</span>}</div>
              <Button onClick={() => void makePicture()} disabled={busy || !form.pictureIdea.trim()} data-testid={`profile-picture-make-${account.id}`}>
                {making.busy ? 'Making it… about a minute' : hasPicture ? 'Create new' : 'Create picture'}
              </Button>
              <Button onClick={() => setPicking(!picking)} disabled={busy} data-testid={`profile-picture-own-${account.id}`}>
                Use my own file…
              </Button>
              {picking && (
                <>
                  <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Pictures/face.png" data-testid={`profile-picture-path-${account.id}`} />
                  <Button onClick={() => void useFile()} disabled={busy || !path.trim()} data-testid={`profile-picture-use-${account.id}`}>
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
                  <select className="input" value={form.gender} onChange={(e) => set('gender', e.target.value as ProfileGender)} data-testid={`profile-gender-${account.id}`}>
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
          <div className="row">
            <Button onClick={() => void propose()} disabled={busy} data-testid={`profile-propose-${account.id}`}>
              {proposing.busy ? 'The AI is thinking…' : 'Propose again'}
            </Button>
            <Button onClick={() => void save()} disabled={busy || !dirty} data-testid={`profile-save-${account.id}`}>
              {saving.busy ? 'Saving…' : 'Save changes'}
            </Button>
            {approved && (
              <Button onClick={() => (setForm(fieldsOf(profile)), setPurpose(profile.purpose), setEditing(false))} disabled={busy} data-testid={`profile-cancel-${account.id}`}>
                Cancel
              </Button>
            )}
            {(!approved || dirty) && (
              <Button variant="primary" onClick={() => void approve()} disabled={busy} data-testid={`profile-approve-${account.id}`}>
                {approving.busy ? 'Approving…' : 'Approve'}
              </Button>
            )}
          </div>
          <p className="muted small">“Propose again” replaces the values above with a new person. A mission types only an approved profile.</p>
        </div>
      )}
      <ErrorNote error={error} />
      {agentRun?.kind === 'profile' && <AgentRunPanel run={agentRun} onStop={() => void stop()} stopping={stopping.busy} testId={`profile-run-${account.id}`} />}
    </AccountBlock>
  )
}
