// Locating a CLI binary. An Electron app started from Finder inherits a minimal PATH
// (/usr/bin:/bin:...), so tools installed by Homebrew, nvm, npm -g or bun are invisible unless we also look in the
// usual install locations.

import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

/** Newest version first: v22.10.0 before v22.9.1 before v20.1.0. */
function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map((p) => Number.parseInt(p, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** `~/.nvm/versions/node/<version>/bin` for every installed Node version, newest first. */
export function nvmBinDirs(home: string = homedir()): string[] {
  const root = join(home, '.nvm', 'versions', 'node')
  try {
    return readdirSync(root)
      .sort(compareVersionsDesc)
      .map((version) => join(root, version, 'bin'))
  } catch {
    return []
  }
}

/** PATH first (so an explicit user setup wins), then the locations GUI-launched apps do not see. */
export function defaultSearchDirs(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const fromPath = (env.PATH ?? '').split(delimiter).filter(Boolean)
  return unique([
    ...fromPath,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    ...nvmBinDirs(home),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin')
  ])
}

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** First executable named `name` in `dirs`, or null. */
export function findExecutable(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}
