// Shared pure mail helpers (REQ-013, DEC-100): IMAP server presets, preview redaction (so verification
// codes and magic links are NEVER persisted to SQLite), on-demand verification code/link extraction,
// and webmail deep-link formatting. Used by both core and renderer without any Electron or network imports.

import type { Mailbox } from './types'

export interface ImapPreset {
  label: string
  domains: readonly string[]
  host: string
  port: number
  secure: boolean
  webmailUrl: string
  hint: string
}

export const OUTLOOK_OAUTH_NOTE =
  'Personal Outlook.com / Hotmail / Live accounts require OAuth2 and no longer accept basic IMAP app passwords. Use Gmail, iCloud, Fastmail, or a domain mailbox with an app password instead.'

export const IMAP_PRESETS: readonly ImapPreset[] = [
  {
    label: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    webmailUrl: 'https://mail.google.com/mail/u/0/#inbox',
    hint: 'Enable 2-Step Verification on your Google Account and create an App Password for Mail.'
  },
  {
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    webmailUrl: 'https://www.icloud.com/mail/',
    hint: 'Generate an app-specific password at appleid.apple.com.'
  },
  {
    label: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm', 'fastmail.net', 'fastmail.org'],
    host: 'imap.fastmail.com',
    port: 993,
    secure: true,
    webmailUrl: 'https://app.fastmail.com/',
    hint: 'Create a Third-party App Password with IMAP access in Fastmail Settings.'
  },
  {
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'ymail.com'],
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    webmailUrl: 'https://mail.yahoo.com/',
    hint: 'Generate an app password under Yahoo Account Security.'
  }
]

const OUTLOOK_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com'])

export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1).trim().toLowerCase() : ''
}

export function isOutlookPersonal(address: string): boolean {
  return OUTLOOK_DOMAINS.has(emailDomain(address))
}

export function guessImapPreset(address: string): ImapPreset | null {
  const domain = emailDomain(address)
  if (!domain) return null
  return IMAP_PRESETS.find((preset) => preset.domains.includes(domain)) ?? null
}

const PREVIEW_MAX = 160

/**
 * Produces a short safe preview for SQLite storage (REQ-013): strips URLs, probable verification codes,
 * long hex/base64 tokens, and collapses whitespace so NO secrets, magic links or one-time codes are
 * ever stored on disk.
 */
export function redactPreview(raw: string): string {
  const cleaned = raw
    // Remove http(s) links and bare query-bearing domains
    .replace(/https?:\/\/[^\s<>()]+/gi, '[link]')
    .replace(/\bwww\.[^\s<>()]+/gi, '[link]')
    // Remove probable verification codes (4–8 digits, optional space/hyphen split like 123-456 or 123 456)
    .replace(/\b\d{3}[-\s]\d{3}\b/g, '[code]')
    .replace(/\b\d{4,8}\b/g, '[code]')
    // Remove long alphanumeric tokens / magic strings (>= 16 chars with letters and digits)
    .replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > PREVIEW_MAX ? `${cleaned.slice(0, PREVIEW_MAX - 1)}…` : cleaned
}

const CODE_CONTEXT = /\b(?:code|otp|passcode|pin|verification|verify|confirm|confirmation|security|login|sign[\s-]?in|one[\s-]?time)\b/i
const LINK_NOISE = /(?:unsubscribe|privacy|terms|preferences|manage[\s_-]?notifications|help\.|support\.|mailto:|\.(?:png|jpe?g|gif|svg|css|js)(?:$|\?))/i
const LINK_VERIFY = /(?:verify|confirm|activate|magic|login|signin|sign-in|auth|token|reset|validate|approve)/i

/**
 * Extracts probable verification codes (4–8 digits) and confirmation links from an on-demand plain-text
 * mail body. Runs in memory only; results are shown to the owner and never persisted or passed to AI.
 */
export function extractVerification(text: string): { codes: string[]; links: string[] } {
  const codes: string[] = []
  const seenCodes = new Set<string>()
  const addCode = (raw: string): void => {
    const clean = raw.replace(/[\s-]+/g, '')
    if (clean.length < 4 || clean.length > 8) return
    if (seenCodes.has(clean)) return
    seenCodes.add(clean)
    codes.push(clean)
  }

  // First pass: codes explicitly near verification/OTP keywords (highest precision)
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const windowText = [lines[i - 1] ?? '', lines[i] ?? '', lines[i + 1] ?? ''].join(' ')
    if (!CODE_CONTEXT.test(windowText)) continue
    const line = (lines[i] ?? '').replace(/https?:\/\/\S+/gi, ' ')
    for (const match of line.matchAll(/(?<![A-Za-z0-9/_-])(\d{3}[-\s]\d{3}|\d{4,8})(?![A-Za-z0-9/_-]|\.\d)/g)) {
      const value = match[1] ?? ''
      const digits = value.replace(/[\s-]+/g, '')
      // Skip bare 4-digit years unless the line itself explicitly mentions code/pin/otp
      if (digits.length === 4 && /^(?:19|20)\d\d$/.test(digits) && !CODE_CONTEXT.test(line)) continue
      addCode(value)
    }
  }

  // Extract confirmation / verification links (http/https only)
  const links: string[] = []
  const seenLinks = new Set<string>()
  const rawLinks = text.match(/https?:\/\/[^\s<>'")\]]+/gi) ?? []
  const verifyFirst = [...rawLinks].sort((a, b) => Number(LINK_VERIFY.test(b)) - Number(LINK_VERIFY.test(a)))
  for (const raw of verifyFirst) {
    const url = raw.replace(/[.,;:!?]+$/, '')
    if (LINK_NOISE.test(url)) continue
    if (!LINK_VERIFY.test(url) && rawLinks.length > 3) continue
    if (seenLinks.has(url)) continue
    seenLinks.add(url)
    links.push(url)
    if (links.length >= 5) break
  }

  return { codes: codes.slice(0, 5), links }
}

/**
 * Webmail URL for opening a message in the app's own browser (DEC-100).
 * Gmail supports direct deep-linking by RFC822 Message-ID; other providers open the configured webmail URL.
 */
export function webmailLinkFor(mailbox: Pick<Mailbox, 'address' | 'webmailUrl'>, messageId: string | null): string | null {
  const domain = emailDomain(mailbox.address)
  const cleanId = (messageId ?? '').replace(/^<|>$/g, '').trim()
  if ((domain === 'gmail.com' || domain === 'googlemail.com') && cleanId !== '') {
    return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${cleanId}`)}`
  }
  const configured = mailbox.webmailUrl?.trim() ?? ''
  if (/^https?:\/\//i.test(configured)) return configured
  const preset = guessImapPreset(mailbox.address)
  return preset?.webmailUrl ?? null
}

/** Strips any occurrences of a secret password from an error message before storing or displaying it. */
export function sanitizeMailError(message: string, secret?: string | null): string {
  let out = message.replace(/[\r\n]+/g, ' ').trim()
  if (secret && secret.length > 0) out = out.split(secret).join('[redacted]')
  return out.slice(0, 300) || 'Could not reach the mail server.'
}
