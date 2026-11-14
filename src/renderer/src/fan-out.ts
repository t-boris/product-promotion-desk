// One subscription to a source of events, shared by every handler that listens to it (BUG-061). Kept apart from transport.ts, which touches
// `window`, so the rule is tested without a browser (src/main/renderer-logic.test.ts).

export type EventHandler<E> = (event: E) => void

/**
 * Wraps a source that adds one listener per `subscribeSource` call (the preload bridge: every call is one `ipcRenderer.on`). The returned
 * `subscribe` calls the source once, when the first handler arrives, hands each event to every handler, and gives the source's own remover
 * back to it when the last handler leaves, so a later `subscribe` registers again. Every screen has several `useQuery`/`useEvents` hooks;
 * with one listener each, Node warned of a leak from the 11th.
 */
export function createFanOut<E>(subscribeSource: (emit: EventHandler<E>) => () => void): (handler: EventHandler<E>) => () => void {
  const handlers = new Set<EventHandler<E>>()
  let stopSource: (() => void) | null = null

  const emit: EventHandler<E> = (event) => {
    // A copy, so a handler that unsubscribes (itself or another) while the event is handed out does not disturb the walk; one that has
    // left is skipped.
    for (const handler of [...handlers]) {
      if (handlers.has(handler)) handler(event)
    }
  }

  return (handler) => {
    handlers.add(handler)
    stopSource ??= subscribeSource(emit)
    return () => {
      if (!handlers.delete(handler) || handlers.size > 0 || !stopSource) return
      const stop = stopSource
      stopSource = null
      stop()
    }
  }
}
