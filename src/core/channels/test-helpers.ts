// Shared fixtures for the channels tests. Not imported by production code.

import { ApiError, type ApiArgs, type ApiMethod, type ApiResult, type ChangeScope } from '../../shared/api'
import type { Account, Capability } from '../../shared/types'
import type { Core } from '../core'
import { makeTestCore, type TestCore } from '../testing/fakes'
import { FakeConnector } from '../testing/fake-connector'
import type { ConnectorContext, NormalizedTarget } from '../ports'
import { newId } from '../db/database'

/** A second platform, to check that accounts only work with their own platform's addresses. */
export class OtherConnector extends FakeConnector {
  constructor() {
    super({ id: 'other', platform: 'other', identity: 'other_user' })
  }
  override matches(input: string): boolean {
    return input.includes('other.test')
  }
  override normalizeTarget(input: string): NormalizedTarget {
    const name = input.replace(/^https?:\/\/other\.test\//, '').replace(/\/+$/, '')
    return { target: name, url: `https://other.test/${name}` }
  }
}

/** Counts how many assessments run at the same moment inside the account's session. */
export class OverlapProbe extends FakeConnector {
  active = 0
  maxActive = 0
  readonly order: string[] = []

  override async assess(ctx: ConnectorContext): Promise<Capability[]> {
    return ctx.session.withAgentControl(`probe:${ctx.channel.id}`, async () => {
      this.active += 1
      this.maxActive = Math.max(this.maxActive, this.active)
      this.order.push(`start ${ctx.channel.target}`)
      await new Promise((resolve) => setTimeout(resolve, 15))
      this.order.push(`end ${ctx.channel.target}`)
      this.active -= 1
      return this.capabilities
    })
  }
}

export interface World {
  t: TestCore
  core: Core
  fake: FakeConnector
  productId: string
  account: Account
  /** Scopes announced by the core, in order. */
  changes: ChangeScope[]
  call<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<ApiResult<M>>
  /** The ApiError code a call is refused with. */
  refusal<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<string>
  addProduct(name?: string): string
  addAccount(label?: string): Promise<Account>
}

export function makeWorld(options: { fake?: FakeConnector; extra?: FakeConnector[] } = {}): World {
  const fake = options.fake ?? new FakeConnector()
  const t = makeTestCore({ connectors: [fake, ...(options.extra ?? [])] })
  const { core } = t
  const changes: ChangeScope[] = []
  core.events.subscribe((event) => {
    if (event.type === 'changed') changes.push(event.scope)
  })

  const addProduct = (name = 'Natal Mystic'): string => {
    const id = newId()
    const now = core.clock.now().toISOString()
    core.db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now)
    return id
  }
  const call = <M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<ApiResult<M>> => core.router.call(method, args)

  const world: World = {
    t,
    core,
    fake,
    productId: addProduct(),
    account: undefined as unknown as Account,
    changes,
    call,
    async refusal(method, args) {
      try {
        await call(method, args)
      } catch (error) {
        if (error instanceof ApiError) return error.code
        throw error
      }
      throw new Error(`${method} was expected to be refused`)
    },
    addProduct,
    addAccount: (label = 'Natal Mystic Reddit') => call('accounts.create', { platform: fake.platform, label })
  }
  return world
}

/** A world with one account already created. */
export async function makeReadyWorld(options: { fake?: FakeConnector; extra?: FakeConnector[] } = {}): Promise<World> {
  const world = makeWorld(options)
  world.account = await world.addAccount()
  return world
}
