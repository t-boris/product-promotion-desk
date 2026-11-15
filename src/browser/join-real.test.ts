// The join mission's tools on the REAL installed Google Chrome (DEC-029). Off unless PPD_REAL_CHROME=1, like chrome-real.test.ts: it starts an own
// Chrome (own profile folder in a temp folder, the mock keychain) and a local community page on 127.0.0.1; no real site is opened.
//
//   PPD_REAL_CHROME=1 npx vitest run src/browser/join-real.test.ts

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Account } from '../shared/types'
import { ChromeBrowserService } from './chrome-browser-service'
import { findChrome } from './chrome-launcher'
import { exerciseJoin, startCommunity, type Community } from './join-probe'

const REAL = process.env.PPD_REAL_CHROME === '1'

describe.skipIf(!REAL)('the join mission on the real installed Chrome', () => {
  let dataDir = ''
  let community: Community
  let service: ChromeBrowserService
  const env = { ...process.env, PPD_CHROME_MOCK_KEYCHAIN: '1' }
  const account = { id: 'acct-join-probe', platform: 'reddit', label: 'Join probe', identity: null, partition: 'persist:ppd-join-probe-1', status: 'ready', createdAt: new Date().toISOString(), productId: null, role: null, loginName: null } as unknown as Account

  beforeAll(async () => {
    expect(findChrome(env), 'Google Chrome is installed').not.toBeNull()
    dataDir = await mkdtemp(join(tmpdir(), 'ppd-join-real-'))
    community = await startCommunity()
    service = new ChromeBrowserService({ assertValid: () => undefined }, { dataDir, diagnosticsDir: join(dataDir, 'diagnostics'), env })
  }, 60_000)

  afterAll(async () => {
    await service?.forgetAccount(account).catch(() => undefined)
    await community?.close()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  }, 60_000)

  it('presses the community\'s Join button once, with a real click, and nothing else reaches the site', async () => {
    const checks = await exerciseJoin(service, account, community, { realClick: true })
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(checks.length).toBeGreaterThan(20)
  }, 120_000)
})
