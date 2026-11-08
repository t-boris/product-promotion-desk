import type { AiTask } from '../core/ports'
import { CliEngine, type CliEngineOptions } from './cli-engine'

/**
 * Claude Code in print mode. The prompt goes to stdin and the answer comes back as plain text.
 * The engine is given NO ability to act: every built-in tool is disabled (`--tools ""`), permission prompts are
 * answered with "deny" (`dontAsk`), MCP servers are ignored and user/project slash commands are off, so it can
 * only produce text. Sending anything is the application's job and always passes the SendGate (REQ-004).
 */
export class ClaudeCodeEngine extends CliEngine {
  readonly id = 'claude' as const
  readonly label = 'Claude Code'
  protected readonly binaryName = 'claude'

  constructor(options: CliEngineOptions = {}) {
    super(options)
  }

  protected buildArgs(task: AiTask): string[] {
    const args = [
      '-p',
      '--output-format',
      'text',
      '--tools',
      '',
      '--permission-mode',
      'dontAsk',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence'
    ]
    if (task.system) args.push('--system-prompt', task.system)
    return args
  }
}
