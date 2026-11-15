// An own update (DEC-033) may state what the owner's note says and nothing else. The model is told so and must say so itself
// (`addsFactsBeyondNote`; a missing answer counts as "yes it added something"); this is the part a rule can check, so it does not rest on the
// model's word: no number, number word or address in the post that the note does not contain. Names of people, places and products are not
// checked by a rule (a rule cannot tell a name from a word at the start of a sentence): they are for the model's flag and for the owner,
// who reads every draft before it can go anywhere.

/** Any number written with digits of any script, with its separators, and the other number signs (fractions, superscripts, roman numerals). */
const NUMBER = /\p{N}[\p{N}.,]*/gu

/** A number as it is compared: no trailing punctuation, one decimal mark. */
const normalized = (value: string): string => value.replace(/[.,]+$/, '').replace(',', '.')

/** The ways a number may be written for the same amount: "1,000" and "1.000" and "1000" are one amount in the two ways of writing a thousand. */
function forms(value: string): string[] {
  const number = normalized(value.replace(/[.,]+$/, ''))
  const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(value.replace(/[.,]+$/, '')) ? value.replace(/[.,]+$/, '').replace(/[.,]/g, '') : null
  return grouped ? [number, grouped] : [number]
}

/** Number words, with the amount they stand for ("one" is left out: it is mostly a pronoun). */
const WORDS: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  dozen: '12', dozens: '12', hundred: '100', hundreds: '100', thousand: '1000', thousands: '1000', million: '1000000', millions: '1000000', billion: '1000000000', billions: '1000000000'
}
const WORD = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi')

interface Amount {
  shown: string
  forms: string[]
}

function amountsOf(text: string): Amount[] {
  const found: Amount[] = []
  for (const match of text.matchAll(NUMBER)) found.push({ shown: normalized(match[0]), forms: forms(match[0]) })
  for (const match of text.matchAll(WORD)) found.push({ shown: match[1].toLowerCase(), forms: [WORDS[match[1].toLowerCase()]] })
  return found
}

/** The numbers (amounts, counts, versions, years) of a text, as written. */
export function numbersOf(text: string): Set<string> {
  return new Set(amountsOf(text).flatMap((amount) => amount.forms))
}

/** The numbers of the post that the note does not contain, in the order they appear. */
export function numbersNotInNote(post: string, note: string): string[] {
  const known = numbersOf(note)
  const missing: string[] = []
  for (const amount of amountsOf(post)) {
    if (!amount.forms.some((form) => known.has(form)) && !missing.includes(amount.shown)) missing.push(amount.shown)
  }
  return missing
}

// ───────────── addresses ─────────────

const ADDRESS = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?::\d+)?(?:\/[^\s)\]>"']*)?/gi

export interface Address {
  host: string
  /** The path without a trailing slash, query or fragment; empty for the host alone. */
  path: string
}

/** The web addresses written in a text, as a host and a path (a bare domain counts as well as one with its scheme). */
export function addressesIn(text: string): Address[] {
  const out: Address[] = []
  for (const match of text.matchAll(ADDRESS)) {
    const bare = match[0].replace(/^https?:\/\//i, '').replace(/[.,;:!?'"]+$/, '')
    const slash = bare.indexOf('/')
    const host = (slash === -1 ? bare : bare.slice(0, slash)).replace(/:\d+$/, '').toLowerCase().replace(/^www\./, '')
    const path = slash === -1 ? '' : bare.slice(slash).split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase()
    out.push({ host, path })
  }
  return out
}

/**
 * The addresses of the post that are on a host the note names but are not an address the note gives: the note says "github.com/owner/repo", the
 * post may say that and what is below it, not "github.com/someone-else". A host the note gives alone ("github.com") allows that host alone.
 */
export function addressesNotInNote(post: string, note: string, exceptHost: string | null): string[] {
  const given = addressesIn(note)
  const hosts = new Set(given.map((a) => a.host))
  const missing: string[] = []
  for (const address of addressesIn(post)) {
    if (!hosts.has(address.host) || address.host === exceptHost) continue
    const fine = given.some((g) => g.host === address.host && (g.path === address.path || (g.path !== '' && address.path.startsWith(`${g.path}/`))))
    const shown = `${address.host}${address.path}`
    if (!fine && !missing.includes(shown)) missing.push(shown)
  }
  return missing
}
