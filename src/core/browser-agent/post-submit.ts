// What a post mission shares with the application's send gate (B1): the approved content the AI never types itself, the lease that holds a
// send ticket for exactly one submission, and the checks the application makes on the page before it presses the control that publishes.
//
// The AI of a post mission has no way to put text into a form and none to press Enter: `browser_submit` is the only tool that does both,
// and the application runs it. It asks for a ticket (`PostAuthority.lease`), types the approved content, reads every field back, looks at
// the page again and only then presses the control. So the page holds none of the approved content before the application holds a ticket
// for it, and a click the AI makes on its own has nothing to publish: the toolbox refuses every click and every choice of the AI's own
// while any form on the page holds text, read from the page at the moment (not from a flag: an address, a draft the site restored or a
// navigation that keeps the document can all leave text in a form). The authority itself (a gate renewal, the binding of the ticket to
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
   * looking, and a second press is refused. Throws when a press has been attempted already, and when the authority was sealed.
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
  /** Whether the mission is over (the owner stopped it, the engine ended, it timed out or died): no ticket is given and no press is accepted from here on. */
  readonly sealed: boolean
  /**
   * Ends the mission's right to press, at once and for good: `lease` refuses, and a lease already given can no longer `commit`. The point
   * of no return can only move before this, so what `committed` says after it is final (a call still running when the engine ended, or
   * when the owner pressed Stop, cannot press after the application has read it). Called by whoever ends the mission.
   */
  seal(): void
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

/** A text-entry element of the page that holds text, as the page reports it. `ref` is its label when the AI could have been shown it. */
export interface HeldText {
  ref: string | null
  text: string
}

const MAX_HELD = 20
const MAX_HELD_TEXT = 20_000

/**
 * Reads every place on the whole page (shadow roots included, hidden elements too) where a person could have put text: text-like
 * inputs, textareas, editable elements. Answers the ones that hold something other than blanks, with what they hold. Read-only.
 * The page is the one fact the application trusts about "is there text in a form": a flag kept by the application cannot know what a
 * same-document navigation, a draft the site restored or an address that prefilled the form left in it.
 */
export function formTextScript(): string {
  return `(() => {
  /* ppd-form-text */
  const TYPES = ['', 'text', 'search', 'url', 'email', 'tel'];
  const blank = (text) => text.replace(/[\\s\\u200b-\\u200d\\u2060\\ufeff]/g, '') === '';
  const found = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('input,textarea,[contenteditable],[role=textbox]')) {
      const tag = el.tagName.toLowerCase();
      let text = '';
      if (tag === 'textarea') text = String(el.value);
      else if (tag === 'input') { if (!TYPES.includes((el.getAttribute('type') || '').toLowerCase())) continue; text = String(el.value); }
      else if (el.isContentEditable) text = String(el.innerText || el.textContent || '');
      else continue;
      if (blank(text)) continue;
      found.push({ ref: el.getAttribute('data-ppd-ref'), text: text.slice(0, ${MAX_HELD_TEXT}) });
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return found.slice(0, ${MAX_HELD});
})()`
}

/** Checks the shape of what the page answered to `formTextScript`; null when it is not an answer (the caller then treats the page as unreadable). */
export function parseHeldText(raw: unknown): HeldText[] | null {
  if (!Array.isArray(raw)) return null
  const held: HeldText[] = []
  for (const entry of raw.slice(0, MAX_HELD)) {
    if (typeof entry !== 'object' || entry === null) return null
    const e = entry as Record<string, unknown>
    if (typeof e.text !== 'string') return null
    held.push({ ref: typeof e.ref === 'string' && REF.test(e.ref) ? e.ref : null, text: e.text })
  }
  return held
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

const SUBMIT_VERBS = ['post', 'reply', 'comment', 'submit', 'publish', 'save', 'send', 'add', 'answer', 'write', 'leave', 'отправить', 'опубликовать', 'ответить', 'комментировать', 'сохранить', 'добавить', 'оставить', 'написать']
const SUBMIT_NOUNS = ['comment', 'reply', 'post', 'answer', 'response', 'message', 'thread', 'topic', 'комментарий', 'ответ', 'пост', 'сообщение', 'тему']
const SUBMIT_FILLER = ['a', 'an', 'your', 'the', 'new']

/**
 * Whether the name of a control is that of one that publishes what was typed into a form: a verb of publishing, alone or with what it
 * publishes ("Post", "Reply", "Comment", "Add a comment", "Submit post", "Save", "Опубликовать"). It is the whole name that counts, so a
 * control that only mentions one ("Report comment", "Delete reply", "Comment as u/someone") is not one. The approved content is typed
 * into a form and a control is pressed on the AI's word: this keeps that control from being any element of the page.
 */
export function looksLikeSubmit(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '')
  const [verb, ...rest] = words
  if (!verb || words.length > 4 || !SUBMIT_VERBS.includes(verb)) return false
  const nouns = rest.filter((w) => !SUBMIT_FILLER.includes(w))
  return nouns.length <= 1 && nouns.every((w) => SUBMIT_NOUNS.includes(w))
}

const PLATFORM_WARNING =
  /\b(?:too many (?:requests|posts|comments|replies|attempts)|you(?:'|’)re doing that too (?:much|often|fast)|rate[- ]?limit(?:ed)?|slow down|try again (?:later|in)|temporarily (?:blocked|restricted|limited|unavailable)|(?:account|you) (?:has|have|is|are|was|were)\s+(?:been\s+)?(?:suspended|banned|restricted|limited|locked)|unusual activity|suspicious activity|verify (?:your )?(?:identity|account))\b/i

/** The first message of the site that says publishing is unwise now (a rate limit, a restriction), or null. Messages only, not the page text. */
export function platformWarning(alerts: string[]): string | null {
  return alerts.find((alert) => PLATFORM_WARNING.test(alert)) ?? null
}
