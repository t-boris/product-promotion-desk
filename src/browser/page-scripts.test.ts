import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { clickScript, describeFailure, existsScript, fileInputScript, fillScript, signInScript } from './page-scripts'

// A tiny DOM: enough to run the injected scripts and observe what they do.
class FakeEvent {
  constructor(
    readonly type: string,
    readonly init: Record<string, unknown> = {}
  ) {}
}
class FakeInputEvent extends FakeEvent {}
class FakeMouseEvent extends FakeEvent {}

class FakeInput {
  tagName = 'INPUT'
  disabled = false
  readOnly = false
  type = 'text'
  isContentEditable = false
  focused = false
  events: string[] = []
  nativeSetterCalls = 0
  private stored = ''
  rejectValue = false
  scrollIntoView(): void {}
  focus(): void {
    this.focused = true
  }
  dispatchEvent(e: FakeEvent): void {
    this.events.push(e.type)
  }
  getAttribute(): string | null {
    return null
  }
  click(): void {
    this.events.push('click')
  }
  get value(): string {
    return this.stored
  }
  /** Not assignable directly in the script: only through the prototype setter. */
  setNative(v: string): void {
    this.nativeSetterCalls += 1
    if (!this.rejectValue) this.stored = v
  }
}
// The script reads the setter from HTMLInputElement.prototype / HTMLTextAreaElement.prototype.
class HTMLInputElement {}
class HTMLTextAreaElement {}
for (const proto of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype]) {
  Object.defineProperty(proto, 'value', {
    set(this: FakeInput, v: string) {
      this.setNative(v)
    },
    get(this: FakeInput) {
      return this.value
    }
  })
}

interface FakeRoot {
  querySelector(selector: string): unknown
  querySelectorAll(selector: string): unknown[]
}

function makeRoot(table: Record<string, unknown>, hosts: { shadowRoot: FakeRoot }[] = []): FakeRoot {
  return {
    querySelector: (selector) => table[selector] ?? null,
    querySelectorAll: () => hosts
  }
}

function run<T>(script: string, document: unknown, extra: Record<string, unknown> = {}): T {
  return runInNewContext(script, {
    document,
    HTMLInputElement,
    HTMLTextAreaElement,
    InputEvent: FakeInputEvent,
    MouseEvent: FakeMouseEvent,
    Event: FakeEvent,
    window: {},
    ...extra
  }) as T
}

describe('fillScript', () => {
  it('focuses, uses the native value setter, then fires input and change', () => {
    const input = new FakeInput()
    const result = run<{ ok: boolean }>(fillScript('textarea[name="text"]', 'Hello "world"\nsecond line'), makeRoot({ 'textarea[name="text"]': input }))
    expect(result).toEqual({ ok: true })
    expect(input.focused).toBe(true)
    expect(input.value).toBe('Hello "world"\nsecond line')
    expect(input.nativeSetterCalls).toBe(1)
    expect(input.events).toEqual(['input', 'change'])
  })

  it('reports a missing element, a disabled element and a rejected value instead of pretending success', () => {
    expect(run(fillScript('#nope', 'x'), makeRoot({}))).toEqual({ ok: false, reason: 'not_found' })
    const disabled = Object.assign(new FakeInput(), { disabled: true })
    expect(run(fillScript('#a', 'x'), makeRoot({ '#a': disabled }))).toEqual({ ok: false, reason: 'disabled' })
    const rejecting = Object.assign(new FakeInput(), { rejectValue: true })
    expect(run(fillScript('#b', 'x'), makeRoot({ '#b': rejecting }))).toEqual({ ok: false, reason: 'value_rejected' })
  })

  it('treats text and selector as data: quotes and code in them cannot break out of the script', () => {
    const hostile = `"); globalThis.pwned = true; ("`
    const input = new FakeInput()
    const sandbox: Record<string, unknown> = {}
    const result = run<{ ok: boolean }>(fillScript(hostile, hostile), makeRoot({ [hostile]: input }), sandbox)
    expect(result.ok).toBe(true)
    expect(input.value).toBe(hostile)
    expect(sandbox.pwned).toBeUndefined()
  })

  it('finds controls inside open shadow roots', () => {
    const input = new FakeInput()
    const shadow = makeRoot({ 'textarea[name="title"]': input })
    const document = makeRoot({}, [{ shadowRoot: shadow }])
    expect(run(fillScript('textarea[name="title"]', 'T'), document)).toEqual({ ok: true })
    expect(input.value).toBe('T')
  })
})

describe('clickScript', () => {
  it('dispatches the pointer sequence and then clicks', () => {
    const button = new FakeInput()
    expect(run(clickScript('button.save'), makeRoot({ 'button.save': button }))).toEqual({ ok: true })
    expect(button.events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  })

  it('does not click a disabled or missing element', () => {
    const button = Object.assign(new FakeInput(), { disabled: true })
    expect(run(clickScript('b'), makeRoot({ b: button }))).toEqual({ ok: false, reason: 'disabled' })
    expect(button.events).toEqual([])
    expect(run(clickScript('c'), makeRoot({}))).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('existence and file input probes', () => {
  it('reports whether a selector matches, through shadow roots as well', () => {
    expect(run(existsScript('#a'), makeRoot({ '#a': {} }))).toBe(true)
    expect(run(existsScript('#a'), makeRoot({}))).toBe(false)
    expect(run(existsScript('#a'), makeRoot({}, [{ shadowRoot: makeRoot({ '#a': {} }) }]))).toBe(true)
  })

  it('returns the element only when it is a file input', () => {
    const file = Object.assign(new FakeInput(), { type: 'file' })
    expect(run(fileInputScript('input[type="file"]'), makeRoot({ 'input[type="file"]': file }))).toBe(file)
    expect(run(fileInputScript('input'), makeRoot({ input: new FakeInput() }))).toBeNull()
  })
})

describe('failure descriptions', () => {
  it('names the action, the selector and the reason', () => {
    expect(describeFailure('fill', '#x', { ok: false, reason: 'not_found' }).message).toBe('Could not fill "#x": the element was not found.')
    expect(describeFailure('click', '#y', null).message).toMatch(/returned no result/)
  })
})

describe('signInScript (DEC-014)', () => {
  const form = { username: 'natal_bot', password: 'S3cret-Pa$$w0rd!', hosts: ['reddit.com'] }

  it('is valid JavaScript for any password, even one made to break out of a string', () => {
    for (const password of ['a"b', "a'b", 'a`${x}`b', 'a\\b', 'a</script><script>alert(1)</script>', 'line\u2028sep', 'p'.repeat(256)]) {
      expect(() => new Function(`return ${signInScript({ ...form, password })}`)).not.toThrow()
    }
  })

  it('checks where it is before it touches any field', () => {
    const script = signInScript(form)
    const guard = script.indexOf("status: 'wrong_host'")
    expect(guard).toBeGreaterThan(-1)
    for (const touch of ['set(user', 'set(pass', '.click()', 'requestSubmit']) expect(script.indexOf(touch)).toBeGreaterThan(guard)
    expect(script).toContain("location.protocol !== 'https:'")
    expect(script).toContain('window.top !== window')
  })

  it('answers with a status only, never with a value', () => {
    const answers = [...signInScript(form).matchAll(/return \{ ([^}]*) \}/g)].map((m) => m[1])
    expect(answers.length).toBeGreaterThan(0)
    for (const answer of answers) expect(answer).toMatch(/^status: /)
  })
})
