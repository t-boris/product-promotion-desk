import type { Account, Channel, PlatformInfo } from '../../../../shared/types'
import { accountsNewHref } from '../../route'
import { Badge, Button, Card, Hint, More } from '../../ui'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'

/**
 * The accounts this product works with (DEC-015): those its channels use and those that were made for it. Accounts are one
 * library with its own section, where they are added, signed in, given an address and a password; here they are only listed.
 * With none, the card is one line with the one button that fixes it (QA findings 41, 49), not a large empty box with three paths.
 */
export function AccountsCard({
  accounts,
  libraryHasAccounts,
  channels,
  platforms
}: {
  /** The accounts of this product. */
  accounts: Account[]
  /** Whether the app has any account at all: any of them can serve this product (DEC-015). */
  libraryHasAccounts: boolean
  /** The channels of this product. */
  channels: Channel[]
  platforms: PlatformInfo[]
}) {
  const add = (
    <Button variant={libraryHasAccounts ? 'ghost' : 'primary'} onClick={() => (window.location.hash = accountsNewHref())} data-testid="product-add-account">
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
      <div className="stack">
        {accounts.map((account) => {
          const used = channels.filter((c) => c.accountId === account.id).length
          return (
            <div className="list-row" key={account.id} data-testid={`product-account-${account.id}`}>
              <div>
                <strong>{account.label}</strong> <span className="muted">{platformLabel(account.platform, platforms)}</span>{' '}
                <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>
                <div className="hint">
                  {account.role ? `Role: ${account.role.name} · ` : ''}
                  {account.email ?? 'no e-mail address yet'} · {used} channel{used === 1 ? '' : 's'} of this product
                </div>
              </div>
            </div>
          )
        })}
        <More label="About accounts">
          <Hint data-testid="product-accounts-note">
            Accounts live in the <a href="#/accounts">Accounts section</a>, and any product can use any of them. Here you see the ones this product uses.
          </Hint>
        </More>
      </div>
    </Card>
  )
}
