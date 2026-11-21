// How a long list is shown a page at a time: the part shown, what is left and the words of the button. The hook is plain state on top of these.

import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, moreLabel, pageOf } from '../renderer/src/list-paging'

const items = Array.from({ length: 60 }, (_, i) => i)

describe('pageOf', () => {
  it('shows the first rows and counts the rest', () => {
    const { visible, hidden } = pageOf(items, PAGE_SIZE)
    expect(visible).toHaveLength(25)
    expect(visible[0]).toBe(0)
    expect(hidden).toBe(35)
  })

  it('shows a short list whole, with nothing left', () => {
    expect(pageOf([1, 2, 3], PAGE_SIZE)).toEqual({ visible: [1, 2, 3], hidden: 0 })
    expect(pageOf([], PAGE_SIZE)).toEqual({ visible: [], hidden: 0 })
  })

  it('never shows more than there is, nor a negative count', () => {
    expect(pageOf(items, 500).hidden).toBe(0)
    expect(pageOf(items, -3)).toEqual({ visible: [], hidden: 60 })
  })
})

describe('moreLabel', () => {
  it('names how many the next press adds and how many are left', () => {
    expect(moreLabel(35)).toBe('Show 25 more (35 left)')
    expect(moreLabel(10)).toBe('Show 10 more (10 left)')
  })
})
