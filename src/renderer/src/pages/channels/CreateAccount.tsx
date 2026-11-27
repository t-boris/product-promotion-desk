import { KIND_NOT_SAID } from '../../../../shared/connection-guide'
import { useState, type FormEvent } from 'react'
import type { Account, AccountRole, Mailbox, PlatformInfo, Profile, AccountAccess } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field, Hint, useOpenForm } from '../../ui'
import { chosenVia, eligibleVia, viaBlocker, viaOption } from './account-link'
import { afterCreateNote } from './next-step'
import { ROLE_NAME_LIMIT, ROLE_VOICE_LIMIT } from './RoleEditor'

/**
 * Adds an account to the library (DEC-015): a platform, a name for the owner, and optionally an e-mail address and a role.
 * The account belongs to no product (opened from a product's Channels screen it only records that product, DEC-015). Nothing is registered
 * anywhere: the account gets its own empty browser.
 */
export function CreateAccount({
  platforms,
  mailboxes,
  profiles,
  accounts,
  role,
  product,
  madeFor = null,
  startPlatform = null,
  onCreated,
  onCancel
}: {
  platforms: PlatformInfo[]
  mailboxes: Mailbox[]
  /** The profiles a new login may belong to (DEC-019). */
  profiles: Profile[]
  /** Every account, to leave out the profiles that already have a login on the chosen platform. */
  accounts: Account[]
  /** A role to start from ("Use this role" on Setup). */
  role: AccountRole | null
  /** The product whose Channels screen opened the form: the account is made for it (`name` is absent until the products have loaded). */
  product: { id: string; name: string | undefined } | null
  /** The product the Accounts screen is open for: the new login is recorded as made for it, so it is listed there (ignored when `product` is set). */
  madeFor?: string | null
  /** The platform the form starts on ("Add a Reddit account" on a product's Channels screen); the owner can still change it. */
  startPlatform?: string | null
  onCreated: (account: Account) => void
  /** Absent while there is no account yet and no product to go back to: the form is then the only thing to do. */
  onCancel?: () => void
}) {
  // The form is the next step of the screen and owns its one filled button unless a form opened after it does; the account behind it keeps bezels meanwhile.
  const submitVariant = useOpenForm()
  const [chosen, setChosen] = useState(startPlatform !== null && platforms.some((p) => p.platform === startPlatform) ? startPlatform : '')
  const [profileId, setProfileId] = useState('')
  const [label, setLabel] = useState(role ? `${role.name} account` : '')
  const [roleName, setRoleName] = useState(role?.name ?? '')
  const [roleVoice, setRoleVoice] = useState(role?.voice ?? '')
  const [email, setEmail] = useState('')
  const [chosenMailbox, setChosenMailbox] = useState('')
  const [fromMailbox, setFromMailbox] = useState<string | null>(null)
  const [viaId, setViaId] = useState('')
  const [access, setAccess] = useState<AccountAccess>('browser')
  const [kind, setKind] = useState('')
  const [create, state] = useAction((args: { productId?: string; platform: string; label: string; role?: AccountRole; email?: string; mailboxId?: string; profileId?: string; signsInVia?: string; kind?: string; access?: AccountAccess }) => call('accounts.create', args))
  const mailboxId = mailboxes.some((m) => m.id === chosenMailbox) ? chosenMailbox : (mailboxes[0]?.id ?? '')
  const [propose, proposing] = useAction(async (platformKey: string) => {
    const result = await call('accounts.proposeEmail', { mailboxId, platform: platformKey })
    setEmail(result.address)
    setFromMailbox(mailboxId)
  })
  // No platform is chosen for the owner: a silent default (the first in the list) made a "Facebook" account on Reddit.
  const platform = chosen
  // A profile that already has a login on this platform cannot take another. A login of a profile speaks with the profile's role.
  const freeProfiles = profiles.filter((p) => !accounts.some((a) => a.profileId === p.id && a.platform === platform))
  const profile = freeProfiles.find((p) => p.id === profileId)
  const roleIncomplete = !profile && roleName.trim() === '' && roleVoice.trim() !== ''
  // A platform that signs in with another (Threads with Instagram, DEC-027) has no e-mail or password of its own: it is made with an account
  // of that platform to sign in through, which has to exist first.
  const info = platforms.find((p) => p.platform === platform)
  // A platform that can be worked through its own API (a Telegram bot, DEC-055): such an account has a key, no e-mail, password or browser.
  const viaApi = info?.api !== undefined && access === 'api'
  const signsInWith = viaApi ? undefined : info?.signsInWith
  // The kinds of account the platform has (DEC-074): asked for each account, because one product may have a business account and personal ones.
  const kinds = viaApi ? [] : (info?.kinds ?? [])
  const wantedLabel = signsInWith ? (platforms.find((p) => p.platform === signsInWith)?.label ?? signsInWith) : ''
  const candidates = signsInWith ? eligibleVia(accounts, signsInWith, profile?.id ?? null) : []
  const via = signsInWith ? chosenVia(candidates, viaId) : ''
  const viaProblem = signsInWith && info ? viaBlocker(info.label, wantedLabel, candidates, via) : null
  // Why "Add account" cannot be pressed yet, beside the button (the field that is missing first).
  const createBlocker = !platform ? 'Choose a platform.' : viaProblem ? viaProblem : !label.trim() ? 'Name the account.' : roleIncomplete ? 'Give the role a name, or clear the voice.' : null

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!label.trim() || !platform || roleIncomplete || viaProblem) return
    const wanted = !profile && roleName.trim() ? { name: roleName.trim(), voice: roleVoice.trim() } : undefined
    const account = await create({
      ...(product ? { productId: product.id } : madeFor ? { productId: madeFor } : {}),
      platform,
      label: label.trim(),
      ...(wanted ? { role: wanted } : {}),
      ...(profile ? { profileId: profile.id } : {}),
      ...(signsInWith ? { signsInVia: via } : {}),
      ...(viaApi ? { access: 'api' as const } : {}),
      ...(kinds.length > 0 && kind ? { kind } : {}),
      ...(!signsInWith && !viaApi && email.trim() ? { email: email.trim(), ...(fromMailbox ? { mailboxId: fromMailbox } : {}) } : {})
    })
    if (account) onCreated(account)
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-testid="create-account-form">
      <div className="form-row">
        <Field label="Platform" hint={info?.note ?? 'The site this account is on. It cannot be changed later.'}>
          <select className="input" value={platform} onChange={(e) => {
              setChosen(e.target.value)
              setViaId('')
              setKind('')
            }}
            disabled={platforms.length === 0} data-testid="account-platform">
            <option value="">Choose a platform…</option>
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
      {info?.api && (
        <Field label="How the app works with it" hint={viaApi ? `The app posts, reads comments and answers through a ${info.api.accountKind} of yours, by itself and with no browser. You paste its ${info.api.keyLabel.toLowerCase()} on the account's page.` : `In the account's own browser, signed in as you. Choose the ${info.api.accountKind} to post on a schedule and read comments without a browser.`}>
          <select className="input" value={viaApi ? 'api' : 'browser'} onChange={(e) => setAccess(e.target.value === 'api' ? 'api' : 'browser')} data-testid="account-access">
            <option value="browser">In the account's browser</option>
            <option value="api">{`Through a ${info.api.accountKind} (${info.label}'s own API)`}</option>
          </select>
        </Field>
      )}
      {kinds.length > 0 && (
        <Field label="Kind of account" hint={kinds.find((k) => k.id === kind)?.hint ?? 'The steps to connect it depend on the kind. If you are not sure, the account’s page tells you how to find out.'}>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="account-kind">
            <option value="">{KIND_NOT_SAID}</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {signsInWith && (
        <Field label={`Signs in with ${wantedLabel}`} hint={`${info?.label ?? 'This platform'} has no password of its own: the AI signs in through this ${wantedLabel} account, and you are never asked for ${info?.label ?? 'platform'} credentials.`}>
          <select className="input" value={via} onChange={(e) => setViaId(e.target.value)} disabled={candidates.length === 0} data-testid="account-via">
            <option value="">{candidates.length === 0 ? `No ${wantedLabel} account yet` : `Choose the ${wantedLabel} account…`}</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {viaOption(a)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!signsInWith && !viaApi && (
        <div className="form-row">
          <Field label="E-mail address (optional)" hint={mailboxes.length > 0 ? 'What the account signs up with. You can also set it later.' : 'What the account signs up with. To get proposed addresses, add your own mailbox in Settings.'}>
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
                <Button variant="secondary" onClick={() => void propose(platform)} disabled={proposing.busy || platform === ''} data-testid="account-propose-email">
                  Propose
                </Button>
              </div>
            </Field>
          )}
        </div>
      )}
      {profiles.length > 0 && (
        <Field label="Profile (optional)" hint="The person behind this login. It speaks with the profile's role; a profile has one login per platform.">
          <select className="input" value={profile?.id ?? ''} onChange={(e) => setProfileId(e.target.value)} disabled={platform === ''} data-testid="account-profile">
            <option value="">{platform === '' ? 'Choose a platform first' : 'No profile'}</option>
            {freeProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!profile && (
        <div className="form-row">
          <Field label="Role (optional)" hint="For example astrologer or developer.">
            <input className="input" value={roleName} maxLength={ROLE_NAME_LIMIT} onChange={(e) => setRoleName(e.target.value)} data-testid="account-role-name" />
          </Field>
          <Field label="Voice (optional)" hint={`How this account writes and what it may talk about. Up to ${ROLE_VOICE_LIMIT} characters.`}>
            <textarea className="input short" value={roleVoice} maxLength={ROLE_VOICE_LIMIT} onChange={(e) => setRoleVoice(e.target.value)} data-testid="account-role-voice" />
          </Field>
        </div>
      )}
      {roleIncomplete && <p className="muted small">Give the role a name, or clear the voice.</p>}
      <div className="row">
        <Button variant={submitVariant} type="submit" disabled={!label.trim() || !platform || roleIncomplete || viaProblem !== null || state.busy} data-testid="account-create">
          {state.busy ? 'Adding…' : 'Add account'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        {createBlocker && <Hint data-testid="account-create-reason">{createBlocker}</Hint>}
      </div>
      <p className="muted small" data-testid="account-create-note">
        {afterCreateNote(product, signsInWith !== undefined, viaApi ? (info?.api?.keyLabel ?? null) : null)}
      </p>
      <ErrorNote error={state.error ?? proposing.error} />
    </form>
  )
}
