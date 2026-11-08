// Pure timing helpers and the injectable timer seam of the scheduler. Nothing here touches the database.

/** Timers are injected so tests can drive the scheduler deterministically. Handles are opaque. */
export interface Timers {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
}

export const MINUTE_MS = 60_000

/**
 * Delay before retrying a failing channel: base * 2^(failures-1), capped (REQ-005: connection loss backs off
 * and recovers by itself). `failures` is the length of the current failure streak, at least 1.
 */
export function backoffDelayMs(failures: number, baseMs: number, capMs: number): number {
  const exponent = Math.min(Math.max(failures, 1) - 1, 30)
  return Math.min(capMs, baseMs * 2 ** exponent)
}

/** Next-check times for `count` due channels, spread out so a wake-up or restart never fires them all at once. */
export function spreadTimes(count: number, nowMs: number, settleMs: number, spreadMs: number): number[] {
  return Array.from({ length: count }, (_, i) => nowMs + settleMs + i * spreadMs)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Local calendar day as YYYY-MM-DD (the digest fires once per local day). */
export function localDayKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Minutes since local midnight, or null when `hhmm` is not a valid "HH:MM" local time. */
export function parseLocalTime(hhmm: string | null): number | null {
  if (!hhmm) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function minutesOfLocalDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Resolves with `value` unless `promise` settles first; used to bound runs that may hang. */
export function raceTimeout<T, V>(promise: Promise<T>, ms: number, timers: Timers, onTimeout: () => V): Promise<T | V> {
  return new Promise<T | V>((resolve, reject) => {
    const handle = timers.setTimeout(() => resolve(onTimeout()), ms)
    promise.then(
      (value) => {
        timers.clearTimeout(handle)
        resolve(value)
      },
      (error: unknown) => {
        timers.clearTimeout(handle)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}
