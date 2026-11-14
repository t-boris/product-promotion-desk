// A stand-in for the post authority of the send flow, for tests of the tools and of the mission service. Not imported by production code.
// It leases a real ticket from a real ticket authority and keeps the rules of the real one that matter to the tools: one point of no return,
// a ticket revoked when the lease ends, a refusal on demand. The binding of the ticket to the content is tested where the real authority is.

import type { SendTicket } from '../ports'
import type { TicketAuthority } from '../tickets'
import type { ApprovedContent, LeaseResult, PostAuthority, SubmitLease } from './post-submit'

export class TestAuthority implements PostAuthority {
  committed = false
  leases = 0
  refuse: string | null = null
  readonly issued: SendTicket[] = []
  constructor(
    private readonly tickets: TicketAuthority,
    readonly content: ApprovedContent,
    private readonly accountId = 'acc'
  ) {}
  async lease<T>(use: (lease: SubmitLease) => Promise<T>): Promise<LeaseResult<T>> {
    if (this.committed) return { ok: false, reason: 'the control was already pressed' }
    if (this.refuse) return { ok: false, reason: this.refuse }
    this.leases += 1
    const ticket = this.tickets.issue({ actionId: 'action-1', contentHash: 'hash-1', accountId: this.accountId, destination: this.content.destination })
    this.issued.push(ticket)
    const lease: SubmitLease = {
      ticket,
      commit: () => {
        if (this.committed) throw new Error('the control was already pressed')
        this.committed = true
      },
      release: () => {
        this.committed = false
      }
    }
    try {
      return { ok: true, value: await use(lease) }
    } finally {
      this.tickets.revoke(ticket)
    }
  }
}
