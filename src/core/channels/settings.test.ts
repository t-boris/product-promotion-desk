import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { DEFAULT_CHANNEL_SETTINGS, type ChannelSettings } from '../../shared/types'
import { applySettingsPatch, parseDigestTime } from './settings'

const base = (): ChannelSettings => structuredClone(DEFAULT_CHANNEL_SETTINGS)
const refused = (patch: unknown): string => {
  try {
    applySettingsPatch(base(), patch)
  } catch (error) {
    if (error instanceof ApiError) {
      expect(error.code).toBe('invalid_input')
      return error.message
    }
    throw error
  }
  throw new Error('expected a refusal')
}

describe('channel settings validation', () => {
  it('applies a valid partial patch and keeps the rest', () => {
    const next = applySettingsPatch(base(), { style: ' friendly, brief ', topics: ['astrology', ' astrology ', 'tarot'], checkIntervalMin: 45, notifications: false })
    expect(next).toMatchObject({ style: 'friendly, brief', topics: ['astrology', 'tarot'], checkIntervalMin: 45, notifications: false, languages: ['en'] })
    expect(next.limits).toEqual(DEFAULT_CHANNEL_SETTINGS.limits)
  })

  it('does not modify the settings it was given', () => {
    const current = base()
    applySettingsPatch(current, { limits: { perHour: 9 } })
    expect(current.limits.perHour).toBe(DEFAULT_CHANNEL_SETTINGS.limits.perHour)
  })

  it('requires a check interval of at least 5 minutes, as a whole number', () => {
    expect(refused({ checkIntervalMin: 4 })).toMatch(/every 5 minutes/)
    expect(refused({ checkIntervalMin: 0 })).toMatch(/every 5 minutes/)
    expect(refused({ checkIntervalMin: 7.5 })).toMatch(/every 5 minutes/)
    expect(refused({ checkIntervalMin: '30' })).toMatch(/every 5 minutes/)
    expect(applySettingsPatch(base(), { checkIntervalMin: 5 }).checkIntervalMin).toBe(5)
  })

  it('requires limits to be whole numbers of zero or more', () => {
    expect(refused({ limits: { perHour: -1 } })).toMatch(/zero or more/)
    expect(refused({ limits: { perDay: 1.5 } })).toMatch(/whole numbers/)
    expect(refused({ limits: { perDay: Number.NaN } })).toMatch(/whole numbers/)
    expect(refused({ limits: { perHour: '2' } })).toMatch(/whole numbers/)
    expect(refused({ limits: { perMinute: 1 } })).toMatch(/Unknown limit/)
    expect(applySettingsPatch(base(), { limits: { perHour: 0, perDay: 0 } }).limits).toEqual({ perHour: 0, perDay: 0 })
  })

  it('accepts a daily summary time as HH:MM or null, nothing else', () => {
    expect(applySettingsPatch(base(), { digestTime: '08:30' }).digestTime).toBe('08:30')
    expect(applySettingsPatch({ ...base(), digestTime: '08:30' }, { digestTime: null }).digestTime).toBeNull()
    for (const bad of ['8:30', '24:00', '12:60', 'noon', '08:30:00', '', 830]) expect(() => parseDigestTime(bad)).toThrow(ApiError)
  })

  it('allows only the automatic categories thanks and faq', () => {
    expect(applySettingsPatch(base(), { autoCategories: ['faq', 'thanks', 'faq'] }).autoCategories).toEqual(['faq', 'thanks'])
    expect(refused({ autoCategories: ['complaint'] })).toMatch(/cannot be answered automatically/)
    expect(refused({ autoCategories: ['refund_request'] })).toMatch(/Allowed: thanks, faq/)
    expect(refused({ autoCategories: 'thanks' })).toMatch(/must be a list/)
  })

  it('validates languages, lists and types, and refuses unknown settings instead of ignoring them', () => {
    expect(applySettingsPatch(base(), { languages: ['EN', 'pt-BR'] }).languages).toEqual(['en', 'pt-br'])
    expect(refused({ languages: [] })).toMatch(/at least one language/)
    expect(refused({ languages: ['english'] })).toMatch(/language codes/)
    expect(refused({ topics: 'tarot' })).toMatch(/must be a list/)
    expect(refused({ queries: [42] })).toMatch(/text only/)
    expect(refused({ notifications: 'yes' })).toMatch(/on or off/)
    expect(refused({ style: 5 })).toMatch(/must be text/)
    expect(refused({ mode: 'auto' })).toMatch(/Unknown setting: mode/)
    expect(refused(null)).toMatch(/must be an object/)
  })
})
