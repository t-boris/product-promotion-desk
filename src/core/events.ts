import type { ApiEvent, ChangeScope } from '../shared/api'

type Listener = (event: ApiEvent) => void

/** In-process fan-out of core events to every connected UI transport. */
export class EventBus {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ApiEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // A broken listener must never break the core.
      }
    }
  }

  changed(...scopes: ChangeScope[]): void {
    for (const scope of scopes) this.emit({ type: 'changed', scope })
  }
}
