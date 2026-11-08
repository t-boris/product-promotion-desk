import type { Account, Channel } from '../../../../shared/types'
import { Card, EmptyState } from '../../ui'
import { AccountRow } from './AccountRow'
import { CreateAccount } from './CreateAccount'

/**
 * Accounts and the sign-in hand-off. The one rule worth repeating on screen: passwords are typed on the
 * platform's own page in the account's browser, never into this application.
 */
export function AccountsCard({ accounts, channels }: { accounts: Account[]; channels: Channel[] }) {
  return (
    <Card title="Accounts">
      <div className="note" data-testid="login-instructions">
        <strong>How signing in works.</strong> Press “Open browser to sign in” and sign in on the site itself, in the window that opens. You type your password there; this application never sees, asks for or stores it, and it does not touch the page while you are in control. When you are done, press “Give control back to the app” in that window (or close it), then “Check sign-in”. The sign-in stays saved for this account between restarts.
      </div>
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">Add the account you promote from. One account can serve several channels and products.</EmptyState>
      ) : (
        <div className="stack">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} channelCount={channels.filter((c) => c.accountId === account.id).length} />
          ))}
        </div>
      )}
      <h3 style={{ margin: '16px 0 0' }}>Add an account</h3>
      <CreateAccount onCreated={() => undefined} />
    </Card>
  )
}
