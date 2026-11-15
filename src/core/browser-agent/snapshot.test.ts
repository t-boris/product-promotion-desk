import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { describeScroll, parseSnapshot, renderElements, snapshotScript, type PageSnapshot } from './snapshot'

// A tiny DOM, enough to run the real script and see what it reports.
interface NodeSpec {
  tag: string
  attrs?: Record<string, string>
  text?: string
  value?: string
  checked?: boolean
  disabled?: boolean
  required?: boolean
  options?: string[]
  rect?: { width: number; height: number }
  /** Where the top of the element is in the window (default: near the top, on the screen). The window is 700 high. */
  top?: number
  style?: Record<string, string>
  placeholder?: string
  label?: string
  src?: string
  editable?: boolean
  /** The `type` property of a button, and whether it sits in a form (a browser answers `submit` for a button without a type). */
  buttonType?: string
  inForm?: boolean
  /** What the element sits in, nearest first. Two elements that name the same `key` sit in the same element. */
  within?: { tag: string; attrs?: Record<string, string>; key?: string; heading?: string }[]
  /** A heading this container holds (what `querySelector('h1,h2,...')` finds in it). */
  heading?: string
}
class FakeNode {
  /** The containers of one page by key, so that two elements can sit in one form. */
  static shared = new Map<string, FakeNode>()
  readonly attributes = new Map<string, string>()
  readonly nodeType = 1
  readonly shadowRoot = null
  parentElement: FakeNode | null = null
  style: Record<string, string>
  constructor(readonly spec: NodeSpec) {
    this.style = spec.style ?? {}
    for (const [k, v] of Object.entries(spec.attrs ?? {})) this.attributes.set(k, v)
    if (spec.src) this.attributes.set('src', spec.src)
    this.parentElement = FakeNode.chain(spec.within ?? [])
  }
  /** The outermost-last chain of containers as one element: the nearest one, whose own parent is the next, and so on. */
  private static chain(within: NonNullable<NodeSpec['within']>): FakeNode | null {
    const [nearest, ...rest] = within
    if (!nearest) return null
    let node = nearest.key ? FakeNode.shared.get(nearest.key) : undefined
    if (!node) {
      node = new FakeNode({ tag: nearest.tag, attrs: nearest.attrs, heading: nearest.heading, within: rest })
      if (nearest.key) FakeNode.shared.set(nearest.key, node)
    }
    return node
  }
  get tagName(): string { return this.spec.tag.toUpperCase() }
  get innerText(): string { return this.spec.text ?? '' }
  get value(): string { return this.spec.value ?? '' }
  get checked(): boolean { return this.spec.checked ?? false }
  get disabled(): boolean { return this.spec.disabled ?? false }
  get required(): boolean { return this.spec.required ?? false }
  get placeholder(): string { return this.spec.placeholder ?? '' }
  get isContentEditable(): boolean { return this.spec.editable ?? false }
  get type(): string { return this.spec.buttonType ?? 'submit' }
  get form(): object | null { return this.spec.inForm ? {} : null }
  get title(): string { return '' }
  get name(): string { return '' }
  get labels(): { innerText: string }[] | null { return this.spec.label ? [{ innerText: this.spec.label }] : null }
  get options(): { textContent: string; value: string }[] { return (this.spec.options ?? []).map((o) => ({ textContent: o, value: o })) }
  get selectedIndex(): number { return 0 }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getBoundingClientRect(): { width: number; height: number; top: number; bottom: number; left: number; right: number } {
    const size = this.spec.rect ?? { width: 200, height: 30 }
    const top = this.spec.top ?? 10
    return { ...size, top, bottom: top + size.height, left: 10, right: 10 + size.width }
  }
  closest(): null { return null }
  /** Only what the script asks: a tag, or [role=x], from a comma-separated list. */
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const role = /^\[role=(\w+)\]$/.exec(part.trim())
      return role ? this.getAttribute('role') === role[1] : part.trim().toLowerCase() === this.spec.tag.toLowerCase()
    })
  }
  querySelector(): { innerText: string } | null { return this.spec.heading ? { innerText: this.spec.heading } : null }
  contains(other: FakeNode): boolean {
    for (let n: FakeNode | null = other; n; n = n.parentElement) if (n === this) return true
    return false
  }
}

function runSnapshot(page: { interactive?: NodeSpec[]; alerts?: NodeSpec[]; frames?: NodeSpec[]; body?: string }): PageSnapshot {
  FakeNode.shared = new Map()
  const interactive = (page.interactive ?? []).map((s) => new FakeNode(s))
  const alerts = (page.alerts ?? []).map((s) => new FakeNode(s))
  const frames = (page.frames ?? []).map((s) => new FakeNode(s))
  const document = {
    title: ' Facebook ',
    body: { innerText: page.body ?? 'Get started on Facebook' },
    getElementById: () => null,
    querySelectorAll: (selector: string) =>
      selector === '*' ? [] : selector.startsWith('a[href]') ? interactive : selector.includes('role=alert') ? alerts : selector === 'iframe' ? frames : selector.includes('role=dialog') ? [...FakeNode.shared.values()].filter((n) => n.getAttribute('role') === 'dialog') : []
  }
  const getComputedStyle = (el: FakeNode) => ({ display: 'block', visibility: 'visible', opacity: '1', ...el.style })
  const raw = runInNewContext(snapshotScript(), { document, getComputedStyle, location: { href: 'https://www.facebook.com/r.php?x=1', host: 'www.facebook.com' }, window: { innerWidth: 1000, innerHeight: 700 }, URL })
  const parsed = parseSnapshot(raw)
  if (!parsed) throw new Error('the script returned nothing usable')
  return parsed
}

describe('snapshotScript: the page as a list of labelled elements', () => {
  it('labels each element, names it from its label, placeholder or text, and never reads a password', () => {
    const s = runSnapshot({
      interactive: [
        { tag: 'input', attrs: { type: 'text' }, placeholder: 'First name', value: 'Natal', required: true },
        { tag: 'input', attrs: { type: 'password' }, label: 'Password', value: 'hunter2' },
        { tag: 'input', attrs: { type: 'checkbox' }, label: 'I agree', checked: true },
        { tag: 'select', label: 'Month', options: ['January', 'February'] },
        { tag: 'button', text: 'Submit', disabled: true },
        { tag: 'a', attrs: { href: '/login/' }, text: 'Log in' }
      ]
    })
    expect(s.title).toBe('Facebook')
    expect(s.elements).toEqual([
      { ref: 'e1', role: 'input:text', name: 'First name', value: 'Natal', required: true },
      { ref: 'e2', role: 'input:password', name: 'Password' },
      { ref: 'e3', role: 'input:checkbox', name: 'I agree', checked: true },
      { ref: 'e4', role: 'select', name: 'Month', value: 'January', options: ['January', 'February'] },
      { ref: 'e5', role: 'button', name: 'Submit', disabled: true },
      { ref: 'e6', role: 'link', name: 'Log in', to: '/login/', href: 'https://www.facebook.com/login/' }
    ])
    expect(JSON.stringify(s)).not.toContain('hunter2')
  })

  it('names a field once when the site repeats its label for screen readers', () => {
    const s = runSnapshot({ interactive: [{ tag: 'input', attrs: { type: 'password' }, label: 'Password Password' }, { tag: 'input', attrs: { type: 'text' }, label: 'Mobile number or email Mobile number or email' }, { tag: 'button', text: 'Go Go Stop' }] })
    expect(s.elements.map((e) => e.name)).toEqual(['Password', 'Mobile number or email', 'Go Go Stop'])
  })

  it('calls an editable element a text box whatever its tag, which is how the application tells a field from any other element', () => {
    const s = runSnapshot({
      interactive: [
        { tag: 'div', attrs: { contenteditable: 'true' }, text: 'typed', editable: true },
        { tag: 'div', attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Comment' }, editable: true },
        { tag: 'div', attrs: { contenteditable: 'true', role: 'combobox', 'aria-label': 'Country' }, editable: true },
        { tag: 'p', text: 'not editable', attrs: { onclick: 'x()' } },
        { tag: 'textarea', placeholder: 'A textarea' },
        { tag: 'button', text: 'Post' }
      ]
    })
    expect(s.elements.map((e) => [e.role, e.name])).toEqual([
      ['textbox', 'typed'],
      ['textbox', 'Comment'],
      ['combobox', 'Country'],
      ['p', 'not editable'],
      ['textarea', 'A textarea'],
      ['button', 'Post']
    ])
  })

  it('marks a control whose press submits its form natively, whatever its name or its role attribute says', () => {
    const s = runSnapshot({
      interactive: [
        { tag: 'button', text: 'Continue', inForm: true },
        { tag: 'button', text: 'Looks harmless', attrs: { role: 'link' }, inForm: true },
        { tag: 'button', text: 'Not in a form', inForm: false },
        { tag: 'button', text: 'Opens a menu', buttonType: 'button', inForm: true },
        { tag: 'input', attrs: { type: 'submit' }, value: 'Go' },
        { tag: 'input', attrs: { type: 'image' } },
        { tag: 'input', attrs: { type: 'button' }, value: 'Plain' },
        { tag: 'a', text: 'A link', attrs: { href: '/x' } }
      ]
    })
    expect(s.elements.map((e) => [e.name, e.submits === true])).toEqual([
      ['Continue', true],
      ['Looks harmless', true],
      ['Not in a form', false],
      ['Opens a menu', false],
      ['Go', true],
      ['', true],
      ['Plain', false],
      ['A link', false]
    ])
  })

  it('says which form an element is in (numbered by the look) and which comment or post the site marks around it', () => {
    const reply = { tag: 'form', key: 'reply' }
    const top = { tag: 'form', key: 'top' }
    const thing = { tag: 'div', attrs: { 'data-fullname': 'T1_DEF' }, key: 'def' }
    const s = runSnapshot({
      interactive: [
        { tag: 'textarea', placeholder: 'Reply box', within: [reply, thing] },
        { tag: 'button', text: 'Reply', inForm: true, within: [reply, thing] },
        { tag: 'textarea', placeholder: 'Thread box', within: [top] },
        { tag: 'button', text: 'Save', inForm: true, within: [top] },
        { tag: 'a', text: 'a link', attrs: { href: '/x' }, within: [{ tag: 'div', attrs: { role: 'form' }, key: 'aria' }] },
        { tag: 'a', text: 'a link in a nested thing', attrs: { href: '/y' }, within: [{ tag: 'p' }, { tag: 'div', attrs: { 'data-fullname': 't1_inner' } }, thing] },
        { tag: 'a', text: 'junk', attrs: { href: '/z' }, within: [{ tag: 'div', attrs: { 'data-fullname': 'x"; drop' } }] },
        { tag: 'a', text: 'bare', attrs: { href: '/w' } }
      ]
    })
    expect(s.elements.map((e) => [e.name, e.form, e.parent])).toEqual([
      ['Reply box', 1, 't1_def'],
      ['Reply', 1, 't1_def'],
      ['Thread box', 2, undefined],
      ['Save', 2, undefined],
      ['a link', 3, undefined],
      ['a link in a nested thing', undefined, 't1_inner'],
      ['junk', undefined, undefined],
      ['bare', undefined, undefined]
    ])
  })

  it('keeps the field role of an input that the site calls a combobox, and shows what a drop-down holds', () => {
    const s = runSnapshot({
      interactive: [
        { tag: 'input', attrs: { type: 'text', role: 'combobox' }, placeholder: 'Country' },
        { tag: 'div', attrs: { role: 'combobox', 'aria-label': 'Select Month' }, text: 'Select Month\nMarch' }
      ]
    })
    expect(s.elements).toEqual([
      { ref: 'e1', role: 'input:text', name: 'Country' },
      { ref: 'e2', role: 'combobox', name: 'Select Month', value: 'March' }
    ])
  })

  it('leaves out what a person cannot see and hidden inputs', () => {
    const s = runSnapshot({
      interactive: [
        { tag: 'input', attrs: { type: 'hidden' } },
        { tag: 'button', text: 'Gone', style: { display: 'none' } },
        { tag: 'button', text: 'Tiny', rect: { width: 0, height: 0 } },
        { tag: 'button', text: 'Next' }
      ]
    })
    expect(s.elements.map((e) => e.name)).toEqual(['Next'])
  })

  it('lists a file input even when the site hides it behind a button, because a file goes into the input itself', () => {
    const s = runSnapshot({
      interactive: [
        { tag: 'input', attrs: { type: 'file' }, label: 'Profile photo', style: { display: 'none' }, rect: { width: 0, height: 0 } },
        { tag: 'button', text: 'Change photo' },
        { tag: 'button', text: 'Gone', style: { display: 'none' } }
      ]
    })
    expect(s.elements.map((e) => [e.role, e.name])).toEqual([
      ['input:file', 'Profile photo'],
      ['button', 'Change photo']
    ])
  })

  it('reports the messages of the site and a visible human check, and ignores a hidden frame', () => {
    const s = runSnapshot({
      interactive: [{ tag: 'button', text: 'Submit' }],
      alerts: [{ tag: 'div', text: 'That e-mail   is taken' }],
      frames: [
        { tag: 'iframe', src: 'https://www.google.com/recaptcha/api2/bframe', rect: { width: 400, height: 500 } },
        { tag: 'iframe', src: 'https://www.google.com/recaptcha/api2/anchor', rect: { width: 0, height: 0 } }
      ]
    })
    expect(s.alerts).toEqual(['That e-mail is taken'])
    expect(s.humanCheck).toBe('a visible check frame (www.google.com)')
    expect(runSnapshot({ interactive: [{ tag: 'button', text: 'Submit' }], frames: [{ tag: 'iframe', src: 'https://www.google.com/recaptcha/api2/anchor', rect: { width: 0, height: 0 } }] }).humanCheck).toBe('')
  })
})

describe('parseSnapshot and its lines', () => {
  it('drops elements with a label that is not a label and clamps what a site can write', () => {
    const s = parseSnapshot({ url: 'https://a.test/', title: 't', text: 'x'.repeat(9000), alerts: ['  ', 'ok'], humanCheck: '', elements: [{ ref: 'e1', role: 'button', name: 'n'.repeat(500) }, { ref: 'javascript:alert(1)', role: 'button', name: 'bad' }, { ref: 'e2', role: 'input:password', name: 'P', value: 'leak' }, 7] })
    expect(s?.elements.map((e) => e.ref)).toEqual(['e1', 'e2'])
    expect(s?.elements[0].name).toHaveLength(80)
    expect(s?.elements[1].value).toBeUndefined()
    expect(s?.text).toHaveLength(2500)
    expect(s?.alerts).toEqual(['ok'])
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ elements: 'x' })).toBeNull()
    const marked = parseSnapshot({ url: 'u', title: 't', text: '', alerts: [], humanCheck: '', elements: [{ ref: 'e1', role: 'button', name: 'a', submits: true }, { ref: 'e2', role: 'button', name: 'b', submits: 'yes' }] })
    expect(marked?.elements.map((e) => e.submits)).toEqual([true, undefined])
    const placed = parseSnapshot({ url: 'u', title: 't', text: '', alerts: [], humanCheck: '', elements: [{ ref: 'e1', role: 'a', name: 'a', form: 3, parent: 't1_abc' }, { ref: 'e2', role: 'a', name: 'b', form: 0, parent: 'javascript:alert(1)' }, { ref: 'e3', role: 'a', name: 'c', form: 1.5, parent: 7 }, { ref: 'e4', role: 'a', name: 'd', form: 5000, parent: 'T1_ABC' }] })
    expect(placed?.elements.map((e) => [e.form, e.parent])).toEqual([[3, 't1_abc'], [undefined, undefined], [undefined, undefined], [undefined, undefined]])
  })

  it('lists the elements one per line the way MarkView does', () => {
    const s = runSnapshot({ interactive: [{ tag: 'input', attrs: { type: 'text' }, placeholder: 'First name', value: 'Natal', required: true }, { tag: 'select', label: 'Month', options: ['January', 'February'] }] })
    expect(renderElements(s)).toBe('[e1] input:text "First name" value="Natal" (required)\n[e2] select "Month" value="January" options: January | February')
  })

  it('keeps the whole address of a link (any scheme, left to the reader) and lists it whole only when asked (DEC-042)', () => {
    const s = runSnapshot({ interactive: [{ tag: 'a', attrs: { href: '/p/Cx123/?utm=1' }, text: 'A post' }, { tag: 'a', attrs: { href: 'https://other.example/x' }, text: 'Away' }, { tag: 'a', attrs: { href: `/${'a'.repeat(600)}` }, text: 'Too long' }] })
    expect(s.elements.map((e) => e.href)).toEqual(['https://www.facebook.com/p/Cx123/?utm=1', 'https://other.example/x', undefined])
    expect(renderElements(s).split('\n')[0]).toBe('[e1] link "A post" -> /p/Cx123/')
    expect(renderElements(s, true).split('\n')[0]).toBe('[e1] link "A post" -> https://www.facebook.com/p/Cx123/?utm=1')
    expect(renderElements(s, true).split('\n')[2]).toMatch(/^\[e3\] link "Too long" -> \/a+/)
    const parsed = parseSnapshot({ url: 'u', title: 't', text: '', alerts: [], humanCheck: '', elements: [{ ref: 'e1', role: 'link', name: 'a', href: 7 }, { ref: 'e2', role: 'link', name: 'b', href: 'x'.repeat(501) }] })
    expect(parsed?.elements.map((e) => e.href)).toEqual([undefined, undefined])
  })

})

describe('what is on the screen comes first (a person sees the screen, not the page)', () => {
  const link = (n: number, top: number): NodeSpec => ({ tag: 'a', attrs: { href: `/p/${n}` }, text: `Post ${n}`, top })

  it('lists a control on the screen before the ones off it, even when the page builds it last (a dialog)', () => {
    const below = Array.from({ length: 20 }, (_, i) => ({ tag: 'button', text: `Below ${i}`, top: 900 + i * 40 }) as NodeSpec)
    const s = runSnapshot({ interactive: [...below, { tag: 'button', text: 'Next', top: 300 }] })
    expect(s.elements[0]?.name).toBe('Next')
    expect(s.elements[0]?.offscreen).toBeUndefined()
    expect(s.elements.slice(1).every((e) => e.offscreen === true)).toBe(true)
  })

  it('is not cut off by the limit: a control on the screen is listed after more than the limit of controls below it', () => {
    const lots = Array.from({ length: 200 }, (_, i) => ({ tag: 'button', text: `Far ${i}`, top: 2000 + i * 40 }) as NodeSpec)
    const s = runSnapshot({ interactive: [...lots, { tag: 'button', text: 'Share', top: 120 }] })
    expect(s.elements.length).toBeLessThanOrEqual(160)
    expect(s.elements.some((e) => e.name === 'Share' && !e.offscreen)).toBe(true)
  })

  it('marks what is off the screen in the line the AI reads, and only that', () => {
    const s = runSnapshot({ interactive: [link(1, 100), link(2, 1200), link(3, -400)] })
    const lines = renderElements(s).split('\n')
    expect(lines[0]).not.toContain('off screen')
    expect(lines[1]).toContain('(off screen)')
    expect(lines[2]).toContain('(off screen)')
  })

  it('lists a file input of the page before the limit cuts the list, wherever it is: a site hides it with no size and no place on the screen', () => {
    const crowd = Array.from({ length: 200 }, (_, i) => ({ tag: 'button', text: `Visible ${i}`, top: 10 + i }) as NodeSpec)
    const s = runSnapshot({ interactive: [...crowd, { tag: 'input', attrs: { type: 'file', 'aria-label': 'Select pictures' }, rect: { width: 0, height: 0 }, top: 5000 }] })
    expect(s.elements.length).toBeLessThanOrEqual(160)
    expect(s.elements.some((e) => e.role === 'input:file' && e.name === 'Select pictures')).toBe(true)
  })

  it('lists what is in an open dialog before what is behind it, so a crowded page does not cut off the dialog the AI works in', () => {
    const behind = Array.from({ length: 200 }, (_, i) => ({ tag: 'button', text: `Behind ${i}`, top: 10 + i }) as NodeSpec)
    const inside: NodeSpec[] = ['Next', 'Share'].map((text, i) => ({ tag: 'button', text, top: 300 + i * 40, within: [{ tag: 'div', attrs: { role: 'dialog' }, key: 'create' }] }))
    const s = runSnapshot({ interactive: [...behind, ...inside] })
    expect(s.elements.length).toBeLessThanOrEqual(160)
    expect(s.elements.slice(0, 2).map((e) => e.name)).toEqual(['Next', 'Share'])
  })

  it('does not call a file input off screen: it is hidden by design and a file goes into the input itself', () => {
    const s = runSnapshot({ interactive: [{ tag: 'input', attrs: { type: 'file' }, rect: { width: 0, height: 0 }, top: 5000 }] })
    expect(s.elements[0]?.offscreen).toBeUndefined()
  })
})

describe('where the screen is on the page, in words', () => {
  const at = (top: number, max: number) => describeScroll({ scroll: { top, max } })

  it('says nothing the page did not say', () => {
    expect(describeScroll({})).toBeNull()
    expect(parseSnapshot({ elements: [], scroll: { top: 'a', max: 5 } })?.scroll).toBeUndefined()
    expect(parseSnapshot({ elements: [], scroll: { top: -1, max: 5 } })?.scroll).toBeUndefined()
    expect(parseSnapshot({ elements: [], scroll: { top: 3.4, max: 1000.2 } })?.scroll).toEqual({ top: 3, max: 1000 })
  })

  it('says at the top, in the middle with how far, at the bottom, and that a short page has nothing to scroll to', () => {
    expect(at(0, 1800)).toMatch(/at the top.*scroll down/)
    expect(at(900, 1800)).toMatch(/50% of the way down.*above and below/)
    expect(at(1800, 1800)).toMatch(/at the bottom.*above/)
    expect(at(0, 0)).toMatch(/nothing to scroll to/)
  })
})

describe('what stands around a file input, read from the page', () => {
  const file = (within: NonNullable<NodeSpec['within']>): NodeSpec => ({ tag: 'input', attrs: { type: 'file' }, rect: { width: 0, height: 0 }, top: 5000, within })

  it('is the label and the heading of the nearest containers that say something', () => {
    const s = runSnapshot({ interactive: [file([{ tag: 'section', attrs: { 'aria-label': 'Profile photo' }, heading: 'Change profile photo' }])] })
    expect(s.elements[0]?.near).toBe('Profile photo Change profile photo')
  })

  it('goes on past a form that has no heading to the dialog around it: a headingless form does not hide what the input is for', () => {
    const s = runSnapshot({ interactive: [file([{ tag: 'form' }, { tag: 'div', attrs: { role: 'dialog', 'aria-label': 'Change profile photo' }, heading: 'Update your picture' }])] })
    expect(s.elements[0]?.near).toBe('Change profile photo Update your picture')
  })

  it('carries what the site called the input in its own code (name, id), the first thing of its near text: a profile photo input labelled "Upload" is still known by it', () => {
    const s = runSnapshot({ interactive: [{ ...file([{ tag: 'section', heading: 'Edit' }]), attrs: { type: 'file', name: 'profile_pic', id: 'avatar-input-1' } }] })
    expect(s.elements[0]?.near).toBe('profile_pic avatar-input-1 Edit')
  })

  it('leaves out a code name that is noise (a hash, a number, a long string), and an input with none', () => {
    const s = runSnapshot({ interactive: [{ ...file([]), attrs: { type: 'file', name: '1', id: 'x'.repeat(80) } }, { ...file([]), attrs: { type: 'file', name: 'a b c', id: '' } }] })
    expect(s.elements.map((e) => e.near)).toEqual([undefined, undefined])
  })

  it('says nothing for an input with nothing around it that says anything', () => {
    const s = runSnapshot({ interactive: [file([{ tag: 'form' }, { tag: 'section' }])] })
    expect(s.elements[0]?.near).toBeUndefined()
  })

  it('takes two containers at most, nearest first: a page heading far above is not mixed in', () => {
    const s = runSnapshot({ interactive: [file([{ tag: 'form', attrs: { 'aria-label': 'Upload' } }, { tag: 'section', heading: 'New post' }, { tag: 'section', heading: 'Edit profile' }])] })
    expect(s.elements[0]?.near).toBe('Upload New post')
  })
})

describe('what stands around a file input', () => {
  it('is carried to the AI for a file input, so a profile photo input is not taken for the one of a post', () => {
    const parsed = parseSnapshot({ elements: [{ ref: 'e3', role: 'input:file', name: '', near: '  Change profile photo ' }, { ref: 'e4', role: 'button', name: 'Next' }] })
    expect(parsed?.elements[0]?.near).toBe('Change profile photo')
    expect(renderElements(parsed as PageSnapshot).split('\n')[0]).toContain('in "Change profile photo"')
    expect(parsed?.elements[1]?.near).toBeUndefined()
  })
})
