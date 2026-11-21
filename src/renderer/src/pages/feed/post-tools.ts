// What the tools of a post of the Feed (Explain, Read the post, Translate) say and choose: the reading language the owner picked and where it is remembered,
// what a translated post shows in place of the original, the words of the explanation, and the wish that "Write a reply from this" opens the reply window with.
// Pure, with no React and no DOM types, so it is tested from src/main.

import { DEFAULT_READING_LANGUAGE, readingLanguage, type ReadingLanguage } from '../../../../shared/reading-language'
import type { AssistAngle, AssistJudgement, Finding, FindingAssist, FindingComment, FindingTranslation } from '../../../../shared/types'
import type { Place } from './reply-composer'

/** The place the reading language is kept in browser storage. */
export const READING_LANGUAGE_KEY = 'ppd.readingLanguage'

/** The part of browser storage the choice needs; storage can be missing, blocked or full, and then the choice only lasts while the window is open. */
export interface LanguageStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The language the owner chose last, or Russian while there is none (or what is kept is not a language of the list). */
export function storedLanguage(storage: LanguageStorage | undefined): ReadingLanguage {
  try {
    return readingLanguage(storage?.getItem(READING_LANGUAGE_KEY)) ?? DEFAULT_READING_LANGUAGE
  } catch {
    return DEFAULT_READING_LANGUAGE
  }
}

export function rememberLanguage(storage: LanguageStorage | undefined, language: ReadingLanguage): void {
  try {
    storage?.setItem(READING_LANGUAGE_KEY, language)
  } catch {
    // Remembering is a convenience; without it the language starts from Russian again.
  }
}

/**
 * The small store of the choice, shared by every post on the screen: choosing a language on one post is the choice for the next one too. The language is read
 * from storage once and written to it at every change.
 */
export function createLanguageStore(storage: LanguageStorage | undefined): { snapshot: () => ReadingLanguage; subscribe: (listener: () => void) => () => void; choose: (language: ReadingLanguage) => void } {
  let current = storedLanguage(storage)
  const listeners = new Set<() => void>()
  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    choose: (language) => {
      if (language === current) return
      current = language
      rememberLanguage(storage, language)
      for (const listener of [...listeners]) listener()
    }
  }
}

// ───────────── what a translated post shows ─────────────

/** The title of the post: the translated one while the owner reads the translation, else the post's own. */
export function titleShown(finding: Pick<Finding, 'title'>, translation: FindingTranslation | null, translated: boolean): string {
  const own = finding.title.trim()
  return translated && translation !== null && translation.title.trim() !== '' ? translation.title : own
}

/** The thread with each comment's text translated where the translation has it (a comment it left out stays as it was written). Nothing else of a comment changes. */
export function threadShown(comments: readonly FindingComment[], translation: FindingTranslation | null, translated: boolean): FindingComment[] {
  if (!translated || translation === null) return [...comments]
  const byPosition = new Map(translation.comments.map((c) => [c.position, c.text]))
  return comments.map((comment) => ({ ...comment, text: byPosition.get(comment.position) ?? comment.text }))
}

/** The text of the post: the translated one while the owner reads the translation (when the translation has one), else the post's own. */
export function bodyShown(finding: Pick<Finding, 'body'>, translation: FindingTranslation | null, translated: boolean): string {
  return translated && translation !== null && translation.body.trim() !== '' ? translation.body : finding.body
}

/** What stands under the buttons while a translation exists: what it is, and when it is not of the post as it is now. */
export function translationLine(translation: FindingTranslation | null, translated: boolean): string | null {
  if (translation === null) return null
  if (!translated) return `A translation into ${translation.language} is ready. The post is shown as it was written.`
  return translation.stale ? `Translated into ${translation.language} by the AI, from the post as it was before it changed.` : `Translated into ${translation.language} by the AI.`
}

// ───────────── the text of the post ─────────────

/** What the panel "Read the post" says when it has no text to show, and the one thing it offers. */
export type BodyState = 'text' | 'none' | 'unread'

export function bodyState(finding: Pick<Finding, 'body' | 'bodyAt'>): BodyState {
  if (finding.body.trim() !== '') return 'text'
  return finding.bodyAt !== null ? 'none' : 'unread'
}

export const BODY_NONE = 'This post has no text of its own: it is a title, a picture or a link. What it shows is above.'
export const BODY_UNREAD = "The text of this post has not been read from its page yet. The AI opens the post in the channel's account and reads it (it only reads)."

// ───────────── the explanation ─────────────

export const basisLabel = (basis: AssistJudgement['basis']): string => (basis === 'facts' ? 'by facts' : 'by practice')

/** Who an angle answers, in words: the post, or the comment of someone. */
export function angleWhere(angle: Pick<AssistAngle, 'place'>, comments: readonly FindingComment[], postAuthor: string): string {
  if (angle.place === null) return postAuthor.trim() ? `the post by ${postAuthor.trim()}` : 'the post'
  const comment = comments.find((c) => c.position === angle.place)
  return comment ? `${comment.author.trim() || 'someone'}'s comment` : 'the post'
}

/** The place of the reply window an angle opens: the comment when it is still in the thread, else the post. */
export function anglePlace(angle: Pick<AssistAngle, 'place'>, comments: readonly FindingComment[]): Place {
  return angle.place !== null && comments.some((c) => c.position === angle.place) ? angle.place : 'post'
}

/** The longest wish the reply window takes. */
export const WISH_MAX = 300

/** What the reply window is opened with for an angle: "Write a reply from this", as the owner's own wish for the text (cut to what the window takes). */
export function angleWish(angle: Pick<AssistAngle, 'angle'>): string {
  const wish = `Write the reply from this angle: ${angle.angle.trim()}`
  if (wish.length <= WISH_MAX) return wish
  const cut = wish.slice(0, WISH_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > WISH_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!-]+$/, '')}…`
}

/** The line that says what an explanation is and when it was made. */
export function assistLine(assist: Pick<FindingAssist, 'language' | 'stale' | 'sources'>, at: string): string {
  const parts = [`Explained by the AI in ${assist.language}`, at]
  if (assist.sources.length > 0) parts.push(`with ${assist.sources.length} page${assist.sources.length === 1 ? '' : 's'} from the web`)
  return parts.join(' · ')
}

/** Said when the post changed since the explanation was made. */
export const ASSIST_STALE = 'The post changed since this was written (its text was read again, or comments came). Explain again to include it.'

/** The words over the progress while the AI works for an Explain press: it reads the post first when it has not read it. */
export function explainPhase(phase: 'reading' | 'thinking' | 'asking'): string {
  if (phase === 'reading') return 'Reading the post…'
  if (phase === 'asking') return 'Thinking about your question…'
  return 'Thinking…'
}
