import { describe, expect, it } from 'vitest'
import { MODEL_NAME_MAX, parseModelName } from './engine-model'

describe('the name of a model', () => {
  it.each(['gpt-5.5', 'claude-opus-5-5', 'opus', 'sonnet', 'claude-sonnet-5-5[1m]', 'us.anthropic.claude-opus-5-5-v1:0', 'o3', 'openai/gpt-5'])('accepts %s', (name) => {
    expect(parseModelName(name)).toBe(name)
  })

  it('trims the spaces around it, and an empty name means the engine\'s own default', () => {
    expect(parseModelName('  opus  ')).toBe('opus')
    expect(parseModelName('')).toBe('')
    expect(parseModelName('   ')).toBe('')
  })

  it.each(['--help', '-m', 'two words', 'a;rm -rf', 'a$(b)', 'name\nnewline', '"quoted"', '../x', '.hidden', 'x'.repeat(MODEL_NAME_MAX + 1)])('refuses %j, so it can never be read as another option or run as a command', (name) => {
    expect(parseModelName(name)).toBeNull()
  })

  it('refuses what is not a string', () => {
    for (const value of [undefined, null, 5, {}, ['opus']]) expect(parseModelName(value)).toBeNull()
  })
})
