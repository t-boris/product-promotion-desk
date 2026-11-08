import type { AiTask } from '../core/ports'
import { CliEngine, type CliEngineOptions } from './cli-engine'

/**
 * Codex in non-interactive `exec` mode. The prompt goes to stdin (`-`) and the final message is printed to stdout.
 * The engine can only read: the sandbox is read-only, and the user's Codex configuration (which could define MCP
 * servers or other tools able to act) is ignored. Authentication still comes from CODEX_HOME.
 *
 * toolFree is false: `codex exec --help` offers no switch that removes the agent's tools. `--sandbox read-only` only
 * limits what a shell command may change; the model can still run commands that read any file the user can read,
 * and `--disable <FEATURE>` / `-c` need feature names we cannot enumerate or verify. Until Codex can run with no
 * tools at all, it must not answer untrusted text (comments) automatically. As damage control it always runs in a
 * fresh empty scratch directory (a caller-supplied cwd is ignored), never in the user's home or a project.
 */
export class CodexEngine extends CliEngine {
  readonly id = 'codex' as const
  readonly label = 'Codex'
  readonly toolFree = false
  protected readonly binaryName = 'codex'

  constructor(options: CliEngineOptions = {}) {
    super(options)
  }

  protected override honorsTaskCwd(): boolean {
    return false
  }

  protected buildArgs(_task: AiTask, cwd: string): string[] {
    return [
      'exec',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color',
      'never',
      '--cd',
      cwd,
      '-'
    ]
  }

  /** Codex has no separate system-prompt flag in exec mode, so the system text leads the prompt. */
  protected override buildInput(task: AiTask): string {
    return task.system ? `${task.system}\n\n${task.prompt}` : task.prompt
  }
}
