import { describe, expect, it } from 'vitest'
import type { PassportSection } from '../../shared/types'
import { AiError } from '../ports'
import { askJson, extractJson, JsonExtractError, UnusableAnswerError } from './ai-json'
import { EvidenceTable, finalizeClaims, withPriceBackstop, type EvidenceRef } from './evidence'
import { PRICE_UNKNOWN_TEXT } from './pricing'
import { claimListValidator, validateConflicts } from './validate'
import { ScriptedEngine } from './testkit'

describe('extractJson', () => {
  it('finds the object in plain, fenced and chatty answers', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":{"b":[1,2]}}\n```')).toEqual({ a: { b: [1, 2] } })
    expect(extractJson('Here you go:\n{"a":"} not the end {"}\nHope it helps')).toEqual({ a: '} not the end {' })
  })

  it('reports why an answer cannot be read', () => {
    expect(() => extractJson('no json here')).toThrow(JsonExtractError)
    expect(() => extractJson('{"a":1')).toThrow(/incomplete/)
    expect(() => extractJson('{"a":1,}')).toThrow(/malformed/)
  })
})

describe('validators', () => {
  const validate = claimListValidator('claims')

  it('accepts well-formed claims and normalizes vocabulary and whitespace', () => {
    const result = validate({ claims: [{ section: ' Offer ', kind: 'FACT', text: '  Calculates   charts ', evidence: [' W1 ', ''] }, { section: 'terms', kind: 'unknown', text: '   ' }] })
    expect(result).toEqual({ ok: true, value: [{ section: 'offer', kind: 'fact', text: 'Calculates charts', evidence: ['W1'] }] })
  })

  it('rejects unknown sections and kinds with a message the repair prompt can use', () => {
    expect(validate({ claims: [{ section: 'pricing', kind: 'fact', text: 'x' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/claims\[0\]\.section must be one of identity/) })
    expect(validate({ claims: [{ section: 'offer', kind: 'certain', text: 'x' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/kind must be one of fact, assumption, unknown/) })
    expect(validate({ claims: [{ section: 'offer', kind: 'fact', text: 5 }] })).toMatchObject({ ok: false })
    expect(validate({ claims: [{ section: 'offer', kind: 'fact', text: 'x', evidence: 'W1' }] })).toMatchObject({ ok: false })
    expect(validate({ claims: 'none' })).toMatchObject({ ok: false })
    expect(validate([])).toMatchObject({ ok: false })
  })

  it('reads conflicts and ignores groups that are not really a conflict', () => {
    expect(validateConflicts({ conflicts: [{ claims: ['C1', 'C2'], description: ' differ ' }, { claims: ['C3', 'C3'], description: 'same claim twice' }, { claims: ['C4'], description: 'alone' }] })).toEqual({
      ok: true,
      value: [{ claims: ['C1', 'C2'], description: 'differ' }]
    })
    expect(validateConflicts({ conflicts: [{ claims: ['C1', 'C2'] }] })).toMatchObject({ ok: false })
  })
})

describe('askJson', () => {
  const task = { label: 'unit', prompt: 'give me json' }
  const validator = claimListValidator('claims')
  const good = JSON.stringify({ claims: [{ section: 'offer', kind: 'fact', text: 'x', evidence: [] }] })

  it('retries exactly once, handing the problem back to the engine, then succeeds', async () => {
    const engine = new ScriptedEngine().on('unit', 'sorry, I cannot').on('unit.repair', good)
    const value = await askJson(engine, task, validator)
    expect(value).toHaveLength(1)
    expect(engine.calls.map((c) => c.label)).toEqual(['unit', 'unit.repair'])
    expect(engine.calls[1].prompt).toContain('give me json')
    expect(engine.calls[1].prompt).toContain('sorry, I cannot')
    expect(engine.calls[1].prompt).toContain('no JSON object')
  })

  it('fails readably after a second unusable answer, without a third attempt', async () => {
    const engine = new ScriptedEngine().on('unit', '{"claims":[{"section":"x","kind":"fact","text":"t"}]}')
    const error = await askJson(engine, task, validator).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnusableAnswerError)
    expect((error as Error).message).toMatch(/could not be used/)
    expect(engine.calls).toHaveLength(2)
  })

  it('does not retry engine failures, and an abort surfaces as such', async () => {
    const failing = new ScriptedEngine().on('unit', () => {
      throw new AiError('timeout', 'took too long')
    })
    await expect(askJson(failing, task, validator)).rejects.toMatchObject({ kind: 'timeout' })
    expect(failing.calls).toHaveLength(1)
    const controller = new AbortController()
    controller.abort()
    await expect(askJson(new ScriptedEngine().on('unit', good), task, validator, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('treats an empty or oversized engine output as one repairable problem', async () => {
    let calls = 0
    const engine = new ScriptedEngine().on('unit', () => {
      if (++calls === 1) throw new AiError('invalid_output', 'The engine returned an empty answer')
      return good
    })
    expect(await askJson(engine, task, validator)).toHaveLength(1)
  })
})

describe('evidence: what the AI may claim is limited to what was read', () => {
  const page: EvidenceRef = { sourceId: 's-site', ref: 'https://x.example/', sourceKind: 'url', verifiedAt: '2026-11-08T12:00:00.000Z' }
  const price: EvidenceRef = { sourceId: 's-site', ref: 'https://x.example/pricing', sourceKind: 'url', verifiedAt: '2026-11-08T12:00:00.000Z' }
  const code: EvidenceRef = { sourceId: 's-code', ref: 'src/synastry.ts', sourceKind: 'code_folder', verifiedAt: '2026-11-08T12:00:00.000Z' }
  const table = new EvidenceTable()
  table.add('W1', [page], 'Natal Mystic creates natal charts online.')
  table.add('W2', [price], 'Pro plan: $9 per month. First chart is free.')
  table.add('F1', [code], 'export function synastry() {}')
  const raw = (text: string, evidence: string[], kind: 'fact' | 'assumption' | 'unknown' = 'fact', section: PassportSection = 'offer') => ({ section, kind, text, evidence })

  it('resolves keys case-insensitively, de-duplicates sources and ignores invented keys', () => {
    const { refs } = table.resolve(['w1', 'W1', 'W9'])
    expect(refs).toEqual([page])
  })

  it('keeps a fact with real evidence and demotes one without', () => {
    const { findings, notes } = finalizeClaims([raw('Creates natal charts', ['W1']), raw('Works offline', ['W9']), raw('Supports tarot', [], 'assumption')], table)
    expect(findings.map((f) => [f.text, f.kind, f.evidence.length])).toEqual([
      ['Creates natal charts', 'fact', 1],
      ['Works offline', 'assumption', 0],
      ['Supports tarot', 'assumption', 0]
    ])
    expect(notes[0]).toMatch(/1 statement without a verifiable source was marked as assumptions/)
  })

  it('drops prices and free-of-charge claims that the cited evidence does not contain', () => {
    const { findings, notes } = finalizeClaims(
      [raw('Pro costs $9 per month', ['W2'], 'fact', 'terms'), raw('Pro costs $19 per month', ['W2'], 'fact', 'terms'), raw('Free forever', ['W1'], 'fact', 'terms'), raw('Probably free', [], 'assumption', 'terms')],
      table
    )
    expect(findings.map((f) => f.text)).toEqual(['Pro costs $9 per month'])
    expect(notes.join(' ')).toMatch(/3 price or free-of-charge statements not supported/)
  })

  it('flags capabilities supported only by source code as unconfirmed, but not in other sections', () => {
    const { findings } = finalizeClaims([raw('Supports synastry', ['F1']), raw('Supports synastry too', ['F1', 'W1']), raw('Developer-friendly code', ['F1'], 'fact', 'communication')], table)
    expect(findings.map((f) => f.unconfirmedAvailability)).toEqual([true, false, false])
  })

  it('never attaches sources to assumptions or unknowns, and drops duplicates', () => {
    const { findings } = finalizeClaims([raw('Hobbyists', ['W1'], 'assumption', 'audience'), raw('Hobbyists', ['W1'], 'assumption', 'audience'), raw('Country list missing', ['W1'], 'unknown', 'geo_languages')], table)
    expect(findings).toHaveLength(2)
    expect(findings.every((f) => f.evidence.length === 0 || f.kind === 'assumption')).toBe(true)
    expect(findings.find((f) => f.kind === 'unknown')?.evidence).toEqual([])
  })

  it('states plainly that the price is unknown, unless the passport already covers it', () => {
    const none = withPriceBackstop([], [])
    expect(none).toHaveLength(1)
    expect(none[0]).toMatchObject({ section: 'terms', kind: 'unknown', text: PRICE_UNKNOWN_TEXT, evidence: [] })
    const stated = withPriceBackstop([{ section: 'terms', kind: 'fact', text: 'Pro costs $9 per month', evidence: [price], unconfirmedAvailability: false }], [])
    expect(stated).toHaveLength(1)
    expect(withPriceBackstop([], [{ section: 'terms', kind: 'unknown', text: PRICE_UNKNOWN_TEXT }])).toEqual([])
    // An assumption about the price is not a statement the passport can rely on.
    expect(withPriceBackstop([{ section: 'terms', kind: 'assumption', text: 'Probably free', evidence: [], unconfirmedAvailability: false }], [])).toHaveLength(2)
  })
})
