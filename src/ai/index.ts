import type { AiEngine } from '../core/ports'
import { ClaudeCodeEngine } from './claude-code'
import type { CliEngineOptions } from './cli-engine'
import { CodexEngine } from './codex'

export { ClaudeCodeEngine } from './claude-code'
export { CodexEngine } from './codex'
export { CliEngine, parseVersion, type CliEngineOptions, type CommandSpec } from './cli-engine'
export { defaultSearchDirs, findExecutable, nvmBinDirs } from './locate'

export interface CreateEnginesOptions {
  claude?: CliEngineOptions
  codex?: CliEngineOptions
}

/** The installed command-line AI engines the user can choose from (Claude Code and Codex). */
export function createEngines(options: CreateEnginesOptions = {}): AiEngine[] {
  return [new ClaudeCodeEngine(options.claude), new CodexEngine(options.codex)]
}
