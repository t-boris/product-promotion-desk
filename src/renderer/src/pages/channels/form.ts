// Conversion between the channel settings and the text the settings form edits.

import type { AutoCategory, ChannelSettings } from '../../../../shared/types'

export interface SettingsDraft {
  languages: string
  style: string
  topics: string
  queries: string
  checkIntervalMin: string
  perHour: string
  perDay: string
  thanks: boolean
  faq: boolean
  digestOn: boolean
  digestTime: string
  notifications: boolean
}

const splitList = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)

export function toDraft(settings: ChannelSettings): SettingsDraft {
  return {
    languages: settings.languages.join(', '),
    style: settings.style,
    topics: settings.topics.join('\n'),
    queries: settings.queries.join('\n'),
    checkIntervalMin: String(settings.checkIntervalMin),
    perHour: String(settings.limits.perHour),
    perDay: String(settings.limits.perDay),
    thanks: settings.autoCategories.includes('thanks'),
    faq: settings.autoCategories.includes('faq'),
    digestOn: settings.digestTime !== null,
    digestTime: settings.digestTime ?? '09:00',
    notifications: settings.notifications
  }
}

function wholeNumber(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null
}

export type ParsedSettings = { ok: true; settings: ChannelSettings } | { ok: false; error: string }

/** Quick checks for a clear message at the field; the core validates everything again. */
export function fromDraft(draft: SettingsDraft): ParsedSettings {
  const interval = wholeNumber(draft.checkIntervalMin)
  if (interval === null || interval < 5) return { ok: false, error: 'Check interval must be a whole number of at least 5 minutes.' }
  const perHour = wholeNumber(draft.perHour)
  const perDay = wholeNumber(draft.perDay)
  if (perHour === null || perDay === null) return { ok: false, error: 'Limits must be whole numbers, zero or more.' }
  const languages = splitList(draft.languages)
  if (languages.length === 0) return { ok: false, error: 'Enter at least one language, for example en.' }
  if (draft.digestOn && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.digestTime)) return { ok: false, error: 'Enter the summary time as HH:MM.' }
  const autoCategories: AutoCategory[] = [...(draft.thanks ? (['thanks'] as const) : []), ...(draft.faq ? (['faq'] as const) : [])]
  return {
    ok: true,
    settings: {
      languages,
      style: draft.style.trim(),
      topics: splitList(draft.topics),
      queries: splitList(draft.queries),
      checkIntervalMin: interval,
      limits: { perHour, perDay },
      autoCategories,
      digestTime: draft.digestOn ? draft.digestTime : null,
      notifications: draft.notifications
    }
  }
}
