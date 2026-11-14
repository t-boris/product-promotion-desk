import type { AccountStatus } from '../../../../shared/types'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from './model'

/**
 * The sign-in state of an account as a dot and its words. A tag (`Badge`) is kept for the state the owner has to act on; everywhere else
 * the state is read at a glance from this quiet line.
 */
export function AccountStatusLine({ status }: { status: AccountStatus }) {
  return (
    <span className="dot-line">
      <span className={`dot ${ACCOUNT_STATUS_TONE[status]}`} aria-hidden="true" />
      {ACCOUNT_STATUS_LABEL[status]}
    </span>
  )
}
