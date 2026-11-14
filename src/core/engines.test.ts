// The engine registry: the owner's selection, and the automatic choice on first launch.

import { describe, expect, it } from 'vitest'
import { EngineRegistry } from './engines'
import type { SettingsStore } from './settings'
import { FakeEngine, makeTestCore } from './testing/fakes'

/** A registry of its own over a fresh settings store: no engine is selected at the start (the test core selects its own). */
async function setup(engines: FakeEngine[]): Promise<{ registry: EngineRegistry; settings: SettingsStore }> {
  const { core } = makeTestCore()
  core.settings.updateApp({ engineId: null })
  return { registry: new EngineRegistry(engines, core.settings), settings: core.settings }
}

describe('EngineRegistry.autoSelect', () => {
  it('selects the first ready engine when none is in use', async () => {
    const claude = new FakeEngine('claude', 'Claude Code')
    const { registry, settings } = await setup([claude])
    expect((await registry.autoSelect())?.id).toBe('claude')
    expect(settings.app().engineId).toBe('claude')
    expect(registry.selected()?.id).toBe('claude')
  })

  it('prefers an engine that is tool-free', async () => {
    const codex = new FakeEngine('codex', 'Codex')
    codex.toolFree = false
    const claude = new FakeEngine('claude', 'Claude Code')
    const { registry } = await setup([codex, claude])
    expect((await registry.autoSelect())?.id).toBe('claude')
  })

  it('takes an engine that is not tool-free when it is the only one ready', async () => {
    const codex = new FakeEngine('codex', 'Codex')
    codex.toolFree = false
    const claude = new FakeEngine('claude', 'Claude Code')
    claude.installed = false
    const { registry } = await setup([codex, claude])
    expect((await registry.autoSelect())?.id).toBe('codex')
  })

  it('never replaces a choice the owner made, even while that engine is not ready', async () => {
    const codex = new FakeEngine('codex', 'Codex')
    codex.installed = false
    const claude = new FakeEngine('claude', 'Claude Code')
    const { registry, settings } = await setup([codex, claude])
    settings.updateApp({ engineId: 'codex' })
    expect(await registry.autoSelect()).toBeNull()
    expect(settings.app().engineId).toBe('codex')
  })

  it('changes nothing when no engine is installed', async () => {
    const claude = new FakeEngine('claude', 'Claude Code')
    claude.installed = false
    const { registry, settings } = await setup([claude])
    expect(await registry.autoSelect()).toBeNull()
    expect(settings.app().engineId).toBeNull()
  })

  it('replaces a stored choice that no longer names an engine of this build', async () => {
    const claude = new FakeEngine('claude', 'Claude Code')
    const { registry, settings } = await setup([claude])
    settings.updateApp({ engineId: 'codex' })
    expect((await registry.autoSelect())?.id).toBe('claude')
    expect(settings.app().engineId).toBe('claude')
  })
})
