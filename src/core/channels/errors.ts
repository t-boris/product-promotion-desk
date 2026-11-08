import { ApiError } from '../../shared/api'
import { TakeoverError } from '../ports'

export function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError('invalid_input', `${what} is missing.`)
  return value.trim()
}

/** Runs a repository lookup that throws a plain Error when the record is missing. */
export function found<T>(lookup: () => T, what: string): T {
  try {
    return lookup()
  } catch {
    throw new ApiError('not_found', `${what} was not found. It may have been removed.`)
  }
}

export const BROWSER_BUSY = 'The account\'s browser is in your hands: its window is open, or you took control. Close the window (or give control back) on the Accounts screen, then try again.'

/** The user holding the browser is an expected state, not a failure of the operation itself. */
export function browserError(error: unknown, fallback: { code: string; message: (reason: string) => string }): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof TakeoverError) return new ApiError('browser_busy', BROWSER_BUSY)
  const reason = error instanceof Error ? error.message : String(error)
  return new ApiError(fallback.code, fallback.message(reason))
}
