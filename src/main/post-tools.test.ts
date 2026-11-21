// What the tools of a post of the Feed (Explain, Read the post, Translate) say and choose, and the words of the tags card. All of it is pure: the reading
// language the owner picked and where it is kept, what a translated post shows in place of the original, the wish a reply is opened with, and the lines
// the tags tab writes. Tested here because the renderer has no test runner of its own.

import { describe, expect, it } from 'vitest'
import { DEFAULT_READING_LANGUAGE, READING_LANGUAGES, readingLanguage } from '../shared/reading-language'
import type { FindingComment, FindingTranslation, TagStat } from '../shared/types'
import {
  READING_LANGUAGE_KEY,
  ASSIST_STALE,
  BODY_NONE,
  BODY_UNREAD,
  WISH_MAX,
  angleWhere,
  anglePlace,
  angleWish,
  assistLine,
  basisLabel,
  bodyShown,
  bodyState,
  createLanguageStore,
  explainPhase,
  rememberLanguage,
  storedLanguage,
  threadShown,
  titleShown,
  translationLine,
  type LanguageStorage
} from '../renderer/src/pages/feed/post-tools'
import { dailyDescription, dailyValues, tagFilterLine, tagsBasis, tagsIntro, untaggedLine } from '../renderer/src/pages/feed/tags-card'

function memory(initial: Record<string, string> = {}): LanguageStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) }
}

const comment = (position: number, over: Partial<FindingComment> = {}): FindingComment => ({ position, author: `user${position}`, text: `Text ${position}`, depth: 0, url: '', ...over }) as FindingComment

const translation = (over: Partial<FindingTranslation> = {}): FindingTranslation => ({
  language: 'Russian',
  title: 'Лучшие приложения для карты',
  body: 'Первый абзац.\n\nВторой абзац.',
  comments: [{ position: 1, text: 'Текст 1' }],
  at: '2026-11-21T08:00:00.000Z',
  stale: false,
  ...over
})

describe('the reading language', () => {
  it('is one of ten, Russian first and the default', () => {
    expect(READING_LANGUAGES).toHaveLength(10)
    expect(READING_LANGUAGES[0]).toBe('Russian')
    expect(DEFAULT_READING_LANGUAGE).toBe('Russian')
    for (const language of ['English', 'Ukrainian', 'Spanish', 'German', 'French', 'Portuguese', 'Italian', 'Turkish', 'Polish']) expect(READING_LANGUAGES).toContain(language)
  })

  it('is read from what was typed or kept, whatever its case or spacing, and from nothing else', () => {
    expect(readingLanguage('german')).toBe('German')
    expect(readingLanguage('  FRENCH ')).toBe('French')
    expect(readingLanguage('Klingon')).toBeNull()
    expect(readingLanguage('')).toBeNull()
    expect(readingLanguage(null)).toBeNull()
    expect(readingLanguage(undefined)).toBeNull()
    expect(readingLanguage(7)).toBeNull()
  })

  it('is remembered across windows, and Russian while nothing (or something that is not a language) is kept', () => {
    expect(storedLanguage(undefined)).toBe('Russian')
    expect(storedLanguage(memory())).toBe('Russian')
    expect(storedLanguage(memory({ [READING_LANGUAGE_KEY]: 'Klingon' }))).toBe('Russian')
    expect(storedLanguage(memory({ [READING_LANGUAGE_KEY]: 'Polish' }))).toBe('Polish')
    const kept = memory()
    rememberLanguage(kept, 'Turkish')
    expect(kept.data[READING_LANGUAGE_KEY]).toBe('Turkish')
    expect(storedLanguage(kept)).toBe('Turkish')
  })

  it('lives without browser storage: a storage that refuses is no problem', () => {
    const refusing: LanguageStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      }
    }
    expect(storedLanguage(refusing)).toBe('Russian')
    const store = createLanguageStore(refusing)
    expect(() => store.choose('Spanish')).not.toThrow()
    expect(store.snapshot()).toBe('Spanish')
  })

  it('is one choice for every post on the screen: choosing tells the others, once, and remembers it', () => {
    const kept = memory()
    const store = createLanguageStore(kept)
    expect(store.snapshot()).toBe('Russian')
    let heard = 0
    const stop = store.subscribe(() => (heard += 1))
    store.choose('German')
    store.choose('German')
    expect(heard).toBe(1)
    expect(store.snapshot()).toBe('German')
    expect(kept.data[READING_LANGUAGE_KEY]).toBe('German')
    stop()
    store.choose('French')
    expect(heard).toBe(1)
    expect(createLanguageStore(kept).snapshot()).toBe('French')
  })
})

describe('what a translated post shows', () => {
  it('shows the post as it was written until the owner reads the translation, and after the owner goes back', () => {
    expect(titleShown({ title: ' Best apps? ' }, translation(), false)).toBe('Best apps?')
    expect(titleShown({ title: 'Best apps?' }, null, true)).toBe('Best apps?')
    expect(bodyShown({ body: 'Own text' }, translation(), false)).toBe('Own text')
    expect(bodyShown({ body: 'Own text' }, null, true)).toBe('Own text')
    const thread = [comment(1), comment(2)]
    expect(threadShown(thread, translation(), false)).toEqual(thread)
    expect(threadShown(thread, null, true)).toEqual(thread)
  })

  it('shows the translated title, text and comments while the owner reads the translation; a comment the AI left out stays as written', () => {
    expect(titleShown({ title: 'Best apps?' }, translation(), true)).toBe('Лучшие приложения для карты')
    expect(bodyShown({ body: 'Own text' }, translation(), true)).toContain('Первый абзац.')
    const shown = threadShown([comment(1), comment(2)], translation(), true)
    expect(shown.map((c) => c.text)).toEqual(['Текст 1', 'Text 2'])
    // nothing else of a comment is changed
    expect(shown[0]).toMatchObject({ position: 1, author: 'user1', depth: 0 })
  })

  it("keeps the post's own text when the translation has none, and does not change the list it is given", () => {
    expect(bodyShown({ body: 'Own text' }, translation({ body: '  ' }), true)).toBe('Own text')
    expect(titleShown({ title: 'Best apps?' }, translation({ title: '' }), true)).toBe('Best apps?')
    const thread = [comment(1)]
    threadShown(thread, translation(), true)
    expect(thread[0].text).toBe('Text 1')
  })

  it("says what the translation is, in the AI's name, and when it is of a post that has changed since", () => {
    expect(translationLine(null, true)).toBeNull()
    expect(translationLine(translation(), true)).toBe('Translated into Russian by the AI.')
    expect(translationLine(translation({ stale: true }), true)).toContain('before it changed')
    expect(translationLine(translation(), false)).toContain('shown as it was written')
  })
})

describe('the text of a post', () => {
  it('is its text, or "no text of its own" once the page has been read, or not read yet', () => {
    expect(bodyState({ body: 'Hello', bodyAt: '2026-11-21T08:00:00.000Z' })).toBe('text')
    expect(bodyState({ body: '', bodyAt: '2026-11-21T08:00:00.000Z' })).toBe('none')
    expect(bodyState({ body: '   ', bodyAt: '2026-11-21T08:00:00.000Z' })).toBe('none')
    expect(bodyState({ body: '', bodyAt: null })).toBe('unread')
    expect(BODY_NONE).toContain('no text of its own')
    expect(BODY_UNREAD).toContain('only reads')
  })
})

describe('the explanation', () => {
  it('names the basis of a judgement, and says who an angle answers', () => {
    expect(basisLabel('facts')).toBe('by facts')
    expect(basisLabel('practice')).toBe('by practice')
    expect(angleWhere({ place: null }, [], 'anna')).toBe('the post by anna')
    expect(angleWhere({ place: null }, [], '  ')).toBe('the post')
    expect(angleWhere({ place: 2 }, [comment(2, { author: 'bob' })], 'anna')).toBe("bob's comment")
    expect(angleWhere({ place: 2 }, [comment(2, { author: '  ' })], 'anna')).toBe("someone's comment")
    expect(angleWhere({ place: 9 }, [comment(2)], 'anna')).toBe('the post')
  })

  it('opens the reply at the comment an angle answers while it is in the thread, else at the post', () => {
    expect(anglePlace({ place: null }, [comment(1)])).toBe('post')
    expect(anglePlace({ place: 1 }, [comment(1)])).toBe(1)
    expect(anglePlace({ place: 4 }, [comment(1)])).toBe('post')
  })

  it("makes the owner's wish of an angle, and cuts a long one to what the reply window takes", () => {
    expect(angleWish({ angle: ' Share a free tool ' })).toBe('Write the reply from this angle: Share a free tool')
    const long = angleWish({ angle: `${'word '.repeat(200)}end` })
    expect(long.length).toBeLessThanOrEqual(WISH_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(long.startsWith('Write the reply from this angle: word')).toBe(true)
  })

  it('says in whose name it was written, in what language, when, and from how many pages of the web', () => {
    expect(assistLine({ language: 'Russian', stale: false, sources: [] }, 'Nov 21')).toBe('Explained by the AI in Russian · Nov 21')
    const source = { url: 'https://example.org/a', title: 'A', fact: 'F' }
    expect(assistLine({ language: 'German', stale: false, sources: [source] }, 'Nov 21')).toContain('with 1 page from the web')
    expect(assistLine({ language: 'German', stale: false, sources: [source, { ...source, url: 'https://example.org/b' }] }, 'Nov 21')).toContain('with 2 pages from the web')
    expect(ASSIST_STALE).toContain('Explain again')
  })

  it('says what the AI is doing while it works', () => {
    expect(explainPhase('reading')).toBe('Reading the post…')
    expect(explainPhase('thinking')).toBe('Thinking…')
    expect(explainPhase('asking')).toContain('your question')
  })
})

describe('the words of the tags tab', () => {
  const tag = (over: Partial<TagStat> = {}): TagStat => ({
    id: 't1',
    name: 'houses',
    posts: 3,
    before: 1,
    replies: 42,
    score: 100,
    known: 2,
    daily: Array.from({ length: 30 }, (_, i) => (i === 29 ? 2 : i === 3 ? 1 : 0)),
    ...over
  })

  it('says what tags are while there are none, for the period chosen', () => {
    expect(tagsIntro(7)).toContain('the last 7 days')
    expect(tagsIntro(1)).toContain('the last 24 hours')
    expect(tagsIntro(7)).toContain('posts nothing')
  })

  it('counts the posts that have no tags yet, and says nothing when there are none', () => {
    expect(untaggedLine({ untagged: 0 })).toBeNull()
    expect(untaggedLine({ untagged: 1 })).toBe('1 post has no tags yet.')
    expect(untaggedLine({ untagged: 12 })).toBe('12 posts have no tags yet.')
    expect(tagsBasis({ posts: 40, untagged: 12 })).toBe('40 posts noted · 12 with no tags yet')
    expect(tagsBasis({ posts: 1, untagged: 0 })).toBe('1 post noted')
  })

  it('describes the picture of the last thirty days in words', () => {
    expect(dailyDescription(tag())).toBe('houses: 3 posts in the last 30 days, at most 2 in one day')
    expect(dailyDescription(tag({ daily: Array.from({ length: 30 }, () => 0) }))).toBe('houses: 0 posts in the last 30 days')
    expect(dailyDescription(tag({ daily: [1, ...Array.from({ length: 29 }, () => 0)] }))).toContain('1 post in')
    expect(dailyValues(tag())).toHaveLength(30)
  })

  it('says how many posts carry the tags picked', () => {
    expect(tagFilterLine(['houses'], 1)).toBe('1 post carry this tag.')
    expect(tagFilterLine(['houses', 'moon sign'], 5)).toBe('5 posts carry all 2 tags.')
  })
})
