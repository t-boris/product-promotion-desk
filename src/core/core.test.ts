import { describe, expect, it } from 'vitest'
import { ApiError } from '../shared/api'
import { makeTestCore } from './testing/fakes'

describe('Core', () => {
  it('boots with an in-memory database and answers app.info', async () => {
    const { core } = makeTestCore()
    const info = await core.router.call('app.info', undefined)
    expect(info.version).toBe('0.0.0-test')
    expect(info.webMode.enabled).toBe(false)
    await core.shutdown()
  })

  it('rejects unknown API methods with not_implemented', async () => {
    const { core } = makeTestCore()
    await expect(core.router.call('nope' as never, undefined as never)).rejects.toMatchObject({ code: 'not_implemented' })
    await core.shutdown()
  })

  it('selects an installed engine and refuses an unknown one', async () => {
    const { core } = makeTestCore()
    const settings = await core.router.call('engines.select', { id: 'claude' })
    expect(settings.engineId).toBe('claude')
    await expect(core.router.call('engines.select', { id: 'codex' })).rejects.toBeInstanceOf(ApiError)
    await core.shutdown()
  })

  it('persists settings in the database', async () => {
    const { core } = makeTestCore()
    await core.router.call('app.settings.update', { notifications: false })
    expect(core.settings.app().notifications).toBe(false)
    await core.shutdown()
  })
})
