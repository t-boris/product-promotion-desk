import type { Db } from '../../core/db/database'
import { newId, parseJson, toJson } from '../../core/db/database'
import type { Clock } from '../../core/ports'
import { LIMITS, type SiteProfile } from './profile'
import { validateProfile } from './validate'

export interface StoredProfile {
  id: string
  host: string
  version: number
  valid: boolean
  errors: string[]
  /** Parsed profile; null when the stored definition is invalid. */
  profile: SiteProfile | null
  createdAt: string
}

export interface ProfileProvider {
  /** Newest valid profile for `host` or its closest parent domain. */
  forHost(hostname: string): { valid: StoredProfile | null; latest: StoredProfile | null }
}

type Row = { id: string; host: string; version: number; definition_json: string; valid: number; validation_json: string; created_at: string }

const map = (row: Row): StoredProfile => ({
  id: row.id,
  host: row.host,
  version: row.version,
  valid: row.valid === 1,
  errors: parseJson<string[]>(row.validation_json, []),
  profile: row.valid === 1 ? parseJson<SiteProfile | null>(row.definition_json, null) : null,
  createdAt: row.created_at
})

/**
 * Versioned storage of site profiles in the connector_profiles table. Every submitted definition is kept with a
 * valid flag and its validation errors; only the newest valid version of a host is ever used.
 */
export class ProfileStore implements ProfileProvider {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock
  ) {}

  /** Validates and stores a definition as the next version of its host. Invalid definitions are stored too, flagged. */
  save(definition: unknown): StoredProfile {
    const result = validateProfile(definition)
    const rawHost = typeof (definition as { host?: unknown } | null)?.host === 'string' ? (definition as { host: string }).host.toLowerCase() : ''
    const host = result.profile?.host ?? (/^[a-z0-9.-]{3,253}$/.test(rawHost) ? rawHost : '(invalid)')
    let json = result.profile ? toJson(result.profile) : safeJson(definition)
    if (json.length > LIMITS.maxBytes * 2) json = toJson({ truncated: true })
    const id = newId()
    return this.db.transaction(() => {
      const last = this.db.prepare('SELECT MAX(version) AS v FROM connector_profiles WHERE host = ?').get(host) as { v: number | null }
      const version = (last.v ?? 0) + 1
      this.db
        .prepare('INSERT INTO connector_profiles (id, host, version, definition_json, valid, validation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, host, version, json, result.valid ? 1 : 0, toJson(result.errors), this.clock.now().toISOString())
      return map(this.db.prepare('SELECT * FROM connector_profiles WHERE id = ?').get(id) as Row)
    })()
  }

  list(host?: string): StoredProfile[] {
    const rows = (
      host
        ? this.db.prepare('SELECT * FROM connector_profiles WHERE host = ? ORDER BY version DESC').all(host)
        : this.db.prepare('SELECT * FROM connector_profiles ORDER BY host, version DESC').all()
    ) as Row[]
    return rows.map(map)
  }

  forHost(hostname: string): { valid: StoredProfile | null; latest: StoredProfile | null } {
    const labels = hostname.toLowerCase().split('.')
    for (let i = 0; i <= labels.length - 2; i += 1) {
      const candidate = labels.slice(i).join('.')
      const rows = this.list(candidate)
      if (rows.length > 0) return { valid: rows.find((r) => r.valid) ?? null, latest: rows[0] }
    }
    return { valid: null, latest: null }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return toJson({ unserializable: true })
  }
}
