import { ApiError } from '../../shared/api'

/**
 * An address of the page the owner is looking at, cut down to what may be shown and kept (DEC-028): http(s) only, never the query, the
 * fragment or anything before the host, which can carry tokens, search words or credentials. Empty when it is not such an address.
 */
export function publicAddress(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  // Path parameters (";jsessionid=...") can carry a session: they go too.
  return `${url.protocol}//${url.host}${url.pathname.replace(/;[^/]*/g, '')}`
}

/** An address the person may open in the account's browser: http(s) only, never with embedded credentials. */
export function parseBrowserUrl(input: string): string {
  const text = input.trim()
  if (!text) throw new ApiError('invalid_input', 'Enter the address of the page to open.')
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]+:\d+(\/|$)/.test(text) // "localhost:3000" is a host, not a scheme
  let url: URL
  try {
    url = new URL(hasScheme ? text : `https://${text}`)
  } catch {
    throw new ApiError('invalid_input', `Not a valid address: ${text}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ApiError('invalid_input', 'Only http and https addresses can be opened.')
  if (url.username || url.password) throw new ApiError('invalid_input', 'Addresses with a password in them are not accepted: type passwords on the site itself.')
  return url.href
}
