import { useEffect, useState } from 'react'
import { useQuery } from '../hooks'
import { accountsNewHref, parseAccountsHash, type AccountsRoute } from '../route'
import { Button, Card, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { AccountDetail } from './channels/AccountDetail'
import { AccountList } from './channels/AccountList'
import { CreateAccount } from './channels/CreateAccount'
import { MailboxesCard } from './channels/MailboxesCard'
import './channels/channels.css'

type Tab = 'accounts' | 'mailboxes'

function useAccountsRoute(): AccountsRoute {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return parseAccountsHash(hash)
}

/**
 * The account library (DEC-015, REQ-014): every account the owner promotes from. An account is added here, given a role, an
 * e-mail address and a password, and signed in. It is only about the account: channels and products are not shown here; an
 * account is chosen where a channel is connected.
 */
export function AccountsPage() {
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const platforms = useQuery('platforms.list', undefined, [])
  const mailboxes = useQuery('mailboxes.list', undefined, ['accounts'])
  const vault = useQuery('vault.status', undefined, ['accounts'])
  const route = useAccountsRoute()
  const [tab, setTab] = useState<Tab>('accounts')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = accounts.data ?? []
  const loading = accounts.loading && !accounts.data
  const selected = list.find((a) => a.id === selectedId) ?? list[0]
  // With no account at all the form is the only useful thing to show.
  const adding = tab === 'accounts' && (route.adding || (!loading && !accounts.error && list.length === 0))

  useEffect(() => {
    if (route.adding) setTab('accounts')
  }, [route.adding])

  const goNew = (): void => {
    setTab('accounts')
    window.location.hash = accountsNewHref()
  }
  const closeNew = (): void => {
    window.location.hash = '#/accounts'
  }

  return (
    <Page
      title="Accounts"
      subtitle="Your logins on the platforms: a role, an e-mail address, a password and the sign-in for each."
      actions={
        <Button variant="primary" onClick={goNew} data-testid="account-add">
          Add account
        </Button>
      }
    >
      <ErrorNote error={accounts.error ?? platforms.error ?? mailboxes.error} />
      <div className="tabs" role="tablist" aria-label="Accounts sections">
        {(
          [
            ['accounts', 'Accounts'],
            ['mailboxes', 'Mailboxes']
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} data-testid={`accounts-tab-${id}`}>
            {label}
          </button>
        ))}
      </div>
      {loading && <Loading what="Loading accounts" />}
      {tab === 'mailboxes' && <MailboxesCard mailboxes={mailboxes.data ?? []} />}
      {tab === 'accounts' && (
        <>
          {adding && (
            <Card title="New account">
              <CreateAccount
                key={JSON.stringify(route.role)}
                platforms={platforms.data ?? []}
                mailboxes={mailboxes.data ?? []}
                role={route.role}
                onCreated={(account) => {
                  setSelectedId(account.id)
                  closeNew()
                }}
                onCancel={list.length > 0 ? closeNew : undefined}
              />
            </Card>
          )}
          {list.length > 0 && (
            <div className="accounts-layout">
              <aside>
                <AccountList accounts={list} platforms={platforms.data ?? []} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
              </aside>
              <div className="acct-detail-wrap">
                {selected ? (
                  <AccountDetail key={selected.id} account={selected} platforms={platforms.data ?? []} mailboxes={mailboxes.data ?? []} vault={vault.data} />
                ) : (
                  <EmptyState title="Select an account">Pick an account to see what it still needs.</EmptyState>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Page>
  )
}
