import { describe, expect, it } from 'vitest'
import { ApiError } from '../shared/api'
import { AiError } from './ports'
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
      engine.on('t', 'ok').on('engines.model', 'ok')
      expect(core.settings.app().models).toEqual({ claude: '', codex: '' })
      await core.engines.require().run({ label: 't', prompt: 'hi' })
      expect(engine.calls.at(-1)?.model).toBeUndefined()

      await core.router.call('engines.setModel', { id: 'claude', model: '  opus  ' })
      expect(core.settings.app().models).toEqual({ claude: 'opus', codex: '' })
      await core.engines.require().run({ label: 't', prompt: 'hi' })
      expect(engine.calls.at(-1)?.model).toBe('opus')
      // a task that names its own model keeps it: the model is tried that way before it is kept
      await core.engines.require().run({ label: 't', prompt: 'hi', model: 'sonnet' })
      expect(engine.calls.at(-1)?.model).toBe('sonnet')
      await core.shutdown()
    })

    it('is tried with one short question before it is kept, and the engine\'s refusal is said in its own words and nothing is kept', async () => {
      const { core, engine } = makeTestCore()
      engine.on('engines.model', 'ok')
      await core.router.call('engines.setModel', { id: 'claude', model: 'opus' })
      expect(engine.calls.filter((c) => c.label === 'engines.model')).toEqual([expect.objectContaining({ model: 'opus', prompt: expect.stringContaining('ok') })])

      engine.on('engines.model', () => {
        throw new AiError('failed', 'There is no model called nope-1.\nTry another.')
      })
      const refused = core.router.call('engines.setModel', { id: 'claude', model: 'nope-1' })
      await expect(refused).rejects.toMatchObject({ code: 'invalid_model', message: 'Fake engine did not take the model "nope-1": There is no model called nope-1. Try another.' })
      expect(core.settings.app().models.claude).toBe('opus')
      await core.shutdown()
    })

    it('goes back to the engine\'s own default with an empty name, without asking the engine anything', async () => {
      const { core, engine } = makeTestCore()
      engine.on('engines.model', 'ok')
      await core.router.call('engines.setModel', { id: 'claude', model: 'opus' })
      const asked = engine.calls.length
      await core.router.call('engines.setModel', { id: 'claude', model: '' })
      expect(core.settings.app().models.claude).toBe('')
      expect(engine.calls).toHaveLength(asked)
      await core.engines.require().run({ label: 'engines.model', prompt: 'hi' })
      expect(engine.calls.at(-1)?.model).toBeUndefined()
      await core.shutdown()
    })

    it('refuses a name that is not a plain model name, an unknown engine, and an engine that is not installed, and keeps nothing', async () => {
      const { core, engine } = makeTestCore()
      engine.on('engines.model', 'ok')
      await expect(core.router.call('engines.setModel', { id: 'claude', model: '--help' })).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(core.router.call('engines.setModel', { id: 'codex', model: 'gpt-5.5' })).rejects.toMatchObject({ code: 'not_found' })
      engine.installed = false
      await expect(core.router.call('engines.setModel', { id: 'claude', model: 'opus' })).rejects.toMatchObject({ code: 'engine_unavailable' })
      expect(core.settings.app().models).toEqual({ claude: '', codex: '' })
      expect(engine.calls).toHaveLength(0)
      await core.shutdown()
    })

    it('cannot be set through the settings as a whole, which would keep a name nobody tried', async () => {
      const { core } = makeTestCore()
      await expect(core.router.call('app.settings.update', { models: { claude: 'opus', codex: '' } })).rejects.toMatchObject({ code: 'invalid_input' })
      expect(core.settings.app().models.claude).toBe('')
      // and the rest of the settings still change as before
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
