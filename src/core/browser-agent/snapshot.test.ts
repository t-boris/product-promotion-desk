import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseSnapshot, renderElements, snapshotScript, type PageSnapshot } from './snapshot'

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
  style?: Record<string, string>
  placeholder?: string
  label?: string
  src?: string
}
class FakeNode {
  readonly attributes = new Map<string, string>()
  readonly nodeType = 1
  readonly shadowRoot = null
  readonly parentElement = null
  style: Record<string, string>
  constructor(readonly spec: NodeSpec) {
    this.style = spec.style ?? {}
    for (const [k, v] of Object.entries(spec.attrs ?? {})) this.attributes.set(k, v)
    if (spec.src) this.attributes.set('src', spec.src)
  }
  get tagName(): string { return this.spec.tag.toUpperCase() }
  get innerText(): string { return this.spec.text ?? '' }
  get value(): string { return this.spec.value ?? '' }
  get checked(): boolean { return this.spec.checked ?? false }
  get disabled(): boolean { return this.spec.disabled ?? false }
  get required(): boolean { return this.spec.required ?? false }
  get placeholder(): string { return this.spec.placeholder ?? '' }
  get title(): string { return '' }
  get name(): string { return '' }
  get labels(): { innerText: string }[] | null { return this.spec.label ? [{ innerText: this.spec.label }] : null }
  get options(): { textContent: string; value: string }[] { return (this.spec.options ?? []).map((o) => ({ textContent: o, value: o })) }
  get selectedIndex(): number { return 0 }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getBoundingClientRect(): { width: number; height: number } { return this.spec.rect ?? { width: 200, height: 30 } }
  closest(): null { return null }
}

function runSnapshot(page: { interactive?: NodeSpec[]; alerts?: NodeSpec[]; frames?: NodeSpec[]; body?: string }): PageSnapshot {
  const interactive = (page.interactive ?? []).map((s) => new FakeNode(s))
  const alerts = (page.alerts ?? []).map((s) => new FakeNode(s))
  const frames = (page.frames ?? []).map((s) => new FakeNode(s))
  const document = {
    title: ' Facebook ',
    body: { innerText: page.body ?? 'Get started on Facebook' },
    getElementById: () => null,
    querySelectorAll: (selector: string) => (selector === '*' ? [] : selector.startsWith('a[href]') ? interactive : selector.includes('role=alert') ? alerts : selector === 'iframe' ? frames : [])
  }
  const getComputedStyle = (el: FakeNode) => ({ display: 'block', visibility: 'visible', opacity: '1', ...el.style })
  const raw = runInNewContext(snapshotScript(), { document, getComputedStyle, location: { href: 'https://www.facebook.com/r.php?x=1', host: 'www.facebook.com' }, window: {}, URL })
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
      { ref: 'e6', role: 'link', name: 'Log in', to: '/login/' }
    ])
    expect(JSON.stringify(s)).not.toContain('hunter2')
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
  })

  it('lists the elements one per line the way MarkView does', () => {
    const s = runSnapshot({ interactive: [{ tag: 'input', attrs: { type: 'text' }, placeholder: 'First name', value: 'Natal', required: true }, { tag: 'select', label: 'Month', options: ['January', 'February'] }] })
    expect(renderElements(s)).toBe('[e1] input:text "First name" value="Natal" (required)\n[e2] select "Month" value="January" options: January | February')
  })

})
