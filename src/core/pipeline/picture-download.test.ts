// Fetching a picture of a post from an address a page gave: the address is a stranger's, so what may be fetched is decided here, before anything leaves.

import { describe, expect, it } from 'vitest'
import { PICTURE_MAX_BYTES, addressProblem, downloadPicture, isPublicAddress, type DownloadDeps } from './picture-download'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])

function deps(answers: Record<string, () => Response>, names: Record<string, string[]> = {}): DownloadDeps & { fetched: string[] } {
  const fetched: string[] = []
  return {
    fetched,
    lookup: async (host) => names[host] ?? ['93.184.216.34'],
    fetch: async (url) => {
      fetched.push(url)
      const answer = answers[url]
      if (!answer) return new Response('not found', { status: 404 })
      return answer()
    }
  }
}

const picture = (): Response => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })

describe('which addresses are public', () => {
  it('refuses loopback, private, link-local, carrier and reserved addresses, in both versions', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'ff02::1']) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('accepts a public address, and refuses what is not an address', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946']) expect(isPublicAddress(address), address).toBe(true)
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
  })
})

describe('which addresses may be fetched at all', () => {
  it('takes an https address of a name on the internet', () => {
    expect(addressProblem('https://preview.redd.it/abc.jpg?width=640&s=xyz')).toBeNull()
    expect(addressProblem('https://i.redd.it:443/abc.png')).toBeNull()
  })

  it('refuses everything else: other schemes, a name or password in it, another port, a local name, an address of this network, no dot', () => {
    expect(addressProblem('http://i.redd.it/a.png')).toMatch(/https/)
    expect(addressProblem('file:///etc/passwd')).toMatch(/https/)
    expect(addressProblem('https://user:pw@i.redd.it/a.png')).toMatch(/name or a password/)
    expect(addressProblem('https://i.redd.it:8443/a.png')).toMatch(/port/)
    expect(addressProblem('https://localhost/a.png')).toMatch(/network/)
    expect(addressProblem('https://nas.local/a.png')).toMatch(/network/)
    expect(addressProblem('https://service.internal/a.png')).toMatch(/network/)
    expect(addressProblem('https://127.0.0.1/a.png')).toMatch(/network/)
    expect(addressProblem('https://[::1]/a.png')).toMatch(/network/)
    expect(addressProblem('https://intranet/a.png')).toMatch(/not a name/)
    expect(addressProblem('not an address')).toMatch(/not an address/)
  })
})

describe('downloadPicture', () => {
  it('returns the bytes and the type of a picture, sending no cookie and not following a redirect on its own', async () => {
    const d = deps({ 'https://i.redd.it/a.png': picture })
    const got = await downloadPicture('https://i.redd.it/a.png', d)
    expect(got).toMatchObject({ ok: true, mime: 'image/png' })
    expect(got.ok && got.bytes.length).toBe(PNG.length)
    expect(d.fetched).toEqual(['https://i.redd.it/a.png'])
  })

  it('follows at most three redirects, and checks each address as the first one', async () => {
    const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } })
    const ok = deps({ 'https://a.example.com/1': hop('https://b.example.com/2'), 'https://b.example.com/2': hop('/3'), 'https://b.example.com/3': picture })
    expect(await downloadPicture('https://a.example.com/1', ok)).toMatchObject({ ok: true })
    const loop = deps({ 'https://a.example.com/1': hop('https://a.example.com/1') })
    expect(await downloadPicture('https://a.example.com/1', loop)).toEqual({ ok: false, reason: 'The address was passed on too many times.' })
    const away = deps({ 'https://a.example.com/1': hop('http://169.254.169.254/latest/meta-data') })
    expect(await downloadPicture('https://a.example.com/1', away)).toMatchObject({ ok: false, reason: expect.stringMatching(/https/) })
    expect(away.fetched).toEqual(['https://a.example.com/1'])
  })

  it('does not fetch a name that resolves to an address of this network, even when the name looks fine', async () => {
    const d = deps({ 'https://cdn.example.com/a.png': picture }, { 'cdn.example.com': ['93.184.216.34', '10.0.0.5'] })
    expect(await downloadPicture('https://cdn.example.com/a.png', d)).toMatchObject({ ok: false, reason: expect.stringMatching(/network/) })
    expect(d.fetched).toEqual([])
  })

  it('says why the site did not give it: not signed in, an error status, too large, not a picture, no answer', async () => {
    const d = deps({
      'https://x.example.com/denied': () => new Response('no', { status: 403 }),
      'https://x.example.com/gone': () => new Response('no', { status: 410 }),
      'https://x.example.com/big': () => new Response(PNG, { status: 200, headers: { 'content-length': String(PICTURE_MAX_BYTES + 1) } }),
      'https://x.example.com/page': () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    expect(await downloadPicture('https://x.example.com/denied', d)).toMatchObject({ ok: false, reason: expect.stringMatching(/not signed in/) })
    expect(await downloadPicture('https://x.example.com/gone', d)).toEqual({ ok: false, reason: 'The site answered 410.' })
    expect(await downloadPicture('https://x.example.com/big', d)).toMatchObject({ ok: false, reason: expect.stringMatching(/larger than/) })
    expect(await downloadPicture('https://x.example.com/page', d)).toMatchObject({ ok: false, reason: expect.stringMatching(/not a PNG/) })
    const down: DownloadDeps = { lookup: async () => ['93.184.216.34'], fetch: async () => Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' })) }
    expect(await downloadPicture('https://x.example.com/slow', down)).toEqual({ ok: false, reason: 'The site did not answer in time.' })
  })

  it('stops reading a body that grows past the limit, whatever the site declared', async () => {
    const big = new Uint8Array(PICTURE_MAX_BYTES + 10)
    big.set(PNG)
    const d = deps({ 'https://x.example.com/big': () => new Response(big, { status: 200 }) })
    expect(await downloadPicture('https://x.example.com/big', d)).toMatchObject({ ok: false, reason: expect.stringMatching(/larger than/) })
  })
})
