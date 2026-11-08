import { useQuery } from '../hooks'
import { Card, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { AccountRow } from './channels/AccountRow'
import { CreateAccount } from './channels/CreateAccount'
import { MailboxesCard } from './channels/MailboxesCard'
import './channels/channels.css'

/**
 * The account library (DEC-015, REQ-014): every account the owner promotes from, whichever product uses it. An account is created
 * on its own, given an e-mail address, signed in, and only then linked to channels of any product.
 */
export function AccountsPage() {
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const channels = useQuery('channels.list', undefined, ['channels'])
  const products = useQuery('products.list', undefined, ['products'])
  const platforms = useQuery('platforms.list', undefined, [])
  const mailboxes = useQuery('mailboxes.list', undefined, ['accounts'])
  const vault = useQuery('vault.status', undefined, ['accounts'])

  const list = accounts.data ?? []
  const allChannels = channels.data ?? []
  const loading = (accounts.loading && !accounts.data) || (channels.loading && !channels.data)

  return (
    <Page title="Accounts" subtitle="Your logins on the platforms, with an e-mail address and a saved password for each. Any product can use any of them.">
      <ErrorNote error={accounts.error ?? channels.error ?? products.error ?? platforms.error ?? mailboxes.error} />
      {loading && <Loading what="Loading accounts" />}
      <div className="stack">
        <MailboxesCard mailboxes={mailboxes.data ?? []} />
        <Card title="Your accounts">
          <div className="note" data-testid="login-instructions">
            <strong>How signing in works.</strong> Either sign in yourself: press “Open browser to sign in” and sign in on the site, in the window that opens; the app does not touch the page while you are in control. When you are done, press “Give control back to the app” in that window (or close it), then “Check sign-in”. Or save the account’s password under “Password”: it is encrypted by the macOS keychain and stays on this Mac, and the app uses it only to fill in the sign-in form of this account’s own browser, once. A CAPTCHA, a code or any other check is always yours: the app stops and tells you. The sign-in stays saved for this account between restarts.
          </div>
          {list.length === 0 && !loading ? (
            <EmptyState title="No accounts yet">Add the first account below. If it does not exist on the platform yet, the app opens the registration page for you.</EmptyState>
          ) : (
            <div className="stack">
              {list.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  channels={allChannels.filter((c) => c.accountId === account.id)}
                  products={products.data ?? []}
                  platforms={platforms.data ?? []}
                  mailboxes={mailboxes.data ?? []}
                  vault={vault.data}
                />
              ))}
            </div>
          )}
          <h3 style={{ margin: '16px 0 0' }}>Add an account</h3>
          <CreateAccount platforms={platforms.data ?? []} mailboxes={mailboxes.data ?? []} prefill={null} />
        </Card>
      </div>
    </Page>
  )
}
