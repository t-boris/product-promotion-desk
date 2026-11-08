import type { AiTask } from '../core/ports'
import { CliEngine, type CliEngineOptions } from './cli-engine'

/**
 * Codex in non-interactive `exec` mode. The prompt goes to stdin (`-`) and the final message is printed to stdout.
 * The engine can only read: the sandbox is read-only, and the user's Codex configuration (which could define MCP
 * servers or other tools able to act) is ignored. Authentication still comes from CODEX_HOME.
 */
export class CodexEngine extends CliEngine {
  readonly id = 'codex' as const
  readonly label = 'Codex'
  protected readonly binaryName = 'codex'

  constructor(options: CliEngineOptions = {}) {
    super(options)
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
