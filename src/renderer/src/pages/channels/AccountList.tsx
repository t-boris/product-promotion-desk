import type { Account, PlatformInfo } from '../../../../shared/types'
import { Badge } from '../../ui'
import { AccountStatusLine } from './AccountStatus'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'

/**
 * The accounts of the library, one row each: its name on the whole first line, its platform and, when the owner has to act, the tag under it. The sign-in state is a tag only when the owner
 * has to act ("Sign-in needed"); a signed-in account is a dot and its word.
 */
export function AccountList({ accounts, platforms, selectedId, onSelect }: { accounts: Account[]; platforms: PlatformInfo[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="panel" data-testid="account-list">
      {accounts.map((account) => (
        <div
          key={account.id}
          className={`panel-row${account.id === selectedId ? ' active' : ''}`}
          onClick={() => onSelect(account.id)}
          role="button"
          tabIndex={0}
          aria-current={account.id === selectedId ? 'true' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(account.id)
            }
          }}
          data-testid={`account-row-${account.id}`}
        >
          <div className="panel-row-top">
            <span className="panel-row-title">{account.label}</span>
          </div>
          <div className="panel-row-line account-row-meta">
            <span className="account-row-platform">{platformLabel(account.platform, platforms)}</span>
            {account.status !== 'ready' && <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>}
          </div>
          {account.status === 'ready' && (
            <div className="panel-row-line">
              <AccountStatusLine status={account.status} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
