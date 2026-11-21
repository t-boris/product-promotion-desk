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
  print) printf '%s\\n' "$FAKE_OUT" ;;
  fail) echo "something broke" >&2; exit 2 ;;
  auth) echo "Error: not logged in. Please run login." >&2; exit 1 ;;
  empty) ;;
  hang)
    echo $$ > "$LOG/pid"
    sleep 30 &
    echo $! > "$LOG/childpid"
    wait ;;
  codexlog)
    printf 'OpenAI Codex\n--------\nuser\nthe whole prompt\nweb search: \nweb search: swiss ephemeris history\ncodex\n{"x":1}\ntokens used\n12\n' >&2
    printf '%s\n' '{"x":1}' ;;
  codexjson)
    cat >&2 <<'EOT'
OpenAI Codex
--------
user
the whole prompt
codex
I will search for sources first.
web search: swiss ephemeris history
codex
Here is the result.
{
  "text": "A post.",
  "sources": [
    { "title": "Swiss Ephemeris", "url": "https://www.astro.com/swisseph/" }
  ],
  "statesProductFacts": false
}
tokens used
12
EOT
    printf '%s\n' '{"x":1}' ;;
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

describe('the post mission: the engine has no power but the application\'s tools (H-A)', () => {
  const CONFINED = { server: 'ppd', launch: LAUNCH, confined: true }
  const argvOf = (): string[] => read('argv').split('\n').filter(Boolean).map((a) => a.slice(1, -1))
  const config = { mcpServers: { ppd: { command: LAUNCH.command, args: LAUNCH.args, env: LAUNCH.env } } }

  it('Claude Code starts with no built-in tool, refuses what is not allowed, allows only the application\'s server, and has no skip-permissions flag', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    expect(engine.confinesAgent).toBe(true)
    await engine.run({ label: 'agent.post', prompt: 'post it', system: 'be brief', agent: CONFINED })
    expect(read('stdin')).toBe('post it')
    // The whole list, in order: a flag that is added, removed or moved is a change someone has to look at. `--mcp-config` takes several values, so it is last.
    expect(argvOf()).toEqual([
      '-p',
      '--output-format',
      'text',
      '--tools',
      '',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'mcp__ppd',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--system-prompt',
      'be brief',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify(config)
    ])
    expect(read('argv')).not.toMatch(/dangerously|bypassPermissions|acceptEdits|--disallowedTools/)
  })

  it('names the application\'s server and nothing else in the allow-list: no wildcard, no built-in tool', async () => {
    await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 'agent.post', prompt: 'x', agent: { ...CONFINED, server: 'ppd-browser' } })
    const argv = argvOf()
    const allowed = argv[argv.indexOf('--allowedTools') + 1]
    expect(allowed).toBe('mcp__ppd-browser')
    expect(argv.filter((a) => a === '--allowedTools')).toHaveLength(1)
    expect(allowed).not.toMatch(/[*\s,]|Bash|Read|Write|Edit|Web/)
  })

  it.each(['pp d', 'ppd,Bash', 'ppd*', '*', '', 'ppd__x y', 'mcp__ppd Bash'])('does not run when the server name (%j) would make the allow-list say more than one thing', async (server) => {
    const error = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 'agent.post', prompt: 'x', agent: { ...CONFINED, server } }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(existsSync(join(logDir, 'argv'))).toBe(false) // the engine was never started
  })

  it('leaves every other run exactly as it was: the same arguments for the missions of the owner and for the text-only runs', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 'agent.signup', prompt: 'x', system: 'be brief', agent: { server: 'ppd', launch: LAUNCH } })
    expect(argvOf()).toEqual([
      '-p', '--output-format', 'text', '--dangerously-skip-permissions', '--disable-slash-commands', '--no-session-persistence',
      '--system-prompt', 'be brief', '--strict-mcp-config', '--mcp-config', JSON.stringify(config)
    ])
    // `confined: false` is not confined.
    await engine.run({ label: 'agent.profile', prompt: 'x', agent: { server: 'ppd', launch: LAUNCH, confined: false } })
    expect(argvOf()).toContain('--dangerously-skip-permissions')
    expect(argvOf()).not.toContain('--allowedTools')
    await engine.run({ label: 'draft.reply', prompt: 'x', system: 'be brief' })
    expect(argvOf()).toEqual(['-p', '--output-format', 'text', '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', 'be brief'])
  })

  it('Codex cannot be held to the application\'s tools, so a confined run is refused and Codex is never started with full access instead', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    expect((engine as { confinesAgent?: boolean }).confinesAgent).toBeUndefined()
    const error = await engine.run({ label: 'agent.post', prompt: 'post it', agent: CONFINED }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind: 'unavailable', message: expect.stringMatching(/^Codex cannot be held to the browser tools alone .* so it does not publish for you\.$/) })
    expect(existsSync(join(logDir, 'argv'))).toBe(false) // the CLI was never started: no full-access run in its place
  })

  it('leaves the Codex missions of the owner and its text-only runs as they were', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 'agent.signup', prompt: 'x', agent: { server: 'ppd', launch: LAUNCH } })
    expect(read('argv')).toContain('[--dangerously-bypass-approvals-and-sandbox]')
    await engine.run({ label: 'draft.reply', prompt: 'x' })
    expect(read('argv').replace(/\n/g, '')).toContain('[--sandbox][read-only]')
  })

  it('says through createEngines which engine can be held to the tools', () => {
    expect(Object.fromEntries(createEngines().map((e) => [e.id, e.confinesAgent === true]))).toEqual({ claude: true, codex: false })
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

describe('a run that may search the web (a post is written with it)', () => {
  it('Codex: the global --search goes before exec, and the sandbox stays read-only', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'x', search: true })
    const argv = read('argv').split('\n').filter(Boolean)
    expect(argv.slice(0, 2)).toEqual(['[--search]', '[exec]'])
    expect(argv.join('')).toContain('[--sandbox][read-only]')
    expect(argv).toContain('[--ignore-user-config]')
    expect(argv.join(' ')).not.toMatch(/danger-full-access|workspace-write|dangerously|bypass/i)
  })

  it('Codex: a run that does not ask for a search has no --search', async () => {
    await new CodexEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 't', prompt: 'x' })
    expect(read('argv')).not.toContain('--search')
  })

  it('Claude Code: the search and the reading of a page are the only tools, and nothing else is allowed', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'x', system: 'be brief', search: true })
    const argv = read('argv').split('\n').filter(Boolean).join('')
    expect(argv).toContain('[--tools][WebSearch,WebFetch]')
    expect(argv).toContain('[--allowedTools][WebSearch,WebFetch]')
    expect(argv).toContain('[--permission-mode][dontAsk]')
    expect(argv).toContain('[--strict-mcp-config]')
    expect(argv).not.toMatch(/dangerously|bypassPermissions|Bash|Read\]|Edit|Write/)
  })

  it('Claude Code: a run that does not ask for a search still has no tool at all', async () => {
    await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') }).run({ label: 't', prompt: 'x' })
    const argv = read('argv').split('\n').filter(Boolean).join('')
    expect(argv).toContain('[--tools][]')
    expect(argv).not.toMatch(/WebSearch|WebFetch|allowedTools/)
  })

  it('Codex: the searches it makes are shown as progress, and its banner and prompt are not', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('codexlog') })
    const messages: string[] = []
    await engine.run({ label: 't', prompt: 'x', search: true }, { onProgress: (m) => messages.push(m) })
    expect(messages).toContain('web search: swiss ephemeris history')
    expect(messages.join('\n')).not.toMatch(/whole prompt|OpenAI Codex|tokens used/)
    expect(messages).not.toContain('web search:')
  })

  it('Codex: the answer it prints into its transcript is not shown as progress, line after line of JSON; what it says before it is', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('codexjson') })
    const messages: string[] = []
    await engine.run({ label: 't', prompt: 'x', search: true }, { onProgress: (m) => messages.push(m) })
    expect(messages).toContain('I will search for sources first.')
    expect(messages).toContain('web search: swiss ephemeris history')
    expect(messages).toContain('Here is the result.')
    expect(messages.join('\n')).not.toMatch(/[{}\]]|"title"|"url"|"text"|statesProductFacts|swisseph|tokens used/)
  })
})

describe('the model an engine is asked for', () => {
  const argvOf = (): string[] => read('argv').split('\n').filter(Boolean)

  it('Claude Code gets --model in a text run and in a mission, and none when no model is named', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'hi', model: 'opus' })
    expect(argvOf().join('')).toContain('[--model][opus]')
    await engine.run({ label: 'agent', prompt: 'go', model: 'claude-sonnet-5-5', agent: { server: 'ppd', launch: LAUNCH } })
    expect(argvOf().join('')).toContain('[--model][claude-sonnet-5-5]')
    await engine.run({ label: 'agent', prompt: 'go', model: 'opus', agent: { server: 'ppd', launch: LAUNCH, confined: true } })
    expect(argvOf().join('')).toContain('[--model][opus]')
    await engine.run({ label: 't', prompt: 'hi' })
    expect(argvOf().join('')).not.toContain('--model')
    await engine.run({ label: 't', prompt: 'hi', model: '' })
    expect(argvOf().join('')).not.toContain('--model')
  })

  it('Codex gets --model right after exec in a text run, a picture run and a mission, and none when no model is named', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
    await engine.run({ label: 't', prompt: 'hi', model: 'gpt-5.5' })
    expect(argvOf().slice(0, 3)).toEqual(['[exec]', '[--model]', '[gpt-5.5]'])
    await engine.run({ label: 'agent', prompt: 'go', model: 'gpt-5.5', agent: { server: 'ppd', launch: LAUNCH } })
    expect(argvOf().slice(0, 3)).toEqual(['[exec]', '[--model]', '[gpt-5.5]'])
    await engine.run({ label: 't', prompt: 'hi' })
    expect(argvOf().join('')).not.toContain('--model')
  })

  it('never hands a name that could be read as another option or a command to the engine', async () => {
    for (const model of ['--dangerously-bypass-approvals-and-sandbox', 'a b', '$(whoami)']) {
      const claude = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') })
      await claude.run({ label: 't', prompt: 'hi', model })
      expect(argvOf().join('')).not.toContain('--model')
      const codex = new CodexEngine({ searchPaths: [binDir], env: env('ok') })
      await codex.run({ label: 't', prompt: 'hi', model })
      expect(argvOf().join('')).not.toContain('--model')
      expect(argvOf().join(' ')).not.toMatch(/dangerously|whoami/)
    }
  })
})

describe('the models an engine offers', () => {
  // What the real CLIs printed (Claude Code 2.1.x: `initialize` over stream-json; Codex: `debug models`), cut down to the fields that are read.
  const CLAUDE_OUT = [
    '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}',
    'plain text a hook printed',
    JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'models',
        response: {
          models: [
            { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks' },
            { value: 'opus', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks' },
            { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers' },
            { value: 'bad name', displayName: 'Not a name' },
            { value: 'sonnet' }
          ]
        }
      }
    })
  ].join('\n')
  const CODEX_OUT = JSON.stringify({
    models: [
      { slug: 'gpt-6.1-terra', display_name: 'GPT-6.1 Terra', description: 'Efficient model', visibility: 'list', priority: 3 },
      { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 4 },
      { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', description: 'Fast, go-to model', visibility: 'list', priority: 1 },
      { slug: 'gpt-6.2-astra', visibility: 'list', priority: 2 },
      { slug: '--help', visibility: 'list', priority: 0 }
    ]
  })

  it('Claude Code lists them through the initialize request, with no model asked anything, and leaves out "default" and names that are not names', async () => {
    const engine = new ClaudeCodeEngine({ searchPaths: [binDir], env: env('print', { FAKE_OUT: CLAUDE_OUT }) })
    expect(await engine.models()).toEqual([
      { id: 'opus', label: 'Opus 5.5', description: 'For complex work and everyday tasks' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
      { id: 'sonnet', label: 'sonnet', description: '' }
    ])
    const argv = read('argv').split('\n').filter(Boolean)
    expect(argv.join('')).toContain('[--input-format][stream-json]')
    expect(argv.join('')).toContain('[--tools][]')
    expect(argv.join('')).toContain('[--setting-sources][]')
    expect(JSON.parse(read('stdin'))).toEqual({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } })
  })

  it('Codex lists the ones it offers (not the hidden ones), in its own order', async () => {
    const engine = new CodexEngine({ searchPaths: [binDir], env: env('print', { FAKE_OUT: CODEX_OUT }) })
    expect(await engine.models()).toEqual([
      { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', description: 'Fast, go-to model' },
      { id: 'gpt-6.2-astra', label: 'gpt-6.2-astra', description: '' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', description: 'Efficient model' }
    ])
    expect(read('argv').split('\n').filter(Boolean)).toEqual(['[debug]', '[models]'])
  })

  it('says so when the output is not what that CLI prints, when it fails, and when it is not installed', async () => {
    await expect(new ClaudeCodeEngine({ searchPaths: [binDir], env: env('print', { FAKE_OUT: 'nothing useful' }) }).models()).rejects.toMatchObject({ kind: 'invalid_output', message: expect.stringContaining('no answer to "initialize"') })
    await expect(new CodexEngine({ searchPaths: [binDir], env: env('print', { FAKE_OUT: 'not json' }) }).models()).rejects.toMatchObject({ kind: 'invalid_output' })
    await expect(new CodexEngine({ searchPaths: [binDir], env: env('print', { FAKE_OUT: '{"models":5}' }) }).models()).rejects.toMatchObject({ kind: 'invalid_output', message: expect.stringContaining('no "models" list') })
    await expect(new CodexEngine({ searchPaths: [binDir], env: env('fail') }).models()).rejects.toMatchObject({ kind: 'failed', message: expect.stringContaining('exit code 2') })
    await expect(new CodexEngine({ searchPaths: [join(dir, 'empty')], env: env('ok') }).models()).rejects.toMatchObject({ kind: 'unavailable' })
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

describe('a confined run (the post mission) puts nothing the engine printed into an error', () => {
  const task = { label: 'agent.post', prompt: 'x', agent: { server: 'ppd', launch: LAUNCH, confined: true } }

  it('says only that the engine failed, with its exit code', async () => {
    const error = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('fail') }).run(task).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind: 'failed', message: 'Claude Code exited with code 2.' })
  })

  it('says only that the engine is not signed in', async () => {
    const error = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('auth') }).run(task).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'unavailable', message: expect.not.stringContaining('login') })
  })

  it('says only that a signal ended it', async () => {
    const error = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('crash') }).run(task).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'failed', message: expect.stringMatching(/^Claude Code was terminated by \w+\.$/) })
  })

  it('leaves out the system\'s words when the engine cannot be started', async () => {
    const notExecutable = join(binDir, 'broken')
    writeFileSync(notExecutable, '#!/nonexistent/interpreter\n')
    chmodSync(notExecutable, 0o755)
    const error = await new ClaudeCodeEngine({ commandOverride: notExecutable, env: env('ok') }).run(task).catch((e: unknown) => e)
    expect((error as AiError).kind).toBe('unavailable')
    expect((error as AiError).message).toMatch(/^Claude Code could not be started( \(\w+\))?\.$/)
  })

  it('keeps what an engine prints in the message of a run that is not confined', async () => {
    const error = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('fail') }).run({ label: 'job', prompt: 'x' }).catch((e: unknown) => e)
    expect((error as AiError).message).toBe('Claude Code exited with code 2: something broke')
    const unconfined = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('fail') }).run({ ...task, agent: { ...task.agent, confined: undefined } }).catch((e: unknown) => e)
    expect((unconfined as AiError).message).toBe('Claude Code exited with code 2: something broke')
  })

  it('does the same for a quiet run: an engine that cannot be held to the tools (Codex) still puts nothing it printed into an error', async () => {
    const quiet = { label: 'agent.post', prompt: 'x', agent: { server: 'ppd', launch: LAUNCH, quiet: true } }
    const codex = await new CodexEngine({ searchPaths: [binDir], env: env('fail') }).run(quiet).catch((e: unknown) => e)
    expect(codex).toBeInstanceOf(AiError)
    expect((codex as AiError).message).toBe('Codex exited with code 2.')
    const claude = await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('fail') }).run(quiet).catch((e: unknown) => e)
    expect((claude as AiError).message).toBe('Claude Code exited with code 2.')
  })
})

describe('a quiet run that is not confined (any selected engine may work the browser for the owner)', () => {
  const quiet = { label: 'agent.post', prompt: 'post it', agent: { server: 'ppd', launch: LAUNCH, quiet: true } }

  it('starts Codex with the access the owner decided on for agent missions: the post is not refused', async () => {
    await new CodexEngine({ searchPaths: [binDir], env: env('ok') }).run(quiet)
    expect(read('argv')).toContain('[--dangerously-bypass-approvals-and-sandbox]')
  })

  it('starts Claude Code with that access too, when it was not asked to be confined', async () => {
    await new ClaudeCodeEngine({ searchPaths: [binDir], env: env('ok') }).run(quiet)
    expect(read('argv')).toContain('--dangerously-skip-permissions')
    expect(read('argv')).not.toContain('--allowedTools')
  })

  it('still refuses to run Codex confined: confinement is never claimed for an engine that cannot give it', async () => {
    const error = await new CodexEngine({ searchPaths: [binDir], env: env('ok') }).run({ ...quiet, agent: { ...quiet.agent, confined: true } }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
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
