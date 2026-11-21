import { useEffect, useRef, type RefObject } from 'react'
import { createHeldStore, createReadClock, isOnShow, mostlyInView, type HeldStorage, type OnShow } from './read-marks'

/** The browser's storage, or undefined where the browser refuses even to hand it out. */
function browserStorage(): HeldStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** The posts the owner marked as unread by hand, for the whole window (see `createHeldStore`). */
export const heldUnread = createHeldStore(browserStorage())

/**
 * The top of the window that the application's own bars cover (the toolbar and the sticky filters of the Feed): a card under them is not on show. A little
 * more than they are tall, so a card has to be clear of them.
 */
const COVERED_TOP_PX = 150

/**
 * Counts a card as read after it has stayed on show for three seconds in a row (`READ_AFTER_MS`): at least half of it in the window, the application's window
 * in front, the page visible. Scrolling or arrowing past it starts the count again. `active` is false for a post that is read already and for one the owner
 * marked unread by hand: nothing is counted for it. `onRead` is called once.
 */
export function useReadAfterShow(card: RefObject<Element | null>, active: boolean, onRead: () => void): void {
  const latest = useRef(onRead)
  latest.current = onRead
  useEffect(() => {
    const element = card.current
    if (!active || !element || typeof IntersectionObserver === 'undefined') return
    const state: OnShow = { inView: false, windowFocused: document.hasFocus(), pageVisible: document.visibilityState === 'visible' }
    const clock = createReadClock(() => latest.current())
    const apply = (): void => clock.update(isOnShow(state))
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        state.inView = entry.isIntersecting && mostlyInView({ ratio: entry.intersectionRatio, visibleHeight: entry.intersectionRect.height, viewHeight: entry.rootBounds?.height ?? window.innerHeight })
        apply()
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: `-${COVERED_TOP_PX}px 0px 0px 0px` }
    )
    observer.observe(element)
    const onFocus = (): void => {
      state.windowFocused = true
      apply()
    }
    const onBlur = (): void => {
      state.windowFocused = false
      apply()
    }
    const onVisibility = (): void => {
      state.pageVisible = document.visibilityState === 'visible'
      apply()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      clock.stop()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, card])
}
