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

  describe('the model of an engine', () => {
    it('is the engine\'s own default until the owner chooses one, and every run is asked for the one chosen for that engine', async () => {
      const { core, engine } = makeTestCore()
      engine.on('t', 'ok')
      expect(core.settings.app().models).toEqual({ claude: '', codex: '' })
      await core.engines.require().run({ label: 't', prompt: 'hi' })
      expect(engine.calls.at(-1)?.model).toBeUndefined()

      await core.router.call('engines.setModel', { id: 'claude', model: 'opus' })
      expect(core.settings.app().models).toEqual({ claude: 'opus', codex: '' })
      await core.engines.require().run({ label: 't', prompt: 'hi' })
      expect(engine.calls.at(-1)?.model).toBe('opus')
      // a task that names its own model keeps it
      await core.engines.require().run({ label: 't', prompt: 'hi', model: 'sonnet' })
      expect(engine.calls.at(-1)?.model).toBe('sonnet')
      await core.shutdown()
    })

    it('lists what the engine offers, once until the next re-check, and nothing is asked of a model for it', async () => {
      const { core, engine } = makeTestCore()
      expect(await core.router.call('engines.models', { id: 'claude' })).toEqual(engine.modelList)
      await core.router.call('engines.models', { id: 'claude' })
      expect(engine.listed).toBe(1)
      expect(engine.calls).toHaveLength(0)
      await core.router.call('engines.list', undefined)
      await core.router.call('engines.models', { id: 'claude' })
      expect(engine.listed).toBe(2)
      await expect(core.router.call('engines.models', { id: 'codex' })).rejects.toMatchObject({ code: 'not_found' })
      await core.shutdown()
    })

    it('says why the list cannot be read, and does not keep a failed list', async () => {
      const { core, engine } = makeTestCore()
      engine.installed = false
      await expect(core.router.call('engines.models', { id: 'claude' })).rejects.toMatchObject({ code: 'engine_unavailable' })
      engine.installed = true
      expect(await core.router.call('engines.models', { id: 'claude' })).toEqual(engine.modelList)
      await core.shutdown()
    })

    it('keeps only a model the engine offers, and goes back to the default with an empty name', async () => {
      const { core } = makeTestCore()
      await core.router.call('engines.setModel', { id: 'claude', model: ' sonnet ' })
      expect(core.settings.app().models.claude).toBe('sonnet')
      await expect(core.router.call('engines.setModel', { id: 'claude', model: 'nope-1' })).rejects.toMatchObject({ code: 'invalid_model', message: 'Fake engine does not offer the model "nope-1". Choose one from its list.' })
      expect(core.settings.app().models.claude).toBe('sonnet')
      await core.router.call('engines.setModel', { id: 'claude', model: '' })
      expect(core.settings.app().models.claude).toBe('')
      await core.shutdown()
    })

    it('refuses a name that is not a plain model name, an unknown engine, and a list that cannot be read, and keeps nothing', async () => {
      const { core, engine } = makeTestCore()
      await expect(core.router.call('engines.setModel', { id: 'claude', model: '--help' })).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(core.router.call('engines.setModel', { id: 'codex', model: 'gpt-5.5' })).rejects.toMatchObject({ code: 'not_found' })
      engine.installed = false
      await expect(core.router.call('engines.setModel', { id: 'claude', model: 'opus' })).rejects.toMatchObject({ code: 'engine_unavailable' })
      expect(core.settings.app().models).toEqual({ claude: '', codex: '' })
      expect(engine.calls).toHaveLength(0)
      await core.shutdown()
    })

    it('cannot be set through the settings as a whole, which would keep a name nobody checked', async () => {
      const { core } = makeTestCore()
      await expect(core.router.call('app.settings.update', { models: { claude: 'opus', codex: '' } })).rejects.toMatchObject({ code: 'invalid_input' })
      expect(core.settings.app().models.claude).toBe('')
      await core.router.call('app.settings.update', { notifications: false })
      expect(core.settings.app().models).toEqual({ claude: '', codex: '' })
      await core.shutdown()
    })
  })

  it('persists settings in the database', async () => {
    const { core } = makeTestCore()
    await core.router.call('app.settings.update', { notifications: false })
    expect(core.settings.app().notifications).toBe(false)
    await core.shutdown()
  })

  it('refuses a web port outside 1024-65535 and stores nothing of the same request (BUG-044)', async () => {
    const { core } = makeTestCore()
    for (const port of [99999, 65536, 1023, 80, 0, -1, 80.5, Number.NaN]) {
      await expect(core.router.call('app.settings.update', { notifications: false, webMode: { enabled: true, port } })).rejects.toMatchObject({
        code: 'invalid_input',
        message: 'Use a port from 1024 to 65535'
      })
    }
    expect(core.settings.app()).toMatchObject({ notifications: true, webMode: { enabled: false, port: 47615 } })

    const saved = await core.router.call('app.settings.update', { webMode: { enabled: false, port: 8080 } })
    expect(saved.webMode).toEqual({ enabled: false, port: 8080 })
    // A change that does not touch the port is never held back by the stored one.
    expect((await core.router.call('app.settings.update', { notifications: false })).webMode.port).toBe(8080)
    await core.shutdown()
  })
})
