// The pure logic of the AI controls of the interface (src/renderer/src/assist): why a help is blocked, which action a field offers,
// when "Undo" is honest, and what an idea panel remembers. The components are checked in the packaged build.

import { describe, expect, it } from 'vitest'
import { assistBlock, type BlockFacts } from '../renderer/src/assist/block'
import { canUndo, fieldAction, ideaButtonLabel, rememberShown } from '../renderer/src/assist/field-logic'
import { suggestionBlock } from '../renderer/src/pages/channels/suggestion-block'

const READY = { id: 'claude', ready: true, detail: 'ok', label: 'Claude Code' }
const base: BlockFacts = { productId: 'p1', needsPassport: false, approved: false, engineId: 'claude', engines: [READY], ready: true }

describe('assistBlock', () => {
  it('asks for the passport only when the help needs it', () => {
    expect(assistBlock(base)).toBeNull()
    expect(assistBlock({ ...base, needsPassport: true })).toMatchObject({ text: 'Approve the product passport first so the suggestions fit it.', fix: { href: '#/products/p1/passport' } })
    expect(assistBlock({ ...base, needsPassport: true, approved: true })).toBeNull()
    expect(assistBlock({ ...base, needsPassport: true, approved: null })).toBeNull()
    expect(assistBlock({ ...base, needsPassport: true, productId: undefined })).toBeNull()
  })

  it('names the engine problem and where to fix it, and waits for what it does not know yet', () => {
    expect(assistBlock({ ...base, engineId: null })).toMatchObject({ text: 'Choose an AI engine in Settings first.', fix: { href: '#/settings' } })
    expect(assistBlock({ ...base, engines: [{ ...READY, ready: false, detail: 'Claude Code was not found.' }] })).toMatchObject({ text: 'Claude Code was not found.' })
    expect(assistBlock({ ...base, engineId: 'codex' })).toMatchObject({ text: 'The selected AI engine is not available. Check it in Settings.' })
    expect(assistBlock({ ...base, engineId: undefined, ready: false })).toBeNull()
  })

  it('keeps the channel helps as they were: the passport is required', () => {
    const facts = { productId: 'p1', approved: false, engineId: 'claude', engines: [READY], ready: true }
    expect(suggestionBlock(facts)).toEqual(assistBlock({ ...facts, needsPassport: true }))
  })
})

describe('fieldAction', () => {
  it('writes an empty field and improves a filled one', () => {
    expect(fieldAction('')).toEqual({ kind: 'write', label: 'Suggest with AI' })
    expect(fieldAction('  \n ')).toEqual({ kind: 'write', label: 'Suggest with AI' })
    expect(fieldAction('Join the waitlist')).toEqual({ kind: 'improve', label: 'Improve with AI' })
  })
})

describe('canUndo', () => {
  it('is honest only while the field holds exactly what the AI wrote', () => {
    const applied = { text: 'AI text', before: 'mine' }
    expect(canUndo('AI text', applied)).toBe(true)
    expect(canUndo('AI text, and more of mine', applied)).toBe(false)
    expect(canUndo('AI text', null)).toBe(false)
  })
})

describe('rememberShown', () => {
  it('keeps the ideas seen, newest last, without repeats, bounded', () => {
    expect(rememberShown([], 'A')).toEqual(['A'])
    expect(rememberShown(['A', 'B'], 'a ')).toEqual(['B', 'a '])
    expect(rememberShown(['A'], '  ')).toEqual(['A'])
    const many = Array.from({ length: 30 }, (_, i) => `idea ${i}`).reduce<string[]>((shown, idea) => rememberShown(shown, idea), [])
    expect(many).toHaveLength(20)
    expect(many[19]).toBe('idea 29')
  })
})

describe('ideaButtonLabel', () => {
  it('asks the first time, offers another one after that, and says it is thinking', () => {
    const words = { ask: 'Suggest a goal with AI', another: 'Another one' }
    expect(ideaButtonLabel({ asking: false, shownBefore: 0, ...words })).toBe('Suggest a goal with AI')
    expect(ideaButtonLabel({ asking: false, shownBefore: 2, ...words })).toBe('Another one')
    expect(ideaButtonLabel({ asking: true, shownBefore: 2, ...words })).toBe('Thinking…')
  })
})
