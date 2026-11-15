// The step runner is shared by every back end of the browser service, so what it refuses, what it does first and what it says are pinned here
// on a driver that records every call: the host check before any input, real input before scripts, a script only as the fallback.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PageStep } from '../core/ports'
import { fileInputByRefScript, locateScript, markOptionScript, mouseSeenScript, mouseWatchScript, prepareTypingScript, scriptClickScript, selectOptionScript, setValueScript, typedScript, typingGuardScript } from './page-scripts'
import { checkUploadable, runPageStep, type StepDriver } from './step-runner'

const HOSTS = ['facebook.com']

interface Fake {
  driver: StepDriver
  calls: string[]
  /** Answers by script text; a script that is not listed answers { ok: false }. */
  answers: Map<string, unknown>
  url: string
  attachError: Error | null
}

function fake(url = 'https://www.facebook.com/r.php'): Fake {
  const state: Fake = {
    calls: [],
    answers: new Map(),
    url,
    attachError: null,
    driver: undefined as unknown as StepDriver
  }
  state.driver = {
    currentUrl: () => state.url,
    read: async <T>(script: string): Promise<T> => {
      state.calls.push(`read:${[...state.answers.keys()].includes(script) ? 'answered' : 'unanswered'}`)
      return (state.answers.has(script) ? state.answers.get(script) : { ok: false }) as T
    },
    pressKey: async (key) => void state.calls.push(`key:${key}`),
    mouseClick: async (x, y) => void state.calls.push(`mouse:${x},${y}`),
    insertText: async (text) => void state.calls.push(`insert:${text}`),
    focus: async () => void state.calls.push('focus'),
    attachFile: async (_expression, path, what) => {
      state.calls.push(`attach:${what}:${path}`)
      if (state.attachError) throw state.attachError
    }
  }
  return state
}

const run = (f: Fake, step: PageStep) => runPageStep(f.driver, step, HOSTS)
const on = (f: Fake, script: string, answer: unknown): void => void f.answers.set(script, answer)

describe('the host check comes before any input', () => {
  it('does nothing on a page that is not one of the platform, or on no page', async () => {
    for (const url of ['https://evil.example/r.php', 'https://notfacebook.com/', 'https://facebook.com.evil.example/', '', 'about:blank']) {
      const f = fake(url)
      const result = await run(f, { do: 'key', key: 'Enter' })
      expect(result.status, url).toBe('wrong_host')
      expect(f.calls, url).toEqual([])
    }
    const none = await run(fake(''), { do: 'click', ref: 'e1' })
    expect(none.detail).toContain('not loaded')
    expect((await run(fake('https://evil.example/'), { do: 'click', ref: 'e1' })).detail).toContain('on evil.example')
  })

  it('accepts the platform and its subdomains', async () => {
    for (const url of ['https://facebook.com/', 'https://www.facebook.com/r.php', 'https://m.facebook.com/x']) {
      expect((await run(fake(url), { do: 'key', key: 'Tab' })).status, url).toBe('done')
    }
  })
})

describe('a key', () => {
  it('is pressed on the focused page, after focus, once', async () => {
    const f = fake()
    const result = await run(f, { do: 'key', key: 'Enter' })
    expect(result).toEqual({ status: 'done', detail: 'Pressed Enter.' })
    expect(f.calls).toEqual(['focus', 'key:Enter'])
  })
})

describe('a click', () => {
  it('says the element is not there when it is not', async () => {
    const f = fake()
    expect((await run(f, { do: 'click', ref: 'e1' })).status).toBe('not_found')
    expect(f.calls.filter((c) => c.startsWith('mouse'))).toEqual([])
  })

  it('refuses a disabled element without touching it', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true, disabled: true, x: 5, y: 6, hit: true })
    expect((await run(f, { do: 'click', ref: 'e1' })).status).toBe('refused')
    expect(f.calls.some((c) => c.startsWith('mouse'))).toBe(false)
  })

  it('uses the real mouse at the centre when the page saw it', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true, x: 40, y: 50, hit: true })
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result).toEqual({ status: 'done', detail: 'Clicked e1 with a mouse click.' })
    expect(f.calls).toEqual(['read:answered', 'read:answered', 'focus', 'mouse:40,50', 'read:answered'])
  })

  it('falls back to the page\'s own click only when the real one did not arrive, and says so', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true, x: 40, y: 50, hit: true })
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: false })
    on(f, scriptClickScript('e1'), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('done')
    expect(result.detail).toContain('by script')
    expect(f.calls.filter((c) => c.startsWith('mouse'))).toEqual(['mouse:40,50'])
  })

  it('goes straight to the script when something covers the element, and refuses when that fails too', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true, x: 40, y: 50, hit: false })
    expect((await run(f, { do: 'click', ref: 'e1' })).status).toBe('refused')
    expect(f.calls.some((c) => c.startsWith('mouse'))).toBe(false)
    on(f, scriptClickScript('e1'), { ok: true })
    expect((await run(f, { do: 'click', ref: 'e1' })).status).toBe('done')
  })
})

describe('typing', () => {
  it('refuses an element that does not take text, saying whether it is disabled', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true })
    expect((await run(f, { do: 'type', ref: 'e1', text: 'x' })).detail).toContain('does not take text')
    on(f, prepareTypingScript('e1'), { ok: false, reason: 'disabled' })
    expect((await run(f, { do: 'type', ref: 'e1', text: 'x' })).detail).toContain('is disabled')
    expect(f.calls.some((c) => c.startsWith('insert'))).toBe(false)
  })

  it('types with the browser\'s own insertion after focus, and checks that the text landed', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true })
    on(f, prepareTypingScript('e1'), { ok: true })
    on(f, typingGuardScript('e1', HOSTS), { ok: true })
    on(f, typedScript('e1', 'Boris'), { ok: true })
    expect(await run(f, { do: 'type', ref: 'e1', text: 'Boris' })).toEqual({ status: 'done', detail: 'Typed into e1.' })
    expect(f.calls).toEqual(['read:answered', 'read:answered', 'focus', 'read:answered', 'insert:Boris', 'read:answered'])
  })

  it('sets the value by script only when the typing did not land, and refuses when that does not either', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ok: true })
    on(f, prepareTypingScript('e1'), { ok: true })
    on(f, typingGuardScript('e1', HOSTS), { ok: true })
    on(f, typedScript('e1', 'Boris'), { ok: false })
    expect((await run(f, { do: 'type', ref: 'e1', text: 'Boris' })).detail).toContain('did not take the text')
    on(f, setValueScript('e1', 'Boris'), { ok: true })
    const result = await run(f, { do: 'type', ref: 'e1', text: 'Boris' })
    expect(result.status).toBe('done')
    expect(result.detail).toContain('by script')
  })
})

describe('typing is guarded in the page, right before the first character', () => {
  /** A typing step that reaches the point of typing: the element is there and takes text; what the guard answers is the case. */
  function ready(guard: unknown): Fake {
    const f = fake()
    on(f, locateScript('e1'), { ok: true })
    on(f, prepareTypingScript('e1'), { ok: true })
    on(f, typingGuardScript('e1', HOSTS), guard)
    on(f, typedScript('e1', 'secret'), { ok: true })
    on(f, setValueScript('e1', 'secret'), { ok: true })
    return f
  }

  it('types nothing, by any route, when the page left the platform after the first check', async () => {
    const f = ready({ ok: false, reason: 'wrong_host', host: 'evil.example' })
    const result = await run(f, { do: 'type', ref: 'e1', text: 'secret' })
    expect(result.status).toBe('wrong_host')
    expect(result.detail).toContain('on evil.example')
    expect(f.calls.some((c) => c.startsWith('insert'))).toBe(false)
    // nothing after the guard: no read that checks the field and no setValue fallback either
    expect(f.calls).toEqual(['read:answered', 'read:answered', 'focus', 'read:answered'])
  })

  it('types nothing when the cursor is not in the element (the page moved the focus)', async () => {
    const f = ready({ ok: false, reason: 'not_focused' })
    const result = await run(f, { do: 'type', ref: 'e1', text: 'secret' })
    expect(result).toEqual({ status: 'refused', detail: 'The cursor is not in e1, so nothing was typed.' })
    expect(f.calls.some((c) => c.startsWith('insert'))).toBe(false)
    expect(f.calls).toEqual(['read:answered', 'read:answered', 'focus', 'read:answered'])
  })

  it('says the element is gone when the page changed under the guard', async () => {
    const f = ready({ ok: false, reason: 'not_found' })
    expect((await run(f, { do: 'type', ref: 'e1', text: 'secret' })).status).toBe('not_found')
    expect(f.calls.some((c) => c.startsWith('insert'))).toBe(false)
  })

  it('refuses when the guard says nothing it understands (it fails closed)', async () => {
    const f = ready({ ok: false })
    expect((await run(f, { do: 'type', ref: 'e1', text: 'secret' })).status).toBe('refused')
    expect(f.calls.some((c) => c.startsWith('insert'))).toBe(false)
  })

  it('asks the page about the hosts the step was given, and nothing wider', () => {
    const script = typingGuardScript('e1', ['instagram.com'])
    expect(script).toContain('["instagram.com"]')
    expect(script).toContain('location.hostname')
    expect(script).toContain('document.activeElement')
    expect(script).toContain('shadowRoot.activeElement')
  })
})

describe('a choice from a list', () => {
  it('takes an option of a plain list at once', async () => {
    const f = fake()
    on(f, locateScript('e2'), { ok: true })
    on(f, selectOptionScript('e2', 'May'), { ok: true })
    expect(await run(f, { do: 'select', ref: 'e2', text: 'May' })).toEqual({ status: 'done', detail: 'Chose an option in e2.' })
    expect(f.calls.some((c) => c.startsWith('mouse'))).toBe(false)
  })

  it('says what is wrong when the list has no such option', async () => {
    const f = fake()
    on(f, locateScript('e2'), { ok: true })
    on(f, selectOptionScript('e2', 'Smarch'), { ok: false, reason: 'no_such_option' })
    expect((await run(f, { do: 'select', ref: 'e2', text: 'Smarch' })).detail).toContain('no option like that')
    on(f, selectOptionScript('e2', 'Smarch'), { ok: false, reason: 'disabled' })
    expect((await run(f, { do: 'select', ref: 'e2', text: 'Smarch' })).detail).toContain('cannot be chosen from (disabled)')
  })

  it('opens a drop-down that is not a list, then clicks the option with that text', async () => {
    const f = fake()
    on(f, locateScript('e2'), { ok: true, x: 10, y: 20, hit: true })
    on(f, selectOptionScript('e2', 'May'), { ok: false, reason: 'not_a_list' })
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    on(f, markOptionScript('e2', 'May'), { ok: true, ref: 'e9' })
    on(f, locateScript('e9'), { ok: true, x: 11, y: 90, hit: true })
    expect(await run(f, { do: 'select', ref: 'e2', text: 'May' })).toEqual({ status: 'done', detail: 'Chose an option in e2.' })
    expect(f.calls.filter((c) => c.startsWith('mouse'))).toEqual(['mouse:10,20', 'mouse:11,90'])
  })

  it('names the options a drop-down offers when none is like the asked one', async () => {
    const f = fake()
    on(f, locateScript('e2'), { ok: true, x: 10, y: 20, hit: true })
    on(f, selectOptionScript('e2', 'Smarch'), { ok: false, reason: 'not_a_list' })
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    on(f, markOptionScript('e2', 'Smarch'), { ok: false, options: ['Jan', 'Feb'] })
    expect((await run(f, { do: 'select', ref: 'e2', text: 'Smarch' })).detail).toBe('e2 has no option like that. It offers: Jan, Feb.')
    on(f, markOptionScript('e2', 'Smarch'), { ok: false, reason: 'no_options' })
    expect((await run(f, { do: 'select', ref: 'e2', text: 'Smarch' })).detail).toContain('showed no options')
  })
})

describe('an upload', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'step-runner-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('puts a regular file into the input and says so', async () => {
    const path = join(dir, 'photo.png')
    await writeFile(path, 'x')
    const f = fake()
    expect(await run(f, { do: 'upload', ref: 'e3', path })).toEqual({ status: 'done', detail: 'Put the file into e3.' })
    expect(f.calls).toEqual([`attach:e3:${path}`])
  })

  it('refuses a relative path, a directory and a missing file before the driver is asked, and a driver that fails', async () => {
    const f = fake()
    expect((await run(f, { do: 'upload', ref: 'e3', path: 'photo.png' })).detail).toContain('Only absolute file paths')
    expect((await run(f, { do: 'upload', ref: 'e3', path: dir })).detail).toContain('not a file')
    expect((await run(f, { do: 'upload', ref: 'e3', path: join(dir, 'nope.png') })).status).toBe('refused')
    expect(f.calls).toEqual([])
    const path = join(dir, 'ok.png')
    await writeFile(path, 'x')
    f.attachError = new Error('no file input matches')
    const result = await run(f, { do: 'upload', ref: 'e3', path })
    expect(result.status).toBe('refused')
    expect(result.detail).toContain('no file input matches')
  })

  it('refuses a file over 50 MB', async () => {
    const path = join(dir, 'big.bin')
    await writeFile(path, Buffer.alloc(50 * 1024 * 1024 + 1))
    await expect(checkUploadable(path)).rejects.toThrow('too large')
    await writeFile(path, Buffer.alloc(50 * 1024 * 1024))
    await expect(checkUploadable(path)).resolves.toBeUndefined()
  })

  it('looks the input up by its ref', async () => {
    let seen = ''
    const f = fake()
    f.driver.attachFile = async (expression) => {
      seen = expression
    }
    const path = join(dir, 'a.png')
    await writeFile(path, 'x')
    await run(f, { do: 'upload', ref: 'e3', path })
    expect(seen).toBe(fileInputByRefScript('e3'))
  })
})
