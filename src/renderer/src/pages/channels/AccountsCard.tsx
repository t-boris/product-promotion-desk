import type { Account, Channel, PlatformInfo } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Card, EmptyState } from '../../ui'
import { AccountRow } from './AccountRow'
import { CreateAccount, type RolePrefill } from './CreateAccount'

/**
 * The logins of one product, the sign-in hand-off and the saved passwords (DEC-014). The rule worth repeating on screen: a saved
 * password is used only to fill in the sign-in form of the account's own browser, and every check stays with the owner.
 */
export function AccountsCard({ productId, accounts, channels, platforms, rolePrefill }: { productId: string; accounts: Account[]; channels: Channel[]; platforms: PlatformInfo[]; rolePrefill: RolePrefill | null }) {
  const vault = useQuery('vault.status', undefined, ['accounts'])
  return (
    <Card title="Accounts">
      <div className="note" data-testid="login-instructions">
        <strong>How signing in works.</strong> Either sign in yourself: press “Open browser to sign in” and sign in on the site, in the window that opens; the app does not touch the page while you are in control. When you are done, press “Give control back to the app” in that window (or close it), then “Check sign-in”. Or save the account’s password under “Password”: it is encrypted by the macOS keychain and stays on this Mac, and the app uses it only to fill in the sign-in form of this account’s own browser, once. A CAPTCHA, a code or any other check is always yours: the app stops and tells you. The sign-in stays saved for this account between restarts.
      </div>
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">Add the login you promote this product from. One login can serve several channels.</EmptyState>
      ) : (
        <div className="stack">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} platforms={platforms} vault={vault.data} channelCount={channels.filter((c) => c.accountId === account.id).length} />
          ))}
        </div>
      )}
      <h3 style={{ margin: '16px 0 0' }}>Add an account</h3>
      <CreateAccount productId={productId} platforms={platforms} prefill={rolePrefill} />
    </Card>
  )
}
