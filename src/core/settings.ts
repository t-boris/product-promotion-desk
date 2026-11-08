import type { AppSettings } from '../shared/types'
import { parseJson, toJson, type Db } from './db/database'

export const DEFAULT_SETTINGS: AppSettings = {
  engineId: null,
  notifications: true,
  webMode: { enabled: false, port: 47615 }
}

/** Key/value settings persisted in SQLite. Also used for small pieces of runtime state (e.g. pause flag). */
export class SettingsStore {
  constructor(private readonly db: Db) {}

  getRaw<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? parseJson<T>(row.value, fallback) : fallback
  }

  setRaw(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, toJson(value))
  }

  app(): AppSettings {
    const stored = this.getRaw<Partial<AppSettings>>('app', {})
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      webMode: { ...DEFAULT_SETTINGS.webMode, ...(stored.webMode ?? {}) }
    }
  }

  updateApp(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.app(),
      ...patch,
      webMode: { ...this.app().webMode, ...(patch.webMode ?? {}) }
    }
    this.setRaw('app', next)
    return next
  }
}
