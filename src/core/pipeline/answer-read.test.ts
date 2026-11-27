// The AI-answer check (DEC-061): what the application works out by itself, and how strictly the engine's answers are read.
import { describe, expect, it } from 'vitest'
import { citedMost, cleanQuestions, hostOf, namedMost, productCited, productNamed, tally } from '../../shared/answer-check'
import { readAnswer, readQuestions } from './answer-check'

describe('what the application works out', () => {
  it('whether the product was named and whether its site was cited', () => {
    expect(productNamed('Natal Mystic', ['Co-Star', 'natal-mystic app'], '')).toBe(true)
    expect(productNamed('Natal Mystic', ['Co-Star'], 'Many people like NatalMystic for this.')).toBe(true)
    expect(productNamed('Natal Mystic', ['Co-Star', 'Mystic Charts'], 'Try a natal chart app.')).toBe(false)
    expect(productNamed('Ab', ['Ab'], 'Ab')).toBe(false)
    expect(productCited('https://www.natalmystic.app/', ['https://natalmystic.app/blog/x', 'https://reddit.com/r/a'])).toBe(true)
    expect(productCited('natalmystic.app', ['https://blog.natalmystic.app/x'])).toBe(true)
    expect(productCited('https://natalmystic.app', ['https://notnatalmystic.app/x'])).toBe(false)
    expect(productCited(null, ['https://natalmystic.app'])).toBe(false)
    expect(hostOf('not a url at all')).toBe(null)
  })

  it('counts answers, the names and the sites named most', () => {
    const results = [
      { state: 'ok' as const, productNamed: true, productCited: false, named: ['Co-Star', 'Natal Mystic'], sources: ['https://www.reddit.com/r/a', 'https://reddit.com/r/b'] },
      { state: 'ok' as const, productNamed: false, productCited: false, named: ['co star', 'Astro.com'], sources: ['https://astro.com/x', 'https://reddit.com/r/c'] },
      { state: 'failed' as const, productNamed: false, productCited: false, named: [], sources: [] }
    ]
    expect(tally(results)).toEqual({ asked: 2, named: 1, cited: 0 })
    expect(namedMost(results)).toEqual([{ name: 'Co-Star', count: 2 }, { name: 'Astro.com', count: 1 }, { name: 'Natal Mystic', count: 1 }])
    expect(citedMost(results)).toEqual([{ host: 'reddit.com', count: 2 }, { host: 'astro.com', count: 1 }])
    expect(cleanQuestions(['  What is   a natal chart? ', '', 'what is a natal chart?', 'Best chart app'])).toEqual(['What is a natal chart?', 'Best chart app'])
  })

  it('reads the engine\'s answers strictly', () => {
    expect(readAnswer({ answer: ' ' })).toMatchObject({ ok: false })
    expect(readAnswer({ answer: 'Try these.', named: ['A', 'A', 7, ' B '], sources: ['https://user:pw@a.test/x', 'javascript:alert(1)', 'nope', 'https://a.test/x'] })).toEqual({ ok: true, value: { answer: 'Try these.', named: ['A', 'B'], sources: ['https://a.test/x'] } })
    expect(readQuestions({ questions: ['one?', 'two?'] })).toMatchObject({ ok: false })
    expect(readQuestions({ questions: ['one?', 'two?', 'three?', 'two?'] })).toEqual({ ok: true, value: ['one?', 'two?', 'three?'] })
  })
})
