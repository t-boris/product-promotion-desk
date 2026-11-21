import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import { makeTestCore } from './testing/fakes'

describe('the look of the application in the settings (visual-system.md §33)', () => {
  it('is "Follow macOS" with a still background until the owner chooses', async () => {
    const { core } = makeTestCore()
    expect(DEFAULT_SETTINGS.theme).toBe('system')
    expect(DEFAULT_SETTINGS.animatedBackground).toBe(false)
    const settings = await core.router.call('app.settings.get', undefined)
    expect(settings.theme).toBe('system')
    expect(settings.animatedBackground).toBe(false)
    await core.shutdown()
  })

  it('stores a theme and the animated background, and keeps them across a read and across other changes', async () => {
    const { core } = makeTestCore()
    const saved = await core.router.call('app.settings.update', { theme: 'midnight', animatedBackground: true })
    expect(saved).toMatchObject({ theme: 'midnight', animatedBackground: true })
    expect(core.settings.app()).toMatchObject({ theme: 'midnight', animatedBackground: true })
    // A change that does not touch the look leaves it alone (Partial<AppSettings> keeps working).
    const other = await core.router.call('app.settings.update', { notifications: false })
    expect(other).toMatchObject({ theme: 'midnight', animatedBackground: true, notifications: false })
    // One of the two can change without the other.
    const still = await core.router.call('app.settings.update', { animatedBackground: false })
    expect(still).toMatchObject({ theme: 'midnight', animatedBackground: false })
    await core.shutdown()
  })

  it('tells the renderer that the settings changed, so every window follows at once', async () => {
    const { core } = makeTestCore()
    const seen: unknown[] = []
    core.events.subscribe((event) => seen.push(event))
    await core.router.call('app.settings.update', { theme: 'orchid' })
    expect(seen).toContainEqual({ type: 'changed', scope: 'settings' })
    await core.shutdown()
  })

  it('refuses a theme the application does not have, and an animated background that is not on or off, and stores nothing of the request', async () => {
    const { core } = makeTestCore()
    for (const theme of ['neon', '', 'Daylight', 'dark', 7, null]) {
      await expect(core.router.call('app.settings.update', { notifications: false, theme: theme as never })).rejects.toMatchObject({ code: 'invalid_input' })
    }
    for (const animatedBackground of ['yes', 1, 'true', null]) {
      await expect(core.router.call('app.settings.update', { notifications: false, animatedBackground: animatedBackground as never })).rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(core.settings.app()).toMatchObject({ theme: 'system', animatedBackground: false, notifications: true })
    await core.shutdown()
  })

  it('reads a stored value that is not a known choice as the default, so a damaged row never blanks the page', async () => {
    const { core } = makeTestCore()
    core.settings.setRaw('app', { ...core.settings.app(), theme: 'neon', animatedBackground: 'yes' })
    expect(core.settings.app()).toMatchObject({ theme: 'system', animatedBackground: false })
    // And the store itself never writes one back.
    expect(core.settings.updateApp({ theme: 'neon' as never, animatedBackground: 'yes' as never })).toMatchObject({ theme: 'system', animatedBackground: false })
    await core.shutdown()
  })

  it('gives an older database, which has neither value, the defaults', async () => {
    const { core } = makeTestCore()
    core.settings.setRaw('app', { engineId: null, notifications: true, webMode: { enabled: false, port: 47615 }, publishWith: 'connector' })
    expect(core.settings.app()).toMatchObject({ theme: 'system', animatedBackground: false })
    await core.shutdown()
  })
})
