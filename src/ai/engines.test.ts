import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
  ls -A . > "$LOG/cwdlist"
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

const LAUNCH = { command: '/Apps/PPD.app/Contents/MacOS/PPD', args: ['/Apps/PPD.app/Contents/Resources/app.asar/out/main/mcp-shim.js'], env: { ELECTRON_RUN_AS_NODE: '1', PPD_MCP_SOCKET: '/tmp/ppd.sock', PPD_MCP_TOKEN: 'tok"1' } }

describe('agent missions (DEC-018)', () => {
  it('Claude Code gets full access and only the application\'s MCP server, the goal on stdin and the server last', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    expect(engine.supportsAgent).toBe(true)
    await engine.run({ label: 'agent', prompt: 'create the account', system: 'be brief', agent: { server: 'ppd', launch: LAUNCH } })
    expect(read('stdin')).toBe('create the account')
    const argv = read('argv').split('\n').filter(Boolean)
    expect(argv).toContain('[-p]')
    expect(argv).toContain('[--dangerously-skip-permissions]')
    expect(argv).toContain('[--strict-mcp-config]')
    expect(argv.join('')).toContain('[--system-prompt][be brief]')
    expect(argv.join(' ')).not.toMatch(/--tools|dontAsk/)
    const index = argv.indexOf('[--mcp-config]')
    expect(index).toBe(argv.length - 2)
    const config = JSON.parse((argv.at(-1) as string).slice(1, -1))
    expect(config).toEqual({ mcpServers: { ppd: { command: LAUNCH.command, args: LAUNCH.args, env: LAUNCH.env } } })
  })

  it('Codex gets full access, ignores the user\'s configuration and receives the server through -c', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    expect(engine.supportsAgent).toBe(true)
    await engine.run({ label: 'agent', prompt: 'create the account', agent: { server: 'ppd', launch: LAUNCH } })
    const argv = read('argv').split('\n').filter(Boolean)
    expect(argv[0]).toBe('[exec]')
    expect(argv).toContain('[--dangerously-bypass-approvals-and-sandbox]')
    expect(argv).toContain('[--ignore-user-config]')
    expect(argv.join(' ')).not.toContain('--sandbox')
    expect(argv.at(-1)).toBe('[-]')
    const overrides = argv.filter((a, i) => argv[i - 1] === '[-c]').map((a) => a.slice(1, -1))
    expect(overrides).toEqual([
      `mcp_servers.ppd.command="${LAUNCH.command}"`,
      `mcp_servers.ppd.args=["${LAUNCH.args[0]}"]`,
      'mcp_servers.ppd.env={ELECTRON_RUN_AS_NODE="1",PPD_MCP_SOCKET="/tmp/ppd.sock",PPD_MCP_TOKEN="tok\\"1"}'
    ])
  })

  it('Codex makes a picture in the folder it is given, with the sandbox that lets it write there and nowhere else (DEC-019)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ppd-pic-'))
    try {
      const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
      expect(engine.makesImages).toBe(true)
      expect((new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') }) as { makesImages?: boolean }).makesImages).toBeUndefined()
      await engine.run({ label: 'accounts.picture', prompt: 'a portrait', makeFiles: { dir: out } })
      const argv = read('argv').split('\n').filter(Boolean)
      expect(argv.join('')).toContain('[--sandbox][workspace-write]')
      expect(argv.join('')).toContain(`[--cd][${out}]`)
      expect(argv.join(' ')).not.toMatch(/dangerously|mcp_servers/)
      expect(realpathSync(read('cwd').trim())).toBe(realpathSync(out))
      // The folder is the caller's: the engine does not remove it.
      expect(existsSync(out)).toBe(true)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('keeps the text-only runs exactly as they were: no agent, no full access', async () => {
    await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 't', prompt: 'x' })
    expect(read('argv')).not.toMatch(/dangerously|\[--mcp-config\]/)
    await new CodexEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 't', prompt: 'x' })
    expect(read('argv')).not.toMatch(/dangerously|mcp_servers/)
  })
})

describe('tool-free flag', () => {
  it('Claude Code is tool-free only because every tool and MCP server is switched off', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    expect(engine.toolFree).toBe(true)
    await engine.run({ label: 't', prompt: 'x' })
    const argv = read('argv').split('\n').filter(Boolean).join('')
    expect(argv).toContain('[--tools][]')
    expect(argv).toContain('[--strict-mcp-config]')
    expect(argv).not.toContain('--mcp-config')
    expect((await engine.check()).detail).toMatch(/Writing: tool-free, it can only return text/)
  })

  it('Codex is not tool-free: its sandbox limits changes, not what it can read', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    expect(engine.toolFree).toBe(false)
    const detail = (await engine.check()).detail
    expect(detail).toMatch(/not tool-free/)
    expect(detail).not.toMatch(/tool-free, it can only/)
  })

  it('says so in the message even when the engine is missing or broken', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    expect((await new CodexEngine({ searchPaths: [empty], env: env('ok') }).check()).detail).toMatch(/not tool-free/)
    expect((await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('badversion') }).check()).detail).toMatch(/tool-free/)
  })

  it('exposes the flag through createEngines', () => {
    expect(Object.fromEntries(createEngines().map((e) => [e.id, e.toolFree]))).toEqual({ claude: true, codex: false })
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

describe('Codex isolation', () => {
  it('starts in a fresh empty temp directory, hands the same folder to --cd, and removes it afterwards', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'x' })
    const cwd = read('cwd').trim()
    expect(cwd.startsWith(realpathSync(tmpdir()))).toBe(true)
    expect(cwd).not.toBe(realpathSync(process.cwd()))
    expect(cwd).not.toBe(realpathSync(homedir()))
    expect(read('cwdlist').trim()).toBe('') // nothing in it to read
    const argv = read('argv').split('\n').filter(Boolean)
    // --cd gets the same folder (macOS reports the physical path, so compare the unique folder name).
    const cd = argv[argv.indexOf('[--cd]') + 1].slice(1, -1)
    expect(basename(cd)).toBe(basename(cwd))
    expect(existsSync(cwd)).toBe(false) // removed
  })

  it('removes the temp directory when the run fails', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('fail') })
    await expect(engine.run({ label: 't', prompt: 'x' })).rejects.toMatchObject({ kind: 'failed' })
    expect(existsSync(read('cwd').trim())).toBe(false)
  })

  it('ignores a caller-supplied folder: the engine can read files, so it is never pointed at a real one', async () => {
    const project = join(dir, 'project')
    mkdirSync(project)
    writeFileSync(join(project, 'secret.txt'), 'x')
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'x', cwd: project })
    expect(read('cwd').trim()).not.toBe(realpathSync(project))
    expect(read('cwdlist').trim()).toBe('')
    expect(read('argv')).not.toContain(project)
  })

  it('keeps the read-only sandbox and ignores the user configuration that could enable MCP servers or tools', async () => {
    await new CodexEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 't', prompt: 'x' })
    const argv = read('argv')
    expect(argv).toContain('[--sandbox]\n[read-only]')
    expect(argv).toContain('[--ignore-user-config]')
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
