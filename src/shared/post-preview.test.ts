import { describe, expect, it } from 'vitest'
import { PREVIEW_PLATFORMS, counterFor, fold, initialOf, previewKind, sketchNote, visiblePictures, whereLine } from './post-preview'

describe('which sketch a platform gets', () => {
  it('draws each platform the way it lays a post out, and a site it does not know as plain', () => {
    expect(['reddit', 'instagram', 'facebook', 'linkedin', 'threads', 'x', 'telegram', 'some-forum'].map(previewKind)).toEqual(['reddit', 'instagram', 'feed', 'feed', 'short', 'short', 'chat', 'plain'])
  })

  it('offers every platform with its own sketch, once, by name', () => {
    expect(PREVIEW_PLATFORMS.map((p) => p.label)).toEqual(['Reddit', 'Instagram', 'Facebook', 'Threads', 'X', 'LinkedIn', 'Telegram'])
    expect(new Set(PREVIEW_PLATFORMS.map((p) => p.platform)).size).toBe(PREVIEW_PLATFORMS.length)
  })
})

describe('what folds behind "more"', () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')

  it('folds an Instagram caption on a word, and keeps every character of it', () => {
    const { shown, hidden } = fold(words, 'instagram')
    expect(shown.length).toBeLessThanOrEqual(125)
    expect(shown.length).toBeGreaterThan(60)
    expect(`${shown} ${hidden}`).toBe(words)
    expect(shown.endsWith(' ')).toBe(false)
  })

  it('does not fold a caption that fits, nor the text of a platform that does not fold', () => {
    expect(fold('short caption', 'instagram')).toEqual({ shown: 'short caption', hidden: '' })
    expect(fold(words, 'feed')).toEqual({ shown: words, hidden: '' })
    expect(fold(words, 'reddit').hidden).toBe('')
  })

  it('cuts at the limit when a caption has no space to fall on', () => {
    const { shown, hidden } = fold('x'.repeat(300), 'instagram')
    expect(shown).toHaveLength(125)
    expect(hidden).toHaveLength(175)
  })
})

describe('the pictures a sketch draws', () => {
  it('draws one on Instagram (a carousel counts the rest), five in a feed, four in a short post, and all on Reddit', () => {
    expect(visiblePictures('instagram', 4)).toEqual({ shown: 1, more: 3 })
    expect(visiblePictures('feed', 8)).toEqual({ shown: 5, more: 3 })
    expect(visiblePictures('short', 6)).toEqual({ shown: 4, more: 2 })
    expect(visiblePictures('reddit', 8)).toEqual({ shown: 8, more: 0 })
    expect(visiblePictures('feed', 0)).toEqual({ shown: 0, more: 0 })
  })
})

describe('the count against the limit', () => {
  it('counts what the platform will see against what it allows, and says when it is over', () => {
    expect(counterFor('threads', 'x'.repeat(499))).toEqual({ label: '499 / 500', over: false })
    expect(counterFor('threads', 'x'.repeat(501))).toEqual({ label: '501 / 500', over: true })
    expect(counterFor('x', 'a')).toEqual({ label: '1 / 280', over: false })
    expect(counterFor('instagram', 'x'.repeat(1820))).toEqual({ label: '1,820 / 2,200', over: false })
  })

  it('counts a character, not a code unit, so an emoji is one', () => {
    expect(counterFor('x', '😀😀')?.label).toBe('2 / 280')
  })

  it('says nothing for a site that has no limit', () => {
    expect(counterFor('some-forum', 'words')).toBeNull()
  })
})

describe('the name above a post', () => {
  it('takes the first letter or digit of the name, whatever is in front of it', () => {
    expect(initialOf('selena')).toBe('S')
    expect(initialOf('@selena.m')).toBe('S')
    expect(initialOf('')).toBe('?')
    expect(initialOf('  ')).toBe('?')
  })

  it('names the community on Reddit and only the account elsewhere', () => {
    expect(whereLine('reddit', 'r/astrology', 'selena')).toBe('r/astrology · selena')
    expect(whereLine('reddit', '', 'selena')).toBe('selena')
    expect(whereLine('instagram', 'https://instagram.com/x', 'selena')).toBe('selena')
  })

  it('says whose sketch it is when it is not the channel\'s own platform', () => {
    expect(sketchNote('reddit', 'reddit')).toMatch(/lays the post out/)
    expect(sketchNote('instagram', 'reddit')).toMatch(/would read on Instagram\. This channel is on Reddit/)
  })
})
