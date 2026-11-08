import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { discoverLinks, normalizeHttpUrl, readSite } from './url-reader'
import { htmlToPageText } from './text'
import { html, startSite, unusedUrl } from './testkit'

const reader = { now: () => new Date('2026-11-08T12:00:00Z'), userAgent: 'test-agent' }

describe('normalizeHttpUrl', () => {
  it('accepts http(s) addresses and completes bare hosts', () => {
    expect(normalizeHttpUrl('example.com')).toBe('https://example.com/')
    expect(normalizeHttpUrl('  http://example.org/a?b=1#frag ')).toBe('http://example.org/a?b=1')
    expect(normalizeHttpUrl('localhost:3000/x')).toBe('https://localhost:3000/x')
  })

  it('refuses every other scheme, embedded credentials and empty input', () => {
    for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.co', 'data:text/html,hi', 'https://user:pw@example.com', '', '   ']) {
      expect(() => normalizeHttpUrl(bad), bad).toThrow()
    }
  })
})

describe('htmlToPageText', () => {
  it('extracts readable text and the metadata a passport needs', () => {
    const page = htmlToPageText(
      html(
        'Natal Mystic &amp; more',
        '<script>var secret = 1</script><style>p{}</style><h1>Your chart</h1><p>Free &nbsp;first chart.</p><nav>skip</nav>',
        '<meta name="description" content="Birth charts online"><meta property="og:site_name" content="AstroWeb">'
      )
    )
    expect(page.title).toBe('Natal Mystic & more')
    expect(page.description).toBe('Birth charts online')
    expect(page.siteName).toBe('AstroWeb')
    expect(page.lang).toBe('en')
    expect(page.text).toContain('Your chart')
    expect(page.text).toContain('Free first chart.')
    expect(page.text).not.toContain('secret')
    expect(page.text).not.toContain('p{}')
  })

  it('stays fast on hostile input with thousands of unclosed tags', () => {
    const started = Date.now()
    const page = htmlToPageText(`<html><body>before${'<script '.repeat(20000)}after`)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(page.text).toContain('before')
  })
})

describe('discoverLinks', () => {
  it('follows only same-site pages that look like pricing, about, features or terms', () => {
    const links = discoverLinks(
      '<a href="/pricing">Plans</a><a href="/about">About</a><a href="https://evil.example/pricing">x</a><a href="/logo.png">pricing</a>' +
        '<a href="mailto:a@b.co">pricing</a><a href="#pricing">pricing</a><a href="/blog/random-post">Blog</a><a href="/pricing#top">again</a>',
      'https://shop.example/',
      4
    )
    expect(links).toEqual(['https://shop.example/pricing', 'https://shop.example/about'])
  })
})

describe('readSite', () => {
  it('reads the main page and related pages of the same site', async () => {
    const site = await startSite({
      '/': html('Natal Mystic', '<p>Birth charts.</p><a href="/pricing">Pricing</a><a href="/about">About</a><a href="/missing-faq">FAQ</a>'),
      '/pricing': html('Pricing', '<p>Pro plan costs $9 per month.</p>'),
      '/about': html('About', '<p>Made by one person.</p>')
    })
    try {
      const result = await readSite(site.url, reader)
      expect(result.pages.map((p) => p.title)).toEqual(['Natal Mystic', 'Pricing', 'About'])
      expect(result.pages[1].text).toContain('$9 per month')
      expect(result.pages[0].fetchedAt).toBe('2026-11-08T12:00:00.000Z')
      // The unreachable related page is reported, not thrown.
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].error).toMatch(/404/)
    } finally {
      await site.close()
    }
  })

  it('reports an unreachable site as a failure instead of throwing', async () => {
    const result = await readSite(await unusedUrl(), reader)
    expect(result.pages).toEqual([])
    expect(result.failures[0].error).toMatch(/refused|resolved|reach/)
  })

  it('reports a site that does not answer in time', async () => {
    const server = createServer(() => undefined) // never responds
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
      const result = await readSite(url, { ...reader, limits: { timeoutMs: 150 } })
      expect(result.failures[0].error).toMatch(/in time/)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('caps the size of what it reads', async () => {
    const site = await startSite({ '/': html('Big', `<p>${'word '.repeat(400_000)}</p>`) })
    try {
      const result = await readSite(site.url, { ...reader, limits: { maxBytes: 20_000, maxTextPerPage: 5_000 } })
      expect(result.pages[0].text.length).toBeLessThanOrEqual(5_000)
    } finally {
      await site.close()
    }
  })

  it('rethrows when the caller aborts, so a stop is not mistaken for an unreachable site', async () => {
    const site = await startSite({ '/': html('x', 'x') })
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(readSite(site.url, { ...reader, signal: controller.signal })).rejects.toBeDefined()
    } finally {
      await site.close()
    }
  })
})
