// The owner's rule (2026-11-21): every address opens in the app's own browser, never in the system's. This guards the code itself: nothing may hand an
// address to the operating system, and no screen may carry a link that the window would hand on to it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const files = sources(SRC)
const without = (pattern: RegExp, allowed: string[] = []): string[] =>
  files.filter((file) => !allowed.some((a) => file.endsWith(a)) && pattern.test(readFileSync(file, 'utf8'))).map((file) => file.slice(SRC.length + 1))

describe('no address leaves for the system browser', () => {
  it('nothing calls the operating system to open an address or a file', () => {
    expect(without(/\bshell\s*\.\s*(openExternal|openPath)\b/)).toEqual([])
    expect(without(/\bopenExternal\b/)).toEqual([])
    // the one use of the operating system's shell is to show a saved picture in its folder (media-tools.ts); nothing else may import it
    expect(without(/from 'electron'[^\n]*\bshell\b|\bshell\b[^\n]*from 'electron'/, ['main/media-tools.ts'])).toEqual([])
  })

  it('no screen has a link that opens a new window (the toolbar of the account browser is its own, answered inside it)', () => {
    expect(without(/target=["']_blank["']/, ['browser/toolbar-state.ts'])).toEqual([])
    expect(without(/\bwindow\.open\(/)).toEqual([])
  })
})
