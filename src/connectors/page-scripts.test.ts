import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { gateProbeScript, type GateProbe } from './page-scripts'

// A tiny DOM: enough to run the probe against pages that have, or only seem to have, a human check.
interface FakeStyle {
  display?: string
  visibility?: string
  opacity?: string
}
class FakeEl {
  readonly nodeType = 1
  className = ''
  id = ''
  tagName = 'IFRAME'
  constructor(
    readonly attrs: { src?: string },
    readonly rect: { width: number; height: number; right: number; bottom: number },
    readonly style: FakeStyle = {},
    readonly parentElement: FakeEl | null = null,
    readonly classes: string[] = []
  ) {}
  getBoundingClientRect() {
    return this.rect
  }
  getAttribute(name: string): string | null {
    return name === 'src' ? (this.attrs.src ?? null) : null
  }
  closest(selector: string): FakeEl | null {
    const wanted = selector.replace(/^\./, '')
    if (this.classes.includes(wanted)) return this
    return this.parentElement?.closest(selector) ?? null
  }
}

const NORMAL_PAGE = 'which celebrity had it all and then ruined their entire career in a second? '.repeat(60)
const VISIBLE = { width: 304, height: 78, right: 600, bottom: 400 }

function probe(page: { text?: string; title?: string; frames?: FakeEl[] }): GateProbe {
  const document = {
    body: { innerText: page.text ?? NORMAL_PAGE },
    title: page.title ?? 'Reddit - The heart of the internet',
    querySelectorAll: () => page.frames ?? []
  }
  const getComputedStyle = (el: FakeEl): Required<FakeStyle> => ({ display: 'block', visibility: 'visible', opacity: '1', ...el.style })
  return runInNewContext(gateProbeScript(), { document, getComputedStyle }) as GateProbe
}

const RECAPTCHA = 'https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=6Lfi'

describe('gate probe: a human check is only one that a person can see', () => {
  it('does not take the invisible reCAPTCHA frame of an ordinary page for a wall (Reddit front page)', () => {
    const hidden = new FakeEl({ src: RECAPTCHA }, { width: 0, height: 0, right: 0, bottom: 0 })
    expect(probe({ frames: [hidden] })).toMatchObject({ captcha: false, signal: '' })
  })

  it('does not count a frame inside a hidden container, an invisible one, or one placed off the page', () => {
    const container = new FakeEl({}, VISIBLE, { visibility: 'hidden' })
    expect(probe({ frames: [new FakeEl({ src: RECAPTCHA }, VISIBLE, {}, container)] }).captcha).toBe(false)
    expect(probe({ frames: [new FakeEl({ src: RECAPTCHA }, VISIBLE, { opacity: '0' })] }).captcha).toBe(false)
    expect(probe({ frames: [new FakeEl({ src: RECAPTCHA }, VISIBLE, { display: 'none' })] }).captcha).toBe(false)
    expect(probe({ frames: [new FakeEl({ src: RECAPTCHA }, { width: 300, height: 80, right: -10, bottom: 80 })] }).captcha).toBe(false)
  })

  it('does not count the small reCAPTCHA badge, which is only a mark that the site uses it', () => {
    const badge = new FakeEl({}, { width: 256, height: 60, right: 600, bottom: 400 }, {}, null, ['grecaptcha-badge'])
    expect(probe({ frames: [new FakeEl({ src: RECAPTCHA }, { width: 256, height: 60, right: 600, bottom: 400 }, {}, badge)] }).captcha).toBe(false)
  })

  it('counts a visible challenge and says what it saw', () => {
    const result = probe({ text: 'sign in', frames: [new FakeEl({ src: RECAPTCHA }, VISIBLE)] })
    expect(result.captcha).toBe(true)
    expect(result.signal).toContain('a visible check on the page')
    expect(result.signal).toContain('google.com/recaptcha/enterprise/anchor')
    expect(result.signal).not.toContain('https://')
  })

  it('counts a short page that asks the visitor to prove they are human, and says so', () => {
    expect(probe({ text: 'Please verify you are human to continue' })).toMatchObject({ captcha: true, signal: 'the page asks to verify that you are human' })
  })

  it('does not count a long page that merely quotes the phrase', () => {
    expect(probe({ text: `${NORMAL_PAGE} verify you are human` }).captcha).toBe(false)
  })

  it('counts a check page by its title, and says so', () => {
    const result = probe({ text: 'hello', title: 'Just a moment...' })
    expect(result.captcha).toBe(true)
    expect(result.signal).toContain('Just a moment')
  })

  it('tells a block page from a captcha', () => {
    expect(probe({ text: 'whoa there, pardner! blocked by network security.' })).toMatchObject({ blocked: true, captcha: false })
  })
})
