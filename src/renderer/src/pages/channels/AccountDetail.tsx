import type { Account, Mailbox, PlatformInfo, VaultStatus } from '../../../../shared/types'
import { ObjectHeader } from '../../ui'
import { AccountEmail } from './AccountEmail'
import { AccountMore } from './AccountMore'
import { AccountPassword } from './AccountPassword'
import { AccountProfileLine } from './AccountProfileLine'
import { AccountSignIn } from './AccountSignIn'
import { AccountStatusLine } from './AccountStatus'
import { platformLabel } from './model'
import { nextStep } from './next-step'
import { platformMismatch } from './platform-hint'
import { RoleEditor } from './RoleEditor'

/**
 * One account, in the order the owner works (DEC-015): its header, what comes next, then its role, its profile, its e-mail address, its
 * password and the sign-in. It says nothing about channels or products: an account is only about the account. The one filled button is
 * the button of the step `nextStep` names (visual-system.md §10.3); the other steps keep a bezel.
 */
export function AccountDetail({ account, platforms, mailboxes, vault, onOpenProfile }: { account: Account; platforms: PlatformInfo[]; mailboxes: Mailbox[]; vault: VaultStatus | undefined; onOpenProfile: (profileId: string) => void }) {
  const info = platforms.find((p) => p.platform === account.platform)
  const hasPassword = vault?.accountIds.includes(account.id) ?? false
  const step = nextStep(account, hasPassword, vault?.available ?? true)
  const mismatch = platformMismatch(account.label, account.platform, platforms)

  return (
    <div className="pane" data-testid={`account-${account.id}`}>
      <ObjectHeader
        title={account.label}
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
      <AccountEmail account={account} mailboxes={mailboxes} next={step.block} />
      {vault && <AccountPassword account={account} unavailable={vault.unavailable} hasPassword={hasPassword} next={step.block} />}
      <AccountSignIn account={account} info={info} vaultAvailable={vault?.available ?? false} hasPassword={hasPassword} next={step.block} />
      <AccountMore account={account} />
    </div>
  )
}
