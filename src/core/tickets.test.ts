import { describe, expect, it } from 'vitest'
import { FakeClock } from './testing/fakes'
import { TicketAuthority } from './tickets'

const params = { actionId: 'a1', contentHash: 'h1', accountId: 'acc', destination: 'https://x/y' }

describe('TicketAuthority', () => {
  it('accepts a genuine ticket that matches the expectation', () => {
    const t = new TicketAuthority(new FakeClock())
    const ticket = t.issue(params)
    expect(() => t.assertValid(ticket, { accountId: 'acc', destination: 'https://x/y', contentHash: 'h1' })).not.toThrow()
  })

  it('rejects a forged or altered ticket', () => {
    const t = new TicketAuthority(new FakeClock())
    const ticket = t.issue(params)
    expect(() => t.assertValid({ ...ticket, destination: 'https://evil/' })).toThrow(/not genuine/)
    const other = new TicketAuthority(new FakeClock())
    expect(() => other.assertValid(ticket)).toThrow(/not genuine/)
    expect(() => t.assertValid(undefined as never)).toThrow(/Missing/)
  })

  it('rejects a ticket for a different account, destination or content', () => {
    const t = new TicketAuthority(new FakeClock())
    const ticket = t.issue(params)
    expect(() => t.assertValid(ticket, { accountId: 'other' })).toThrow(/accountId/)
    expect(() => t.assertValid(ticket, { contentHash: 'changed' })).toThrow(/contentHash/)
    expect(() => t.assertValid(ticket, { destination: 'elsewhere' })).toThrow(/destination/)
  })

  it('rejects expired and revoked tickets', () => {
    const clock = new FakeClock()
    const t = new TicketAuthority(clock)
    const expiring = t.issue(params, 1000)
    clock.advance(1001)
    expect(() => t.assertValid(expiring)).toThrow(/expired/)
    const used = t.issue(params)
    t.revoke(used)
    expect(() => t.assertValid(used)).toThrow(/used up/)
  })
})
