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
 *
 * An agent mission (`task.agent`, DEC-018) is a different run: the engine gets FULL ACCESS (`--dangerously-skip-permissions`, as MarkView
 * starts its agents) and only the application's MCP server (`--strict-mcp-config`, so the owner's other servers, among them other
 * browsers, are not loaded). `--mcp-config` takes several values, so it is the last option; the goal goes on stdin.
 */
export class ClaudeCodeEngine extends CliEngine {
  readonly id = 'claude' as const
  readonly label = 'Claude Code'
  readonly toolFree = true
  readonly supportsAgent = true
  protected readonly binaryName = 'claude'

  constructor(options: CliEngineOptions = {}) {
    super(options)
  }

  protected buildArgs(task: AiTask): string[] {
    if (task.agent) {
      const config = { mcpServers: { [task.agent.server]: { command: task.agent.launch.command, args: task.agent.launch.args, env: task.agent.launch.env } } }
      const args = ['-p', '--output-format', 'text', '--dangerously-skip-permissions', '--disable-slash-commands', '--no-session-persistence']
      if (task.system) args.push('--system-prompt', task.system)
      return [...args, '--strict-mcp-config', '--mcp-config', JSON.stringify(config)]
    }
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
