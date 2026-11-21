import { AiError, type AiTask } from '../core/ports'
import { parseModelName } from '../shared/engine-model'
import type { EngineModel } from '../shared/types'
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
 * Codex cannot be held to the application's tools (`confinesAgent` is not set): `codex exec --help` (0.169) has no switch that removes the shell
 * or the file tools. `--sandbox` limits what a command may change, not what it may run or read; `--ask-for-approval` is not an `exec` option;
 * `--dangerously-bypass-approvals-and-sandbox` is what lets MCP tools run in `exec` mode at all (checked against 0.167); `-c`/`--disable` take
 * feature names, and `codex features list` has none for the shell. So a confined run is refused here, never run with full access instead. The application
 * does not ask for one: the owner decided on 2026-11-20 that any selected engine may work the browser, and it gives Codex a quiet run (nothing the
 * engine printed goes into an error message) with the access of every agent mission.
 *
 * A web search (`task.search`, the research before a post is written) is the same read-only run with the CLI's global `--search`: the model may search the
 * web and open the pages it finds, and nothing else changes. What it reads is untrusted, so the caller checks the answer before anything is made of it.
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

  /** `codex debug models` renders the model catalog of this account as JSON, offline: the ones with `visibility: "list"` are what Codex itself offers. */
  protected modelsCommand(): { args: string[] } {
    return { args: ['debug', 'models'] }
  }

  protected parseModels(stdout: string): EngineModel[] {
    const catalog = JSON.parse(stdout) as { models?: unknown }
    if (!Array.isArray(catalog.models)) throw new Error('there is no "models" list in its output')
    return (catalog.models as { slug?: unknown; display_name?: unknown; description?: unknown; visibility?: unknown; priority?: unknown }[])
      .filter((entry) => entry.visibility === 'list' && typeof entry.slug === 'string' && parseModelName(entry.slug))
      .sort((a, b) => (typeof a.priority === 'number' ? a.priority : 1e9) - (typeof b.priority === 'number' ? b.priority : 1e9))
      .map((entry) => ({
        id: entry.slug as string,
        label: typeof entry.display_name === 'string' && entry.display_name ? entry.display_name : (entry.slug as string),
        description: typeof entry.description === 'string' ? entry.description : ''
      }))
  }

  protected buildArgs(task: AiTask, cwd: string): string[] {
    if (task.agent?.confined) throw new AiError('unavailable', 'Codex cannot be held to the browser tools alone (it can also run commands and read files), so it does not publish for you.')
    if (task.agent) return this.agentArgs(task.agent, cwd, this.modelArgs(task))
    return [
      // A web search is the CLI's own switch and goes before the subcommand: `codex exec --search` is refused ("unexpected argument"), `codex --search exec` is
      // what runs (Codex 0.171, checked with a real run: the answer came with its sources, and stderr listed "web search: <query>"). It adds the native
      // `web_search` tool, which the model runs on the server: nothing on this computer is read or run for it, and the sandbox below stays read-only.
      ...(task.search ? ['--search'] : []),
      'exec',
      ...this.modelArgs(task),
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

  private agentArgs(agent: NonNullable<AiTask['agent']>, cwd: string, model: string[]): string[] {
    // TOML basic strings are JSON strings for everything that can appear in a path, an argument or an environment value.
    const toml = (text: string): string => JSON.stringify(text)
    const env = Object.entries(agent.launch.env).map(([key, value]) => `${key}=${toml(value)}`).join(',')
    const server = `mcp_servers.${agent.server}`
    return [
      'exec',
      ...model,
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

  /**
   * `codex exec` prints its banner and then the whole prompt to stderr before it works; showing those lines would put the prompt on the
   * screen. Only what comes after the prompt is progress: its own messages ("codex"), the commands it runs ("exec") and what they say.
   * The transcript is made of sections, each opened by a line of its own ("codex", "exec", "thinking", "mcp ...", "web search: ..."). The answer is printed
   * into it too, as pretty-printed JSON over many lines (and so is what a tool returns): a line that opens one (`{`, `[` or a code fence) is the start of
   * data, not of words, and everything up to the next section line is left out. The caller reads the answer from stdout.
   */
  protected override progressSink(forward: (line: string) => void): (line: string) => void {
    return codexProgress(forward)
  }

  protected override buildInput(task: AiTask): string {
    return task.system ? `${task.system}\n\n${task.prompt}` : task.prompt
  }
}

/** The line that opens a section of the transcript `codex exec` prints to stderr: its own words ("codex"), a command ("exec"), a tool call, a search. */
const SECTION_LINE = /^(codex|exec|thinking|tool|mcp\b.*|web search\b.*)$/i

/**
 * What reaches the progress panel from the stderr of `codex exec`, one line at a time: the lines a person means to read (what Codex says, the commands and
 * tools it runs, the searches it makes). Not the banner and the prompt that come before the work, not what comes after "tokens used", and not data: the
 * answer (JSON over many lines) and what a tool returns are in the transcript too, and a fragment of them (`},`, `"title": ...`) says nothing to the owner.
 * A line that opens data (`{`, `[` or a code fence) starts a stretch that runs to the next section line. Pure: the lines go to `forward`.
 */
export function codexProgress(forward: (line: string) => void): (line: string) => void {
  let mode: 'banner' | 'prompt' | 'work' | 'done' = 'banner'
  let data = false
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
      if (!SECTION_LINE.test(line)) return
      mode = 'work'
    }
    if (SECTION_LINE.test(line)) data = false
    else if (data) return
    if (/^[{[]/.test(line) || line.startsWith('```')) {
      data = true
      return
    }
    // "web search:" with no query is only the start of a search; the line that names what is searched for is the progress.
    if (line === '' || /^(codex|thinking|tool)$/i.test(line) || /^web search:?$/i.test(line)) return
    forward(line.slice(0, 200))
  }
}
