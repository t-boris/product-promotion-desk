import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakePage, type FakePage } from './chrome-fakes'
import { ChromeRawPage, type ChromeHandle } from './chrome-page'
import type { Page } from 'puppeteer-core'

/** A handle over a fake page, the way the service builds one; `ensured` counts how often the window was asked to be un-minimised. */
async function handleFor(page: FakePage & Page): Promise<ChromeHandle & { ensured: number; disposed: number }> {
  const cdp = await page.createCDPSession()
  const handle = {
    page,
    cdp,
    ensured: 0,
    disposed: 0,
    isAlive: () => !page.isClosed(),
    dispose: async () => {
      handle.disposed += 1
      page.closed = true
    },
    showWindow: async () => undefined,
    ensureShown: async () => void (handle.ensured += 1)
  }
  return handle
}

function make(address = 'https://www.facebook.com/r.php') {
  const pages: Array<FakePage & Page> = []
  const handles: Array<Awaited<ReturnType<typeof handleFor>>> = []
  let creations = 0
  const raw = new ChromeRawPage(async () => {
    creations += 1
    const page = fakePage(address)
    pages.push(page)
    const handle = await handleFor(page)
    handles.push(handle)
    return handle
  })
  return { raw, pages, handles, creations: () => creations }
}

describe('ChromeRawPage', () => {
  it('opens the page once for callers that arrive together', async () => {
    const { raw, creations } = make()
    await Promise.all([raw.url(), raw.url(), raw.read<number>('1')])
    expect(creations()).toBe(1)
  })

  it('opens a new page when the old one was closed, and releases the old one', async () => {
    const { raw, pages, handles, creations } = make()
    await raw.url()
    pages[0].closed = true
    await raw.url()
    expect(creations()).toBe(2)
    expect(handles[0].disposed).toBe(1)
  })

  it('runs a script as the page\'s own code, never as a user gesture', async () => {
    const { raw, pages } = make()
    pages.length = 0
    await raw.url()
    pages[0].answers.push(['document.title', 'Hello'])
    expect(await raw.read<string>('document.title')).toBe('Hello')
    const call = pages[0].commands.find((command) => command.method === 'Runtime.evaluate')
    expect(call?.params).toMatchObject({ expression: 'document.title', returnByValue: true, awaitPromise: true, userGesture: false })
  })

  it('throws what the page\'s script threw', async () => {
    const { raw, pages } = make()
    await raw.url()
    pages[0].answers.push(['boom', new Error('SyntaxError: bad selector')])
    await expect(raw.read('boom()')).rejects.toThrow('SyntaxError: bad selector')
  })

  it('says nothing is loaded for a blank page and for no page', async () => {
    const { raw, pages } = make('about:blank')
    expect(raw.currentUrl()).toBeNull()
    await raw.url()
    expect(raw.currentUrl()).toBeNull()
    pages[0].address = 'https://example.com/a?b=1'
    expect(raw.currentUrl()).toBe('https://example.com/a?b=1')
    pages[0].closed = true
    expect(raw.currentUrl()).toBeNull()
    expect(raw.existing()).toBeNull()
  })

  describe('goto', () => {
    it('opens the address with the load timeout', async () => {
      const { raw, pages } = make('about:blank')
      await raw.goto('example.com/x', { timeoutMs: 5000 })
      expect(pages[0].gotos).toEqual([{ url: 'https://example.com/x', timeout: 5000 }])
    })

    it('turns a timeout into a plain sentence and stops the loading', async () => {
      const { raw, pages } = make('about:blank')
      await raw.url()
      const slow = new Error('Navigation timeout of 5000 ms exceeded')
      slow.name = 'TimeoutError'
      pages[0].gotoError = slow
      await expect(raw.goto('https://example.com/slow', { timeoutMs: 5000 })).rejects.toThrow('Timed out loading example.com')
      expect(pages[0].commands.some((command) => command.method === 'Page.stopLoading')).toBe(true)
    })

    it('accepts a navigation that a redirect superseded when the page that took over has loaded', async () => {
      const { raw, pages } = make('https://example.com/landing')
      await raw.url()
      pages[0].answers.push(['document.readyState', 'complete'])
      pages[0].gotoError = new Error('net::ERR_ABORTED at https://example.com/old')
      await expect(raw.goto('https://example.com/old')).resolves.toBeUndefined()
    })

    it('does not accept an aborted navigation when nothing loaded', async () => {
      const { raw, pages } = make('about:blank')
      await raw.url()
      pages[0].gotoError = new Error('net::ERR_ABORTED at https://example.com/old')
      await expect(raw.goto('https://example.com/old')).rejects.toThrow('ERR_ABORTED')
    })

    it('passes any other failure on', async () => {
      const { raw, pages } = make('about:blank')
      await raw.url()
      pages[0].gotoError = new Error('net::ERR_NAME_NOT_RESOLVED at https://nowhere.invalid/')
      await expect(raw.goto('https://nowhere.invalid/')).rejects.toThrow('ERR_NAME_NOT_RESOLVED')
    })
  })

  describe('pageStep', () => {
    it('does nothing on a page that is not the platform\'s', async () => {
      const { raw, pages } = make('https://evil.example/login')
      const result = await raw.pageStep({ do: 'key', key: 'Enter' }, ['facebook.com'])
      expect(result.status).toBe('wrong_host')
      expect(pages[0].input).toEqual([])
    })

    it('presses a key with Chrome\'s own keyboard, bringing a minimised window back first and never in front', async () => {
      const { raw, pages, handles } = make()
      const result = await raw.pageStep({ do: 'key', key: 'Tab' }, ['facebook.com'])
      expect(result).toMatchObject({ status: 'done' })
      expect(pages[0].input).toEqual(['key:Tab'])
      expect(handles[0].ensured).toBe(1)
      expect(pages[0].fronted).toBe(0)
    })

    it('clicks with a real mouse press at the point the page gave, when the page saw it', async () => {
      const { raw, pages } = make()
      await raw.url()
      pages[0].answers.push(['scrollIntoView', { ok: true, hit: true, x: 40, y: 50, disabled: false }], ['window.__ppdMouse || 0', { ok: true }])
      const result = await raw.pageStep({ do: 'click', ref: 'e3' }, ['facebook.com'])
      expect(result.status).toBe('done')
      expect(pages[0].input).toEqual(['move:40,50', 'down', 'up'])
    })

    it('refuses a file that is not an absolute path before the page is touched', async () => {
      const { raw, pages } = make()
      const result = await raw.pageStep({ do: 'upload', ref: 'e1', path: 'relative.png' }, ['facebook.com'])
      expect(result.status).toBe('refused')
      expect(pages[0].input).toEqual([])
    })
  })

  describe('uploadFile', () => {
    it('refuses a relative path', async () => {
      const { raw } = make()
      await expect(raw.uploadFile('input[type=file]', 'a.png')).rejects.toThrow('Only absolute file paths can be uploaded')
    })

    it('hands an absolute file to the input', async () => {
      const { raw, pages } = make()
      const folder = await mkdtemp(join(tmpdir(), 'ppd-upload-'))
      const file = join(folder, 'a.png')
      await writeFile(file, 'png')
      try {
        await raw.uploadFile('input[type=file]', file)
        expect(pages[0].input).toEqual([`file:${file}`])
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    })

    it('refuses a folder', async () => {
      const { raw } = make()
      await expect(raw.uploadFile('input[type=file]', tmpdir())).rejects.toThrow('The upload path is not a file')
    })
  })

  it('lets go of a page that was still being opened when it is disposed, so it does not live on', async () => {
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    const handles: Array<Awaited<ReturnType<typeof handleFor>>> = []
    const raw = new ChromeRawPage(async () => {
      await gate
      const handle = await handleFor(fakePage('https://www.facebook.com/'))
      handles.push(handle)
      return handle
    })
    const opening = raw.url()
    const disposing = raw.dispose()
    open()
    await Promise.all([opening, disposing])
    expect(handles).toHaveLength(1)
    expect(handles[0].disposed).toBe(1)
    expect(raw.existing()).toBeNull()
  })

  it('disposes the page once and forgets it', async () => {
    const { raw, handles, creations } = make()
    await raw.url()
    await raw.dispose()
    await raw.dispose()
    expect(handles[0].disposed).toBe(1)
    expect(raw.existing()).toBeNull()
    await raw.url()
    expect(creations()).toBe(2)
  })
})
