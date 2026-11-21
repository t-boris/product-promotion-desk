// The languages the owner can read a post in (Translate and Explain). A fixed list: the choice is the owner's own reading language, not the language of a
// channel, so it is not the one that the AI's text about a channel follows (that is the channel's chosen language, and English for text with no channel).

export const READING_LANGUAGES = ['Russian', 'English', 'Ukrainian', 'Spanish', 'German', 'French', 'Portuguese', 'Italian', 'Turkish', 'Polish'] as const

export type ReadingLanguage = (typeof READING_LANGUAGES)[number]

/** What the choice starts at: the owner reads Russian. */
export const DEFAULT_READING_LANGUAGE: ReadingLanguage = 'Russian'

/** The language a request names, when it is one of the list (ignoring case and spaces); null otherwise. */
export function readingLanguage(raw: unknown): ReadingLanguage | null {
  if (typeof raw !== 'string') return null
  const wanted = raw.trim().toLowerCase()
  return READING_LANGUAGES.find((l) => l.toLowerCase() === wanted) ?? null
}
