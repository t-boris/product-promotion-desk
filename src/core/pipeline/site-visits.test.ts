// Site visits (DEC-073): read from the analytics service the owner named, read-only.
import { afterEach, describe, expect, it } from 'vitest'
import { localDay } from '../../shared/seasonal'
import { looksLikeSiteId, siteIdOf, visitRowName } from '../../shared/site-visits'
import type { HttpPort, HttpRequest } from '../ports'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const KEY = 'plausible-key-1234567890'
/** A Plausible that knows one key and answers the two questions the application asks. */
function fakePlausible(asked: HttpRequest[], answer: { status?: number } = {}): HttpPort {
  return {
    request: async (req) => {
      asked.push(req)
      if (req.headers?.authorization !== `Bearer ${KEY}`) return { status: 401, headers: {}, text: '{"error":"Invalid API key"}' }
      if (answer.status) return { status: answer.status, headers: {}, text: '{}' }
      const body = req.json as { dimensions?: string[] }
      const results = body.dimensions
        ? [
            { metrics: [40], dimensions: ['reddit', 'beginnerastrology'] },
            { metrics: [300], dimensions: ['(not set)', '(not set)'] },
            { metrics: [7], dimensions: ['instagram', 'boris_chart_notebook'] }
          ]
        : [{ metrics: [412], dimensions: [] }]
      return { status: 200, headers: {}, text: JSON.stringify({ results, meta: {}, query: {} }) }
    }
  }
}
const useNetwork = (http: HttpPort): void => void ((world.core as unknown as { http: HttpPort }).http = http)

describe('site visits', () => {
  it('are off until the owner names the analytics; with Plausible the visitors are read with the key from the vault, and the key is shown nowhere', async () => {
    world = makeWorld()
    const productId = world.product.id
    const call = world.core.router.call.bind(world.core.router)
    const asked: HttpRequest[] = []
    useNetwork(fakePlausible(asked))
    expect(await call('visits.get', { productId })).toMatchObject({ source: 'none', canRead: false, total: null, rows: [] })
    await expect(call('visits.read', { productId })).rejects.toMatchObject({ code: 'invalid_state' })

    const set = await call('visits.setSource', { productId, source: 'plausible', key: KEY })
    expect(set).toMatchObject({ source: 'plausible', siteId: 'natalmystic.com', host: 'https://plausible.io', hasKey: true, canRead: true })
    expect(JSON.stringify(set)).not.toContain(KEY)

    const read = await call('visits.read', { productId })
    expect(read).toMatchObject({ total: 412, error: null, rows: [{ source: 'reddit', campaign: 'beginnerastrology', visitors: 40 }, { source: 'instagram', campaign: 'boris_chart_notebook', visitors: 7 }] })
    expect(asked.every((r) => r.url === 'https://plausible.io/api/v2/query' && r.method === 'POST')).toBe(true)
    expect(asked[0]!.json).toMatchObject({ site_id: 'natalmystic.com', metrics: ['visitors'] })
    expect(world.core.db.prepare('SELECT * FROM site_visits').all().some((row) => JSON.stringify(row).includes(KEY))).toBe(false)

    // Fresh: the daily job does not ask again; a day later it does.
    const before = asked.length
    expect(await world.core.services.visits!.readDue()).toBe(0)
    expect(asked.length).toBe(before)
    world.clock.advance(24 * 3_600_000)
    expect(await world.core.services.visits!.readDue()).toBe(1)

    // A refused answer is kept as words the owner can act on, and the last numbers stay.
    useNetwork(fakePlausible(asked, { status: 402 }))
    await expect(call('visits.read', { productId })).rejects.toMatchObject({ code: 'read_failed' })
    expect(await call('visits.get', { productId })).toMatchObject({ total: 412, error: expect.stringContaining('not part of this plan') })

    // "None" forgets the key and the numbers.
    expect(await call('visits.setSource', { productId, source: 'none' })).toMatchObject({ source: 'none', hasKey: false, canRead: false, total: null, rows: [] })
    expect(world.engine.calls).toHaveLength(0)
  })

  it('refuses a site that is not a domain, a service address that is not https, and names the site from the product', async () => {
    world = makeWorld()
    const productId = world.product.id
    const call = world.core.router.call.bind(world.core.router)
    await expect(call('visits.setSource', { productId, source: 'plausible', siteId: 'https://natalmystic.com/x?y', key: KEY })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('visits.setSource', { productId, source: 'plausible', host: 'http://stats.example.org', key: KEY })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(await call('visits.setSource', { productId, source: 'plausible', host: 'https://stats.example.org/some/path', key: KEY })).toMatchObject({ host: 'https://stats.example.org' })
    expect(await call('visits.setSource', { productId, source: 'google' })).toMatchObject({ source: 'google', canRead: false, hasKey: false })
    expect(siteIdOf('https://www.Example.com/shop')).toBe('example.com')
    expect(looksLikeSiteId('example.com')).toBe(true)
    expect(looksLikeSiteId('example')).toBe(false)
    expect(visitRowName({ source: 'reddit', campaign: 'beginnerastrology' })).toBe('reddit · beginnerastrology')
    expect(visitRowName({ source: '', campaign: '' })).toBe('(no tag)')
  })

  it('can be a goal: visitors of the site since the goal was set, only when the application can read them', async () => {
    world = makeWorld()
    const productId = world.product.id
    const call = world.core.router.call.bind(world.core.router)
    const asked: HttpRequest[] = []
    useNetwork(fakePlausible(asked))
    const product = await call('products.saveGoal', { id: productId, goal: { targetAction: 'Open the site', successMetrics: [], notes: '' } })
    const goalId = product.goals.at(-1)!.id
    const by = localDay(world.clock.now().getTime() + 7 * 86_400_000)
    await expect(call('goals.setTarget', { productId, goalId, target: { measure: 'visits', number: 500, by } })).rejects.toMatchObject({ code: 'invalid_state' })
    await call('visits.setSource', { productId, source: 'plausible', key: KEY })
    const set = await call('goals.setTarget', { productId, goalId, target: { measure: 'visits', number: 500, by } })
    expect(set[0]).toMatchObject({ measure: 'visits', count: 412, state: 'running' })
    const today = localDay(world.clock.now().getTime())
    expect(asked.at(-1)!.json).toMatchObject({ date_range: [today, today] })
    // Asked once an hour at most.
    const n = asked.length
    await call('goals.progress', { productId })
    expect(asked.length).toBe(n)
    // The service does not answer: the last count stays, with the reason.
    world.clock.advance(2 * 3_600_000)
    useNetwork(fakePlausible(asked, { status: 429 }))
    expect((await call('goals.progress', { productId }))[0]).toMatchObject({ count: 412, problem: expect.stringContaining('wait') })
  })
})
