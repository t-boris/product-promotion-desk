/** Whitespace-insensitive form used to compare text we sent with text read back from a site. */
export function comparableText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function sameText(a: string, b: string): boolean {
  return comparableText(a) === comparableText(b)
}

export function isoFromEpochSeconds(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
