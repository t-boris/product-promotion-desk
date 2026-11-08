// Getting structured data out of a text-only AI engine: the answer is parsed as JSON, checked by a hand-written
// validator and, if it is unusable, the engine gets exactly one repair attempt before the stage fails readably.

import { AiError, type AiEngine, type AiRunOptions, type AiTask } from '../ports'
import { truncate } from './text'

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string }
export type Validator<T> = (raw: unknown) => Validation<T>

export class JsonExtractError extends Error {}

/** The first complete JSON object in a model answer; tolerates code fences and chatter around it. */
export function extractJson(answer: string): unknown {
  const text = answer.replace(/^\uFEFF/, '').trim()
  const fenced = /```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/.exec(text)
  const body = fenced?.[1] ?? text
  const start = body.indexOf('{')
  if (start < 0) throw new JsonExtractError('the answer contains no JSON object')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(body.slice(start, i + 1)) as unknown
      } catch (error) {
        throw new JsonExtractError(`the JSON is malformed (${error instanceof Error ? error.message : 'parse error'})`)
      }
    }
  }
  throw new JsonExtractError('the JSON object is incomplete (it ends before it is closed)')
}

/** Thrown when the engine answered but the answer stayed unusable after the repair attempt. */
export class UnusableAnswerError extends Error {
  constructor(label: string, reason: string) {
    super(`The AI returned an answer for "${label}" that could not be used (${reason}). Run the analysis again, or enter the information manually.`)
    this.name = 'UnusableAnswerError'
  }
}

function repairPrompt(original: AiTask, previous: string, reason: string): AiTask {
  return {
    ...original,
    label: `${original.label}.repair`,
    prompt: [
      original.prompt,
      '',
      '--- Your previous answer could not be used ---',
      `Problem: ${reason}`,
      'Previous answer (truncated):',
      truncate(previous, 3000),
      '',
      'Answer again with ONLY the corrected JSON object. No explanations, no code fences.'
    ].join('\n')
  }
}

/**
 * Runs `task`, parses and validates the JSON answer, and retries once with a repair prompt. Engine failures other than
 * an unusable answer (unavailable, timeout, cancelled, failed) are not retried and propagate as AiError.
 */
export async function askJson<T>(engine: AiEngine, task: AiTask, validate: Validator<T>, options: AiRunOptions = {}): Promise<T> {
  let attempt = task
  let lastReason = ''
  for (let tries = 0; tries < 2; tries++) {
    let answer: string
    try {
      answer = await engine.run(attempt, options)
    } catch (error) {
      if (error instanceof AiError && error.kind === 'invalid_output' && tries === 0) {
        lastReason = error.message
        attempt = repairPrompt(task, '', `${error.message} Reply with a JSON object.`)
        continue
      }
      throw error
    }
    try {
      const result = validate(extractJson(answer))
      if (result.ok) return result.value
      lastReason = result.error
    } catch (error) {
      if (!(error instanceof JsonExtractError)) throw error
      lastReason = error.message
    }
    attempt = repairPrompt(task, answer, lastReason)
    options.onProgress?.('The answer was not in the expected format; asking once more')
  }
  throw new UnusableAnswerError(task.label, lastReason)
}
