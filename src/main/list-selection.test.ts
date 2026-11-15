// Which row a list screen shows (Posts, Feed): src/renderer/src/list-selection.ts is pure, so it is tested here (the renderer has no runner).

import { describe, expect, it } from 'vitest'
import { SELECTION_KEYS, resolveSelection, selectionAfterKey } from '../renderer/src/list-selection'
import { TAB_KEYS, tabAfterKey } from '../renderer/src/tab-keys'
import { selectionAfterDismiss } from '../renderer/src/pages/inbox/inbox-groups'

describe('resolveSelection', () => {
  const after = selectionAfterDismiss

  it('keeps the chosen row while it is listed', () => {
    expect(resolveSelection(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', after)).toBe('b')
  })

  it('shows the first row while nothing was chosen', () => {
    expect(resolveSelection(['a', 'b'], [], null, after)).toBe('a')
  })

  it('shows nothing for an empty list, chosen or not', () => {
    expect(resolveSelection([], [], null, after)).toBeNull()
    expect(resolveSelection([], ['a'], 'a', after)).toBeNull()
  })

  it('moves to the row that took the place of the one that left, as the list was the render before', () => {
    expect(resolveSelection(['a', 'c'], ['a', 'b', 'c'], 'b', after)).toBe('c')
    // The last one left: the one above it.
    expect(resolveSelection(['a', 'b'], ['a', 'b', 'c'], 'c', after)).toBe('b')
  })

  it('falls back to the first row when the neighbour left too, or the chosen row was never listed', () => {
    expect(resolveSelection(['x', 'y'], ['a', 'b', 'c'], 'b', after)).toBe('x')
    expect(resolveSelection(['x', 'y'], ['a', 'b'], 'zzz', after)).toBe('x')
  })

  it('does not ask for a neighbour of a row that was not in the previous list', () => {
    let asked = 0
    resolveSelection(['x'], ['a'], 'ghost', (order, gone) => (asked++, after(order, gone)))
    expect(asked).toBe(0)
  })
})

describe('selectionAfterKey', () => {
  const order = ['a', 'b', 'c']

  it('moves one row down and up and stops at the ends (no move: null)', () => {
    expect(selectionAfterKey(order, 'a', 'ArrowDown')).toBe('b')
    expect(selectionAfterKey(order, 'b', 'ArrowDown')).toBe('c')
    expect(selectionAfterKey(order, 'c', 'ArrowDown')).toBeNull()
    expect(selectionAfterKey(order, 'c', 'ArrowUp')).toBe('b')
    expect(selectionAfterKey(order, 'a', 'ArrowUp')).toBeNull()
  })

  it('goes to the first and the last row with Home and End', () => {
    expect(selectionAfterKey(order, 'b', 'Home')).toBe('a')
    expect(selectionAfterKey(order, 'b', 'End')).toBe('c')
    expect(selectionAfterKey(order, 'a', 'Home')).toBeNull()
    expect(selectionAfterKey(order, 'c', 'End')).toBeNull()
  })

  it('starts from the first row going down and from the last going up when nothing is selected', () => {
    expect(selectionAfterKey(order, null, 'ArrowDown')).toBe('a')
    expect(selectionAfterKey(order, null, 'ArrowUp')).toBe('c')
    expect(selectionAfterKey(order, 'gone', 'ArrowDown')).toBe('a')
    expect(selectionAfterKey(order, 'gone', 'ArrowUp')).toBe('c')
  })

  it('says nothing for an empty list and has exactly the four keys', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const) expect(selectionAfterKey([], null, key)).toBeNull()
    expect([...SELECTION_KEYS].sort()).toEqual(['ArrowDown', 'ArrowUp', 'End', 'Home'])
  })

  it('stays on a list of one', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const) expect(selectionAfterKey(['a'], 'a', key)).toBeNull()
  })
})

describe('tabAfterKey', () => {
  const tabs = ['status', 'plan', 'mix', 'settings'] as const

  it('moves to the neighbour and wraps at both ends', () => {
    expect(tabAfterKey(tabs, 'status', 'ArrowRight')).toBe('plan')
    expect(tabAfterKey(tabs, 'mix', 'ArrowRight')).toBe('settings')
    expect(tabAfterKey(tabs, 'settings', 'ArrowRight')).toBe('status')
    expect(tabAfterKey(tabs, 'plan', 'ArrowLeft')).toBe('status')
    expect(tabAfterKey(tabs, 'status', 'ArrowLeft')).toBe('settings')
  })

  it('goes to the first and the last with Home and End', () => {
    expect(tabAfterKey(tabs, 'mix', 'Home')).toBe('status')
    expect(tabAfterKey(tabs, 'mix', 'End')).toBe('settings')
  })

  it('ignores other keys, an unknown tab and has exactly four keys', () => {
    expect(tabAfterKey(tabs, 'plan', 'Enter')).toBeNull()
    expect(tabAfterKey(tabs, 'plan', 'ArrowDown')).toBeNull()
    expect(tabAfterKey(tabs, 'nope' as (typeof tabs)[number], 'ArrowRight')).toBeNull()
    expect([...TAB_KEYS].sort()).toEqual(['ArrowLeft', 'ArrowRight', 'End', 'Home'])
  })

  it('stays on a row of one', () => {
    expect(tabAfterKey(['only'], 'only', 'ArrowRight')).toBe('only')
    expect(tabAfterKey(['only'], 'only', 'ArrowLeft')).toBe('only')
  })
})
