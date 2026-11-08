import type { Account, PlatformInfo } from '../../../../shared/types'
import { Badge } from '../../ui'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'

/** The accounts of the library, one line each: its name, its platform and whether it is signed in. */
export function AccountList({ accounts, platforms, selectedId, onSelect }: { accounts: Account[]; platforms: PlatformInfo[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="stack" data-testid="account-list">
      {accounts.map((account) => (
        <div
          key={account.id}
          className={`list-row selectable ${account.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(account.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(account.id)}
          data-testid={`account-row-${account.id}`}
        >
          <div className="acct-list-name">
            <strong>{account.label}</strong>
            <div className="muted small">{platformLabel(account.platform, platforms)}</div>
          </div>
          <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>
        </div>
      ))}
    </div>
  )
}
