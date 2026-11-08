// Keeping secrets away from the AI (REQ-001): which files are never read, and how secret-looking strings are
// masked inside files that are read. Redaction errs on the side of masking too much.

import { basename } from 'node:path'

/** Reason a file must never be read because of its name, or null when the name is harmless. */
export function secretFileReason(path: string): string | null {
  const name = basename(path).toLowerCase()
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env') || name === '.envrc') return 'environment file'
  if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|identity)(?:\.|$|-)/.test(name)) return 'private key'
  if (/\.(?:pem|key|p12|pfx|jks|keystore|ppk|p8|gpg|pgp|crt|cer|der|mobileprovision)$/.test(name)) return 'key or certificate'
  if (['.npmrc', '.pypirc', '.netrc', '.htpasswd', '.git-credentials', '.dockercfg', '.pgpass'].includes(name)) return 'credentials file'
  if (/\.(?:tfstate|tfvars)(?:\.|$)/.test(name) || name.startsWith('terraform.tfstate')) return 'infrastructure state or variables'
  if (/(?:secret|credential|password|passwd|private[-_.]?key|service[-_.]?account|keystore)/.test(name)) return 'name suggests secrets'
  return null
}

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g

// Well-known token shapes.
const TOKEN_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic style keys
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g
]

// scheme://user:password@host
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi

// name = "value" / name: value, where the name says it holds a secret.
const SECRET_ASSIGNMENT =
  /([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|credential|private[_-]?key|access[_-]?key|auth[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:(["'`])([^"'`\n]{4,})\2|([^\s"'`,;{}()[\]<>]{4,}))/gi

const NON_SECRET_WORDS = /^(?:string|number|boolean|null|undefined|true|false|none|nil|any|unknown|void|required|optional|object|process|env)$/i

/** A bare value that is clearly a code reference (type, variable, member access), not a secret literal. */
function looksLikeReference(value: string): boolean {
  if (NON_SECRET_WORDS.test(value)) return true
  if (/^[$%]/.test(value)) return true
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value)
}

export interface Redaction {
  text: string
  /** Number of masked strings. */
  count: number
}

export function redactSecrets(input: string): Redaction {
  let count = 0
  const mask = (label: string) => (): string => {
    count++
    return label
  }
  let text = input.replace(PRIVATE_KEY_BLOCK, mask('[REDACTED PRIVATE KEY]'))
  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, mask('[REDACTED TOKEN]'))
  text = text.replace(URL_CREDENTIALS, (_m, scheme: string) => {
    count++
    return `${scheme}[REDACTED]@`
  })
  text = text.replace(SECRET_ASSIGNMENT, (match, head: string, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
    const value = quoted ?? bare ?? ''
    // Quoted literals are always masked; bare values only when they are not a code reference.
    if (!quote && looksLikeReference(value)) return match
    if (value.startsWith('[REDACTED')) return match
    count++
    return `${head}${quote ?? ''}[REDACTED]${quote ?? ''}`
  })
  return { text, count }
}
