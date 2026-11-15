import { useState } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, useMainVariant } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { eligibleVia, viaOption } from './account-link'
import { AccountStatusLine } from './AccountStatus'
import type { NextStep } from './next-step'

/**
 * The account a login signs in through (DEC-027): Threads signs in through its Instagram account, so it has no e-mail and no password of
 * its own. The owner sees which account that is, may open it, and may choose another. The account has to exist first.
 */
export function AccountViaLine({
  account,
  via,
  wantedPlatform,
  wantedLabel,
  accounts,
  next,
  onOpenAccount
}: {
  account: Account
  /** The account it signs in through now; null while none is chosen (an account made before Threads needed one). */
  via: Account | null
  /** The platform it signs in with ("instagram") and its name for people ("Instagram"). */
  wantedPlatform: string
  wantedLabel: string
  accounts: Account[]
  next: NextStep['block']
  onOpenAccount: (accountId: string) => void
}) {
  const main = useMainVariant()
  const candidates = eligibleVia(accounts, wantedPlatform, account.profileId)
  const [chosen, setChosen] = useState('')
  const picked = candidates.some((a) => a.id === chosen) ? chosen : (via?.id ?? '')
  const [save, saving] = useAction(() => call('accounts.setSignInVia', { accountId: account.id, viaAccountId: picked }))

  const summary = via ? (
    <span data-testid={`account-via-state-${account.id}`}>
      <Badge tone="neutral">{wantedLabel}</Badge> <strong>{via.label}</strong> <span className="muted">·</span> <AccountStatusLine status={via.status} />
    </span>
  ) : (
    <span className="muted" data-testid={`account-via-state-${account.id}`}>
      Not chosen yet. This login has no password of its own: it signs in through {wantedLabel === 'Instagram' ? 'an' : 'a'} {wantedLabel} account, which has to exist first.
    </span>
  )

  return (
    <AccountBlock
      step={3}
      title={`Signs in with ${wantedLabel}`}
      summary={summary}
      testId={`account-via-${account.id}`}
      actions={
        via && (
          <Button variant={next === 'via' ? main : 'ghost'} onClick={() => onOpenAccount(via.id)} data-testid={`account-via-open-${account.id}`}>
            Open account
          </Button>
        )
      }
    >
      {candidates.length > 0 ? (
        <div className="pick-row">
          <select className="input" value={picked} disabled={saving.busy} onChange={(e) => setChosen(e.target.value)} aria-label={`${wantedLabel} account of this login`} data-testid={`account-via-select-${account.id}`}>
            {via === null && <option value="">Choose an account…</option>}
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {viaOption(a)}
              </option>
            ))}
          </select>
          <Button
            variant={next === 'via' && via === null ? main : 'ghost'}
            onClick={() => void save()}
            disabled={picked === '' || picked === via?.id || saving.busy}
            data-testid={`account-via-save-${account.id}`}
          >
            {saving.busy ? 'Saving…' : 'Use this account'}
          </Button>
        </div>
      ) : (
        <Hint data-testid={`account-via-none-${account.id}`}>
          There is no {wantedLabel} account to choose. Add the {wantedLabel} account first (Add account), then choose it here.
        </Hint>
      )}
      <ErrorNote error={saving.error} />
    </AccountBlock>
  )
}
