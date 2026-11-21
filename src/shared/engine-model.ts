// The name of a model an AI engine is asked for (`claude --model`, `codex --model`). The name is handed to the engine's command line, so it is a plain
// name only: letters, digits and . _ : / [ ] -, no spaces, and never one that starts with a dash (it would be read as another option).

export const MODEL_NAME_MAX = 80

const PLAIN_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]*$/

/** The name without the spaces around it, or null when it cannot be a model name. An empty name is valid: it means the engine's own default. */
export function parseModelName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name === '') return ''
  return name.length <= MODEL_NAME_MAX && PLAIN_MODEL.test(name) ? name : null
}
