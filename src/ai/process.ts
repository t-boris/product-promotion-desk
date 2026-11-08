// Runs one CLI process to completion. The contract: this function never throws and never leaves a process behind.
// A timeout, an abort or an output overflow kills the whole process group (the CLI may have spawned helpers),
// first politely and then forcefully, so a hanging engine can neither block nor crash the application (REQ-005).

import { spawn, type ChildProcess } from 'node:child_process'

export interface ProcessOptions {
  command: string
  args: string[]
  /** Written to the child's stdin, which is then closed. */
  stdin?: string
  cwd?: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  maxStdoutBytes?: number
  /** Delay between SIGTERM and SIGKILL. */
  killGraceMs?: number
  /** Called with each complete stderr line (progress hints from the CLI). */
  onStderrLine?: (line: string) => void
}

export type ProcessOutcome = 'exited' | 'timeout' | 'aborted' | 'spawn_error' | 'output_limit'

export interface ProcessResult {
  outcome: ProcessOutcome
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  /** Last part of stderr only; enough to explain a failure. */
  stderr: string
  spawnError?: NodeJS.ErrnoException
  durationMs: number
}

const STDERR_TAIL_BYTES = 16 * 1024
const DEFAULT_MAX_STDOUT = 8 * 1024 * 1024

export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const startedAt = Date.now()
  const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT
  const grace = options.killGraceMs ?? 1500

  return new Promise<ProcessResult>((resolve) => {
    const base = { exitCode: null, signal: null, stdout: '', stderr: '' }
    if (options.signal?.aborted) {
      resolve({ ...base, outcome: 'aborted', durationMs: 0 })
      return
    }

    let child: ChildProcess
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group so that the whole tree can be killed with one signal.
        detached: process.platform !== 'win32',
        windowsHide: true
      })
    } catch (error) {
      resolve({ ...base, outcome: 'spawn_error', spawnError: error as NodeJS.ErrnoException, durationMs: Date.now() - startedAt })
      return
    }

    let outcome: ProcessOutcome = 'exited'
    let settled = false
    let stdoutBytes = 0
    const stdoutChunks: Buffer[] = []
    let stderrTail = ''
    let stderrLine = ''
    let killTimer: NodeJS.Timeout | undefined
    let hardTimer: NodeJS.Timeout | undefined

    const signalGroup = (sig: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig)
        else child.kill(sig)
      } catch {
        try {
          child.kill(sig)
        } catch {
          // Already gone.
        }
      }
    }

    const finish = (exitCode: number | null, sig: NodeJS.Signals | null, spawnError?: NodeJS.ErrnoException): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      clearTimeout(killTimer)
      clearTimeout(hardTimer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({
        outcome,
        exitCode,
        signal: sig,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: stderrTail,
        spawnError,
        durationMs: Date.now() - startedAt
      })
    }

    const terminate = (reason: ProcessOutcome): void => {
      if (outcome === 'exited') outcome = reason
      signalGroup('SIGTERM')
      killTimer ??= setTimeout(() => signalGroup('SIGKILL'), grace)
      // If even SIGKILL leaves the pipes open, give up waiting and report what we have.
      hardTimer ??= setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        finish(null, 'SIGKILL')
      }, grace + 2000)
    }

    const onAbort = (): void => terminate('aborted')
    const timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.once('error', (error: NodeJS.ErrnoException) => {
      // Without a pid the process never started (ENOENT, EACCES, ...).
      if (child.pid === undefined) {
        outcome = 'spawn_error'
        finish(null, null, error)
      }
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdout) {
        if (outcome === 'exited') terminate('output_limit')
        return
      }
      stdoutChunks.push(chunk)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_BYTES)
      if (!options.onStderrLine) return
      stderrLine += text
      let newline = stderrLine.indexOf('\n')
      while (newline >= 0) {
        const line = stderrLine.slice(0, newline).trim()
        stderrLine = stderrLine.slice(newline + 1)
        if (line) options.onStderrLine(line)
        newline = stderrLine.indexOf('\n')
      }
      if (stderrLine.length > STDERR_TAIL_BYTES) stderrLine = ''
    })

    child.once('close', (code, sig) => finish(code, sig))

    // A child that exits without reading its input raises EPIPE on stdin; that is not our failure.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(options.stdin ?? '')
  })
}
