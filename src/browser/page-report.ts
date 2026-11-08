// Saving what an account's page showed (DEC-016): the screenshot and the details side by side, a few per account, so the
// person (or whoever helps them) can look at them later. Local files in the application's data folder; nothing is sent anywhere.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PageReport } from '../shared/types'

/** How many reports are kept per account: the newest ones. */
export const KEPT_REPORTS = 6

/** "www.facebook.com/r.php": an address without its query and fragment, which may carry tokens. */
export function addressOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return ''
  }
}

/**
 * Writes `<dir>/<account>/<time>.json` (the report without the picture) and `<time>.png`, then removes the older ones. Returns the
 * path of the picture, or null when nothing could be written: a report is still useful without a copy on disk.
 */
export async function saveReport(dir: string, accountId: string, report: PageReport, png: Buffer | null, keep = KEPT_REPORTS): Promise<string | null> {
  try {
    const folder = join(dir, accountId)
    await mkdir(folder, { recursive: true })
    const stamp = report.takenAt.replace(/[:.]/g, '-')
    const base = join(folder, stamp)
    const { screenshot: _picture, ...details } = report
    await writeFile(`${base}.json`, JSON.stringify(details, null, 2))
    if (png) await writeFile(`${base}.png`, png)
    const stamps = [...new Set((await readdir(folder)).map((name) => name.replace(/\.(json|png)$/, '')))].sort()
    for (const old of stamps.slice(0, Math.max(0, stamps.length - keep))) {
      await rm(join(folder, `${old}.json`), { force: true })
      await rm(join(folder, `${old}.png`), { force: true })
    }
    return png ? `${base}.png` : `${base}.json`
  } catch {
    return null
  }
}

/** Removes every saved report of an account: they go with the account. */
export async function forgetReports(dir: string, accountId: string): Promise<void> {
  await rm(join(dir, accountId), { recursive: true, force: true }).catch(() => undefined)
}
