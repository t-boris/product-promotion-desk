// When a post of the Feed counts as read (owner, 2026-11-21: posts are marked as read after they are read). Scrolling past a post is not reading it, so a post
// is marked only after it has stayed on show for a while, and a press of the owner's own (Mark as unread) is never undone by the clock. Pure, so it is tested
// from src/main; the hook that feeds it (`useReadMarks.ts`) only reads the window.

import type { FindingRow } from './finding-rows'

/** How long a post stays on show, in a row, before it counts as read. */
export const READ_AFTER_MS = 3000

/** The share of a card that must be inside the window for the card to be "on show". */
export const MOST_OF_A_CARD = 0.5

/** What the window says about one post at this moment. */
export interface OnShow {
  /** Most of the card is inside the window (`mostlyInView`). */
  inView: boolean
  /** The application's window is the one in front. */
  windowFocused: boolean
  /** The page is not hidden or minimised. */
  pageVisible: boolean
}

/** A post is on show only while all three hold: it is in the window, the window is in front and the page is visible. */
export function isOnShow(state: OnShow): boolean {
  return state.inView && state.windowFocused && state.pageVisible
}

/**
 * Whether enough of a card is in the window: half of it, or, for a card taller than the window (a long thread), half of the window. Without the second
 * half a tall card could never reach half of itself and would never be read.
 */
export function mostlyInView(args: { ratio: number; visibleHeight: number; viewHeight: number }): boolean {
  return args.ratio >= MOST_OF_A_CARD || (args.viewHeight > 0 && args.visibleHeight >= args.viewHeight * MOST_OF_A_CARD)
}

/** A clock for one post: `update(true)` while it is on show, `update(false)` when it is not. */
export interface ReadClock {
  update: (onShow: boolean) => void
  /** Drops what is counted without calling `onRead` (the card left the screen for good). */
  stop: () => void
}

/**
 * Calls `onRead` once, after the post has been on show for `delay` ms in a row. Leaving (`update(false)`) throws the count away: the next time it starts from
 * nothing. After `onRead` the clock does nothing more.
 */
export function createReadClock(onRead: () => void, delay: number = READ_AFTER_MS): ReadClock {
  let handle: ReturnType<typeof setTimeout> | null = null
  let done = false
  const clear = (): void => {
    if (handle !== null) clearTimeout(handle)
    handle = null
  }
  return {
    update(onShow) {
      if (done) return
      if (onShow && handle === null) {
        handle = setTimeout(() => {
          handle = null
          done = true
          onRead()
        }, delay)
      } else if (!onShow) clear()
    },
    stop: clear
  }
}

// ───────────── What the owner marked unread by hand ─────────────

/** The part of `localStorage` the held posts need. */
export interface HeldStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const HELD_KEY = 'ppd.feed.held-unread'
/** The most posts remembered: the oldest press is forgotten first. */
export const HELD_LIMIT = 500

/**
 * The posts the owner marked as unread by hand. The clock never reads them again: the owner said "come back to this", and a clock that took it back after
 * three seconds on screen would undo the owner's own press. Kept in the window's storage so it holds after a restart; where there is none, it holds until the
 * window closes.
 */
export interface HeldStore {
  has: (id: string) => boolean
  hold: (id: string) => void
  release: (ids: readonly string[]) => void
}

export function createHeldStore(storage: HeldStorage | undefined, limit: number = HELD_LIMIT): HeldStore {
  const read = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(HELD_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }
  let ids = read()
  const save = (): void => {
    try {
      storage?.setItem(HELD_KEY, JSON.stringify(ids))
    } catch {
      // The window refuses to store: what is held lasts until it closes.
    }
  }
  return {
    has: (id) => ids.includes(id),
    hold(id) {
      ids = [...ids.filter((held) => held !== id), id].slice(-limit)
      save()
    },
    release(released) {
      const next = ids.filter((id) => !released.includes(id))
      if (next.length === ids.length) return
      ids = next
      save()
    }
  }
}

// ───────────── Which posts a press takes ─────────────

/** The posts "Mark all as read" takes: the unread ones among the rows the filters show, in the order shown; a post already read is left out. */
export function unreadIds(rows: readonly FindingRow[]): string[] {
  return rows.filter((row) => row.unseen).map((row) => row.id)
}
