import { AiError, type AiTask } from '../core/ports'
import { parseModelName } from '../shared/engine-model'
import type { EngineModel } from '../shared/types'
import { CliEngine, type CliEngineOptions } from './cli-engine'

/**
 * What a web search may use, and nothing else: the search and the reading of a page. Checked with a real run (Claude Code 2.1.330, `-p` with
 * `--tools WebSearch,WebFetch --permission-mode dontAsk --allowedTools ...`): it found and opened pages and answered with their addresses. `--tools` names
 * the only built-in tools there are, `--allowedTools` lets them run without a question, and `dontAsk` refuses anything else. Without a search the run has
 * no tool at all (`--tools ""`), and `toolFree` is about that run: a search run is never one that answers comments on its own.
 */
const SEARCH_TOOLS = 'WebSearch,WebFetch'

/** A server name that is one entry of an allow-list: a space or a comma would make it several, a wildcard would make it more. */
const PLAIN_SERVER_NAME = /^[A-Za-z0-9_-]+$/

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
 *
 * The post mission (`task.agent.confined`) publishes for the owner, and what the engine reads on the pages is untrusted: there the engine has
 * NO power but the application's tools. Three flags, each checked against `claude --help` and by a real run (Claude Code 2.1.325, a stand-in
 * MCP server in an empty folder, the init event of `--output-format stream-json --verbose`):
 *  - `--tools ""` removes every built-in tool (the init event listed only `mcp__<server>__<tool>`). It is the one that matters: in
 *    `dontAsk` mode alone `ls` and a read of a file in the folder still ran, because read-only tools need no approval;
 *  - `--allowedTools mcp__<server>` allows the tools of the application's server and nothing else: without it `dontAsk` denied the toolbox too;
 *  - `--permission-mode dontAsk` denies whatever is not allowed, so a tool a future version adds despite `--tools ""` is refused, not asked.
 * `--dangerously-skip-permissions` is not given. These flags and `confinesAgent` must change together.
 */
export class ClaudeCodeEngine extends CliEngine {
  readonly id = 'claude' as const
  readonly label = 'Claude Code'
  readonly toolFree = true
  readonly supportsAgent = true
  readonly confinesAgent = true
  protected readonly binaryName = 'claude'

  constructor(options: CliEngineOptions = {}) {
    super(options)
  }

  /**
   * Claude Code has no command that lists models, but the protocol the Agent SDK speaks answers `initialize` with the models of this account
   * (`models`: value, displayName, description). With no user message nothing is sent to a model, so it costs nothing and takes under a second.
   * `--setting-sources ""` keeps the owner's own settings out of it.
   */
  protected modelsCommand(): { args: string[]; stdin: string } {
    return {
      args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--tools', '', '--setting-sources', ''],
      stdin: `${JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } })}\n`
    }
  }

  protected parseModels(stdout: string): EngineModel[] {
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('{')) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const models = (message as { type?: string; response?: { response?: { models?: unknown } } }).type === 'control_response' ? (message as { response?: { response?: { models?: unknown } } }).response?.response?.models : undefined
      if (!Array.isArray(models)) continue
      return models.flatMap((entry: { value?: unknown; displayName?: unknown; description?: unknown }) => {
        // "default" is no choice of its own: it is the engine's own default, which the application's first option already is.
        if (typeof entry.value !== 'string' || entry.value === 'default' || !parseModelName(entry.value)) return []
        return [{ id: entry.value, label: typeof entry.displayName === 'string' && entry.displayName ? entry.displayName : entry.value, description: typeof entry.description === 'string' ? entry.description : '' }]
      })
    }
    throw new Error('there was no answer to "initialize" in its output')
  }

  protected buildArgs(task: AiTask): string[] {
    if (task.agent) {
      const config = { mcpServers: { [task.agent.server]: { command: task.agent.launch.command, args: task.agent.launch.args, env: task.agent.launch.env } } }
      const args = ['-p', '--output-format', 'text', ...this.modelArgs(task), ...this.accessFlags(task.agent), '--disable-slash-commands', '--no-session-persistence']
      if (task.system) args.push('--system-prompt', task.system)
      return [...args, '--strict-mcp-config', '--mcp-config', JSON.stringify(config)]
    }
    const args = [
      '-p',
      '--output-format',
      'text',
      ...this.modelArgs(task),
      // A web search gives the engine the search and the reading of a page, and nothing else (no shell, no files, no other tool); otherwise no tool at all.
      '--tools',
      task.search ? SEARCH_TOOLS : '',
      '--permission-mode',
      'dontAsk',
      ...(task.search ? ['--allowedTools', SEARCH_TOOLS] : []),
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence'
    ]
    if (task.system) args.push('--system-prompt', task.system)
    return args
  }

  /** What the engine may do besides calling the application's tools: everything (DEC-018), or, for a confined run, nothing at all. */
  private accessFlags(agent: NonNullable<AiTask['agent']>): string[] {
    if (!agent.confined) return ['--dangerously-skip-permissions']
    if (!PLAIN_SERVER_NAME.test(agent.server)) throw new AiError('failed', 'The name of the tool server is not a plain name, so the engine cannot be held to its tools.')
    return ['--tools', '', '--permission-mode', 'dontAsk', '--allowedTools', `mcp__${agent.server}`]
  }
}
