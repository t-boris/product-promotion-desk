import { describe, expect, it } from 'vitest'
import { ControlledSession } from './browser-session'
import { SessionChangedError, TakeoverError, TicketError } from './ports'
import { FakeClock, FakePage } from './testing/fakes'
import type { BrowserPage, PageStep, PageStepResult, SendTicket } from './ports'
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

  it('refuses at once when the user holds control, without waiting for the run in progress', async () => {
    const { session } = setup()
    let finish!: () => void
    const running = session.withAgentControl('a', () => new Promise<void>((resolve) => (finish = resolve)))
    await new Promise((r) => setTimeout(r, 5))
    session.takeControl()
    // Asked for while another run holds the queue: the answer is immediate, not after that run.
    const refused = await Promise.race([session.withAgentControl('b', async () => 'ran').then(() => 'ran', (error: unknown) => (error instanceof TakeoverError ? 'refused at once' : 'other')), new Promise<string>((resolve) => setTimeout(() => resolve('waited'), 50))])
    expect(refused).toBe('refused at once')
    finish()
    await running.catch(() => undefined)
  })

  it('refuses a run that waited in the queue when the user took control meanwhile, and touches nothing', async () => {
    const { session, page } = setup()
    let finish!: () => void
    const first = session.withAgentControl('a', () => new Promise<void>((resolve) => (finish = resolve)))
    const queued = session.withAgentControl('b', async () => {
      page.log.push('b ran')
    })
    await new Promise((r) => setTimeout(r, 5))
    session.takeControl()
    finish()
    await first.catch(() => undefined)
    await expect(queued).rejects.toBeInstanceOf(TakeoverError)
    expect(page.log).toEqual([])
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

  it('hands a long page step a check that says whether the agent still holds the browser: a glide in progress stops when the owner takes over', async () => {
    class LongStep extends FakePage {
      checks = 0
      override async pageStep(_step: PageStep, _hosts: string[], alive?: () => void): Promise<PageStepResult> {
        alive?.() // the owner has not touched the browser: this is fine
        this.checks += 1
        session.takeControl()
        alive?.() // now it throws
        this.checks += 1
        return { status: 'done', detail: 'unreachable' }
      }
    }
    const page = new LongStep()
    const session = new ControlledSession('acc', async () => page, new TicketAuthority(new FakeClock()))
    await expect(session.withAgentControl('x', (p) => p.pageStep({ do: 'hover', ref: 'e1' }, ['fake.test']))).rejects.toBeInstanceOf(TakeoverError)
    expect(page.checks).toBe(1)
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

  describe('publishStep: the page step that can publish needs a ticket (B1)', () => {
    const typeStep = { do: 'type', ref: 'e1', text: 'hello' } as const
    const clickStep = { do: 'click', ref: 'e2' } as const

    it('carries a step out with a genuine ticket of this account, and pageStep stays ticket-less', async () => {
      const { session, page, ticket } = setup()
      await session.withAgentControl('x', async (p) => {
        expect(await p.publishStep(typeStep, ['site.test'], ticket)).toEqual({ status: 'done', detail: 'ok' })
        await p.publishStep(clickStep, ['site.test'], ticket)
        await p.pageStep(clickStep, ['site.test'])
      })
      expect(page.steps.map((s) => s.step)).toEqual([typeStep, clickStep, clickStep])
      expect(page.steps[0].hosts).toEqual(['site.test'])
    })

    it('refuses without a ticket, with a forged one, with another account\'s, with a revoked one and with an expired one, and touches nothing', async () => {
      const clock = new FakeClock()
      const tickets = new TicketAuthority(clock)
      const page = new FakePage()
      const session = new ControlledSession('acc', async () => page, tickets)
      const issue = (accountId = 'acc') => tickets.issue({ actionId: 'a', contentHash: 'h', accountId, destination: 'd' })
      const publish = (ticket: ReturnType<typeof issue>) => session.withAgentControl('x', (p) => p.publishStep(clickStep, ['site.test'], ticket))

      await expect(publish(undefined as never)).rejects.toBeInstanceOf(TicketError)
      await expect(publish({ ...issue(), signature: '00'.repeat(32) })).rejects.toBeInstanceOf(TicketError)
      await expect(publish({ ...issue(), contentHash: 'other' })).rejects.toBeInstanceOf(TicketError)
      await expect(publish(issue('someone-else'))).rejects.toBeInstanceOf(TicketError)
      const spent = issue()
      tickets.revoke(spent)
      await expect(publish(spent)).rejects.toBeInstanceOf(TicketError)
      const old = issue()
      clock.advance(10 * 60 * 1000)
      await expect(publish(old)).rejects.toBeInstanceOf(TicketError)

      expect(page.steps).toEqual([])
    })

    it('stops the moment the owner takes the browser', async () => {
      const { session, page, ticket } = setup()
      const run = session.withAgentControl('x', async (p) => {
        await p.publishStep(typeStep, ['site.test'], ticket)
        session.takeControl()
        await p.publishStep(clickStep, ['site.test'], ticket)
      })
      await expect(run).rejects.toBeInstanceOf(TakeoverError)
      expect(page.steps.map((s) => s.step)).toEqual([typeStep])
    })
  })
})

describe('the owner\'s windows share the session with the AI\'s page (DEC-038)', () => {
  const step = { do: 'click', ref: 'e1' } as PageStep

  it('start at zero, count what the owner did, and never take the browser from the AI', async () => {
    const { session } = setup()
    expect(session.identityEpoch()).toBe(0)
    session.noteIdentityActivity()
    session.noteIdentityActivity()
    expect(session.identityEpoch()).toBe(2)
    expect(session.control()).toEqual({ holder: 'none', owner: null })
    await expect(session.withAgentControl('x', async () => 1)).resolves.toBe(1)
  })

  it('does not interrupt a turn in progress: reading, steps and navigation go on after the owner used a sign-in page', async () => {
    const { session, page } = setup()
    const run = session.withAgentControl('x', async (p) => {
      await p.goto('https://a')
      session.noteIdentityActivity()
      await p.goto('https://b')
      await p.read('1')
      await p.pageStep(step, ['site.test'])
      return 'finished'
    })
    await expect(run).resolves.toBe('finished')
    expect(page.log).toEqual(expect.arrayContaining(['goto https://a', 'goto https://b']))
  })

  it.each([
    ['fill', (p: BrowserPage, t: SendTicket) => p.fill('#x', 'text', t)],
    ['click', (p: BrowserPage, t: SendTicket) => p.click('#x', t)],
    ['uploadFile', (p: BrowserPage, t: SendTicket) => p.uploadFile('#x', '/a.png', t)],
    ['publishStep', (p: BrowserPage, t: SendTicket) => p.publishStep(step, ['site.test'], t)]
  ])('refuses %s with a valid ticket once the owner used a sign-in or sign-out page during the turn, before anything reaches the page', async (_name, write) => {
    const { session, page, ticket } = setup()
    const run = session.withAgentControl('x', async (p) => {
      session.noteIdentityActivity()
      await write(p, ticket)
    })
    await expect(run).rejects.toBeInstanceOf(SessionChangedError)
    expect(page.log).toEqual([])
    expect(page.steps).toEqual([])
  })

  it('refuses only the turn that was in progress: a later turn sees the session as it is (the mission\'s own authority covers the gap between turns)', async () => {
    const { session, page, ticket } = setup()
    session.noteIdentityActivity()
    await expect(session.withAgentControl('x', (p) => p.click('#x', ticket))).resolves.toBeUndefined()
    expect(page.log).toContain('click #x')
  })

  it('an explicit take-over still stops the AI at once, and giving control back lets it work again', async () => {
    const { session, page } = setup()
    const run = session.withAgentControl('x', async (p) => {
      await p.goto('https://a')
      session.takeControl()
      await p.goto('https://b')
    })
    await expect(run).rejects.toBeInstanceOf(TakeoverError)
    expect(page.log).toEqual(['goto https://a'])
    await expect(session.withAgentControl('y', async () => 1)).rejects.toBeInstanceOf(TakeoverError)
    session.releaseControl()
    await expect(session.withAgentControl('y', async () => 1)).resolves.toBe(1)
  })
})
