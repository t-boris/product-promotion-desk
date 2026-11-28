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

import { sha256OfFile } from '../pipeline/util'
import { acceptsFile, takesLine } from './snapshot'
import type { SendTicket } from '../ports'

/** A picture the owner approved, as the mission may put it into a file input: by its name, never by a path the AI gives. */
export interface ApprovedFile {
  /** What the AI calls it: the one name it may pass to browser_attach. */
  name: string
  /** Where the copy of the library is (the AI never sees it). */
  path: string
  /** What the approval was bound to: the file is read again and must still hash to this before it goes into a form. */
  sha256: string
}

/** What the owner approved, exactly: the application types this and nothing else, and puts these files into the form and nothing else. */
export interface ApprovedContent {
  kind: 'post' | 'reply'
  title: string | null
  text: string
  link: string | null
  /** Channel address for a post, comment address for a reply: where the compose page must be. */
  destination: string
  /** The pictures of the approved post, in order (none for a reply). Each goes into the form once, by browser_attach, before browser_submit. */
  attachments?: ApprovedFile[]
  /** The approved flair by name. The application chooses it on the form (browser_flair) and reads it back; the AI never gives or changes it. Null or left out: none. */
  flair?: string | null
  /** The approved topic of the post (Threads). The application types it into the field the AI names (browser_submit's topic_ref) and reads it back; the AI never gives or changes it. Null or left out: none. */
  topicTag?: string | null
}

/** One submission: a ticket held only for the length of `PostAuthority.lease`, and the point of no return. */
export interface SubmitLease {
  readonly ticket: SendTicket
  /**
   * Called right before the control that publishes is pressed. From here the content may be out: the mission is over for everything but
   * looking, and a second press is refused. Throws when a press has been attempted already, and when the authority was sealed.
   */
  commit(): void
  /**
   * The press definitely did not happen (the page answered before any input reached it: the control or the page was not there): the point
   * of no return is taken back, another attempt is possible. Never for an answer that may follow input that landed; then it stays, and the
   * read-back of the site decides.
   */
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
   * Whether the owner used a sign-in or sign-out page of the account's session since the mission checked who is signed in (DEC-038). From then on
   * the check is out of date: no ticket is given, no press is accepted, and the mission's other steps are refused too. Nothing is submitted.
   */
  readonly sessionMoved: boolean
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
  /** The control of the form that is marked required and that nothing approved answers (a flair the post has none of), when the application refused to press for it; null otherwise. */
  required?: string | null
  /** Why the run ended in an error, when it did. */
  error: string | null
  /**
   * What the AI did, in a few words a step (the tool it called, the address it opened, the label of what it pressed, why a call was refused): for the
   * log when the publication does not go through. Never a typed text or the words of a page (see `StepTrace`). Absent when the mission had no toolbox.
   */
  steps?: string | null
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

/**
 * The files a labelled file input holds now, as the page reports them (`[{ name, size }]`), or null when the label is not a file input.
 * A site often empties the input once it has read the files, so an empty list is not proof that nothing went in. Read-only.
 */
export function filesHeldScript(ref: string): string {
  if (!REF.test(ref)) throw new Error('A file input is named by a label like e12.')
  return `(() => {
  /* ppd-files ${ref} */
  const find = (root) => {
    const hit = root.querySelector('[data-ppd-ref="${ref}"]');
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const inner = find(el.shadowRoot); if (inner) return inner; }
    return null;
  };
  const el = find(document);
  if (!el || el.tagName !== 'INPUT' || el.type !== 'file') return null;
  return Array.from(el.files || []).map((f) => ({ name: String(f.name), size: Number(f.size) }));
})()`
}

export function parseHeldFiles(value: unknown): { name: string; size: number }[] | null {
  if (!Array.isArray(value)) return null
  const files: { name: string; size: number }[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const { name, size } = item as { name?: unknown; size?: unknown }
    if (typeof name !== 'string' || typeof size !== 'number') return null
    files.push({ name, size })
  }
  return files
}

/**
 * A text that is the same for as long as this document lives and differs in the next one: a link that loads a new page, a reload, a form
 * that posts. A change of the fragment keeps the document (and what is in its form), so it keeps the text. What the mission knows about
 * the form (the pictures are in it) is true of one document, and is read from this, not kept as a history of calls.
 */
export const DOCUMENT_TOKEN_SCRIPT = '(() => /* ppd-document */ String(performance.timeOrigin))()'

/** A text-entry element of the page that holds text, as the page reports it. `ref` is its label when the AI could have been shown it. */
export interface HeldText {
  ref: string | null
  text: string
  /** What the place is, for a sentence to the AI and the log: its tag, its type and its name or id ("textarea g-recaptcha-response"). Never its content. */
  field: string
}

const MAX_HELD = 20
const MAX_HELD_TEXT = 20_000

/**
 * Reads every place the page keeps text a person could have put into a form, and answers the ones that hold something other than blanks,
 * with what they hold. Read-only. The page is the one fact the application trusts about "is there text in a form": a flag kept by the
 * application cannot know what a same-document navigation, a draft the site restored or an address that prefilled the form left in it.
 *
 * What it reads: text boxes (the `type` PROPERTY of an input, as a browser resolves it: an unknown or missing type is a text box, which an
 * attribute check would call something else), textareas, editable elements (contenteditable, any tag), hidden inputs that are named like
 * a body, a title or a link (a site mirrors an editor's text there; the other hidden inputs hold tokens and ids and would hide every
 * page), with shadow roots and same-origin frames walked.
 * What it does not count: a textarea that no person can see (it has no box on the page) and that no editor mirrors a body into (its name is not
 * that of a body, a title or a link), and any field named like a token (a captcha's answer, a csrf token, a nonce). Reddit's page carries a hidden
 * `g-recaptcha-response` textarea holding two thousand characters of token on every thread: counting it refused every click and every submission.
 * What it cannot read: a frame of another origin (the browser does not let a script in), a closed shadow root, and text a site keeps in
 * script memory and draws on a canvas. Such a place is not known to be empty and is not reported as holding text either.
 */
export function formTextScript(): string {
  return `(() => {
  /* ppd-form-text */
  const TYPES = ['text', 'search', 'url', 'email', 'tel'];
  const MIRRORS = /^(?:text|body|title|comment|content|message|selftext|description|url|link|reply)$/i;
  const TOKENS = /captcha|turnstile|csrf|xsrf|token|nonce/i;
  const blank = (text) => text.replace(/[\\s\\u200b-\\u200d\\u2060\\ufeff]/g, '') === '';
  const found = [];
  const seen = new Set();
  const walk = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    for (const el of root.querySelectorAll('input,textarea,[contenteditable],[role=textbox]')) {
      const tag = el.tagName.toLowerCase();
      let text = '';
      if (tag === 'textarea') {
        const name = el.name || el.id || '';
        if (TOKENS.test(name) || (!MIRRORS.test(name) && el.getClientRects().length === 0)) continue;
        text = String(el.value);
      }
      else if (tag === 'input') {
        const type = String(el.type || 'text').toLowerCase();
        if (type === 'hidden') { if (!MIRRORS.test(el.name || el.id || '')) continue; }
        else if (!TYPES.includes(type)) continue;
        // A text box nobody can see (display: none) belongs to a view of the form that is not shown: Reddit's submit page keeps "Start now" and "4 hours"
        // in the boxes of its event and poll views. Like a textarea nobody can see, it is not what a press publishes, unless its name says it mirrors the post.
        if (type !== 'hidden' && !MIRRORS.test(el.name || el.id || '') && el.getClientRects().length === 0) continue;
        text = String(el.value);
      }
      else if (el.isContentEditable) text = String(el.innerText || el.textContent || '');
      else continue;
      if (blank(text)) continue;
      const kind = tag === 'input' ? 'input ' + String(el.type || 'text').toLowerCase() : tag;
      found.push({ ref: el.getAttribute('data-ppd-ref'), text: text.slice(0, ${MAX_HELD_TEXT}), field: (kind + ' ' + (el.name || el.id || '')).trim().slice(0, 60) });
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    for (const frame of root.querySelectorAll('iframe,frame')) {
      try { walk(frame.contentDocument); } catch (e) { /* a frame of another origin: not readable */ }
    }
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
    held.push({ ref: typeof e.ref === 'string' && REF.test(e.ref) ? e.ref : null, text: e.text, field: typeof e.field === 'string' ? e.field.slice(0, 60) : '' })
  }
  return held
}

/**
 * Why an approved picture may not go into a form now, or null. The file is read again and must hash to what the approval was bound to: a
 * file that was replaced or changed on disk since the owner approved it is not what was approved, and nothing is uploaded in its place.
 */
export async function approvedFileProblem(file: ApprovedFile): Promise<string | null> {
  try {
    return (await sha256OfFile(file.path)) === file.sha256 ? null : `"${file.name}" is not the picture that was approved (it changed on this computer). The owner must look at the post again.`
  } catch {
    return `"${file.name}" cannot be read any more. The owner must look at the post again.`
  }
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

const COMPOSER_DIALOG_HOSTS = ['instagram.com', 'facebook.com', 'fb.com', 'threads.net', 'threads.com']

/**
 * Whether the platform of this destination makes a new post in a dialog over its own pages (Instagram's Create, Facebook's composer,
 * Threads' composer), so that the form is not at an address of its own. A list of the platforms this application has recipes for, not
 * "everything that is not Reddit": a platform nobody has looked at gets the stricter rule.
 */
export function usesComposerDialog(destination: string): boolean {
  try {
    return onHosts(hostOf(destination), COMPOSER_DIALOG_HOSTS)
  } catch {
    return false
  }
}

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
    // A platform whose new-post form is a dialog over its own pages (Instagram's Create, Facebook's composer) has no compose address: for a post
    // there, the front page of the site is a place of the post too. Nowhere else: Reddit's community pages are its places, not its front page.
    if (kind === 'post' && have.length === 0 && usesComposerDialog(destination)) return true
    // A destination with no path (the root of a site) is the root and nothing under it: the host alone is not a place.
    if (want.length === 0 && have.length > 0) return false
    if (want.some((segment, index) => have[index] !== segment)) return false
    for (const [key, value] of wanted.searchParams) if (page.searchParams.get(key) !== value) return false
    return true
  } catch {
    return false
  }
}

const SUBMIT_VERBS = ['post', 'reply', 'comment', 'submit', 'publish', 'save', 'send', 'add', 'answer', 'write', 'leave', 'share', 'отправить', 'опубликовать', 'ответить', 'комментировать', 'сохранить', 'добавить', 'оставить', 'написать', 'поделиться']
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

const PROGRESS_VERBS = ['next', 'continue', 'далее', 'дальше', 'продолжить']
const PROGRESS_FILLER = ['step', 'шаг']

/**
 * Whether the name of a control is one that only goes on to the next step of a form that is being filled (Instagram's "Next" after a
 * picture was chosen, a "Continue"): the whole name counts, so "Next post", "Continue reading" and "Next page of comments" are not. Once a
 * picture is in the form, these are the only controls a post mission clicks: anything else could be the one that publishes under a name
 * nobody has listed, and what is not recognised is left to the owner.
 */
export function looksLikeProgress(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '')
  const [verb, ...rest] = words
  return verb !== undefined && PROGRESS_VERBS.includes(verb) && words.length <= 2 && rest.every((w) => PROGRESS_FILLER.includes(w))
}

/**
 * Whether a click on this control would open the system's file chooser: a file input itself, or a button or link whose whole name says it
 * picks a file or a picture from the computer ("Select from computer", "Choose files", "Upload a photo"). A chooser is a window of the
 * operating system that nobody answers and that holds the browser until a person does, so a post mission never clicks one: the picture
 * goes into the file input by browser_attach, which needs no chooser.
 */
const FILE_CHOOSER_NAME = new RegExp(
  [
    // select / choose / browse / upload / pick / add, then what, then where from: "Select files", "Upload a photo", "Select photos and videos from your device"
    '^(?:select|choose|browse|upload|pick|add)(?:\\s+(?:a|an|the|your|some))?\\s+(?:files?|photos?|pictures?|images?|videos?|media)(?:(?:\\s+(?:and|or)\\s+|\\s*/\\s*)(?:files?|photos?|pictures?|images?|videos?))?(?:\\s+(?:from|on)\\s+(?:your\\s+|the\\s+|this\\s+)?(?:computer|device|mac|desktop|pc))?$',
    // "Select from computer", "Upload from your device", "Browse"
    '^(?:browse|upload)(?:\\s+(?:from|on)\\s+(?:your\\s+|the\\s+|this\\s+)?(?:computer|device|mac|desktop|pc))?$',
    '^(?:select|choose|pick)\\s+(?:from|on)\\s+(?:your\\s+|the\\s+|this\\s+)?(?:computer|device|mac|desktop|pc)$',
    '^(?:выбрать|загрузить|добавить)\\s+(?:файлы?|фото|изображение|картинку|видео)(?:\\s+(?:с|на)\\s+(?:компьютер[ае]?|устройств[ае]))?$',
    '^(?:выбрать|загрузить)\\s+(?:с|на)\\s+(?:компьютер[ае]?|устройств[ае])$'
  ].join('|'),
  'i'
)

export function opensFileChooser(control: { role: string; name: string }): boolean {
  if (control.role === 'input:file') return true
  return /^(?:button|link|input:button|menuitem)$/.test(control.role) && FILE_CHOOSER_NAME.test(control.name.replace(/\s+/g, ' ').trim())
}

/** Whether an element of the page takes a file: only a file input, and one that is not disabled. A button that opens a file chooser is not one (the chooser belongs to the person). */
export function isAttachControl(control: { role: string; disabled?: boolean }): boolean {
  return control.role === 'input:file' && control.disabled !== true
}

/**
 * Why a file input cannot take the approved files, as words for the AI, or null when it can (or when the page does not say). A site keeps several
 * inputs in one form (one for pictures, one for videos, one for its gallery) and none has a label: what each says it takes is the only thing that tells
 * them apart. Refused only when it is certain: a kind the input does not list, or one file at a time while several were approved.
 */
export function fileInputProblem(input: { ref: string; accepts?: string; several?: boolean }, files: readonly { name: string }[]): string | null {
  const misfit = files.filter((f) => !acceptsFile(input.accepts, f.name))
  if (misfit.length > 0) return `${input.ref} takes ${takesLine(input)}, and ${misfit.map((f) => f.name).join(', ')} ${misfit.length === 1 ? 'is' : 'are'} not of a kind it takes. Choose a file input whose "takes" says it takes ${files.length === 1 ? 'this file' : 'these files'}.`
  if (files.length > 1 && input.several === false) return `${input.ref} takes one file at a time and ${files.length} were approved. Choose a file input whose "takes" says several files at once; if there is none, call report_result with needs_owner.`
  return null
}

/**
 * The community a destination of Reddit's shape (/r/<community>) names, and the page where a new post for it is written and published:
 * /r/<community>/submit (old.reddit.com/r/<sub>/submit, with ?selftext=true for a text post; www.reddit.com/r/<sub>/submit/?type=IMAGE for
 * a picture post: the shapes the connector opens). Null for a destination of any other shape: the application does not know where such a
 * site keeps its compose page, and does not guess.
 */
export function composePageOf(destination: string): string[] | null {
  try {
    const segments = new URL(destination).pathname.split('/').filter((s) => s !== '').map((s) => s.toLowerCase())
    return segments[0] === 'r' && segments[1] ? ['r', segments[1], 'submit'] : null
  } catch {
    return null
  }
}

/** Whether `pageUrl` is the compose page `composePageOf` names (the path only: the query, a fragment and a trailing slash do not matter). */
export function onComposePage(pageUrl: string, destination: string): boolean {
  const wanted = composePageOf(destination)
  if (!wanted) return true
  try {
    const have = new URL(pageUrl).pathname.split('/').filter((s) => s !== '').map((s) => s.toLowerCase())
    return have.length === wanted.length && wanted.every((segment, index) => have[index] === segment)
  } catch {
    return false
  }
}

/**
 * What a reply's destination says about the thing it answers, when the destination has Reddit's shape (/r/<sub>/comments/<post>/<slug>/
 * <comment>): the post's own name (t3_...) and, when the address names one, the comment's (t1_...). Null for any other shape.
 */
export function replyTarget(destination: string): { post: string; comment: string | null } | null {
  try {
    const segments = new URL(destination).pathname.split('/').filter((s) => s !== '').map((s) => s.toLowerCase())
    if (segments[0] !== 'r' || segments[2] !== 'comments' || !segments[3]) return null
    return { post: `t3_${segments[3]}`, comment: segments[5] ? `t1_${segments[5]}` : null }
  } catch {
    return null
  }
}

/**
 * What changes or shows the account's own profile (DEC-035): editing it, the profile or cover photo, an avatar, the bio, the name, the
 * username, the phone number or e-mail, the password, the birthday, the settings. A post mission publishes the approved content and does
 * nothing to the account itself, so none of these is pressed, chosen or given a file. Phrases, not single words, where a single word
 * would also name a control of the post ("Add photo", "Name"): whole words, English and Russian.
 */
const PROFILE_PHRASES = [
  'edit\\s+(?:your\\s+)?(?:profile|bio|name|username|intro|details|about|page|public\\s+details)',
  '(?:change|update|add|replace|set|new|remove)\\s+(?:your\\s+|a\\s+|the\\s+|new\\s+|current\\s+)*(?:profile|avatar|bio|display\\s+name|username|phone|e\\s?mail|birthday|gender|pronouns|password|name)',
  'profile\\s*(?:photos?|pictures?|pics?|images?|img|avatars?|settings|info|information)', '(?:photo|picture|pic|image)s?\\s+profile', 'user\\s*pics?', 'pfp', 'cover\\s+(?:photo|picture|image)', 'avatar', 'bio', 'user\\s*name', 'display\\s+name', 'phone(?:\\s+number)?', 'birthday', 'gender', 'pronouns', 'password',
  'personal\\s+(?:info|information|details)', '(?:account\\s+)?settings',
  'редактир\\p{L}*\\s+профил\\p{L}*', 'профил\\p{L}*\\s+(?:фото|настройк\\p{L}*)', 'фото\\s+профил\\p{L}*',
  '(?:измен\\p{L}*|обнов\\p{L}*|добав\\p{L}*|удал\\p{L}*)\\s+(?:ваш\\p{L}*\\s+|свое\\p{L}*\\s+|нов\\p{L}*\\s+|текущ\\p{L}*\\s+)*профил\\p{L}*',
  '(?:измен\\p{L}*|смен\\p{L}*|обнов\\p{L}*|добав\\p{L}*|удал\\p{L}*)\\s+(?:ваш\\p{L}*\\s+|свое\\p{L}*\\s+|нов\\p{L}*\\s+|текущ\\p{L}*\\s+)*(?:аватар\\p{L}*|био\\p{L}*|имя|телефон\\p{L}*|парол\\p{L}*|номер\\s+телефона)',
  // Other languages of the sites (Spanish, Portuguese, Italian, German, French, Ukrainian): the profile, its photo, the user name, the password, the settings.
  '(?:editar|cambiar|modificar|actualizar|modifica|cambia|aggiorna|modifier|changer|mettre\\s+à\\s+jour|bearbeiten|ändern|редагувати|змінити|оновити)\\s+(?:(?:el|la|tu|tus|su|seu|sua|o|a|il|la|le|mon|ma|votre|ton|dein|deine|dein|ваш\\p{L}*)\\s+)*(?:perfil|profilo|profil|профіл\\p{L}*|foto\\s+(?:de(?:l)?\\s+)?perfil|foto\\s+do\\s+perfil|foto\\s+del\\s+profilo|photo\\s+de\\s+profil|profilbild)',
  'foto\\s+(?:de(?:l)?|do)\\s+perfil', 'foto\\s+del\\s+profilo', 'photo\\s+de\\s+profil', 'profilbild(?:er|ern|es|s|e)?', 'profil\\s+(?:bearbeiten|ändern)', 'imagen\\s+de\\s+perfil', 'imagem\\s+do\\s+perfil', 'immagine\\s+del\\s+profilo',
  'nombre\\s+de\\s+usuario', 'nome\\s+(?:de\\s+)?utente', 'nome\\s+de\\s+usu[aá]rio', 'benutzername', 'nom\\s+d[\'’]utilisateur', 'contrase[nñ]a', 'senha', 'passwort', 'mot\\s+de\\s+passe', 'configuraci[oó]n', 'configura[cç][oõ]es', 'impostazioni', 'einstellungen', 'param[eè]tres',
  'biograf[ií]a', 'biografie', 'biographie', 'пароль', 'налаштуван\\p{L}*', 'ім[\'’]я\\s+користувач\\p{L}*', 'біографі\\p{L}*', 'фото\\s+профіл\\p{L}*', 'зображен\\p{L}*\\s+профил\\p{L}*', 'изображен\\p{L}*\\s+профил\\p{L}*',
  'аватар\\p{L}*', 'био(?:графи\\p{L}*)?', 'имя\\s+пользовател\\p{L}*', 'номер\\s+телефона', 'телефон', 'парол\\p{L}*', 'настройк\\p{L}*', '(?:день|дата)\\s+рождения'
]
const PROFILE_WORDS = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PROFILE_PHRASES.join('|')})(?![\\p{L}\\p{N}])`, 'iu')

/** Whether a name (of a control, or what stands around a file input) is about the account's own profile: a post mission neither presses it nor gives it a file. */
export function changesProfile(text: string): boolean {
  // The name of an input is often written the way code is (profile_pic, profile-photo, profile.photo, profilePhoto): the words are read apart before they are matched.
  return PROFILE_WORDS.test(text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.:/]+/g, ' '))
}

/**
 * Controls whose press does something to the account that no approved content asked for: joining or leaving a community, following,
 * voting, blocking, deleting, reporting, muting, signing out, and granting a site access to the account (OAuth "Allow", "Authorize"),
 * and changing the profile (`changesProfile`). The
 * words are the English ones and their Russian translations; a stem catches the state forms ("Joined", "Following" are buttons that undo
 * what they say). Matched on whole words, so "Followers" and "Reportage" are not caught.
 */
const NEVER_CLICKED = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
    [
      'join(?:ed|s)?', 'follow(?:ing|ed)?', 'unfollow(?:ing|ed)?', 'subscribe(?:d)?', 'subscribed', 'unsubscribe', 'vote(?:d|s)?', 'upvote(?:d|s)?', 'downvote(?:d|s)?', 'block(?:ed)?', 'unblock', 'mute(?:d)?',
      'delete(?:d)?', 'remove(?:d)?', 'report(?:ed)?', 'flag(?:ged)?', 'ban(?:ned)?', 'allow', 'authori[sz]e', 'grant', 'log\\s*out', 'sign\\s*out', 'logout', 'signout',
      'вступи\\p{L}*', 'присоедин\\p{L}*', 'подпис\\p{L}*', 'отпис\\p{L}*', 'проголос\\p{L}*', 'голосов\\p{L}*', 'заблокир\\p{L}*', 'удал\\p{L}*', 'пожалов\\p{L}*', 'жалоб\\p{L}*', 'разреш\\p{L}*', 'авториз\\p{L}*', 'выйти', 'замьют\\p{L}*'
    ].join('|') +
    ')(?![\\p{L}\\p{N}])',
  'iu'
)

/** Whether the name of a control says it does something other than publish the approved content (see NEVER_CLICKED): a post mission clicks none of them. */
export function neverClicked(name: string): boolean {
  return NEVER_CLICKED.test(name) || changesProfile(name)
}

/**
 * Controls that set something about the post itself that the owner did not approve: the community it goes to (a picker, "Post to",
 * "Choose a community"), its flair and tags, NSFW, spoiler, "mark as", a schedule, a crosspost, posting as the profile. The approved
 * destination is the address of the form, and nothing else of the form is changed by the AI: a post that needs one of these (a community
 * that requires a flair) ends the mission as needs_owner, which is the safe failure. A post-type tab (Text, Link, Images), a consent or a
 * dialog-dismiss button is none of them. English and Russian, whole words. LIVE ACCEPTANCE: the words are those of Reddit's two layouts as
 * far as they are known; they must be checked on a real compose page, which shows what a picker is really called.
 */
const POST_SETTING = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
    [
      'flairs?', 'tags?', 'nsfw', 'not\\s+safe\\s+for\\s+work', '18\\s*\\+', 'spoilers?', 'mark(?:ed)?\\s+as', 'schedul(?:e|es|ed|ing)', 'cross-?post(?:s|ed|ing)?',
      '(?:post|posting)\\s+(?:to|as)', '(?:post|posting)\\s+(?:in|on)(?=\\s+[ru]/)',
      '(?:choose|select|pick|change|switch)\\s+(?:an?\\s+|the\\s+|your\\s+|another\\s+|different\\s+)?(?:community|communities|subreddit|profile)',
      'фл[еэ]й?р\\p{L}*', 'тег\\p{L}*', 'метк\\p{L}*', 'отмет\\p{L}*', 'помет\\p{L}*', 'спойлер\\p{L}*', 'для\\s+взрослых', 'запланир\\p{L}*', 'отложен\\p{L}*', 'расписани\\p{L}*', 'кросс-?пост\\p{L}*',
      '(?:выбер\\p{L}*|выбрать|смен\\p{L}*|изменить)\\s+(?:\\p{L}+\\s+)?(?:сообществ\\p{L}*|профил\\p{L}*)', 'опубликовать\\s+(?:в|от|как)'
    ].join('|') +
    ')(?![\\p{L}\\p{N}])',
  'iu'
)

/** Whether a control sets the community, flair, tags, NSFW, spoiler, schedule, crosspost or posting-as of a post (see POST_SETTING): a post mission clicks and chooses none of them. */
export function changesPostSettings(control: { role: string; name: string }): boolean {
  if (POST_SETTING.test(control.name)) return true
  // A picker that shows the community or the profile ("r/test", "u/someone" on a button, a list, a box); a link of that name only goes there.
  return control.role !== 'link' && /^\s*\/?[ru]\/[\w-]+/i.test(control.name)
}

/** The community a destination of Reddit's shape names ("test" for /r/test), or null. */
export function communityOf(destination: string): string | null {
  return composePageOf(destination)?.[1] ?? null
}

const COMMUNITY_FIELD_NAME = /(?<![\p{L}\p{N}])(?:community|communities|subreddit|сообществ\p{L}*|sr)(?![\p{L}\p{N}])/iu
const COMMUNITY_FIELD_ROLE = /^(?:input:(?:text|search)|textbox|combobox|select)$/

/**
 * The community the form shows, when a field of the page says it clearly: a text box, a search box or a list named like a community whose
 * value is "r/name" (or a plain name of one word). A value of several words ("Choose a community") is a placeholder and says nothing.
 * Returns the names the fields show, in the lower case, without "r/"; empty when no field says one.
 */
export function communitiesShown(elements: { role: string; name: string; value?: string }[]): string[] {
  const shown: string[] = []
  for (const e of elements) {
    if (!COMMUNITY_FIELD_ROLE.test(e.role) || !COMMUNITY_FIELD_NAME.test(e.name) || !e.value) continue
    const value = e.value.trim().replace(/^\//, '')
    const prefixed = /^r\/([\w-]+)(?![\w-])/i.exec(value)
    const plain = /^[\w-]{2,21}$/.exec(value)
    const name = prefixed?.[1] ?? plain?.[0]
    if (name) shown.push(name.toLowerCase())
  }
  return shown
}

const PLATFORM_WARNING =
  /\b(?:too many (?:requests|posts|comments|replies|attempts)|you(?:'|’)re doing that too (?:much|often|fast)|rate[- ]?limit(?:ed)?|slow down|try again (?:later|in)|temporarily (?:blocked|restricted|limited|unavailable)|(?:account|you) (?:has|have|is|are|was|were)\s+(?:been\s+)?(?:suspended|banned|restricted|limited|locked)|unusual activity|suspicious activity|verify (?:your )?(?:identity|account))\b/i

/** The first message of the site that says publishing is unwise now (a rate limit, a restriction), or null. Messages only, not the page text. */
export function platformWarning(alerts: string[]): string | null {
  return alerts.find((alert) => PLATFORM_WARNING.test(alert)) ?? null
}

/** The places that hold text, in words for the AI and the log: what each is and how long its text is. Never the text itself. */
export function describeHeld(held: readonly HeldText[]): string {
  const shown = held.slice(0, 2).map((h) => `${h.field || 'a field'}, ${h.text.length} characters`)
  return held.length > 2 ? `${shown.join('; ')}; and ${held.length - 2} more` : shown.join('; ')
}
