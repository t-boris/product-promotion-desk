// The pure logic of the AI controls of the interface (src/renderer/src/assist): why a help is blocked, which action a field offers,
// when "Undo" is honest, and what an idea panel remembers. The components are checked in the packaged build.

import { describe, expect, it } from 'vitest'
import { assistBlock, type BlockFacts } from '../renderer/src/assist/block'
import { answerFate, canApply, canUndo, fieldAction, ideaButtonLabel, rememberShown, skippedNote } from '../renderer/src/assist/field-logic'
import { suggestionBlock } from '../renderer/src/pages/channels/suggestion-block'
import { around, fieldsFromIdea, hasText } from '../renderer/src/pages/products/goal-ideas'
import { applySiteProposal, proposalFits, siteProposalNote } from '../renderer/src/pages/products/site-proposal'
import { canApplyPost, postAnswerFate, postFormEmpty, postUndoable, showPostHelper } from '../renderer/src/pages/review/post-draft'

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

describe('answerFate: an answer that arrives after the owner moved on', () => {
  const asked = { value: 'Weekly update', around: '["ch1","I work on Natal Mystic."]' }
  const now = { ...asked, locked: false }

  it('applies when nothing moved', () => {
    expect(answerFate(asked, now)).toBe('apply')
    expect(skippedNote('apply')).toBeNull()
  })

  it('lets the owner\'s typing in the field itself win', () => {
    expect(answerFate(asked, { ...now, value: 'Weekly update!' })).toBe('typed')
  })

  it('drops an answer checked against another field or another channel that has changed since (the title answer read the old text, the text answer the old title)', () => {
    expect(answerFate(asked, { ...now, around: '["ch1","text without the disclosure"]' })).toBe('draft_changed')
    expect(answerFate(asked, { ...now, around: '["ch2","I work on Natal Mystic."]' })).toBe('draft_changed')
  })

  it('drops an answer that lands while the form is being saved', () => {
    expect(answerFate(asked, { ...now, locked: true })).toBe('locked')
  })

  it('says typing first when both happened, and a field with nothing around it never reports a change there', () => {
    expect(answerFate(asked, { ...now, value: 'x', around: 'other', locked: true })).toBe('typed')
    expect(answerFate({ value: 'a', around: null }, { value: 'a', around: null, locked: false })).toBe('apply')
  })

  it('tells the owner why, in words that name what happened', () => {
    expect(skippedNote('typed')).toMatch(/You changed the text/)
    expect(skippedNote('typed', 'post')).toMatch(/title or the text.*its post/)
    expect(skippedNote('draft_changed')).toMatch(/other field or the channel/)
    expect(skippedNote('locked')).toMatch(/being saved/)
  })
})

describe('postAnswerFate: the AI\'s whole post when it arrives', () => {
  const asked = { title: '', text: '', channelId: 'ch1' }

  it('applies into the form it was asked for', () => {
    expect(postAnswerFate(asked, { ...asked })).toBe('apply')
  })

  it('lets typing win, and does not put a post written for one channel into a form that now points at another', () => {
    expect(postAnswerFate(asked, { ...asked, title: 'Mine' })).toBe('typed')
    expect(postAnswerFate(asked, { ...asked, channelId: 'ch2' })).toBe('channel')
    expect(postAnswerFate(asked, { title: 'Mine', text: '', channelId: 'ch2' })).toBe('typed')
  })
})

describe('assistBlock for a control repeated on every open card', () => {
  it('only says that no engine is chosen; it does not judge whether the chosen one is ready', () => {
    const notReady = { ...base, checkReady: false, engines: undefined }
    expect(assistBlock(notReady)).toBeNull()
    expect(assistBlock({ ...notReady, engineId: null })).toMatchObject({ text: 'Choose an AI engine in Settings first.' })
    // Without the option the same facts do block: the engine list is missing, so the engine is not known to be ready.
    expect(assistBlock({ ...base, engines: undefined })).not.toBeNull()
    expect(assistBlock({ ...base, engines: [{ ...READY, ready: false, detail: 'Claude Code was not found.' }], checkReady: false })).toBeNull()
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

describe('canApply', () => {
  it('puts the AI text into a field only if the owner did not type while it worked', () => {
    expect(canApply('shorten this', 'shorten this')).toBe(true)
    expect(canApply('shorten this', 'shorten this one')).toBe(false)
    expect(canApply('', 'typed meanwhile')).toBe(false)
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

describe('goal ideas and the goal form', () => {
  const idea = { targetAction: 'Create the first natal chart', successMetrics: ['charts created', 'replies'], reason: 'It takes a minute.' }

  it('an idea fills the target action and the metrics, one per line, and leaves the notes to the owner', () => {
    expect(fieldsFromIdea(idea)).toEqual({ targetAction: 'Create the first natal chart', metrics: 'charts created\nreplies', notes: '' })
    expect(fieldsFromIdea({ ...idea, successMetrics: [] }).metrics).toBe('')
  })

  it('knows whether the owner has written anything', () => {
    expect(hasText({ targetAction: '', metrics: '  ', notes: '\n' })).toBe(false)
    expect(hasText({ targetAction: '', metrics: '', notes: 'a note' })).toBe(true)
  })

  it('shows the AI the other filled fields of the form, not the one it works on', () => {
    const fields = { targetAction: 'Join the waitlist', metrics: '', notes: 'By May' }
    expect(around(fields, 'targetAction')).toEqual([{ label: 'Notes', text: 'By May' }])
    expect(around(fields, 'metrics')).toEqual([
      { label: 'Target action', text: 'Join the waitlist' },
      { label: 'Notes', text: 'By May' }
    ])
  })
})

describe('fill from the website', () => {
  const proposal = { name: 'Natal Mystic', description: 'Makes birth chart reports.', websiteUrl: 'https://natal.example.com/' }

  it('fills the empty fields and normalizes the address', () => {
    const applied = applySiteProposal({ name: '', websiteUrl: 'natal.example.com', description: ' ' }, proposal)
    expect(applied.form).toEqual({ name: 'Natal Mystic', websiteUrl: 'https://natal.example.com/', description: 'Makes birth chart reports.' })
    expect(applied.filled).toEqual(['name', 'description'])
    expect(siteProposalNote(applied)).toBe('Filled the name and the description from the site. Check them before you create the product.')
  })

  it('uses a proposal only for the address it was read from', () => {
    expect(proposalFits('natal.example.com', ' natal.example.com ')).toBe(true)
    expect(proposalFits('natal.example.com', 'natal.example.org')).toBe(false)
  })

  it('never replaces what the owner typed', () => {
    const applied = applySiteProposal({ name: 'My product', websiteUrl: 'natal.example.com', description: '' }, proposal)
    expect(applied.form.name).toBe('My product')
    expect(applied.form.description).toBe('Makes birth chart reports.')
    expect(applied.kept).toEqual(['name'])
    expect(siteProposalNote(applied)).toBe('Filled the description from the site, and kept your name. Check it before you create the product.')
    const none = applySiteProposal({ name: 'A', websiteUrl: 'x.test', description: 'B' }, proposal)
    expect(none.form).toMatchObject({ name: 'A', description: 'B' })
    expect(siteProposalNote(none)).toBe('Kept what you wrote. Clear a field to let the site fill it.')
  })
})

describe('"Draft with AI" for a new publication', () => {
  const none = { title: '', text: '' }
  const wrote = { title: 'How a chart is built', text: 'It needs a birth date.' }

  it('is offered while the title and the text are both empty, and not once the owner has written something', () => {
    expect(postFormEmpty(none)).toBe(true)
    expect(postFormEmpty({ title: '  ', text: '\n' })).toBe(true)
    expect(postFormEmpty({ title: 'T', text: '' })).toBe(false)
    expect(postFormEmpty({ title: '', text: 'x' })).toBe(false)
  })

  it('puts the AI\'s post in only if neither field changed while it worked (typing wins)', () => {
    expect(canApplyPost(none, none)).toBe(true)
    expect(canApplyPost(none, { title: 'T', text: '' })).toBe(false)
    expect(canApplyPost(none, { title: '', text: 'x' })).toBe(false)
  })

  it('offers Undo only while both fields hold exactly what the AI wrote', () => {
    expect(postUndoable(wrote, wrote)).toBe(true)
    expect(postUndoable({ ...wrote, text: `${wrote.text} More.` }, wrote)).toBe(false)
    expect(postUndoable({ ...wrote, title: 'Mine' }, wrote)).toBe(false)
    expect(postUndoable(wrote, null)).toBe(false)
  })

  it('stays on the screen while it is offered or while its note and Undo are', () => {
    expect(showPostHelper(none, null)).toBe(true)
    expect(showPostHelper(wrote, wrote)).toBe(true)
    expect(showPostHelper(wrote, null)).toBe(false)
    expect(showPostHelper({ ...wrote, text: 'edited' }, wrote)).toBe(false)
  })
})
