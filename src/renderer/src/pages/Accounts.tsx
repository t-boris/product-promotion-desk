import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '../hooks'
import { accountsNewHref, parseAccountsHash, productHref } from '../route'
import { useHash } from '../use-hash'
import { Button, Card, EmptyState, ErrorNote, Loading, OpenFormsScope, Page } from '../ui'
import { AccountDetail } from './accounts/AccountDetail'
import { AccountsList } from './accounts/AccountsList'
import { accountKey, displayOrder, groupAccounts, parseKey, profileKey } from './accounts/accounts-groups'
import { NewProfile } from './accounts/NewProfile'
import { CreateAccount } from './channels/CreateAccount'
import { RoleIdeas } from './accounts/RoleIdeas'
import { ProfileDetail } from './channels/ProfileDetail'
import { moveSelection, selectionAfterDismiss } from './inbox/inbox-groups'
import { useListSelection } from '../use-list-selection'
import './channels/channels.css'
import './accounts/accounts.css'

/** True while the key goes to a field the owner is typing in: the arrow keys then belong to the caret. */
function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/**
 * The account library (DEC-015, DEC-037 phase C5, REQ-014): every login the owner promotes from, in one list grouped by the profile (the
 * person) behind it, with the selected profile or login beside the list. It is the library of its own and not the current product's:
 * channels and products are not shown here; an account is chosen where a channel is connected. A login is added here, given a role, an
 * e-mail address and a password, and signed in; the base mailbox it takes its addresses from is a setting.
 *
 * One filled button per screen state (visual-system.md §10.3): "Add account" and "New profile" in the header are bezels, off while their form
 * is on screen; the form owns the filled button while it is open (the scope below makes the login behind it step back), otherwise the
 * next step of the login.
 */
function AccountsScreen() {
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const platforms = useQuery('platforms.list', undefined, [])
  const mailboxes = useQuery('mailboxes.list', undefined, ['accounts'])
  const vault = useQuery('vault.status', undefined, ['accounts'])
  const profiles = useQuery('profiles.list', undefined, ['accounts'])
  const products = useQuery('products.list', undefined, ['products'])
  const route = parseAccountsHash(useHash())
  // The product whose Channels screen opened the form: the new account is made for it and the app goes back there. A product that
  // no longer exists is ignored.
  const forProduct = route.productId && (products.data === undefined || products.data.some((p) => p.id === route.productId)) ? route.productId : null
  const [makingProfile, setMakingProfile] = useState(false)

  const list = accounts.data ?? []
  const profileList = profiles.data ?? []
  const platformList = platforms.data ?? []
  const loading = (accounts.loading && !accounts.data) || (profiles.loading && !profiles.data)
  const groups = useMemo(() => groupAccounts(profileList, list), [profiles.data, accounts.data])
  const order = useMemo(() => displayOrder(groups), [groups])
  // With no login and no profile at all the form is the only useful thing to show.
  const empty = !loading && !accounts.error && !profiles.error && list.length === 0 && profileList.length === 0
  const adding = route.adding || empty

  // The row shown: the chosen one while it is listed; when it leaves the list (a login or a profile was removed) the one that took its place
  // is committed, so a later render cannot fall back to the first row.
  const [selectedKey, setChosen] = useListSelection(order, selectionAfterDismiss)
  const selected = parseKey(selectedKey)
  const selectedAccount = selected?.kind === 'account' ? list.find((a) => a.id === selected.id) : undefined
  const selectedProfile = selected?.kind === 'profile' ? profileList.find((p) => p.id === selected.id) : undefined

  // `#/accounts/<id>` (an Inbox item) selects that account; an id that is not in the library falls back to the first row.
  useEffect(() => {
    if (route.accountId) {
      setChosen(accountKey(route.accountId))
      setMakingProfile(false)
    }
  }, [route.accountId])

  // The arrow keys walk the list; a focused field, button or link of the detail keeps its own keys.
  const latest = useRef({ order, selectedKey })
  latest.current = { order, selectedKey }
  const listing = !adding && !makingProfile
  useEffect(() => {
    if (!listing) return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target)) return
      const target = event.target as HTMLElement
      if (target !== document.body && !target.closest('[data-testid="account-list"]')) return
      const next = moveSelection(latest.current.order, latest.current.selectedKey, event.key === 'ArrowDown' ? 1 : -1)
      if (next === null) return
      event.preventDefault()
      setChosen(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listing])

  const select = (key: string): void => {
    setMakingProfile(false)
    setChosen(key)
  }
  const goNew = (): void => {
    setMakingProfile(false)
    window.location.hash = accountsNewHref()
  }
  /** Leaves the form: to the product's Channels screen when it was opened from a product (with the account just added chosen there), otherwise to the list. */
  const closeNew = (createdId?: string): void => {
    window.location.hash = forProduct ? productHref(forProduct, 'channels', createdId) : '#/accounts'
  }

  return (
    <Page
      title="Accounts"
      subtitle="Your logins on the platforms, grouped by the person behind them: a profile has one login per platform."
      fill
      actions={
        <>
          <Button onClick={() => setMakingProfile(true)} disabled={adding || makingProfile} data-testid="profile-add">
            New profile
          </Button>
          <Button icon="plus" onClick={goNew} disabled={adding} data-testid="account-add">
            Add account
          </Button>
        </>
      }
    >
      <ErrorNote error={accounts.error ?? platforms.error ?? mailboxes.error ?? profiles.error} />
      {loading && <Loading what="Loading accounts" />}
      {adding && !loading && (
        <div className="accounts-scroll">
          <Card title="New account">
            <CreateAccount
              key={`${JSON.stringify(route.role)}|${route.platform ?? ''}`}
              platforms={platformList}
              mailboxes={mailboxes.data ?? []}
              profiles={profileList}
              accounts={list}
              role={route.role}
              startPlatform={route.platform ?? null}
              product={forProduct ? { id: forProduct, name: products.data?.find((p) => p.id === forProduct)?.name } : null}
              onCreated={(account) => {
                setChosen(accountKey(account.id))
                closeNew(account.id)
              }}
              onCancel={list.length > 0 || profileList.length > 0 || forProduct ? () => closeNew() : undefined}
            />
          </Card>
          {forProduct && (
            <Card>
              <RoleIdeas productId={forProduct} platform={route.platform ?? null} />
            </Card>
          )}
        </div>
      )}
      {!adding && !loading && (
        <div className="accounts-split">
          <AccountsList groups={groups} platforms={platformList} selectedKey={makingProfile ? null : selectedKey} tabKey={selectedKey} onSelect={select} />
          <div className="accounts-detail-pane">
            {makingProfile ? (
              <Card title="New profile">
                <NewProfile
                  platforms={platformList}
                  products={products.data ?? []}
                  freeAccounts={list.filter((a) => a.profileId === null)}
                  onCreated={(profile) => {
                    setMakingProfile(false)
                    setChosen(profileKey(profile.id))
                  }}
                  onCancel={() => setMakingProfile(false)}
                />
              </Card>
            ) : selectedAccount ? (
              <AccountDetail
                key={selectedAccount.id}
                account={selectedAccount}
                platforms={platformList}
                mailboxes={mailboxes.data ?? []}
                vault={vault.data}
                onOpenProfile={(id) => select(profileKey(id))}
                onOpenAccount={(id) => select(accountKey(id))}
              />
            ) : selectedProfile ? (
              <ProfileDetail
                key={selectedProfile.id}
                profile={selectedProfile}
                accounts={list.filter((a) => a.profileId === selectedProfile.id)}
                platforms={platformList}
                products={products.data ?? []}
                onOpenAccount={(id) => select(accountKey(id))}
              />
            ) : (
              <EmptyState title="Select a login">Pick a profile or a login to see what it still needs.</EmptyState>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}

export function AccountsPage() {
  return (
    <OpenFormsScope>
      <AccountsScreen />
    </OpenFormsScope>
  )
}
