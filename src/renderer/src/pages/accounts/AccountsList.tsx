import { useEffect, useRef } from 'react'
import type { PlatformInfo } from '../../../../shared/types'
import { Badge } from '../../ui'
import { OTHER_LOGINS, accountKey, accountRow, personaRow, profileKey, type AccountGroup, type RowTone } from './accounts-groups'

const dotClass = (tone: RowTone): string => (tone === '' ? 'dot' : `dot ${tone}`)

/**
 * The left pane of Accounts (DEC-037, phase C5): one list of every login, grouped by the person behind it. A profile is a row of its own
 * with its logins beneath it, one line each (the platform and where the sign-in stands); the logins that belong to no profile are listed
 * last under "Other logins". The list is a listbox: the owner moves through it with the arrow keys (the screen handles them) and the
 * selected row is the one shown beside it.
 */
export function AccountsList({
  groups,
  platforms,
  selectedKey,
  tabKey,
  onSelect
}: {
  groups: AccountGroup[]
  platforms: PlatformInfo[]
  /** The row shown as chosen; null while a form beside the list is open and no row is. */
  selectedKey: string | null
  /** The one row in the Tab order (roving tabindex): the chosen row, or the row that would be chosen while a form hides the choice. */
  tabKey: string | null
  onSelect: (key: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row) return
    if (list.current?.contains(document.activeElement)) row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }, [selectedKey])
  const now = new Date()
  return (
    <div className="accounts-list" role="listbox" aria-label="Accounts" ref={list} data-testid="account-list">
      {groups.map((group) => {
        const profile = group.profile
        const persona = profile ? personaRow(profile, group.accounts.length, now) : null
        return (
          <div key={group.id} className="accounts-group" role="group" aria-label={profile ? profile.label : OTHER_LOGINS} data-testid={`accounts-group-${profile?.id ?? 'other'}`}>
            {profile && persona ? (
              <button
                type="button"
                role="option"
                aria-selected={selectedKey === profileKey(profile.id)}
                tabIndex={tabKey === profileKey(profile.id) ? 0 : -1}
                className={`accounts-row persona${selectedKey === profileKey(profile.id) ? ' selected' : ''}`}
                onClick={() => onSelect(profileKey(profile.id))}
                data-testid={`profile-row-${profile.id}`}
                data-state={persona.state}
              >
                <span className="accounts-row-top">
                  <span className="accounts-row-title">{persona.title}</span>
                  {/* Only a proposal waiting for the owner is a tag; a new or an approved profile is a dot and its word. */}
                  {persona.state === 'proposed' && <Badge tone="warn">Proposed</Badge>}
                </span>
                <span className="accounts-row-line">{persona.line}</span>
                <span className="accounts-row-line">
                  {persona.accounts}
                  {persona.state !== 'proposed' && (
                    <>
                      {' · '}
                      <span className="dot-line">
                        <span className={dotClass(persona.tone)} aria-hidden="true" />
                        {persona.state === 'approved' ? 'Approved' : 'New'}
                      </span>
                    </>
                  )}
                </span>
              </button>
            ) : (
              <div className="accounts-group-head" aria-hidden="true">
                {OTHER_LOGINS}
              </div>
            )}
            {group.accounts.map((account) => {
              const row = accountRow(account, platforms)
              const selected = selectedKey === accountKey(account.id)
              return (
                <button
                  key={account.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={tabKey === accountKey(account.id) ? 0 : -1}
                  className={`accounts-row login${profile ? ' under' : ''}${selected ? ' selected' : ''}`}
                  onClick={() => onSelect(accountKey(account.id))}
                  data-testid={`account-row-${account.id}`}
                >
                  <span className="accounts-row-title">{row.title}</span>
                  <span className="accounts-row-line">
                    <span className="dot-line">
                      <span className={dotClass(row.tone)} aria-hidden="true" />
                      {row.line}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
