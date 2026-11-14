import type { Account, Channel, PlatformInfo } from '../../../../shared/types'
import { accountsNewHref } from '../../route'
import { Button, Card, Hint, More, useMainVariant } from '../../ui'
import { AccountStatusLine } from './AccountStatus'
import { platformLabel } from './model'

/**
 * The accounts this product works with (DEC-015): those its channels use and those that were made for it. Accounts are one
 * library with its own section, where they are added, signed in, given an address and a password; here they are only listed.
 * With none, the card is one line with the one button that fixes it (QA findings 41, 49), not a large empty box with three paths.
 * "Add an account" is the tab's filled button while the app has no account at all (`filled`); with accounts it is a bezel.
 */
export function AccountsCard({
  accounts,
  libraryHasAccounts,
  channels,
  platforms,
  filled
}: {
  /** The accounts of this product. */
  accounts: Account[]
  /** Whether the app has any account at all: any of them can serve this product (DEC-015). */
  libraryHasAccounts: boolean
  /** The channels of this product. */
  channels: Channel[]
  platforms: PlatformInfo[]
  /** Setting up is at its first step: the app has no account, so this is the screen's filled button. */
  filled: boolean
}) {
  const main = useMainVariant()
  const add = (
    <Button variant={filled ? main : 'ghost'} onClick={() => (window.location.hash = accountsNewHref())} data-testid="product-add-account">
      {libraryHasAccounts ? 'Add a new account' : 'Add an account'}
    </Button>
  )
  if (accounts.length === 0) {
    return (
      <Card className="accounts-strip">
        <div className="strip" data-testid="product-accounts-empty">
          <div>
            <h2>Accounts of this product</h2>
            <Hint data-testid="product-accounts-note">
              {libraryHasAccounts
                ? 'No account serves this product yet. Choose one of your accounts when you connect a channel below.'
                : 'No accounts yet. A channel is reached through an account, so add one first.'}
            </Hint>
          </div>
          {add}
        </div>
      </Card>
    )
  }
  return (
    <Card title="Accounts of this product" actions={add}>
      <div className="rows">
        {accounts.map((account) => {
          const used = channels.filter((c) => c.accountId === account.id).length
          return (
            <div key={account.id} data-testid={`product-account-${account.id}`}>
              <div className="account-line">
                <strong>{account.label}</strong> <span className="muted">{platformLabel(account.platform, platforms)}</span> <AccountStatusLine status={account.status} />
              </div>
              <div className="hint">
                {account.role ? `Role: ${account.role.name} · ` : ''}
                {account.email ?? 'no e-mail address yet'} · {used} channel{used === 1 ? '' : 's'} of this product
              </div>
            </div>
          )
        })}
      </div>
      <More label="About accounts">
        <Hint data-testid="product-accounts-note">
          Accounts live in the <a href="#/accounts">Accounts section</a>, and any product can use any of them. Here you see the ones this product uses.
        </Hint>
      </More>
    </Card>
  )
}
