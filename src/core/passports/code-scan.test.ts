import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeScope, readScannedFile, resolveCodeFolder, scanCodeFolder } from './code-scan'
import { redactSecrets, secretFileReason } from './redact'
import { previewSource } from './sources'
import { makeFolder } from './testkit'

const paths = (scan: ReturnType<typeof scanCodeFolder>): string[] => scan.included.map((f) => f.path)
const reasonFor = (scan: ReturnType<typeof scanCodeFolder>, path: string): string | undefined => scan.excluded.find((e) => e.path === path)?.reason

describe('code folder scan: default exclusions (REQ-001)', () => {
  const folder = makeFolder({
    'README.md': '# Natal Mystic\nA natal chart calculator.',
    'package.json': '{"name":"natal","scripts":{"postinstall":"node ./boom.js"}}',
    'src/app.ts': 'export const answer = 42',
    'src/pricing.ts': 'export const FREE_CHARTS = 1',
    '.env': 'API_KEY=supersecretvalue123',
    '.env.production': 'DB_PASSWORD=hunter2hunter2',
    'config/credentials.json': '{"token":"abc"}',
    'keys/server.pem': '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    'deploy/id_rsa': 'private',
    'deploy/id_rsa.pub': 'public',
    'node_modules/dep/index.js': 'module.exports = 1',
    'vendor/lib.php': '<?php',
    '.git/config': '[core]',
    'dist/bundle.js': 'x',
    'build/out.js': 'x',
    '.next/cache.js': 'x',
    'venv/lib/site.py': 'x',
    '__pycache__/a.pyc': 'x',
    'coverage/lcov.info': 'x',
    'Pods/Pod.swift': 'x',
    'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]),
    'data/blob.dat': Buffer.from([1, 2, 0, 3]),
    'package-lock.json': '{}',
    'vendor.min.js': 'a',
    'big.txt': 'x'.repeat(300 * 1024)
  })
  const scan = scanCodeFolder(folder)

  it('includes the project files the AI needs', () => {
    expect(paths(scan)).toEqual(expect.arrayContaining(['README.md', 'package.json', 'src/app.ts', 'src/pricing.ts']))
  })

  it('excludes secrets, environment files, keys and certificates, with the reason', () => {
    for (const secret of ['.env', '.env.production', 'config/credentials.json', 'keys/server.pem', 'deploy/id_rsa', 'deploy/id_rsa.pub']) {
      expect(paths(scan)).not.toContain(secret)
      expect(reasonFor(scan, secret)).toMatch(/never read|secret|key|environment/)
    }
  })

  it('excludes dependency and technical directories as whole directories', () => {
    for (const dir of ['node_modules/', 'vendor/', '.git/', 'dist/', 'build/', '.next/', 'venv/', '__pycache__/', 'coverage/', 'Pods/']) {
      expect(reasonFor(scan, dir), dir).toBeDefined()
    }
    expect(paths(scan).some((p) => /node_modules|vendor\/|\.git\/|dist\/|venv/.test(p))).toBe(false)
  })

  it('excludes binary, minified, lock and oversized files', () => {
    expect(reasonFor(scan, 'assets/logo.png')).toMatch(/binary/)
    expect(reasonFor(scan, 'data/blob.dat')).toMatch(/binary/)
    expect(reasonFor(scan, 'package-lock.json')).toMatch(/lock/)
    expect(reasonFor(scan, 'vendor.min.js')).toMatch(/minified/)
    expect(reasonFor(scan, 'big.txt')).toMatch(/too large/)
  })

  it('preview shows exactly what the scan allows and why the rest is left out', () => {
    const preview = previewSource({ kind: 'code_folder', ref: folder })
    expect(preview.included).toEqual(paths(scan))
    expect(preview.excluded.find((e) => e.path === '.env')?.reason).toBeDefined()
    expect(preview.summary).toMatch(/never run/)
  })
})

describe('code folder scan: scope', () => {
  const folder = makeFolder({
    'src/a.ts': 'a',
    'src/internal/b.ts': 'b',
    'docs/guide.md': 'guide',
    'other/c.ts': 'c'
  })

  it('limits the scan to the included prefixes', () => {
    const scan = scanCodeFolder(folder, { include: ['src'], exclude: [] })
    expect(paths(scan).sort()).toEqual(['src/a.ts', 'src/internal/b.ts'])
    expect(reasonFor(scan, 'docs/')).toMatch(/outside the selected scope/)
  })

  it('applies extra exclusions on top of the defaults', () => {
    const scan = scanCodeFolder(folder, { include: [], exclude: ['src/internal', 'other/'] })
    expect(paths(scan).sort()).toEqual(['docs/guide.md', 'src/a.ts'])
    expect(reasonFor(scan, 'src/internal/')).toMatch(/your scope/)
  })

  it('cannot widen the scope beyond the defaults: secrets stay excluded even when explicitly included', () => {
    const withSecret = makeFolder({ 'src/a.ts': 'a', 'src/.env': 'TOKEN=abcdefgh1234' })
    const scan = scanCodeFolder(withSecret, { include: ['src/.env', 'src'], exclude: [] })
    expect(paths(scan)).toEqual(['src/a.ts'])
  })

  it('refuses scope paths that climb out of the folder or are absolute', () => {
    expect(() => normalizeScope({ include: ['../secrets'], exclude: [] })).toThrow(/\.\./)
    expect(() => normalizeScope({ include: ['src/../../x'], exclude: [] })).toThrow(/\.\./)
    expect(() => normalizeScope({ include: ['/etc'], exclude: [] })).toThrow(/relative/)
    expect(() => normalizeScope({ include: [], exclude: ['src/*.ts'] })).toThrow(/not supported/)
    expect(normalizeScope({ include: ['./src/', 'src/**'], exclude: [] }).include).toEqual(['src'])
  })
})

describe('code folder scan: path traversal and symlinks', () => {
  it('never follows a symlink that leaves the folder', () => {
    const outside = makeFolder({ 'private/notes.txt': 'top secret', 'secret-dir/key.txt': 'k' })
    const folder = makeFolder({ 'src/a.ts': 'a' })
    symlinkSync(join(outside, 'private/notes.txt'), join(folder, 'link-to-file.txt'))
    symlinkSync(join(outside, 'secret-dir'), join(folder, 'link-to-dir'))
    const scan = scanCodeFolder(folder)
    expect(paths(scan)).toEqual(['src/a.ts'])
    expect(reasonFor(scan, 'link-to-file.txt')).toMatch(/outside the folder/)
    expect(reasonFor(scan, 'link-to-dir')).toMatch(/outside the folder/)
  })

  it('does not follow symlinks that stay inside either (no loops, no duplicates)', () => {
    const folder = makeFolder({ 'src/a.ts': 'a' })
    symlinkSync(join(folder, 'src'), join(folder, 'loop'))
    const scan = scanCodeFolder(folder)
    expect(paths(scan)).toEqual(['src/a.ts'])
    expect(reasonFor(scan, 'loop')).toMatch(/symbolic link/)
  })

  it('refuses to read a file whose path was swapped for a link after the scan', () => {
    const outside = makeFolder({ 'stolen.txt': 'stolen' })
    const folder = makeFolder({ 'a.ts': 'safe' })
    const scan = scanCodeFolder(folder)
    expect(readScannedFile(scan.root, scan.included[0])?.text).toBe('safe')
    // Replace the scanned file by a symlink to a file outside the folder.
    writeFileSync(join(folder, 'swap.ts'), 'x')
    const stale = { path: 'swap.ts', size: 1 }
    symlinkSync(join(outside, 'stolen.txt'), join(folder, 'link.ts'))
    expect(readScannedFile(scan.root, { path: 'link.ts', size: 6 })).toBeNull()
    expect(readScannedFile(scan.root, stale)?.text).toBe('x')
  })

  it('refuses a missing folder, a relative path, the filesystem root and the home folder', () => {
    expect(() => resolveCodeFolder('relative/path')).toThrow(/full path/)
    expect(() => resolveCodeFolder('/definitely/not/here')).toThrow(/does not exist/)
    expect(() => resolveCodeFolder('/')).toThrow(/too broad/)
    expect(() => resolveCodeFolder(homedir())).toThrow(/too broad/)
  })
})

describe('code is only read, never executed', () => {
  it('scans, reads and previews executable project files without running anything', () => {
    // If anything ran these files, the marker would appear.
    const markerDir = makeFolder({ 'keep.txt': 'x' })
    const marker = join(markerDir, 'EXECUTED')
    const folder = makeFolder({
      'index.js': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`,
      'setup.sh': `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`,
      'package.json': JSON.stringify({ scripts: { postinstall: `touch ${marker}` } })
    })
    chmodSync(join(folder, 'setup.sh'), 0o755)
    const scan = scanCodeFolder(folder)
    for (const file of scan.included) readScannedFile(scan.root, file)
    previewSource({ kind: 'code_folder', ref: folder })
    expect(scan.included.map((f) => f.path)).toEqual(expect.arrayContaining(['index.js', 'setup.sh', 'package.json']))
    expect(existsSync(marker)).toBe(false)
  })

  it('the passports module has no way to start a process', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testkit.ts')
      .filter((f) => /child_process|node:vm|\beval\(|new Function\(|execSync|spawn\(/.test(readFileSync(join(dir, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('secret redaction inside included files', () => {
  it('masks secret-looking strings and keeps the surrounding code readable', () => {
    const folder = makeFolder({
      'src/config.ts': [
        'export const apiKey = "sk-abcdefghijklmnopqrstuvwxyz0123456789"',
        'const password = "hunter2hunter2"',
        'const url = "postgres://admin:s3cr3tpass@db.internal:5432/app"',
        'const github = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
        'const aws = "AKIAABCDEFGHIJKLMNOP"',
        'const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"',
        'const key = `-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----`',
        'export function greet(name: string) { return "hello " + name }',
        'const token: string = process.env.API_TOKEN'
      ].join('\n')
    })
    const scan = scanCodeFolder(folder)
    const file = readScannedFile(scan.root, scan.included[0])
    expect(file).not.toBeNull()
    const text = file?.text ?? ''
    for (const leaked of ['sk-abcdefghijklmnop', 'hunter2hunter2', 's3cr3tpass', 'ghp_abcdef', 'AKIAABCDEFGHIJKLMNOP', 'eyJhbGciOiJIUzI1NiJ9', 'MIIBOgIBAAJBAKj34Gkx']) {
      expect(text, leaked).not.toContain(leaked)
    }
    expect(text).toContain('[REDACTED')
    expect(text).toContain('export function greet(name: string)')
    // A code reference is not a secret literal and stays readable.
    expect(text).toContain('process.env.API_TOKEN')
    expect(file?.redactions).toBeGreaterThanOrEqual(7)
  })

  it('reports the number of masked strings in the preview', () => {
    const folder = makeFolder({ 'a.ts': 'const secret = "abcdefghij123456"' })
    expect(previewSource({ kind: 'code_folder', ref: folder }).summary).toMatch(/1 secret-looking string/)
  })

  it('recognizes secret file names', () => {
    expect(secretFileReason('/p/.env')).toBeTruthy()
    expect(secretFileReason('/p/.env.local')).toBeTruthy()
    expect(secretFileReason('/p/prod.env')).toBeTruthy()
    expect(secretFileReason('/p/server.key')).toBeTruthy()
    expect(secretFileReason('/p/id_ed25519')).toBeTruthy()
    expect(secretFileReason('/p/my-secrets.yml')).toBeTruthy()
    expect(secretFileReason('/p/service-account.json')).toBeTruthy()
    expect(secretFileReason('/p/README.md')).toBeNull()
    expect(secretFileReason('/p/environment.ts')).toBeNull()
    expect(redactSecrets('nothing to hide here').count).toBe(0)
  })
})

describe('budget', () => {
  it('keeps the most relevant files first when the folder is larger than the budget', () => {
    const files: Record<string, string> = { 'README.md': 'readme' }
    for (let i = 0; i < 40; i++) files[`deep/a/b/c/file${i}.ts`] = `// ${'x'.repeat(100)}`
    const folder = makeFolder(files)
    mkdirSync(join(folder, 'tests'), { recursive: true })
    const scan = scanCodeFolder(folder, null, { maxFiles: 5, maxFileBytes: 200 * 1024, maxTotalBytes: 600 * 1024, maxEntriesVisited: 1000, maxExcludedListed: 100 })
    expect(scan.included).toHaveLength(5)
    expect(paths(scan)).toContain('README.md')
    expect(scan.excluded.some((e) => /more files/.test(e.path))).toBe(true)
  })
})
