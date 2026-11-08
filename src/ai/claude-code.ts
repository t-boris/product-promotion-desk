import type { AiTask } from '../core/ports'
import { CliEngine, type CliEngineOptions } from './cli-engine'

/**
 * Claude Code in print mode. The prompt goes to stdin and the answer comes back as plain text.
 * The engine is given NO ability to act: every built-in tool is disabled (`--tools ""`), permission prompts are
 * answered with "deny" (`dontAsk`), MCP servers are ignored and user/project slash commands are off, so it can
 * only produce text. Sending anything is the application's job and always passes the SendGate (REQ-004).
 *
 * toolFree is true because of those flags, checked against `claude --help` ("--tools \"\"" disables all built-in
 * tools; "--strict-mcp-config" with no "--mcp-config" loads no MCP server) and against the real CLI: its stream-json
 * init event listed tools=[], mcp_servers=[], skills=[] and slash_commands=[] for exactly this argument list. The
 * listed agents are not callable because the tool that starts them is among the disabled built-ins. A future CLI
 * version that changed these flags would invalidate this claim, so the flags and this value must change together.
 */
export class ClaudeCodeEngine extends CliEngine {
  readonly id = 'claude' as const
  readonly label = 'Claude Code'
  readonly toolFree = true
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
