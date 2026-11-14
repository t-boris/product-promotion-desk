import { useEffect, useState, type FormEvent } from 'react'
import type { Account, Channel, ChannelSuggestion, PlatformInfo, Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field, Hint } from '../../ui'
import { accountOptionLabel, addressExample, isSameAddress, isWebAddress, platformLabel, platformOfSuggestion, typedAddress } from './model'
import { PrepareSiteProfile } from './PrepareSiteProfile'

export const ONE_LOGIN_SPEAKS = 'Only one login of this product speaks in a discussion. The other logins stay quiet in it.'

/** What a suggestion asks to fill in; a new object each time, so choosing the same idea twice fills the form again. */
export interface Prefill {
  suggestion: ChannelSuggestion
}

interface Props {
  product: Product | undefined
  /** There is no account in the app yet: the card is dimmed and says so once (BUG-030). Decided by the Channels tab. */
  needsAccount: boolean
  /** Every account of the library (DEC-015): any of them can serve this product. */
  accounts: Account[]
  /** This product's channels, to explain what happens when a second login joins the same community. */
  channels: Channel[]
  /** The channels of every product, to say which other products an account already serves. */
  allChannels: Channel[]
  platforms: PlatformInfo[]
  productName: (productId: string | null) => string
  prefill: Prefill | null
  onConnected: (channel: Channel) => void
}

/** Connects this product to a channel address through an account of the library. Nothing is posted and nothing is read yet. */
export function ConnectChannel({ product, needsAccount, accounts, channels, allChannels, platforms, productName, prefill, onConnected }: Props) {
  const [accountId, setAccountId] = useState('')
  const [target, setTarget] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [justJoined, setJustJoined] = useState(false)
  const [connect, state] = useAction((args: { productId: string; accountId: string; target: string }) => call('channels.connect', args))

  const productId = product?.id ?? ''
  // The product's own accounts come first: the ones its channels use and the ones made for it.
  const mine = accounts.filter((a) => a.productId === productId || channels.some((c) => c.accountId === a.id))
  const others = accounts.filter((a) => !mine.includes(a))
  const account = accounts.find((a) => a.id === accountId) ?? mine[0] ?? others[0]
  const info = platforms.find((p) => p.platform === account?.platform)
  // A handle on a named platform stands for an address; the rest of this form works with that address.
  const address = typedAddress(info, target)
  const ready = productId !== '' && account !== undefined && target.trim() !== ''
  // The other products this account already serves: a warning, not a block.
  const alsoServes = account ? [...new Set(allChannels.filter((c) => c.accountId === account.id && c.productId !== productId).map((c) => productName(c.productId)))] : []
  // Another login of this product is already in that community: say how discussions are shared between logins.
  const otherLoginThere = account !== undefined && target.trim() !== '' && channels.some((c) => c.productId === productId && c.accountId !== account.id && isSameAddress(address, c))

  // "Use this" on a suggestion: fill in the address and pick a login of the suggested platform, if there is one.
  useEffect(() => {
    if (!prefill) return
    const wanted = platformOfSuggestion(prefill.suggestion, platforms)
    const match = wanted ? (mine.find((a) => a.platform === wanted.platform) ?? accounts.find((a) => a.platform === wanted.platform)) : undefined
    setTarget(prefill.suggestion.target)
    setJustJoined(false)
    if (match) {
      setAccountId(match.id)
      setNotice(null)
    } else {
      setNotice(`Add a ${platformLabel(prefill.suggestion.platform, platforms)} account first (in the Accounts section), then choose it here.`)
    }
    // Only a new suggestion should refill the form, not later changes of the account lists.
  }, [prefill])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready || !account) return
    const channel = await connect({ productId, accountId: account.id, target: target.trim() })
    if (channel) {
      setJustJoined(otherLoginThere)
      setTarget('')
      setNotice(null)
      onConnected(channel)
    }
  }

  return (
    <Card title="Connect a channel" className={needsAccount ? 'dimmed' : ''}>
      {!product && <p className="muted">This product was not found.</p>}
      {product &&
        (needsAccount ? (
          <Hint data-testid="connect-needs-account">Needs an account</Hint>
        ) : (
          <Hint>
            Connecting saves the address for <strong>{product.name}</strong>: nothing is posted and nothing is read yet.
          </Hint>
        ))}
      <form onSubmit={(e) => void submit(e)} data-testid="connect-form">
        <div className="settings-grid">
          <Field label="Account">
            <select className="input" value={account?.id ?? ''} onChange={(e) => setAccountId(e.target.value)} disabled={accounts.length === 0} data-testid="connect-account">
              {account === undefined && <option value="">Choose an account</option>}
              {mine.length > 0 && (
                <optgroup label={others.length > 0 ? 'Used by this product' : 'Accounts'}>
                  {mine.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountOptionLabel(a, platforms)}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label={mine.length > 0 ? 'Other accounts of the library' : 'Accounts'}>
                  {others.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountOptionLabel(a, platforms)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Channel address" hint={address !== target.trim() ? `Address: ${address}.` : info?.hint}>
            <input
              className="input"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                setJustJoined(false)
              }}
              placeholder={addressExample(info)}
              disabled={needsAccount}
              data-testid="connect-target"
            />
          </Field>
        </div>
        {alsoServes.length > 0 && (
          <div className="note warn" data-testid="share-notice">
            <p>
              This account also serves {alsoServes.map((n) => `“${n}”`).join(', ')}. That is allowed, but it has one set of limits for all its channels, only one party (you or the app) controls its browser at a time, and a platform may see one account promoting several things as spam.
            </p>
          </div>
        )}
        {(otherLoginThere || justJoined) && (
          <div className="note" data-testid="one-login-speaks">
            {ONE_LOGIN_SPEAKS}
          </div>
        )}
        {notice && (
          <div className="note warn" data-testid="connect-notice">
            {notice}
          </div>
        )}
        <ErrorNote error={state.error} />
        <div className="row">
          <Button variant="primary" type="submit" disabled={!ready || state.busy} data-testid="connect-submit">
            {state.busy ? 'Connecting…' : 'Connect channel'}
          </Button>
          {/* Why the button is off, beside it. */}
          {!ready && product && !needsAccount && <Hint data-testid="connect-reason">Type the channel address.</Hint>}
        </div>
      </form>
      {account && info && !info.prepared && isWebAddress(address) && <PrepareSiteProfile key={`${account.id}|${address}`} productId={productId} accountId={account.id} url={address} />}
    </Card>
  )
}
