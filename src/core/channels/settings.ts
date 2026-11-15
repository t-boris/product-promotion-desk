// Validation of channel settings (REQ-003 limits, REQ-005 digest). Throws ApiError('invalid_input') with a message
// the person can act on.

import { ApiError } from '../../shared/api'
import type { AutoCategory, ChannelLimits, ChannelSettings, MixKind, MixSetting } from '../../shared/types'

export const MIN_CHECK_INTERVAL_MIN = 5
const MAX_CHECK_INTERVAL_MIN = 7 * 24 * 60
const MAX_LIMIT = 1000
const MAX_STYLE = 2000
const MAX_LIST_ITEMS = 50
const MAX_ITEM_CHARS = 120
export const AUTO_CATEGORIES: readonly AutoCategory[] = ['thanks', 'faq']
export const MIX_KINDS: readonly MixKind[] = ['product_post', 'own_update', 'showcase']
export const MIN_MIX_DAYS = 1
export const MAX_MIX_DAYS = 90

const KNOWN = ['languages', 'style', 'topics', 'queries', 'checkIntervalMin', 'limits', 'autoCategories', 'digestTime', 'notifications', 'mix']

const invalid = (message: string): ApiError => new ApiError('invalid_input', message)

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function textList(value: unknown, field: string, normalize: (s: string) => string = (s) => s): string[] {
  if (!Array.isArray(value)) throw invalid(`${field} must be a list.`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`${field} must contain text only.`)
    const text = normalize(item.replace(/\s+/g, ' ').trim())
    if (!text) continue
    if (text.length > MAX_ITEM_CHARS) throw invalid(`An entry in ${field} is too long (limit ${MAX_ITEM_CHARS} characters).`)
    if (!out.includes(text)) out.push(text)
  }
  if (out.length > MAX_LIST_ITEMS) throw invalid(`${field} can have at most ${MAX_LIST_ITEMS} entries.`)
  return out
}

function parseLimits(value: unknown, current: ChannelLimits): ChannelLimits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('limits must be an object with perHour and perDay.')
  const given = value as Record<string, unknown>
  for (const key of Object.keys(given)) if (key !== 'perHour' && key !== 'perDay') throw invalid(`Unknown limit: ${key}.`)
  const next = { ...current }
  for (const key of ['perHour', 'perDay'] as const) {
    if (given[key] === undefined) continue
    const n = given[key]
    if (!isCount(n) || n < 0) throw invalid('Limits must be whole numbers, zero or more.')
    if (n > MAX_LIMIT) throw invalid(`A limit cannot exceed ${MAX_LIMIT}.`)
    next[key] = n
  }
  return next
}

/** The content mix (DEC-033): each kind at most once, a whole number of days between 1 and 90; what is not listed is off. */
export function parseMix(value: unknown): MixSetting[] {
  if (!Array.isArray(value)) throw invalid('The content mix must be a list.')
  const out: MixSetting[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw invalid('Each entry of the content mix must be an object.')
    const given = item as Record<string, unknown>
    for (const key of Object.keys(given)) if (key !== 'kind' && key !== 'enabled' && key !== 'everyDays') throw invalid(`Unknown field in the content mix: ${key}.`)
    if (!MIX_KINDS.includes(given.kind as MixKind)) throw invalid(`"${String(given.kind)}" is not a kind of post the mix can prepare. Allowed: ${MIX_KINDS.join(', ')}.`)
    if (out.some((entry) => entry.kind === given.kind)) throw invalid(`The kind ${String(given.kind)} is listed twice.`)
    if (typeof given.enabled !== 'boolean') throw invalid('Each kind of the content mix must be on or off.')
    const days = given.everyDays
    if (!isCount(days) || days < MIN_MIX_DAYS || days > MAX_MIX_DAYS) throw invalid(`How often must be a whole number of days from ${MIN_MIX_DAYS} to ${MAX_MIX_DAYS}.`)
    out.push({ kind: given.kind as MixKind, enabled: given.enabled, everyDays: days })
  }
  return out
}

/** Accepts "HH:MM" on a 24-hour clock; null clears the daily summary. */
export function parseDigestTime(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw invalid('The summary time must be HH:MM or empty.')
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!match) throw invalid('The summary time must look like 09:30 (24-hour clock) or be empty.')
  return `${match[1]}:${match[2]}`
}

/** Applies `patch` to `current` and returns the full, valid settings. Unknown fields are refused, not ignored. */
export function applySettingsPatch(current: ChannelSettings, patch: unknown): ChannelSettings {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw invalid('Settings must be an object.')
  const given = patch as Record<string, unknown>
  for (const key of Object.keys(given)) if (!KNOWN.includes(key)) throw invalid(`Unknown setting: ${key}.`)

  const next: ChannelSettings = { ...current, limits: { ...current.limits } }

  if (given.languages !== undefined) {
    const languages = textList(given.languages, 'languages', (s) => s.toLowerCase())
    if (languages.length === 0) throw invalid('Choose at least one language.')
    if (languages.some((l) => !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l))) throw invalid('Languages must be language codes such as en or pt-br.')
    next.languages = languages
  }
  if (given.style !== undefined) {
    if (typeof given.style !== 'string') throw invalid('The style must be text.')
    if (given.style.length > MAX_STYLE) throw invalid(`The style is too long (limit ${MAX_STYLE} characters).`)
    next.style = given.style.trim()
  }
  if (given.topics !== undefined) next.topics = textList(given.topics, 'topics')
  if (given.queries !== undefined) next.queries = textList(given.queries, 'queries')
  if (given.checkIntervalMin !== undefined) {
    const n = given.checkIntervalMin
    if (!isCount(n) || n < MIN_CHECK_INTERVAL_MIN) throw invalid(`Check no more often than every ${MIN_CHECK_INTERVAL_MIN} minutes.`)
    if (n > MAX_CHECK_INTERVAL_MIN) throw invalid('Check at least once a week.')
    next.checkIntervalMin = n
  }
  if (given.limits !== undefined) next.limits = parseLimits(given.limits, current.limits)
  if (given.autoCategories !== undefined) {
    if (!Array.isArray(given.autoCategories)) throw invalid('Automatic categories must be a list.')
    const categories: AutoCategory[] = []
    for (const item of given.autoCategories) {
      if (!AUTO_CATEGORIES.includes(item as AutoCategory)) throw invalid(`"${String(item)}" cannot be answered automatically. Allowed: ${AUTO_CATEGORIES.join(', ')}.`)
      if (!categories.includes(item as AutoCategory)) categories.push(item as AutoCategory)
    }
    next.autoCategories = categories
  }
  if (given.digestTime !== undefined) next.digestTime = parseDigestTime(given.digestTime)
  if (given.notifications !== undefined) {
    if (typeof given.notifications !== 'boolean') throw invalid('Notifications must be on or off.')
    next.notifications = given.notifications
  }
  if (given.mix !== undefined) next.mix = parseMix(given.mix)
  return next
}
