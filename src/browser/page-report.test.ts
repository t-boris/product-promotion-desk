import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageReport } from '../shared/types'
import { addressOf, forgetReports, saveReport } from './page-report'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
const tmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ppd-report-'))
  dirs.push(dir)
  return dir
}
const report = (second: number): PageReport => ({
  takenAt: `2026-11-08T20:00:${String(second).padStart(2, '0')}.000Z`,
  where: 'owner_window',
  address: 'www.facebook.com/r.php',
  title: 'Facebook',
  alerts: ['We could not create your account'],
  text: 'Get started',
  requests: [],
  consoleErrors: [],
  screenshot: 'data:image/png;base64,AAAA',
  savedAs: null
})

describe('saving a page report', () => {
  it('writes the picture and the details side by side, and the details do not carry the picture twice', async () => {
    const dir = await tmp()
    const path = await saveReport(dir, 'acc1', report(1), Buffer.from('png'))
    expect(path?.endsWith('.png')).toBe(true)
    const files = await readdir(join(dir, 'acc1'))
    expect(files.sort()).toEqual(['2026-11-08T20-00-01-000Z.json', '2026-11-08T20-00-01-000Z.png'])
    const details = JSON.parse(await readFile(join(dir, 'acc1', '2026-11-08T20-00-01-000Z.json'), 'utf8'))
    expect(details.alerts).toEqual(['We could not create your account'])
    expect(details.screenshot).toBeUndefined()
  })

  it('keeps only the newest reports of an account', async () => {
    const dir = await tmp()
    for (let i = 1; i <= 9; i++) await saveReport(dir, 'acc1', report(i), Buffer.from('png'), 3)
    const stamps = [...new Set((await readdir(join(dir, 'acc1'))).map((n) => n.slice(0, 22)))].sort()
    expect(stamps).toEqual(['2026-11-08T20-00-07-000', '2026-11-08T20-00-08-000', '2026-11-08T20-00-09-000'].map((s) => s.slice(0, 22)))
  })

  it('still reports something when there is no picture, and nothing when the folder cannot be written', async () => {
    const dir = await tmp()
    expect((await saveReport(dir, 'acc1', report(2), null))?.endsWith('.json')).toBe(true)
    expect(await saveReport(join(dir, 'x\0y'), 'acc1', report(3), null)).toBeNull()
  })

  it('removes the reports of a removed account', async () => {
    const dir = await tmp()
    await saveReport(dir, 'acc1', report(1), Buffer.from('png'))
    await forgetReports(dir, 'acc1')
    expect(await readdir(dir)).toEqual([])
  })

  it('shows an address without its query or fragment', () => {
    expect(addressOf('https://www.facebook.com/r.php?token=1#x')).toBe('www.facebook.com/r.php')
    expect(addressOf('')).toBe('')
  })
})
