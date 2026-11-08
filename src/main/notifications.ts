import { Notification } from 'electron'
import type { NotificationSink } from '../core/pipeline/attention-notify'

/** macOS can drop a click handler when the Notification object is garbage collected, so live ones are kept. */
const MAX_LIVE = 50

/**
 * Delivers the core's notifications (attention items and the daily digest) as macOS notifications. What to
 * notify about, when, and whether the settings allow it is decided in the core (attention-notify.ts); this
 * only renders. Clicking a notification brings the application window forward.
 */
export function createNotificationSink(onClick: () => void): NotificationSink {
  const live = new Set<Notification>()
  return {
    notify: (n) => {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title: n.title, body: n.body, silent: n.kind === 'digest' })
      live.add(notification)
      if (live.size > MAX_LIVE) live.delete(live.values().next().value as Notification)
      const release = (): void => void live.delete(notification)
      notification.on('click', () => {
        release()
        onClick()
      })
      notification.on('close', release)
      notification.show()
    }
  }
}
