// Reading a project folder for analysis (REQ-001): only file reads, never execution. The scan decides what the AI
// may see and says why everything else is left out; the same scan result backs the "what the AI will see" preview.
//
// Safety rules enforced here:
//  - secrets, environment files, keys, dependency and build directories, binaries and huge files are excluded;
//  - symbolic links are never followed (they could point out of the chosen folder);
//  - every file is opened with O_NOFOLLOW and re-checked to still live inside the folder;
//  - secret-looking strings inside included files are masked before the text goes anywhere.

import { closeSync, constants, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import { ApiError } from '../../shared/api'
import type { SourceScope } from '../../shared/types'
import { redactSecrets, secretFileReason } from './redact'

export interface ScanLimits {
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  maxEntriesVisited: number
  maxExcludedListed: number
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxFiles: 250,
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 600 * 1024,
  maxEntriesVisited: 20000,
  maxExcludedListed: 400
}

export interface ScannedFile {
  /** Path relative to the folder, with forward slashes. */
  path: string
  size: number
}

export interface ScanResult {
  /** Real path of the folder (symlinks resolved). */
  root: string
  included: ScannedFile[]
  excluded: { path: string; reason: string }[]
  /** Total number of exclusions, including those not listed individually. */
  excludedCount: number
  /** True when the folder was too large to look at completely. */
  truncated: boolean
}

const EXCLUDED_DIRS: Record<string, string> = {
  node_modules: 'dependencies',
  vendor: 'dependencies',
  bower_components: 'dependencies',
  jspm_packages: 'dependencies',
  pods: 'dependencies',
  carthage: 'dependencies',
  'site-packages': 'dependencies',
  '.venv': 'dependencies (virtual environment)',
  venv: 'dependencies (virtual environment)',
  virtualenv: 'dependencies (virtual environment)',
  '.bundle': 'dependencies',
  '.git': 'version control data',
  '.hg': 'version control data',
  '.svn': 'version control data',
  dist: 'build output',
  build: 'build output',
  out: 'build output',
  target: 'build output',
  '.next': 'build output',
  '.nuxt': 'build output',
  '.output': 'build output',
  '.svelte-kit': 'build output',
  '.gradle': 'build output',
  deriveddata: 'build output',
  '.parcel-cache': 'build cache',
  '.turbo': 'build cache',
  '.angular': 'build cache',
  '.expo': 'build cache',
  '.dart_tool': 'build cache',
  '.cache': 'cache',
  __pycache__: 'compiled cache',
  '.pytest_cache': 'test cache',
  '.mypy_cache': 'tool cache',
  '.ruff_cache': 'tool cache',
  '.tox': 'tool cache',
  coverage: 'test coverage output',
  '.nyc_output': 'test coverage output',
  '.terraform': 'infrastructure tooling data',
  '.serverless': 'deployment tooling data',
  'storybook-static': 'build output',
  '.idea': 'editor settings',
  '.vscode': 'editor settings',
  '.ssh': 'credentials directory',
  '.aws': 'credentials directory',
  '.gnupg': 'credentials directory',
  '.kube': 'credentials directory'
}

const LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'podfile.lock',
  'pipfile.lock',
  'go.sum'
])

const BINARY_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif webp bmp tiff ico icns heic avif psd ai sketch fig ' +
    'mp3 wav ogg flac aac m4a mp4 mov avi mkv webm ' +
    'woff woff2 ttf otf eot ' +
    'zip gz tgz bz2 xz 7z rar tar jar war dmg iso pkg ' +
    'exe dll so dylib a o class pyc pyo wasm node bin dat ' +
    'sqlite sqlite3 db mdb realm ' +
    'pdf doc docx xls xlsx ppt pptx key pages numbers'
  ).split(' ')
)

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function fileNameReason(name: string, rel: string): string | null {
  const lower = name.toLowerCase()
  const secret = secretFileReason(rel)
  if (secret) return `${secret} (never read)`
  if (lower === '.ds_store' || lower === 'thumbs.db') return 'system file'
  if (LOCK_FILES.has(lower)) return 'lock file (dependency pins)'
  if (/\.min\.(?:js|css)$/.test(lower) || lower.endsWith('.map') || lower.endsWith('.bundle.js')) return 'minified or generated file'
  if (BINARY_EXTENSIONS.has(extensionOf(lower))) return 'binary file'
  return null
}

// ───────────────────────────── scope ─────────────────────────────

function normalizePrefix(raw: string): string {
  let value = raw.trim().replace(/\\/g, '/')
  if (!value) return ''
  if (value.startsWith('/') || /^[a-z]:\//i.test(value)) {
    throw new ApiError('invalid_input', 'Scope paths must be relative to the chosen folder (for example "src/app"), not absolute.')
  }
  value = value.replace(/(?:\/\*{1,2})+$/, '')
  if (/[*?[\]{}]/.test(value)) throw new ApiError('invalid_input', `Scope "${raw}" is not supported: use folder or file prefixes such as "src/app".`)
  const segments = value.split('/').filter((s) => s && s !== '.')
  if (segments.includes('..')) throw new ApiError('invalid_input', 'Scope paths cannot contain "..": the AI may only see inside the chosen folder.')
  return segments.join('/')
}

export function normalizeScope(scope: SourceScope | null | undefined): SourceScope {
  const clean = (list: unknown): string[] => (Array.isArray(list) ? list : []).filter((p): p is string => typeof p === 'string').map(normalizePrefix).filter(Boolean)
  return { include: [...new Set(clean(scope?.include))], exclude: [...new Set(clean(scope?.exclude))] }
}

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`)

// ───────────────────────────── folder validation ─────────────────────────────

/** Resolves and validates a folder chosen by the user; returns its real path. */
export function resolveCodeFolder(folder: string): string {
  if (typeof folder !== 'string' || !isAbsolute(folder)) throw new ApiError('invalid_input', 'Choose a folder by its full path (it must start with "/").')
  let real: string
  try {
    real = realpathSync(folder)
    if (!statSync(real).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new ApiError('invalid_input', `The folder does not exist or is not readable: ${folder}`)
  }
  if (real === sep || real === realpathSync(homedir())) {
    throw new ApiError('invalid_input', 'That folder is too broad. Choose the project folder itself, not the filesystem root or your home folder.')
  }
  return real
}

// ───────────────────────────── scan ─────────────────────────────

function priority(path: string): number {
  const lower = path.toLowerCase()
  const name = lower.slice(lower.lastIndexOf('/') + 1)
  const depth = lower.split('/').length - 1
  let score = 3 + depth
  if (/^readme/.test(name)) score = 0
  else if (['package.json', 'pyproject.toml', 'cargo.toml', 'composer.json', 'gemfile', 'go.mod', 'pubspec.yaml', 'package.swift', 'app.json', 'manifest.json'].includes(name)) score = 0
  else if (/(?:pricing|plans?|billing|checkout|subscription)/.test(lower)) score = 1
  else if (lower.startsWith('docs/') || name.endsWith('.md') || name.endsWith('.mdx')) score = 2
  else if (/(?:locales?|i18n|translations?|messages)\//.test(lower)) score = 2
  if (/(?:^|\/)(?:tests?|__tests__|spec|specs|fixtures|mocks?|__mocks__|e2e)(?:\/|$)/.test(lower) || /\.(?:test|spec)\./.test(name)) score += 20
  return score
}

function looksBinary(fd: number, size: number): boolean {
  const probe = Buffer.alloc(Math.min(4096, size))
  if (probe.length === 0) return false
  readSync(fd, probe, 0, probe.length, 0)
  return probe.includes(0)
}

const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

export function scanCodeFolder(folder: string, scope?: SourceScope | null, limits: ScanLimits = DEFAULT_SCAN_LIMITS): ScanResult {
  const root = resolveCodeFolder(folder)
  const { include, exclude } = normalizeScope(scope)
  const excluded: { path: string; reason: string }[] = []
  let excludedCount = 0
  let truncated = false
  const note = (path: string, reason: string): void => {
    excludedCount++
    if (excluded.length < limits.maxExcludedListed) excluded.push({ path, reason })
  }

  const candidates: ScannedFile[] = []
  const stack: string[] = ['']
  let visited = 0

  while (stack.length > 0 && !truncated) {
    const relDir = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = readdirSync(join(root, relDir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    } catch {
      note(`${relDir || '.'}/`, 'folder could not be read')
      continue
    }
    for (const entry of entries) {
      if (++visited > limits.maxEntriesVisited) {
        truncated = true
        note('(rest of the folder)', 'folder is too large to scan completely')
        break
      }
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name

      if (entry.isSymbolicLink()) {
        let leaves: boolean
        try {
          const target = realpathSync(join(root, rel))
          leaves = !(target === root || target.startsWith(root + sep))
        } catch {
          leaves = true
        }
        note(rel, leaves ? 'symbolic link leading outside the folder (never followed)' : 'symbolic link (never followed)')
        continue
      }
      if (entry.isDirectory()) {
        const technical = EXCLUDED_DIRS[entry.name.toLowerCase()]
        if (technical) note(`${rel}/`, technical)
        else if (exclude.some((p) => under(rel, p))) note(`${rel}/`, 'excluded by your scope')
        else if (include.length > 0 && !include.some((p) => under(rel, p) || p.startsWith(`${rel}/`))) note(`${rel}/`, 'outside the selected scope')
        else stack.push(rel)
        continue
      }
      if (!entry.isFile()) {
        note(rel, 'not a regular file')
        continue
      }
      const nameReason = fileNameReason(entry.name, rel)
      if (nameReason) {
        note(rel, nameReason)
        continue
      }
      if (exclude.some((p) => under(rel, p))) {
        note(rel, 'excluded by your scope')
        continue
      }
      if (include.length > 0 && !include.some((p) => under(rel, p))) {
        note(rel, 'outside the selected scope')
        continue
      }
      try {
        const fd = openSync(join(root, rel), OPEN_FLAGS)
        try {
          const st = fstatSync(fd)
          if (!st.isFile()) note(rel, 'not a regular file')
          else if (st.size > limits.maxFileBytes) note(rel, `too large (${Math.round(st.size / 1024)} KB)`)
          else if (looksBinary(fd, st.size)) note(rel, 'binary file')
          else candidates.push({ path: rel, size: st.size })
        } finally {
          closeSync(fd)
        }
      } catch {
        note(rel, 'file could not be read')
      }
    }
  }

  candidates.sort((a, b) => priority(a.path) - priority(b.path) || (a.path < b.path ? -1 : 1))
  const included: ScannedFile[] = []
  let total = 0
  let dropped = 0
  for (const file of candidates) {
    if (included.length >= limits.maxFiles || total + file.size > limits.maxTotalBytes) {
      dropped++
      continue
    }
    included.push(file)
    total += file.size
  }
  if (dropped > 0) note(`(${dropped} more files)`, 'over the size budget: the most relevant files were kept first')
  included.sort((a, b) => (a.path < b.path ? -1 : 1))
  return { root, included, excluded, excludedCount, truncated }
}

// ───────────────────────────── reading ─────────────────────────────

export interface FileText {
  text: string
  /** Number of secret-looking strings masked in this file. */
  redactions: number
}

/** Reads one scanned file as redacted text. Returns null when it cannot be read safely (the scan result is advisory). */
export function readScannedFile(root: string, file: ScannedFile, maxBytes: number = DEFAULT_SCAN_LIMITS.maxFileBytes): FileText | null {
  const abs = join(root, ...file.path.split('/'))
  let fd: number
  try {
    fd = openSync(abs, OPEN_FLAGS)
  } catch {
    return null
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > maxBytes) return null
    // The file must still live inside the folder (a parent directory could have been swapped for a link).
    const real = realpathSync(abs)
    if (!real.startsWith(root + sep)) return null
    const buffer = Buffer.alloc(st.size)
    let offset = 0
    while (offset < st.size) {
      const read = readSync(fd, buffer, offset, st.size - offset, offset)
      if (read === 0) break
      offset += read
    }
    const text = buffer.subarray(0, offset).toString('utf8')
    if (text.includes('\u0000')) return null
    const redacted = redactSecrets(text)
    return { text: redacted.text, redactions: redacted.count }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}
