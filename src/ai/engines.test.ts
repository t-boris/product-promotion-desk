import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AiError } from '../core/ports'
import { createEngines } from './index'
import { ClaudeCodeEngine } from './claude-code'
import { CodexEngine } from './codex'
import { defaultSearchDirs, findExecutable, nvmBinDirs } from './locate'

// A tiny stand-in for the real CLIs. It records its argv, stdin and working directory, then behaves according to
// FAKE_MODE. No real claude/codex binary and no network are involved.
const FAKE_CLI = `#!/bin/sh
LOG="$FAKE_LOG_DIR"
if [ -n "$LOG" ]; then
  : > "$LOG/argv"
  for a in "$@"; do printf '[%s]\\n' "$a" >> "$LOG/argv"; done
fi
if [ "$1" = "--version" ]; then
  if [ "$FAKE_MODE" = "badversion" ]; then echo "boom" >&2; exit 3; fi
  echo "\${FAKE_VERSION:-1.2.3 (Fake CLI)}"
  exit 0
fi
input=$(cat)
if [ -n "$LOG" ]; then
  printf '%s' "$input" > "$LOG/stdin"
  pwd > "$LOG/cwd"
fi
case "$FAKE_MODE" in
  ok) printf 'ANSWER:%s\\n' "$input" ;;
  fail) echo "something broke" >&2; exit 2 ;;
  auth) echo "Error: not logged in. Please run login." >&2; exit 1 ;;
  empty) ;;
  hang)
    echo $$ > "$LOG/pid"
    sleep 30 &
    echo $! > "$LOG/childpid"
    wait ;;
  crash) kill -SEGV $$ ;;
  huge) yes x | head -c 200000 ;;
esac
`

let dir: string
let binDir: string
let logDir: string

function writeCli(name: string): void {
  const path = join(binDir, name)
  writeFileSync(path, FAKE_CLI)
  chmodSync(path, 0o755)
}

function env(mode: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: '/usr/bin:/bin', FAKE_MODE: mode, FAKE_LOG_DIR: logDir, ...extra }
}

const read = (name: string): string => readFileSync(join(logDir, name), 'utf8')

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (condition()) return
    await new Promise((r) => setTimeout(r, 25))
  }
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ppd-ai-test-')))
  binDir = join(dir, 'bin')
  logDir = join(dir, 'log')
  mkdirSync(binDir)
  mkdirSync(logDir)
  writeCli('claude')
  writeCli('codex')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('binary lookup', () => {
  it('finds an executable in the given directories and ignores non-executables', () => {
    expect(findExecutable('claude', [binDir])).toBe(join(binDir, 'claude'))
    writeFileSync(join(binDir, 'plain'), 'x')
    expect(findExecutable('plain', [binDir])).toBeNull()
    expect(findExecutable('nothing', [binDir])).toBeNull()
  })

  it('searches PATH first and then the macOS install locations a GUI-launched app does not see', () => {
    const home = join(dir, 'home')
    mkdirSync(join(home, '.nvm/versions/node/v20.1.0/bin'), { recursive: true })
    mkdirSync(join(home, '.nvm/versions/node/v22.10.0/bin'), { recursive: true })
    mkdirSync(join(home, '.nvm/versions/node/v22.9.1/bin'), { recursive: true })
    const dirs = defaultSearchDirs({ PATH: '/usr/bin:/bin' }, home)
    expect(dirs.slice(0, 2)).toEqual(['/usr/bin', '/bin'])
    for (const expected of ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin'), join(home, '.npm-global/bin'), join(home, '.bun/bin')]) {
      expect(dirs).toContain(expected)
    }
    // Newest Node version first.
    expect(nvmBinDirs(home).map((d) => d.split('/').at(-2))).toEqual(['v22.10.0', 'v22.9.1', 'v20.1.0'])
    expect(dirs.filter((d) => d.includes('.nvm'))).toHaveLength(3)
  })
})

describe('availability check', () => {
  it('reports installed, version and ready for a working CLI', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    const status = await engine.check()
    expect(status).toMatchObject({ id: 'claude', installed: true, ready: true, version: '1.2.3', path: join(binDir, 'claude') })
    expect(status.detail).toMatch(/installed/)
  })

  it('parses the Codex version format', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok', { FAKE_VERSION: 'codex-cli 0.167.0' }) })
    expect((await engine.check()).version).toBe('0.167.0')
  })

  it('reports not installed without throwing', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    const status = await new CodexEngine({ searchPaths: [empty], env: env('ok') }).check()
    expect(status).toMatchObject({ installed: false, ready: false, version: null, path: null })
    expect(status.detail).toMatch(/not found/)
  })

  it('reports installed but not ready when --version fails', async () => {
    const status = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('badversion') }).check()
    expect(status.installed).toBe(true)
    expect(status.ready).toBe(false)
    expect(status.detail).toMatch(/--version/)
  })
})

describe('Claude Code run', () => {
  it('sends the prompt on stdin, asks for text and disables every tool', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    const answer = await engine.run({ label: 't', prompt: 'hello engine', system: 'be brief' })
    expect(answer).toBe('ANSWER:hello engine')
    expect(read('stdin')).toBe('hello engine')
    const argv = read('argv').split('\n').filter(Boolean)
    expect(argv).toContain('[-p]')
    expect(argv.join('')).toContain('[--output-format][text]')
    // `--tools ""` is the switch that removes all built-in tools; an empty argument must be passed through.
    expect(argv.join('')).toContain('[--tools][]')
    expect(argv).toContain('[--strict-mcp-config]')
    expect(argv.join('')).toContain('[--permission-mode][dontAsk]')
    expect(argv.join('')).toContain('[--system-prompt][be brief]')
    expect(argv.join(' ')).not.toMatch(/dangerously|bypassPermissions|allowedTools/i)
  })
})

describe('Codex run', () => {
  it('uses exec with a read-only sandbox and never a permissive mode', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    const answer = await engine.run({ label: 't', prompt: 'hello codex', system: 'be brief' })
    expect(answer).toBe('ANSWER:be brief\n\nhello codex')
    const argv = read('argv').split('\n').filter(Boolean)
    expect(argv[0]).toBe('[exec]')
    expect(argv.join('')).toContain('[--sandbox][read-only]')
    expect(argv.at(-1)).toBe('[-]')
    expect(argv.join(' ')).not.toMatch(/danger-full-access|workspace-write|dangerously|bypass/i)
  })
})

describe('failure mapping (an engine problem never crashes the app)', () => {
  const task = { label: 'job', prompt: 'x' }

  it('maps a non-zero exit to failed and keeps stderr', async () => {
    const error = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('fail') }).run(task).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind: 'failed' })
    expect((error as AiError).message).toMatch(/something broke/)
  })

  it('maps a sign-in problem to unavailable', async () => {
    await expect(new CodexEngine({ searchPaths: [binDir], env: env('auth') }).run(task)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('maps an empty answer to invalid_output', async () => {
    await expect(new ClaudeCodeEngine({ searchPaths: [binDir], env: env('empty') }).run(task)).rejects.toMatchObject({ kind: 'invalid_output' })
  })

  it('survives a crashing process (segfault) as a failed run', async () => {
    await expect(new ClaudeCodeEngine({ searchPaths: [binDir], env: env('crash') }).run(task)).rejects.toMatchObject({ kind: 'failed' })
  })

  it('rejects with unavailable when the binary is missing', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    await expect(new ClaudeCodeEngine({ searchPaths: [empty], env: env('ok') }).run(task)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('maps an unstartable command to unavailable', async () => {
    const notExecutable = join(binDir, 'broken')
    writeFileSync(notExecutable, '#!/nonexistent/interpreter\n')
    chmodSync(notExecutable, 0o755)
    const engine = new ClaudeCodeEngine({ commandOverride: notExecutable, env: env('ok') })
    await expect(engine.run(task)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('stops a run that produces more output than allowed', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('huge'), maxOutputBytes: 1000 })
    await expect(engine.run(task)).rejects.toMatchObject({ kind: 'invalid_output' })
  })
})

describe('timeout and cancellation', () => {
  it('enforces the timeout and kills the whole process group', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('hang'), killGraceMs: 200 })
    await expect(engine.run({ label: 'slow', prompt: 'x', timeoutMs: 400 })).rejects.toMatchObject({ kind: 'timeout' })
    const pid = Number(read('pid').trim())
    const childPid = Number(read('childpid').trim())
    await until(() => !alive(pid) && !alive(childPid))
    expect(alive(pid)).toBe(false)
    expect(alive(childPid)).toBe(false)
  })

  it('cancels through the abort signal and kills the process group', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('hang'), killGraceMs: 200 })
    const controller = new AbortController()
    const running = engine.run({ label: 'slow', prompt: 'x' }, { signal: controller.signal })
    await until(() => existsSync(join(logDir, 'childpid')))
    controller.abort()
    await expect(running).rejects.toMatchObject({ kind: 'cancelled' })
    const childPid = Number(read('childpid').trim())
    await until(() => !alive(childPid))
    expect(alive(childPid)).toBe(false)
  })

  it('does not start a process when the signal is already aborted', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    const controller = new AbortController()
    controller.abort()
    await expect(engine.run({ label: 't', prompt: 'x' }, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' })
    expect(existsSync(join(logDir, 'argv'))).toBe(false)
  })
})

describe('isolation', () => {
  it('runs in an empty scratch directory that is removed afterwards, not in the project', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'x' })
    const cwd = read('cwd').trim()
    expect(cwd.startsWith(realpathSync(tmpdir()))).toBe(true)
    expect(cwd).not.toBe(realpathSync(process.cwd()))
    expect(existsSync(cwd)).toBe(false)
  })

  it('reports progress from the CLI', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    const messages: string[] = []
    await engine.run({ label: 'job', prompt: 'x' }, { onProgress: (m) => messages.push(m) })
    expect(messages[0]).toMatch(/Starting Claude Code/)
    expect(messages.at(-1)).toMatch(/Finished job/)
  })
})

describe('createEngines', () => {
  it('provides both engines with their stable ids', () => {
    expect(createEngines().map((e) => e.id)).toEqual(['claude', 'codex'])
  })
})
