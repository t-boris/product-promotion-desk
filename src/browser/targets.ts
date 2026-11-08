// Pure helpers for addresses, partitions and the user agent. No Electron imports, so they are unit-tested.

/**
 * Normalizes an address typed by the user or produced by a connector. Only http(s) is allowed, and an address
 * that embeds credentials (https://user:pass@host) is refused: passwords are typed on the site's own page only.
 */
export function normalizeBrowserUrl(input: string): string {
  const text = input.trim()
  if (!text) throw new Error('No address to open')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) throw new Error('Only http and https addresses can be opened')
  if (/^(javascript|data|file|blob|about|mailto|vbscript|chrome|devtools):/i.test(text)) throw new Error('Only http and https addresses can be opened')
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new Error(`Not a valid address: ${text}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses can be opened')
  if (url.username || url.password) throw new Error('Addresses with embedded credentials are not accepted')
  if (!url.hostname) throw new Error(`Not a valid address: ${text}`)
  return url.href
}

const PARTITION = /^persist:[A-Za-z0-9_.:-]{1,120}$/

/**
 * The persistent partition for an account. A name without the `persist:` prefix would be an in-memory session
 * that forgets the login on restart, so the prefix is added consistently and anything else is refused.
 */
export function persistentPartition(partition: string): string {
  const name = partition.startsWith('persist:') ? partition : `persist:${partition}`
  if (!PARTITION.test(name)) throw new Error(`Invalid browser partition name: ${partition}`)
  return name
}

/** Chromium user-agent tokens kept when removing the Electron/app tokens. */
const BROWSER_TOKENS = /^(Mozilla|AppleWebKit|Chrome|Safari|Version|Gecko|Mobile)\//
const PAREN_GROUP = /^\(.*\)$/

/**
 * The page is a real Chromium, so it presents itself as plain Chromium instead of "Electron/x" plus the app
 * name: several sites refuse sign-in inside anything that announces itself as an embedded Electron shell.
 */
export function cleanUserAgent(userAgent: string): string {
  // Group "(Macintosh; Intel Mac OS X ...)" and "(KHTML, like Gecko)" stay together although they contain spaces.
  const tokens = userAgent.match(/\([^)]*\)|\S+/g) ?? []
  return tokens.filter((token) => PAREN_GROUP.test(token) || BROWSER_TOKENS.test(token)).join(' ')
}

/** Electron rejects loadURL with ERR_ABORTED (-3) when a redirect or another navigation superseded it. */
export function isAbortedNavigation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ERR_ABORTED|\(-3\)/.test(message)
}
