import { describe, expect, it } from 'vitest'
import { validProfileDefinition } from './test-helpers'
import { LIMITS } from './profile'
import { validateProfile } from './validate'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const base = (): Record<string, unknown> => clone(validProfileDefinition())

/** Typed editing of a deep JSON draft by dotted path ("publish.post.steps.3.value"). */
interface Editor {
  set(path: string, value: unknown): void
  del(path: string): void
  push(path: string, value: unknown): void
  insert(path: string, index: number, value: unknown): void
}

function editor(root: Record<string, unknown>): Editor {
  const parentOf = (path: string): { parent: Record<string, unknown>; key: string } => {
    const parts = path.split('.')
    const key = parts.pop() as string
    let cursor: unknown = root
    for (const part of parts) cursor = (cursor as Record<string, unknown>)[part]
    return { parent: cursor as Record<string, unknown>, key }
  }
  const list = (path: string): unknown[] => {
    const { parent, key } = parentOf(path)
    return parent[key] as unknown[]
  }
  return {
    set(path, value) {
      const { parent, key } = parentOf(path)
      parent[key] = value
    },
    del(path) {
      const { parent, key } = parentOf(path)
      delete parent[key]
    },
    push: (path, value) => void list(path).push(value),
    insert: (path, index, value) => void list(path).splice(index, 0, value)
  }
}

function withPath(mutate: (edit: Editor) => void): ReturnType<typeof validateProfile> {
  const profile = base()
  mutate(editor(profile))
  return validateProfile(profile)
}

describe('site profile validator: acceptance', () => {
  it('accepts a complete declarative profile and returns it normalized', () => {
    const result = validateProfile(base())
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.profile?.host).toBe('forum.example.com')
    expect(result.profile?.publish?.reply?.steps).toHaveLength(5)
  })

  it('accepts a minimal read-only profile (no publishing, metrics or rules)', () => {
    const result = withPath((e) => {
      for (const key of ['publish', 'metrics', 'ownContent', 'rulesUrl', 'rulesSelector']) e.del(key)
    })
    expect(result.valid).toBe(true)
    expect(result.profile?.publish).toBeUndefined()
  })
})

describe('site profile validator: no code is ever accepted (SRC-001)', () => {
  it('rejects an unknown step type, naming it', () => {
    const result = withPath((e) => e.insert('publish.post.steps', 1, { type: 'eval', code: '1+1' }))
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/unknown step type "eval"/)
    expect(result.profile).toBeNull()
  })

  it.each(['script', 'eval', 'function', 'js', 'javascript', 'onclick', 'handler', 'callback', 'code', 'exec'])('rejects a "%s" field anywhere in the profile', (key) => {
    const result = withPath((e) => e.set(`discussions.${key}`, 'something'))
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(new RegExp(`${key}.*(executable|unknown)`, 'i'))
  })

  it('rejects a script field even at the top level and inside steps', () => {
    expect(withPath((e) => e.set('script', 'alert(1)')).valid).toBe(false)
    expect(withPath((e) => e.set('publish.post.steps.3.script', 'alert(1)')).valid).toBe(false)
  })

  it.each<[string, (e: Editor) => void]>([
    ['javascript: URL', (e) => e.set('publish.post.steps.0', { type: 'goto', url: 'javascript:alert(1)' })],
    ['an arrow function in a selector', (e) => e.set('discussions.itemSelector', 'li.topic[x=() => 1]')],
    ['eval( in a value', (e) => e.set('publish.post.steps.3.value', 'eval(document.cookie)')],
    ['a <script> tag in a value', (e) => e.set('publish.post.steps.3.value', '<script>alert(1)</script>')],
    ['a template literal', (e) => e.set('name', 'x ${process.env.SECRET}')],
    ['document.cookie', (e) => e.set('rulesSelector', 'document.cookie')],
    ['new Function', (e) => e.set('name', 'new Function("x")')],
    ['a data:text/html URL', (e) => e.set('loginUrl', 'data:text/html,<b>x')]
  ])('rejects %s', (_label, mutate) => {
    const result = withPath(mutate)
    expect(result.valid).toBe(false)
  })

  it('rejects values that are not plain JSON data (functions, class instances)', () => {
    const profile = base()
    ;(profile.discussions as Record<string, unknown>).title = { selector: () => 'a.title' }
    const result = validateProfile(profile)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/unsupported value|must be a non-empty string/)
  })

  it('rejects unknown fields instead of ignoring them', () => {
    expect(withPath((e) => e.set('discussions.sneaky', 'x')).errors.join('\n')).toMatch(/sneaky: unknown field/)
    expect(withPath((e) => e.set('publish.reply.steps.1.extra', 'x')).valid).toBe(false)
  })

  it('does not allow attributes that could carry active content', () => {
    expect(withPath((e) => e.set('discussions.title', { selector: 'a', attr: 'onclick' })).valid).toBe(false)
    expect(withPath((e) => e.set('discussions.title', { selector: 'a', attr: 'data-title' })).valid).toBe(true)
  })
})

describe('site profile validator: limits and structure', () => {
  it('enforces the size limit', () => {
    const big = base()
    big.name = 'x'.repeat(LIMITS.maxBytes)
    expect(validateProfile(big).errors[0]).toMatch(/larger than/)
  })

  it('enforces the number of steps', () => {
    const result = withPath((e) => e.set('publish.post.steps', Array.from({ length: LIMITS.maxSteps + 1 }, () => ({ type: 'click', selector: 'button' }))))
    expect(result.errors.join('\n')).toMatch(/more than \d+ steps/)
  })

  it('enforces string, selector and nesting limits', () => {
    expect(withPath((e) => e.set('discussions.itemSelector', 'a'.repeat(LIMITS.maxSelector + 1))).valid).toBe(false)
    expect(withPath((e) => e.set('name', 'n'.repeat(LIMITS.maxName + 1))).valid).toBe(false)
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let i = 0; i < 12; i += 1) cursor = (cursor.next = {}) as Record<string, unknown>
    expect(withPath((e) => e.set('discussions.title', deep)).valid).toBe(false)
  })

  it('requires the layout-change guard: a container selector for both readers', () => {
    expect(withPath((e) => e.del('discussions.containerSelector')).errors.join('\n')).toMatch(/containerSelector: is required/)
    expect(withPath((e) => e.del('comments.containerSelector')).valid).toBe(false)
  })

  it('keeps URLs on the profile host', () => {
    expect(withPath((e) => e.set('channelUrls', ['https://evil.example.org/c/*'])).errors.join('\n')).toMatch(/outside the profile host/)
    expect(withPath((e) => e.set('publish.post.steps.0', { type: 'goto', url: 'https://evil.example.org/' })).valid).toBe(false)
    expect(withPath((e) => e.set('channelUrls', ['https://eu.forum.example.com/c/*'])).valid).toBe(true)
  })

  it('rejects a host that is not a plain lower-case hostname', () => {
    expect(withPath((e) => e.set('host', 'https://forum.example.com/')).valid).toBe(false)
    expect(withPath((e) => e.set('host', 'Forum.Example.com')).valid).toBe(false)
    expect(withPath((e) => e.set('host', 'localhost')).valid).toBe(false)
  })

  it('restricts placeholders: known names only, and only identifier-like ones inside selectors', () => {
    expect(withPath((e) => e.set('publish.post.steps.3.value', '{{password}}')).errors.join('\n')).toMatch(/placeholder \{\{password\}\} is not allowed/)
    expect(withPath((e) => e.set('publish.reply.steps.1.selector', 'div[data-text="{{text}}"]')).valid).toBe(false)
    expect(withPath((e) => e.set('publish.reply.steps.3.value', '{{text')).valid).toBe(false)
  })

  it('requires a publishing flow to end by clicking and to say how success is recognized', () => {
    expect(withPath((e) => e.set('publish.post.steps', [{ type: 'fill', selector: 'a', value: 'b' }])).valid).toBe(false)
    expect(withPath((e) => e.push('publish.post.steps', { type: 'waitFor', selector: 'x' })).errors.join('\n')).toMatch(/end with the click/)
    expect(withPath((e) => e.del('publish.post.verify')).valid).toBe(false)
    expect(withPath((e) => e.set('publish.post.verify', { errorSelector: '.e' })).errors.join('\n')).toMatch(/at least one of urlGlob/)
  })

  it('rejects non-objects and the wrong schema version', () => {
    expect(validateProfile(null).valid).toBe(false)
    expect(validateProfile('profile').valid).toBe(false)
    expect(validateProfile([]).valid).toBe(false)
    expect(withPath((e) => e.set('schema', 2)).errors.join('\n')).toMatch(/schema/)
  })
})
