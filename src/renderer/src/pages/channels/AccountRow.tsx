import { useState } from 'react'
import type { Account, Channel, Mailbox, PlatformInfo, Product, VaultStatus } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote } from '../../ui'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from './model'
import { AccountEmail } from './AccountEmail'
import { AccountPassword } from './AccountPassword'
import { RoleEditor } from './RoleEditor'
import { SignUpHelp } from './SignUpHelp'

/** What an account is used for, in words: "Natal Mystic (2 channels), Tarot Deck (1 channel)". */
export function usedByText(channels: Channel[], products: Product[]): string {
  if (channels.length === 0) return 'not used by any channel yet'
  const perProduct = new Map<string, number>()
  for (const c of channels) perProduct.set(c.productId, (perProduct.get(c.productId) ?? 0) + 1)
  return [...perProduct].map(([id, n]) => `${products.find((p) => p.id === id)?.name ?? 'another product'} (${n} channel${n === 1 ? '' : 's'})`).join(', ')
}

/** One account of the library (DEC-015): its sign-in state, its address, the products that use it and the controls for the browser hand-off. */
export function AccountRow({
  account,
  channels,
  products,
  platforms,
  mailboxes,
  vault
}: {
  account: Account
  /** The channels that use this account, of every product. */
  channels: Channel[]
  products: Product[]
  platforms: PlatformInfo[]
  mailboxes: Mailbox[]
  vault: VaultStatus | undefined
}) {
  const [address, setAddress] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [open, opening] = useAction(() => call('accounts.openBrowser', { accountId: account.id, ...(address.trim() ? { url: address.trim() } : {}) }))
  const [check, checking] = useAction(() => call('accounts.checkLogin', { accountId: account.id }))
  const [take, taking] = useAction(() => call('accounts.takeControl', { accountId: account.id }))
  const [release, releasing] = useAction(() => call('accounts.releaseControl', { accountId: account.id }))
  const [remove, removing] = useAction(() => call('accounts.remove', { id: account.id }))
  const error = opening.error ?? checking.error ?? taking.error ?? releasing.error ?? removing.error
  const info = platforms.find((p) => p.platform === account.platform)
  const productCount = new Set(channels.map((c) => c.productId)).size

  return (
    <div className="list-row account-row" data-testid={`account-${account.id}`}>
      <div className="account-main">
        <div>
          <strong>{account.label}</strong> <span className="muted">{platformLabel(account.platform, platforms)}</span>{' '}
          <Badge tone={ACCOUNT_STATUS_TONE[account.status]}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>
          <div className="muted small" data-testid={`account-identity-${account.id}`}>
            {account.identity ? `Signed in as ${account.identity}` : 'Account name on the platform not confirmed yet'} · {usedByText(channels, products)}
          </div>
          {productCount > 1 && (
            <div className="note warn" data-testid={`account-shared-${account.id}`}>
              This account serves {productCount} products. Their sends share one allowance, only one of them can control its browser at a time, and a platform may see one account promoting several things as spam.
            </div>
          )}
        </div>
        <div className="account-controls">
          <input
            className="input account-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Page to open (optional)"
            aria-label={`Page to open for ${account.label}`}
            data-testid={`account-address-${account.id}`}
          />
          <Button variant="primary" onClick={() => void open()} disabled={opening.busy} data-testid={`account-open-${account.id}`}>
            Open browser to sign in
          </Button>
          <Button onClick={() => void check()} disabled={checking.busy} data-testid={`account-check-${account.id}`}>
            {checking.busy ? 'Checking…' : 'Check sign-in'}
          </Button>
        </div>
      </div>
      <AccountEmail account={account} mailboxes={mailboxes} />
      {info?.signupUrl && vault && account.status !== 'ready' && <SignUpHelp account={account} info={info} vaultAvailable={vault.available} hasPassword={vault.accountIds.includes(account.id)} />}
      {vault && <AccountPassword account={account} vaultAvailable={vault.available} hasPassword={vault.accountIds.includes(account.id)} />}
      <RoleEditor account={account} />
      <div className="row">
        <Button onClick={() => void take()} disabled={taking.busy} data-testid={`account-take-${account.id}`} title="Stops the app from using this browser until you give it back">
          Take control
        </Button>
        <Button onClick={() => void release()} disabled={releasing.busy} data-testid={`account-release-${account.id}`} title="The app may use this browser again">
          Give control back to the app
        </Button>
        <span className="sep" />
        {confirmRemove ? (
          <>
            <span className="muted small">Removes the account and erases its saved sign-in from this Mac.</span>
            <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`account-remove-confirm-${account.id}`}>
              Remove
            </Button>
            <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirmRemove(true)} data-testid={`account-remove-${account.id}`}>
            Remove account
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
    </div>
  )
}
