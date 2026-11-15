import type { Account, Mailbox, PlatformInfo, VaultStatus } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { AccountBrowser } from './AccountBrowser'
import { AccountEmail } from './AccountEmail'
import { AccountHeader } from './AccountHeader'
import { AccountMore } from './AccountMore'
import { AccountPassword } from './AccountPassword'
import { AccountProfileLine } from './AccountProfileLine'
import { AccountSignIn } from './AccountSignIn'
import { AccountStatusLine } from './AccountStatus'
import { AccountViaLine } from './AccountViaLine'
import { platformLabel } from './model'
import { nextStep, type NextStep } from './next-step'
import { platformMismatch } from './platform-hint'
import { RoleEditor } from './RoleEditor'

/**
 * One account, in the order the owner works (DEC-015): its header, what comes next, then its role, its profile, its e-mail address, its
 * password and the sign-in. It says nothing about channels or products: an account is only about the account. The one filled button is
 * the button of the step `nextStep` names (visual-system.md §10.3); the other steps keep a bezel. The browser of the account (DEC-026) is
 * a setting between the steps and the sign-in. An account that signs in through another (Threads through Instagram, DEC-027) has no e-mail
 * and no password: that account stands in their place, and the sign-in is the step after it.
 */
export function AccountDetail({
  account,
  platforms,
  mailboxes,
  vault,
  onOpenProfile,
  onOpenAccount
}: {
  account: Account
  platforms: PlatformInfo[]
  mailboxes: Mailbox[]
  vault: VaultStatus | undefined
  onOpenProfile: (profileId: string) => void
  onOpenAccount: (accountId: string) => void
}) {
  const info = platforms.find((p) => p.platform === account.platform)
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const hasPassword = vault?.accountIds.includes(account.id) ?? false
  // The platform this login signs in with, and the account it does so through (null until chosen).
  const wantedPlatform = info?.signsInWith
  const wantedLabel = wantedPlatform ? platformLabel(wantedPlatform, platforms) : ''
  const via = account.signsInVia ? ((accounts.data ?? []).find((a) => a.id === account.signsInVia) ?? null) : null
  const viaLoading = Boolean(account.signsInVia) && accounts.data === undefined
  const viaHasPassword = via ? (vault?.accountIds.includes(via.id) ?? false) : false
  const step: NextStep = viaLoading
    ? { block: null, text: 'Loading…' }
    : nextStep(account, hasPassword, vault?.available ?? true, wantedPlatform ? { account: via, label: wantedLabel, hasPassword: viaHasPassword } : undefined)
  const mismatch = platformMismatch(account.label, account.platform, platforms)

  return (
    <div className="pane" data-testid={`account-${account.id}`}>
      <AccountHeader
        account={account}
        meta={
          <>
            <span>{platformLabel(account.platform, platforms)}</span>
            <AccountStatusLine status={account.status} />
          </>
        }
      />
      {mismatch && (
        <div className="note warn" role="status" data-testid={`account-platform-mismatch-${account.id}`}>
          {mismatch}
        </div>
      )}
      <div className={`note ${step.block === null ? 'good' : ''}`} data-testid={`account-next-step-${account.id}`}>
        {step.text}
      </div>
      <RoleEditor account={account} />
      <AccountProfileLine account={account} onOpenProfile={onOpenProfile} />
      {wantedPlatform ? (
        <AccountViaLine account={account} via={via} wantedPlatform={wantedPlatform} wantedLabel={wantedLabel} accounts={accounts.data ?? []} next={step.block} onOpenAccount={onOpenAccount} />
      ) : (
        <>
          <AccountEmail account={account} mailboxes={mailboxes} next={step.block} />
          {vault && <AccountPassword account={account} unavailable={vault.unavailable} hasPassword={hasPassword} next={step.block} />}
        </>
      )}
      <AccountBrowser account={account} />
      <AccountSignIn
        account={account}
        info={info}
        step={wantedPlatform ? 4 : 5}
        through={wantedPlatform ? { label: wantedLabel, account: via } : undefined}
        vaultAvailable={vault?.available ?? false}
        hasPassword={hasPassword}
        next={step.block}
      />
      <AccountMore account={account} />
    </div>
  )
}
