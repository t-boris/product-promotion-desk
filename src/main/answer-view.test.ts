import { describe, expect, it } from 'vitest'
import { earlierLine, earlierOf, linesOf, questionsChanged, tallyLine } from '../renderer/src/pages/weekly/answer-view'

describe('the AI-answer card', () => {
  it('reads the box as one question a line and knows when it differs from the kept list', () => {
    expect(linesOf(' one?\n\n two? \n')).toEqual(['one?', 'two?'])
    expect(questionsChanged('one?\ntwo?\n', ['one?', 'two?'])).toBe(false)
    expect(questionsChanged('one?', ['one?', 'two?'])).toBe(true)
    expect(questionsChanged('two?\none?', ['one?', 'two?'])).toBe(true)
  })

  it('says the tally and compares with the check before', () => {
    expect(tallyLine({ asked: 10, named: 2, cited: 1 })).toBe('Named in 2 of 10 answers · your site among the sources of 1')
    expect(tallyLine({ asked: 0, named: 0, cited: 0 })).toBe('No question was answered.')
    const h = (id: string, named: number, asked = 10, finished = true) => ({ id, engine: 'Codex', startedAt: '', finished, asked, named, cited: 0 })
    const history = [h('c', 3), h('b', 0, 0), h('a', 1)]
    expect(earlierOf({ history, shown: { id: 'c' } as never })).toMatchObject({ id: 'a' })
    expect(earlierOf({ history, shown: { id: 'a' } as never })).toBeNull()
    expect(earlierOf({ history, shown: null })).toBeNull()
    expect(earlierLine({ asked: 10, named: 1 })).toBe('The check before: named in 1 of 10.')
    expect(earlierLine(null)).toBeNull()
  })
})
