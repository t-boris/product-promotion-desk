// Shared behaviour of the command-line engines (Claude Code, Codex): binary lookup, availability check and a
// supervised, text-only run. Subclasses only say how to call their CLI.

import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { AiError, type AiEngine, type AiRunOptions, type AiTask } from '../core/ports'
import type { EngineId, EngineStatus } from '../shared/types'
import { defaultSearchDirs, findExecutable, isExecutableFile } from './locate'
import { runProcess, type ProcessResult } from './process'

export interface CommandSpec {
  command: string
  /** Arguments placed before the engine's own (e.g. a script path when `command` is an interpreter). */
  args?: string[]
}

export interface CliEngineOptions {
  /** Directories to search INSTEAD of the defaults (PATH plus the usual macOS install locations). */
  searchPaths?: string[]
  /** Base environment of the child process. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /** Use exactly this executable (or interpreter + script) instead of searching. */
  commandOverride?: string | CommandSpec
  defaultTimeoutMs?: number
  versionTimeoutMs?: number
  maxOutputBytes?: number
  /** Delay between SIGTERM and SIGKILL when a run is stopped. */
  killGraceMs?: number
}

interface Located {
  command: string
  prefixArgs: string[]
  /** What is shown to the user as the engine's location. */
  display: string
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const VERSION_TIMEOUT_MS = 15 * 1000
const AUTH_PATTERN = /not logged in|log ?in required|please (?:run )?.*log ?in|sign in|authenticat|unauthori[sz]ed|invalid api key|no api key|credentials/i

export function parseVersion(output: string): string | null {
  const firstLine = output.split('\n').find((line) => line.trim().length > 0)?.trim()
  if (!firstLine) return null
  const match = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(firstLine)
  return match ? match[0] : firstLine.slice(0, 60)
}

function lastLines(text: string, maxChars = 600): string {
  const trimmed = text.trim()
  return trimmed.length > maxChars ? `…${trimmed.slice(-maxChars)}` : trimmed
}

export abstract class CliEngine implements AiEngine {
  abstract readonly id: EngineId
  abstract readonly label: string
  /** Executable name looked up in the search directories. */
  protected abstract readonly binaryName: string

  protected constructor(protected readonly options: CliEngineOptions = {}) {}

  /** Arguments that make the CLI print its answer as text and hold no ability to act. */
  protected abstract buildArgs(task: AiTask, cwd: string): string[]
  /** What is written to the CLI's stdin. */
  protected buildInput(task: AiTask): string {
    return task.prompt
  }

  protected searchDirs(): string[] {
    const env = this.options.env ?? process.env
    return this.options.searchPaths ?? defaultSearchDirs(env, homedir())
  }

  protected locate(): Located | null {
    const override = this.options.commandOverride
    if (override !== undefined) {
      const spec: CommandSpec = typeof override === 'string' ? { command: override } : override
      if (!isExecutableFile(spec.command)) return null
      return { command: spec.command, prefixArgs: spec.args ?? [], display: spec.command }
    }
    const found = findExecutable(this.binaryName, this.searchDirs())
    return found ? { command: found, prefixArgs: [], display: found } : null
  }

  /**
   * The CLI is often a script with an `env node` shebang. Put its own directory and the usual install locations on
   * PATH so it finds its interpreter even when the app was started from Finder with a minimal PATH.
   */
  private childEnv(located: Located): NodeJS.ProcessEnv {
    const base = { ...(this.options.env ?? process.env) }
    const dirs = [dirname(located.command), ...this.searchDirs(), ...(base.PATH ?? '').split(delimiter)].filter(Boolean)
    return { ...base, PATH: [...new Set(dirs)].join(delimiter), NO_COLOR: '1' }
  }

  async check(): Promise<EngineStatus> {
    const status: EngineStatus = {
      id: this.id,
      label: this.label,
      installed: false,
      version: null,
      path: null,
      ready: false,
      detail: '',
      checkedAt: new Date().toISOString()
    }
    try {
      const located = this.locate()
      if (!located) {
        return { ...status, detail: `${this.binaryName} was not found. Install ${this.label}, then re-check.` }
      }
      status.installed = true
      status.path = located.display
      const result = await runProcess({
        command: located.command,
        args: [...located.prefixArgs, '--version'],
        env: this.childEnv(located),
        timeoutMs: this.options.versionTimeoutMs ?? VERSION_TIMEOUT_MS
      })
      const version = result.outcome === 'exited' && result.exitCode === 0 ? parseVersion(result.stdout) : null
      if (!version) {
        const why = result.outcome === 'timeout' ? 'it did not answer in time' : lastLines(result.stderr || result.stdout) || `exit code ${result.exitCode ?? 'none'}`
        return { ...status, detail: `Found ${located.display}, but "--version" failed: ${why}` }
      }
      return { ...status, version, ready: true, detail: `${this.label} ${version} is installed and answers.` }
    } catch (error) {
      return { ...status, detail: `Could not check ${this.label}: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  async run(task: AiTask, options: AiRunOptions = {}): Promise<string> {
    if (options.signal?.aborted) throw new AiError('cancelled', 'The AI task was cancelled.')
    const located = this.locate()
    if (!located) throw new AiError('unavailable', `${this.label} is not installed (${this.binaryName} was not found).`)

    // Unless the caller needs a specific folder, run in an empty scratch directory so the engine has nothing to read
    // by accident (no project instruction files, no repository).
    const scratch = task.cwd ? null : mkdtempSync(join(tmpdir(), 'ppd-ai-'))
    const cwd = task.cwd ?? scratch ?? tmpdir()
    options.onProgress?.(`Starting ${this.label}: ${task.label}`)
    try {
      const result = await runProcess({
        command: located.command,
        args: [...located.prefixArgs, ...this.buildArgs(task, cwd)],
        stdin: this.buildInput(task),
        cwd,
        env: this.childEnv(located),
        timeoutMs: task.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
        maxStdoutBytes: this.options.maxOutputBytes,
        killGraceMs: this.options.killGraceMs,
        onStderrLine: options.onProgress ? (line) => options.onProgress?.(line.slice(0, 200)) : undefined
      })
      const text = this.interpret(result, task)
      options.onProgress?.(`Finished ${task.label} in ${Math.round(result.durationMs / 1000)}s`)
      return text
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true })
    }
  }

  /** Turns the process result into the answer text, or into the AiError that describes the failure. */
  protected interpret(result: ProcessResult, task: AiTask): string {
    switch (result.outcome) {
      case 'spawn_error': {
        const code = result.spawnError?.code
        throw new AiError('unavailable', `${this.label} could not be started${code ? ` (${code})` : ''}: ${result.spawnError?.message ?? 'unknown error'}`)
      }
      case 'timeout':
        throw new AiError('timeout', `${this.label} did not finish "${task.label}" in time and was stopped.`)
      case 'aborted':
        throw new AiError('cancelled', 'The AI task was cancelled.')
      case 'output_limit':
        throw new AiError('invalid_output', `${this.label} produced more output than allowed and was stopped.`)
      case 'exited':
        break
    }
    if (result.exitCode !== 0) {
      const detail = lastLines(result.stderr || result.stdout)
      if (AUTH_PATTERN.test(detail)) {
        throw new AiError('unavailable', `${this.label} is not signed in or not authorized: ${detail}`)
      }
      const how = result.exitCode === null ? `was terminated by ${result.signal ?? 'a signal'}` : `exited with code ${result.exitCode}`
      throw new AiError('failed', `${this.label} ${how}${detail ? `: ${detail}` : ''}`)
    }
    const text = result.stdout.trim()
    if (!text) throw new AiError('invalid_output', `${this.label} returned an empty answer.`)
    return text
  }
}
