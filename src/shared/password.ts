// A strong random password for a new account (DEC-014). Pure and shared: the screen generates it, and nothing is stored here.

const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
// A small set of symbols that sites accept almost everywhere.
const SYMBOLS = '-_!@#%&*'
const CLASSES = [LOWER, UPPER, DIGITS, SYMBOLS]

/** A uniform pick from `alphabet`, without modulo bias. */
function pick(alphabet: string, random: (limit: number) => number): string {
  return alphabet.charAt(random(alphabet.length))
}

/** A random integer below `limit` from the platform's secure generator, by rejection sampling so every value is equally likely. */
export function secureRandomBelow(limit: number): number {
  const range = 0x100000000
  const cap = range - (range % limit)
  const buffer = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buffer)
    if (buffer[0] < cap) return buffer[0] % limit
  }
}

/** At least one character of each class, the rest from all of them, shuffled. Ambiguous characters (0 O 1 l I) are left out. */
export function generatePassword(length = 20, random: (limit: number) => number = secureRandomBelow): string {
  const size = Math.max(length, CLASSES.length)
  const all = CLASSES.join('')
  const chars = CLASSES.map((set) => pick(set, random))
  while (chars.length < size) chars.push(pick(all, random))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
