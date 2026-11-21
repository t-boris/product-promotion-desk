import { describe, expect, it } from 'vitest'
import { PICTURE_RULES, pictureProblems, pictureRulesText, type PictureFacts } from './post-pictures'
import { CARD_PIXELS } from './quick-post'

const MB = 1024 * 1024
const png = (width: number | null, height: number | null, bytes: number | null = 100_000): PictureFacts => ({ mime: 'image/png', bytes, width, height })

describe('what a platform takes of a picture (the table the approval, the gate, the groups and the composer read)', () => {
  it('has a row for each platform of the quick-post composer, and no opinion about any other', () => {
    expect(Object.keys(PICTURE_RULES).sort()).toEqual(['facebook', 'instagram', 'threads'])
    for (const platform of ['reddit', 'x', 'linkedin', 'telegram', 'pinterest', 'unknown-site']) expect(pictureProblems(platform, { mime: 'image/webp', bytes: 99 * MB, width: 1, height: 9999 })).toEqual([])
  })

  it('takes every shape the card renderer draws, on every platform', () => {
    for (const platform of Object.keys(PICTURE_RULES)) {
      for (const [shape, { width, height }] of Object.entries(CARD_PIXELS)) expect(pictureProblems(platform, png(width, height)), `${platform} ${shape}`).toEqual([])
    }
  })

  it.each([
    // Instagram: 4:5 (0.8) to 1.91:1, half a percent of slack at each end
    ['instagram', 1080, 1350, true],
    ['instagram', 1080, 566, true],
    ['instagram', 1080, 1080, true],
    ['instagram', 1080, 565, true],
    ['instagram', 1080, 1356, true],
    ['instagram', 1080, 1357, false],
    ['instagram', 1080, 560, false],
    ['instagram', 1, 1, true],
    ['instagram', 1000, 2000, false],
    ['instagram', 4000, 1000, false],
    // Threads: 10:1 either way
    ['threads', 1000, 100, true],
    ['threads', 100, 1000, true],
    ['threads', 1000, 99, false],
    ['threads', 99, 1000, false],
    // Facebook: any shape
    ['facebook', 5000, 10, true],
    ['facebook', 10, 5000, true]
  ] as const)('%s takes %i × %i: %s', (platform, width, height, fits) => {
    expect(pictureProblems(platform, png(width, height)).length === 0).toBe(fits)
  })

  it('says the shape in words, with the end of the range, and the pixels the picture has', () => {
    expect(pictureProblems('instagram', png(1000, 2000))).toEqual(['The picture is 1000 × 2000 pixels, taller than Instagram takes (down to 4:5), which would crop it. Use a picture inside that shape.'])
    expect(pictureProblems('instagram', png(3000, 1000))).toEqual(['The picture is 3000 × 1000 pixels, wider than Instagram takes (up to 1.91:1), which would crop it. Use a picture inside that shape.'])
  })

  it('does not judge a shape nobody knows: no header, 0 × 0, or only one side', () => {
    expect(pictureProblems('instagram', png(null, null))).toEqual([])
    expect(pictureProblems('instagram', png(0, 0))).toEqual([])
    expect(pictureProblems('instagram', png(1080, 0))).toEqual([])
    expect(pictureProblems('instagram', png(0, 1080))).toEqual([])
    expect(pictureProblems('instagram', png(1080, null))).toEqual([])
  })

  it.each([
    ['instagram', 'image/png', true],
    ['instagram', 'image/jpeg', true],
    ['instagram', 'image/gif', false],
    ['instagram', 'image/webp', false],
    ['threads', 'image/png', true],
    ['threads', 'image/jpeg', true],
    ['threads', 'image/gif', false],
    ['threads', 'image/webp', false],
    ['facebook', 'image/png', true],
    ['facebook', 'image/jpeg', true],
    ['facebook', 'image/gif', true],
    ['facebook', 'image/webp', false]
  ] as const)('%s takes a %s: %s', (platform, mime, fits) => {
    expect(pictureProblems(platform, { mime, bytes: 1000, width: 1080, height: 1080 }).length === 0).toBe(fits)
  })

  it('names the type and the types that are taken; an unknown type (the draft did not record one) is not judged by it', () => {
    expect(pictureProblems('threads', { mime: 'image/webp', bytes: 1000, width: 1080, height: 1080 })).toEqual(['Threads takes PNG or JPEG pictures; this one is WebP. Use one of those.'])
    expect(pictureProblems('facebook', { mime: 'image/webp', bytes: 1000, width: 1080, height: 1080 })).toEqual(['Facebook takes PNG, JPEG or GIF pictures; this one is WebP. Use one of those.'])
    expect(pictureProblems('threads', { mime: '', bytes: null, width: null, height: null })).toEqual([])
  })

  it('limits the size where the platform sets one: 8 MB on Instagram and Threads, none known on Facebook', () => {
    expect(pictureProblems('instagram', png(1080, 1080, 8 * MB))).toEqual([])
    expect(pictureProblems('instagram', png(1080, 1080, 8 * MB + 1))).toEqual(['The picture is 8 MB; Instagram takes up to 8 MB. Use a smaller one.'])
    expect(pictureProblems('threads', png(1080, 1080, 9.5 * MB))).toEqual(['The picture is 9.5 MB; Threads takes up to 8 MB. Use a smaller one.'])
    expect(pictureProblems('facebook', png(1080, 1080, 10 * MB))).toEqual([])
    expect(pictureProblems('instagram', png(1080, 1080, null))).toEqual([])
  })

  it('says every thing that is wrong, not only the first', () => {
    expect(pictureProblems('instagram', { mime: 'image/webp', bytes: 9 * MB, width: 1000, height: 3000 })).toHaveLength(3)
  })

  it('writes one line for the composer from the same table', () => {
    expect(pictureRulesText('instagram')).toBe('Instagram takes PNG or JPEG pictures, up to 8 MB, from 4:5 (tall) to 1.91:1 (wide).')
    expect(pictureRulesText('threads')).toBe('Threads takes PNG or JPEG pictures, up to 8 MB, from 1:10 (tall) to 10:1 (wide).')
    expect(pictureRulesText('facebook')).toBe('Facebook takes PNG, JPEG or GIF pictures.')
    expect(pictureRulesText('reddit')).toBeNull()
  })
})
