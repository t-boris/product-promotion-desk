import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Account } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, ObjectHeader, useOpenForm } from '../../ui'
import { ACCOUNT_NAME_LIMIT, normalizeName, renameProblem } from './account-name'

/**
 * The header of an account: its name, a meta line under it, and "Rename" on the right. The name is the owner's own label for the login
 * (lists, headers, the channel pickers); renaming changes nothing on any platform. The open form owns the filled button of the screen.
 */
export function AccountHeader({ account, meta }: { account: Account; meta: ReactNode }) {
  const [editing, setEditing] = useState(false)
  const saveVariant = useOpenForm(editing)
  const [draft, setDraft] = useState(account.label)
  const input = useRef<HTMLInputElement>(null)
  const [save, saving] = useAction(async () => {
    await call('accounts.rename', { accountId: account.id, label: normalizeName(draft) })
    setEditing(false)
  })
  const problem = renameProblem(account.label, draft)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  function open(): void {
    setDraft(account.label)
    setEditing(true)
  }
  function submit(event: FormEvent): void {
    event.preventDefault()
    if (problem === null) void save()
  }

  return (
    <>
      <ObjectHeader
        title={account.label}
        meta={meta}
        actions={
          !editing && (
            <Button onClick={open} data-testid={`account-rename-${account.id}`}>
              Rename
            </Button>
          )
        }
      />
      {editing && (
        <form className="pick-row" onSubmit={submit} data-testid={`account-rename-form-${account.id}`}>
          <input
            ref={input}
            className="input"
            value={draft}
            maxLength={ACCOUNT_NAME_LIMIT}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
            aria-label="Name of this account"
            autoComplete="off"
            data-testid={`account-rename-input-${account.id}`}
          />
          <Button variant={saveVariant} type="submit" disabled={problem !== null || saving.busy} data-testid={`account-rename-save-${account.id}`}>
            {saving.busy ? 'Saving…' : 'Save name'}
          </Button>
          <Button onClick={() => setEditing(false)} disabled={saving.busy} data-testid={`account-rename-cancel-${account.id}`}>
            Cancel
          </Button>
        </form>
      )}
      <ErrorNote error={saving.error} />
    </>
  )
}
