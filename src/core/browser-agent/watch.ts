// Watching a channel the app has no connector for, in the account's own browser, like a person (DEC-042). The AI only READS: it looks at the channel's
// own page (its newest posts first), judges what it sees against the product's goals, and records what matters as findings. It does not search.
// Nothing is replied to, measured, baselined or sent from what it reads, and no opportunity or draft comes out of it.
//
// This file holds the pure rules: what the toolbox's watch mode is allowed (see BrowserToolbox: six tools, no click, no typing, no script, no upload,
// no question to the owner), what a recorded post must look like, and the shapes the monitor's watch flow and the AI agent service pass between them.
// The barrier is the toolbox, not the brief (watch-mission.ts): the brief is a courtesy to the model.

import type { FindingLabel } from '../../shared/types'
import { isRecord, oneLine } from '../assist/kit'
import { hostMatches } from '../channels/presets'
import { MAX_RELATION_CHARS, cleanText, safeLine } from '../pipeline/triage-prompt'
import { WATCH_REPLY_PREFIX } from '../../shared/finding-reply'

/** A check is one visit to the channel's pages: twenty minutes and a hundred and twenty calls are generous, and nobody is asked anything. */
export const WATCH_TIMEOUT_MS = 20 * 60 * 1000
export const WATCH_MAX_CALLS = 120
/**
 * The first look at a channel goes back the owner's days (30 by default), and a busy community has thousands of posts in that time: it gets more calls, because
 * a look that runs out of them keeps what it saved and goes on at the next look, but one that can never get to the end would never be a whole look.
 */
export const WATCH_FIRST_LOOK_MAX_CALLS = 300
/** A look that ran out of calls after saving posts is tried again after this long (it has more to do, nothing failed). */
export const WATCH_PARTIAL_RETRY_MIN = 10
/** The most findings one check records (the skipped ones included): the rest of what it saw waits for the next check. */
export const WATCH_MAX_FINDINGS = 60
export const WATCH_MAX_ITEMS_PER_CALL = 20
/** The least time between two openings of a page: a person does not act in milliseconds, and a site notices. */
export const WATCH_MIN_GAP_MS = 2000
/** How many of the channel's most recent finding addresses a check is told it judged already. */
export const WATCH_KNOWN_LIMIT = 150
/** How many posts a check works through at most (the brief says so; the finding cap is what holds). */
export const WATCH_MAX_POSTS = 60
/** A check that could not run is tried again after this long, whatever the reason (the browser is busy, the engine is not ready). */
export const WATCH_RETRY_MIN = 5

/** The tools of a watch mission, exactly. A test lists them, so that nothing can be added by accident. */
export const WATCH_TOOL_NAMES = ['browser_snapshot', 'browser_scroll', 'watch_open', 'watch_back', 'watch_record', 'report_result'] as const

export { WATCH_REPLY_PREFIX }
/** How many posts a look is sent back to read: the ones it called worth a reply before it read threads. A few at a time, so a look still has its calls for the new posts. */
export const WATCH_UNREAD_LIMIT = 8
/** What a place of the brief that is such a post starts with. */
export const TO_READ_LABEL = 'A post you called worth a reply before, not read yet'
export const WATCH_SKIP_RELATION = 'Not relevant to the product\'s goals.'
const MAX_TITLE = 200
/** What the AI may say of a post worth a reply (characters): the post, the thread, whom to answer, and the comment (which keeps its paragraphs). */
export const WATCH_ABOUT_MAX = 500
export const WATCH_THREAD_MAX = 700
export const WATCH_REPLY_TO_MAX = 250
export const WATCH_COMMENT_MAX = 1500
/** The thread kept for a post worth a reply: how many comments, how long each is (characters), how deep, how long an author's name. */
export const WATCH_THREAD_ITEMS_MAX = 25
export const WATCH_THREAD_TEXT_MAX = 400
export const WATCH_COMMENT_DEPTH_MAX = 4
const WATCH_COMMENT_AUTHOR_MAX = 60
const MAX_AUTHOR = 80

/** A post as it is stored: a reply is stored as a notice that says so (the app has no way to reply on these platforms), a skip stays a skip. */
export interface WatchItem {
  /** The canonical address of the post: it is the finding's identity within the channel. */
  url: string
  title: string
  author: string
  label: Extract<FindingLabel, 'notice' | 'skip'>
  relation: string
  /**
   * Only for a post the AI called `reply`, after it opened the post and read what is said under it: what the post says, what the thread says, whom to
   * answer, and the comment it would leave. Empty for every other post. Plain text of the AI about a stranger's page: shown, never obeyed, never posted.
   */
  about: string
  thread: string
  replyTo: string
  comment: string
  /** The comments of the thread as the AI saw them, in reading order: the owner picks one to answer. Only for a post called `reply`; empty otherwise. */
  comments: WatchComment[]
}

/** One comment under a post, as the AI saw it. Plain text of a stranger: shown, never obeyed. */
export interface WatchComment {
  author: string
  text: string
  /** 0 = directly under the post, 1 = an answer to such a comment, and so on (at most `WATCH_COMMENT_DEPTH_MAX`). */
  depth: number
  /** The comment's own address when the AI could see it; empty otherwise. */
  url: string
}

export interface WatchRecorded {
  stored: number
  /** Posts of the channel that had a finding already (counted, never stored twice). */
  known: number
}

/** What the toolbox is held to in a watch mission. */
export interface WatchSetup {
  /** The pages the AI may start from, numbered from 1: the channel's newest posts where the site has such a page, and the channel's own page. */
  places: string[]
  /** Stores the findings; the flow that started the check owns the table. */
  record: (items: WatchItem[]) => WatchRecorded
  maxFindings: number
  /** The least time between two openings of a page. */
  minGapMs: number
  now?: () => number
}

/** Everything the brief of a watch mission says (watch-mission.ts). Facts about the owner's product are the owner's; the rest is data. */
export interface WatchBrief {
  /** The platform's name as the owner knows it ("Instagram"). */
  platform: string
  channelTarget: string
  channelUrl: string
  accountLabel: string
  /** Who the account is on the platform, when known: its own posts are never recorded. */
  accountIdentity: string | null
  product: { name: string; websiteUrl: string | null; description: string | null }
  goals: { targetAction: string; successMetrics: string[] }[]
  topics: string[]
  queries: string[]
  /** The pages, in the order of `WatchSetup.places`. */
  places: { label: string; url: string }[]
  /** The first check of the channel: it looks back `lookBackDays` days. */
  firstLook: boolean
  lookBackDays: number
  /** Posts older than this are of no interest (ISO time). */
  since: string
  /** The addresses already judged in earlier checks: not opened and not recorded again. */
  known: string[]
  maxPosts: number
  /** The tool calls the look has in all, the ones it makes after the last page included (saving and reporting still work then). */
  maxCalls: number
}

export interface WatchMissionRequest {
  accountId: string
  channelId: string
  /** The platform's own domains: the toolbox goes nowhere else. */
  hosts: string[]
  brief: WatchBrief
  record: WatchSetup['record']
}

export interface WatchOutcome {
  /** How the engine run ended. `busy`: the browser was not free (another task of the account, the owner took it): the check is for later. */
  ended: 'finished' | 'stopped' | 'timeout' | 'error' | 'busy'
  /** What the AI said about how it went. */
  reported: { status: 'done' | 'needs_owner' | 'failed'; reason: string } | null
  /** A human check the last page showed (a CAPTCHA), described; null when none. */
  humanCheck: string | null
  error: string | null
  /** The AI's own last words, on one line and short; empty when it said nothing. Shown when it ended without reporting, so the owner can see why. */
  said: string
  /** A call was refused because the allowance of tool calls was used up: the look did not get to the end of what it set out to do, whatever it reported. */
  outOfCalls: boolean
}

/** The service the monitor's watch flow starts a check through. Implemented by the AI agent service. */
export interface WatchMissionService {
  /** Whether a check can start on the account now, with the reason in words when it cannot. */
  watchReady(accountId: string): Promise<{ ready: boolean; reason: string | null }>
  watch(request: WatchMissionRequest): Promise<WatchOutcome>
}

// ───────────────────────── what a link is, and a post ─────────────────────────

/** A page that signs the account out, or changes it, is never opened to read: a link to it is refused whatever its text says. */
const LEAVES_THE_ACCOUNT = /\/(?:log-?out|sign-?out)(?:[/.]|$)/i

/** Whether an address is one the AI may open: http or https, a page of the platform, and not a page that signs the account out. Null when it is, else why not. */
export function openProblem(address: string, hosts: string[]): string | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return 'That is not an address.'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Only http and https addresses are opened.'
  if (url.username || url.password) return 'An address with a name or a password in it is not opened.'
  if (!hostMatches(url.hostname, hosts)) return `Only pages of ${hosts.join(', ')} are opened in this check.`
  if (LEAVES_THE_ACCOUNT.test(url.pathname)) return 'That page signs the account out, and nothing of the kind is opened in this check.'
  return null
}

/**
 * The address a finding is known by: a page of the platform, the query and the fragment dropped and no closing slash, so the same post found twice
 * through two roads is one finding. Null for anything that is not a page of the platform, and for the front page of a site (it is no post).
 */
export function canonicalWatchUrl(raw: unknown, hosts: string[]): string | null {
  if (typeof raw !== 'string') return null
  if (openProblem(raw.trim(), hosts) !== null) return null
  const url = new URL(raw.trim())
  const path = url.pathname.replace(/\/+$/, '')
  return path === '' ? null : `${url.protocol}//${url.host}${path}`
}

const LABELS = ['reply', 'notice', 'skip']

/** The comment the AI would leave: plain text that keeps its paragraphs, without hidden or control characters, cut to `WATCH_COMMENT_MAX`. Null when it is not text or is empty. */
export function commentText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = cleanText(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text === '' ? null : text.slice(0, WATCH_COMMENT_MAX)
}

const ADDRESS = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi

/**
 * The comments of a thread as the AI saw them: at most `WATCH_THREAD_ITEMS_MAX`, each one's text plain (no hidden characters, one line, an address in it
 * shown as "[link]", cut), its author, its depth and, when the AI gave one that is a page of the platform, its own address. A comment without text is
 * left out; so is anything that is not a comment. Nothing in them is obeyed: they are the strangers' words, shown to the owner.
 */
export function readThreadComments(raw: unknown, hosts: string[]): WatchComment[] {
  if (!Array.isArray(raw)) return []
  const comments: WatchComment[] = []
  for (const entry of raw) {
    if (comments.length >= WATCH_THREAD_ITEMS_MAX) break
    if (!isRecord(entry) || typeof entry.text !== 'string') continue
    const text = oneLine(cleanText(entry.text).replace(ADDRESS, '[link]'), WATCH_THREAD_TEXT_MAX)
    if (text === '') continue
    const author = typeof entry.author === 'string' ? oneLine(cleanText(entry.author).replace(ADDRESS, '[link]'), WATCH_COMMENT_AUTHOR_MAX) : ''
    const depth = typeof entry.depth === 'number' && Number.isFinite(entry.depth) ? Math.min(WATCH_COMMENT_DEPTH_MAX, Math.max(0, Math.trunc(entry.depth))) : 0
    comments.push({ author, text, depth, url: canonicalWatchUrl(entry.url, hosts) ?? '' })
  }
  return comments
}

/**
 * The posts the AI says it looked at: at most `WATCH_MAX_ITEMS_PER_CALL`, each one a page of the platform with a title as seen, a label and one plain
 * line on how it relates to the goals. A line that holds an address or reads as an instruction is replaced by the fixed neutral sentence, exactly as
 * the triage does it (`safeLine`). `reply` is stored as a `notice` that says so. A post that cannot be read is refused with its reason and the
 * others stand. `error` only when the call as a whole is not a list of posts.
 */
export function readWatchItems(raw: unknown, hosts: string[]): { items: WatchItem[]; refused: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: `items must be a list of 1 to ${WATCH_MAX_ITEMS_PER_CALL} posts, each with url, title, label and relation.` }
  if (raw.length > WATCH_MAX_ITEMS_PER_CALL) return { error: `At most ${WATCH_MAX_ITEMS_PER_CALL} posts in one call; send the rest in the next one.` }
  const items: WatchItem[] = []
  const refused: string[] = []
  raw.forEach((entry: unknown, index) => {
    const at = `Post ${index + 1}`
    if (!isRecord(entry)) return void refused.push(`${at}: not an object.`)
    const url = canonicalWatchUrl(entry.url, hosts)
    if (url === null) return void refused.push(`${at}: url must be the address of a post on ${hosts.join(', ')}.`)
    const label = typeof entry.label === 'string' ? entry.label.trim().toLowerCase() : ''
    if (!LABELS.includes(label)) return void refused.push(`${at}: label must be reply, notice or skip.`)
    const title = typeof entry.title === 'string' ? oneLine(cleanText(entry.title), MAX_TITLE) : ''
    if (title === '') return void refused.push(`${at}: title is the text of the post as you saw it, and it is empty.`)
    const author = typeof entry.author === 'string' ? oneLine(cleanText(entry.author), MAX_AUTHOR) : ''
    const said = label === 'skip' && (entry.relation === undefined || entry.relation === '') ? WATCH_SKIP_RELATION : safeLine(entry.relation, MAX_RELATION_CHARS, true)
    if (said === null) return void refused.push(`${at}: relation must be one plain line on how the post relates to the goals.`)
    const reply = label === 'reply'
    // A post worth a reply is one the AI opened and read: it must say what it read, or the owner is shown a verdict with nothing behind it.
    const about = reply ? safeLine(entry.about, WATCH_ABOUT_MAX, true) : ''
    const thread = reply ? safeLine(entry.thread, WATCH_THREAD_MAX, true) : ''
    const replyTo = reply ? safeLine(entry.reply_to ?? entry.replyTo, WATCH_REPLY_TO_MAX, true) : ''
    const comment = reply ? commentText(entry.comment) : ''
    if (reply && (about === null || thread === null || replyTo === null || comment === null)) {
      return void refused.push(
        `${at}: a post worth a reply must be opened and its thread read first. Open it with watch_open, read the post and what is said under it, then record it again with about (what the post says), thread (what is said under it), reply_to (whom to answer) and comment (the comment you would leave), each as plain text.`
      )
    }
    items.push({ url, title, author, label: label === 'skip' ? 'skip' : 'notice', relation: reply ? `${WATCH_REPLY_PREFIX}${said}` : said, about: about ?? '', thread: thread ?? '', replyTo: replyTo ?? '', comment: comment ?? '', comments: reply ? readThreadComments(entry.comments, hosts) : [] })
  })
  return { items, refused }
}
