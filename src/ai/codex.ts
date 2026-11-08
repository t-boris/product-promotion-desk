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
 *
 * An agent mission (`task.agent`, DEC-018) is a different run: FULL ACCESS (`--dangerously-bypass-approvals-and-sandbox`, as MarkView starts
 * its agents; it also lets MCP tools run in exec mode, checked against 0.167) and the application's MCP server given with `-c`. The user's
 * own configuration stays ignored, so their other MCP servers (other browsers) are not loaded.
 *
 * A picture (`task.makeFiles`, DEC-019) runs in the folder named by the caller with `--sandbox workspace-write`: Codex's own image tool
 * (`codex features list`: image_generation, stable) makes the file and writes it there. Checked once with the real CLI (a 1254x1254 PNG in 13k tokens).
 */
export class CodexEngine extends CliEngine {
  readonly id = 'codex' as const
  readonly label = 'Codex'
  readonly toolFree = false
  readonly supportsAgent = true
  readonly makesImages = true
  protected readonly binaryName = 'codex'

  constructor(options: CliEngineOptions = {}) {
    super(options)
  }

  protected override honorsTaskCwd(): boolean {
    return false
  }

  /** A picture is made in the folder the caller names (the only exception to the scratch folder): the sandbox lets it write there. */
  protected override taskCwd(task: AiTask): string | undefined {
    return task.makeFiles?.dir
  }

  protected buildArgs(task: AiTask, cwd: string): string[] {
    if (task.agent) return this.agentArgs(task.agent, cwd)
    return [
      'exec',
      '--sandbox',
      // Making a picture needs to write the file in its folder; everything else may only read.
      task.makeFiles ? 'workspace-write' : 'read-only',
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

  private agentArgs(agent: NonNullable<AiTask['agent']>, cwd: string): string[] {
    // TOML basic strings are JSON strings for everything that can appear in a path, an argument or an environment value.
    const toml = (text: string): string => JSON.stringify(text)
    const env = Object.entries(agent.launch.env).map(([key, value]) => `${key}=${toml(value)}`).join(',')
    const server = `mcp_servers.${agent.server}`
    return [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color',
      'never',
      '--cd',
      cwd,
      '-c',
      `${server}.command=${toml(agent.launch.command)}`,
      '-c',
      `${server}.args=[${agent.launch.args.map(toml).join(',')}]`,
      '-c',
      `${server}.env={${env}}`,
      '-'
    ]
  }

  /** Codex has no separate system-prompt flag in exec mode, so the system text leads the prompt. */
  /**
   * `codex exec` prints its banner and then the whole prompt to stderr before it works; showing those lines would put the prompt on the
   * screen. Only what comes after the prompt is progress: its own messages ("codex"), the commands it runs ("exec") and what they say.
   */
  protected override progressSink(forward: (line: string) => void): (line: string) => void {
    let mode: 'banner' | 'prompt' | 'work' | 'done' = 'banner'
    return (raw) => {
      const line = raw.trim()
      if (mode === 'done') return
      if (mode === 'banner') {
        if (line === 'user') mode = 'prompt'
        return
      }
      if (/^tokens used$/i.test(line)) {
        mode = 'done'
        return
      }
      if (mode === 'prompt') {
        if (!/^(codex|exec|thinking|tool|mcp\b.*)$/i.test(line)) return
        mode = 'work'
      }
      // The answer itself (JSON) is not progress; it is read by the caller.
      if (line === '' || line.startsWith('{') || /^(codex|thinking|tool)$/i.test(line)) return
      forward(line.slice(0, 200))
    }
  }

  protected override buildInput(task: AiTask): string {
    return task.system ? `${task.system}\n\n${task.prompt}` : task.prompt
  }
}
