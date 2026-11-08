import type { Account, PlatformInfo, Profile } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote } from '../../ui'
import { AgentRunPanel } from './AgentRunPanel'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from './model'

/**
 * The accounts of a profile (DEC-019): one row per platform, its login there. A profile has one account per platform, so the rows are
 * the platforms the profile is meant for plus any platform where it already has a login. From a row the owner makes the account (the
 * e-mail, the password and the registration follow in the account card) or has the AI fill in the profile on the site.
 */
export function ProfileAccounts({ profile, accounts, platforms, onOpenAccount }: { profile: Profile; accounts: Account[]; platforms: PlatformInfo[]; onOpenAccount: (accountId: string) => void }) {
  const everyAccount = useQuery('accounts.list', undefined, ['accounts'])
  const free = (everyAccount.data ?? []).filter((a) => a.profileId === null)
  const keys = [...new Set([...profile.platforms, ...accounts.map((a) => a.platform)])]
  return (
    <Card title="Accounts of this profile">
      {keys.length === 0 ? (
        <p className="muted" data-testid={`profile-accounts-empty-${profile.id}`}>
          Choose the platforms of this profile above (and save), and an account for each shows here.
        </p>
      ) : (
        <div className="stack" data-testid={`profile-accounts-${profile.id}`}>
          {keys.map((key) => (
            <PlatformRow key={key} profile={profile} platform={platforms.find((p) => p.platform === key)} platformKey={key} account={accounts.find((a) => a.platform === key)} free={free.filter((a) => a.platform === key)} onOpenAccount={onOpenAccount} />
          ))}
        </div>
      )}
    </Card>
  )
}

function PlatformRow({ profile, platform, platformKey, account, free, onOpenAccount }: { profile: Profile; platform: PlatformInfo | undefined; platformKey: string; account: Account | undefined; free: Account[]; onOpenAccount: (accountId: string) => void }) {
  const name = platform?.label ?? platformKey
  const [create, creating] = useAction(async () => {
    const made = await call('accounts.create', { platform: platformKey, label: `${profile.label} · ${name}`, profileId: profile.id, ...(profile.productId ? { productId: profile.productId } : {}) })
    onOpenAccount(made.id)
  })
  const [adopt, adopting] = useAction((accountId: string) => call('accounts.setProfile', { accountId, profileId: profile.id }))
  return (
    <div className="stack" data-testid={`profile-platform-row-${platformKey}-${profile.id}`}>
      <div className="list-row">
        <div>
          <strong>{name}</strong>{' '}
          {account ? <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge> : <span className="muted">no account yet</span>}
          {account && <div className="muted small">{account.email ?? 'no e-mail address yet'}</div>}
        </div>
        <div className="row">
          {account ? (
            <Button onClick={() => onOpenAccount(account.id)} data-testid={`profile-account-open-${platformKey}-${profile.id}`}>
              Open account
            </Button>
          ) : (
            <>
              {free.length > 0 && (
                <select className="input" value="" disabled={adopting.busy} onChange={(e) => e.target.value && void adopt(e.target.value)} aria-label={`Use an account you already have on ${name}`} data-testid={`profile-account-adopt-${platformKey}-${profile.id}`}>
                  <option value="">Use an account I already have…</option>
                  {free.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              )}
              <Button variant="primary" onClick={() => void create()} disabled={creating.busy} data-testid={`profile-account-create-${platformKey}-${profile.id}`}>
                {creating.busy ? 'Making…' : 'Make an account'}
              </Button>
            </>
          )}
        </div>
      </div>
      {account && <FillProfile profile={profile} account={account} />}
      <ErrorNote error={creating.error ?? adopting.error} />
    </div>
  )
}

/** "Fill in the profile on the site (AI)" for a signed-in account, and what the AI is doing there. */
function FillProfile({ profile, account }: { profile: Profile; account: Account }) {
  const agent = useQuery('agent.state', { accountId: account.id }, ['accounts'])
  const canFill = useQuery('agent.canStart', { accountId: account.id, kind: 'profile' }, ['accounts', 'settings'])
  const [fill, filling] = useAction(() => call('agent.start', { accountId: account.id, kind: 'profile' }))
  const [stop, stopping] = useAction(() => call('agent.stop', { accountId: account.id }))
  const run = agent.data ?? null
  const working = run?.status === 'running'
  const signedIn = account.status === 'ready'
  const reason = !signedIn ? 'Sign this account in first (open it, step 5).' : canFill.data && !canFill.data.ready ? canFill.data.reason : null
  return (
    <div className="stack">
      <div className="row">
        <Button variant={!reason ? 'primary' : undefined} onClick={() => void fill()} disabled={filling.busy || working || reason !== null} data-testid={`profile-fill-${account.id}`}>
          {filling.busy ? 'Starting…' : 'Fill in the profile on the site (AI)'}
        </Button>
        {reason && !working && (
          <span className="muted small" data-testid={`profile-fill-why-${account.id}`}>
            {reason}
          </span>
        )}
      </div>
      <ErrorNote error={filling.error ?? stopping.error} />
      {run?.kind === 'profile' && <AgentRunPanel run={run} onStop={() => void stop()} stopping={stopping.busy} testId={`profile-run-${account.id}`} />}
      {profile.status !== 'approved' && signedIn && <p className="muted small">The profile has to be approved before the AI fills it in.</p>}
    </div>
  )
}
