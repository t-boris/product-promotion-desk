// What a post mission shares with the application's send gate (B1): the approved content the AI never types itself, the lease that holds a
// send ticket for exactly one submission, and the checks the application makes on the page before it presses the control that publishes.
//
// The AI of a post mission has no way to put text into a form and none to press Enter: `browser_submit` is the only tool that does both,
// and the application runs it. It asks for a ticket (`PostAuthority.lease`), types the approved content, reads every field back, looks at
// the page again and only then presses the control. So the page holds none of the approved content before the application holds a ticket
// for it, and a click the AI makes on its own has nothing to publish. The authority itself (a gate renewal, the binding of the ticket to
// this content, account and destination, the single use) lives where the gate lives: src/core/pipeline/mission-publisher.ts.

import type { SendTicket } from '../ports'

/** What the owner approved, exactly: the application types this and nothing else. */
export interface ApprovedContent {
  kind: 'post' | 'reply'
  title: string | null
  text: string
  link: string | null
  /** Channel address for a post, comment address for a reply: where the compose page must be. */
  destination: string
}

/** One submission: a ticket held only for the length of `PostAuthority.lease`, and the point of no return. */
export interface SubmitLease {
  readonly ticket: SendTicket
  /**
   * Called right before the control that publishes is pressed. From here the content may be out: the mission is over for everything but
   * looking, and a second press is refused. Throws when a press has been attempted already.
   */
  commit(): void
  /** The press definitely did not happen (the page refused the step): the point of no return is taken back, another attempt is possible. */
  release(): void
}

export type LeaseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/** The only road from a post mission to the page's write actions. Built by the send flow from a gate grant; never by the AI. */
export interface PostAuthority {
  readonly content: ApprovedContent
  /** Whether the control that publishes has been pressed, or may have been. */
  readonly committed: boolean
  /**
   * Asks the gate for a ticket for exactly this content, account and destination (a renewal, so everything is checked again now), hands
   * it to `use`, and revokes it when `use` ends, however it ends. Refuses (ok: false) when the gate refuses, when the ticket is not the
   * one for this content, or after the press. Never gives a second ticket for a second press.
   */
  lease<T>(use: (lease: SubmitLease) => Promise<T>): Promise<LeaseResult<T>>
}

/** The pacing and the authority of a post mission; present only for that kind. */
export interface PostSetup {
  authority: PostAuthority
  /** The least time between two actions on the page (navigating, clicking, choosing, typing): a person does not act in milliseconds. */
  minGapMs: number
  /** The time in milliseconds, for the pacing. */
  now?: () => number
}

/** Everything a mission needs to start, from the send flow. */
export interface PostMissionRequest {
  /** The account the mission works in (its own browser). */
  accountId: string
  accountLabel: string
  authority: PostAuthority
  /** The platform's hosts: navigation, steps and scripts stay on them. */
  hosts: string[]
  /** The platform's name, for the brief. */
  platform: string
  /** Facts for the brief: who writes as whom, what the reply answers. Trusted ones only; the comment's text is passed apart, as data. */
  facts: string[]
  /** What the reply answers, written by someone else on the site: shown to the AI as data, never as instructions. */
  quoted?: string
}

export interface PostMissionOutcome {
  /** How the engine run ended. */
  ended: 'finished' | 'stopped' | 'timeout' | 'error'
  /** Whether the control that publishes was pressed, or may have been (the authority's word, not the AI's). */
  committed: boolean
  /** What the AI said about how it went: a note for the owner, never the verdict. */
  reported: { status: 'done' | 'needs_owner' | 'failed'; reason: string } | null
  /** A human check the page showed (a CAPTCHA), described; null when none was seen. */
  humanCheck: string | null
  /** A warning of the site that makes publishing unwise now (a rate limit, a restriction); null when none was seen. */
  warning: string | null
  /** Why the run ended in an error, when it did. */
  error: string | null
}

/** The service the send flow starts a post mission through. Implemented by the AI agent service. */
export interface PostMissionService {
  run(request: PostMissionRequest): Promise<PostMissionOutcome>
}

// ───────────────────────── checks on the page ─────────────────────────

const REF = /^e\d{1,4}$/

/**
 * Reads what a field holds right now, whole (the snapshot clamps values to 60 characters): the value of an input or a textarea, the text
 * of an editable element. `null` when there is no such element. Read-only.
 */
export function fieldValueScript(ref: string): string {
  if (!REF.test(ref)) throw new Error('A field is named by a label like e12.')
  return `(() => {
  /* ppd-field ${ref} */
  const find = (root) => {
    const hit = root.querySelector('[data-ppd-ref="${ref}"]');
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const inner = find(el.shadowRoot); if (inner) return inner; }
    return null;
  };
  const el = find(document);
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return String(el.value);
  if (el.isContentEditable) return String(el.innerText);
  return null;
})()`
}

/** Text as a person compares it: no difference in spacing, line breaks, non-breaking spaces or zero-width characters. */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const sameContent = (seen: unknown, expected: string): boolean => typeof seen === 'string' && normalizeText(seen) === normalizeText(expected)

const hostOf = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^www\./, '')

const onHosts = (host: string, hosts: string[]): boolean => hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))

/**
 * Whether the page the form is on is the place the content was approved for: a page of the platform whose path starts with the
 * destination's (the first two segments for a post: /r/name; the first four for a reply: /r/name/comments/id), and that carries every
 * query parameter the destination has. The compose page of a reply is the thread, a post's is the channel's submit page, so the paths
 * are compared by their beginning. A page the AI was led to by a link, or another channel's page, does not match.
 */
export function destinationMatches(pageUrl: string, destination: string, kind: 'post' | 'reply', hosts: string[]): boolean {
  try {
    const page = new URL(pageUrl)
    const wanted = new URL(destination)
    if (!/^https?:$/.test(page.protocol) || !/^https?:$/.test(wanted.protocol)) return false
    const pageHost = hostOf(pageUrl)
    if (!onHosts(pageHost, hosts) || !onHosts(hostOf(destination), hosts)) return false
    const segments = (path: string): string[] => path.split('/').filter((s) => s !== '').map((s) => s.toLowerCase())
    const have = segments(page.pathname)
    const want = segments(wanted.pathname).slice(0, kind === 'reply' ? 4 : 2)
    if (want.some((segment, index) => have[index] !== segment)) return false
    for (const [key, value] of wanted.searchParams) if (page.searchParams.get(key) !== value) return false
    return true
  } catch {
    return false
  }
}

const PLATFORM_WARNING =
  /\b(?:too many (?:requests|posts|comments|replies|attempts)|you(?:'|’)re doing that too (?:much|often|fast)|rate[- ]?limit(?:ed)?|slow down|try again (?:later|in)|temporarily (?:blocked|restricted|limited|unavailable)|(?:account|you) (?:has|have|is|are|was|were)\s+(?:been\s+)?(?:suspended|banned|restricted|limited|locked)|unusual activity|suspicious activity|verify (?:your )?(?:identity|account))\b/i

/** The first message of the site that says publishing is unwise now (a rate limit, a restriction), or null. Messages only, not the page text. */
export function platformWarning(alerts: string[]): string | null {
  return alerts.find((alert) => PLATFORM_WARNING.test(alert)) ?? null
}
