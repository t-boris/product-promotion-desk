// The post mission's tools, with pictures, on the REAL installed Google Chrome (DEC-031). Off unless PPD_REAL_CHROME=1, like chrome-real.test.ts: it starts an own
// Chrome (own profile folder in a temp folder, the mock keychain) and a local create-post wizard on 127.0.0.1; no real site is opened.
//
//   PPD_REAL_CHROME=1 npx vitest run src/browser/post-picture-real.test.ts

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Account } from '../shared/types'
import { ChromeBrowserService } from './chrome-browser-service'
import { findChrome } from './chrome-launcher'
import { exercisePictures, newProbeTickets, startPictureSite, type PictureSite } from './post-picture-probe'

const REAL = process.env.PPD_REAL_CHROME === '1'

describe.skipIf(!REAL)('the post mission with pictures on the real installed Chrome', () => {
  let dataDir = ''
  let site: PictureSite
  const tickets = newProbeTickets()
  let service: ChromeBrowserService
  const env = { ...process.env, PPD_CHROME_MOCK_KEYCHAIN: '1' }
  const account = { id: 'acct-post-picture-probe', platform: 'reddit', label: 'Post picture probe', identity: null, partition: 'persist:ppd-post-picture-probe-1', status: 'ready', createdAt: new Date().toISOString(), productId: null, role: null, loginName: null } as unknown as Account

  beforeAll(async () => {
    expect(findChrome(env), 'Google Chrome is installed').not.toBeNull()
    dataDir = await mkdtemp(join(tmpdir(), 'ppd-post-picture-real-'))
    site = await startPictureSite()
    service = new ChromeBrowserService(tickets, { dataDir, diagnosticsDir: join(dataDir, 'diagnostics'), env })
  }, 60_000)

  afterAll(async () => {
    await service?.forgetAccount(account).catch(() => undefined)
    await site?.close()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  }, 60_000)

  it('puts the approved pictures into the form, types the caption and presses Share once, and nothing else reaches the site', async () => {
    const checks = await exercisePictures(service, tickets, account, site, { realClick: true })
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(checks.length).toBeGreaterThan(20)
  }, 120_000)
})
