import { describe, expect, it } from 'vitest'
import { ControlledSession } from './browser-session'
import { TakeoverError, TicketError } from './ports'
import { FakeClock, FakePage } from './testing/fakes'
import { TicketAuthority } from './tickets'

function setup() {
  const tickets = new TicketAuthority(new FakeClock())
  const page = new FakePage()
  const session = new ControlledSession('acc', async () => page, tickets)
  const ticket = tickets.issue({ actionId: 'a', contentHash: 'h', accountId: 'acc', destination: 'd' })
  return { tickets, page, session, ticket }
}

describe('ControlledSession', () => {
  it('serializes agent runs on the same account', async () => {
    const { session } = setup()
    const order: string[] = []
    const run = (name: string, ms: number) =>
      session.withAgentControl(name, async () => {
        order.push(`start ${name}`)
        await new Promise((r) => setTimeout(r, ms))
        order.push(`end ${name}`)
      })
    await Promise.all([run('a', 30), run('b', 1)])
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('refuses to start while the user holds control, until released', async () => {
    const { session } = setup()
    session.takeControl()
    await expect(session.withAgentControl('x', async () => 1)).rejects.toBeInstanceOf(TakeoverError)
    session.releaseControl()
    await expect(session.withAgentControl('x', async () => 1)).resolves.toBe(1)
  })

  it('stops an in-flight agent run the moment the user takes over', async () => {
    const { session, page } = setup()
    const result = session.withAgentControl('x', async (p) => {
      await p.goto('https://a')
      session.takeControl()
      await p.goto('https://b')
    })
    await expect(result).rejects.toBeInstanceOf(TakeoverError)
    expect(page.log).toEqual(['goto https://a'])
  })

  it('requires a valid ticket for write actions and none for reads', async () => {
    const { session, page, ticket, tickets } = setup()
    await session.withAgentControl('x', async (p) => {
      await p.goto('https://a')
      await p.fill('#t', 'hello', ticket)
      await p.click('#go', ticket)
    })
    expect(page.log).toEqual(['goto https://a', 'fill #t hello', 'click #go'])

    const foreign = tickets.issue({ actionId: 'a', contentHash: 'h', accountId: 'someone-else', destination: 'd' })
    await expect(session.withAgentControl('x', (p) => p.click('#go', foreign))).rejects.toBeInstanceOf(TicketError)
    await expect(session.withAgentControl('x', (p) => p.click('#go', undefined as never))).rejects.toBeInstanceOf(TicketError)
    expect(page.log).not.toContain('click #go extra')
  })

  it('rejects write actions once the ticket is revoked', async () => {
    const { session, ticket, tickets } = setup()
    tickets.revoke(ticket)
    await expect(session.withAgentControl('x', (p) => p.fill('#t', 'x', ticket))).rejects.toBeInstanceOf(TicketError)
  })
})
