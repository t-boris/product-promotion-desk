// The Settings screen's choices of how often a channel is checked and how far back its first look goes (DEC-040).
// The renderer is not under vitest: its pure logic is tested from here, and imports no .tsx.

import { describe, expect, it } from 'vitest'
import { applySettingsPatch } from '../core/channels/settings'
import { DEFAULT_CHANNEL_SETTINGS, type ChannelSettings } from '../shared/types'
import {
  CUSTOM_INTERVAL,
  CUSTOM_INTERVAL_HINT,
  INTERVAL_HINT,
  INTERVAL_PRESETS,
  LOOK_BACK_DAYS,
  LOOK_BACK_HINT,
  QUERIES_HINT,
  intervalChoice,
  intervalChoices,
  isIntervalPreset,
  lookBackChoices,
  lookBackDoneHint,
  lookBackLabel,
  queriesHint
} from '../renderer/src/pages/channels/check-schedule'
import { fromDraft, toDraft, type SettingsDraft } from '../renderer/src/pages/channels/form'

const draftOf = (patch: Partial<SettingsDraft> = {}): SettingsDraft => ({ ...toDraft(DEFAULT_CHANNEL_SETTINGS), ...patch })
const settingsOf = (draft: SettingsDraft): Omit<ChannelSettings, 'mix'> => {
  const parsed = fromDraft(draft)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.settings
}

describe('Settings: how often a channel is checked', () => {
  it('offers every hour, every 3 hours, once a day and Custom…, in that order', () => {
    expect(intervalChoices().map((c) => [c.value, c.label])).toEqual([
      ['60', 'Every hour'],
      ['180', 'Every 3 hours'],
      ['1440', 'Once a day'],
      [CUSTOM_INTERVAL, 'Custom…']
    ])
  })

  it('preselects the preset equal to the stored value: every 3 hours for a channel on the product default', () => {
    const stored = toDraft(DEFAULT_CHANNEL_SETTINGS).checkIntervalMin
    expect(stored).toBe('180')
    expect(intervalChoice(stored, !isIntervalPreset(stored))).toBe('180')
    for (const preset of INTERVAL_PRESETS) expect(intervalChoice(preset.value, false)).toBe(preset.value)
  })

  it('shows Custom for a stored value that is no preset, and the minutes field has that value', () => {
    for (const stored of ['30', '90', '5', '4320']) {
      expect(isIntervalPreset(stored)).toBe(false)
      expect(intervalChoice(stored, !isIntervalPreset(stored))).toBe(CUSTOM_INTERVAL)
      expect(settingsOf(draftOf({ checkIntervalMin: stored })).checkIntervalMin).toBe(Number(stored))
    }
  })

  it('stays on Custom while the owner has chosen it, even when the minutes typed equal a preset', () => {
    expect(intervalChoice('60', true)).toBe(CUSTOM_INTERVAL)
    expect(intervalChoice('', true)).toBe(CUSTOM_INTERVAL)
    expect(intervalChoice('60', false)).toBe('60')
  })

  it('refuses a custom interval under 5 minutes, or one that is no whole number, and says so at the field', () => {
    for (const bad of ['4', '0', '', 'abc', '1.5', '-60']) {
      const parsed = fromDraft(draftOf({ checkIntervalMin: bad }))
      expect(parsed.ok, bad).toBe(false)
      if (!parsed.ok) expect(parsed.error).toMatch(/at least 5 minutes/)
    }
    expect(settingsOf(draftOf({ checkIntervalMin: '5' })).checkIntervalMin).toBe(5)
  })

  it('says under the choice that each check starts a few minutes earlier or later so channels never start together', () => {
    expect(INTERVAL_HINT).toMatch(/earlier or later/)
    expect(INTERVAL_HINT).toMatch(/never start together/)
  })

  it('offers only intervals the core accepts', () => {
    for (const preset of INTERVAL_PRESETS) {
      expect(applySettingsPatch(DEFAULT_CHANNEL_SETTINGS, { checkIntervalMin: Number(preset.value) }).checkIntervalMin).toBe(Number(preset.value))
    }
  })
})

describe('Settings: how far back the first look goes', () => {
  it('offers None, 7, 14 and 30 days', () => {
    expect(lookBackChoices('30').map((c) => [c.value, c.label])).toEqual([
      ['0', 'None'],
      ['7', '7 days'],
      ['14', '14 days'],
      ['30', '30 days']
    ])
    expect([...LOOK_BACK_DAYS]).toEqual([0, 7, 14, 30])
  })

  it('shows the stored value when it is no preset, in its place, so saving never changes it by itself', () => {
    expect(lookBackChoices('21').map((c) => c.label)).toEqual(['None', '7 days', '14 days', '21 days', '30 days'])
    expect(lookBackChoices('1').map((c) => c.label)).toEqual(['None', '1 day', '7 days', '14 days', '30 days'])
    expect(lookBackChoices('21').some((c) => c.value === '21')).toBe(true)
    expect(settingsOf(draftOf({ lookBackDays: '21' })).lookBackDays).toBe(21)
  })

  it('shows a preset once, and leaves out a value that is no whole number', () => {
    expect(lookBackChoices('14')).toHaveLength(4)
    expect(lookBackChoices('0')).toHaveLength(4)
    expect(lookBackChoices('')).toHaveLength(4)
    expect(lookBackChoices('abc')).toHaveLength(4)
  })

  it('is 30 days for a channel on the product default, and the draft carries it as text', () => {
    expect(toDraft(DEFAULT_CHANNEL_SETTINGS).lookBackDays).toBe('30')
    expect(lookBackLabel(0)).toBe('None')
    expect(lookBackLabel(30)).toBe('30 days')
  })

  it('accepts 0 to 30 days and refuses more, or anything that is no whole number', () => {
    for (const good of ['0', '7', '14', '30']) expect(settingsOf(draftOf({ lookBackDays: good })).lookBackDays).toBe(Number(good))
    for (const bad of ['31', '100', '', 'abc', '-1', '2.5']) {
      const parsed = fromDraft(draftOf({ lookBackDays: bad }))
      expect(parsed.ok, bad).toBe(false)
      if (!parsed.ok) expect(parsed.error).toMatch(/0 to 30/)
    }
  })

  it('offers only days the core accepts', () => {
    for (const days of LOOK_BACK_DAYS) expect(applySettingsPatch(DEFAULT_CHANNEL_SETTINGS, { lookBackDays: days }).lookBackDays).toBe(days)
  })

  it('says under the choice that the first check looks back and that after that only new posts are read', () => {
    expect(LOOK_BACK_HINT).toMatch(/first check/)
    expect(LOOK_BACK_HINT).toMatch(/only new posts/)
  })
})

describe('Settings: the limits of the interval, and a first look that is done', () => {
  it('refuses an interval of more than a week at the field, with the core\'s own limit, and accepts the week itself', () => {
    expect(settingsOf(draftOf({ checkIntervalMin: '10080' })).checkIntervalMin).toBe(10080)
    const parsed = fromDraft(draftOf({ checkIntervalMin: '10081' }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(/once a week/)
    expect(() => applySettingsPatch(DEFAULT_CHANNEL_SETTINGS, { checkIntervalMin: 10081 })).toThrow(/once a week/)
    expect(() => applySettingsPatch(DEFAULT_CHANNEL_SETTINGS, { checkIntervalMin: 10080 })).not.toThrow()
    expect(CUSTOM_INTERVAL_HINT).toMatch(/5 minutes to a week/)
  })

  it('says a done first look is done and why it cannot be asked again, with and without the time', () => {
    expect(lookBackDoneHint('Nov 15, 09:12')).toMatch(/^Done Nov 15, 09:12\./)
    expect(lookBackDoneHint('')).toMatch(/^Done\./)
    expect(lookBackDoneHint('')).toMatch(/looks back once/)
  })
})

describe('Settings: the form keeps what it does not show', () => {
  it('hands back the interval and the look-back it was given, and never the content mix', () => {
    const settings = settingsOf(toDraft({ ...DEFAULT_CHANNEL_SETTINGS, checkIntervalMin: 90, lookBackDays: 14 }))
    expect(settings).toMatchObject({ checkIntervalMin: 90, lookBackDays: 14 })
    expect('mix' in settings).toBe(false)
  })
})

describe('Settings: the hint under the search queries (DEC-042)', () => {
  it('says the AI also searches the platform for them, only for a channel it watches in the browser', () => {
    expect(queriesHint({ reads: false, watchedInBrowser: true })).toBe('One per line or separated by commas. The AI also searches the platform for these (the first three).')
    expect(queriesHint({ reads: true, watchedInBrowser: false })).toBe(QUERIES_HINT)
    expect(queriesHint({ reads: false, watchedInBrowser: false })).toBe('One per line or separated by commas.')
    // A connector reads the channel: the flag does not make it a browser channel.
    expect(queriesHint({ reads: true, watchedInBrowser: true })).toBe(QUERIES_HINT)
  })
})
