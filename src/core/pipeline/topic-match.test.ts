import { describe, expect, it } from 'vitest'
import { matchedTerm, matchesTopics, termsOf } from './topic-match'

const lists = (topics: string[], queries: string[] = []) => ({ topics, queries })
const post = (title: string, body = '') => ({ title, body })

describe('which new posts a channel is about (DEC-039)', () => {
  // [description, post, topics, queries, matches]
  const table: [string, { title: string; body: string }, string[], string[], boolean][] = [
    ['a topic in the title', post('Looking for a tarot app'), ['tarot'], [], true],
    ['a topic in the body only', post('Question', 'I pulled a tarot card today'), ['tarot'], [], true],
    ['a query in the title', post('Best natal chart tools?'), [], ['natal chart'], true],
    ['any case', post('TAROT Reading Tips'), ['tarot'], [], true],
    ['the term in any case', post('tarot reading'), ['TaRoT'], [], true],
    ['a phrase across a longer gap of spaces', post('a Habit   Tracker app'), ['habit tracker'], [], true],
    ['a phrase across a line break', post('habit\ntracker ideas'), ['habit tracker'], [], true],
    ['next to punctuation', post('Is it tarot? Yes, tarot!'), ['tarot'], [], true],
    ['inside quotes and brackets', post('(tarot) "tarot"'), ['tarot'], [], true],
    ['a term ending in a sign', post('C++ is fast'), ['c++'], [], true],
    ['a term with a dot', post('I use node.js daily'), ['node.js'], [], true],
    ['a plural is not the term', post('three tarots'), ['tarot'], [], false],
    ['inside a longer word (before)', post('Startarot'), ['tarot'], [], false],
    ['inside a longer word (after)', post('tarotcards are fun'), ['tarot'], [], false],
    ['a digit next to it joins the word', post('tarot2 is out'), ['tarot'], [], false],
    ['an underscore next to it joins the word', post('the_tarot_deck'), ['tarot'], [], false],
    ['a term starting with a letter inside a longer one', post('abc++ rocks'), ['c++'], [], false],
    ['the dot is not a wildcard', post('nodexjs is a typo'), ['node.js'], [], false],
    ['a regex character is taken literally', post('what is (a+b)? and more'), ['(a+b)'], [], true],
    ['a regex character does not break the match', post('plain text'), ['(a+b', '[x', '*', '\\'], [], false],
    ['a phrase is not matched by one of its words', post('a tracker for runs'), ['habit tracker'], [], false],
    ['a phrase out of order', post('tracker habit'), ['habit tracker'], [], false],
    ['no topic at all', post('Looking for a tarot app'), [], [], false],
    ['blank topics only', post('Looking for a tarot app'), ['', '   '], ['\n'], false],
    ['an empty post', post('', ''), ['tarot'], [], false],
    ['letters of another script', post('Ищу приложение для гороскопов'), ['гороскопов'], [], true],
    ['another script, inside a longer word', post('Ищу приложение для гороскопов'), ['скоп'], [], false],
    ['another script, any case', post('ГОРОСКОП на сегодня'), ['гороскоп'], [], true],
    ['accented letters', post('A café near me'), ['café'], [], true],
    ['accented letters, inside a word', post('A cafés near me'), ['café'], [], false],
    ['the same text in a different Unicode form', post('A café near me'), ['café'], [], true],
    ['a topic after a query that does not match', post('about tarot'), ['moon'], ['tarot'], true]
  ]

  it.each(table)('%s', (_name, input, topics, queries, expected) => {
    expect(matchesTopics(input, lists(topics, queries))).toBe(expected)
  })

  it('says which term matched, as the owner wrote it', () => {
    expect(matchedTerm(post('Looking for TAROT help'), lists(['moon', 'Tarot']))).toBe('Tarot')
    expect(matchedTerm(post('nothing here'), lists(['moon']))).toBeNull()
  })

  it('keeps the terms trimmed, in single spaces, without blanks or repeats', () => {
    expect(termsOf(lists(['  habit   tracker ', 'Habit Tracker', ''], ['tarot', 'TAROT']))).toEqual(['habit tracker', 'tarot'])
  })

  it('does not hang on a long post or a long term', () => {
    const long = `${'a '.repeat(50_000)}tarot`
    expect(() => matchesTopics(post(long), lists(['tarot', `${'x'.repeat(500)}`]))).not.toThrow()
    // Only the beginning of a very long text is read: a term past that point is not found, never a slow search.
    expect(matchesTopics(post(long), lists(['tarot']))).toBe(false)
  })
})
