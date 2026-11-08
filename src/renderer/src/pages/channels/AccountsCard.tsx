import type { Account, Channel, Mailbox, PlatformInfo } from '../../../../shared/types'
import { Badge, Card, EmptyState } from '../../ui'
import { CreateAccount, type RolePrefill } from './CreateAccount'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'

/**
 * The accounts this product works with (DEC-015): those its channels use and those that were made for it. Accounts themselves are
 * one library in the Accounts section, where they are signed in, given addresses and passwords; here they are only listed, and a
 * new one can be added with a role suggested for this product.
 */
export function AccountsCard({
  productId,
  accounts,
  channels,
  platforms,
  mailboxes,
  rolePrefill
}: {
  productId: string
  accounts: Account[]
  /** The channels of this product. */
  channels: Channel[]
  platforms: PlatformInfo[]
  mailboxes: Mailbox[]
  rolePrefill: RolePrefill | null
}) {
  return (
    <Card title="Accounts of this product" actions={<a href="#/accounts">Open the Accounts section</a>}>
      <p className="muted small" data-testid="product-accounts-note">
        Accounts are kept in one library, in the <a href="#/accounts">Accounts section</a>, and any product can use any of them. Sign in, set the e-mail address or the password there. Here you see the ones this product uses.
      </p>
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">Add an account below, or connect a channel through an account that already exists in the library.</EmptyState>
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
      <h3 style={{ margin: '16px 0 0' }}>Add an account</h3>
      <CreateAccount productId={productId} platforms={platforms} mailboxes={mailboxes} prefill={rolePrefill} />
    </Card>
  )
}
