import { AccountHealth } from './AccountHealth'
import { useState, type ReactNode } from 'react'
import type { Account, Mailbox, PlatformInfo, VaultStatus } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { tabAfterKey } from '../../tab-keys'
import { AccountBrowser } from '../channels/AccountBrowser'
import { ConnectionGuide } from '../channels/ConnectionGuide'
import { kindLabel } from '../../../../shared/connection-guide'
import { AccountEmail } from '../channels/AccountEmail'
import { AccountHeader } from '../channels/AccountHeader'
import { AccountMore } from '../channels/AccountMore'
import { AccountPassword } from '../channels/AccountPassword'
import { AccountProfileLine } from '../channels/AccountProfileLine'
import { AccountSignIn } from '../channels/AccountSignIn'
import { AccountStatusLine } from '../channels/AccountStatus'
import { AccountViaLine } from '../channels/AccountViaLine'
import { platformLabel } from '../channels/model'
import { nextStep, type NextStep } from '../channels/next-step'
import { platformMismatch } from '../channels/platform-hint'
import { RoleEditor } from '../channels/RoleEditor'
import { AccountApiKey } from '../channels/AccountApiKey'
import { ACCOUNT_TABS, ACCOUNT_TAB_LABEL, DEFAULT_ACCOUNT_TAB, type AccountTab } from './accounts-groups'

/**
 * One account (DEC-015, DEC-037 phase C5): its header, what comes next, then four tabs. Sign-in holds the steps that lead to a signed-in
 * login (the address and the password, or the account it signs in through, then the sign-in itself); Role holds who the login speaks as (its
 * role and its profile); Browser is the setting of the browser it works in (DEC-026); More holds the rare controls (another page, taking the
 * AI's page, removing the account). The numbers of the steps are the same as before the tabs: the note above says "step 3" and the step
 * has that number wherever it is. It says nothing about channels or products: an account is only about the account. The one filled button
 * is the button of the step `nextStep` names (visual-system.md §10.3); the other steps keep a bezel.
 */
export function AccountDetail({
  account,
  platforms,
  mailboxes,
  vault,
  onOpenProfile,
  onOpenAccount
}: {
  account: Account
  platforms: PlatformInfo[]
  mailboxes: Mailbox[]
  vault: VaultStatus | undefined
  onOpenProfile: (profileId: string) => void
  onOpenAccount: (accountId: string) => void
}) {
  const [tab, setTab] = useState<AccountTab>(DEFAULT_ACCOUNT_TAB)
  const info = platforms.find((p) => p.platform === account.platform)
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const viaApi = account.access === 'api'
  // For an account that works through an API the one secret is its key (DEC-055).
  const hasPassword = (viaApi ? vault?.apiKeyAccountIds.includes(account.id) : vault?.accountIds.includes(account.id)) ?? false
  // Such an account has no browser to choose.
  const tabs = viaApi ? ACCOUNT_TABS.filter((id) => id !== 'browser') : ACCOUNT_TABS
  // The platform this login signs in with, and the account it does so through (null until chosen).
  const wantedPlatform = info?.signsInWith
  const wantedLabel = wantedPlatform ? platformLabel(wantedPlatform, platforms) : ''
  const via = account.signsInVia ? ((accounts.data ?? []).find((a) => a.id === account.signsInVia) ?? null) : null
  const viaLoading = Boolean(account.signsInVia) && accounts.data === undefined
  const viaHasPassword = via ? (vault?.accountIds.includes(via.id) ?? false) : false
  const step: NextStep = viaLoading
    ? { block: null, text: 'Loading…' }
    : nextStep(account, hasPassword, vault?.available ?? true, wantedPlatform ? { account: via, label: wantedLabel, hasPassword: viaHasPassword } : undefined, info?.api?.signIn?.label)
  const mismatch = platformMismatch(account.label, account.platform, platforms)

  const panels: Record<AccountTab, ReactNode> = {
    signin: viaApi ? (
      info?.api && vault ? <AccountApiKey account={account} api={info.api} unavailable={vault.unavailable} hasKey={hasPassword} endsAt={vault.apiKeyEnds[account.id] ?? null} /> : null
    ) : (
      <>
        <ConnectionGuide account={account} info={info} />
        {wantedPlatform ? (
          <AccountViaLine account={account} via={via} wantedPlatform={wantedPlatform} wantedLabel={wantedLabel} accounts={accounts.data ?? []} next={step.block} onOpenAccount={onOpenAccount} />
        ) : (
          <>
            <AccountEmail account={account} mailboxes={mailboxes} next={step.block} />
            {vault && <AccountPassword account={account} unavailable={vault.unavailable} hasPassword={hasPassword} next={step.block} />}
          </>
        )}
        <AccountSignIn
          account={account}
          info={info}
          step={wantedPlatform ? 4 : 5}
          through={wantedPlatform ? { label: wantedLabel, account: via } : undefined}
          vaultAvailable={vault?.available ?? false}
          hasPassword={hasPassword}
          next={step.block}
        />
      </>
    ),
    role: (
      <>
        <RoleEditor account={account} />
        <AccountProfileLine account={account} onOpenProfile={onOpenProfile} />
      </>
    ),
    browser: <AccountBrowser account={account} />,
    more: <AccountMore account={account} />
  }

  return (
    <div className="pane" data-testid={`account-${account.id}`}>
      <AccountHeader
        account={account}
        meta={
          <>
            <span>
              {platformLabel(account.platform, platforms)}
              {kindLabel(info, account.kind) ? ` · ${kindLabel(info, account.kind)}` : ''}
            </span>
            <AccountStatusLine status={account.status} />
          </>
        }
      />
      {mismatch && (
        <div className="note warn" role="status" data-testid={`account-platform-mismatch-${account.id}`}>
          {mismatch}
        </div>
      )}
      <div className={`note ${step.block === null ? 'good' : ''}`} data-testid={`account-next-step-${account.id}`}>
        {step.text}
      </div>
      <div className="tabs" role="tablist" aria-label="Account sections">
        {tabs.map((id) => (
          <button key={id} role="tab" id={`account-tab-${id}-${account.id}`} aria-selected={tab === id} aria-controls={`account-panel-${account.id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const next = tabAfterKey(tabs, id, event.key)
              if (next === null) return
              event.preventDefault()
              setTab(next)
              document.getElementById(`account-tab-${next}-${account.id}`)?.focus()
            }}
            data-testid={`account-tab-${id}`}
          >
            {ACCOUNT_TAB_LABEL[id]}
          </button>
        ))}
      </div>
      <div className="stack" role="tabpanel" id={`account-panel-${account.id}`} aria-labelledby={`account-tab-${tab}-${account.id}`} data-testid={`account-panel-${tab}`}>
        {panels[tab]}
      </div>
      <AccountHealth accountId={account.id} />
    </div>
  )
}
