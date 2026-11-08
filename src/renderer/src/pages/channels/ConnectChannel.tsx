import { useEffect, useState, type FormEvent } from 'react'
import type { Account, Channel, ChannelSuggestion, PlatformInfo, Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field } from '../../ui'
import { addressExample, isWebAddress, platformLabel, platformOfSuggestion } from './model'
import { PrepareSiteProfile } from './PrepareSiteProfile'

export const SHARE_CONSENT = 'I want to share this login: limits are shared and only one party controls its browser'

/** What a suggestion asks to fill in; a new object each time, so choosing the same idea twice fills the form again. */
export interface Prefill {
  suggestion: ChannelSuggestion
}

interface Props {
  product: Product | undefined
  /** This product's logins (and unassigned ones). */
  accounts: Account[]
  /** Logins of other products; using one needs the owner's explicit consent. */
  sharedAccounts: Account[]
  platforms: PlatformInfo[]
  productName: (productId: string | null) => string
  prefill: Prefill | null
  onConnected: (channel: Channel) => void
}

/** Connects this product to a channel address through one of its logins. Nothing is posted and nothing is read yet. */
export function ConnectChannel({ product, accounts, sharedAccounts, platforms, productName, prefill, onConnected }: Props) {
  const [accountId, setAccountId] = useState('')
  const [target, setTarget] = useState('')
  const [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [connect, state] = useAction((args: { productId: string; accountId: string; target: string; reuseAccount?: boolean }) => call('channels.connect', args))

  const everyAccount = [...accounts, ...sharedAccounts]
  const account = everyAccount.find((a) => a.id === accountId) ?? accounts[0]
  const shared = account !== undefined && sharedAccounts.some((a) => a.id === account.id)
  const info = platforms.find((p) => p.platform === account?.platform)
  const productId = product?.id ?? ''
  const ready = productId !== '' && account !== undefined && target.trim() !== '' && (!shared || consent)
  const sharedOwner = shared && account ? productName(account.productId) : ''

  // "Use this" on a suggestion: fill in the address and pick a login of the suggested platform, if there is one.
  useEffect(() => {
    if (!prefill) return
    const wanted = platformOfSuggestion(prefill.suggestion, platforms)
    const match = wanted ? (accounts.find((a) => a.platform === wanted.platform) ?? sharedAccounts.find((a) => a.platform === wanted.platform)) : undefined
    setTarget(prefill.suggestion.target)
    setConsent(false)
    if (match) {
      setAccountId(match.id)
      setNotice(null)
    } else {
      setNotice(`Add a ${platformLabel(prefill.suggestion.platform, platforms)} account above first, then choose it here.`)
    }
    // Only a new suggestion should refill the form, not later changes of the account lists.
  }, [prefill])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready || !account) return
    const channel = await connect({ productId, accountId: account.id, target: target.trim(), ...(shared ? { reuseAccount: true } : {}) })
    if (channel) {
      setTarget('')
      setConsent(false)
      setNotice(null)
      onConnected(channel)
    }
  }

  return (
    <Card title="Connect a channel">
      {!product && <p className="muted">This product was not found.</p>}
      {product && accounts.length === 0 && sharedAccounts.length === 0 && <p className="muted">Add an account above first.</p>}
      {product && <p className="muted small">The channel is for <strong>{product.name}</strong>.</p>}
      <form onSubmit={(e) => void submit(e)} data-testid="connect-form">
        <div className="settings-grid">
          <Field label="Account">
            <select
              className="input"
              value={account?.id ?? ''}
              onChange={(e) => {
                setAccountId(e.target.value)
                setConsent(false)
              }}
              disabled={everyAccount.length === 0}
              data-testid="connect-account"
            >
              {account === undefined && <option value="">Choose an account</option>}
              <optgroup label={sharedAccounts.length > 0 ? 'Logins of this product' : 'This product'}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({platformLabel(a.platform, platforms)})
                  </option>
                ))}
              </optgroup>
              {sharedAccounts.length > 0 && (
                <optgroup label="Another product’s login (shared)">
                  {sharedAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} ({platformLabel(a.platform, platforms)}) — {productName(a.productId)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Channel address" hint="Connecting only saves it: nothing is posted.">
            <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={addressExample(info)} data-testid="connect-target" />
          </Field>
        </div>
        {shared && (
          <div className="note warn" data-testid="share-notice">
            <p>
              This login belongs to “{sharedOwner}”. A separate login for this product is safer: a shared login has one set of limits for all its channels, and only one party (you or the app) controls its browser at a time.
            </p>
            <label className="consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="share-consent" /> <span>{SHARE_CONSENT}</span>
            </label>
          </div>
        )}
        {notice && (
          <div className="note warn" data-testid="connect-notice">
            {notice}
          </div>
        )}
        <ErrorNote error={state.error} />
        <Button variant="primary" type="submit" disabled={!ready || state.busy} data-testid="connect-submit">
          {state.busy ? 'Connecting…' : 'Connect channel'}
        </Button>
      </form>
      {account && info && !info.prepared && isWebAddress(target) && !shared && <PrepareSiteProfile key={`${account.id}|${target.trim()}`} productId={productId} accountId={account.id} url={target.trim()} />}
      {account && info && !info.prepared && isWebAddress(target) && shared && (
        <p className="muted small" data-testid="profile-needs-own-login">
          To prepare a site profile, use a login of this product.
        </p>
      )}
    </Card>
  )
}
