// The step runner is shared by every back end of the browser service, so what it refuses, what it does first and what it says are pinned here
// on a driver that records every call: the host check before any input, real input before scripts, a script only as the fallback.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PageStep } from '../core/ports'
import { cursorAtScript, cursorScript, fileInputByRefScript, locateScript, scrollIntoViewScript, scrollStateScript, markOptionScript, mouseSeenScript, mouseWatchScript, prepareTypingScript, scriptClickScript, selectOptionScript, setValueScript, typedScript, typingGuardScript } from './page-scripts'
import { checkUploadable, holdMs, pacing, runPageStep, type StepDriver } from './step-runner'

const HOSTS = ['facebook.com']

/** The waits a person's hands take are recorded and not waited for; the randomness is fixed so a path is the same every time. */
const waits: number[] = []
const realSleep = pacing.sleep
const realRandom = pacing.random
beforeEach(() => {
  waits.length = 0
  pacing.sleep = async (ms) => void waits.push(ms)
  pacing.random = () => 0.5
})
afterEach(() => {
  pacing.sleep = realSleep
  pacing.random = realRandom
})

interface Fake {
  driver: StepDriver
  calls: string[]
  /** Answers by script text; a script that is not listed answers { ok: false }. */
  answers: Map<string, unknown>
  /** Answers given once each, in order, before `answers` (a page that changes while it is scrolled). */
  sequences: Map<string, unknown[]>
  url: string
  attachError: Error | null
}

function fake(url = 'https://www.facebook.com/r.php'): Fake {
  const state: Fake = {
    calls: [],
    answers: new Map(),
    sequences: new Map(),
    url,
    attachError: null,
    driver: undefined as unknown as StepDriver
  }
  state.driver = {
    currentUrl: () => state.url,
    read: async <T>(script: string): Promise<T> => {
      const queued = state.sequences.get(script)
      if (queued && queued.length > 0) {
        state.calls.push('read:answered')
        return queued.shift() as T
      }
      state.calls.push(`read:${[...state.answers.keys()].includes(script) ? 'answered' : 'unanswered'}`)
      return (state.answers.has(script) ? state.answers.get(script) : { ok: false }) as T
    },
    pressKey: async (key) => void state.calls.push(`key:${key}`),
    mouseMove: async (x, y) => void state.calls.push(`move:${x},${y}`),
    mouseClick: async (x, y) => void state.calls.push(`mouse:${x},${y}`),
    wheel: async (x, y, dy) => void state.calls.push(`wheel:${x},${y},${dy}`),
    insertText: async (text) => void state.calls.push(`insert:${text}`),
    focus: async () => void state.calls.push('focus'),
    attachFile: async (_expression, paths, what) => {
      state.calls.push(`attach:${what}:${paths.join('|')}`)
      if (state.attachError) throw state.attachError
    }
  }
  return state
}

const run = (f: Fake, step: PageStep) => runPageStep(f.driver, step, HOSTS)
const on = (f: Fake, script: string, answer: unknown): void => void f.answers.set(script, answer)
const then = (f: Fake, script: string, ...answers: unknown[]): void => void f.sequences.set(script, answers)

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
    // The press comes after the pointer has arrived on the point, and only once.
    const moves = f.calls.filter((c) => c.startsWith('move:'))
    expect(moves).toHaveLength(16)
    expect(moves.at(-1)).toBe('move:40,50')
    expect(f.calls.filter((c) => c.startsWith('mouse'))).toEqual(['mouse:40,50'])
    expect(f.calls.lastIndexOf('move:40,50')).toBeLessThan(f.calls.indexOf('mouse:40,50'))
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

  it('puts several files into one input in one step, each checked first', async () => {
    const f = fake()
    const a = join(dir, 'one.png')
    const b = join(dir, 'two.png')
    await writeFile(a, 'x')
    await writeFile(b, 'y')
    await run(f, { do: 'upload', ref: 'e3', path: a, also: [b] })
    expect(f.calls.filter((c) => c.startsWith('attach:'))).toEqual([`attach:e3:${a}|${b}`])
    // one that cannot be uploaded stops the whole step, and nothing is put in
    const g = fake()
    const result = await run(g, { do: 'upload', ref: 'e3', path: a, also: [join(dir, 'missing.png')] })
    expect(result.status).toBe('refused')
    expect(g.calls.filter((c) => c.startsWith('attach:'))).toEqual([])
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

describe('a click is made the way a person makes it', () => {
  const clickable = (f: Fake): void => {
    on(f, locateScript('e1'), { ok: true, x: 300, y: 200, hit: true, inView: true, vw: 1000, vh: 700 })
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
  }

  it('moves the pointer to the control in small steps first, and the visible cursor follows each one', async () => {
    const f = fake()
    clickable(f)
    on(f, cursorAtScript(), { ok: true, x: 20, y: 30, vw: 1000, vh: 700 })
    await run(f, { do: 'click', ref: 'e1' })
    const moves = f.calls.filter((c) => c.startsWith('move:')).map((c) => c.slice(5).split(',').map(Number) as [number, number])
    expect(moves).toHaveLength(16)
    expect(moves[0]![0]).toBeGreaterThan(20)
    expect(moves.at(-1)).toEqual([300, 200])
    // never a jump: each step is a small part of the way
    const hops = moves.slice(1).map(([x, y], i) => Math.hypot(x - moves[i]![0], y - moves[i]![1]))
    expect(Math.max(...hops)).toBeLessThan(0.3 * Math.hypot(300 - 20, 200 - 30))
  })

  it('rests on the control before it presses, and holds the button for a moment', async () => {
    const f = fake()
    clickable(f)
    await run(f, { do: 'click', ref: 'e1' })
    expect(waits.some((ms) => ms >= 180 && ms <= 420)).toBe(true)
    expect(holdMs()).toBeGreaterThanOrEqual(55)
    expect(holdMs()).toBeLessThanOrEqual(120)
  })

  it('shows the owner the press: the cursor goes down before the click and up after it', async () => {
    const f = fake()
    const seen: string[] = []
    const read = f.driver.read
    f.driver.read = (async <T,>(script: string): Promise<T> => {
      if (script === cursorScript(300, 200, 'down')) seen.push('down')
      if (script === cursorScript(300, 200, 'up')) seen.push('up')
      return read(script)
    }) as StepDriver['read']
    const press = f.driver.mouseClick
    f.driver.mouseClick = async (x, y) => {
      seen.push('press')
      await press(x, y)
    }
    clickable(f)
    await run(f, { do: 'click', ref: 'e1' })
    expect(seen).toEqual(['down', 'press', 'up'])
  })
})

describe('an element that is off the screen is scrolled to with the wheel, as a person does', () => {
  const off = { ok: true, x: 300, y: 1500, hit: false, inView: false, vw: 1000, vh: 700 }
  const near = { ok: true, x: 300, y: 600, hit: false, inView: false, vw: 1000, vh: 700 }
  const seen = { ok: true, x: 300, y: 350, hit: true, inView: true, vw: 1000, vh: 700 }

  it('turns the wheel down toward an element below, a notch at a time, until it is on the screen, and then clicks it', async () => {
    const f = fake()
    then(f, locateScript('e1'), off, near, seen, seen) // the last is the look after the pointer arrived
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.detail).toBe('Clicked e1 with a mouse click.')
    const wheels = f.calls.filter((c) => c.startsWith('wheel:')).map((c) => Number(c.split(',')[2]))
    expect(wheels.length).toBeGreaterThan(5)
    expect(wheels.every((dy) => dy > 0 && dy <= 100)).toBe(true) // down, in notches of a mouse wheel
    expect(wheels.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0.8 * 700 + 100 + 0.8 * 700) // never more than a screen at a time
    expect(f.calls.indexOf('mouse:300,350')).toBeGreaterThan(f.calls.lastIndexOf(f.calls.filter((c) => c.startsWith('wheel:')).at(-1)!))
    expect(f.calls.some((c) => c.startsWith('read:') && false)).toBe(false)
  })

  it('turns it up toward an element above', async () => {
    const f = fake()
    then(f, locateScript('e1'), { ...off, y: -900 }, seen, seen)
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    await run(f, { do: 'click', ref: 'e1' })
    const wheels = f.calls.filter((c) => c.startsWith('wheel:')).map((c) => Number(c.split(',')[2]))
    expect(wheels.length).toBeGreaterThan(0)
    expect(wheels.every((dy) => dy < 0)).toBe(true)
  })

  it('uses the browser\'s own scroll-to only when the wheel moved nothing (a box the pointer is not over), and says nothing false about it', async () => {
    const f = fake()
    then(f, locateScript('e1'), off, off, seen, seen)
    on(f, scrollIntoViewScript('e1'), { ok: true })
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('done')
    expect(f.calls.some((c) => c.startsWith('wheel:'))).toBe(true)
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual(['mouse:300,350'])
  })

  it('does not click an element that was on the screen with a scroll it did not need', async () => {
    const f = fake()
    on(f, locateScript('e1'), seen)
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    await run(f, { do: 'click', ref: 'e1' })
    expect(f.calls.some((c) => c.startsWith('wheel:'))).toBe(false)
  })

  it('stops after a limited number of turns for an element that never comes onto the screen, and does not press anything by a guess', async () => {
    const f = fake()
    on(f, locateScript('e1'), off)
    on(f, scrollIntoViewScript('e1'), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('refused')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })
})

describe('a press goes to what the page holds when the pointer has arrived, not to what it held a moment before', () => {
  const at = (x: number, y: number) => ({ ok: true, x, y, hit: true, inView: true, vw: 1000, vh: 700 })

  it('looks at the element again after the glide and the rest, and presses at the point it holds NOW', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    // a dialog moved the element while the pointer was on its way
    then(f, locateScript('e1'), at(300, 350), at(300, 420), at(300, 420))
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('done')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual(['mouse:300,420']) // never at the old point
    expect(f.calls.filter((c) => c.startsWith('move:')).at(-1)).toBe('move:300,420') // the pointer was aimed again
  })

  it('presses nothing for an element that keeps moving: a press at a point it has left would land on whatever the page put there', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    on(f, scriptClickScript('e1'), { ok: true }) // a script click would be a press too: if it were made, the answer would be "done"
    then(f, locateScript('e1'), at(300, 350), at(300, 420), at(300, 500), at(300, 580), at(300, 660))
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('not_found')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })

  it('says the element is gone, and presses nothing, when it left the page while the pointer was on its way', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    then(f, locateScript('e1'), at(300, 350), { ok: false })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('not_found')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })

  it('stops the moment the owner takes the browser over: no more moves, no press', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    on(f, locateScript('e1'), at(300, 350))
    let moves = 0
    const driver = { ...f.driver, mouseMove: async (x: number, y: number) => { moves += 1; f.calls.push(`move:${x},${y}`) } }
    const alive = (): void => {
      if (moves >= 4) throw new Error('taken over')
    }
    await expect(runPageStep(driver, { do: 'click', ref: 'e1' }, HOSTS, alive)).rejects.toThrow('taken over')
    expect(moves).toBe(4)
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })

  it('presses nothing, by a mouse or by a script, for an element that left the page while the pointer was on its way', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    on(f, scriptClickScript('e1'), { ok: true }) // would be "done" if a script were clicked
    then(f, locateScript('e1'), at(300, 350), { ok: false })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('not_found')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })

  it('is stopped by the owner\'s takeover after the last look and before the press: the check comes right before the button goes down', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    let looks = 0
    const driver: StepDriver = { ...f.driver, read: async <T>(script: string): Promise<T> => {
      if (script === locateScript('e1')) looks += 1
      return f.driver.read<T>(script)
    } }
    on(f, locateScript('e1'), at(300, 350))
    // the owner takes over once the element has been looked at again (the second look): nothing after that may press
    const alive = (): void => {
      if (looks >= 2) throw new Error('taken over')
    }
    await expect(runPageStep(driver, { do: 'click', ref: 'e1' }, HOSTS, alive)).rejects.toThrow('taken over')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })

  it('is stopped by the owner\'s takeover between two turns of the wheel', async () => {
    const f = fake()
    on(f, scrollStateScript(400, 300), { ok: true, top: 0, max: 2000, vw: 1000, vh: 700 })
    on(f, scrollStateScript(500, 350), { ok: true, top: 0, max: 2000, vw: 1000, vh: 700 })
    let turns = 0
    const driver: StepDriver = { ...f.driver, wheel: async (x, y, dy) => { turns += 1; f.calls.push(`wheel:${x},${y},${dy}`) } }
    const alive = (): void => {
      if (turns >= 2) throw new Error('taken over')
    }
    await expect(runPageStep(driver, { do: 'scroll', direction: 'down', amount: 'screen' }, HOSTS, alive)).rejects.toThrow('taken over')
    expect(turns).toBe(2)
  })

  it('does not trust the size of the window a page reports: a huge one is a few thousand pixels, not minutes of wheel turns', async () => {
    const f = fake()
    on(f, scrollStateScript(400, 300), { ok: true, top: 0, max: 2000, vw: 1e9, vh: 1e9 })
    on(f, scrollStateScript(2000, 2000), { ok: true, top: 0, max: 2000, vw: 1e9, vh: 1e9 })
    const result = await run(f, { do: 'scroll', direction: 'down', amount: 'screen' })
    expect(result.status).toBe('done')
    const wheels = f.calls.filter((c) => c.startsWith('wheel:')).map((c) => Number(c.split(',')[2]))
    expect(wheels.length).toBeLessThanOrEqual(32) // 0.8 of at most 4000 px, a notch of 100
    expect(wheels.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3200)
  })

  it('tries the browser\'s own scroll-to before a script when the element is in the window but something sits on it', async () => {
    const f = fake()
    const covered = { ok: true, x: 300, y: 350, hit: false, inView: true, vw: 1000, vh: 700 }
    on(f, mouseWatchScript(), { ok: true })
    on(f, mouseSeenScript(), { ok: true })
    on(f, scrollIntoViewScript('e1'), { ok: true })
    then(f, locateScript('e1'), covered, at(300, 350), at(300, 350))
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.detail).toBe('Clicked e1 with a mouse click.')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual(['mouse:300,350'])
  })

  it('does not glide or rest again when the pointer already rests on the element: a hover, then the press, with no wait between', async () => {
    const f = fake()
    on(f, mouseSeenScript(), { ok: true })
    on(f, locateScript('e1'), at(300, 350))
    on(f, cursorAtScript(), { ok: true, x: 301, y: 349, vw: 1000, vh: 700 })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result.status).toBe('done')
    expect(f.calls.filter((c) => c.startsWith('move:'))).toEqual([])
    expect(waits).not.toContain(300) // no rest (180 to 420 ms, 300 with the fixed randomness): it already rested
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual(['mouse:300,350'])
  })
})

/**
 * A page that watches the way the real one does: `mouseWatchScript` arms the listener and zeroes the count, a press that arrives while it is armed
 * is counted, and `mouseSeenScript` reads the count. A press the page drops (a tab that is not drawn) is not counted.
 */
function watchingPage(f: Fake, options: { drops?: (press: number) => boolean } = {}) {
  const page = { armed: false, count: 0, presses: 0, scripted: 0, arms: 0 }
  const read = f.driver.read
  f.driver = {
    ...f.driver,
    read: async <T>(script: string): Promise<T> => {
      if (script === mouseWatchScript()) {
        page.armed = true
        page.count = 0
        page.arms += 1
        return { ok: true } as T
      }
      if (script === mouseSeenScript()) return { ok: page.count > 0 } as T
      if (script === scriptClickScript('e1')) page.scripted += 1
      return read<T>(script)
    },
    mouseClick: async (x, y) => {
      f.calls.push(`mouse:${x},${y}`)
      page.presses += 1
      if (page.armed && !options.drops?.(page.presses)) page.count += 1
    }
  }
  return page
}

describe('a press is looked at, not assumed', () => {
  const at = { ok: true, x: 300, y: 350, hit: true, inView: true, vw: 1000, vh: 700 }

  it('is read from a watch armed for THIS press, also when the pointer already rests on the element: one press, no second one by script', async () => {
    const f = fake()
    const page = watchingPage(f)
    on(f, locateScript('e1'), at)
    on(f, cursorAtScript(), { ok: true, x: 300, y: 350, vw: 1000, vh: 700 })
    on(f, scriptClickScript('e1'), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1' })
    expect(result).toEqual({ status: 'done', detail: 'Clicked e1 with a mouse click.' })
    expect(page.presses).toBe(1)
    expect(page.scripted).toBe(0)
    expect(page.arms).toBe(1)
  })

  it('does not take the count of an earlier press for this one: a second press that the page drops is seen as dropped, and goes to the page\'s own event', async () => {
    const f = fake()
    const page = watchingPage(f, { drops: (press) => press === 2 })
    on(f, locateScript('e1'), at)
    on(f, cursorAtScript(), { ok: true, x: 300, y: 350, vw: 1000, vh: 700 })
    on(f, scriptClickScript('e1'), { ok: true })
    expect((await run(f, { do: 'click', ref: 'e1' })).detail).toBe('Clicked e1 with a mouse click.')
    const second = await run(f, { do: 'click', ref: 'e1' })
    expect(second.detail).toMatch(/^Clicked e1 by script/)
    expect(page.scripted).toBe(1)
  })

  it('checks that the owner still has not taken the browser before the page\'s own event, as before a real press', async () => {
    const f = fake()
    watchingPage(f, { drops: () => true })
    on(f, locateScript('e1'), at)
    on(f, cursorAtScript(), { ok: true, x: 300, y: 350, vw: 1000, vh: 700 })
    on(f, scriptClickScript('e1'), { ok: true })
    let checks = 0
    const alive = (): void => {
      checks += 1
      // the checks before the press are 1 (before the look at the pointer) and 2 (before the press); the third is the one before the script
      if (checks >= 3) throw new Error('taken over')
    }
    const page = watchingPage(f, { drops: () => true })
    await expect(runPageStep(f.driver, { do: 'click', ref: 'e1' }, HOSTS, alive)).rejects.toThrow('taken over')
    expect(page.scripted).toBe(0)
  })

  it('says that nothing was pressed (not_found) when the element left the page or kept moving: a caller may try again', async () => {
    const gone = fake()
    watchingPage(gone)
    on(gone, locateScript('e1'), at)
    then(gone, locateScript('e1'), at, { ok: false })
    on(gone, scriptClickScript('e1'), { ok: true })
    const left = await run(gone, { do: 'click', ref: 'e1' })
    expect(left.status).toBe('not_found')
    expect(left.detail).toMatch(/Nothing was pressed/)
    expect(gone.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])

    const moving = fake()
    watchingPage(moving)
    on(moving, locateScript('e1'), at)
    then(moving, locateScript('e1'), at, { ...at, y: 380 }, { ...at, y: 420 }, { ...at, y: 470 }, { ...at, y: 520 })
    on(moving, scriptClickScript('e1'), { ok: true })
    const kept = await run(moving, { do: 'click', ref: 'e1' })
    expect(kept.status).toBe('not_found')
    expect(kept.detail).toMatch(/Nothing was pressed/)
    expect(moving.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })

  it('says "refused" (it does not say that nothing happened) for a press that was made and not seen while the page\'s own event does not take either', async () => {
    const f = fake()
    watchingPage(f, { drops: () => true })
    on(f, locateScript('e1'), at)
    on(f, cursorAtScript(), { ok: true, x: 300, y: 350, vw: 1000, vh: 700 })
    expect((await run(f, { do: 'click', ref: 'e1' })).status).toBe('refused')
  })
})

describe('a press that only follows a hover (still)', () => {
  const at = { ok: true, x: 300, y: 350, hit: true, inView: true, vw: 1000, vh: 700 }

  it('presses where the pointer rests, with no scroll, glide or wait', async () => {
    const f = fake()
    const page = watchingPage(f)
    on(f, locateScript('e1'), at)
    on(f, cursorAtScript(), { ok: true, x: 301, y: 351, vw: 1000, vh: 700 })
    const result = await run(f, { do: 'click', ref: 'e1', still: true })
    expect(result.status).toBe('done')
    expect(page.presses).toBe(1)
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual(['mouse:300,350'])
    expect(f.calls.filter((c) => c.startsWith('move:') || c.startsWith('wheel:'))).toEqual([])
    expect(waits).toEqual([350]) // only the settling after the press: no rest, no glide
  })

  it('does not press an element that is not under the pointer any more: nothing moves, nothing is pressed, and it says so (not_found)', async () => {
    const f = fake()
    const page = watchingPage(f)
    on(f, locateScript('e1'), at)
    on(f, cursorAtScript(), { ok: true, x: 300, y: 420, vw: 1000, vh: 700 })
    on(f, scriptClickScript('e1'), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1', still: true })
    expect(result.status).toBe('not_found')
    expect(result.detail).toMatch(/not under the pointer/)
    expect(page.presses).toBe(0)
    expect(page.scripted).toBe(0)
    expect(f.calls.filter((c) => c.startsWith('move:') || c.startsWith('wheel:'))).toEqual([])
  })

  it('does not press an element that is off the screen either: it does not scroll to it', async () => {
    const f = fake()
    const page = watchingPage(f)
    on(f, locateScript('e1'), { ...at, inView: false, hit: false })
    on(f, cursorAtScript(), { ok: true, x: 300, y: 350, vw: 1000, vh: 700 })
    on(f, scriptClickScript('e1'), { ok: true })
    const result = await run(f, { do: 'click', ref: 'e1', still: true })
    expect(page.presses).toBe(0)
    expect(f.calls.filter((c) => c.startsWith('wheel:'))).toEqual([])
    expect(result.detail).not.toMatch(/with a mouse click/)
  })
})

describe('a hover', () => {
  const at = { ok: true, x: 300, y: 350, hit: true, inView: true, vw: 1000, vh: 700 }

  it('says "not_found" when the element kept moving, with nothing pressed, so the caller can refuse before anything is committed', async () => {
    const f = fake()
    on(f, locateScript('e1'), at)
    then(f, locateScript('e1'), at, { ...at, y: 380 }, { ...at, y: 420 }, { ...at, y: 470 }, { ...at, y: 520 })
    const result = await run(f, { do: 'hover', ref: 'e1' })
    expect(result.status).toBe('not_found')
    expect(result.detail).toMatch(/kept moving/)
  })

  it('glides to the element and rests on it, and presses nothing', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    on(f, locateScript('e1'), at)
    const result = await run(f, { do: 'hover', ref: 'e1' })
    expect(result).toEqual({ status: 'done', detail: 'The pointer rests on e1.' })
    expect(f.calls.filter((c) => c.startsWith('move:')).at(-1)).toBe('move:300,350')
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
    expect(waits.some((ms) => ms >= 180)).toBe(true) // the rest
  })

  it('says "not found" when the element is gone by the time the pointer has arrived', async () => {
    const f = fake()
    on(f, mouseWatchScript(), { ok: true })
    then(f, locateScript('e1'), at, { ok: false })
    expect((await run(f, { do: 'hover', ref: 'e1' })).status).toBe('not_found')
  })

  it('is held to the platform and says "not found" for an element that is not on the page, before any input', async () => {
    const away = fake('https://evil.example/')
    expect((await run(away, { do: 'hover', ref: 'e1' })).status).toBe('wrong_host')
    expect(away.calls).toEqual([])
    const missing = fake()
    expect((await run(missing, { do: 'hover', ref: 'e1' })).status).toBe('not_found')
    expect(missing.calls.some((c) => c.startsWith('move:'))).toBe(false)
  })

  it('says when something covers the element, and does not scroll or press on a guess', async () => {
    const f = fake()
    on(f, locateScript('e1'), { ...at, hit: false })
    on(f, scrollIntoViewScript('e1'), { ok: true })
    const result = await run(f, { do: 'hover', ref: 'e1' })
    expect(result.status).toBe('done')
    expect(result.detail).toMatch(/something covers it/)
    expect(f.calls.filter((c) => c.startsWith('mouse:'))).toEqual([])
  })
})

describe('a scroll', () => {
  const at = (top: number, max = 2000, inner = false) => ({ ok: true, top, max, inner, vw: 1000, vh: 700 })

  it('is refused on a page that is not the platform, before any input', async () => {
    const f = fake('https://evil.example/')
    const result = await run(f, { do: 'scroll', direction: 'down', amount: 'screen' })
    expect(result.status).toBe('wrong_host')
    expect(f.calls).toEqual([])
  })

  it('turns the wheel down over the middle of the page by most of a screen, and says where the page is', async () => {
    const f = fake()
    on(f, scrollStateScript(400, 300), at(0))
    then(f, scrollStateScript(500, 350), at(0), at(560))
    const result = await run(f, { do: 'scroll', direction: 'down', amount: 'screen' })
    expect(result.status).toBe('done')
    expect(result.detail).toBe('It is now 28% of the way down. There is more below.')
    const wheels = f.calls.filter((c) => c.startsWith('wheel:'))
    expect(wheels.every((c) => c.startsWith('wheel:500,350,'))).toBe(true)
    expect(wheels.map((c) => Number(c.split(',')[2])).reduce((a, b) => a + b, 0)).toBe(560)
  })

  it('half a screen is half of that, and up turns the other way', async () => {
    const f = fake()
    on(f, scrollStateScript(400, 300), at(0))
    then(f, scrollStateScript(500, 350), at(800), at(660))
    const result = await run(f, { do: 'scroll', direction: 'up', amount: 'half' })
    const turns = f.calls.filter((c) => c.startsWith('wheel:')).map((c) => Number(c.split(',')[2]))
    expect(turns.every((dy) => dy < 0)).toBe(true)
    expect(turns.reduce((a, b) => a + b, 0)).toBe(-280)
    expect(result.detail).toBe('It is now 33% of the way down. There is more above.')
  })

  it('says when the page did not move because it is already at the end', async () => {
    const f = fake()
    on(f, scrollStateScript(400, 300), at(1300))
    on(f, scrollStateScript(500, 350), at(1300))
    const result = await run(f, { do: 'scroll', direction: 'down', amount: 'screen' })
    expect(result.status).toBe('done')
    expect(result.detail).toMatch(/did not move: it is already at the bottom/)
  })

  it('says when it is the box under the pointer that moved, not the whole page', async () => {
    const f = fake()
    on(f, scrollStateScript(400, 300), at(0))
    then(f, scrollStateScript(500, 350), at(0, 600, true), at(300, 600, true))
    const result = await run(f, { do: 'scroll', direction: 'down', amount: 'screen' })
    expect(result.detail).toMatch(/the box under the pointer, not the whole page/)
  })
})
