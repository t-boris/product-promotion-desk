// Looking at what a platform's people talk about, in the account's own browser, for the owner who is writing a post (REQ-004, DEC-042). The AI only
// READS: it opens the platform's own search pages for what the owner is writing about (the application opens them; the AI cannot type a search), looks
// at what they show like a person, and records the topics it saw. Nothing is replied to, liked, followed, posted or changed, and nothing it records
// is stored: the topics go to the owner's screen, and the owner decides what to do with them.
//
// It is the watch mission's own way of looking (BrowserToolbox: the same pages-by-address, pacing, owner-takes-the-browser rules, and no tool that
// clicks, types, presses a key, runs a script, uploads or asks), with one record tool that takes topics instead of posts. This file holds the pure rules:
// the tools, what a recorded topic must look like, and the shapes the quick-post helper and the AI agent service pass between them. The barrier is the
// toolbox, not the brief (research-mission.ts): the brief is a courtesy to the model.

import { isRecord, oneLine } from '../assist/kit'
import { NOTE_LEFT_OUT, cleanText, safeLine } from '../pipeline/triage-prompt'
import { WATCH_MIN_GAP_MS, canonicalWatchUrl, type WatchOutcome } from './watch'

/** A search is a few pages and a few topics, and the owner is waiting for it in the composer: ten minutes and forty calls are generous. */
export const RESEARCH_TIMEOUT_MS = 10 * 60 * 1000
export const RESEARCH_MAX_CALLS = 40
/** The most topics one search records: the rest of what it saw is not wanted. */
export const RESEARCH_MAX_TOPICS = 8
export const RESEARCH_MAX_ITEMS_PER_CALL = 8
/** How many search pages are opened in one search. */
export const RESEARCH_MAX_QUERIES = 3
export const RESEARCH_MIN_GAP_MS = WATCH_MIN_GAP_MS
/** How many approved facts the AI that browses is told of the product, to judge what bears on it. */
export const RESEARCH_MAX_ABOUT = 12

const MAX_TOPIC = 80
const MAX_WHAT = 200

/** The tools of a research mission, exactly. A test lists them, so that nothing can be added by accident. */
export const RESEARCH_TOOL_NAMES = ['browser_snapshot', 'browser_scroll', 'watch_open', 'watch_back', 'research_record', 'report_result'] as const

/** One thing people are talking about, as the AI saw it. Nothing here comes from the owner: every word is data from strangers, written down by the AI. */
export interface ResearchTopic {
  topic: string
  what: string
  /** A page of the platform that shows it, or null. */
  url: string | null
}

export interface ResearchRecorded {
  stored: number
  /** Topics recorded twice in the same search (counted, never stored twice). */
  known: number
}

/** What the toolbox is held to in a research mission. */
export interface ResearchSetup {
  /** The pages the AI may start from, numbered from 1: the platform's search for what the owner writes about. */
  places: string[]
  /** Keeps the topics for the owner's screen; the helper that started the search owns them. */
  record: (topics: ResearchTopic[]) => ResearchRecorded
  maxTopics: number
  /** The least time between two openings of a page. */
  minGapMs: number
  now?: () => number
}

/** Everything the brief of a research mission says (research-mission.ts). Facts about the owner's product are the owner's; the rest is data. */
export interface ResearchBrief {
  /** The platform's name as the owner knows it ("Instagram"). */
  platform: string
  accountLabel: string
  product: { name: string; websiteUrl: string | null; description: string | null }
  /** Approved facts of the product, in the passport's words: what the post may be about. */
  about: string[]
  /** What the owner asked to look for, when they said; null otherwise. */
  wish: string | null
  /** The languages the owner chose for the channel: what the AI writes about what it saw is in the first (English when none). */
  languages: string[]
  /** The pages, in the order of `ResearchSetup.places`: the platform's search for each thing to look for, or the place's own pages. */
  places: { label: string; url: string }[]
  maxTopics: number
  /** What kind of look this is (DEC-045); `trends` when absent. */
  focus?: 'trends' | 'now' | 'feed'
}

export interface ResearchMissionRequest {
  accountId: string
  /** What the run is shown under in the AI progress panel, so the composer shows only its own search. */
  subject: string
  /** The platform's own domains: the toolbox goes nowhere else. */
  hosts: string[]
  brief: ResearchBrief
  record: ResearchSetup['record']
}

/** How a research ended: the same ways a watch does. */
export type ResearchOutcome = WatchOutcome

/** The service the quick-post helper starts a search through. Implemented by the AI agent service. */
export interface ResearchMissionService {
  /** Whether a search can start on the account now, with the reason in words when it cannot. */
  researchReady(accountId: string): Promise<{ ready: boolean; reason: string | null }>
  research(request: ResearchMissionRequest): Promise<ResearchOutcome>
}

const key = (topic: string): string => topic.toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ')

/**
 * The topics the AI says it saw: at most `RESEARCH_MAX_ITEMS_PER_CALL`, each a plain label, one plain line on what is said about it and, when the AI
 * names one, a page of the platform that shows it. A line that holds an address or reads as an instruction is refused, as the triage refuses it
 * (`safeLine`): what a stranger wrote must not reach the owner's screen as an order or a link. A topic that cannot be read is refused with its reason and
 * the others stand; a page that is not on the platform is only dropped (the topic is still worth showing). `error` only when the call as a whole is not
 * a list of topics.
 */
export function readResearchTopics(raw: unknown, hosts: string[]): { topics: ResearchTopic[]; refused: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: `items must be a list of 1 to ${RESEARCH_MAX_ITEMS_PER_CALL} topics, each with topic and what.` }
  if (raw.length > RESEARCH_MAX_ITEMS_PER_CALL) return { error: `At most ${RESEARCH_MAX_ITEMS_PER_CALL} topics in one call; send the rest in the next one.` }
  const topics: ResearchTopic[] = []
  const refused: string[] = []
  raw.forEach((entry: unknown, index) => {
    const at = `Topic ${index + 1}`
    if (!isRecord(entry)) return void refused.push(`${at}: not an object.`)
    const topic = safeLine(entry.topic, MAX_TOPIC, true)
    if (topic === null || topic === NOTE_LEFT_OUT) return void refused.push(`${at}: topic must be a short plain label (a few words, a hashtag is fine), without a link or an instruction.`)
    const what = safeLine(entry.what, MAX_WHAT, true)
    if (what === null || what === NOTE_LEFT_OUT) return void refused.push(`${at}: what must be one plain line on what people say or show about it, without a link or an instruction.`)
    const url = entry.url === undefined || entry.url === null || entry.url === '' ? null : canonicalWatchUrl(entry.url, hosts)
    topics.push({ topic: oneLine(cleanText(topic), MAX_TOPIC), what, url })
  })
  return { topics, refused }
}

/** The topics a search keeps, one per label (a hashtag and the same word without it are one), in the order they were recorded. */
export class TopicList {
  private readonly seen = new Map<string, ResearchTopic>()

  constructor(private readonly max: number = RESEARCH_MAX_TOPICS) {}

  get topics(): ResearchTopic[] {
    return [...this.seen.values()]
  }

  /** Keeps what is new, up to the limit; `record` is the function the toolbox is given. */
  readonly record = (items: ResearchTopic[]): ResearchRecorded => {
    let stored = 0
    let known = 0
    for (const item of items) {
      if (this.seen.has(key(item.topic))) known += 1
      else if (this.seen.size < this.max) {
        this.seen.set(key(item.topic), item)
        stored += 1
      }
    }
    return { stored, known }
  }
}
