import type { Account, Mailbox, PlatformInfo, VaultStatus } from '../../../../shared/types'
import { Badge } from '../../ui'
import { AccountEmail } from './AccountEmail'
import { AccountMore } from './AccountMore'
import { AccountPassword } from './AccountPassword'
import { AccountProfile } from './AccountProfile'
import { AccountSignIn } from './AccountSignIn'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'
import { nextStep } from './next-step'
import { platformMismatch } from './platform-hint'
import { RoleEditor } from './RoleEditor'

/**
 * One account, in the order the owner works (DEC-015): what comes next, then its role, its e-mail address, its password and the
 * sign-in. It says nothing about channels or products: an account is only about the account.
 */
export function AccountDetail({ account, platforms, mailboxes, vault }: { account: Account; platforms: PlatformInfo[]; mailboxes: Mailbox[]; vault: VaultStatus | undefined }) {
  const info = platforms.find((p) => p.platform === account.platform)
  const hasPassword = vault?.accountIds.includes(account.id) ?? false
  const step = nextStep(account, hasPassword, vault?.available ?? true)
  const mismatch = platformMismatch(account.label, account.platform, platforms)

  return (
    <div className="acct-detail stack" data-testid={`account-${account.id}`}>
      <div className="acct-detail-head">
        <h2>{account.label}</h2>
        <span className="muted">{platformLabel(account.platform, platforms)}</span>
        <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>
      </div>
      {mismatch && (
        <div className="note warn" role="status" data-testid={`account-platform-mismatch-${account.id}`}>
          {mismatch}
        </div>
      )}
      <div className={`note ${step.block === null ? 'good' : ''}`} data-testid={`account-next-step-${account.id}`}>
        {step.text}
      </div>
      <RoleEditor account={account} />
      <AccountProfile account={account} />
      <AccountEmail account={account} mailboxes={mailboxes} />
      {vault && <AccountPassword account={account} vaultAvailable={vault.available} hasPassword={hasPassword} />}
      <AccountSignIn account={account} info={info} vaultAvailable={vault?.available ?? false} hasPassword={hasPassword} />
      <AccountMore account={account} />
    </div>
  )
}
