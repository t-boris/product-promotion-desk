import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Account, Channel, ChannelSuggestion, PlatformInfo, Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { accountsNewHref } from '../../route'
import { Badge, Button, ErrorNote, Field, Hint, ObjectHeader, useOpenForm } from '../../ui'
import { FIND_WITH_AI_NOTE, accountsFor, addressLabel, chosenAccount, connectReason, ideasForPlatform, needsSiteProfile, platformChoices, platformLine } from './add-channel'
import { accountOptionLabel, addressExample, isSameAddress, typedAddress } from './model'
import { browseAddress, browseBlocker, browseHint } from './open-browser'
import { OpenAccountBrowser } from './OpenAccountBrowser'
import { PrepareSiteProfile } from './PrepareSiteProfile'
import type { Blocked } from './suggestion-block'

export const ONE_LOGIN_SPEAKS = 'Only one login of this product speaks in a discussion. The other logins stay quiet in it.'

/**
 * "Add a channel": the one way to connect any platform, in four short steps. Where (the platform, each with a line on what the application does
 * there), which account (only that platform's; chosen for the owner when there is one), the address (typed, found in the account's own browser,
 * or an idea from the AI under the field), and Connect. Nothing is posted and nothing is read until the channel is connected; an idea is only
 * an idea until "Use this" and "Connect channel" are pressed. The accounts themselves live on their own screen: this flow only links there.
 */
export function AddChannel({
  product,
  accounts,
  channels,
  allChannels,
  platforms,
  productName,
  startPlatform,
  startTarget,
  firstAccountId,
  blocked,
  engineLabel,
  onConnected,
  onCancel
}: {
  product: Product
  /** Every account of the library: any of them can serve this product. */
  accounts: Account[]
  /** This product's channels, to say what happens when a second login joins the same community. */
  channels: Channel[]
  /** The channels of every product, to say which other products an account already serves. */
  allChannels: Channel[]
  platforms: PlatformInfo[]
  productName: (productId: string | null) => string
  /** The platform the flow starts on (an account was just made for it, or a link named it); null: the owner chooses. */
  startPlatform: string | null
  /** The address the flow starts with (a place found elsewhere); null: empty. */
  startTarget?: string | null
  /** The account to choose first (the one just made from here). */
  firstAccountId: string | null
  blocked: Blocked | null
  engineLabel: string | undefined
  onConnected: (channel: Channel) => void
  /** Closes the flow; absent when there is nothing to go back to (no channel yet). */
  onCancel?: () => void
}) {
  const submitVariant = useOpenForm()
  const [platformKey, setPlatformKey] = useState<string | null>(startPlatform)
  const [accountId, setAccountId] = useState<string | null>(firstAccountId)
  const [target, setTarget] = useState(startTarget ?? '')
  const [fromIdea, setFromIdea] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<ChannelSuggestion[] | null>(null)
  const targetRef = useRef<HTMLInputElement>(null)
  const [connect, state] = useAction((args: { productId: string; accountId: string; target: string }) => call('channels.connect', args))
  const [find, finding] = useAction((platform: string) => call('channels.suggest', { productId: product.id, platform }))

  const info = platforms.find((p) => p.platform === platformKey)
  const choices = accountsFor(platformKey, accounts, product.id, channels)
  const account = chosenAccount(choices, accountId)
  const many = choices.mine.length + choices.others.length > 1
  const address = typedAddress(info, target)
  const reason = connectReason({ platformLabel: info?.label ?? null, hasAccount: account !== undefined, target })
  const alsoServes = account ? [...new Set(allChannels.filter((c) => c.accountId === account.id && c.productId !== product.id).map((c) => productName(c.productId)))] : []
  // Another login of this product is already in that community: say how discussions are shared between logins.
  const otherLoginThere = account !== undefined && target.trim() !== '' && channels.some((c) => c.productId === product.id && c.accountId !== account.id && isSameAddress(address, c))
  const ideasHere = ideasForPlatform(ideas ?? [], info, platforms)

  // A platform chosen again starts the address over: what was typed or suggested was for the other one.
  useEffect(() => {
    setIdeas(null)
  }, [platformKey])

  function pick(key: string): void {
    if (key === platformKey) return
    setPlatformKey(key)
    // An address the flow was opened with (a place found elsewhere) is the owner's subject, whatever the platform: it stays.
    setTarget((current) => (startTarget && current === startTarget ? current : ''))
    setFromIdea(null)
  }

  async function ask(): Promise<void> {
    if (!platformKey) return
    const result = await find(platformKey)
    if (result) setIdeas(result)
  }

  function useIdea(idea: ChannelSuggestion): void {
    setTarget(idea.target)
    setFromIdea(idea.target)
    targetRef.current?.focus({ preventScroll: true })
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (reason !== null || !account) return
    const channel = await connect({ productId: product.id, accountId: account.id, target: target.trim() })
    if (channel) onConnected(channel)
  }

  return (
    <form className="pane add-channel" onSubmit={(e) => void submit(e)} data-testid="add-channel">
      <ObjectHeader
        title="Add a channel"
        meta={`Four short steps for ${product.name}; the AI helps in step 3. Nothing is posted and nothing is read until the channel is connected.`}
        testId="add-channel-header"
        actions={
          onCancel && (
            <Button onClick={onCancel} data-testid="add-channel-cancel">
              Cancel
            </Button>
          )
        }
      />

      <section className="add-step" aria-labelledby="add-step-where">
        <h3 id="add-step-where">1. Where?</h3>
        <p className="muted small">Pick the platform. Each one says what the application does there.</p>
        <div className="add-platforms" role="radiogroup" aria-label="Platform" data-testid="add-platforms">
          {platformChoices(platforms).map((p) => (
            <button key={p.platform} type="button" role="radio" aria-checked={p.platform === platformKey} className={`add-platform${p.platform === platformKey ? ' on' : ''}`} onClick={() => pick(p.platform)} data-testid={`add-platform-${p.platform}`}>
              <strong>{p.label}</strong>
              <span className="muted small">{platformLine(p)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={`add-step${info ? '' : ' off'}`} aria-labelledby="add-step-account">
        <h3 id="add-step-account">2. Which account?</h3>
        {!info && <p className="muted small">Choose the platform first.</p>}
        {info && account === undefined && (
          <div className="stack" data-testid="add-no-account">
            <Hint>
              {accounts.length === 0 ? 'There is no account yet.' : `There is no ${info.label} account yet.`} A channel is reached through an account of its platform.
            </Hint>
            <div className="row">
              <a className={`btn btn-${submitVariant === 'primary' ? 'primary' : 'ghost'}`} href={accountsNewHref(undefined, product.id, info.platform)} data-testid="add-account-link">
                Add an account for {info.label}
              </a>
            </div>
          </div>
        )}
        {info && account !== undefined && !many && (
          <p data-testid="add-account-one">
            <strong>{accountOptionLabel(account, platforms)}</strong> <span className="muted small">is the only {info.label} account, so it is used.</span>
          </p>
        )}
        {info && account !== undefined && many && (
          <Field label="Account">
            <select className="input" value={account.id} onChange={(e) => setAccountId(e.target.value)} data-testid="connect-account">
              {choices.mine.length > 0 && (
                <optgroup label={choices.others.length > 0 ? 'Used by this product' : 'Accounts'}>
                  {choices.mine.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountOptionLabel(a, platforms)}
                    </option>
                  ))}
                </optgroup>
              )}
              {choices.others.length > 0 && (
                <optgroup label={choices.mine.length > 0 ? 'Other accounts of the library' : 'Accounts'}>
                  {choices.others.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountOptionLabel(a, platforms)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
        )}
        {info && account !== undefined && (
          <p className="small">
            <a href={accountsNewHref(undefined, product.id, info.platform)} data-testid="add-account-another">
              Add another account for {info.label}
            </a>
          </p>
        )}
        {alsoServes.length > 0 && (
          <div className="note warn" data-testid="share-notice">
            <p>
              This account also serves {alsoServes.map((n) => `“${n}”`).join(', ')}. That is allowed, but it has one set of limits for all its channels, only one party (you or the app) controls its browser at a time, and a platform may see one account promoting several things as spam.
            </p>
          </div>
        )}
      </section>

      <section className={`add-step${info && account ? '' : ' off'}`} aria-labelledby="add-step-address">
        <h3 id="add-step-address">{addressLabel(info) === 'Community' ? '3. Which community?' : '3. Which address?'}</h3>
        <Field label={addressLabel(info)} hint={address !== target.trim() ? `Address: ${address}.` : info?.hint}>
          <input
            className="input"
            value={target}
            ref={targetRef}
            onChange={(e) => {
              setTarget(e.target.value)
              setFromIdea(null)
            }}
            placeholder={addressExample(info)}
            disabled={!info || !account}
            data-testid="connect-target"
          />
        </Field>
        <div className="row">
          {info && account && (
            <OpenAccountBrowser
              key={account.id}
              account={account}
              open={() => call('accounts.browseChannels', { accountId: account.id, address: browseAddress(info, target) })}
              onUsePage={(url) => {
                setTarget(url)
                setFromIdea(null)
              }}
              blockedReason={browseBlocker(info, address)}
              hint={browseHint(info)}
              testId="connect-browse"
            />
          )}
          <Button variant="secondary" icon="sparkles" onClick={() => void ask()} disabled={!info || blocked !== null || finding.busy} data-testid="find-with-ai">
            {finding.busy ? 'Looking…' : 'Find with AI'}
          </Button>
        </div>
        {info &&
          (blocked ? (
            <Hint tone="warn" data-testid="find-blocked">
              {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
            </Hint>
          ) : (
            <Hint>
              {FIND_WITH_AI_NOTE} Uses {engineLabel ?? 'the AI engine'}.
            </Hint>
          ))}
        <ErrorNote error={finding.error} />
        {ideas !== null && ideasHere.length === 0 && <p className="muted small">The AI had no safe suggestion this time.</p>}
        {ideasHere.length > 0 && (
          <div className="add-ideas" data-testid="suggestions">
            {ideasHere.map((idea, index) => (
              <div className="add-idea" key={`${idea.target}:${index}`} data-testid="suggestion">
                <div className="add-idea-text">
                  <span>
                    <strong>{idea.target}</strong> <Badge tone="warn">Unverified</Badge>
                  </span>
                  <span className="muted small">{idea.reason}</span>
                </div>
                <div className="row">
                  {account && <OpenAccountBrowser key={account.id} account={account} label="Open to check" open={() => call('accounts.browseChannels', { accountId: account.id, address: idea.target })} testId="suggestion-browse" />}
                  <Button onClick={() => useIdea(idea)} data-testid="suggestion-use">
                    Use this
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {fromIdea && (
          <div className="note" data-testid="connect-from-idea">
            Filled in from the idea: {fromIdea}. Check it, then press Connect channel. Nothing is connected until you do.
          </div>
        )}
        {otherLoginThere && (
          <div className="note" data-testid="one-login-speaks">
            {ONE_LOGIN_SPEAKS}
          </div>
        )}
        {account && needsSiteProfile(info, address) && <PrepareSiteProfile key={`${account.id}|${address}`} productId={product.id} accountId={account.id} url={address} />}
      </section>

      <section className="add-step" aria-labelledby="add-step-connect">
        <h3 id="add-step-connect">4. Connect</h3>
        <ErrorNote error={state.error} />
        <div className="row">
          <Button variant={submitVariant} type="submit" disabled={reason !== null || state.busy} data-testid="connect-submit">
            {state.busy ? 'Connecting…' : 'Connect channel'}
          </Button>
          {reason !== null ? <Hint data-testid="connect-reason">{reason}</Hint> : <Hint>It appears in the list on the left and opens at once.</Hint>}
        </div>
      </section>
    </form>
  )
}
