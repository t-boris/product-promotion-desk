import { useState, type FormEvent } from 'react'
import type { Account, Channel, Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field } from '../../ui'
import { PLATFORM_OPTIONS, platformLabel } from './model'

/** Connects a product, an account and a channel address. Nothing is posted and nothing is read yet. */
export function ConnectChannel({ products, accounts, onConnected }: { products: Product[]; accounts: Account[]; onConnected: (channel: Channel) => void }) {
  const [productId, setProductId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [target, setTarget] = useState('')
  const [connect, state] = useAction((args: { productId: string; accountId: string; target: string }) => call('channels.connect', args))

  const product = productId || products[0]?.id || ''
  const account = accountId || accounts[0]?.id || ''
  const platform = accounts.find((a) => a.id === account)?.platform
  const hint = PLATFORM_OPTIONS.find((p) => p.id === platform)?.addressHint ?? 'r/astrology or a web address'
  const ready = product !== '' && account !== '' && target.trim() !== ''

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready) return
    const channel = await connect({ productId: product, accountId: account, target: target.trim() })
    if (channel) {
      setTarget('')
      onConnected(channel)
    }
  }

  return (
    <Card title="Connect a channel">
      {products.length === 0 && <p className="muted">Create a product first (Products page): a channel always promotes one product.</p>}
      {products.length > 0 && accounts.length === 0 && <p className="muted">Add an account above first.</p>}
      <form onSubmit={(e) => void submit(e)} data-testid="connect-form">
        <div className="settings-grid">
          <Field label="Product">
            <select className="input" value={product} onChange={(e) => setProductId(e.target.value)} disabled={products.length === 0} data-testid="connect-product">
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account">
            <select className="input" value={account} onChange={(e) => setAccountId(e.target.value)} disabled={accounts.length === 0} data-testid="connect-account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({platformLabel(a.platform)})
                </option>
              ))}
            </select>
          </Field>
          <div className="wide">
            <Field label="Channel address" hint={`For example ${hint}. Connecting only saves it: nothing is posted.`}>
              <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={hint.split(' or ')[0]} data-testid="connect-target" />
            </Field>
          </div>
        </div>
        <ErrorNote error={state.error} />
        <Button variant="primary" type="submit" disabled={!ready || state.busy} data-testid="connect-submit">
          {state.busy ? 'Connecting…' : 'Connect channel'}
        </Button>
      </form>
    </Card>
  )
}
