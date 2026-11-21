import { describe, expect, it } from 'vitest'
import {
  CARD_HEADLINE_MAX,
  CARD_PIXELS,
  CARD_SHAPES,
  DEFAULT_CARD,
  QUICK_PLATFORMS,
  captionLabel,
  cardHeadline,
  headlineFromCaption,
  mixedKindReason,
  parseQuickCard,
  postLabel,
  postTypeOfPlatform
} from './quick-post'

describe('the post type follows the platform (DEC-038)', () => {
  it.each(QUICK_PLATFORMS)('%s makes a quick post', (platform) => {
    expect(postTypeOfPlatform(platform)).toBe('quick')
  })
  it.each(['reddit', 'x', 'linkedin', 'telegram', 'bluesky', ''])('%s makes an article', (platform) => {
    expect(postTypeOfPlatform(platform)).toBe('article')
  })
})

describe('the two kinds of channel are never chosen together (DEC-041)', () => {
  it('lets anything be chosen when nothing is chosen, so clearing every channel enables every channel again', () => {
    for (const platform of ['instagram', 'reddit', 'x']) expect(mixedKindReason(platform, [])).toBeNull()
  })
  it('lets channels of the same kind go together', () => {
    expect(mixedKindReason('threads', ['instagram', 'facebook'])).toBeNull()
    expect(mixedKindReason('reddit', ['x', 'linkedin'])).toBeNull()
  })
  it('refuses the other kind, in words that say which way round', () => {
    expect(mixedKindReason('reddit', ['instagram'])).toMatch(/article and a picture post cannot go together/i)
    expect(mixedKindReason('instagram', ['reddit'])).toMatch(/picture post and an article cannot go together/i)
    expect(mixedKindReason('facebook', ['instagram', 'reddit'])).not.toBeNull()
  })
})

describe('the card parameters that may be stored (DEC-046)', () => {
  const card = { style: 'quote', colour: 'ocean', shape: 'wide', headline: '  Ship it   today ', headlineEdited: true }
  it('keeps a valid card and tidies the headline', () => {
    expect(parseQuickCard(card)).toEqual({ ...card, headline: 'Ship it today' })
  })
  it.each([
    ['not an object', 'bold'],
    ['null', null],
    ['an unknown style', { ...card, style: 'neon' }],
    ['an unknown colour', { ...card, colour: 'pink' }],
    ['an unknown shape', { ...card, shape: 'tall' }],
    ['a headline that is not a text', { ...card, headline: 5 }],
    ['a flag that is not a boolean', { ...card, headlineEdited: 'yes' }],
    ['a headline over the limit', { ...card, headline: 'x'.repeat(CARD_HEADLINE_MAX + 1) }]
  ])('refuses %s', (_name, value) => {
    expect(parseQuickCard(value)).toBeNull()
  })
  it('accepts a headline of exactly the limit and an empty one', () => {
    expect(parseQuickCard({ ...card, headline: 'x'.repeat(CARD_HEADLINE_MAX) })).not.toBeNull()
    expect(parseQuickCard({ ...card, headline: '' })).not.toBeNull()
  })
  it('counts an emoji as one character, like every limit', () => {
    expect(parseQuickCard({ ...card, headline: '🎉'.repeat(CARD_HEADLINE_MAX) })).not.toBeNull()
  })
  it('has a default that is itself valid, and a size for every shape', () => {
    expect(parseQuickCard(DEFAULT_CARD)).toEqual(DEFAULT_CARD)
    for (const shape of CARD_SHAPES) expect(CARD_PIXELS[shape].width).toBeGreaterThan(0)
  })
  it('keeps the two ends of what Instagram takes: 4:5 and 1.91:1', () => {
    expect(CARD_PIXELS.portrait.height / CARD_PIXELS.portrait.width).toBeCloseTo(1.25, 3)
    expect(CARD_PIXELS.wide.width / CARD_PIXELS.wide.height).toBeCloseTo(1.91, 2)
  })
})

describe('the headline follows the first line of the caption until the owner edits it (DEC-045)', () => {
  it('is the first line that has words', () => {
    expect(headlineFromCaption('Launch day\nWe are live')).toBe('Launch day')
    expect(headlineFromCaption('\n\n  Second   line  \nthird')).toBe('Second line')
    expect(headlineFromCaption('   ')).toBe('')
  })
  it('is cut to what a card can show, with an ellipsis', () => {
    const cut = headlineFromCaption('word '.repeat(100))
    expect([...cut].length).toBe(CARD_HEADLINE_MAX)
    expect(cut.endsWith('…')).toBe(true)
  })
  it('follows the caption while headlineEdited is false and stops following once it is true', () => {
    const base = { headline: 'old', headlineEdited: false }
    expect(cardHeadline(base, 'New first line\nmore')).toBe('New first line')
    expect(cardHeadline({ headline: 'Mine', headlineEdited: true }, 'New first line')).toBe('Mine')
    expect(cardHeadline({ headline: 'Mine', headlineEdited: true }, 'Another first line')).toBe('Mine')
  })
})

describe('the name of a post where a title would be (REQ-002)', () => {
  it('is the first words of the caption for a quick post, even when a title is somehow present', () => {
    expect(postLabel({ postType: 'quick', title: null, text: 'One two three four five six seven eight nine ten' })).toBe('One two three four five six seven eight…')
    expect(postLabel({ postType: 'quick', title: 'ignored', text: 'Short caption' })).toBe('Short caption')
    expect(postLabel({ postType: 'quick', title: null, text: '' })).toBe('')
  })
  it('is the title for an article, and the start of its text when it has none', () => {
    expect(postLabel({ postType: 'article', title: 'My notes', text: 'body' })).toBe('My notes')
    expect(postLabel({ postType: 'article', title: '  ', text: 'just words' })).toBe('just words')
  })
  it('keeps short captions whole and collapses whitespace', () => {
    expect(captionLabel('  a   b\nc ')).toBe('a b c')
    expect(captionLabel('a b c d', 3)).toBe('a b c…')
  })
})
