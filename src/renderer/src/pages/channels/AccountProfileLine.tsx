import { profileLine } from '../../../../shared/profile'
import type { Account } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote } from '../../ui'
import { AccountBlock } from './AccountBlock'

/**
 * The profile this login belongs to (DEC-019), in one line. The person (name, age, place, picture) lives in the profile and is edited
 * there; here the owner only sees whose login this is and may choose another profile. A profile has one account per platform.
 */
export function AccountProfileLine({ account, onOpenProfile }: { account: Account; onOpenProfile: (profileId: string) => void }) {
  const profiles = useQuery('profiles.list', undefined, ['accounts'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const [choose, choosing] = useAction((profileId: string | null) => call('accounts.setProfile', { accountId: account.id, profileId }))
  const list = profiles.data ?? []
  const current = list.find((p) => p.id === account.profileId) ?? null
  // A profile that already has a login on this platform cannot take another (one account per platform).
  const free = list.filter((p) => p.id === account.profileId || !(accounts.data ?? []).some((a) => a.profileId === p.id && a.platform === account.platform && a.id !== account.id))

  const summary = current ? (
    <span data-testid={`account-profile-state-${account.id}`}>
      <Badge tone={current.status === 'approved' ? 'good' : 'warn'}>{current.status === 'approved' ? 'Approved' : 'Proposed'}</Badge> <strong>{current.label}</strong>
      {current.displayName && <span className="muted"> · {profileLine(current, new Date())}</span>}
    </span>
  ) : (
    <span className="muted" data-testid={`account-profile-state-${account.id}`}>
      This login has no profile. A profile is the person behind it (name, age, place, picture); the AI fills in registrations and profiles from it.
    </span>
  )

  return (
    <AccountBlock
      step={2}
      title="Profile"
      summary={summary}
      testId={`account-profile-${account.id}`}
      actions={
        current && (
          <Button onClick={() => onOpenProfile(current.id)} data-testid={`account-profile-open-${account.id}`}>
            Open profile
          </Button>
        )
      }
    >
      <div className="row">
        <select
          className="input"
          value={account.profileId ?? ''}
          disabled={choosing.busy}
          onChange={(e) => void choose(e.target.value || null)}
          aria-label="Profile of this account"
          data-testid={`account-profile-select-${account.id}`}
        >
          <option value="">{current ? 'No profile' : 'Choose a profile…'}</option>
          {free.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote error={choosing.error} />
    </AccountBlock>
  )
}
