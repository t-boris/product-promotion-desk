// Which addresses an owner's window can use to change WHO is signed in on an account's session (DEC-038). The owner's windows and the AI's
// page share one session (cookies, storage), so a sign-out, a sign-in or a switch of account in a window of theirs changes what the AI's page
// is signed in as. The application cannot read the cookies of a session, and every site changes them all the time; what it can see is the
// address a window went to or asked for. A sign-in, sign-out or account-switch address is the signal that means something, and a false alarm
// costs only a press that is refused (the approval is kept); a missed one is covered by the sign-in check that runs again after the mission.
// Pure: no I/O, so the browser services (built-in and Chrome) and the tests all use the one rule.

/** What was seen: the address a window navigated to (`page`), or one it asked for in the background (`request`: fetch, XHR, a beacon). */
export type AddressUse = 'page' | 'request'

const LOGIN = ['login', 'log-in', 'log_in', 'logon', 'signin', 'sign-in', 'sign_in', 'signon', 'sign-on']
const LOGOUT = ['logout', 'log-out', 'log_out', 'logoff', 'log-off', 'signout', 'sign-out', 'sign_out', 'signoff', 'sign-off']
const SWITCH = ['switch', 'switch-account', 'switch_account', 'switchaccount', 'switch-accounts', 'add-account', 'add_account', 'addaccount', 'choose-account', 'account-chooser', 'accountchooser']
const FEDERATED = ['oauth', 'oauth2', 'authorize', 'sso', 'saml', 'openid']
/** Words that name a sign-in page when they are the first label of a host (`login.example.com`, `accounts.google.com`): checked on pages only. */
const IDENTITY_HOSTS = ['login', 'signin', 'accounts', 'auth', 'sso', 'oauth', 'idp', 'identity']
/** The query keys and values that ask a page to sign out or in (`?logout=1`, `?action=logout`). */
const ACTION_KEYS = ['action', 'do', 'op', 'mode', 'act', 'cmd', 'command', 'method']

const WORDS = new Set([...LOGIN, ...LOGOUT, ...SWITCH, ...FEDERATED])
const ACTION_WORDS = new Set([...LOGIN, ...LOGOUT, ...SWITCH])
const FILE_ENDING = /\.(?:php|json|html?|aspx?|jsp|do|action)$/i

const normalize = (word: string): string => decodeURIComponentSafe(word).toLowerCase().replace(FILE_ENDING, '')

function decodeURIComponentSafe(word: string): string {
  try {
    return decodeURIComponent(word)
  } catch {
    return word
  }
}

/**
 * Whether the address is one a person uses to sign in, sign out or change account: a path segment that is such a word (`/login`, `/accounts/logout/`,
 * `/logout.php`, `/i/flow/login`, `/oauth/authorize`), a query that asks for it (`?logout=1`, `?action=logout`), and, for a page (not a background
 * request), a host that is a sign-in service (`accounts.google.com`, `login.microsoftonline.com`). Words inside a longer name (`/blog`, `login.js`,
 * `/logins-report`) are not matched, and a bare `/auth` is not either: sites poll it for a token all the time.
 */
export function isSessionAddress(address: string, use: AddressUse = 'page'): boolean {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (use === 'page') {
    const first = url.hostname.split('.')[0]?.toLowerCase() ?? ''
    if (url.hostname.includes('.') && IDENTITY_HOSTS.includes(first)) return true
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  if (segments.some((segment) => WORDS.has(normalize(segment)))) return true
  for (const [key, value] of url.searchParams) {
    const name = key.toLowerCase()
    if (ACTION_WORDS.has(name) && /^(?:1|true|yes)?$/i.test(value)) return true
    if (ACTION_KEYS.includes(name) && ACTION_WORDS.has(normalize(value))) return true
  }
  return false
}
