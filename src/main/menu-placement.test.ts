import { describe, expect, it } from 'vitest'
import { intersect, placeMenu, type Box } from '../renderer/src/menu-placement'

const WINDOW: Box = { left: 0, top: 0, right: 1000, bottom: 700 }
const MENU = { width: 300, height: 200 }
const at = (left: number, top: number, width = 80, height = 30): Box => ({ left, top, right: left + width, bottom: top + height })

describe('where a pop-over menu opens', () => {
  it('keeps the default (right edges level, under the button) when the menu fits', () => {
    expect(placeMenu(at(600, 100), MENU, WINDOW)).toEqual({ align: 'end', side: 'below' })
  })

  it('opens towards the right when a button near the left edge would cut the menu off (the More of a statement row)', () => {
    // The button's right edge is at 190: a 300 px menu on it would start at -110.
    expect(placeMenu(at(110, 400), MENU, WINDOW)).toEqual({ align: 'start', side: 'below' })
  })

  it('keeps the default for a button whose menu would just fit on the left', () => {
    expect(placeMenu(at(220, 100), MENU, WINDOW)).toEqual({ align: 'end', side: 'below' })
  })

  it('opens over the button when there is no room under it and room over it', () => {
    expect(placeMenu(at(600, 560), MENU, WINDOW)).toEqual({ align: 'end', side: 'above' })
  })

  it('keeps under the button when neither side has room for the whole menu and under leaves less outside', () => {
    expect(placeMenu(at(600, 60), { width: 300, height: 900 }, WINDOW)).toEqual({ align: 'end', side: 'below' })
  })

  it('takes the side that leaves less outside when neither fits (a menu wider than the room on both sides)', () => {
    const narrow: Box = { left: 0, top: 0, right: 350, bottom: 700 }
    // End needs 300 to the left of 200 (100 outside); start needs 300 right of 120 (70 outside).
    expect(placeMenu(at(120, 100), MENU, narrow).align).toBe('start')
    expect(placeMenu(at(220, 100), MENU, narrow).align).toBe('end')
  })

  it('judges by the bounds it is given: the edge of a column, not only the window', () => {
    const column: Box = { left: 224, top: 0, right: 1000, bottom: 700 }
    expect(placeMenu(at(300, 100), MENU, column)).toEqual({ align: 'start', side: 'below' })
    expect(placeMenu(at(300, 100), MENU, WINDOW)).toEqual({ align: 'end', side: 'below' })
  })

  it('cuts one box down to what lies inside another', () => {
    expect(intersect({ left: 0, top: 0, right: 500, bottom: 500 }, { left: 100, top: 50, right: 900, bottom: 400 })).toEqual({ left: 100, top: 50, right: 500, bottom: 400 })
  })
})
