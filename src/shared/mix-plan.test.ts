import { describe, expect, it } from 'vitest'
import { MAX_MIX_DAYS, MIN_MIX_DAYS } from '../core/channels/settings'
import { MIX_MAX_DAYS, MIX_MIN_DAYS, changeHint, moved, parsePlan, planWords, rhythmInForce, rhythmWords, type PlanStep } from './mix-plan'

const step = (from: PlanStep['from'], to: PlanStep['to']): PlanStep => ({ channelId: 'c', kind: 'product_post', move: 'more', from, to })

describe('a step an accepted change makes in the plan of drafts', () => {
  it('the application, not the AI, decides the days: more is twice as often or switched on, less is half as often, pause is off', () => {
    expect(moved({ enabled: true, everyDays: 14 }, 'more')).toEqual({ enabled: true, everyDays: 7 })
    expect(moved({ enabled: true, everyDays: 7 }, 'more')).toEqual({ enabled: true, everyDays: 4 })
    expect(moved({ enabled: false, everyDays: 14 }, 'more')).toEqual({ enabled: true, everyDays: 14 })
    expect(moved({ enabled: true, everyDays: 14 }, 'less')).toEqual({ enabled: true, everyDays: 28 })
    expect(moved({ enabled: true, everyDays: 60 }, 'less')).toEqual({ enabled: true, everyDays: 90 })
    expect(moved({ enabled: true, everyDays: 14 }, 'pause')).toEqual({ enabled: false, everyDays: 14 })
  })

  it('a move that would change nothing is no step', () => {
    expect(moved({ enabled: true, everyDays: 1 }, 'more')).toBeNull()
    expect(moved({ enabled: true, everyDays: 90 }, 'less')).toBeNull()
    expect(moved({ enabled: false, everyDays: 14 }, 'less')).toBeNull()
    expect(moved({ enabled: false, everyDays: 14 }, 'pause')).toBeNull()
  })

  it('keeps the same limits of days as the channel\'s own setting', () => {
    expect([MIX_MIN_DAYS, MIX_MAX_DAYS]).toEqual([MIN_MIX_DAYS, MAX_MIX_DAYS])
  })

  it('applies only while the owner\'s setting is what it was: the owner\'s later edit wins', () => {
    const s = step({ enabled: true, everyDays: 14 }, { enabled: true, everyDays: 7 })
    expect(rhythmInForce({ enabled: true, everyDays: 14 }, s)).toEqual({ enabled: true, everyDays: 7 })
    expect(rhythmInForce({ enabled: true, everyDays: 10 }, s)).toEqual({ enabled: true, everyDays: 10 })
    expect(rhythmInForce({ enabled: false, everyDays: 14 }, s)).toEqual({ enabled: false, everyDays: 14 })
    expect(rhythmInForce({ enabled: true, everyDays: 14 }, undefined)).toEqual({ enabled: true, everyDays: 14 })
  })

  it('is said in words with the owner\'s own setting beside it', () => {
    expect(planWords(step({ enabled: true, everyDays: 14 }, { enabled: true, everyDays: 7 }))).toBe('a draft every 7 days (yours: every 14 days)')
    expect(planWords(step({ enabled: false, everyDays: 30 }, { enabled: true, everyDays: 30 }))).toBe('a draft every 30 days (yours: off)')
    expect(planWords(step({ enabled: true, everyDays: 2 }, { enabled: false, everyDays: 2 }))).toBe('no drafts (yours: every 2 days)')
    expect(rhythmWords({ enabled: true, everyDays: 1 })).toBe('a draft every day')
    expect(rhythmWords({ enabled: false, everyDays: 7 })).toBe('no drafts')
  })

  it('kept steps that are not whole are left out when read back', () => {
    const whole = step({ enabled: true, everyDays: 14 }, { enabled: true, everyDays: 7 })
    expect(parsePlan([whole, { ...whole, move: 'double' }, { ...whole, to: { enabled: true, everyDays: 0 } }, null, 'x'])).toEqual([whole])
    expect(parsePlan('nothing')).toEqual([])
  })

  it('the review says under its buttons whether accepting changes the plan', () => {
    expect(changeHint({ byOwner: false, plan: [1] })).toMatch(/also changes how often drafts are prepared.*your own setting is kept.*Nothing is approved, scheduled or posted/)
    expect(changeHint({ byOwner: true, plan: [] })).toMatch(/A change you wrote changes no plan of drafts/)
    expect(changeHint({ byOwner: false, plan: [] })).toMatch(/only when it lists what it changes/)
    expect(changeHint(null)).toMatch(/only when it lists what it changes/)
  })
})
