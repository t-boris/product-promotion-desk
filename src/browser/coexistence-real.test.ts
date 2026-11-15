// The owner's windows next to the AI's page on ONE session (DEC-038), on the REAL installed Google Chrome. Off unless PPD_REAL_CHROME=1, like
// chrome-real.test.ts: it starts an own Chrome (own profile folder in a temp folder, the mock keychain) and a local site on 127.0.0.1; no real site is opened.
//
//   PPD_REAL_CHROME=1 npx vitest run src/browser/coexistence-real.test.ts

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Account } from '../shared/types'
import { ChromeBrowserService } from './chrome-browser-service'
import { findChrome } from './chrome-launcher'
import { exerciseCoexistence, startCoexistenceSite, type CoexistenceSite } from './coexistence-probe'
import { newProbeTickets } from './post-picture-probe'

const REAL = process.env.PPD_REAL_CHROME === '1'

describe.skipIf(!REAL)('the owner\'s windows next to the AI\'s page on the real installed Chrome', () => {
  let dataDir = ''
  let site: CoexistenceSite
  const tickets = newProbeTickets()
  let service: ChromeBrowserService
  const env = { ...process.env, PPD_CHROME_MOCK_KEYCHAIN: '1' }
  const account = { id: 'acct-coexistence-probe', platform: 'reddit', label: 'Coexistence probe', identity: null, partition: 'persist:ppd-coexistence-probe-1', status: 'ready', createdAt: new Date().toISOString(), productId: null, role: null, loginName: null } as unknown as Account

  beforeAll(async () => {
    expect(findChrome(env), 'Google Chrome is installed').not.toBeNull()
    dataDir = await mkdtemp(join(tmpdir(), 'ppd-coexistence-real-'))
    site = await startCoexistenceSite()
    service = new ChromeBrowserService(tickets, { dataDir, diagnosticsDir: join(dataDir, 'diagnostics'), env })
  }, 60_000)

  afterAll(async () => {
    await service?.forgetAccount(account).catch(() => undefined)
    await site?.close()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  }, 60_000)

  it('keeps both pages of one session working side by side, notices a sign-out in the owner\'s window and refuses the AI\'s write after it', async () => {
    const checks = await exerciseCoexistence(service, tickets, account, site)
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(checks.length).toBeGreaterThan(20)
  }, 180_000)
})
