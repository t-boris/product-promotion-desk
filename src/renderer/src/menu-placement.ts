// Where a pop-over menu opens: under its button and level with the button's right edge by default, but on the other side when that
// would take it past an edge of the place it is shown in. Pure, so the rule is tested without a window.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MenuPlacement {
  /** `end`: the menu's right edge is the button's right edge (it grows to the left). `start`: its left edge is the button's left edge (it grows to the right). */
  align: 'end' | 'start'
  /** `below`: under the button. `above`: over it. */
  side: 'below' | 'above'
}

/** The gap between the button and the menu, in pixels (the same as the style's own). */
export const MENU_GAP = 4

/**
 * The placement for a menu of `size` opened from `trigger` inside `bounds` (the edges of the place that would cut it off: the scrolling
 * column the button is in, or the window). The default is kept whenever the menu fits there; otherwise the other side is taken when that
 * one fits, and when neither fits, the side that leaves less of the menu outside.
 */
export function placeMenu(trigger: Box, size: { width: number; height: number }, bounds: Box, gap: number = MENU_GAP): MenuPlacement {
  // Horizontally: how much of the menu is outside on each choice (0 when it fits).
  const outsideEnd = Math.max(0, bounds.left - (trigger.right - size.width), trigger.right - bounds.right)
  const outsideStart = Math.max(0, bounds.left - trigger.left, trigger.left + size.width - bounds.right)
  const align = outsideEnd <= outsideStart ? 'end' : 'start'
  // Vertically: the room under the button and over it.
  const outsideBelow = Math.max(0, trigger.bottom + gap + size.height - bounds.bottom)
  const outsideAbove = Math.max(0, bounds.top - (trigger.top - gap - size.height))
  const side = outsideBelow <= outsideAbove ? 'below' : 'above'
  return { align, side }
}

/** The part of `a` that lies inside `b`. */
export function intersect(a: Box, b: Box): Box {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
}
