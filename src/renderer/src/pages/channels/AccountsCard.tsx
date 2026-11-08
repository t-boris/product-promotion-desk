import type { Account, Channel, PlatformInfo } from '../../../../shared/types'
import { accountsNewHref } from '../../route'
import { Badge, Button, Card, EmptyState } from '../../ui'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'

/**
 * The accounts this product works with (DEC-015): those its channels use and those that were made for it. Accounts are one
 * library with its own section, where they are added, signed in, given an address and a password; here they are only listed.
 */
export function AccountsCard({ accounts, channels, platforms }: { accounts: Account[]; /** The channels of this product. */ channels: Channel[]; platforms: PlatformInfo[] }) {
  return (
    <Card
      title="Accounts of this product"
      actions={
        <Button onClick={() => (window.location.hash = accountsNewHref())} data-testid="product-add-account">
          Add a new account
        </Button>
      }
    >
      <p className="muted small" data-testid="product-accounts-note">
        Accounts live in the <a href="#/accounts">Accounts section</a>, and any product can use any of them. Here you see the ones this product uses.
      </p>
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">Add an account, or connect a channel through one that already exists.</EmptyState>
      ) : (
        <div className="stack">
          {accounts.map((account) => {
            const used = channels.filter((c) => c.accountId === account.id).length
            return (
              <div className="list-row" key={account.id} data-testid={`product-account-${account.id}`}>
                <div>
                  <strong>{account.label}</strong> <span className="muted">{platformLabel(account.platform, platforms)}</span>{' '}
                  <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>
                  <div className="muted small">
                    {account.role ? `Role: ${account.role.name} · ` : ''}
                    {account.email ?? 'no e-mail address yet'} · {used} channel{used === 1 ? '' : 's'} of this product
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
