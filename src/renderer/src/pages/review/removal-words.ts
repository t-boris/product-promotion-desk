// What the owner sees for taking an item out of the queue (pure, so it is tested without the screen). A reply is rejected; a post is deleted.

import type { OpportunityKind } from '../../../../shared/types'

export interface RemovalWords {
  label: string
  question: string
  /** The title of the list the removed items stay in, for a record. */
  list: string
}

export function removalWords(kind: OpportunityKind): RemovalWords {
  return kind === 'standalone'
    ? { label: 'Delete', question: 'Deletes this post. Nothing was sent, so nothing changes on any site. It cannot be brought back.', list: 'Deleted' }
    : { label: 'Reject', question: 'Rejects this for good. A rejected item cannot be reopened.', list: 'Rejected' }
}
